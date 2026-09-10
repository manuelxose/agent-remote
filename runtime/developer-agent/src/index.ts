import type { AgentResponse, AgentRuntime, ConversationAgent, ConversationContext } from "../../../packages/core/src/index.js";
import type { EventBus } from "../../../packages/events/src/index.js";
import { InMemoryEventBus } from "../../../packages/events/src/index.js";
import type { DeveloperCapabilities } from "../../../packages/security/src/index.js";

export class DeveloperAgentRuntime implements AgentRuntime {
  readonly type = "developer-agent" as const;

  constructor(
    readonly capabilities: DeveloperCapabilities,
    private readonly events: EventBus = new InMemoryEventBus()
  ) {}

  async execute(context: ConversationContext, agent: ConversationAgent): Promise<AgentResponse> {
    if (context.route.runtime !== this.type || agent.type !== this.type) throw new Error("Developer runtime received a non-developer agent");
    await this.events.publish({ type: "AgentExecutionStarted", occurredAt: new Date(), correlationId: context.execution.correlationId, payload: { agent: agent.id } });
    try {
      const response = await agent.handleMessage(context);
      await this.events.publish({ type: "AgentExecutionCompleted", occurredAt: new Date(), correlationId: context.execution.correlationId, payload: { agent: agent.id } });
      return response;
    } catch (error) {
      await this.events.publish({ type: "AgentExecutionFailed", occurredAt: new Date(), correlationId: context.execution.correlationId, payload: { agent: agent.id, error } });
      throw error;
    }
  }
}
