import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Gateway } from "../dist/apps/gateway/src/index.js";
import { InMemoryConversationStore } from "../dist/packages/conversations/src/index.js";
import { InMemoryEventBus } from "../dist/packages/events/src/index.js";
import { ConfigurationRouter } from "../dist/packages/routing/src/index.js";
import { DeveloperAgentRuntime } from "../dist/runtime/developer-agent/src/index.js";
import { InMemoryDeveloperSessionStore } from "../dist/runtime/developer-agent/src/sessions.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

test("gateway executes the channel-neutral conversation route runtime agent flow", async () => {
  const sent: string[] = [];
  const events = new InMemoryEventBus();
  const observed: string[] = [];
  for (const type of ["MessageReceived", "RouteResolved", "AgentExecutionStarted", "AgentExecutionCompleted", "MessageSent"] as const) {
    events.subscribe(type, event => { observed.push(event.type); });
  }
  const gateway = new Gateway({
    channel: {
      id: "test",
      async receive() {
        return { id: "m1", conversationId: "group-claude", channel: "whatsapp", senderId: "u1", text: "hello", receivedAt: new Date(0) };
      },
      async send(conversationId, response) { sent.push(`${conversationId}:${response.text}`); }
    },
    conversations: new InMemoryConversationStore(),
    router: new ConfigurationRouter({
      "whatsapp-group-claude": { id: "whatsapp-group-claude", runtime: "developer-agent", agent: "claude", workspaceRoot: process.cwd() }
    }),
    runtimes: {
      "developer-agent": new DeveloperAgentRuntime({
        policy: new WorkspacePolicy([process.cwd()]), shell: async () => "", readFile: async () => "", writeFile: async () => undefined, git: async () => ""
      }, {
        adapters: {
          claude: {
            id: "claude",
            async isAvailable() { return true; },
            async getAvailability() { return { available: true, executable: "claude" }; },
            async execute() { return { status: "completed" as const, text: "adapter response", sessionId: "native-session" }; }
          }
        },
        sessions: new InMemoryDeveloperSessionStore(),
        defaultWorkspaceRoot: "/not-approved",
        runner: { async run() { return { stdout: "", stderr: "", exitCode: 0, signal: null, durationMs: 0 }; } },
        events
      })
    },
    agents: {
      claude: { id: "claude", type: "developer-agent", async handleMessage() { throw new Error("gateway developer route must use the adapter"); } }
    },
    events
  });

  await gateway.handle({});
  assert.deepEqual(sent, ["group-claude:adapter response"]);
  assert.deepEqual(observed, ["MessageReceived", "RouteResolved", "AgentExecutionStarted", "AgentExecutionCompleted", "MessageSent"]);
});

test("gateway copies only the resolved route workspace into execution context", async () => {
  let workspaceRoot: string | undefined;
  const gateway = new Gateway({
    channel: {
      id: "test",
      async receive() { return { id: "m2", conversationId: "workspace", channel: "whatsapp", senderId: "u1", text: "hello", receivedAt: new Date(0), metadata: { workspaceRoot: "/untrusted" } }; },
      async send() {}
    },
    conversations: new InMemoryConversationStore(),
    router: new ConfigurationRouter({
      "whatsapp-workspace": { id: "whatsapp-workspace", runtime: "developer-agent", agent: "claude", workspaceRoot: process.cwd() }
    }),
    runtimes: {
      "developer-agent": { type: "developer-agent", async execute(context) { workspaceRoot = context.execution.workspaceRoot; return { text: "ok" }; } }
    },
    agents: { claude: { id: "claude", type: "developer-agent", async handleMessage() { return { text: "ignored" }; } } },
    events: new InMemoryEventBus()
  });

  await gateway.handle({ workspaceRoot: "/untrusted" });

  assert.equal(workspaceRoot, process.cwd());
});

test("gateway accepts an explicit one-number route override", async () => {
  const sent: string[] = [];
  const gateway = new Gateway({
    channel: {
      id: "test",
      async receive() { return { id: "m-override", conversationId: "one-number", channel: "whatsapp", senderId: "u1", text: "prompt", receivedAt: new Date(0) }; },
      async send(conversationId, response) { sent.push(`${conversationId}:${response.text}`); }
    },
    conversations: new InMemoryConversationStore(),
    router: new ConfigurationRouter({
      "whatsapp-one-number": { id: "whatsapp-one-number", runtime: "developer-agent", agent: "codex", workspaceRoot: process.cwd() }
    }),
    runtimes: {
      "developer-agent": { type: "developer-agent", async execute(_context, agent) { return { text: agent.id }; } }
    },
    agents: {
      claude: { id: "claude", type: "developer-agent", async handleMessage() { return { text: "unused" }; } },
      codex: { id: "codex", type: "developer-agent", async handleMessage() { return { text: "unused" }; } }
    },
    events: new InMemoryEventBus()
  });

  await gateway.handle({}, { id: "manual-claude", runtime: "developer-agent", agent: "claude", workspaceRoot: process.cwd() });
  assert.deepEqual(sent, ["one-number:claude"]);
});

test("gateway sends a clean structured response when the configured CLI is unavailable", async () => {
  const sent: unknown[] = [];
  const events = new InMemoryEventBus();
  const observed: string[] = [];
  for (const type of ["MessageReceived", "RouteResolved", "AgentExecutionStarted", "AgentExecutionFailed", "MessageSent"] as const) events.subscribe(type, event => observed.push(event.type));
  const gateway = new Gateway({
    channel: {
      id: "test",
      async receive() { return { id: "m3", conversationId: "missing-cli", channel: "whatsapp", senderId: "u1", text: "hello", receivedAt: new Date(0) }; },
      async send(_conversationId, response) { sent.push(response); }
    },
    conversations: new InMemoryConversationStore(),
    router: new ConfigurationRouter({
      "whatsapp-missing-cli": { id: "whatsapp-missing-cli", runtime: "developer-agent", agent: "claude", workspaceRoot: process.cwd() }
    }),
    runtimes: {
      "developer-agent": new DeveloperAgentRuntime({
        policy: new WorkspacePolicy([process.cwd()]), shell: async () => "", readFile: async () => "", writeFile: async () => undefined, git: async () => ""
      }, {
        adapters: { claude: { id: "claude", async isAvailable() { return false; }, async getAvailability() { return { available: false as const, reason: "executable-missing" as const, executable: "claude" }; }, async execute() { throw new Error("unavailable adapters must not execute"); } } },
        sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: "/not-approved", runner: { async run() { throw new Error("unavailable adapters must not run"); } }, events
      })
    },
    agents: { claude: { id: "claude", type: "developer-agent", async handleMessage() { throw new Error("developer route must not fall back"); } } },
    events
  });

  await gateway.handle({});

  assert.deepEqual(sent, [{ text: "Unable to complete the developer-agent request.", metadata: { agent: "claude", reason: "unavailable" } }]);
  assert.deepEqual(observed, ["MessageReceived", "RouteResolved", "AgentExecutionStarted", "AgentExecutionFailed", "MessageSent"]);
});
