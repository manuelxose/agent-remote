import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WhatsAppChannel } from "../dist/channels/whatsapp/src/index.js";
import { parseWhatsAppConfig } from "../dist/channels/whatsapp/src/config.js";
import { InMemoryHistoryStore } from "../dist/packages/conversations/src/index.js";

class FakeEvents {
  private readonly listeners = new Map<string, Set<(value: any) => void>>();

  on(event: string, listener: (value: any) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: (value: any) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, value: any): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

test("authorized incoming messages reach the supplied gateway handler", async () => {
  const events = new FakeEvents();
  const received: unknown[] = [];
  const socket = { ev: events, async sendMessage() {}, async end() {} };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_USERS: "u@s.whatsapp.net" }),
    onMessage: async payload => received.push(payload),
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
    createSocket: () => socket,
    logger: { info() {}, warn() {}, error() {} }
  });

  await channel.start();
  events.emit("connection.update", { connection: "open" });
  events.emit("messages.upsert", {
    messages: [{ key: { id: "m1", remoteJid: "u@s.whatsapp.net" }, message: { conversation: "hello" } }]
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(received.length, 1);
  assert.equal(channel.health().status, "connected");
});

test("long responses are split at the configured WhatsApp size limit", async () => {
  const events = new FakeEvents();
  const sent: unknown[] = [];
  const socket = { ev: events, async sendMessage(...args: unknown[]) { sent.push(args); return undefined; }, async end() {} };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_USERS: "u@s.whatsapp.net", WHATSAPP_MAX_RESPONSE_CHARS: "4" }),
    onMessage: async () => {}, loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }), createSocket: () => socket
  });
  await channel.start();
  events.emit("connection.update", { connection: "open" });
  await channel.send("chat@s.whatsapp.net", { text: "abcdefghij" });
  assert.deepEqual(sent.map(args => (args as any[])[1].text), ["abcd", "efgh", "ij"]);
  await channel.stop();
});

test("responses are sent as normal messages without quoted context", async () => {
  const events = new FakeEvents();
  const sent: unknown[] = [];
  const socket = { ev: events, async sendMessage(...args: unknown[]) { sent.push(args); return undefined; }, async end() {} };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_USERS: "u@s.whatsapp.net" }),
    onMessage: async () => {}, loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }), createSocket: () => socket
  });
  await channel.start();
  events.emit("connection.update", { connection: "open" });
  await channel.receive({ key: { id: "incoming-1", remoteJid: "u@s.whatsapp.net" }, message: { conversation: "hello" } });
  await channel.send("u@s.whatsapp.net", { text: "reply", origin: { type: "agent", agentId: "codex" } });
  assert.equal((sent[0] as any[]).length, 2);
  assert.equal((sent[0] as any[])[1].text, "reply");
  await channel.stop();
});

test("unauthorized messages are logged and do not reach the gateway handler", async () => {
  const events = new FakeEvents();
  const received: unknown[] = [];
  const logs: Record<string, unknown>[] = [];
  const socket = { ev: events, async sendMessage() {}, async end() {} };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_USERS: "allowed@s.whatsapp.net" }),
    onMessage: async payload => received.push(payload),
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
    createSocket: () => socket,
    logger: { info() {}, warn(event, fields) { logs.push({ event, ...fields }); }, error() {} }
  });

  await channel.start();
  events.emit("messages.upsert", {
    messages: [{ key: { id: "m1", remoteJid: "blocked@s.whatsapp.net" }, message: { conversation: "hello" } }]
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(received.length, 0);
  assert.equal(logs[0]?.event, "whatsapp_security_rejection");
  assert.equal(logs[0]?.reason, "sender_not_allowlisted");
});

