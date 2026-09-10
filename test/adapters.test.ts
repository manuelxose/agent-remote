import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WhatsAppChannel, InvalidWhatsAppPayloadError } from "../dist/channels/whatsapp/src/index.js";
import { createClaudeAdapter } from "../dist/developer-agents/claude/src/index.js";
import { createCodexAdapter } from "../dist/developer-agents/codex/src/index.js";
import { createCopilotAdapter } from "../dist/developer-agents/copilot/src/index.js";
import { InMemoryEventBus } from "../dist/packages/events/src/index.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";
import { talkarisAgent } from "../dist/integrations/talkaris/src/index.js";

test("WhatsApp channel translates payloads without agent knowledge", async () => {
  const sent: string[] = [];
  const channel = new WhatsAppChannel(async (conversationId, text) => sent.push(`${conversationId}:${text}`));
  const message = await channel.receive({ messageId: "m1", conversationId: "group-claude", senderId: "u1", text: "hello" });

  assert.equal(message.channel, "whatsapp");
  assert.equal(message.conversationId, "group-claude");
  await channel.send("group-claude", { text: "response" });
  assert.deepEqual(sent, ["group-claude:response"]);
});

test("WhatsApp channel rejects malformed transport payloads", async () => {
  const channel = new WhatsAppChannel(async () => undefined);
  await assert.rejects(() => channel.receive({ text: "missing identity" }), InvalidWhatsAppPayloadError);
});

test("canonical adapters register independently of the WhatsApp channel", () => {
  assert.deepEqual(
    [createClaudeAdapter(), createCodexAdapter(), createCopilotAdapter()].map(adapter => adapter.id),
    ["claude", "codex", "copilot"]
  );
  assert.equal(talkarisAgent.id, "talkaris");
  assert.equal(talkarisAgent.type, "chatbot");
});

const request = { prompt: "--dangerously-bypass-approvals-and-sandbox", conversationId: "conversation", timeoutMs: 1000, maxOutputBytes: 1000 };
const context = {
  correlationId: "correlation",
  conversationId: request.conversationId,
  workingDirectory: process.cwd(),
  workspacePolicy: new WorkspacePolicy([process.cwd()]),
  signal: new AbortController().signal,
  events: new InMemoryEventBus(),
  processRunner: { run: async () => ({ stdout: "", stderr: "", exitCode: 0, signal: null, durationMs: 1 }) }
};

test("adapters report missing executables without spawning", async () => {
  for (const adapter of [
    createClaudeAdapter(async () => undefined),
    createCodexAdapter(async () => undefined),
    createCopilotAdapter(async () => undefined, () => "00000000-0000-4000-8000-000000000000")
  ]) {
    assert.deepEqual(await adapter.getAvailability(), { available: false, reason: "executable-missing", executable: adapter.id });
    assert.equal(await adapter.isAvailable(), false);
    assert.deepEqual(await adapter.execute(request, context), { status: "failed", reason: "unavailable" });
  }
});

test("Claude builds fixed argv, parses JSON, and resumes its native session", async () => {
  const calls: unknown[] = [];
  const adapter = createClaudeAdapter(async () => "/bin/claude");
  const runner = { run: async (spec: any) => {
    calls.push(spec);
    return { stdout: JSON.stringify({ type: "result", session_id: "claude-session", result: "answer" }), stderr: "", exitCode: 0, signal: null, durationMs: 2 };
  }};
  const result = await adapter.execute(request, { ...context, processRunner: runner });
  assert.deepEqual(calls[0], { executable: "/bin/claude", argv: ["-p", "--output-format", "json", "--add-dir", process.cwd(), "--", request.prompt], workingDirectory: process.cwd(), signal: context.signal, timeoutMs: 1000, maxOutputBytes: 1000 });
  assert.equal(result.status, "completed");
  assert.equal((result as any).text, "answer");
  assert.equal((result as any).sessionId, "claude-session");
  await adapter.execute({ ...request, sessionId: "claude-session" }, { ...context, processRunner: runner });
  assert.deepEqual((calls[1] as any).argv, ["-p", "--output-format", "json", "--add-dir", process.cwd(), "--resume", "claude-session", "--", request.prompt]);
});

test("Codex builds exec JSON argv and parses JSONL thread and final message", async () => {
  let spec: any;
  const adapter = createCodexAdapter(async () => "/bin/codex");
  const runner = { run: async (value: any) => { spec = value; return { stdout: [
    JSON.stringify({ type: "thread.started", thread_id: "codex-thread" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "answer" } })
  ].join("\n"), stderr: "", exitCode: 0, signal: null, durationMs: 2 }; } };
  const result = await adapter.execute(request, { ...context, processRunner: runner });
  assert.deepEqual(spec.argv, ["exec", "--json", "--sandbox", "workspace-write", "--", request.prompt]);
  assert.equal((result as any).sessionId, "codex-thread");
  assert.equal((result as any).text, "answer");
  await adapter.execute({ ...request, sessionId: "codex-thread" }, { ...context, processRunner: runner });
  assert.deepEqual(spec.argv, ["exec", "--json", "--sandbox", "workspace-write", "resume", "codex-thread", "--", request.prompt]);
});

