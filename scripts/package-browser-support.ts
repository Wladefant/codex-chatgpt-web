import { copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
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
  const license = resolveNodeLicense(node, root);
  copyFileSync(node, join(runtimeDir, "node.exe"));
  copyFileSync(license, join(runtimeDir, "NODE-LICENSE.txt"));
  buildWindowsProcessJob(join(root, "src", "windows-process-job.cs"), join(runtimeDir, "browser-process-job.exe"));
}
export function resolveNodeLicense(node: string, root: string): string {
  const searched: string[] = [];

  // 1. Sibling to node executable (e.g. C:\Program Files\nodejs\LICENSE)
  const nodeDir = dirname(node);
  const sibling = join(nodeDir, "LICENSE");
  searched.push(sibling);
  if (existsSync(sibling)) return sibling;
  const siblingTxt = join(nodeDir, "LICENSE.txt");
  searched.push(siblingTxt);
  if (existsSync(siblingTxt)) return siblingTxt;

  // 2. Node installation root (parent directory if node.exe is in bin/ or subfolder)
  const nodeParent = dirname(nodeDir);
  const parentLicense = join(nodeParent, "LICENSE");
  searched.push(parentLicense);
  if (existsSync(parentLicense)) return parentLicense;
  const parentLicenseTxt = join(nodeParent, "LICENSE.txt");
  searched.push(parentLicenseTxt);
  if (existsSync(parentLicenseTxt)) return parentLicenseTxt;

  // 3. Symlink / shim target (e.g. fnm/volta/scoop shims pointing to real install)
  try {
    const realNode = realpathSync(node);
    if (realNode !== node) {
      const realDir = dirname(realNode);
      const realSibling = join(realDir, "LICENSE");
      searched.push(realSibling);
      if (existsSync(realSibling)) return realSibling;
      const realSiblingTxt = join(realDir, "LICENSE.txt");
      searched.push(realSiblingTxt);
      if (existsSync(realSiblingTxt)) return realSiblingTxt;

      const realParent = dirname(realDir);
      const realParentLicense = join(realParent, "LICENSE");
      searched.push(realParentLicense);
      if (existsSync(realParentLicense)) return realParentLicense;
      const realParentLicenseTxt = join(realParent, "LICENSE.txt");
      searched.push(realParentLicenseTxt);
      if (existsSync(realParentLicenseTxt)) return realParentLicenseTxt;
    }
  } catch {
    // Ignore realpath errors
  }

  // 4. process.execPath installation root (if packaging is running under Node)
  if (process.execPath) {
    const execDir = dirname(process.execPath);
    const execSibling = join(execDir, "LICENSE");
    searched.push(execSibling);
    if (existsSync(execSibling)) return execSibling;
    const execSiblingTxt = join(execDir, "LICENSE.txt");
    searched.push(execSiblingTxt);
    if (existsSync(execSiblingTxt)) return execSiblingTxt;

    const execParent = dirname(execDir);
    const execParentLicense = join(execParent, "LICENSE");
    searched.push(execParentLicense);
    if (existsSync(execParentLicense)) return execParentLicense;
    const execParentLicenseTxt = join(execParent, "LICENSE.txt");
    searched.push(execParentLicenseTxt);
    if (existsSync(execParentLicenseTxt)) return execParentLicenseTxt;
  }

  // 5. Version-matched copy shipped in the repository (LICENSES/ directory)
  const version = spawnSync(node, ["--version"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  const versionString = version.status === 0 ? version.stdout.trim() : "";
  const match = versionString.match(/^v(\d+)/);
  const major = match ? match[1] : undefined;

  const repoCandidates: string[] = [];
  if (major) {
    repoCandidates.push(
      join(root, "LICENSES", `Node-${major}-LICENSE.txt`),
      join(root, "LICENSES", `node-v${major}-LICENSE.txt`),
      join(root, "LICENSES", `Node-v${major}-LICENSE.txt`),
    );
  }
  repoCandidates.push(
    join(root, "LICENSES", "Node-LICENSE.txt"),
    join(root, "LICENSES", "NODE-LICENSE.txt"),
  );

  for (const candidate of repoCandidates) {
    searched.push(candidate);
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Node.js distribution LICENSE is required for Windows packaging, but was not found in any expected location:\n` +
      [...new Set(searched)].map((p) => `  - ${p}`).join("\n") +
      `\nEnsure Node.js includes a LICENSE beside node.exe or in its installation root, or provide a version-matched LICENSE in LICENSES/.`
  );
}

