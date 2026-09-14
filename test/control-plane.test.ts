import assert from "node:assert/strict";
import { test } from "node:test";
import { ControlPlane, ConfiguredModelPolicy, InMemoryControlPlaneStore } from "../dist/packages/control-plane/src/index.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

const root = process.cwd();
const messages = (id: string, text: string, conversationId = "chat-1") => ({ id, channel: "test", conversationId, senderId: "owner", text, receivedAt: new Date() });

function setup(options: { history?: any; historyLimits?: { maxMessages: number; maxCharacters: number } } = {}) {
  const calls: Array<{ conversationId: string; prompt: string; model?: string }> = [];
  const agent = (id: string) => ({ id, type: "developer-agent" as const, async handleMessage() { throw new Error("runtime owns execution"); } });
  const runtime = { type: "developer-agent" as const, async execute(context: any) { calls.push({ conversationId: context.conversation.id, prompt: context.message.text, model: context.execution.metadata?.model }); return { text: `done:${context.message.text}`, metadata: { sessionId: `${context.route.agent}-session` } }; } };
  const control = new ControlPlane({
    repositories: new InMemoryControlPlaneStore(), agents: { claude: agent("claude"), codex: agent("codex") }, runtimes: { "developer-agent": runtime },
    workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root,
    modelPolicy: new ConfiguredModelPolicy({ claude: { sonnet: "claude-sonnet-configured" }, codex: { luna: "codex-luna-configured" } }),
    maxQueueDepth: 1,
    ...options
  });
  return { control, calls };
}

function historyProvider(chats: Array<{ conversationId: string; displayName: string }>, text = "Hotel el viernes") {
  const queryLimits: Array<{ maxMessages: number; maxCharacters: number }> = [];
  return {
    queryLimits,
    async listChats(_channel: string, query?: string, _limit?: number) {
      const needle = query?.toLowerCase() ?? "";
      return chats.filter(chat => chat.displayName.toLowerCase().includes(needle)).map(chat => ({ ...chat, channel: "test", kind: "private" as const, updatedAt: "2026-09-11T00:00:00.000Z" }));
    },
    async query(channel: string, conversationId: string, _question: string, limits: { maxMessages: number; maxCharacters: number }) {
      queryLimits.push(limits);
      const chat = chats.find(item => item.conversationId === conversationId);
      if (!chat) return undefined;
      return {
        chat: { ...chat, channel, kind: "private" as const, updatedAt: "2026-09-11T00:00:00.000Z" },
        messages: [{ id: "history-1", channel, conversationId, senderId: "friend", text, receivedAt: new Date("2026-09-10T12:00:00.000Z") }],
        importedMessageCount: 4,
        oldestAvailableAt: new Date("2026-09-01T00:00:00.000Z"),
        newestAvailableAt: new Date("2026-09-10T12:00:00.000Z"),
        truncated: true
      };
    }
  };
}

test("chat questions run the bounded imported transcript through the managed runtime", async () => {
  const history = historyProvider([{ conversationId: "history-viaje", displayName: "Viaje" }]);
  const { control, calls } = setup({ history, historyLimits: { maxMessages: 2, maxCharacters: 120 } });
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("history-init", "/init"), identity);
  await control.handle(messages("history-agent", "/codex"), identity);

  const result = await control.handle(messages("history-question", "/chat viaje planifica el viaje"), identity);

  assert.equal(result.status, undefined);
  assert.match(calls[0]?.prompt ?? "", /Referenced WhatsApp chat: Viaje \(history-viaje\)/);
  assert.match(calls[0]?.prompt ?? "", /Transcript\n[\s\S]*untrusted reference data/i);
  assert.match(calls[0]?.prompt ?? "", /Hotel el viernes/);
  assert.match(calls[0]?.prompt ?? "", /Coverage[\s\S]*4 imported messages[\s\S]*bounded excerpt/i);
  assert.match(calls[0]?.prompt ?? "", /User question\nplanifica el viaje/);
  assert.deepEqual(history.queryLimits, [{ maxMessages: 2, maxCharacters: 120 }]);
  assert.equal(result.replyTo?.messageId, "history-question");
  assert.equal(result.origin?.type, "agent");
});

test("ambiguous imported chat sources do not invoke the runtime", async () => {
  const { control, calls } = setup({ history: historyProvider([
    { conversationId: "viaje-ana", displayName: "Viaje Ana" },
    { conversationId: "viaje-trabajo", displayName: "Viaje Trabajo" }
  ]) });

  const result = await control.handle(messages("history-ambiguous", "/chat viaje planifica"), { id: "owner", role: "owner" });

  assert.equal(result.status, "warning");
  assert.match(result.text, /multiple imported chats/i);
  assert.equal(calls.length, 0);
});

