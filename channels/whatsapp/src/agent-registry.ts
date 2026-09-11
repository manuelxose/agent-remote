import type { MessageOrigin } from "../../../packages/core/src/index.js";

export interface AgentGeneratedMessageMetadata {
  whatsappMessageId: string;
  conversationId: string;
  origin: MessageOrigin;
  replyToMessageId?: string;
  createdAt: number;
}

export interface AgentMessageRegistryOptions {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
}

export class AgentMessageRegistry {
  private readonly entries = new Map<string, AgentGeneratedMessageMetadata>();
  private readonly now: () => number;

  constructor(private readonly options: AgentMessageRegistryOptions) {
    if (options.maxEntries <= 0 || options.ttlMs <= 0) throw new RangeError("Registry capacity and TTL must be positive");
    this.now = options.now ?? Date.now;
  }

  remember(metadata: AgentGeneratedMessageMetadata): void {
    this.prune();
    this.entries.set(metadata.whatsappMessageId, this.clone(metadata));
    this.prune();
  }

  get(messageId: string, conversationId?: string): AgentGeneratedMessageMetadata | undefined {
    this.prune();
    const metadata = this.entries.get(messageId);
    if (!metadata || (conversationId !== undefined && metadata.conversationId !== conversationId)) return undefined;
    return this.clone(metadata);
  }

  has(messageId: string): boolean {
    this.prune();
    return this.entries.has(messageId);
  }

  snapshot(): AgentGeneratedMessageMetadata[] {
    this.prune();
    return [...this.entries.values()].map(metadata => this.clone(metadata));
  }

  prune(): void {
    const cutoff = this.now() - this.options.ttlMs;
    for (const [messageId, metadata] of this.entries) if (metadata.createdAt <= cutoff) this.entries.delete(messageId);
    while (this.entries.size > this.options.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  private clone(metadata: AgentGeneratedMessageMetadata): AgentGeneratedMessageMetadata {
    return { ...metadata, origin: { ...metadata.origin } };
  }
}
