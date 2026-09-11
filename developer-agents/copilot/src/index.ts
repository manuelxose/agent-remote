import { randomUUID } from "node:crypto";
import type { DeveloperAgentAdapter } from "../../../runtime/developer-agent/src/contracts.js";
import { resolveDeveloperExecutable } from "../../../runtime/developer-agent/src/process.js";

type Resolver = () => Promise<string | undefined>;
type SessionIdFactory = () => string;

export function createCopilotAdapter(resolve: Resolver = () => resolveDeveloperExecutable("copilot"), makeSessionId: SessionIdFactory = randomUUID): DeveloperAgentAdapter {
  const getAvailability = async () => {
    const executable = await resolve();
    return executable ? { available: true, executable } : { available: false, reason: "executable-missing" as const, executable: "copilot" };
  };
  return {
    id: "copilot",
    async isAvailable() { return (await getAvailability()).available; },
    getAvailability,
    async execute(request, context) {
      const availability = await getAvailability();
      if (!availability.available) return { status: "failed", reason: "unavailable" };
      try { context.workspacePolicy.assertPath(context.workingDirectory); } catch { return { status: "failed", reason: "workspace-rejected" }; }
      const sessionId = request.sessionId ?? makeSessionId();
      const argv = [`--prompt=${request.prompt}`, "--silent", `--session-id=${sessionId}`, "--experimental", "--sandbox"];
      let process;
      try {
        process = await context.processRunner.run({ executable: availability.executable, argv, workingDirectory: context.workingDirectory, signal: context.signal, timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes });
      } catch (error) {
        return { status: "failed" as const, reason: "execution-failed" as const, stderr: (error instanceof Error ? error.message : "process runner failed").slice(0, request.maxOutputBytes) };
      }
      const metadata = { stdout: process.stdout, stderr: process.stderr, exitCode: process.exitCode, durationMs: process.durationMs, signal: process.signal, outputTruncated: Boolean(process.stdoutTruncated || process.stderrTruncated) };
      if (process.terminationReason) return { ...metadata, status: "failed" as const, reason: process.terminationReason };
      if (process.exitCode !== 0) return { ...metadata, status: "failed" as const, reason: "exit-nonzero" as const };
      try {
        if (!process.stdout.trim()) throw new Error("invalid Copilot result");
        return { ...metadata, status: "completed" as const, text: process.stdout, sessionId };
      } catch (error) {
        return { ...metadata, status: "failed" as const, reason: "invalid-output" as const, stderr: (error instanceof Error ? error.message : "invalid Copilot output").slice(0, request.maxOutputBytes) };
      }
    }
  };
}

export const copilotAdapter = createCopilotAdapter();
