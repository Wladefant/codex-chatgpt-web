import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { browserNodeExecutable, buildWindowsProcessJob } from "../src/browser-process";

export function packageBrowserSupport(root: string, appDir: string, runtimeDir: string): void {
  mkdirSync(appDir, { recursive: true });
  copyFileSync(join(root, "src", "browser-playwright-worker.cjs"), join(appDir, "browser-playwright-worker.cjs"));
  if (process.platform !== "win32") return;
  mkdirSync(runtimeDir, { recursive: true });
  const node = browserNodeExecutable();
  const version = spawnSync(node, ["--version"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  if (version.status !== 0 || !/^v(?:2[2-9]|[3-9]\d)\./.test(version.stdout.trim())) {
    throw new Error("Windows packaging requires Node.js 22 or newer");
  }
  const license = join(dirname(node), "LICENSE");
  if (!existsSync(license)) throw new Error("Node.js distribution LICENSE is required beside node.exe for packaging");
  copyFileSync(node, join(runtimeDir, "node.exe"));
  copyFileSync(license, join(runtimeDir, "NODE-LICENSE.txt"));
  buildWindowsProcessJob(join(root, "src", "windows-process-job.cs"), join(runtimeDir, "browser-process-job.exe"));
}
