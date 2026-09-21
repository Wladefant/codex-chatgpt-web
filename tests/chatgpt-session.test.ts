import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import {
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_EFFORT_CONTROL_SELECTOR,
  CHATGPT_EFFORT_MENU_SELECTOR,
  CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR,
  CHATGPT_SEND_BUTTON_SELECTOR,
  CHATGPT_STOP_BUTTON_SELECTOR,
  activateChatGptEffortMenu,
  detectChatGptAccountCapabilities,
} from "../src/chatgpt-session";

test("composer and effort selectors exclude unrelated editable fields and menu buttons", () => {
  type DominoModule = { createDocument(html: string): Document };
  const domino: DominoModule = require("@mixmark-io/domino");
  const { createDocument } = domino;
  const document = createDocument(`<body><form>
    <div contenteditable="true" id="unrelated-editor"></div>
    <textarea placeholder="Search" id="search"></textarea>
    <button aria-haspopup="menu" id="attachments"></button>
    <div data-testid="prompt-textarea" id="composer-testid"></div>
    <div id="prompt-textarea"></div>
    <div contenteditable="true" data-lexical-editor="true" id="composer-lexical"></div>
    <div contenteditable="true" class="ProseMirror" id="composer-prosemirror"></div>
    <div contenteditable="true" data-composer-markdown="" id="composer-markdown"></div>
    <div contenteditable="true" role="textbox" id="composer-textbox"></div>
    <button aria-haspopup="menu" data-tone="neutral" id="effort"></button>
    <button aria-haspopup="menu" data-testid="model-switcher-dropdown-button" id="model"></button>
    <button type="button"
      class="no-drag cursor-interaction items-center select-none focus:outline-hidden disabled:cursor-default aria-disabled:cursor-default disabled:opacity-40 aria-disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 whitespace-nowrap flex gap-1.5 border-0 rounded-full text-tertiary not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover border-transparent h-(--spacing-token-button-composer) py-0 ps-3 pe-3.5 text-base leading-relaxed min-w-0"
      aria-label="Select ChatGPT model"
      id="radix-_r_3m_"
      aria-haspopup="menu"
      aria-expanded="false"
      data-state="closed"
      data-codex-intelligence-trigger="true"
      data-composer-navigation-target="reasoning"
      data-selected-reasoning-effort="medium"></button>
    <button data-testid="send-button" id="send-testid"></button>
    <button aria-label="Send" id="send-aria"></button>
    <button data-testid="stop-button" id="stop-testid"></button>
    <button aria-label="Stop generating" id="stop-aria"></button>
  </form></body>`);
  const matches = (selector: string) => Array.from(document.querySelectorAll(selector)).map(element => element.id);
  expect(matches(CHATGPT_COMPOSER_SELECTOR)).toEqual([
    "composer-testid",
    "prompt-textarea",
    "composer-lexical",
    "composer-prosemirror",
    "composer-markdown",
    "composer-textbox",
  ]);
  expect(matches(CHATGPT_EFFORT_CONTROL_SELECTOR)).toEqual(["effort", "model", "radix-_r_3m_"]);
  expect(matches(CHATGPT_SEND_BUTTON_SELECTOR)).toEqual(["send-testid", "send-aria"]);
  expect(matches(CHATGPT_STOP_BUTTON_SELECTOR)).toEqual(["stop-testid", "stop-aria"]);
});

test("effort activation binds the owned menu after the control opens", async () => {
  let opened = false;
  const ownedMenu = { isVisible: async () => opened };
  const hiddenSurface = {
    filter() { return this; },
    last() { return this; },
    locator() { return this; },
    isVisible: async () => false,
  };
  const control = {
    getAttribute: async (name: string) => {
      if (name === "aria-controls") return opened ? "radix-effort-menu" : null;
      if (name === "aria-expanded") return opened ? "true" : "false";
      if (name === "data-state") return opened ? "open" : "closed";
      return null;
    },
    click: async (options: unknown) => {
      expect(options).toEqual({ force: true, timeout: 1 });
      opened = true;
    },
  };
  const page = {
    locator: (selector: string) => {
      if (selector === '[id="radix-effort-menu"]') return ownedMenu;
      return hiddenSurface;
    },
    keyboard: { press: async () => {} },
  };

  const activation = await activateChatGptEffortMenu(page as never, control as never, { settleMs: 0 });
  expect(activation.method).toBe("click");
  expect(activation.menu).toBe(ownedMenu as never);
});