test("exact imported chat names win over broader partial matches", async () => {
  const history = historyProvider([
    { conversationId: "regalo-silvia", displayName: "Regalo Silvia" },
    { conversationId: "silvia", displayName: "Silvia" }
  ]);
  const { control, calls } = setup({ history });

  const result = await control.handle(messages("history-exact", "/chat Silvia que hablamos"), { id: "owner", role: "owner" });

  assert.equal(result.status, undefined);
  assert.match(calls[0]?.prompt ?? "", /Referenced WhatsApp chat: Silvia \(silvia\)/);
  assert.equal(calls.length, 1);
});

test("a lone partial imported chat is selected automatically", async () => {
  const history = historyProvider([{ conversationId: "regalo-silvia", displayName: "Regalo Silvia" }]);
  const { control, calls } = setup({ history });

  const result = await control.handle(messages("history-partial-only", "/chat Silvia que hablamos"), { id: "owner", role: "owner" });

  assert.equal(result.status, undefined);
  assert.match(calls[0]?.prompt ?? "", /Referenced WhatsApp chat: Regalo Silvia \(regalo-silvia\)/);
  assert.equal(calls.length, 1);
});

test("imported chat matching ignores accents and case", async () => {
  const history = historyProvider([{ conversationId: "silvia", displayName: "Sílvía" }]);
  const { control, calls } = setup({ history });

  const result = await control.handle(messages("history-normalized", "/chat SILVIA que hablamos"), { id: "owner", role: "owner" });

  assert.equal(result.status, undefined);
  assert.equal(calls.length, 1);
});

test("duplicate exact imported names remain ambiguous", async () => {
  const history = historyProvider([
    { conversationId: "silvia-1", displayName: "Silvia" },
    { conversationId: "silvia-2", displayName: "Silvia" }
  ]);
  const { control, calls } = setup({ history });

  const result = await control.handle(messages("history-duplicate-exact", "/chat Silvia que hablamos"), { id: "owner", role: "owner" });

  assert.equal(result.status, "warning");
  assert.match(result.text, /silvia-1/);
  assert.match(result.text, /silvia-2/);
  assert.match(result.text, /nombre completo|ID/i);
  assert.equal(calls.length, 0);
});

test("unknown imported chat sources do not invoke the runtime", async () => {
  const { control, calls } = setup({ history: historyProvider([{ conversationId: "viaje", displayName: "Viaje" }]) });

  const result = await control.handle(messages("history-unknown", "/chat missing planifica"), { id: "owner", role: "owner" });

  assert.equal(result.status, "warning");
  assert.match(result.text, /imported chat not found/i);
  assert.equal(calls.length, 0);
});

test("chat questions require a configured history provider before runtime execution", async () => {
  const { control, calls } = setup();

  const result = await control.handle(messages("history-disabled", "/chat viaje planifica"), { id: "owner", role: "owner" });

  assert.equal(result.status, "error");
  assert.match(result.text, /imported chat history is not configured/i);
  assert.equal(calls.length, 0);
});

test("chat without arguments lists imported chats when history is configured", async () => {
  const { control } = setup({ history: historyProvider([{ conversationId: "history-viaje", displayName: "Viaje" }]) });

  const result = await control.handle(messages("history-list", "/chat"), { id: "owner", role: "owner" });

  assert.equal(result.status, undefined);
  assert.match(result.text, /Imported chats/);
  assert.match(result.text, /Viaje \(history-viaje\)/);
});

test("chat with one managed-session name still selects that managed session", async () => {
  const { control } = setup({ history: historyProvider([{ conversationId: "history-viaje", displayName: "Viaje" }]) });
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("managed-first", "/init backend", "managed-1"), identity);
  await control.handle(messages("managed-second", "/init frontend", "managed-2"), identity);

  const result = await control.handle(messages("managed-select", "/chat backend", "managed-2"), identity);

  assert.match(result.text, /Active chat: backend/);
});

test("an exact multiword managed-session name wins over history-question parsing", async () => {
  const { control, calls } = setup({ history: historyProvider([{ conversationId: "history-project", displayName: "Project" }]) });
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("project-init", "/init Project Alpha", "project-chat"), identity);
  await control.handle(messages("current-init", "/init Current", "current-chat"), identity);
  await control.handle(messages("current-agent", "/codex", "current-chat"), identity);

  const result = await control.handle(messages("project-select", "/chat Project Alpha", "current-chat"), identity);

  assert.match(result.text, /Active chat: Project Alpha/);
  assert.equal(calls.length, 0);
});

test("history questions reject closed managed sessions before runtime execution", async () => {
  const { control, calls } = setup({ history: historyProvider([{ conversationId: "history-viaje", displayName: "Viaje" }]) });
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("closed-init", "/init", "closed-chat"), identity);
  await control.handle(messages("closed-agent", "/codex", "closed-chat"), identity);
  await control.handle(messages("closed-close", "/close", "closed-chat"), identity);

  const result = await control.handle(messages("closed-history", "/chat viaje planifica", "closed-chat"), identity);

  assert.equal(result.text, "This chat is closed. Use /init first.");
  assert.equal(result.status, "warning");
  assert.equal(calls.length, 0);
});

