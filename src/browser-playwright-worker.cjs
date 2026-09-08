const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CHATGPT_TEMPORARY_CHAT_URL = "https://chatgpt.com/?temporary-chat=true";
const CHATGPT_COMPOSER_SELECTOR = [
  '[data-testid="prompt-textarea"]',
  "#prompt-textarea",
  '[contenteditable="true"][data-lexical-editor="true"]',
].join(", ");
const CHATGPT_EFFORT_CONTROL_SELECTOR = [
  'button[aria-haspopup="menu"][data-tone="neutral"]',
  'button[data-testid="model-switcher-dropdown-button"][aria-haspopup="menu"]',
].join(", ");
const CHATGPT_EFFORT_MENU_SELECTOR = [
  '[data-testid="composer-intelligence-picker-content"]:has([role="menuitemradio"], [data-model-reasoning-effort-slider])',
  '[role="menu"]:has([role="menuitemradio"], [data-model-reasoning-effort-slider])',
  '[role="group"]:has([role="menuitemradio"], [data-model-reasoning-effort-slider])',
].join(", ");
const CHATGPT_EFFORT_ITEM_SELECTOR = '[role="menuitemradio"]';
const CHATGPT_EFFORT_SLIDER_SELECTOR = '[data-model-reasoning-effort-slider] [role="slider"]';

function clearLocks(dir) {
  const locks = ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"];
  for (const name of locks) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      try { fs.rmSync(p, { force: true }); } catch {}
    }
  }
}

async function detectCapabilities(page) {
  const effortButton = page.locator(CHATGPT_EFFORT_CONTROL_SELECTOR).last();
  const effortVisible = await effortButton.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  let solAvailable = false;
  let proAvailable = false;
  if (effortVisible) {
    solAvailable = true;
    const menu = page.locator(CHATGPT_EFFORT_MENU_SELECTOR).last();
    const menuVisible = await menu.isVisible().catch(() => false);
    if (!menuVisible) await effortButton.press("Enter").catch(() => {});
    const efforts = menu.locator(CHATGPT_EFFORT_ITEM_SELECTOR);
    const slider = page.locator(CHATGPT_EFFORT_SLIDER_SELECTOR).filter({ visible: true }).last();
    const sliderVisible = await slider.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
    if (!sliderVisible) {
      proAvailable = (await efforts.count().catch(() => 0)) >= 5;
    } else {
      const min = Number(await slider.getAttribute("aria-valuemin"));
      const max = Number(await slider.getAttribute("aria-valuemax"));
      proAvailable = (max - min + 1) >= 5;
    }
    await page.keyboard.press("Escape").catch(() => {});
  }
  return { solAvailable, proAvailable, url: page.url() };
}

async function verifyWithBrowser(chromeExecutablePath, storageState, timeoutMs = 60000) {
  const ignoreDefaultArgs = process.platform === "win32"
    ? ["--no-sandbox", "--password-store=basic", "--use-mock-keychain"]
    : ["--password-store=basic", "--use-mock-keychain"];

  let lastError;
  for (const headless of [true, false]) {
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: chromeExecutablePath,
        headless,
        ignoreDefaultArgs,
        args: [
          "--no-first-run",
          "--no-default-browser-check",
          ...(headless ? ["--disable-blink-features=AutomationControlled"] : []),
        ],
        timeout: timeoutMs,
      });

      const context = await browser.newContext({
        storageState,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      });
      try {
        const page = await context.newPage();
        await page.goto(CHATGPT_TEMPORARY_CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
        const composer = page.locator(CHATGPT_COMPOSER_SELECTOR).first();
        await composer.waitFor({ state: "visible", timeout: headless ? 20000 : timeoutMs });

        const capabilities = await detectCapabilities(page);
        return capabilities;
      } finally {
        await context.close();
      }
    } catch (err) {
      lastError = err;
      if (!headless) throw err;
    } finally {
      if (browser) await browser.close();
    }
  }
  throw lastError;
}

async function extractAndVerify(params) {
  const { profileDir, chromeExecutablePath, timeoutMs = 60000 } = params;
  const copyDir = path.join(os.tmpdir(), "codex-login-copy-" + Date.now());
  fs.cpSync(profileDir, copyDir, { recursive: true });
  clearLocks(copyDir);

  const ignoreDefaultArgs = process.platform === "win32"
    ? ["--no-sandbox", "--password-store=basic", "--use-mock-keychain"]
    : ["--password-store=basic", "--use-mock-keychain"];

  let state;
  try {
    const context = await chromium.launchPersistentContext(copyDir, {
      executablePath: chromeExecutablePath,
      headless: true,
      ignoreDefaultArgs,
      args: ["--no-first-run", "--no-default-browser-check"],
      timeout: timeoutMs,
    });
    try {
      state = await context.storageState();
    } finally {
      await context.close();
    }
  } finally {
    fs.rmSync(copyDir, { recursive: true, force: true });
  }

  const inspected = await verifyWithBrowser(chromeExecutablePath, state, timeoutMs);
  return { state, inspected };
}

async function inspectStoredState(params) {
  const { storageState, chromeExecutablePath, timeoutMs = 60000 } = params;
  return await verifyWithBrowser(chromeExecutablePath, storageState, timeoutMs);
}

async function checkBrowserEngine(params) {
  const { chromeExecutablePath } = params;
  const ignoreDefaultArgs = process.platform === "win32"
    ? ["--no-sandbox", "--password-store=basic", "--use-mock-keychain"]
    : ["--password-store=basic", "--use-mock-keychain"];
  const browser = await chromium.launch({
    executablePath: chromeExecutablePath,
    headless: true,
    ignoreDefaultArgs,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    if (await page.evaluate(() => document.readyState) !== "complete") {
      throw new Error("Browser page did not reach complete state");
    }
    return { ok: true };
  } finally {
    await browser.close();
  }
}

async function main() {
  const inputChunks = [];
  for await (const chunk of process.stdin) {
    inputChunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(inputChunks).toString("utf8"));
  let result;
  if (input.action === "extractAndVerify") {
    result = await extractAndVerify(input.params);
  } else if (input.action === "inspectStoredState") {
    result = await inspectStoredState(input.params);
  } else if (input.action === "checkBrowserEngine") {
    result = await checkBrowserEngine(input.params);
  } else {
    throw new Error(`Unknown action: ${input.action}`);
  }
  process.stdout.write(JSON.stringify({ ok: true, result }) + "\n");
}

main().catch(err => {
  process.stdout.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) + "\n");
  process.exit(1);
});