test("effort activation retries one ghost click with a primary pointerdown", async () => {
  let ghostOpen = false;
  let pointerOpened = false;
  const events: unknown[] = [];
  const ownedMenu = { isVisible: async () => pointerOpened };
  const hiddenSurface = {
    filter() { return this; },
    last() { return this; },
    locator() { return this; },
    isVisible: async () => false,
  };
  const control = {
    getAttribute: async (name: string) => {
      if (name === "aria-controls") return pointerOpened ? "radix-effort-menu" : null;
      if (name === "aria-expanded") return ghostOpen ? "true" : "false";
      if (name === "data-state") return ghostOpen ? "open" : "closed";
      return null;
    },
    click: async (options: unknown) => {
      events.push(["click", options]);
      ghostOpen = true;
    },
    dispatchEvent: async (name: string, detail: unknown) => {
      events.push([name, detail]);
      ghostOpen = true;
      pointerOpened = true;
    },
  };
  const page = {
    locator: (selector: string) => {
      if (selector === '[id="radix-effort-menu"]') return ownedMenu;
      return hiddenSurface;
    },
    keyboard: {
      press: async (key: string) => {
        events.push(["keyboard", key]);
        ghostOpen = false;
      },
    },
  };

  const activation = await activateChatGptEffortMenu(page as never, control as never, { settleMs: 0 });
  expect(activation.method).toBe("pointerdown");
  expect(activation.menu).toBe(ownedMenu as never);
  expect(events).toEqual([
    ["click", { force: true, timeout: 1 }],
    ["keyboard", "Escape"],
    ["pointerdown", { button: 0, buttons: 1, pointerType: "mouse", isPrimary: true }],
  ]);
});

test("effort activation fails closed when neither event exposes a structural surface", async () => {
  const hiddenSurface = {
    filter() { return this; },
    last() { return this; },
    locator() { return this; },
    isVisible: async () => false,
  };
  const control = {
    getAttribute: async () => null,
    click: async () => {},
    dispatchEvent: async () => {},
  };
  const page = {
    locator: () => hiddenSurface,
    keyboard: { press: async () => {} },
  };

  await expect(activateChatGptEffortMenu(page as never, control as never, { settleMs: 0 }))
    .rejects.toThrow("did not expose its owned menu or structural slider");
});

test("a complete authenticated composer with no effort selector is Luna-only", async () => {
  const effortButton = {
    last() { return this; },
    isVisible: async () => false,
  };
  const composerForm = {
    count: async () => 1,
    locator: () => effortButton,
  };
  const composer = {
    filter() { return this; },
    last() { return this; },
    count: async () => 1,
    isVisible: async () => true,
    locator: () => composerForm,
  };
  const page = {
    locator: () => composer,
    evaluate: async () => true,
  };

  await expect(detectChatGptAccountCapabilities(page as never, {
    selectorTimeoutMs: 100,
    stableAbsenceMs: 0,
  })).resolves.toEqual({ solAvailable: false, proAvailable: false });
});

test("a transient effort control does not turn a Luna-only account into Sol", async () => {
  let visibilityReads = 0;
  const effortButton = {
    last() { return this; },
    isVisible: async () => {
      visibilityReads += 1;
      return visibilityReads === 1;
    },
  };
  const composerForm = {
    count: async () => 1,
    locator: () => effortButton,
  };
  const composers = {
    filter() { return this; },
    last() { return this; },
    count: async () => 1,
    locator: () => composerForm,
  };
  const page = {
    locator: () => composers,
    evaluate: async () => true,
  };

  await expect(detectChatGptAccountCapabilities(page as never, {
    selectorTimeoutMs: 100,
    stableAbsenceMs: 0,
  })).resolves.toEqual({ solAvailable: false, proAvailable: false });
  expect(visibilityReads).toBe(2);
});

