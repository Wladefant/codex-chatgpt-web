import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";

function endpoint(name: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\codex-chatgpt-web-test-${name}-${Math.random().toString(36).slice(2)}`
    : join(tmpdir(), `codex-chatgpt-web-test-${name}-${Math.random().toString(36).slice(2)}.sock`);
}

describe("Veyyon bash tool adapter", () => {
  test("maps codex_exec arguments to bash tool with workspace root validation", async () => {
    const tempRoot = resolve(mkdtempSync(join(tmpdir(), "veyyon-bash-test-")));
    const socketPath = endpoint("bash-adapter");
    const broker = TurnBroker.forSocket(socketPath);

    const veyyonEnvironment: ChatGptTurnEnvironment = {
      cwd: tempRoot,
      roots: [tempRoot],
      writableRoots: [tempRoot],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [
        {
          name: "bash",
          description: "Runs commands in the embedded shell",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string" },
              cwd: { type: "string" },
              backgroundAfter: { type: "number" },
              pty: { type: "boolean" },
            },
            required: ["command"],
          },
        },
      ],
    };

    const token = await broker.register(veyyonEnvironment, 60_000);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["src/cli.ts", "mcp", "--broker-socket", socketPath],
      cwd: process.cwd(),
      stderr: "pipe",
    });
    const client = new Client({ name: "veyyon-bash-test", version: "1.0.0" });

    try {
      await client.connect(transport);

      // Yield controls foreground waiting, not the command's execution deadline.
      const pendingExec = client.callTool({
        name: "codex_exec",
        arguments: {
          turn_token: token,
          cmd: "echo hello",
          workdir: tempRoot,
          yield_time_ms: 5_000,
          tty: true,
        },
      });

      const [batch] = await broker.nextToolBatch(token);
      expect(batch).toBeDefined();
      expect(batch.wireName).toBe("bash");
      expect(batch.freeform).toBe(false);
      expect(batch.arguments).toEqual({
        command: "echo hello",
        cwd: tempRoot,
        backgroundAfter: 5,
        pty: true,
      });

      broker.completeTool(token, batch.callId, {
        content: [{ type: "text", text: "hello\n" }],
      });

      const response = await pendingExec;
      expect(response.isError).toBeFalsy();
      expect(response.content).toEqual([{ type: "text", text: "hello\n" }]);

      // 2. Reject workdir escaping roots
      const escapingExec = await client.callTool({
        name: "codex_exec",
        arguments: {
          turn_token: token,
          cmd: "pwd",
          workdir: resolve(tempRoot, "../escaping-dir"),
        },
      });
      expect(escapingExec.isError).toBe(true);
      expect(JSON.stringify(escapingExec.content)).toContain("escapes workspace roots");

      // 3. Reject unsupported permissions on bash
      const permissionExec = await client.callTool({
        name: "codex_exec",
        arguments: {
          turn_token: token,
          cmd: "pwd",
          sandbox_permissions: "require_escalated",
        },
      });
      expect(permissionExec.isError).toBe(true);
      expect(JSON.stringify(permissionExec.content)).toContain("does not support sandbox_permissions");

      // 4. Cancellation via abort signal propagates to pending bash invocation
      const abort = new AbortController();
      const cancelledExec = client.callTool({
        name: "codex_exec",
        arguments: {
          turn_token: token,
          cmd: "sleep 60",
        },
      }, undefined, { signal: abort.signal });
      const [cancelBatch] = await broker.nextToolBatch(token);
      expect(cancelBatch.wireName).toBe("bash");
      abort.abort(new Error("aborted by client"));
      await expect(cancelledExec).rejects.toBeDefined();
    } finally {
      try {
        await client.close();
      } catch {}
      await broker.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
