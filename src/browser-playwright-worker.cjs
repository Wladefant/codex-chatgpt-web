const { chromium } = require("playwright-core");

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
  const browser = await chromium.launch({
    executablePath: chromeExecutablePath,
    headless: true,
    ignoreDefaultArgs: process.platform === "win32"
      ? ["--no-sandbox", "--password-store=basic", "--use-mock-keychain"]
      : ["--password-store=basic", "--use-mock-keychain"],
    args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
    timeout: timeoutMs,
  });
  try {
    const context = await browser.newContext({
      storageState,
      ...(process.platform === "win32" ? {
        userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
      } : {}),
    });
    const page = await context.newPage();
    await page.goto(CHATGPT_TEMPORARY_CHAT_URL, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.locator(CHATGPT_COMPOSER_SELECTOR).first().waitFor({ state: "visible", timeout: timeoutMs });
    return await detectCapabilities(page);
  } finally {
    await browser.close();
  }
}

async function extractAndVerify(params) {
  const { profileDir, chromeExecutablePath, timeoutMs = 60000 } = params;
  // The owned login browser has exited. Open that profile directly; Chrome arbitrates
  // its own locks. Never copy a live profile, remove its locks, or kill a name match.
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromeExecutablePath,
    headless: true,
    ignoreDefaultArgs: process.platform === "win32"
      ? ["--no-sandbox", "--password-store=basic", "--use-mock-keychain"]
      : ["--password-store=basic", "--use-mock-keychain"],
    args: ["--no-first-run", "--no-default-browser-check"],
    timeout: timeoutMs,
  });
  let state;
  try {
    state = await context.storageState();
  } finally {
    await context.close();
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
