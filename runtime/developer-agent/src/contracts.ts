import type { EventBus } from "../../../packages/events/src/index.js";
import type { WorkspacePolicy } from "../../../packages/security/src/index.js";

export interface DeveloperAgentRequest {
  prompt: string;
  conversationId: string;
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  executionId?: string;
  logicalSessionId?: string;
  externalConversationId?: string;
  model?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export const executionEventTypes = [
  "execution.accepted", "execution.started", "provider.started", "assistant.delta",
  "assistant.message", "tool.started", "tool.progress", "tool.completed",
  "execution.completed", "execution.failed", "execution.cancelled"
] as const;

export type AgentExecutionEventType = (typeof executionEventTypes)[number];

export interface AgentExecutionEvent {
  type: AgentExecutionEventType;
  occurredAt: Date;
  executionId: string;
  correlationId: string;
  logicalSessionId: string;
  provider?: string;
  replyTo?: import("../../../packages/core/src/index.js").MessageReference;
  payload?: Record<string, string | number | boolean | null>;
}

export interface AgentExecutionObserver {
  onEvent(event: AgentExecutionEvent): void | Promise<void>;
}

export interface AgentExecutionLatencyTimestamps {
  messageReceivedAt?: number;
  routingCompletedAt?: number;
  queueEnteredAt?: number;
  executionAcceptedAt?: number;
  executionStartedAt?: number;
  providerStartedAt?: number;
  firstProviderOutputAt?: number;
  firstTransportReplyAt?: number;
  executionCompletedAt?: number;
  finalReplyAt?: number;
}

export interface AgentExecutionLatencies {
  routingLatencyMs?: number;
  queueLatencyMs?: number;
  providerStartupLatencyMs?: number;
  timeToFirstOutputMs?: number;
  timeToFirstReplyMs?: number;
  executionDurationMs?: number;
  deliveryLatencyMs?: number;
  totalLatencyMs?: number;
}

export function calculateLatencies(timestamps: AgentExecutionLatencyTimestamps): AgentExecutionLatencies {
  const difference = (start: number | undefined, end: number | undefined): number | undefined =>
    start === undefined || end === undefined ? undefined : Math.max(0, end - start);
  return {
    routingLatencyMs: difference(timestamps.messageReceivedAt, timestamps.routingCompletedAt),
    queueLatencyMs: difference(timestamps.queueEnteredAt, timestamps.executionAcceptedAt),
    providerStartupLatencyMs: difference(timestamps.executionStartedAt, timestamps.providerStartedAt),
    timeToFirstOutputMs: difference(timestamps.messageReceivedAt, timestamps.firstProviderOutputAt),
    timeToFirstReplyMs: difference(timestamps.messageReceivedAt, timestamps.firstTransportReplyAt),
    executionDurationMs: difference(timestamps.executionStartedAt, timestamps.executionCompletedAt),
    deliveryLatencyMs: difference(timestamps.executionCompletedAt, timestamps.finalReplyAt),
    totalLatencyMs: difference(timestamps.messageReceivedAt, timestamps.finalReplyAt)
  };
}

export interface DeveloperExecutionContext {
  correlationId: string;
  conversationId: string;
  workingDirectory: string;
  workspacePolicy: WorkspacePolicy;
  signal: AbortSignal;
  events: EventBus;
  processRunner: DeveloperProcessRunner;
  observer?: AgentExecutionObserver;
}

export interface DeveloperAgentAvailability {
  available: boolean;
  reason?: "executable-missing" | "probe-failed";
  executable: string;
}

export type DeveloperAgentFailureReason =
  | "unavailable"
  | "workspace-rejected"
  | "timeout"
  | "cancelled"
  | "exit-nonzero"
  | "output-limit"
  | "invalid-output"
  | "execution-failed";

export interface DeveloperProcessSpec {
  executable: string;
  argv: readonly string[];
  workingDirectory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface DeveloperProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  terminationReason?: "timeout" | "cancelled" | "output-limit";
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

interface DeveloperAgentProcessMetadata {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
  signal?: string | null;
  outputTruncated?: boolean;
}

export type DeveloperAgentResult =
  | (DeveloperAgentProcessMetadata & {
      status: "completed";
      text: string;
      sessionId: string;
    })
  | (DeveloperAgentProcessMetadata & {
      status: "failed";
      reason: DeveloperAgentFailureReason;
    });

export interface DeveloperProcessRunner {
  run(spec: DeveloperProcessSpec, observer?: DeveloperProcessObserver): Promise<DeveloperProcessResult>;
}

export interface DeveloperProcessObserver {
  onStdout?(chunk: Buffer): void | Promise<void>;
  onStderr?(chunk: Buffer): void | Promise<void>;
}

export class DeveloperProcessError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DeveloperProcessError";
  }
}

export interface DeveloperAgentAdapter {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  getAvailability(): Promise<DeveloperAgentAvailability>;
  refreshAvailability?(): Promise<DeveloperAgentAvailability>;
  execute(request: DeveloperAgentRequest, context: DeveloperExecutionContext): Promise<DeveloperAgentResult>;
}

export type AgentExecutionRequest = DeveloperAgentRequest;
export type AgentExecutionResult = DeveloperAgentResult;

export type AgentExecutionSessionStatus = "idle" | "running" | "closed" | "failed";

export interface AgentExecutionSessionHealth {
  status: AgentExecutionSessionStatus;
  activeExecutionId?: string;
  lastError?: string;
}

export interface AgentExecutionSession {
  readonly id: string;
  readonly provider: string;
  readonly logicalSessionId: string;
  execute(request: AgentExecutionRequest, observer: AgentExecutionObserver): Promise<AgentExecutionResult>;
  cancel(executionId: string): Promise<void>;
  close(): Promise<void>;
  health(): AgentExecutionSessionHealth;
}

export interface AgentSessionSupervisor {
  getOrCreate(logicalSessionId: string, provider: string, workspace: string, sessionKey?: string): Promise<AgentExecutionSession>;
  get(id: string): AgentExecutionSession | undefined;
  cancel(executionId: string): Promise<void>;
  close(id: string): Promise<void>;
  closeAll(): Promise<void>;
}
