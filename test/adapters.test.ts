import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WhatsAppChannel, InvalidWhatsAppPayloadError } from "../dist/channels/whatsapp/src/index.js";
import { claudeAgent } from "../dist/developer-agents/claude/src/index.js";
import { codexAgent } from "../dist/developer-agents/codex/src/index.js";
import { copilotAgent } from "../dist/developer-agents/copilot/src/index.js";
import { talkarisAgent } from "../dist/integrations/talkaris/src/index.js";

test("WhatsApp channel translates payloads without agent knowledge", async () => {
  const sent: string[] = [];
  const channel = new WhatsAppChannel(async (conversationId, text) => sent.push(`${conversationId}:${text}`));
  const message = await channel.receive({ messageId: "m1", conversationId: "group-claude", senderId: "u1", text: "hello" });

  assert.equal(message.channel, "whatsapp");
  assert.equal(message.conversationId, "group-claude");
  await channel.send("group-claude", { text: "response" });
  assert.deepEqual(sent, ["group-claude:response"]);
});

test("WhatsApp channel rejects malformed transport payloads", async () => {
  const channel = new WhatsAppChannel(async () => undefined);
  await assert.rejects(() => channel.receive({ text: "missing identity" }), InvalidWhatsAppPayloadError);
});

test("agent adapters register independently of the WhatsApp channel", () => {
  assert.deepEqual(
    [claudeAgent, codexAgent, copilotAgent].map(agent => [agent.id, agent.type]),
    [["claude", "developer-agent"], ["codex", "developer-agent"], ["copilot", "developer-agent"]]
  );
  assert.equal(talkarisAgent.id, "talkaris");
  assert.equal(talkarisAgent.type, "chatbot");
});
