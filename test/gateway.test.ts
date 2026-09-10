import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Gateway } from "../dist/apps/gateway/src/index.js";
import { InMemoryConversationStore } from "../dist/packages/conversations/src/index.js";
import { InMemoryEventBus } from "../dist/packages/events/src/index.js";
import { ConfigurationRouter } from "../dist/packages/routing/src/index.js";

test("gateway executes the channel-neutral conversation route runtime agent flow", async () => {
  const sent: string[] = [];
  const events = new InMemoryEventBus();
  const observed: string[] = [];
  for (const type of ["MessageReceived", "RouteResolved", "MessageSent"] as const) {
    events.subscribe(type, event => { observed.push(event.type); });
  }
  const gateway = new Gateway({
    channel: {
      id: "test",
      async receive() {
        return { id: "m1", conversationId: "group-claude", channel: "whatsapp", senderId: "u1", text: "hello", receivedAt: new Date(0) };
      },
      async send(conversationId, response) { sent.push(`${conversationId}:${response.text}`); }
    },
    conversations: new InMemoryConversationStore(),
    router: new ConfigurationRouter({
      "whatsapp-group-claude": { id: "whatsapp-group-claude", runtime: "developer-agent", agent: "claude" }
    }),
    runtimes: {
      "developer-agent": {
        type: "developer-agent",
        async execute(_context, agent) { return agent.handleMessage(_context); }
      }
    },
    agents: {
      claude: { id: "claude", type: "developer-agent", async handleMessage() { return { text: "handled" }; } }
    },
    events
  });

  await gateway.handle({});
  assert.deepEqual(sent, ["group-claude:handled"]);
  assert.deepEqual(observed, ["MessageReceived", "RouteResolved", "MessageSent"]);
});
