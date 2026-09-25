import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
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

(process.platform === "win32" ? test : test.skip)("resolveNodeLicense bounds lookup to selected Node install and does not select unrelated ambient parent license", () => {
  const output = mkdtempSync(join(tmpdir(), "browser-runtime-ambient-"));
  try {
    const parentDir = join(output, "product");
    const installDir = join(parentDir, "install");
    mkdirSync(installDir, { recursive: true });

    const fakeNode = join(installDir, "node.exe");
    copyFileSync(browserNodeExecutable(), fakeNode);

    // An unrelated LICENSE file in the parent directory of installDir
    const unrelatedLicense = join(parentDir, "LICENSE");
    writeFileSync(unrelatedLicense, "MIT License - Unrelated Product");

    // With an empty repository root (no LICENSES/ fallback):
    // Must NOT select the ambient parent license, but throw listing expected paths without parent license.
    const emptyRepo = join(output, "empty-repo");
    mkdirSync(emptyRepo, { recursive: true });

    let error: Error | undefined;
    try {
      resolveNodeLicense(fakeNode, emptyRepo);
    } catch (err) {
      error = err as Error;
    }
    expect(error).toBeDefined();
    expect(error?.message).toContain("Node.js distribution LICENSE is required");
    expect(error?.message).not.toContain(unrelatedLicense);

    // With the real repository root:
    // Must NOT select the ambient parent license; should resolve to the repository fallback.
    const root = resolve(import.meta.dir, "..");
    const resolved = resolveNodeLicense(fakeNode, root);
    expect(resolved).not.toBe(unrelatedLicense);
    const nodeMajor = spawnSync(fakeNode, ["--version"], { encoding: "utf8" }).stdout.trim().match(/^v(\d+)/)?.[1];
    const expectedLicense = nodeMajor && existsSync(join(root, "LICENSES", `Node-${nodeMajor}-LICENSE.txt`))
      ? join(root, "LICENSES", `Node-${nodeMajor}-LICENSE.txt`)
      : join(root, "LICENSES", "Node-LICENSE.txt");
    expect(resolved).toBe(expectedLicense);

    // When node is in a bin/ subfolder, its installation root (parent directory) is searched:
    const binDir = join(output, "node-install", "bin");
    mkdirSync(binDir, { recursive: true });
    copyFileSync(browserNodeExecutable(), join(binDir, "node.exe"));
    const installRootLicense = join(output, "node-install", "LICENSE");
    writeFileSync(installRootLicense, "Node License in installation root");
    const binResolved = resolveNodeLicense(join(binDir, "node.exe"), emptyRepo);
    expect(binResolved).toBe(installRootLicense);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
