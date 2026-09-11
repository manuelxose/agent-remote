import type { Message, MessageAttachment } from "../../../packages/core/src/index.js";

interface RawMessageKey {
  id?: unknown;
  remoteJid?: unknown;
  participant?: unknown;
  participantAlt?: unknown;
  fromMe?: unknown;
}

interface RawWhatsAppMessage {
  key?: RawMessageKey;
  messageTimestamp?: unknown;
  message?: Record<string, unknown>;
}

export interface WhatsAppTranslationOptions {
  allowSelfMessages?: boolean;
}

const attachmentKinds = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  stickerMessage: "sticker"
} as const;

export function translateWhatsAppMessage(payload: unknown, options: WhatsAppTranslationOptions = {}): Message | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const legacy = payload as Record<string, unknown>;
  if (["messageId", "conversationId", "senderId", "text"].every(key => typeof legacy[key] === "string")) {
    return {
      id: legacy.messageId as string,
      conversationId: legacy.conversationId as string,
      channel: "whatsapp",
      senderId: legacy.senderId as string,
      text: legacy.text as string,
      receivedAt: legacy.receivedAt ? new Date(legacy.receivedAt as string) : new Date()
    };
  }
  const raw = payload as RawWhatsAppMessage;
  const key = raw.key;
  const id = stringValue(key?.id);
  const conversationId = stringValue(key?.remoteJid);
  if (!id || !conversationId || (key?.fromMe === true && !options.allowSelfMessages) || isNonConversation(conversationId)) return undefined;

  const message = unwrapMessage(raw.message);
  if (!message) return undefined;
  const text = extractText(message);
  const attachments = extractAttachments(message);
  if (text === undefined && attachments.length === 0) return undefined;

  const participant = stringValue(key?.participant);
  const participantAlt = stringValue(key?.participantAlt);
  const senderId = participant?.endsWith("@lid")
    ? participantAlt ?? participant
    : participant ?? participantAlt ?? conversationId;
  const groupId = conversationId.endsWith("@g.us") ? conversationId : undefined;
  return {
    id,
    conversationId,
    channel: "whatsapp",
    senderId,
    groupId,
    text: text ?? "",
    receivedAt: new Date(timestampMilliseconds(raw.messageTimestamp)),
    ...(attachments.length > 0 ? { attachments } : {})
  };
}

function unwrapMessage(message: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!message) return undefined;
  for (const wrapper of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2"]) {
    const nested = message[wrapper];
    if (nested && typeof nested === "object") {
      const inner = (nested as Record<string, unknown>).message;
      if (inner && typeof inner === "object") return inner as Record<string, unknown>;
    }
  }
  return message;
}

function extractText(message: Record<string, unknown>): string | undefined {
  const conversation = stringValue(message.conversation);
  if (conversation !== undefined) return conversation;
  const extended = objectValue(message.extendedTextMessage);
  const extendedText = stringValue(extended?.text);
  if (extendedText !== undefined) return extendedText;
  for (const key of Object.keys(attachmentKinds)) {
    const caption = stringValue(objectValue(message[key])?.caption);
    if (caption !== undefined) return caption;
  }
  return undefined;
}

function extractAttachments(message: Record<string, unknown>): MessageAttachment[] {
  const attachments: MessageAttachment[] = [];
  for (const [key, kind] of Object.entries(attachmentKinds)) {
    const descriptor = objectValue(message[key]);
    if (!descriptor) continue;
    const size = numberValue(descriptor.fileLength);
    attachments.push({
      kind,
      ...(stringValue(descriptor.mimetype) ? { mimeType: stringValue(descriptor.mimetype) } : {}),
      ...(stringValue(descriptor.fileName) ? { fileName: stringValue(descriptor.fileName) } : {}),
      ...(size !== undefined ? { size } : {})
    });
  }
  return attachments;
}

function timestampMilliseconds(value: unknown): number {
  const timestamp = numberValue(value);
  return timestamp === undefined ? Date.now() : timestamp * 1000;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    const number = value.toNumber();
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" ? value as Record<string, any> : undefined;
}

function isNonConversation(conversationId: string): boolean {
  return conversationId === "status@broadcast" || conversationId.endsWith("@broadcast");
}
