import type { AgentResponse, Channel, Message } from "../../../packages/core/src/index.js";

export interface WhatsAppPayload {
  messageId: string;
  conversationId: string;
  senderId: string;
  text: string;
  receivedAt?: string;
}

export class InvalidWhatsAppPayloadError extends Error {
  constructor() {
    super("Invalid WhatsApp payload");
    this.name = "InvalidWhatsAppPayloadError";
  }
}

export class WhatsAppChannel implements Channel {
  readonly id = "whatsapp";

  constructor(private readonly deliver: (conversationId: string, text: string) => Promise<void>) {}

  async receive(payload: unknown): Promise<Message> {
    if (!isWhatsAppPayload(payload)) throw new InvalidWhatsAppPayloadError();
    return {
      id: payload.messageId,
      conversationId: payload.conversationId,
      channel: this.id,
      senderId: payload.senderId,
      text: payload.text,
      receivedAt: payload.receivedAt ? new Date(payload.receivedAt) : new Date()
    };
  }

  send(conversationId: string, response: AgentResponse): Promise<void> {
    return this.deliver(conversationId, response.text);
  }
}

function isWhatsAppPayload(payload: unknown): payload is WhatsAppPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return ["messageId", "conversationId", "senderId", "text"].every(key => typeof value[key] === "string");
}
