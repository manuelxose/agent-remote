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

function calculateLatencies(timestamps: AgentExecutionLatencyTimestamps): AgentExecutionLatencies {
  const difference = (start: number | undefined, end: number | undefined): number | undefined => start === undefined || end === undefined ? undefined : Math.max(0, end - start);
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

export interface ExecutionTelemetryIdentity {
  executionId: string;
  correlationId: string;
  logicalSessionId: string;
  externalConversationId: string;
  provider: string;
  agent: string;
  workspace: string;
  model?: string;
}

export interface ExecutionTelemetrySnapshot extends ExecutionTelemetryIdentity {
  timestamps: AgentExecutionLatencyTimestamps;
  latencies: AgentExecutionLatencies;
}

export class ExecutionTelemetry {
  private readonly timestamps: AgentExecutionLatencyTimestamps = {};

  constructor(private readonly identity: ExecutionTelemetryIdentity) {}

  mark(name: keyof AgentExecutionLatencyTimestamps, at = Date.now()): void {
    this.timestamps[name] ??= at;
  }

  snapshot(): ExecutionTelemetrySnapshot {
    return { ...this.identity, timestamps: { ...this.timestamps }, latencies: calculateLatencies(this.timestamps) };
  }
}