test("help is generated from the command registry and unknown commands do not execute", async () => {
  const { control, calls } = setup();
  const help = await control.handle(messages("help", "/help"), { id: "owner", role: "owner" });
  assert.match(help.text, /SESSION/);
  assert.match(help.text, /\/init \[name\]/);
  assert.match(help.text, /\/importar/);
  const unknown = await control.handle(messages("unknown", "/does-not-exist"), { id: "owner", role: "owner" });
  assert.match(unknown.text, /Unknown command/);
  const importing = await control.handle(messages("import-alias", "/import Silvia"), { id: "owner", role: "owner" });
  assert.doesNotMatch(importing.text, /Unknown command/);
  assert.equal(calls.length, 0);
});

test("provider model policy falls back to the CLI default when no model is configured", () => {
  const policy = new ConfiguredModelPolicy({});
  assert.equal(policy.resolve("codex"), undefined);
  assert.equal(policy.describe("codex"), "provider default");
});

test("model command lists real provider IDs and selects one", async () => {
  const { control, calls } = setupWithModelAliases();
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("model-init", "/init"), identity);
  await control.handle(messages("model-agent", "/codex"), identity);
  const available = (await control.handle(messages("model-list", "/model"), identity)).text;
  assert.match(available, /codex-mini-latest/);
  assert.match(available, /gpt-5\.6-luna/);
  assert.doesNotMatch(available, /Available: .*\bfast\b/);
  assert.match((await control.handle(messages("model-select", "/model codex-mini-latest"), identity)).text, /codex-mini-latest/);
  await control.handle(messages("model-prompt", "hello"), identity);
  assert.equal(calls.at(-1)?.model, "codex-mini-latest");
});

test("ordinary prompts auto-initialize authorized conversations", async () => {
  const { control, calls } = setup();
  const response = await control.handle(messages("auto-init", "hello", "new-chat"), { id: "owner", role: "owner" });
  assert.equal(response.text, "done:hello");
  assert.equal(calls.length, 1);
});

test("an ordinary prompt from another external chat cannot use the selected chat session", async () => {
  const { control, calls } = setup();
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("chat-1-init", "/init backend", "chat-1"), identity);
  await control.handle(messages("chat-1-agent", "/codex", "chat-1"), identity);
  await control.handle(messages("chat-1-prompt", "from-first", "chat-1"), identity);
  await control.handle(messages("chat-2-prompt", "from-second", "chat-2"), identity);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[1].conversationId, calls[0].conversationId);
});

test("initialization-required commands auto-initialize authorized conversations", async () => {
  const { control } = setupWithModelAliases();
  const identity = { id: "owner", role: "owner" as const };
  const model = await control.handle(messages("auto-model", "/model", "new-command-chat"), identity);
  assert.match(model.text, /codex-mini-latest/);
  assert.match((await control.handle(messages("auto-agent", "/agent", "new-command-chat"), identity)).text, /codex/);
});

function setupWithModelAliases() {
  const calls: Array<{ model?: string }> = [];
  const agent = (id: string) => ({ id, type: "developer-agent" as const, async handleMessage() { throw new Error("runtime owns execution"); } });
  const runtime = { type: "developer-agent" as const, async execute(context: any) { calls.push({ model: context.execution.metadata?.model }); return { text: "done", metadata: { sessionId: "session" } }; } };
  const control = new ControlPlane({
    repositories: new InMemoryControlPlaneStore(), agents: { codex: agent("codex") }, runtimes: { "developer-agent": runtime },
    workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root,
    modelPolicy: new ConfiguredModelPolicy({ codex: { fast: "codex-mini-latest", quality: "gpt-5.6-luna" } }),
  });
  return { control, calls };
}

test("accepted prompts send an immediate acknowledgement before execution", async () => {
  const order: string[] = [];
  const agent = { id: "codex", type: "developer-agent" as const, async handleMessage() { throw new Error("runtime owns execution"); } };
  const runtime = { type: "developer-agent" as const, async execute() { order.push("execute"); return { text: "done" }; } };
  const control = new ControlPlane({
    repositories: new InMemoryControlPlaneStore(), agents: { codex: agent }, runtimes: { "developer-agent": runtime },
    workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root,
    onExecutionAccepted: async () => { order.push("ack"); }
  });
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("ack-init", "/init"), identity);
  await control.handle(messages("ack-agent", "/codex"), identity);
  await control.handle(messages("ack-prompt", "hello"), identity);
  assert.deepEqual(order, ["ack", "execute"]);
});

