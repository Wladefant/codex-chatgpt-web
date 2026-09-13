import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packageBrowserSupport } from "../scripts/package-browser-support";

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