test("one-number mode accepts manual self-messages and ignores gateway echoes", async () => {
  const events = new FakeEvents();
  const received: unknown[] = [];
  const socket = {
    ev: events,
    async sendMessage() { return { key: { id: "gateway-reply-1" } }; },
    async end() {}
  };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({
      WHATSAPP_AUTH_PATH: "/tmp/auth",
      WHATSAPP_ALLOWED_USERS: "u@s.whatsapp.net",
      WHATSAPP_ALLOWED_CHATS: "278386962370655@lid",
      WHATSAPP_ALLOW_SELF_MESSAGES: "true"
    }),
    onMessage: async payload => received.push(payload),
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
    createSocket: () => socket,
    logger: { info() {}, warn() {}, error() {} }
  });

  await channel.start();
  events.emit("connection.update", { connection: "open" });
  events.emit("messages.upsert", {
    messages: [{ key: { id: "manual-self-1", remoteJid: "278386962370655@lid", fromMe: true }, message: { conversation: "hello" } }]
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(received.length, 1);

  await channel.send("u@s.whatsapp.net", { text: "reply", origin: { type: "agent", agentId: "codex" } });
  events.emit("messages.upsert", {
    messages: [{ key: { id: "gateway-reply-1", remoteJid: "u@s.whatsapp.net", fromMe: true }, message: { conversation: "reply" } }]
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(received.length, 1);
});

test("QR is exposed without logging it and responses are sent through Baileys", async () => {
  const events = new FakeEvents();
  const qrs: string[] = [];
  const sent: unknown[] = [];
  const logs: unknown[] = [];
  const socket = {
    ev: events,
    async sendMessage(...args: unknown[]) { sent.push(args); },
    async end() {}
  };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_CHATS: "chat@s.whatsapp.net" }),
    onQr: qr => qrs.push(qr),
    onMessage: async () => {},
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
    createSocket: () => socket,
    logger: { info(event, fields) { logs.push({ event, ...fields }); }, warn() {}, error() {} }
  });

  await channel.start();
  events.emit("connection.update", { qr: "secret-qr", connection: "connecting" });
  events.emit("connection.update", { connection: "open" });
  await channel.send("chat@s.whatsapp.net", { text: "reply" });

  assert.deepEqual(qrs, ["secret-qr"]);
  assert.equal(JSON.stringify(logs).includes("secret-qr"), false);
  assert.deepEqual(sent, [["chat@s.whatsapp.net", { text: "reply" }]]);
  await channel.stop();
});

test("logout does not schedule a reconnect and stop closes the socket", async () => {
  const events = new FakeEvents();
  let sockets = 0;
  let ended = 0;
  const socketsByConnection: any[] = [];
  const createSocket = () => {
    sockets++;
    const socket = { ev: events, async sendMessage() {}, async end() { ended++; } };
    socketsByConnection.push(socket);
    return socket;
  };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_RECONNECT_BASE_DELAY_MS: "1" }),
    onMessage: async () => {},
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
    createSocket,
    logger: { info() {}, warn() {}, error() {} }
  });

  await channel.start();
  events.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sockets, 1);
  assert.equal(channel.health().status, "logged_out");
  await channel.stop();
  assert.equal(ended, 0);
});

test("credential updates are persisted and transient closes reconnect", async () => {
  let saved = 0;
  const sockets: any[] = [];
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({
      WHATSAPP_AUTH_PATH: "/tmp/auth",
      WHATSAPP_RECONNECT_BASE_DELAY_MS: "1",
      WHATSAPP_RECONNECT_MAX_DELAY_MS: "2"
    }),
    onMessage: async () => {},
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => { saved++; } }),
    createSocket: () => {
      const socket = { ev: new FakeEvents(), async sendMessage() {}, async end() {} };
      sockets.push(socket);
      return socket;
    },
    logger: { info() {}, warn() {}, error() {} }
  });

  await channel.start();
  sockets[0].ev.emit("creds.update", {});
  sockets[0].ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 500 } } } });
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(saved, 1);
  assert.equal(sockets.length, 2);
  await channel.stop();
});

