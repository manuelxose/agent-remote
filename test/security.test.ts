import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

test("WorkspacePolicy rejects approved-root and candidate symlinks escaping their real root", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-policy-"));
  const approved = join(directory, "approved");
  const outside = join(directory, "outside");
  try {
    await Promise.all([mkdir(approved), mkdir(outside)]);
    await symlink(outside, join(directory, "approved-link"));
    await symlink(outside, join(approved, "candidate-link"));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === "EPERM" || (error as NodeJS.ErrnoException).code === "EACCES") {
      t.skip(`symlink permissions unavailable: ${(error as Error).message}`);
      return;
    }
    throw error;
  }

  try {
    const linkedPolicy = new WorkspacePolicy([join(directory, "approved-link")]);
    assert.equal(linkedPolicy.assertPath(join(directory, "approved-link", "file.txt")), join(outside, "file.txt"));
    assert.throws(() => new WorkspacePolicy([approved]).assertPath(join(approved, "candidate-link", "file.txt")), /outside approved workspace roots/);
    assert.equal(new WorkspacePolicy([approved]).assertPath(join(approved, "new", "file.txt")), join(approved, "new", "file.txt"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WorkspacePolicy rejects a dangling symlink before a write can escape", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-policy-dangling-"));
  const approved = join(directory, "approved");
  const outside = join(directory, "outside");
  const dangling = join(approved, "escape.txt");
  const outsideFile = join(outside, "created.txt");
  try {
    await Promise.all([mkdir(approved), mkdir(outside)]);
    await symlink(outsideFile, dangling);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === "EPERM" || (error as NodeJS.ErrnoException).code === "EACCES") {
      t.skip(`symlink permissions unavailable: ${(error as Error).message}`);
      return;
    }
    throw error;
  }

  try {
    const policy = new WorkspacePolicy([approved]);
    assert.throws(() => {
      const safePath = policy.assertPath(dangling);
      return writeFile(safePath, "must not escape");
    }, /outside approved workspace roots/);
    await assert.rejects(() => import("node:fs/promises").then(({ access }) => access(outsideFile)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
