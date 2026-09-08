import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContextOptions } from "playwright-core";
import type { AppConfig } from "./config";
import { atomicWriteFile } from "./config";
import {
  assertAuthenticatedChatGptPage,
  assertTemporaryChatPage,
  CHATGPT_TEMPORARY_CHAT_URL,
  detectChatGptAccountCapabilities,
} from "./chatgpt-session";
import type { ChatGptWebAccountCapabilities } from "./chatgpt-web-models";

export interface BrowserLoginResult {
  storageStatePath: string;
  accountSurfaceUrl: string;
  solAvailable: boolean;
  proAvailable: boolean;
}

interface LoginVerificationMarker {
  version: 1;
  authenticated: true;
  verifiedAt: string;
  solAvailable?: boolean;
  proAvailable?: boolean;
}

export function loginVerificationMarkerPath(storageStatePath: string): string {
  return `${storageStatePath}.verified.json`;
}

function writeVerificationMarker(
  storageStatePath: string,
  capabilities: ChatGptWebAccountCapabilities,
): void {
  const marker: LoginVerificationMarker = {
    version: 1,
    authenticated: true,
    verifiedAt: new Date().toISOString(),
    ...capabilities,
  };
  atomicWriteFile(loginVerificationMarkerPath(storageStatePath), `${JSON.stringify(marker)}\n`);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function clearProfileLocks(dir: string): void {
  const locks = ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"];
  for (const name of locks) {
    const p = join(dir, name);
    if (existsSync(p)) {
      try { rmSync(p, { force: true }); } catch {}
    }
  }
}

function killChromeProcessesForProfile(profileDir: string): void {
  if (process.platform !== "win32") return;
  try {
    const escaped = profileDir.replace(/\\/g, "\\\\");
    spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${escaped}*' } | Stop-Process -Force`,
    ], { stdio: "ignore", timeout: 10_000 });
  } catch {}
}

