import type { AgentResponse, AgentRuntime, ConversationAgent, ConversationContext } from "../../../packages/core/src/index.js";
import type { EventBus } from "../../../packages/events/src/index.js";
import { InMemoryEventBus } from "../../../packages/events/src/index.js";
import type { DeveloperCapabilities } from "../../../packages/security/src/index.js";
import type { AgentExecutionEvent, AgentExecutionObserver, DeveloperAgentAdapter, DeveloperAgentFailureReason, DeveloperProcessRunner } from "./contracts.js";
import { NodeDeveloperProcessRunner } from "./process.js";
import { DeveloperAgentSessionSupervisor } from "./execution-session.js";
import { ProviderRegistry } from "./registry.js";
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
  maxSessions?: number;
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
  private readonly registry: ProviderRegistry;
  private readonly supervisor: DeveloperAgentSessionSupervisor;

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
    this.registry = new ProviderRegistry(options.adapters);
    this.supervisor = new DeveloperAgentSessionSupervisor({
      adapters: options.adapters,
      capabilities,
      sessions: this.options.sessions,
      runner: this.options.runner,
      events: this.events,
      maxSessions: options.maxSessions
    });
  }

  async getAvailability(agentId: string) {
    const configured = this.options.adapters[agentId];
    if (!configured || configured.id !== agentId) return { available: false as const, reason: "adapter-not-configured" as const, executable: agentId };
    const registration = await this.registry.get(agentId);
    return registration?.availability ?? { available: false as const, reason: "executable-missing" as const, executable: agentId };
  }

  async resetSession(channel: string, conversationId: string, agentId: string, workspaceRoot: string): Promise<void> {
    const workingDirectory = this.capabilities.policy.assertPath(workspaceRoot);
    const key = createDeveloperSessionKey(channel, conversationId, agentId, workingDirectory);
    const managed = this.supervisor.get(createDeveloperSessionKey("logical", conversationId, agentId, workingDirectory));
    if (managed) await this.supervisor.close(managed.id);
    await this.options.sessions.delete?.(key);
  }

  async execute(context: ConversationContext, agent: ConversationAgent): Promise<AgentResponse> {
    return this.executeStreaming(context, agent, { onEvent: async () => {} });
  }

  async executeStreaming(context: ConversationContext, agent: ConversationAgent, observer: AgentExecutionObserver): Promise<AgentResponse> {
    if (context.route.runtime !== this.type || agent.type !== this.type || agent.id !== context.route.agent) throw new Error("Developer runtime received a mismatched developer agent");
    const workspaceRoot = context.execution.workspaceRoot ?? context.route.workspaceRoot ?? this.options.defaultWorkspaceRoot;
    let workingDirectory: string;
    try {
      workingDirectory = this.capabilities.policy.assertPath(workspaceRoot);
    } catch {
      return this.executeTurn(context, agent, undefined, observer);
    }
    const key = createDeveloperSessionKey(context.message.channel, context.conversation.id, agent.id, workingDirectory);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const execution = previous.then(() => this.executeTurn(context, agent, workingDirectory, observer));
    const tail = execution.then(() => undefined, () => undefined);
    this.queues.set(key, tail);
    void tail.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return execution;
  }

  async cancel(executionId: string): Promise<void> {
    await this.supervisor.cancel(executionId);
  }

  async close(): Promise<void> {
    await this.supervisor.closeAll();
  }

  async refreshProviderHealth(agentId?: string): Promise<void> {
    await this.registry.refresh(agentId);
  }

  async providerHealth() {
    return this.registry.health();
  }

  sessionHealth() {
    return this.supervisor.health();
  }

  private async executeTurn(context: ConversationContext, agent: ConversationAgent, validatedWorkspace: string | undefined, observer: AgentExecutionObserver): Promise<AgentResponse> {
    const startedAt = Date.now();
    const executionId = context.execution.executionId ?? context.message.id;
    const logicalSessionId = context.execution.logicalSessionId ?? context.conversation.id;
    const workspaceRoot = context.execution.workspaceRoot ?? context.route.workspaceRoot ?? this.options.defaultWorkspaceRoot;
    const basePayload = { agent: agent.id, conversationId: context.conversation.id, workspaceRoot };
    await this.emitExecution(observer, { type: "execution.started", occurredAt: new Date(), executionId, correlationId: context.execution.correlationId, logicalSessionId, provider: agent.id });
    await this.publish({ type: "AgentExecutionStarted", occurredAt: new Date(), correlationId: context.execution.correlationId, payload: basePayload });
    try {
      const adapter = this.options.adapters[agent.id];
      if (!adapter || adapter.id !== agent.id) return this.failure(context, basePayload, "adapter-not-configured", startedAt, undefined, observer);

      let workingDirectory = validatedWorkspace;
      if (!workingDirectory) {
        try {
          workingDirectory = this.capabilities.policy.assertPath(workspaceRoot);
        } catch {
          return this.failure(context, basePayload, "workspace-rejected", startedAt);
        }
      }

      const registration = await this.registry.get(agent.id);
      if (!registration?.availability.available) return this.failure(context, { ...basePayload, workspaceRoot: workingDirectory }, "unavailable", startedAt, undefined, observer);

      const sessionKey = createDeveloperSessionKey(context.message.channel, context.conversation.id, agent.id, workingDirectory);
      const session = await this.supervisor.getOrCreate(logicalSessionId, agent.id, workingDirectory, sessionKey);
      const result = await session.execute({
        prompt: context.message.text,
        conversationId: context.conversation.id,
        executionId,
        correlationId: context.execution.correlationId,
        logicalSessionId,
        externalConversationId: context.message.conversationId,
        model: context.execution.metadata?.model,
        timeoutMs: this.options.timeoutMs ?? 120_000,
        maxOutputBytes: this.options.maxOutputBytes ?? 64 * 1024,
        signal: context.execution.signal
      }, observer);
      if (result.status === "failed") return this.failure(context, { ...basePayload, workspaceRoot: workingDirectory }, result.reason, startedAt, result, observer);

      await this.emitExecution(observer, { type: "execution.completed", occurredAt: new Date(), executionId, correlationId: context.execution.correlationId, logicalSessionId, provider: agent.id, payload: { durationMs: result.durationMs ?? Date.now() - startedAt } });
      await this.publish({
        type: "AgentExecutionCompleted",
        occurredAt: new Date(),
        correlationId: context.execution.correlationId,
        payload: { ...basePayload, workspaceRoot: workingDirectory, durationMs: result.durationMs ?? Date.now() - startedAt, exitCode: result.exitCode ?? null }
      });
      return { text: result.text, metadata: { agent: agent.id, sessionId: result.sessionId } };
    } catch {
      return this.failure(context, basePayload, "execution-failed", startedAt, undefined, observer);
    }
  }

  private async failure(
    context: ConversationContext,
    payload: Record<string, unknown>,
    reason: RuntimeFailureReason,
    startedAt: number,
    result?: { durationMs?: number; exitCode?: number | null },
    observer?: AgentExecutionObserver
  ): Promise<AgentResponse> {
    const executionId = context.execution.executionId ?? context.message.id;
    const logicalSessionId = context.execution.logicalSessionId ?? context.conversation.id;
    await this.emitExecution(observer, { type: reason === "cancelled" ? "execution.cancelled" : "execution.failed", occurredAt: new Date(), executionId, correlationId: context.execution.correlationId, logicalSessionId, provider: String(payload.agent), payload: { reason } });
    await this.publish({
      type: "AgentExecutionFailed",
      occurredAt: new Date(),
      correlationId: context.execution.correlationId,
      payload: { ...payload, reason, durationMs: result?.durationMs ?? Date.now() - startedAt, exitCode: result?.exitCode ?? null }
    });
    return { text: "Unable to complete the developer-agent request.", metadata: { agent: String(payload.agent), reason } };
  }

  private async emitExecution(observer: AgentExecutionObserver | undefined, event: AgentExecutionEvent): Promise<void> {
    try { await observer?.onEvent(event); } catch {}
  }

  private async publish(event: Parameters<EventBus["publish"]>[0]): Promise<void> {
    try {
      await this.events.publish(event);
    } catch {}
  }
}