function reasoningPicker(options: { max?: string; delay?: number; missing?: boolean; selectedEffort?: string } = {}) {
  let value = 0;
  const keys: string[] = [];
  const hidden = {
    filter() { return this; }, last() { return this; }, getByText() { return this; },
    isVisible: async () => false,
    waitFor: ({ signal }: { signal: AbortSignal }) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  };
  const sliderControl = { press: async (key: string) => { keys.push(key); value += key === "ArrowRight" ? 1 : -1; } };
  const slider = {
    isVisible: async () => false, // Live DOM: aria-hidden=true, zero-width semantic span.
    filter: () => { throw new Error("Semantic input must not be visibility-filtered"); },
    waitFor: async ({ state }: { state: string }) => { expect(state).toBe("attached"); },
    getAttribute: async (name: string) => ({ "aria-valuemin": "0", "aria-valuemax": options.max ?? "4", "aria-valuenow": String(value), "aria-hidden": "true" })[name] ?? null,
    locator: () => sliderControl,
  };
  const container = {
    filter() { return this; }, last() { return this; },
    locator: () => slider,
    isVisible: async () => true,
    waitFor: async ({ state }: { state: string }) => {
      expect(state).toBe("visible");
      if (options.missing) throw new Error("effort container never hydrated");
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    },
  };
  const control = {
    last() { return this; }, waitFor: async () => {}, isVisible: async () => true,
    getAttribute: async (name: string) => {
      if (name === "aria-expanded") return "true";
      if (name === "data-selected-reasoning-effort") return options.selectedEffort ?? null;
      return null;
    },
  };
  const composer = { filter() { return this; }, last() { return this; }, locator: () => ({ locator: () => control }) };
  const modelRows = { count: async () => 3, first() { return this; }, waitFor: async () => {}, nth: () => { throw new Error("Model rows are not effort choices"); } };
  const menu = { filter() { return this; }, last() { return this; }, isVisible: async () => true, locator: () => modelRows };
  const page = {
    locator: (selector: string) => {
      if (selector === CHATGPT_COMPOSER_SELECTOR) return composer;
      if (selector === CHATGPT_EFFORT_MENU_SELECTOR) return menu;
      if (selector === CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR) return container;
      return hidden;
    },
    keyboard: { press: async () => {} },
  };
  return { page, composer, keys, value: () => value };
}

test.each([0, 50])("capabilities wait for the visible container and read its hidden semantic input (delay=%s)", async delay => {
  const fixture = reasoningPicker({ delay });
  await expect(detectChatGptAccountCapabilities(fixture.page as never)).resolves.toEqual({ solAvailable: true, proAvailable: true });
});

test("an absent effort slider cannot turn three model rows into a saved non-Pro capability", async () => {
  const fixture = reasoningPicker({ missing: true });
  await expect(detectChatGptAccountCapabilities(fixture.page as never)).rejects.toThrow("never hydrated");
});

test("the authoritative three-step range is non-Pro; a malformed range fails closed", async () => {
  await expect(detectChatGptAccountCapabilities(reasoningPicker({ max: "2" }).page as never)).resolves.toEqual({ solAvailable: true, proAvailable: false });
  await expect(detectChatGptAccountCapabilities(reasoningPicker({ max: "bad" }).page as never)).rejects.toThrow("model controls are unavailable");
});

test("Pro selection changes the hidden slider through its visible owner, never through model rows", async () => {
  const fixture = reasoningPicker({ delay: 50 });
  type WorkerSelectPrototype = {
    selectModelAndEffort(...args: unknown[]): Promise<unknown>;
  };
  const workerProto: WorkerSelectPrototype = ChatGptBrowserWorker.prototype as never;
  const select = workerProto.selectModelAndEffort;
  await select.call({ activeComposer: async () => fixture.composer }, fixture.page, "gpt-5.6-sol", "max", { localToolsEnabled: false, solAvailable: true, proAvailable: true });
  expect(fixture.keys).toEqual(["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight"]);
  expect(fixture.value()).toBe(4);
});

