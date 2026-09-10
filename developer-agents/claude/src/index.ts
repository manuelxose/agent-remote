import type { ConversationAgent } from "../../../packages/core/src/index.js";
import type { DeveloperAgentAdapter } from "../../../runtime/developer-agent/src/contracts.js";
import { resolveDeveloperExecutable } from "../../../runtime/developer-agent/src/process.js";

type Resolver = () => Promise<string | undefined>;

export function createClaudeAdapter(resolve: Resolver = () => resolveDeveloperExecutable("claude")): DeveloperAgentAdapter {
  const getAvailability = async () => {
    const executable = await resolve();
    return executable ? { available: true, executable } : { available: false, reason: "executable-missing" as const, executable: "claude" };
  };
  return {
    id: "claude",
    async isAvailable() { return (await getAvailability()).available; },
    getAvailability,
    async execute(request, context) {
      const availability = await getAvailability();
      if (!availability.available) return { status: "failed", reason: "unavailable" };
      try { context.workspacePolicy.assertPath(context.workingDirectory); } catch { return { status: "failed", reason: "workspace-rejected" }; }
      const argv = ["-p", "--output-format", "json", ...(request.sessionId ? ["--resume", request.sessionId] : []), request.prompt];
      try {
        const process = await context.processRunner.run({ executable: availability.executable, argv, workingDirectory: context.workingDirectory, signal: context.signal, timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes });
        const metadata = { stdout: process.stdout, stderr: process.stderr, exitCode: process.exitCode, durationMs: process.durationMs, signal: process.signal, outputTruncated: Boolean(process.stdoutTruncated || process.stderrTruncated) };
        if (process.terminationReason) return { ...metadata, status: "failed" as const, reason: process.terminationReason };
        if (process.exitCode !== 0) return { ...metadata, status: "failed" as const, reason: "exit-nonzero" as const };
        const output = JSON.parse(process.stdout);
        if (output?.type !== "result" || typeof output.session_id !== "string" || typeof output.result !== "string") throw new Error("invalid Claude result");
        return { ...metadata, status: "completed" as const, text: output.result, sessionId: output.session_id };
      } catch (error) {
        return { status: "failed" as const, reason: "invalid-output" as const, stderr: error instanceof Error ? error.message : "invalid Claude output" };
      }
    }
  };
}

export const claudeAdapter = createClaudeAdapter();
export const claudeAgent: ConversationAgent = { id: "claude", type: "developer-agent", async handleMessage() { return { text: "Claude adapter requires developer-agent runtime execution." }; } };
