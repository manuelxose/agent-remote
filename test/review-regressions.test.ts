import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Gateway, GatewayConfigurationError } from "../dist/apps/gateway/src/index.js";
import { InMemoryConversationStore } from "../dist/packages/conversations/src/index.js";

test("conversation store keeps same IDs isolated across channels", async () => {
  const store = new InMemoryConversationStore();
  const whatsapp = await store.getOrCreate({ id: "m1", conversationId: "same", channel: "whatsapp", senderId: "u", text: "hi", receivedAt: new Date(0) });
  const web = await store.getOrCreate({ id: "m2", conversationId: "same", channel: "web", senderId: "u", text: "hi", receivedAt: new Date(0) });

  assert.equal(whatsapp.channel, "whatsapp");
  assert.equal(web.channel, "web");
  assert.notEqual(whatsapp, web);
});

test("gateway reports an unregistered route dependency clearly", async () => {
  const gateway = new Gateway({
    channel: {
      id: "test",
      async receive() { return { id: "m1", conversationId: "missing", channel: "test", senderId: "u", text: "hi", receivedAt: new Date(0) }; },
      async send() {}
    },
    conversations: new InMemoryConversationStore(),
    router: { resolve: () => ({ id: "route", runtime: "chatbot", agent: "missing" }) },
    runtimes: {},
    agents: {},
    events: { async publish() {}, subscribe: () => () => undefined }
  });

  await assert.rejects(() => gateway.handle({}), new GatewayConfigurationError("route", "runtime", "chatbot"));
});
