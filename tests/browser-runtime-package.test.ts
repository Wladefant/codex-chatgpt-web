import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { browserNodeExecutable } from "../src/browser-process";
import { packageBrowserSupport, resolveNodeLicense } from "../scripts/package-browser-support";

// Native packaged-process integration: subprocess execution cannot use fake timers.
(process.platform === "win32" ? test : test.skip)("Windows bundle supplies its worker, Node, license and job without PATH Node", async () => {
  const output = mkdtempSync(join(tmpdir(), "browser-runtime-package-"));
  const app = join(output, "app"), runtime = join(output, "runtime");
  try {
    packageBrowserSupport(resolve(import.meta.dir, ".."), app, runtime);
    for (const asset of [join(app, "browser-playwright-worker.cjs"), join(runtime, "node.exe"), join(runtime, "NODE-LICENSE.txt"), join(runtime, "browser-process-job.exe")]) {
      expect(existsSync(asset)).toBe(true);
    }
    const entry = join(output, "entry.ts");
    const worker = join(app, "fixture.cjs");
    writeFileSync(worker, "process.stdout.write(JSON.stringify({ok:true,result:process.versions.node}));");
    writeFileSync(entry, `
      import {runBrowserWorker} from ${JSON.stringify(join(resolve(import.meta.dir, ".."), "src", "browser-process.ts"))};
      console.log(await runBrowserWorker(${JSON.stringify(worker)}, 'packaged', {}));
    `);
    const build = await Bun.build({ entrypoints: [entry], target: "bun", outdir: app, naming: "cli.js" });
    expect(build.success).toBe(true);
    const process = Bun.spawn([Bun.argv[0]!, join(app, "cli.js")], {
      env: { ...globalThis.process.env, PATH: "", Path: "" }, stdout: "pipe", stderr: "pipe",
      timeout: 10_000,
    });
    const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  } finally { rmSync(output, { recursive: true, force: true }); }
}, 30_000);
(process.platform === "win32" ? test : test.skip)("Windows packaging resolves Node license when node.exe has no sibling LICENSE (shim layout)", async () => {
  const root = resolve(import.meta.dir, "..");
  const output = mkdtempSync(join(tmpdir(), "browser-runtime-shim-"));
  const shimDir = join(output, "shim-bin");
  const app = join(output, "app"), runtime = join(output, "runtime");
  mkdirSync(shimDir, { recursive: true });

  const systemNode = browserNodeExecutable();
  copyFileSync(systemNode, join(shimDir, "node.exe"));

  const originalPath = process.env.PATH ?? "";
  const originalPathEnv = process.env.Path ?? "";
  const shimmedPath = `${shimDir};${originalPath}`;

  try {
    process.env.PATH = shimmedPath;
    process.env.Path = shimmedPath;

    expect(browserNodeExecutable()).toBe(join(shimDir, "node.exe"));
    expect(existsSync(join(shimDir, "LICENSE"))).toBe(false);
    expect(existsSync(join(output, "LICENSE"))).toBe(false);

    packageBrowserSupport(root, app, runtime);

    for (const asset of [join(app, "browser-playwright-worker.cjs"), join(runtime, "node.exe"), join(runtime, "NODE-LICENSE.txt"), join(runtime, "browser-process-job.exe")]) {
      expect(existsSync(asset)).toBe(true);
    }
    const licenseText = readFileSync(join(runtime, "NODE-LICENSE.txt"), "utf8");
    expect(licenseText).toContain("Node.js is licensed for use as follows:");

    const entry = join(output, "entry.ts");
    const worker = join(app, "fixture.cjs");
    writeFileSync(worker, "process.stdout.write(JSON.stringify({ok:true,result:process.versions.node}));");
    writeFileSync(entry, `
      import {runBrowserWorker} from ${JSON.stringify(join(root, "src", "browser-process.ts"))};
      console.log(await runBrowserWorker(${JSON.stringify(worker)}, 'packaged', {}));
    `);
    const build = await Bun.build({ entrypoints: [entry], target: "bun", outdir: app, naming: "cli.js" });
    expect(build.success).toBe(true);
    const proc = Bun.spawn([Bun.argv[0]!, join(app, "cli.js")], {
      env: { ...globalThis.process.env, PATH: "", Path: "" }, stdout: "pipe", stderr: "pipe",
      timeout: 10_000,
    });
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  } finally {
    process.env.PATH = originalPath;
    process.env.Path = originalPathEnv;
    rmSync(output, { recursive: true, force: true });
  }
}, 30_000);

(process.platform === "win32" ? test : test.skip)("resolveNodeLicense fails with a clear message naming expected paths when no license is found", () => {
  const output = mkdtempSync(join(tmpdir(), "browser-runtime-nolic-"));
  try {
    const fakeNode = join(output, "node.exe");
    copyFileSync(browserNodeExecutable(), fakeNode);
    const emptyRoot = join(output, "empty-repo");
    mkdirSync(emptyRoot, { recursive: true });

    let error: Error | undefined;
    try {
      resolveNodeLicense(fakeNode, emptyRoot);
    } catch (err) {
      error = err as Error;
    }
    expect(error).toBeDefined();
    expect(error?.message).toContain("Node.js distribution LICENSE is required for Windows packaging, but was not found");
    expect(error?.message).toContain(join(output, "LICENSE"));
    expect(error?.message).toContain(join(emptyRoot, "LICENSES", "Node-LICENSE.txt"));
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
