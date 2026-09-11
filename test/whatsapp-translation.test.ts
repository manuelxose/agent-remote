import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  authorizeWhatsAppMessage,
  parseWhatsAppConfig,
  WhatsAppConfigurationError
} from "../dist/channels/whatsapp/src/config.js";
import { translateWhatsAppMessage } from "../dist/channels/whatsapp/src/translate.js";

test("translates a group media message into a channel-neutral Message", () => {
  const result = translateWhatsAppMessage({
    key: { id: "m1", remoteJid: "120@g.us", participant: "u@s.whatsapp.net", fromMe: false },
    messageTimestamp: 1700000000,
    message: { imageMessage: { caption: "see", mimetype: "image/png", fileName: "a.png", fileLength: 9 } }
  });

  assert.deepEqual(result && { ...result, receivedAt: result.receivedAt.getTime() }, {
    id: "m1",
    conversationId: "120@g.us",
    channel: "whatsapp",
    senderId: "u@s.whatsapp.net",
    groupId: "120@g.us",
    text: "see",
    receivedAt: 1700000000000,
    attachments: [{ kind: "image", mimeType: "image/png", fileName: "a.png", size: 9 }]
  });
});

test("rejects self-sent and textless transport messages", () => {
  assert.equal(translateWhatsAppMessage({ key: { id: "m1", remoteJid: "u@s.whatsapp.net", fromMe: true }, message: { conversation: "loop" } }), undefined);
  assert.equal(translateWhatsAppMessage({ key: { id: "m2", remoteJid: "u@s.whatsapp.net" }, message: { reactionMessage: {} } }), undefined);
});

test("allows an explicitly enabled self-sent prompt", () => {
  const message = translateWhatsAppMessage(
    { key: { id: "m-self", remoteJid: "u@s.whatsapp.net", fromMe: true }, message: { conversation: "hello" } },
    { allowSelfMessages: true }
  );

  assert.equal(message?.senderId, "u@s.whatsapp.net");
  assert.equal(message?.text, "hello");
});

test("uses the phone JID when Baileys provides a LID and participantAlt", () => {
  const message = translateWhatsAppMessage({
    key: {
      id: "m-lid",
      remoteJid: "120@g.us",
      participant: "177970694115489@lid",
      participantAlt: "34673426433@s.whatsapp.net"
    },
    message: { conversation: "hello" }
  });

  assert.equal(message?.senderId, "34673426433@s.whatsapp.net");
});

test("configuration fails closed and requires an auth path", () => {
  assert.throws(() => parseWhatsAppConfig({}), WhatsAppConfigurationError);
  assert.deepEqual(parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/whatsapp-auth" }), {
    authPath: "/tmp/whatsapp-auth",
    allowedUsers: [],
    allowedChats: [],
    allowSelfMessages: false,
    reconnectBaseDelayMs: 1000,
    reconnectMaxDelayMs: 30000,
    maxResponseChars: 4000
  });
});

test("parses the one-number self-message opt-in", () => {
  assert.equal(parseWhatsAppConfig({
    WHATSAPP_AUTH_PATH: "/tmp/whatsapp-auth",
    WHATSAPP_ALLOW_SELF_MESSAGES: "true"
  }).allowSelfMessages, true);
});

test("authorization requires every configured filter and matches group IDs", () => {
  const config = parseWhatsAppConfig({
    WHATSAPP_AUTH_PATH: "/tmp/auth",
    WHATSAPP_ALLOWED_USERS: "u@s.whatsapp.net",
    WHATSAPP_ALLOWED_CHATS: "120@g.us"
  });
  const message = translateWhatsAppMessage({
    key: { id: "m1", remoteJid: "120@g.us", participant: "u@s.whatsapp.net" },
    message: { conversation: "hello" }
  });

  assert.ok(message);
  assert.deepEqual(authorizeWhatsAppMessage(message, config), { allowed: true });
  assert.deepEqual(authorizeWhatsAppMessage({ ...message, senderId: "unknown@lid" }, parseWhatsAppConfig({
    WHATSAPP_AUTH_PATH: "/tmp/auth",
    WHATSAPP_ALLOWED_USERS: "u@s.whatsapp.net",
    WHATSAPP_ALLOW_SELF_MESSAGES: "true"
  }), true), { allowed: true });
  assert.deepEqual(authorizeWhatsAppMessage({ ...message, senderId: "other@s.whatsapp.net" }, config), {
    allowed: false,
    reason: "sender_not_allowlisted"
  });
  assert.deepEqual(authorizeWhatsAppMessage({ ...message, conversationId: "other@g.us", groupId: "other@g.us" }, config), {
    allowed: false,
    reason: "chat_not_allowlisted"
  });
});

test("empty allowlists deny an otherwise valid message", () => {
  const config = parseWhatsAppConfig({ WHATSAPP_AUTH_PATH: "/tmp/auth" });
  const message = translateWhatsAppMessage({ key: { id: "m1", remoteJid: "u@s.whatsapp.net" }, message: { conversation: "hello" } });
  assert.ok(message);
  assert.deepEqual(authorizeWhatsAppMessage(message, config), { allowed: false, reason: "no_allowlist_configured" });
});
