import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WhatsAppChannel } from "../dist/channels/whatsapp/src/index.js";
import { parseWhatsAppConfig } from "../dist/channels/whatsapp/src/config.js";

class Events {
  private readonly listeners = new Map<string, Set<(value: any) => void>>();
  on(event: string, listener: (value: any) => void): void { const set = this.listeners.get(event) ?? new Set(); set.add(listener); this.listeners.set(event, set); }
  off(event: string, listener: (value: any) => void): void { this.listeners.get(event)?.delete(listener); }
  emit(event: string, value: any): void { for (const listener of this.listeners.get(event) ?? []) listener(value); }
}

test("WhatsApp sends each correlated chunk as a native quoted reply", async () => {
  const sent: any[] = [];
  const socket = {
    ev: new Events(),
    async sendMessage(...args: any[]) { sent.push(args); return { key: { id: `out-${sent.length}` } }; },
    async sendPresenceUpdate(...args: any[]) { sent.push(["presence", ...args]); },
    async end() {}
  };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_USERS: "u@s.whatsapp.net", WHATSAPP_MAX_RESPONSE_CHARS: "4", WHATSAPP_REPLY_CONTEXT_TTL_MS: "1000" }),
    onMessage: async () => {}, loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }), createSocket: () => socket
  });
  await channel.start();
  socket.ev.emit("connection.update", { connection: "open" });
  const message = await channel.receive({ key: { id: "incoming-1", remoteJid: "u@s.whatsapp.net" }, message: { conversation: "hello" } });
  await channel.send("u@s.whatsapp.net", { text: "abcdefgh", replyTo: message.replyReference });
  const replies = sent.filter(args => args[0] !== "presence");
  assert.equal(replies.length, 2);
  assert.equal(replies[0][2].quoted.key.id, "incoming-1");
  assert.equal(replies[1][2].quoted.key.id, "incoming-1");
  await channel.setPresence("u@s.whatsapp.net", "composing");
  assert.deepEqual(sent.find(args => args[0] === "presence"), ["presence", "composing", "u@s.whatsapp.net"]);
  await channel.stop();
});

test("expired or unknown WhatsApp reply context falls back to an ordinary send", async () => {
  const sent: any[] = [];
  const socket = { ev: new Events(), async sendMessage(...args: any[]) { sent.push(args); }, async end() {} };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_REPLY_CONTEXT_TTL_MS: "1" }),
    onMessage: async () => {}, loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }), createSocket: () => socket
  });
  await channel.start();
  socket.ev.emit("connection.update", { connection: "open" });
  await new Promise(resolve => setTimeout(resolve, 5));
  await channel.send("chat@s.whatsapp.net", { text: "fallback", replyTo: { channel: "whatsapp", conversationId: "chat@s.whatsapp.net", messageId: "missing" } });
  assert.equal(sent[0].length, 2);
  await channel.stop();
});

test("registry preserves exact Baileys IDs and response metadata", async () => {
  const socket = {
    ev: new Events(),
    async sendMessage() { return { key: { id: "wa-agent-a" } }; },
    async end() {}
  };
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth", WHATSAPP_ALLOWED_USERS: "u@s.whatsapp.net" }),
    onMessage: async () => {}, loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }), createSocket: () => socket
  });
  await channel.start();
  socket.ev.emit("connection.update", { connection: "open" });
  await channel.send("u@s.whatsapp.net", {
    text: "reply",
    replyTo: { channel: "whatsapp", conversationId: "u@s.whatsapp.net", messageId: "incoming-a" },
    origin: { type: "agent", agentId: "claude", executionId: "exec-a", logicalSessionId: "session-a" }
  });
  const [entry] = channel.agentMessageRegistry();
  assert.equal(entry?.whatsappMessageId, "wa-agent-a");
  assert.equal(entry?.conversationId, "u@s.whatsapp.net");
  assert.deepEqual(entry?.origin, { type: "agent", agentId: "claude", executionId: "exec-a", logicalSessionId: "session-a" });
  assert.equal(entry?.replyToMessageId, "incoming-a");
  assert.equal(typeof entry?.createdAt, "number");
  assert.equal(channel.agentMessageRegistry().some(item => item.whatsappMessageId === "wa-human-a"), false);
  await channel.stop();
});
