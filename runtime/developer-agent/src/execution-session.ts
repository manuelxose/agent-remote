import { randomUUID } from "node:crypto";
import type { EventBus } from "../../../packages/events/src/index.js";
import type { DeveloperCapabilities } from "../../../packages/security/src/index.js";
import { createDeveloperSessionKey, type DeveloperSessionStore } from "./sessions.js";
import type {
  AgentExecutionEvent,
  AgentExecutionObserver,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentExecutionSession,
  AgentExecutionSessionHealth,
  AgentSessionSupervisor,
  DeveloperAgentAdapter,
  DeveloperProcessRunner
} from "./contracts.js";

interface SessionOptions {
  adapter: DeveloperAgentAdapter;
  capabilities: DeveloperCapabilities;
  sessions: DeveloperSessionStore;
  runner: DeveloperProcessRunner;
  events: EventBus;
  logicalSessionId: string;
  workspace: string;
  id: string;
  sessionKey?: string;
}

export class DeveloperAgentExecutionSession implements AgentExecutionSession {
  readonly provider: string;
  readonly logicalSessionId: string;
  private readonly active = new Map<string, AbortController>();
  private status: AgentExecutionSessionHealth["status"] = "idle";
  private lastError?: string;

  constructor(private readonly options: SessionOptions) {
    this.provider = options.adapter.id;
    this.logicalSessionId = options.logicalSessionId;
  }

  get id(): string { return this.options.id; }

  async execute(request: AgentExecutionRequest, observer: AgentExecutionObserver): Promise<AgentExecutionResult> {
    if (this.status === "closed") return { status: "failed", reason: "execution-failed" };
    const executionId = request.executionId ?? randomUUID();
    const controller = new AbortController();
    const abortExternal = () => controller.abort();
    request.signal?.addEventListener("abort", abortExternal, { once: true });
    this.active.set(executionId, controller);
    this.status = "running";
    const key = this.options.sessionKey ?? createDeveloperSessionKey("logical", this.logicalSessionId, this.provider, this.options.workspace);
    try {
      const stored = await this.options.sessions.get(key);
      const result = await this.options.adapter.execute({ ...request, executionId, logicalSessionId: this.logicalSessionId, sessionId: request.sessionId ?? stored?.nativeSessionId }, {
        correlationId: request.correlationId ?? executionId,
        conversationId: request.conversationId,
        workingDirectory: this.options.workspace,
        workspacePolicy: this.options.capabilities.policy,
        signal: request.signal ?? controller.signal,
        events: this.options.events,
        processRunner: this.options.runner,
        observer: this.wrapObserver(observer, request)
      });
      if (result.status === "completed") await this.options.sessions.set(key, { nativeSessionId: result.sessionId });
      if (result.status === "failed") this.lastError = result.reason;
      return result;
    } catch (error) {
      this.status = "failed";
      this.lastError = error instanceof Error ? error.message.slice(0, 160) : "session execution failed";
      return { status: "failed", reason: "execution-failed" };
    } finally {
      request.signal?.removeEventListener("abort", abortExternal);
      this.active.delete(executionId);
      if ((this.status as string) !== "closed") this.status = "idle";
    }
  }

  async cancel(executionId: string): Promise<void> {
    this.active.get(executionId)?.abort();
  }

  async close(): Promise<void> {
    this.status = "closed";
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }

  health(): AgentExecutionSessionHealth {
    return {
      status: this.status,
      ...(this.active.keys().next().value ? { activeExecutionId: this.active.keys().next().value } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {})
    };
  }

  private wrapObserver(observer: AgentExecutionObserver, request: AgentExecutionRequest): AgentExecutionObserver {
    return {
      onEvent: event => observer.onEvent({ ...event, executionId: request.executionId ?? event.executionId, correlationId: request.correlationId ?? event.correlationId, logicalSessionId: this.logicalSessionId, provider: this.provider })
    };
  }
}

export interface DeveloperAgentSessionSupervisorOptions {
  adapters: Readonly<Record<string, DeveloperAgentAdapter>>;
  capabilities: DeveloperCapabilities;
  sessions: DeveloperSessionStore;
  runner: DeveloperProcessRunner;
  events: EventBus;
  maxSessions?: number;
}

export class DeveloperAgentSessionSupervisor implements AgentSessionSupervisor {
  private readonly sessions = new Map<string, DeveloperAgentExecutionSession>();

  constructor(private readonly options: DeveloperAgentSessionSupervisorOptions) {}

  async getOrCreate(logicalSessionId: string, provider: string, workspace: string, sessionKey?: string): Promise<DeveloperAgentExecutionSession> {
    const id = createDeveloperSessionKey("logical", logicalSessionId, provider, workspace);
    const current = this.sessions.get(id);
    if (current) return current;
    const adapter = this.options.adapters[provider];
    if (!adapter) throw new Error(`Agent is unavailable: ${provider}`);
    if (this.options.maxSessions !== undefined && this.sessions.size >= this.options.maxSessions) throw new Error("provider session limit reached");
    const session = new DeveloperAgentExecutionSession({ ...this.options, adapter, logicalSessionId, workspace, id, sessionKey });
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): DeveloperAgentExecutionSession | undefined { return this.sessions.get(id); }

  async cancel(executionId: string): Promise<void> {
    for (const session of this.sessions.values()) await session.cancel(executionId);
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    await session.close();
    this.sessions.delete(id);
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.close(id);
  }

  health(): readonly AgentExecutionSessionHealth[] { return [...this.sessions.values()].map(session => session.health()); }
}
