import type { ConversationAgent } from "../../../packages/core/src/index.js";

export const claudeAgent: ConversationAgent = {
  id: "claude",
  type: "developer-agent",
  async handleMessage() {
    return { text: "Claude adapter is registered but CLI execution is not configured." };
  }
};
