import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(await readFile(new URL("./wrangler.jsonc", import.meta.url), "utf8"));
const workerSource = await readFile(new URL("./worker.js", import.meta.url), "utf8");

test("CI Worker has no product traffic or runtime bindings", () => {
  assert.equal(config.name, "codex-chatgpt-web-ci");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.deepEqual(config.bindings ?? [], []);
  assert.equal(config.compatibility_date, "2025-01-23");
});

test("CI Worker is a static non-product 404", async () => {
  const worker = await import(`data:text/javascript,${encodeURIComponent(workerSource)}`);
  const response = await worker.default.fetch(new Request("https://worker.invalid/"));
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not found");
});
