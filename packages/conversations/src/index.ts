import type { Conversation, ConversationContext, ExecutionContext, Message, Route } from "../../core/src/index.js";

export * from "./history.js";
export * from "./import.js";

export interface ConversationStore {
  getOrCreate(message: Message): Promise<Conversation>;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, Conversation>();

  async getOrCreate(message: Message): Promise<Conversation> {
    const key = `${message.channel}:${message.conversationId}`;
    const existing = this.conversations.get(key);
    if (existing) return existing;
    const conversation: Conversation = {
      id: message.conversationId,
      channel: message.channel,
      participantIds: [message.senderId],
      metadata: {}
    };
    this.conversations.set(key, conversation);
    return conversation;
  }
}

export function createConversationContext(
  message: Message,
  conversation: Conversation,
  route: Route,
  execution: ExecutionContext
): ConversationContext {
  return { message, conversation, route, execution };
}