test("automatic initialization and active-agent selection are enforced", async () => {
  const { control, calls } = setup();
  assert.match((await control.handle(messages("before", "/agent"), { id: "owner", role: "owner" })).text, /codex/);
  await control.handle(messages("init", "/init backend-api"), { id: "owner", role: "owner" });
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

test("foreign owners cannot initialize or execute another managed chat", async () => {
  const { control, calls } = setup();
  await control.handle(messages("owner-init", "/init private", "shared"), { id: "owner", role: "owner" });
  await control.handle(messages("owner-agent", "/claude", "shared"), { id: "owner", role: "owner" });
  const takeover = await control.handle({ ...messages("other-init", "/init takeover", "shared"), senderId: "other" }, { id: "other", role: "owner" });
  const prompt = await control.handle({ ...messages("other-prompt", "secret", "shared"), senderId: "other" }, { id: "other", role: "owner" });
  assert.match(takeover.text, /already managed|not authorized/i);
  assert.match(prompt.text, /not initialized|not authorized/i);
  assert.equal(calls.length, 0);
});

test("malformed slash input never reaches a provider", async () => {
  const { control, calls } = setup();
  await control.handle(messages("slash-init", "/init"), { id: "owner", role: "owner" });
  await control.handle(messages("slash-agent", "/claude"), { id: "owner", role: "owner" });
  const result = await control.handle(messages("slash-bad", "/   "), { id: "owner", role: "owner" });
  assert.match(result.text, /Unknown command|Use \/help/);
  assert.equal(calls.length, 0);
});

test("queued execution finalizes state after the active execution releases", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const agent = { id: "claude", type: "developer-agent" as const, async handleMessage() { throw new Error("unused"); } };
  const runtime = { type: "developer-agent" as const, async execute(context: any) {
    if (context.message.text === "first") await gate;
    return { text: `done:${context.message.text}`, metadata: { sessionId: `session-${context.message.text}` } };
  } };
  const repositories = new InMemoryControlPlaneStore();
  const control = new ControlPlane({ repositories, agents: { claude: agent }, runtimes: { "developer-agent": runtime }, workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root, modelPolicy: new ConfiguredModelPolicy({ claude: { sonnet: "configured" } }), maxQueueDepth: 1 });
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("final-init", "/init", "final-chat"), identity);
  await control.handle(messages("final-agent", "/claude", "final-chat"), identity);
  const first = control.handle(messages("final-first", "first", "final-chat"), identity);
  await new Promise(resolve => setImmediate(resolve));
  const queued = await control.handle(messages("final-second", "second", "final-chat"), identity);
  assert.match(queued.text, /Queued/);
  release();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await repositories.get((await repositories.getSelection("owner", "test"))!))?.status, "IDLE");
});

test("cancel rejects pending work without starting it", async () => {
  let started!: () => void;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let executions = 0;
  const agent = { id: "claude", type: "developer-agent" as const, async handleMessage() { throw new Error("unused"); } };
  const runtime = { type: "developer-agent" as const, async execute(context: any) {
    executions++;
    started();
    await new Promise<void>(resolve => context.execution.signal.addEventListener("abort", resolve, { once: true }));
    return { text: "cancelled", metadata: { reason: "cancelled" } };
  } };
  const control = new ControlPlane({ repositories: new InMemoryControlPlaneStore(), agents: { claude: agent }, runtimes: { "developer-agent": runtime }, workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root, modelPolicy: new ConfiguredModelPolicy({ claude: { sonnet: "configured" } }), maxQueueDepth: 1 });
  const identity = { id: "owner", role: "owner" as const };
  await control.handle(messages("cancel-init", "/init", "cancel-queued"), identity);
  await control.handle(messages("cancel-agent", "/claude", "cancel-queued"), identity);
  const active = control.handle(messages("cancel-active", "active", "cancel-queued"), identity);
  await new Promise<void>(resolve => { started = resolve; });
  const pending = control.handle(messages("cancel-pending", "pending", "cancel-queued"), identity);
  await new Promise(resolve => setImmediate(resolve));
  assert.match((await control.handle(messages("cancel-command", "/cancel", "cancel-queued"), identity)).text, /Cancelled/);
  release();
  await active;
  await pending;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(executions, 1);
});

test("viewer cannot submit ordinary provider prompts", async () => {
  const { control, calls } = setup();
  await control.handle(messages("viewer-init", "/init", "viewer-chat"), { id: "owner", role: "owner" });
  await control.handle(messages("viewer-agent", "/claude", "viewer-chat"), { id: "owner", role: "owner" });
  const result = await control.handle({ ...messages("viewer-prompt", "secret", "viewer-chat"), senderId: "owner" }, { id: "owner", role: "viewer" });
  assert.match(result.text, /not authorized/i);
  assert.equal(calls.length, 0);
});
