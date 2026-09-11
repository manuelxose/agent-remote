import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ConfigurationRouter, RouteNotFoundError } from "../dist/packages/routing/src/index.js";
import { InMemoryEventBus, eventTypes } from "../dist/packages/events/src/index.js";

test("configuration router maps a conversation to the configured developer agent", () => {
  const router = new ConfigurationRouter({
    "whatsapp-group-claude": { id: "whatsapp-group-claude", runtime: "developer-agent", agent: "claude" },
    "whatsapp-group-codex": { id: "whatsapp-group-codex", runtime: "developer-agent", agent: "codex" },
    "whatsapp-group-copilot": { id: "whatsapp-group-copilot", runtime: "developer-agent", agent: "copilot" }
  });

  assert.equal(router.resolve("whatsapp", "group-codex").agent, "codex");
});

test("configuration router preserves a future chatbot tenant route", () => {
  const router = new ConfigurationRouter({
    "talkaris-support": { id: "talkaris-support", runtime: "chatbot", agent: "talkaris", tenant: "talkaris" }
  });

  assert.deepEqual(router.resolve("talkaris", "support"), {
    id: "talkaris-support",
    runtime: "chatbot",
    agent: "talkaris",
    tenant: "talkaris"
  });
});

test("configuration router rejects an unknown conversation", () => {
  const router = new ConfigurationRouter({});
  assert.throws(() => router.resolve("whatsapp", "missing"), RouteNotFoundError);
});

test("in-memory event bus delivers every required event type", async () => {
  const bus = new InMemoryEventBus();
  const received: string[] = [];
  const unsubscribe = bus.subscribe("MessageReceived", event => received.push(event.type));

  for (const type of eventTypes) {
    await bus.publish({ type, occurredAt: new Date(0), correlationId: "correlation-1", payload: {} });
  }

  unsubscribe();
  assert.deepEqual(received, ["MessageReceived"]);
  assert.deepEqual(eventTypes, [
    "MessageReceived",
    "RouteResolved",
    "AgentExecutionStarted",
    "ToolExecutionRequested",
    "ApprovalRequested",
    "AgentExecutionCompleted",
    "AgentExecutionFailed",
    "MessageSent",
    "conversation.initialized",
    "conversation.closed",
    "conversation.renamed",
    "agent.selected",
    "model.resolved",
    "workspace.selected",
    "command.received",
    "command.completed",
    "command.rejected",
    "execution.queued",
    "execution.started",
    "execution.completed",
    "execution.failed",
    "execution.cancelled",
    "message.duplicate",
    "security.denied",
    "execution.accepted",
    "provider.started",
    "assistant.delta",
    "assistant.message",
    "tool.started",
    "tool.progress",
    "tool.completed"
  ]);
});
