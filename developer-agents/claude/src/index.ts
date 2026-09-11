import type { DeveloperAgentAdapter } from "../../../runtime/developer-agent/src/contracts.js";
import { resolveDeveloperExecutable } from "../../../runtime/developer-agent/src/process.js";

type Resolver = () => Promise<string | undefined>;

export function createClaudeAdapter(resolve: Resolver = () => resolveDeveloperExecutable("claude")): DeveloperAgentAdapter {
  let availabilityPromise: ReturnType<Resolver> | undefined;
  const getAvailability = async () => {
    availabilityPromise ??= resolve();
    const executable = await availabilityPromise;
    return executable ? { available: true, executable } : { available: false, reason: "executable-missing" as const, executable: "claude" };
  };
  const refreshAvailability = async () => { availabilityPromise = resolve(); return getAvailability(); };
  return {
    id: "claude",
    async isAvailable() { return (await getAvailability()).available; },
    getAvailability,
    refreshAvailability,
    async execute(request, context) {
      const availability = await getAvailability();
      if (!availability.available) return { status: "failed", reason: "unavailable" };
      try { context.workspacePolicy.assertPath(context.workingDirectory); } catch { return { status: "failed", reason: "workspace-rejected" }; }
      const argv = ["-p", "--output-format", "stream-json", "--add-dir", context.workingDirectory, ...(request.model ? ["--model", request.model] : []), ...(request.sessionId ? ["--resume", request.sessionId] : []), "--", request.prompt];
      const executionId = request.executionId ?? request.correlationId ?? request.conversationId;
      const logicalSessionId = request.logicalSessionId ?? request.conversationId;
      let sessionId: string | undefined;
      let finalText: string | undefined;
      let parseError = false;
      let lineBuffer = "";
      const emit = async (type: "provider.started" | "assistant.delta" | "assistant.message", payload: Record<string, string | number | boolean | null>) => {
        await context.observer?.onEvent({ type, occurredAt: new Date(), executionId, correlationId: request.correlationId ?? executionId, logicalSessionId, provider: "claude", payload });
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
        if (typeof event.session_id === "string") {
          const id = event.session_id;
          sessionId = id;
          await emit("provider.started", { sessionId: id });
        }
        const delta = event.delta?.type === "text_delta" && typeof event.delta.text === "string"
          ? event.delta.text
          : event.type === "assistant" && typeof event.message?.content?.[0]?.text === "string" ? event.message.content[0].text : undefined;
        if (delta) {
          finalText = `${finalText ?? ""}${delta}`;
          await emit("assistant.delta", { text: delta });
        }
        if (event.type === "result" && typeof event.result === "string") {
          finalText = event.result;
          await emit("assistant.message", { text: event.result });
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
        if (!sessionId || !finalText) {
          const output = JSON.parse(process.stdout);
          if (output?.type !== "result" || typeof output.session_id !== "string" || typeof output.result !== "string") throw new Error("invalid Claude result");
          sessionId = output.session_id;
          finalText = output.result;
        }
        if (parseError || !sessionId || !finalText) throw new Error("invalid Claude result");
        return { ...metadata, status: "completed" as const, text: finalText, sessionId };
      } catch (error) {
        return { ...metadata, status: "failed" as const, reason: "invalid-output" as const, stderr: (error instanceof Error ? error.message : "invalid Claude output").slice(0, request.maxOutputBytes) };
      }
    }
  };
}

export const claudeAdapter = createClaudeAdapter();
