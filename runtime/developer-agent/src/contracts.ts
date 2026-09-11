import type { EventBus } from "../../../packages/events/src/index.js";
import type { WorkspacePolicy } from "../../../packages/security/src/index.js";

export interface DeveloperAgentRequest {
  prompt: string;
  conversationId: string;
  sessionId?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface DeveloperExecutionContext {
  correlationId: string;
  conversationId: string;
  workingDirectory: string;
  workspacePolicy: WorkspacePolicy;
  signal: AbortSignal;
  events: EventBus;
  processRunner: DeveloperProcessRunner;
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
  run(spec: DeveloperProcessSpec): Promise<DeveloperProcessResult>;
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
  execute(request: DeveloperAgentRequest, context: DeveloperExecutionContext): Promise<DeveloperAgentResult>;
}
