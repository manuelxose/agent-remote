import assert from "node:assert/strict";
import test from "node:test";
import { applyAgentPresentation, syncAgentPresentation } from "../dist/presentation/whatsapp-companion/src/augment.js";
import type { AgentGeneratedMessageMetadata } from "../dist/channels/whatsapp/src/agent-registry.js";
import { createPresentationBridge } from "../dist/apps/gateway/src/presentation-bridge.js";

class FakeMessageElement {
  readonly dataset: Record<string, string | undefined>;
  private readonly classes = new Set<string>();
  readonly classList = { add: (name: string) => this.classes.add(name), has: (name: string) => this.classes.has(name) };
  textContent = "unchanged WhatsApp message";
  ariaLabel?: string;
  readonly messageId: string;
  readonly conversationId: string;

  constructor(messageId: string, conversationId: string, data: Record<string, string> = {}) {
    this.messageId = messageId;
    this.conversationId = conversationId;
    this.dataset = { id: messageId, conversationId, ...data };
  }

  setAttribute(name: string, value: string): void {
    if (name === "aria-label") this.ariaLabel = value;
    else this.dataset[name.replace(/-([a-z])/g, (_, character: string) => character.toUpperCase())] = value;
  }
}

function metadata(whatsappMessageId: string, agentId: string, conversationId: string): AgentGeneratedMessageMetadata {
  return {
    whatsappMessageId,
    conversationId,
    origin: { type: "agent", agentId, executionId: "execution-a", logicalSessionId: "session-a" },
    createdAt: 1
  };
}

function locatorFor(...elements: FakeMessageElement[]) {
  return { findByMessageId: (messageId: string) => elements.find(element => element.messageId === messageId) };
}

test("companion augments only an exact registered agent message", () => {
  const human = new FakeMessageElement("wa-human-a", "chat-a");
  const agent = new FakeMessageElement("wa-agent-a", "chat-a");

  const updated = syncAgentPresentation({} as HTMLElement, [metadata("wa-agent-a", "claude", "chat-a")], locatorFor(human, agent) as never);

  assert.equal(updated, 1);
  assert.equal(agent.dataset.agentRemoteOrigin, "agent");
  assert.equal(agent.dataset.agentId, "claude");
  assert.equal(human.dataset.agentRemoteOrigin, undefined);
});

test("conversation mismatch prevents visual transformation", () => {
  const agent = new FakeMessageElement("wa-agent-a", "chat-a");

  const updated = syncAgentPresentation({} as HTMLElement, [metadata("wa-agent-a", "claude", "other-chat")], locatorFor(agent) as never);

  assert.equal(updated, 0);
  assert.equal(agent.dataset.agentRemoteOrigin, undefined);
});

test("repeat sync is idempotent and leaves WhatsApp message text unchanged", () => {
  const agent = new FakeMessageElement("wa-agent-a", "chat-a");
  const entry = metadata("wa-agent-a", "codex", "chat-a");

  assert.equal(syncAgentPresentation({} as HTMLElement, [entry], locatorFor(agent) as never), 1);
  assert.equal(syncAgentPresentation({} as HTMLElement, [entry], locatorFor(agent) as never), 0);
  assert.equal(agent.textContent, "unchanged WhatsApp message");
  assert.equal(agent.ariaLabel, "Codex");
});

test("a newly inserted exact message is augmented on the next sync", () => {
  const agent = new FakeMessageElement("wa-agent-a", "chat-a");
  let available: FakeMessageElement | undefined;
  const locator = { findByMessageId: (messageId: string) => available?.messageId === messageId ? available : undefined };

  assert.equal(syncAgentPresentation({} as HTMLElement, [metadata("wa-agent-a", "claude", "chat-a")], locator as never), 0);
  available = agent;
  assert.equal(syncAgentPresentation({} as HTMLElement, [metadata("wa-agent-a", "claude", "chat-a")], locator as never), 1);
  assert.equal(agent.dataset.agentRemoteOrigin, "agent");
});

test("augmentation ignores a locator that cannot resolve an exact registry ID", () => {
  const agent = new FakeMessageElement("wa-agent-a", "chat-a");

  assert.equal(syncAgentPresentation({} as HTMLElement, [metadata("wa-agent-b", "claude", "chat-a")], locatorFor(agent) as never), 0);
  assert.equal(agent.dataset.agentRemoteOrigin, undefined);
});

test("applyAgentPresentation uses a logical agent label without changing text", () => {
  const agent = new FakeMessageElement("wa-agent-a", "chat-a");

  applyAgentPresentation(agent as never, metadata("wa-agent-a", "claude", "chat-a"));

  assert.equal(agent.textContent, "unchanged WhatsApp message");
  assert.equal(agent.ariaLabel, "Claude");
  assert.equal(agent.classList.has("agent-remote-message"), true);
});

test("loopback bridge exposes only an authenticated WhatsApp registry snapshot", async () => {
  const bridge = createPresentationBridge({
    host: "127.0.0.1",
    port: 0,
    token: "presentation-test-token",
    readRegistry: () => [metadata("wa-agent-a", "claude", "chat-a")],
    allowedOrigin: "https://web.whatsapp.com"
  });
  await bridge.start();
  try {
    const baseUrl = `http://${bridge.address()}`;
    const missingToken = await fetch(`${baseUrl}/registry`, { headers: { Origin: "https://web.whatsapp.com" } });
    const wrongOrigin = await fetch(`${baseUrl}/registry`, { headers: { Origin: "https://example.test", "x-agent-remote-token": "presentation-test-token" } });
    const accepted = await fetch(`${baseUrl}/registry`, { headers: { Origin: "https://web.whatsapp.com", "x-agent-remote-token": "presentation-test-token" } });
    const wrongMethod = await fetch(`${baseUrl}/registry`, { method: "POST", headers: { Origin: "https://web.whatsapp.com", "x-agent-remote-token": "presentation-test-token" } });
    const unknownRoute = await fetch(`${baseUrl}/anything`, { headers: { Origin: "https://web.whatsapp.com", "x-agent-remote-token": "presentation-test-token" } });

    assert.equal(missingToken.status, 403);
    assert.equal(wrongOrigin.status, 403);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get("cache-control"), "no-store");
    assert.deepEqual(await accepted.json(), [metadata("wa-agent-a", "claude", "chat-a")]);
    assert.equal(wrongMethod.status, 405);
    assert.equal(unknownRoute.status, 404);
  } finally {
    await bridge.stop();
  }
});
