import { expect, test } from "bun:test";
import { serializeChatGptDiagnosticError } from "../src/adapters/chatgpt-web/browser-worker";

test("diagnostic causes redact URL secrets, emails, and bearer tokens", () => {
  const url = "https://alice:pass@example.test/callback?token=query-secret&email=user@example.test#refresh_token=fragment-secret";
  const record = serializeChatGptDiagnosticError(new Error(
    `request failed ${url}; Authorization: Bearer bearer-secret; api_key=private-key; user@example.test`,
    { cause: new Error(`callback failed ${url}; token=cause-secret; user@example.test`) },
  ));

  const serialized = JSON.stringify(record);
  expect(serialized).not.toContain("query-secret");
  expect(serialized).not.toContain("user@example.test");
  for (const secret of ["alice", "pass", "fragment-secret", "bearer-secret", "private-key", "cause-secret"]) {
    expect(serialized).not.toContain(secret);
  }
  expect(record?.error).toContain("[redacted-url]");
  expect(record?.error.length).toBeLessThanOrEqual(500);
  expect(record?.cause?.[0]?.message.length).toBeLessThanOrEqual(500);
  expect(record?.cause?.[0]?.message).not.toContain("query-secret");
  expect(record?.cause?.[0]?.message).not.toContain("user@example.test");
  expect(serializeChatGptDiagnosticError(new Error("x".repeat(800)))?.error).toHaveLength(500);
});
test("diagnostic messages redact JSON-quoted, underscore, and Basic authorization secrets", () => {
  const record = serializeChatGptDiagnosticError(new Error(
    `payload {"access_token":"json-secret"} session_token=session-secret client_secret=client-secret oauth_token=oauth-secret Authorization: Basic basic-secret`,
  ));
  const serialized = JSON.stringify(record);
  for (const secret of ["json-secret", "session-secret", "client-secret", "oauth-secret", "basic-secret"]) {
    expect(serialized).not.toContain(secret);
  }
});