test("Copilot uses an exact UUID session ID and silent prompt mode", async () => {
  let spec: any;
  const sessionId = "00000000-0000-4000-8000-000000000000";
  const adapter = createCopilotAdapter(async () => "/bin/copilot", () => sessionId);
  const runner = { run: async (value: any) => { spec = value; return { stdout: "answer", stderr: "", exitCode: 0, signal: null, durationMs: 2 }; } };
  const result = await adapter.execute(request, { ...context, processRunner: runner });
  assert.deepEqual(spec.argv, [`--prompt=${request.prompt}`, "--silent", `--session-id=${sessionId}`, "--experimental", "--sandbox"]);
  assert.equal(result.status, "completed");
  assert.equal((result as any).text, "answer");
  assert.equal((result as any).sessionId, sessionId);
  await adapter.execute({ ...request, sessionId }, { ...context, processRunner: runner });
  assert.deepEqual(spec.argv, [`--prompt=${request.prompt}`, "--silent", `--session-id=${sessionId}`, "--experimental", "--sandbox"]);
});

test("Claude and Codex reject malformed structured output", async () => {
  for (const adapter of [createClaudeAdapter(async () => "/bin/claude"), createCodexAdapter(async () => "/bin/codex")]) {
    const result = await adapter.execute(request, { ...context, processRunner: { run: async () => ({ stdout: "not-json", stderr: "", exitCode: 0, signal: null, durationMs: 1 }) } });
    assert.equal(result.status, "failed");
    assert.equal((result as any).reason, "invalid-output");
  }
});

test("Copilot rejects empty output", async () => {
  const adapter = createCopilotAdapter(async () => "/bin/copilot", () => "00000000-0000-4000-8000-000000000000");
  const result = await adapter.execute(request, { ...context, processRunner: { run: async () => ({ stdout: "", stderr: "", exitCode: 0, signal: null, durationMs: 1 }) } });
  assert.equal(result.status, "failed");
  assert.equal((result as any).reason, "invalid-output");
});

test("all adapters reject an unapproved workspace before spawning", async () => {
  const outside = { ...context, workingDirectory: "/not-approved", processRunner: { run: async () => { throw new Error("must not spawn"); } } };
  for (const adapter of [createClaudeAdapter(async () => "/bin/claude"), createCodexAdapter(async () => "/bin/codex"), createCopilotAdapter(async () => "/bin/copilot", () => "00000000-0000-4000-8000-000000000000")]) {
    assert.deepEqual(await adapter.execute(request, outside), { status: "failed", reason: "workspace-rejected" });
  }
});

test("runner rejection is execution-failed with bounded diagnostics", async () => {
  for (const adapter of [createClaudeAdapter(async () => "/bin/claude"), createCodexAdapter(async () => "/bin/codex"), createCopilotAdapter(async () => "/bin/copilot", () => "00000000-0000-4000-8000-000000000000")]) {
    const result = await adapter.execute(request, { ...context, processRunner: { run: async () => { throw new Error("runner failed"); } } });
    assert.equal(result.status, "failed");
    assert.equal((result as any).reason, "execution-failed");
    assert.match((result as any).stderr, /runner failed/);
  }
  const result = await createClaudeAdapter(async () => "/bin/claude").execute({ ...request, maxOutputBytes: 8 }, { ...context, processRunner: { run: async () => { throw new Error("runner failed with a very long diagnostic"); } } });
  assert.equal((result as any).stderr.length, 8);
});

test("adapters map process termination and nonzero results", async () => {
  for (const terminationReason of ["timeout", "cancelled", "output-limit"] as const) {
    for (const adapter of [createClaudeAdapter(async () => "/bin/claude"), createCodexAdapter(async () => "/bin/codex"), createCopilotAdapter(async () => "/bin/copilot", () => "00000000-0000-4000-8000-000000000000")]) {
      const result = await adapter.execute(request, { ...context, processRunner: { run: async () => ({ stdout: "", stderr: "bounded", exitCode: null, signal: "SIGTERM", durationMs: 3, terminationReason }) } });
      assert.equal((result as any).reason, terminationReason);
    }
  }
  for (const adapter of [createClaudeAdapter(async () => "/bin/claude"), createCodexAdapter(async () => "/bin/codex"), createCopilotAdapter(async () => "/bin/copilot", () => "00000000-0000-4000-8000-000000000000")]) {
    const result = await adapter.execute(request, { ...context, processRunner: { run: async () => ({ stdout: "", stderr: "bad", exitCode: 3, signal: null, durationMs: 3 }) } });
    assert.equal((result as any).reason, "exit-nonzero");
    assert.equal((result as any).stderr, "bad");
  }
});
