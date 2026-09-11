import type { AgentGeneratedMessageMetadata } from "../../../channels/whatsapp/src/agent-registry.js";
import { conversationIdForElement } from "./locator.js";
import type { WhatsAppMessageLocator } from "./protocol.js";

export function applyAgentPresentation(element: HTMLElement, metadata: AgentGeneratedMessageMetadata): void {
  const agentId = metadata.origin.agentId ?? "agent";
  const agent = logicalAgentName(agentId);
  element.dataset.agentRemoteOrigin = "agent";
  element.dataset.agentId = agentId;
  element.classList.add("agent-remote-message");
  element.setAttribute("aria-label", agent);
}

export function syncAgentPresentation(
  _root: HTMLElement,
  entries: readonly AgentGeneratedMessageMetadata[],
  locator: WhatsAppMessageLocator
): number {
  let updated = 0;
  for (const entry of entries) {
    const element = locator.findByMessageId(entry.whatsappMessageId);
    if (!element || conversationIdForElement(element) !== entry.conversationId || element.dataset.agentRemoteOrigin === "agent") continue;
    applyAgentPresentation(element, entry);
    updated++;
  }
  return updated;
}

function logicalAgentName(agentId: string): string {
  return agentId.replace(/[-_]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}
