import type { ConversationAgent } from "../../../packages/core/src/index.js";
import type { DeveloperAgentAdapter } from "../../../runtime/developer-agent/src/contracts.js";
import { resolveDeveloperExecutable } from "../../../runtime/developer-agent/src/process.js";

type Resolver = () => Promise<string | undefined>;

export function createCodexAdapter(resolve: Resolver = () => resolveDeveloperExecutable("codex")): DeveloperAgentAdapter {
  const getAvailability = async () => {
    const executable = await resolve();
    return executable ? { available: true, executable } : { available: false, reason: "executable-missing" as const, executable: "codex" };
  };
  return {
    id: "codex",
    async isAvailable() { return (await getAvailability()).available; },
    getAvailability,
    async execute(request, context) {
      const availability = await getAvailability();
      if (!availability.available) return { status: "failed", reason: "unavailable" };
      try { context.workspacePolicy.assertPath(context.workingDirectory); } catch { return { status: "failed", reason: "workspace-rejected" }; }
      const argv = ["exec", "--json", "--sandbox", "workspace-write", ...(request.sessionId ? ["resume", request.sessionId] : []), request.prompt];
      try {
        const process = await context.processRunner.run({ executable: availability.executable, argv, workingDirectory: context.workingDirectory, signal: context.signal, timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes });
        const metadata = { stdout: process.stdout, stderr: process.stderr, exitCode: process.exitCode, durationMs: process.durationMs, signal: process.signal, outputTruncated: Boolean(process.stdoutTruncated || process.stderrTruncated) };
        if (process.terminationReason) return { ...metadata, status: "failed" as const, reason: process.terminationReason };
        if (process.exitCode !== 0) return { ...metadata, status: "failed" as const, reason: "exit-nonzero" as const };
        const events = process.stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        const thread = events.find(event => event.type === "thread.started" && typeof event.thread_id === "string");
        const message = [...events].reverse().find(event => event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string");
        if (!thread || !message) throw new Error("invalid Codex result");
        return { ...metadata, status: "completed" as const, text: message.item.text, sessionId: thread.thread_id };
      } catch (error) {
        return { status: "failed" as const, reason: "invalid-output" as const, stderr: error instanceof Error ? error.message : "invalid Codex output" };
      }
    }
  };
}

export const codexAdapter = createCodexAdapter();
export const codexAgent: ConversationAgent = { id: "codex", type: "developer-agent", async handleMessage() { return { text: "Codex adapter requires developer-agent runtime execution." }; } };
