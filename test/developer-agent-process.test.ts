import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DeveloperProcessError,
  NodeDeveloperProcessRunner,
  resolveDeveloperExecutable,
} from "../dist/runtime/developer-agent/src/process.js";

const script = (source: string) => ["-e", source] as const;

test("runs a process with separate executable and arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-process-"));
  try {
    const result = await new NodeDeveloperProcessRunner().run({
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

test("captures stderr and non-zero exit codes", async () => {
  const result = await new NodeDeveloperProcessRunner().run({
    executable: process.execPath,
    argv: script("process.stderr.write('bad'); process.exit(3)"),
    workingDirectory: process.cwd(),
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.stderr, "bad");
});

test("terminates a process on timeout", async () => {
  const result = await new NodeDeveloperProcessRunner().run({
    executable: process.execPath,
    argv: script("setTimeout(() => {}, 10_000)"),
    workingDirectory: process.cwd(),
    timeoutMs: 25,
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.terminationReason, "timeout");
  assert.ok(result.signal);
});

test("does not spawn when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();

  const result = await new NodeDeveloperProcessRunner().run({
    executable: process.execPath,
    argv: script("process.stdout.write('unexpected')"),
    workingDirectory: process.cwd(),
    signal: controller.signal,
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.terminationReason, "cancelled");
  assert.equal(result.stdout, "");
});

test("caps stdout and reports truncation", async () => {
  const result = await new NodeDeveloperProcessRunner().run({
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
  await assert.rejects(
    new NodeDeveloperProcessRunner().run({
      executable: process.execPath,
      argv: script("process.stdout.write('unexpected')"),
      workingDirectory: join(tmpdir(), "does-not-exist-developer-process"),
    }),
    (error: unknown) => error instanceof DeveloperProcessError,
  );
});

test("resolves an installed executable without shell interpolation", async () => {
  const executable = await resolveDeveloperExecutable("node");
  assert.ok(executable);
});

test("returns undefined for a missing executable", async () => {
  assert.equal(await resolveDeveloperExecutable("definitely-not-an-executable"), undefined);
});
