import type { ConversationAgent } from "../../../packages/core/src/index.js";

export const codexAgent: ConversationAgent = {
  id: "codex",
  type: "developer-agent",
  async handleMessage() {
    return { text: "Codex adapter is registered but CLI execution is not configured." };
  }
};
