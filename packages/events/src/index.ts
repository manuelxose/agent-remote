export const eventTypes = [
  "MessageReceived",
  "RouteResolved",
  "AgentExecutionStarted",
  "ToolExecutionRequested",
  "ApprovalRequested",
  "AgentExecutionCompleted",
  "AgentExecutionFailed",
  "MessageSent"
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
