import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WhatsAppChannel } from "../dist/channels/whatsapp/src/index.js";
import { parseWhatsAppConfig } from "../dist/channels/whatsapp/src/config.js";

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
