import type { DeveloperAgentAdapter } from "../../../runtime/developer-agent/src/contracts.js";
import { resolveDeveloperExecutable } from "../../../runtime/developer-agent/src/process.js";

type Resolver = () => Promise<string | undefined>;

export function createCodexAdapter(resolve: Resolver = () => resolveDeveloperExecutable("codex")): DeveloperAgentAdapter {
  let availabilityPromise: ReturnType<Resolver> | undefined;
  const refreshAvailability = async () => {
    availabilityPromise = resolve();
    return getAvailability();
  };
  const getAvailability = async () => {
    availabilityPromise ??= resolve();
    const executable = await availabilityPromise;
    return executable ? { available: true, executable } : { available: false, reason: "executable-missing" as const, executable: "codex" };
  };
  return {
    id: "codex",
    async isAvailable() { return (await getAvailability()).available; },
    getAvailability,
    refreshAvailability,
    async execute(request, context) {
      const availability = await getAvailability();
      if (!availability.available) return { status: "failed", reason: "unavailable" };
      try { context.workspacePolicy.assertPath(context.workingDirectory); } catch { return { status: "failed", reason: "workspace-rejected" }; }
      const argv = ["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", ...(request.model ? ["--model", request.model] : []), ...(request.sessionId ? ["resume", request.sessionId] : []), "--", request.prompt];
      const executionId = request.executionId ?? request.correlationId ?? request.conversationId;
      const logicalSessionId = request.logicalSessionId ?? request.conversationId;
      let threadId: string | undefined;
      let finalText: string | undefined;
      let parseError = false;
      let lineBuffer = "";
      const emit = async (type: "provider.started" | "assistant.delta" | "assistant.message", payload: Record<string, string | number | boolean | null>) => {
        await context.observer?.onEvent({ type, occurredAt: new Date(), executionId, correlationId: request.correlationId ?? executionId, logicalSessionId, provider: "codex", payload });
      };
      const consume = async (chunk: Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) await consumeLine(line);
      };
      const consumeLine = async (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try { event = JSON.parse(line); } catch { parseError = true; return; }
        if (event.type === "thread.started" && typeof event.thread_id === "string") {
          const id = event.thread_id;
          threadId = id;
          await emit("provider.started", { sessionId: id });
          return;
        }
        const delta = typeof event.delta === "string" ? event.delta : typeof event.item?.text === "string" && event.type === "item.delta" ? event.item.text : undefined;
        if (delta) {
          finalText = `${finalText ?? ""}${delta}`;
          await emit("assistant.delta", { text: delta });
        }
        if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
          finalText = event.item.text;
          await emit("assistant.message", { text: event.item.text });
        }
      };
      let process;
      try {
        process = await context.processRunner.run({ executable: availability.executable, argv, workingDirectory: context.workingDirectory, signal: context.signal, timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes }, { onStdout: consume });
      } catch (error) {
        return { status: "failed" as const, reason: "execution-failed" as const, stderr: (error instanceof Error ? error.message : "process runner failed").slice(0, request.maxOutputBytes) };
      }
      const metadata = { stdout: process.stdout, stderr: process.stderr, exitCode: process.exitCode, durationMs: process.durationMs, signal: process.signal, outputTruncated: Boolean(process.stdoutTruncated || process.stderrTruncated) };
      if (process.terminationReason) return { ...metadata, status: "failed" as const, reason: process.terminationReason };
      if (process.exitCode !== 0) return { ...metadata, status: "failed" as const, reason: "exit-nonzero" as const };
      try {
        if (lineBuffer.trim()) await consumeLine(lineBuffer);
        if (!threadId || !finalText) {
          const events = process.stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
          const thread = events.find(event => event.type === "thread.started" && typeof event.thread_id === "string");
          const message = [...events].reverse().find(event => event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string");
          if (thread) threadId = thread.thread_id;
          if (message) finalText = message.item.text;
        }
        if (parseError || !threadId || !finalText) throw new Error("invalid Codex result");
        return { ...metadata, status: "completed" as const, text: finalText, sessionId: threadId };
      } catch (error) {
        return { ...metadata, status: "failed" as const, reason: "invalid-output" as const, stderr: (error instanceof Error ? error.message : "invalid Codex output").slice(0, request.maxOutputBytes) };
      }
    }
  };
}

export const codexAdapter = createCodexAdapter();
