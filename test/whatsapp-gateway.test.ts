import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createWhatsAppGateway } from "../dist/apps/gateway/src/whatsapp.js";
import { InMemoryConversationStore } from "../dist/packages/conversations/src/index.js";
import { InMemoryEventBus } from "../dist/packages/events/src/index.js";
import { ConfigurationRouter } from "../dist/packages/routing/src/index.js";

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
  bus.subscribe("MessageReceived", event => observed.push(event.type));
  const { gateway, channel } = createWhatsAppGateway({
    conversations: new InMemoryConversationStore(),
    router: new ConfigurationRouter({
      "whatsapp-chat@s.whatsapp.net": { id: "whatsapp-chat", runtime: "developer-agent", agent: "mock" }
    }),
    runtimes: {
      "developer-agent": {
        type: "developer-agent",
        async execute(context, agent) { return agent.handleMessage(context); }
      }
    },
    agents: {
      mock: { id: "mock", type: "developer-agent", async handleMessage() { return { text: "pong" }; } }
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

  assert.deepEqual(observed, ["MessageReceived"]);
  assert.deepEqual(sent, [["chat@s.whatsapp.net", { text: "pong" }]]);
  await channel.stop();
  void gateway;
});
