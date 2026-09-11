import type { AgentGeneratedMessageMetadata } from "../../../channels/whatsapp/src/agent-registry.js";

export type PresentationRegistryEntry = AgentGeneratedMessageMetadata;

export interface WhatsAppMessageLocator {
  findByMessageId(id: string): HTMLElement | undefined;
}