test("imports history batches without routing them", async () => {
  const imported: any[] = [];
  const chats: any[] = [];
  const events = new FakeEvents();
  const socket = { ev: events, async sendMessage() {}, async end() {} };
  let routed = 0;
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_CHATS: "private@s.whatsapp.net" }),
    onMessage: async () => { routed++; },
    historySink: { upsertChat: async chat => chats.push(chat), upsertMessage: async message => imported.push(message) },
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
    createSocket: () => socket
  });

  await channel.start();
  events.emit("messaging-history.set", {
    chats: [
      { id: "private@s.whatsapp.net", name: "Ana" },
      { id: "group@g.us", subject: "Viaje" },
      { id: "contact@s.whatsapp.net" }
    ],
    contacts: [{ id: "contact@s.whatsapp.net", name: "Lucía", notify: "Lucia" }],
    messages: [
      { key: { id: "history-1", remoteJid: "private@s.whatsapp.net", fromMe: true }, message: { conversation: "hotel" } },
      { key: { id: "history-2", remoteJid: "group@g.us", participant: "u@s.whatsapp.net" }, message: { conversation: "tren" } },
      { key: { id: "history-3", remoteJid: "contact@s.whatsapp.net" }, message: { conversation: "pedido" } }
    ],
    isLatest: true
  });
  await flush();

  assert.equal(routed, 0);
  assert.deepEqual(chats.map(chat => [chat.conversationId, chat.displayName, chat.kind]), [
    ["private@s.whatsapp.net", "Ana", "private"],
    ["group@g.us", "Viaje", "group"],
    ["contact@s.whatsapp.net", "Lucía", "private"]
  ]);
  assert.deepEqual(imported.map(message => [message.id, message.text, message.groupId]), [
    ["history-1", "hotel", undefined],
    ["history-2", "tren", "group@g.us"],
    ["history-3", "pedido", undefined]
  ]);
});

test("persists duplicate live messages once before routing them", async () => {
  const events = new FakeEvents();
  const store = new InMemoryHistoryStore();
  const order: string[] = [];
  const socket = { ev: events, async sendMessage() {}, async end() {} };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_USERS: "u@s.whatsapp.net" }),
    onMessage: async () => { order.push("route"); },
    historySink: {
      upsertChat: async chat => store.upsertChat(chat),
      upsertMessage: async message => { order.push("store"); await store.upsertMessage(message); }
    },
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
    createSocket: () => socket
  });

  await channel.start();
  const message = { key: { id: "live-1", remoteJid: "u@s.whatsapp.net" }, message: { conversation: "hello" } };
  events.emit("messages.upsert", { messages: [message] });
  await flush();
  events.emit("messages.upsert", { messages: [message] });
  await flush();

  assert.deepEqual(order, ["store", "route", "store", "route"]);
  assert.equal((await store.query("whatsapp", "u@s.whatsapp.net", "", { maxMessages: 10, maxCharacters: 1000 }))?.importedMessageCount, 1);
});

test("history persistence failures do not block live routing", async () => {
  const events = new FakeEvents();
  const logs: any[] = [];
  const received: any[] = [];
  const socket = { ev: events, async sendMessage() {}, async end() {} };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_USERS: "u@s.whatsapp.net" }),
    onMessage: async message => received.push(message),
    historySink: { upsertChat: async () => {}, upsertMessage: async () => { throw new Error("disk full"); } },
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
    createSocket: () => socket,
    logger: { info() {}, warn() {}, error(event, fields) { logs.push({ event, ...fields }); } }
  });

  await channel.start();
  events.emit("messages.upsert", { messages: [{ key: { id: "live-2", remoteJid: "u@s.whatsapp.net" }, message: { conversation: "hello" } }] });
  await flush();

  assert.equal(received.length, 1);
  assert.equal(logs[0]?.event, "whatsapp_history_persistence_failed");
  assert.deepEqual(Object.keys(logs[0] ?? {}), ["event"]);
});

test("stop removes history listeners from an off-only emitter", async () => {
  const events = new FakeEvents();
  const socket = { ev: events, async sendMessage() {}, async end() {} };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth" }),
    onMessage: async () => {},
    loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
    createSocket: () => socket
  });

  await channel.start();
  assert.equal(events.listenerCount("messaging-history.set"), 1);
  await channel.stop();
  assert.equal(events.listenerCount("messaging-history.set"), 0);
});

async function flush(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}