function runWorker<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const workerPath = join(__dirname, "browser-playwright-worker.cjs");
  const proc = spawn("node", [workerPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdoutData = "";
  let stderrData = "";
  proc.stdout.on("data", chunk => { stdoutData += chunk; });
  proc.stderr.on("data", chunk => { stderrData += chunk; });
  proc.on("error", reject);
  proc.on("close", code => {
    if (code !== 0) {
      return reject(new Error(stderrData.trim() || `Playwright worker failed with exit code ${code}`));
    }
    try {
      const parsed = JSON.parse(stdoutData.trim());
      if (!parsed.ok) return reject(new Error(parsed.error));
      resolve(parsed.result as T);
    } catch {
      reject(new Error(`Failed to parse Playwright worker response: ${stdoutData.slice(0, 200)}`));
    }
  });
  proc.stdin.write(JSON.stringify({ action, params }));
  proc.stdin.end();
  return promise;
}

async function inspectStoredState(
  config: AppConfig,
  storageState: NonNullable<BrowserContextOptions["storageState"]>,
): Promise<ChatGptWebAccountCapabilities & { url: string }> {
  if (process.platform === "win32") {
    return await runWorker<ChatGptWebAccountCapabilities & { url: string }>(
      "inspectStoredState",
      { storageState, chromeExecutablePath: config.chromeExecutablePath },
    );
  }
  const ignoreDefaultArgs = ["--password-store=basic", "--use-mock-keychain"];
  const verifierBrowser = await chromium.launch({
    executablePath: config.chromeExecutablePath,
    headless: false,
    ignoreDefaultArgs,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  try {
    const verifierContext = await verifierBrowser.newContext({ storageState });
    try {
      const verifierPage = await verifierContext.newPage();
      await verifierPage.goto(CHATGPT_TEMPORARY_CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await verifierPage.getByRole("textbox", { name: "Chat with ChatGPT" }).waitFor({ state: "visible", timeout: 60_000 });
      await assertAuthenticatedChatGptPage(verifierPage);
      await assertTemporaryChatPage(verifierPage);
      return { ...await detectChatGptAccountCapabilities(verifierPage), url: verifierPage.url() };
    } finally {
      await verifierContext.close();
    }
  } finally {
    await verifierBrowser.close();
  }
}

async function extractAndVerifyState(
  profileDir: string,
  chromeExecutablePath: string,
  timeoutMs?: number,
): Promise<{ state: NonNullable<BrowserContextOptions["storageState"]>; inspected: ChatGptWebAccountCapabilities & { url: string } }> {
  if (process.platform === "win32") {
    return await runWorker<{ state: NonNullable<BrowserContextOptions["storageState"]>; inspected: ChatGptWebAccountCapabilities & { url: string } }>(
      "extractAndVerify",
      { profileDir, chromeExecutablePath, timeoutMs },
    );
  }
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromeExecutablePath,
    headless: false,
    ignoreDefaultArgs: ["--password-store=basic", "--use-mock-keychain"],
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(CHATGPT_TEMPORARY_CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const composer = page.getByRole("textbox", { name: "Chat with ChatGPT" }).or(
      page.locator('[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]'),
    ).first();
    await composer.waitFor({ state: "visible", timeout: timeoutMs ?? 60_000 });
    await assertAuthenticatedChatGptPage(page);
    await assertTemporaryChatPage(page);
    const state = await context.storageState();
    const inspected = { ...await detectChatGptAccountCapabilities(page), url: page.url() };
    return { state, inspected };
  } finally {
    await context.close();
  }
}

export async function inspectBrowserLoginCapabilities(config: AppConfig): Promise<ChatGptWebAccountCapabilities> {
  if (!browserLoginStateExists(config)) throw new Error("ChatGPT login state is missing or unverified");
  const inspected = await inspectStoredState(config, config.storageStatePath);
  writeVerificationMarker(config.storageStatePath, inspected);
  return { solAvailable: inspected.solAvailable, proAvailable: inspected.proAvailable };
}

export function storedBrowserLoginCapabilities(
  config: AppConfig,
): Partial<ChatGptWebAccountCapabilities> {
  if (!browserLoginStateExists(config)) return {};
  try {
    const marker = JSON.parse(readFileSync(loginVerificationMarkerPath(config.storageStatePath), "utf8")) as Partial<LoginVerificationMarker>;
    return {
      ...(typeof marker.solAvailable === "boolean" ? { solAvailable: marker.solAvailable } : {}),
      ...(typeof marker.proAvailable === "boolean" ? { proAvailable: marker.proAvailable } : {}),
    };
  } catch {
    return {};
  }
}

export async function loginToChatGpt(
  config: AppConfig,
  options: { timeoutMs?: number } = {},
): Promise<BrowserLoginResult> {
  if (!existsSync(config.chromeExecutablePath)) {
    throw new Error(`Google Chrome was not found at ${config.chromeExecutablePath}. Pass --chrome with its executable path.`);
  }
  const profileDir = join(dirname(config.storageStatePath), "login-profile");
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });

  killChromeProcessesForProfile(profileDir);
  clearProfileLocks(profileDir);

  process.stdout.write(
    "A normal Chrome window is open. Sign in to ChatGPT (or confirm you are already signed in and see the composer), then quit this dedicated Chrome instance completely.\n",
  );
  const loginBrowser = spawn(config.chromeExecutablePath, [
    `--user-data-dir=${profileDir}`,
    "--new-window",
    "--disable-background-mode",
    "--no-first-run",
    "--no-default-browser-check",
    CHATGPT_TEMPORARY_CHAT_URL,
  ], { env: process.env, stdio: "ignore" });
  const { promise: exitPromise, resolve: resolveExit, reject: rejectExit } = Promise.withResolvers<number>();
  loginBrowser.once("error", rejectExit);
  loginBrowser.once("exit", (code, signal) => {
    if (signal) rejectExit(new Error(`Normal Chrome login window exited from signal ${signal}`));
    else resolveExit(code ?? 1);
  });
  const loginExit = await exitPromise;
  if (loginExit !== 0) throw new Error(`Normal Chrome login window exited with status ${loginExit}`);

  const { promise: sleepPromise, resolve: resolveSleep } = Promise.withResolvers<void>();
  setTimeout(resolveSleep, 1000);
  await sleepPromise;
  killChromeProcessesForProfile(profileDir);
  clearProfileLocks(profileDir);

  const { state, inspected } = await extractAndVerifyState(profileDir, config.chromeExecutablePath, options.timeoutMs);

  atomicWriteFile(config.storageStatePath, `${JSON.stringify(state)}\n`);
  writeVerificationMarker(config.storageStatePath, inspected);

  if (browserLoginStateExists(config)) {
    rmSync(profileDir, { recursive: true, force: true });
  }

  return {
    storageStatePath: config.storageStatePath,
    accountSurfaceUrl: inspected.url,
    solAvailable: inspected.solAvailable,
    proAvailable: inspected.proAvailable,
  };
}

export function browserLoginStateExists(config: AppConfig): boolean {
  if (!existsSync(config.storageStatePath)) return false;
  const markerPath = loginVerificationMarkerPath(config.storageStatePath);
  if (!existsSync(markerPath)) return false;
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as Partial<LoginVerificationMarker>;
    return marker.version === 1 && marker.authenticated === true && typeof marker.verifiedAt === "string";
  } catch {
    return false;
  }
}

export async function checkBrowserEngine(config: AppConfig): Promise<void> {
  if (!existsSync(config.chromeExecutablePath)) throw new Error(`Google Chrome was not found at ${config.chromeExecutablePath}`);
  if (process.platform === "win32") {
    await runWorker("checkBrowserEngine", { chromeExecutablePath: config.chromeExecutablePath });
    return;
  }
  const browser = await chromium.launch({
    executablePath: config.chromeExecutablePath,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    if (await page.evaluate(() => document.readyState) !== "complete") throw new Error("Browser page did not reach complete state");
  } finally {
    await browser.close();
  }
}
