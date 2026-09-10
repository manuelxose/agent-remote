import type { AgentRuntime, Channel, ConversationAgent } from "../../../packages/core/src/index.js";
import type { EventBus } from "../../../packages/events/src/index.js";
import { createConversationContext, type ConversationStore } from "../../../packages/conversations/src/index.js";
import type { RouteResolver } from "../../../packages/routing/src/index.js";

export interface GatewayDependencies {
  channel: Channel;
  conversations: ConversationStore;
  router: RouteResolver;
  runtimes: Readonly<Record<string, AgentRuntime>>;
  agents: Readonly<Record<string, ConversationAgent>>;
  events: EventBus;
}

export class Gateway {
  constructor(private readonly dependencies: GatewayDependencies) {}

  async handle(payload: unknown): Promise<void> {
    const { channel, conversations, router, runtimes, agents, events } = this.dependencies;
    const message = await channel.receive(payload);
    await events.publish({ type: "MessageReceived", occurredAt: new Date(), correlationId: message.id, payload: message });
    const conversation = await conversations.getOrCreate(message);
    const route = router.resolve(message.channel, message.conversationId);
    await events.publish({ type: "RouteResolved", occurredAt: new Date(), correlationId: message.id, payload: route });
    const runtime = runtimes[route.runtime];
    const agent = agents[route.agent];
    if (!runtime || !agent) throw new Error(`No runtime or agent registered for route ${route.id}`);
    const response = await runtime.execute(createConversationContext(message, conversation, route, {
      correlationId: message.id,
      conversationId: conversation.id
    }), agent);
    await channel.send(message.conversationId, response);
    await events.publish({ type: "MessageSent", occurredAt: new Date(), correlationId: message.id, payload: response });
  }
}
