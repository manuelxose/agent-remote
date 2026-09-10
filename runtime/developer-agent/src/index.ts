import type { AgentResponse, AgentRuntime, ConversationAgent, ConversationContext } from "../../../packages/core/src/index.js";
import type { EventBus } from "../../../packages/events/src/index.js";
import { InMemoryEventBus } from "../../../packages/events/src/index.js";
import type { DeveloperCapabilities } from "../../../packages/security/src/index.js";
import type { DeveloperAgentAdapter, DeveloperAgentFailureReason, DeveloperProcessRunner } from "./contracts.js";
import { NodeDeveloperProcessRunner } from "./process.js";
import { createDeveloperSessionKey, JsonDeveloperSessionStore, type DeveloperSessionStore } from "./sessions.js";

type RuntimeFailureReason = DeveloperAgentFailureReason | "adapter-not-configured";

export interface DeveloperAgentRuntimeOptions {
  adapters: Readonly<Record<string, DeveloperAgentAdapter>>;
  sessions?: DeveloperSessionStore;
  defaultWorkspaceRoot: string;
  runner?: DeveloperProcessRunner;
  events?: EventBus;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

type ResolvedDeveloperAgentRuntimeOptions = DeveloperAgentRuntimeOptions & {
  sessions: DeveloperSessionStore;
  runner: DeveloperProcessRunner;
};

export class DeveloperAgentRuntime implements AgentRuntime {
  readonly type = "developer-agent" as const;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly events: EventBus;
  private readonly options: ResolvedDeveloperAgentRuntimeOptions;

  constructor(
    readonly capabilities: DeveloperCapabilities,
    options: DeveloperAgentRuntimeOptions
  ) {
    this.options = {
      ...options,
      sessions: options.sessions ?? new JsonDeveloperSessionStore("data/developer-agent-sessions.json"),
      runner: options.runner ?? new NodeDeveloperProcessRunner(capabilities.policy)
    };
    this.events = options.events ?? new InMemoryEventBus();
  }

  async getAvailability(agentId: string) {
    const adapter = this.options.adapters[agentId];
    return adapter && adapter.id === agentId
      ? adapter.getAvailability()
      : { available: false as const, reason: "adapter-not-configured" as const, executable: agentId };
  }

  async execute(context: ConversationContext, agent: ConversationAgent): Promise<AgentResponse> {
    if (context.route.runtime !== this.type || agent.type !== this.type) throw new Error("Developer runtime received a non-developer agent");
    const workspaceRoot = context.execution.workspaceRoot ?? context.route.workspaceRoot ?? this.options.defaultWorkspaceRoot;
    const key = createDeveloperSessionKey(context.message.channel, context.conversation.id, agent.id, workspaceRoot);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const execution = previous.then(() => this.executeTurn(context, agent));
    const tail = execution.then(() => undefined, () => undefined);
    this.queues.set(key, tail);
    void tail.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return execution;
  }

  private async executeTurn(context: ConversationContext, agent: ConversationAgent): Promise<AgentResponse> {
    const startedAt = Date.now();
    const basePayload = { agent: agent.id, conversationId: context.conversation.id };
    await this.publish({ type: "AgentExecutionStarted", occurredAt: new Date(), correlationId: context.execution.correlationId, payload: basePayload });
    try {
      const adapter = this.options.adapters[agent.id];
      if (!adapter || adapter.id !== agent.id) return this.failure(context, basePayload, "adapter-not-configured", startedAt);

      const workspaceRoot = context.execution.workspaceRoot ?? context.route.workspaceRoot ?? this.options.defaultWorkspaceRoot;
      let workingDirectory: string;
      try {
        workingDirectory = this.capabilities.policy.assertPath(workspaceRoot);
      } catch {
        return this.failure(context, basePayload, "workspace-rejected", startedAt);
      }

      if (!(await adapter.isAvailable())) return this.failure(context, { ...basePayload, workspaceRoot: workingDirectory }, "unavailable", startedAt);

      const sessionKey = createDeveloperSessionKey(context.message.channel, context.conversation.id, agent.id, workingDirectory);
      const session = await this.options.sessions.get(sessionKey);
      const result = await adapter.execute({
        prompt: context.message.text,
        conversationId: context.conversation.id,
        sessionId: session?.nativeSessionId,
        timeoutMs: this.options.timeoutMs ?? 120_000,
        maxOutputBytes: this.options.maxOutputBytes ?? 64 * 1024
      }, {
        correlationId: context.execution.correlationId,
        conversationId: context.conversation.id,
        workingDirectory,
        workspacePolicy: this.capabilities.policy,
        signal: context.execution.signal ?? new AbortController().signal,
        events: this.events,
        processRunner: this.options.runner
      });
      if (result.status === "failed") return this.failure(context, { ...basePayload, workspaceRoot: workingDirectory }, result.reason, startedAt, result);

      await this.options.sessions.set(sessionKey, { nativeSessionId: result.sessionId });
      await this.publish({
        type: "AgentExecutionCompleted",
        occurredAt: new Date(),
        correlationId: context.execution.correlationId,
        payload: { ...basePayload, workspaceRoot: workingDirectory, durationMs: result.durationMs ?? Date.now() - startedAt, exitCode: result.exitCode ?? null }
      });
      return { text: result.text, metadata: { agent: agent.id, sessionId: result.sessionId } };
    } catch {
      return this.failure(context, basePayload, "execution-failed", startedAt);
    }
  }

  private async failure(
    context: ConversationContext,
    payload: Record<string, unknown>,
    reason: RuntimeFailureReason,
    startedAt: number,
    result?: { durationMs?: number; exitCode?: number | null }
  ): Promise<AgentResponse> {
    await this.publish({
      type: "AgentExecutionFailed",
      occurredAt: new Date(),
      correlationId: context.execution.correlationId,
      payload: { ...payload, reason, durationMs: result?.durationMs ?? Date.now() - startedAt, exitCode: result?.exitCode ?? null }
    });
    return { text: "Unable to complete the developer-agent request.", metadata: { agent: String(payload.agent), reason } };
  }

  private async publish(event: Parameters<EventBus["publish"]>[0]): Promise<void> {
    try {
      await this.events.publish(event);
    } catch {}
  }
}