test("effort control selector matches both issue #9 updated DOM and legacy buttons", () => {
  type DominoModule = { createDocument(html: string): Document };
  const domino: DominoModule = require("@mixmark-io/domino");
  const document = domino.createDocument(`<body><form>
    <!-- Old selectors -->
    <button aria-haspopup="menu" data-tone="neutral" id="legacy-tone"></button>
    <button aria-haspopup="menu" data-testid="model-switcher-dropdown-button" id="legacy-testid"></button>
    <!-- Issue #9 updated reasoning button -->
    <button type="button"
      class="no-drag cursor-interaction items-center select-none focus:outline-hidden disabled:cursor-default aria-disabled:cursor-default disabled:opacity-40 aria-disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 whitespace-nowrap flex gap-1.5 border-0 rounded-full text-tertiary not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover border-transparent h-(--spacing-token-button-composer) py-0 ps-3 pe-3.5 text-base leading-relaxed min-w-0"
      aria-label="Select ChatGPT model"
      id="issue-9-reasoning-btn"
      aria-haspopup="menu"
      aria-expanded="false"
      data-state="closed"
      data-codex-intelligence-trigger="true"
      data-composer-navigation-target="reasoning"
      data-selected-reasoning-effort="medium"></button>
    <!-- Unrelated menu button that should be excluded -->
    <button aria-haspopup="menu" id="attachments-menu"></button>
  </form></body>`);
  const matches = (selector: string) => Array.from(document.querySelectorAll(selector)).map(element => element.id);
  expect(matches(CHATGPT_EFFORT_CONTROL_SELECTOR)).toEqual([
    "legacy-tone",
    "legacy-testid",
    "issue-9-reasoning-btn",
  ]);
});

test("selectModelAndEffort short-circuits when data-selected-reasoning-effort matches requested effort", async () => {
  const fixture = reasoningPicker({ selectedEffort: "medium" });
  type WorkerSelectPrototype = {
    selectModelAndEffort(...args: unknown[]): Promise<{ effort: string }>;
  };
  const workerProto: WorkerSelectPrototype = ChatGptBrowserWorker.prototype as never;
  const select = workerProto.selectModelAndEffort;
  const diagnostics: string[] = [];
  const result = await select.call(
    { activeComposer: async () => fixture.composer },
    fixture.page,
    "gpt-5.6-sol",
    "medium",
    { localToolsEnabled: false, solAvailable: true, proAvailable: true },
    async (checkpoint: string) => { diagnostics.push(checkpoint); },
  );
  expect(result.effort).toBe("medium");
  expect(diagnostics).toContain("effort-already-selected");
  expect(diagnostics).toContain("effort-selected");
  expect(fixture.keys).toEqual([]);
  expect(fixture.value()).toBe(0);
});

test("selectModelAndEffort proceeds to slider when data-selected-reasoning-effort differs from requested effort", async () => {
  const fixture = reasoningPicker({ selectedEffort: "low" });
  type WorkerSelectPrototype = {
    selectModelAndEffort(...args: unknown[]): Promise<{ effort: string }>;
  };
  const workerProto: WorkerSelectPrototype = ChatGptBrowserWorker.prototype as never;
  const select = workerProto.selectModelAndEffort;
  const diagnostics: string[] = [];
  const result = await select.call(
    { activeComposer: async () => fixture.composer },
    fixture.page,
    "gpt-5.6-sol",
    "medium",
    { localToolsEnabled: false, solAvailable: true, proAvailable: true },
    async (checkpoint: string) => { diagnostics.push(checkpoint); },
  );
  expect(result.effort).toBe("medium");
  expect(diagnostics).not.toContain("effort-already-selected");
  expect(diagnostics).toContain("effort-selected");
  expect(fixture.keys).toEqual(["ArrowRight"]);
  expect(fixture.value()).toBe(1);
});
