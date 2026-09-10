import type { AgentResponse, AgentRuntime, ConversationAgent, ConversationContext } from "../../../packages/core/src/index.js";
import type { EventBus } from "../../../packages/events/src/index.js";
import { InMemoryEventBus } from "../../../packages/events/src/index.js";
import { DeveloperCapabilityError, type ToolRegistry } from "../../../packages/tools/src/index.js";

const forbiddenTools = new Set(["shell", "filesystem", "git", "developer-agent"]);

export class ChatbotRuntime implements AgentRuntime {
  readonly type = "chatbot" as const;

  constructor(
    readonly tools: ToolRegistry,
    private readonly events: EventBus = new InMemoryEventBus()
  ) {
    for (const name of tools.names()) if (forbiddenTools.has(name)) throw new DeveloperCapabilityError(name);
  }

  invokeTool(name: string, input: unknown): Promise<unknown> {
    return this.tools.invoke(name, input);
  }

  async execute(context: ConversationContext, agent: ConversationAgent): Promise<AgentResponse> {
    if (context.route.runtime !== this.type || agent.type !== this.type) throw new Error("Chatbot runtime received a non-chatbot agent");
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
