import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ConversationContext, ConversationAgent, Message } from "../packages/core/src/index.ts";

test("core contracts describe a channel-neutral agent invocation", async () => {
  const agent: ConversationAgent = {
    id: "example",
    type: "developer-agent",
    async handleMessage(context: ConversationContext) {
      return { text: `received ${context.message.text}` };
    }
  };

  const context: ConversationContext = {
    message: {
      id: "message-1",
      conversationId: "conversation-1",
      channel: "whatsapp",
      senderId: "sender-1",
      text: "hello",
      receivedAt: new Date(0)
    },
    conversation: {
      id: "conversation-1",
      channel: "whatsapp",
      participantIds: ["sender-1"],
      metadata: {}
    },
    route: {
      id: "whatsapp-group-claude",
      runtime: "developer-agent",
      agent: "claude"
    },
    execution: {
      correlationId: "correlation-1",
      conversationId: "conversation-1",
      workspaceRoot: "/workspace"
    }
  };

  assert.deepEqual(await agent.handleMessage(context), { text: "received hello" });
});

test("message supports channel-neutral group and attachment metadata", () => {
  const message: Message = {
    id: "m1",
    conversationId: "c1",
    channel: "test",
    senderId: "u1",
    text: "caption",
    receivedAt: new Date(0),
    groupId: "g1",
    attachments: [{ kind: "image", mimeType: "image/png", fileName: "x.png", size: 12 }]
  };

  assert.equal(message.attachments?.[0].kind, "image");
});
