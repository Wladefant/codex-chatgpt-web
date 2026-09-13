import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const packagedApp = () => basename(process.argv[1] ?? "") === "cli.js" ? dirname(resolve(process.argv[1]!)) : undefined;

export function browserNodeExecutable(): string {
  const app = packagedApp();
  if (app && process.platform === "win32") {
    const executable = resolve(app, "..", "runtime", "node.exe");
    if (!existsSync(executable)) throw new Error("Packaged browser Node runtime is missing; reinstall the runtime bundle");
    return executable;
  }
  if (!process.versions.bun && !process.versions.electron) return process.execPath;
  const name = process.platform === "win32" ? "node.exe" : "node";
  for (const directory of (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")) {
    const candidate = join(directory, name);
    if (isAbsolute(candidate) && existsSync(candidate)) return candidate;
  }
  throw new Error("Source browser workers require Node.js on PATH; Windows runtime bundles include Node.js");
}

export function buildWindowsProcessJob(source: string, output: string): void {
  const compiler = join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.exe`;
  try {
    const result = spawnSync(compiler, ["/nologo", "/target:exe", "/optimize+", `/out:${temporary}`, source], {
      windowsHide: true, encoding: "utf8", timeout: 30_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Windows browser supervisor compilation failed: ${result.error?.message ?? result.stdout ?? result.stderr}`);
    }
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function spawnBrowserProcess(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ChildProcessWithoutNullStreams {
  if (process.platform !== "win32") {
    return spawn(executable, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  }
  const app = packagedApp();
  const supervisor = app ? resolve(app, "..", "runtime", "browser-process-job.exe")
    : resolve(import.meta.dir, "..", ".launcher-runtime", "browser-process-job.exe");
  if (!existsSync(supervisor)) {
    if (app) throw new Error("Packaged browser process supervisor is missing; reinstall the runtime bundle");
    buildWindowsProcessJob(join(import.meta.dir, "windows-process-job.cs"), supervisor);
  }
  return spawn(supervisor, [String(process.pid), executable, ...args], {
    env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
}

export async function stopBrowserProcess(child: ChildProcessWithoutNullStreams, graceMs = 0): Promise<void> {
  if (!child.pid) {
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    return;
  }
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const wait = (ms: number) => new Promise<boolean>(resolveExit => {
    if (exited()) return resolveExit(true);
    const finish = (value: boolean) => { clearTimeout(timer); child.off("exit", onExit); resolveExit(value); };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), ms);
    child.once("exit", onExit);
    if (exited()) finish(true);
  });
  child.stdin.end();
  if (await wait(graceMs)) return;
  // On Windows this terminates the supervisor, closing its private job handle atomically.
  child.kill("SIGKILL");
  if (!await wait(2_000)) throw new Error("Owned browser process did not exit after forced termination");
  child.stdout.destroy();
  child.stderr.destroy();
}

export async function runBrowserWorker<T>(
  script: string, action: string, params: Record<string, unknown>, timeoutMs = 60_000,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Browser worker timeout must be positive and finite");
  const child = spawnBrowserProcess(browserNodeExecutable(), [script]);
  let timer: NodeJS.Timeout | undefined;
  let stdout = "", stderr = "";
  try {
    return await new Promise<T>((resolveResult, rejectResult) => {
      timer = setTimeout(() => rejectResult(new Error(`Browser worker ${action} timed out after ${timeoutMs}ms`)), timeoutMs);
      child.once("error", rejectResult);
      child.stdin.once("error", rejectResult);
      child.stdout.on("data", chunk => {
        stdout += chunk;
        if (stdout.length > 16 * 1024 * 1024) rejectResult(new Error("Browser worker response exceeded 16 MiB"));
      });
      child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8192); });
      child.once("close", code => {
        try {
          const message = JSON.parse(stdout.trim());
          if (!message.ok) throw new Error(message.error);
          if (code !== 0) throw new Error(`Browser worker exited with status ${code}`);
          resolveResult(message.result as T);
        } catch (error) {
          rejectResult(new Error(`Browser worker ${action} failed: ${error instanceof Error ? error.message : String(error)}${stderr ? `; ${stderr.trim()}` : ""}`));
        }
      });
      child.stdin.end(JSON.stringify({ action, params }));
    });
  } finally {
    clearTimeout(timer);
    await stopBrowserProcess(child);
  }
}
