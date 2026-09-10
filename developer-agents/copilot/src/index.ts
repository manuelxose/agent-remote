import type { ConversationAgent } from "../../../packages/core/src/index.js";

export const copilotAgent: ConversationAgent = {
  id: "copilot",
  type: "developer-agent",
  async handleMessage() {
    return { text: "Copilot adapter is registered but CLI execution is not configured." };
  }
};
