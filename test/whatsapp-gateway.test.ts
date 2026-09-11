import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createWhatsAppGateway } from "../dist/apps/gateway/src/whatsapp.js";
import { InMemoryConversationStore } from "../dist/packages/conversations/src/index.js";
import { InMemoryEventBus } from "../dist/packages/events/src/index.js";
import { ConfigurationRouter } from "../dist/packages/routing/src/index.js";
import { DeveloperAgentRuntime } from "../dist/runtime/developer-agent/src/index.js";
import { InMemoryDeveloperSessionStore } from "../dist/runtime/developer-agent/src/sessions.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

class FakeEvents {
  private readonly listeners = new Map<string, Set<(value: any) => void>>();
  on(event: string, listener: (value: any) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }
  emit(event: string, value: any): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

test("gateway routes an incoming WhatsApp message and replies to the same chat", async () => {
  const events = new FakeEvents();
  const sent: unknown[] = [];
  const socket = {
    ev: events,
    async sendMessage(...args: unknown[]) { sent.push(args); },
    async end() {}
  };
  const bus = new InMemoryEventBus();
  const observed: string[] = [];
  for (const type of ["MessageReceived", "RouteResolved", "AgentExecutionStarted", "AgentExecutionCompleted", "MessageSent"] as const) bus.subscribe(type, event => observed.push(event.type));
  const { gateway, channel } = createWhatsAppGateway({
    conversations: new InMemoryConversationStore(),
    router: new ConfigurationRouter({
      "whatsapp-chat@s.whatsapp.net": { id: "whatsapp-chat", runtime: "developer-agent", agent: "mock", workspaceRoot: process.cwd() }
    }),
    runtimes: {
      "developer-agent": new DeveloperAgentRuntime({
        policy: new WorkspacePolicy([process.cwd()]), shell: async () => "", readFile: async () => "", writeFile: async () => undefined, git: async () => ""
      }, {
        adapters: { mock: { id: "mock", async isAvailable() { return true; }, async getAvailability() { return { available: true, executable: "mock" }; }, async execute() { return { status: "completed" as const, text: "adapter pong", sessionId: "native-session" }; } } },
        sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: "/not-approved", runner: { async run() { return { stdout: "", stderr: "", exitCode: 0, signal: null, durationMs: 0 }; } }, events: bus
      })
    },
    agents: {
      mock: { id: "mock", type: "developer-agent", async handleMessage() { throw new Error("WhatsApp must not construct a developer command"); } }
    },
    events: bus
  }, {
    env: { WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_CHATS: "chat@s.whatsapp.net" },
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
    createSocket: () => socket,
    logger: { info() {}, warn() {}, error() {} }
  });

  await channel.start();
  events.emit("connection.update", { connection: "open" });
  events.emit("messages.upsert", {
    messages: [{ key: { id: "m1", remoteJid: "chat@s.whatsapp.net" }, message: { conversation: "ping" } }]
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(observed, ["MessageReceived", "RouteResolved", "AgentExecutionStarted", "AgentExecutionCompleted", "MessageSent"]);
  assert.deepEqual(sent, [["chat@s.whatsapp.net", { text: "adapter pong" }]]);
  await channel.stop();
  void gateway;
});
