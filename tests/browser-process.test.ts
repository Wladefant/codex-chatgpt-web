// Native integration: child-process deadlines and Windows job teardown use the OS clock.
// Fake timers cannot drive kernel process exit or timers in the independent Node child.
import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserNodeExecutable, runBrowserWorker, spawnBrowserProcess, stopBrowserProcess } from "../src/browser-process";

async function eventually(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Process cleanup deadline exceeded");
    await Bun.sleep(25);
  }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const windowsTest = process.platform === "win32" ? test : test.skip;
windowsTest("worker deadline terminates the entire owned tree repeatedly", async () => {
  const root = mkdtempSync(join(tmpdir(), "browser-job-timeout-"));
  const grandchild = join(root, "grandchild.cjs");
  const helper = join(root, "helper.cjs");
  const receipt = join(root, "pids.json");
  writeFileSync(grandchild, "setInterval(() => {}, 1000);");
  writeFileSync(helper, `
    const child = require('node:child_process').spawn(process.execPath, [${JSON.stringify(grandchild)}], {stdio:'ignore'});
    require('node:fs').writeFileSync(${JSON.stringify(receipt)}, JSON.stringify([process.pid, child.pid]));
    setInterval(() => {}, 1000);
  `);
  try {
    for (let round = 0; round < 3; round++) {
      const started = Date.now();
      await expect(runBrowserWorker(helper, "hang", {}, 3_000)).rejects.toThrow("timed out after 3000ms");
      // Includes synchronous Windows process creation under host load, before the timer is armed.
      expect(Date.now() - started).toBeLessThan(12_000);
      const pids = JSON.parse(readFileSync(receipt, "utf8")) as number[];
      await eventually(() => pids.every(pid => !alive(pid)));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

windowsTest("parent death and root-helper death leave no child or grandchild", async () => {
  const root = mkdtempSync(join(tmpdir(), "browser-job-parent-"));
  const helper = join(root, "helper.cjs"), descendant = join(root, "descendant.cjs");
  const receipt = join(root, "pids.json"), ownerScript = join(root, "owner.ts");
  writeFileSync(descendant, "setInterval(() => {}, 1000);");
  writeFileSync(helper, `
    const child = require('node:child_process').spawn(process.execPath, [${JSON.stringify(descendant)}], {stdio:'ignore'});
    require('node:fs').writeFileSync(${JSON.stringify(receipt)}, JSON.stringify([process.pid, child.pid]));
    setInterval(() => {}, 1000);
  `);
  writeFileSync(ownerScript, `
    import {spawnBrowserProcess, browserNodeExecutable} from ${JSON.stringify(new URL("../src/browser-process.ts", import.meta.url).href)};
    const child = spawnBrowserProcess(browserNodeExecutable(), [${JSON.stringify(helper)}]);
    child.stdout.resume(); child.stderr.pipe(process.stderr);
    child.on('error', error => console.error(error));
    setInterval(() => {}, 1000);
  `);
  try {
    for (const failure of ["parent", "helper"] as const) {
      rmSync(receipt, { force: true });
      const owner = spawn(process.execPath, [ownerScript], { stdio: ["ignore", "ignore", "pipe"] });
      owner.stderr.on("data", chunk => console.error(chunk.toString()));
      let pids: number[] = [];
      try {
        await eventually(() => { try { pids = JSON.parse(readFileSync(receipt, "utf8")); return true; } catch { return false; } });
        if (failure === "parent") owner.kill("SIGKILL");
        else process.kill(pids[0]!, "SIGKILL");
        await eventually(() => pids.every(pid => !alive(pid)));
        expect(pids.every(pid => !alive(pid))).toBe(true);
      } finally {
        owner.kill("SIGKILL");
        await eventually(() => owner.exitCode !== null || owner.signalCode !== null);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

windowsTest("supervisor preserves quoted paths, protocol result and nonzero worker error", async () => {
  const root = mkdtempSync(join(tmpdir(), "browser job spaces-"));
  const helper = join(root, "reply.cjs");
  try {
    writeFileSync(helper, "process.stdout.write(JSON.stringify({ok:true,result:42}));");
    expect(await runBrowserWorker<number>(helper, "reply", {})).toBe(42);
    writeFileSync(helper, "process.stdout.write(JSON.stringify({ok:false,error:'deliberate failure'})); process.exitCode=1;");
    await expect(runBrowserWorker(helper, "refuse", {})).rejects.toThrow("deliberate failure");
    const child = spawnBrowserProcess(browserNodeExecutable(), [join(root, "missing.cjs")]);
    child.stdout.resume(); child.stderr.resume(); child.stdin.on("error", () => {});
    await eventually(() => child.exitCode !== null);
    expect(child.exitCode).not.toBe(0);
    await stopBrowserProcess(child);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
