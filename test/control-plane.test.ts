import assert from "node:assert/strict";
import { test } from "node:test";
import { ControlPlane, ConfiguredModelPolicy, InMemoryControlPlaneStore } from "../dist/packages/control-plane/src/index.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

const root = process.cwd();
const messages = (id: string, text: string, conversationId = "chat-1") => ({ id, channel: "test", conversationId, senderId: "owner", text, receivedAt: new Date() });

function setup() {
  const calls: Array<{ conversationId: string; prompt: string; model?: string }> = [];
  const agent = (id: string) => ({ id, type: "developer-agent" as const, async handleMessage() { throw new Error("runtime owns execution"); } });
  const runtime = { type: "developer-agent" as const, async execute(context: any) { calls.push({ conversationId: context.conversation.id, prompt: context.message.text, model: context.execution.metadata?.model }); return { text: `done:${context.message.text}`, metadata: { sessionId: `${context.route.agent}-session` } }; } };
  const control = new ControlPlane({
    repositories: new InMemoryControlPlaneStore(), agents: { claude: agent("claude"), codex: agent("codex") }, runtimes: { "developer-agent": runtime },
    workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root,
    modelPolicy: new ConfiguredModelPolicy({ claude: { sonnet: "claude-sonnet-configured" }, codex: { luna: "codex-luna-configured" } }),
    maxQueueDepth: 1
  });
  return { control, calls };
}

test("help is generated from the command registry and unknown commands do not execute", async () => {
  const { control, calls } = setup();
  const help = await control.handle(messages("help", "/help"), { id: "owner", role: "owner" });
  assert.match(help.text, /SESSION/);
  assert.match(help.text, /\/init \[name\]/);
  const unknown = await control.handle(messages("unknown", "/does-not-exist"), { id: "owner", role: "owner" });
  assert.match(unknown.text, /Unknown command/);
  assert.equal(calls.length, 0);
});

test("pre-init restrictions and active-agent selection are enforced", async () => {
  const { control, calls } = setup();
  assert.match((await control.handle(messages("before", "inspect this"), { id: "owner", role: "owner" })).text, /\/init/);
  await control.handle(messages("init", "/init backend-api"), { id: "owner", role: "owner" });
  assert.match((await control.handle(messages("no-agent", "inspect this"), { id: "owner", role: "owner" })).text, /Select an agent/);
  assert.match((await control.handle(messages("select", "/claude"), { id: "owner", role: "owner" })).text, /Claude activated/);
  const response = await control.handle(messages("prompt", "inspect this"), { id: "owner", role: "owner" });
  assert.equal(response.text, "done:inspect this");
  assert.deepEqual(calls[0], { conversationId: (calls[0] as any).conversationId, prompt: "inspect this", model: "claude-sonnet-configured" });
});

test("multiple owned chats and provider switching remain isolated", async () => {
  const { control, calls } = setup();
  await control.handle(messages("init-1", "/init backend-api", "chat-1"), { id: "owner", role: "owner" });
  await control.handle(messages("claude-1", "/claude", "chat-1"), { id: "owner", role: "owner" });
  await control.handle(messages("prompt-1", "first", "chat-1"), { id: "owner", role: "owner" });
  await control.handle(messages("init-2", "/init gui", "chat-2"), { id: "owner", role: "owner" });
  await control.handle(messages("codex-2", "/codex", "chat-2"), { id: "owner", role: "owner" });
  await control.handle(messages("prompt-2", "second", "chat-2"), { id: "owner", role: "owner" });
  assert.equal(calls[0].model, "claude-sonnet-configured");
  assert.equal(calls[1].model, "codex-luna-configured");
  assert.equal((await control.handle(messages("chats", "/chats", "chat-2"), { id: "owner", role: "owner" })).text.match(/backend-api/g)?.length, 1);
});

test("duplicate message IDs are idempotent", async () => {
  const { control, calls } = setup();
  await control.handle(messages("init", "/init"), { id: "owner", role: "owner" });
  await control.handle(messages("agent", "/claude"), { id: "owner", role: "owner" });
  const first = await control.handle(messages("same", "hello"), { id: "owner", role: "owner" });
  const second = await control.handle(messages("same", "hello"), { id: "owner", role: "owner" });
  assert.equal(first.text, "done:hello");
  assert.match(second.text, /Duplicate/);
  assert.equal(calls.length, 1);
});

test("cancel aborts only the active logical conversation and waits for termination", async () => {
  let started!: () => void;
  let aborted = false;
  const agent = { id: "claude", type: "developer-agent" as const, async handleMessage() { throw new Error("unused"); } };
  const runtime = { type: "developer-agent" as const, async execute(context: any) {
    started();
    return new Promise(resolve => context.execution.signal.addEventListener("abort", () => { aborted = true; resolve({ text: "cancelled", metadata: { reason: "cancelled" } }); }, { once: true }));
  } };
  const control = new ControlPlane({ repositories: new InMemoryControlPlaneStore(), agents: { claude: agent }, runtimes: { "developer-agent": runtime }, workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root, modelPolicy: new ConfiguredModelPolicy({ claude: { sonnet: "configured" } }) });
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("init-cancel", "/init", "cancel-chat"), identity);
  await control.handle(messages("select-cancel", "/claude", "cancel-chat"), identity);
  const execution = control.handle(messages("run-cancel", "wait", "cancel-chat"), identity);
  await new Promise<void>(resolve => { started = resolve; });
  const cancellation = await control.handle(messages("cancel", "/cancel", "cancel-chat"), identity);
  await execution;
  assert.equal(cancellation.text, "Cancelled");
  assert.equal(aborted, true);
});

test("same-chat work is bounded and queued while another chat can run", async () => {
  let release!: () => void;
  let started = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const agent = (id: string) => ({ id, type: "developer-agent" as const, async handleMessage() { throw new Error("unused"); } });
  const runtime = { type: "developer-agent" as const, async execute(context: any) {
    started++;
    if (context.conversation.id === undefined) throw new Error("missing logical session");
    if (context.message.text === "first") await gate;
    return { text: `done:${context.message.text}`, metadata: { sessionId: `${context.conversation.id}-session` } };
  } };
  const control = new ControlPlane({ repositories: new InMemoryControlPlaneStore(), agents: { claude: agent("claude") }, runtimes: { "developer-agent": runtime }, workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root, modelPolicy: new ConfiguredModelPolicy({ claude: { sonnet: "configured" } }), maxQueueDepth: 1 });
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("q-init-1", "/init one", "one"), identity);
  await control.handle(messages("q-agent-1", "/claude", "one"), identity);
  const first = control.handle(messages("q-first", "first", "one"), identity);
  await new Promise(resolve => setTimeout(resolve, 0));
  const queued = await control.handle(messages("q-second", "second", "one"), identity);
  const overflow = await control.handle(messages("q-third", "third", "one"), identity);
  assert.match(queued.text, /Queued/);
  assert.match(overflow.text, /full/);
  await control.handle(messages("q-init-2", "/init two", "two"), identity);
  await control.handle(messages("q-agent-2", "/claude", "two"), identity);
  const independent = await control.handle(messages("q-independent", "other", "two"), identity);
  assert.equal(independent.text, "done:other");
  release();
  assert.equal((await first).text, "done:first");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(started, 3);
});
