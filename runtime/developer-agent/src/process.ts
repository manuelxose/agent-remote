import { execFile as execFileCallback, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { WorkspacePolicy } from "../../../packages/security/src/index.js";
import {
  DeveloperProcessError,
  type DeveloperProcessResult,
  type DeveloperProcessRunner,
  type DeveloperProcessSpec,
} from "./contracts.js";

const execFile = promisify(execFileCallback);

export class NodeDeveloperProcessRunner implements DeveloperProcessRunner {
  constructor(private readonly workspacePolicy: WorkspacePolicy) {}

  async run(spec: DeveloperProcessSpec): Promise<DeveloperProcessResult> {
    let workingDirectory: string;
    try {
      workingDirectory = this.workspacePolicy.assertPath(spec.workingDirectory);
      if (!(await stat(workingDirectory)).isDirectory()) {
        throw new Error("working directory is not a directory");
      }
    } catch (error) {
      throw new DeveloperProcessError(`invalid working directory: ${spec.workingDirectory}`, { cause: error });
    }

    const startedAt = Date.now();
    if (spec.signal?.aborted) {
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        terminationReason: "cancelled",
      };
    }

    const maxOutputBytes = spec.maxOutputBytes ?? Number.POSITIVE_INFINITY;
    const child = spawn(spec.executable, spec.argv, {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let terminationReason: DeveloperProcessResult["terminationReason"];
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    return new Promise((resolve, reject) => {
      const finish = (result: DeveloperProcessResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        spec.signal?.removeEventListener("abort", abort);
        resolve(result);
      };
      const abort = () => {
        terminate("cancelled");
      };
      const terminate = (reason: NonNullable<DeveloperProcessResult["terminationReason"]>) => {
        if (terminationReason) return;
        terminationReason = reason;
        child.kill();
      };
      const append = (current: Buffer, chunk: Buffer, stream: "stdout" | "stderr") => {
        const remaining = Math.max(0, maxOutputBytes - current.byteLength);
        const kept = chunk.subarray(0, remaining);
        if (stream === "stdout") stdout = Buffer.concat([current, kept]);
        else stderr = Buffer.concat([current, kept]);
        if (kept.byteLength < chunk.byteLength) {
          if (stream === "stdout") stdoutTruncated = true;
          else stderrTruncated = true;
          terminate("output-limit");
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => append(stdout, chunk, "stdout"));
      child.stderr?.on("data", (chunk: Buffer) => append(stderr, chunk, "stderr"));
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        spec.signal?.removeEventListener("abort", abort);
        reject(new DeveloperProcessError(`failed to start ${spec.executable}`, { cause: error }));
      });
      child.once("close", (exitCode, signal) => finish({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        terminationReason,
        stdoutTruncated: stdoutTruncated || undefined,
        stderrTruncated: stderrTruncated || undefined,
      }));

      spec.signal?.addEventListener("abort", abort, { once: true });
      if (spec.timeoutMs !== undefined) timer = setTimeout(() => {
        terminate("timeout");
      }, spec.timeoutMs);
    });
  }
}

export async function resolveDeveloperExecutable(name: string): Promise<string | undefined> {
  try {
    const command = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFile(command, [name]);
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

export { DeveloperProcessError };
