import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";
import {
  DeveloperProcessError,
  NodeDeveloperProcessRunner,
  resolveDeveloperExecutable,
} from "../dist/runtime/developer-agent/src/process.js";

const script = (source: string) => ["-e", source] as const;

test("runs a process with separate executable and arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-process-"));
  try {
    const result = await new NodeDeveloperProcessRunner(new WorkspacePolicy([root])).run({
      executable: process.execPath,
      argv: script("process.stdout.write('ok')"),
      workingDirectory: root,
      timeoutMs: 1_000,
      maxOutputBytes: 100,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "ok");
    assert.equal(result.stderr, "");
    assert.equal(result.signal, null);
    assert.equal(result.terminationReason, undefined);
    assert.ok(result.durationMs >= 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("closes child stdin for argument-based prompts", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-process-stdin-"));
  try {
    const result = await new NodeDeveloperProcessRunner(new WorkspacePolicy([root])).run({
      executable: process.execPath,
      argv: script("process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('closed'))"),
      workingDirectory: root,
      timeoutMs: 500,
      maxOutputBytes: 100,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "closed");
    assert.equal(result.terminationReason, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("captures stderr and non-zero exit codes", async () => {
  const result = await new NodeDeveloperProcessRunner(new WorkspacePolicy([process.cwd()])).run({
    executable: process.execPath,
    argv: script("process.stderr.write('bad'); process.exit(3)"),
    workingDirectory: process.cwd(),
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.stderr, "bad");
});

test("terminates a process on timeout", async () => {
  const result = await new NodeDeveloperProcessRunner(new WorkspacePolicy([process.cwd()])).run({
    executable: process.execPath,
    argv: script("setTimeout(() => {}, 10_000)"),
    workingDirectory: process.cwd(),
    timeoutMs: 25,
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.terminationReason, "timeout");
  assert.ok(result.signal);
});

test("force-terminates a child that ignores graceful termination", async () => {
  const result = await new NodeDeveloperProcessRunner(new WorkspacePolicy([process.cwd()])).run({
    executable: process.execPath,
    argv: script("process.on('SIGTERM', () => {}); setTimeout(() => {}, 10_000)"),
    workingDirectory: process.cwd(),
    timeoutMs: 25,
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.terminationReason, "timeout");
  assert.ok(result.durationMs < 1_000);
});

test("does not spawn when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();

  const result = await new NodeDeveloperProcessRunner(new WorkspacePolicy([process.cwd()])).run({
    executable: process.execPath,
    argv: script("process.stdout.write('unexpected')"),
    workingDirectory: process.cwd(),
    signal: controller.signal,
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.terminationReason, "cancelled");
  assert.equal(result.stdout, "");
});

test("does not lose cancellation between the preflight check and listener setup", async () => {
  const controller = new AbortController();
  let reads = 0;
  const signal = {
    get aborted() {
      if (reads++ === 0) {
        controller.abort();
        return false;
      }
      return controller.signal.aborted;
    },
    addEventListener: controller.signal.addEventListener.bind(controller.signal),
    removeEventListener: controller.signal.removeEventListener.bind(controller.signal),
  } as AbortSignal;

  const result = await new NodeDeveloperProcessRunner(new WorkspacePolicy([process.cwd()])).run({
    executable: process.execPath,
    argv: script("setTimeout(() => {}, 10_000)"),
    workingDirectory: process.cwd(),
    signal,
    timeoutMs: 500,
  });

  assert.equal(result.terminationReason, "cancelled");
});

test("caps stdout and reports truncation", async () => {
  const result = await new NodeDeveloperProcessRunner(new WorkspacePolicy([process.cwd()])).run({
    executable: process.execPath,
    argv: script("process.stdout.write('0123456789')"),
    workingDirectory: process.cwd(),
    maxOutputBytes: 4,
  });

  assert.equal(result.stdout, "0123");
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.terminationReason, "output-limit");
});

test("rejects an invalid working directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-process-root-"));
  const outside = await mkdtemp(join(tmpdir(), "developer-process-outside-"));
  try {
  await assert.rejects(
    new NodeDeveloperProcessRunner(new WorkspacePolicy([root])).run({
      executable: process.execPath,
      argv: script("process.stdout.write('unexpected')"),
      workingDirectory: outside,
    }),
    (error: unknown) => error instanceof DeveloperProcessError,
  );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("cancels a running child", async () => {
  const controller = new AbortController();
  const running = new NodeDeveloperProcessRunner(new WorkspacePolicy([process.cwd()])).run({
    executable: process.execPath,
    argv: script("setTimeout(() => {}, 10_000)"),
    workingDirectory: process.cwd(),
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 25);

  const result = await running;
  assert.equal(result.terminationReason, "cancelled");
});

test("caps stderr and reports stderr truncation", async () => {
  const result = await new NodeDeveloperProcessRunner(new WorkspacePolicy([process.cwd()])).run({
    executable: process.execPath,
    argv: script("process.stderr.write('0123456789')"),
    workingDirectory: process.cwd(),
    maxOutputBytes: 4,
  });

  assert.equal(result.stderr, "0123");
  assert.equal(result.stderrTruncated, true);
  assert.equal(result.terminationReason, "output-limit");
});

test("reports a spawn error", async () => {
  await assert.rejects(
    new NodeDeveloperProcessRunner(new WorkspacePolicy([process.cwd()])).run({
      executable: join(process.cwd(), "does-not-exist"),
      argv: [],
      workingDirectory: process.cwd(),
    }),
    (error: unknown) => error instanceof DeveloperProcessError,
  );
});

test("resolves an installed executable without shell interpolation", async () => {
  const executable = await resolveDeveloperExecutable("node");
  assert.ok(executable);
});

test("uses an explicitly configured executable path", async () => {
  assert.equal(await resolveDeveloperExecutable("claude", process.execPath), process.execPath);
});

test("returns undefined for a missing executable", async () => {
  assert.equal(await resolveDeveloperExecutable("definitely-not-an-executable"), undefined);
});
