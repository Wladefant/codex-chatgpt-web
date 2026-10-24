import { expect, test } from "bun:test";
import { ChatGptBrowserWorker, serializeChatGptDiagnosticError } from "../src/adapters/chatgpt-web/browser-worker";

test("effort selection chooses High from the captured three-radio menu without a slider", async () => {
  const state = { open: false, selected: "Medium" };
  const radios = ["Low", "Medium", "High"].map(name => ({
    name,
    getAttribute: async (attribute: string) => attribute === "aria-checked" ? String(state.selected === name) : null,
    click: async () => { state.selected = name; },
  }));
  const radioList = {
    count: async () => radios.length,
    nth: (index: number) => radios[index],
    filter() { return this; },
    getByRole: () => radioList,
  };
  const menu = {
    last() { return this; },
    isVisible: async () => state.open,
    filter() { return this; },
    locator: () => radioList,
    getByRole: () => radioList,
  };
  const slider = {
    filter() { return this; },
    last() { return this; },
    locator() { return this; },
    isVisible: async () => false,
    waitFor: async () => { throw new Error("no slider in captured radio-only DOM"); },
  };
  const hiddenDialog = {
    filter() { return this; },
    last() { return this; },
    isVisible: async () => false,
    waitFor: async () => new Promise<void>(() => {}),
  };
  const control = {
    last() { return this; },
    first() { return this; },
    filter() { return this; },
    count: async () => 1,
    waitFor: async () => {},
    getAttribute: async (attribute: string) => {
      if (attribute === "aria-expanded") return String(state.open);
      if (attribute === "data-selected-reasoning-effort") return state.selected.toLowerCase();
      return null;
    },
    click: async () => { state.open = true; },
    dispatchEvent: async () => { state.open = true; },
    innerText: async () => state.selected,
  };
  const composerForm = { locator: () => control };
  const composer = { locator: () => composerForm, isEditable: async () => true };
  const page = {
    locator: (selector: string) => {
      if (selector === '[data-model-reasoning-effort-slider]' || selector.includes('[role="slider"]')) return slider;
      if (selector.includes('[role="dialog"]') || selector.includes('[role="alert"]')) return hiddenDialog;
      if (selector.includes("menuitemradio") || selector.includes('[role="menu"]')) return menu;
      return menu;
    },
    keyboard: { press: async (key: string) => { if (key === "Escape") state.open = false; } },
    url: () => "https://chatgpt.com/?temporary-chat=true",
  };
  const worker = Object.create(ChatGptBrowserWorker.prototype) as ChatGptBrowserWorker;
  const selectModelAndEffort = (ChatGptBrowserWorker.prototype as unknown as {
    selectModelAndEffort(
      page: unknown,
      modelId: string,
      reasoning: string,
      capabilities: { localToolsEnabled: boolean; solAvailable: boolean; extraHighAvailable: boolean; proAvailable: boolean },
    ): Promise<unknown>;
  }).selectModelAndEffort;
  Object.defineProperty(worker, "activeComposer", { value: async () => composer });

  const result = await selectModelAndEffort.call(worker, page, "gpt-5.6-sol", "high", {
    localToolsEnabled: true,
    solAvailable: true,
    extraHighAvailable: true,
    proAvailable: true,
  }).catch(error => error);

  expect(result).toMatchObject({ effort: "high", selection: { label: "High" } });
  expect(state.selected).toBe("High");
});
test("diagnostic causes preserve a bounded redacted error chain", () => {
  const cause = new Error(
    "effort slider failed <codex_context_json>private prompt</codex_context_json> turn_abcdefghijklmnop",
    { cause: new Error("nested failure", { cause: new Error("third", { cause: new Error("fourth", { cause: new Error("fifth") }) }) }) },
  );
  const record = serializeChatGptDiagnosticError(new Error("model controls unavailable", { cause }));

  expect(JSON.stringify(record)).not.toContain("private prompt");
  expect(JSON.stringify(record)).not.toContain("turn_abcdefghijklmnop");
  expect(record).toEqual({
    error: "model controls unavailable",
    cause: [
      { name: "Error", message: "effort slider failed <codex_context_json>[redacted]</codex_context_json> turn_[redacted]" },
      { name: "Error", message: "nested failure" },
      { name: "Error", message: "third" },
      { name: "Error", message: "fourth" },
    ],
  });
  expect(record?.cause).toHaveLength(4);
  expect(serializeChatGptDiagnosticError(new Error("x".repeat(800), { cause: new Error("y".repeat(800)) }))?.cause?.[0]?.message).toHaveLength(500);
  expect(serializeChatGptDiagnosticError({ secret: "do not persist" })).toEqual({ error: "[object Object]" });
});
