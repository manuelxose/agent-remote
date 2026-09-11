export const eventTypes = [
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
  "security.denied"
] as const;

export type DomainEventType = (typeof eventTypes)[number];

export interface DomainEvent {
  type: DomainEventType;
  occurredAt: Date;
  correlationId: string;
  payload: unknown;
}

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(type: DomainEventType, handler: EventHandler): () => void;
}

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<DomainEventType, Set<EventHandler>>();

  async publish(event: DomainEvent): Promise<void> {
    for (const handler of this.handlers.get(event.type) ?? []) await handler(event);
  }

  subscribe(type: DomainEventType, handler: EventHandler): () => void {
    const handlers = this.handlers.get(type) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.handlers.set(type, handlers);
    return () => handlers.delete(handler);
  }
}
