import type { ConversationAgent } from "../../../packages/core/src/index.js";

export const talkarisAgent: ConversationAgent = {
  id: "talkaris",
  type: "chatbot",
  async handleMessage() {
    return { text: "Talkaris integration is registered but business logic is not configured." };
  }
};
