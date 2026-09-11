import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export class WorkspaceAccessError extends Error {
  constructor(path: string) {
    super(`Path is outside approved workspace roots: ${path}`);
    this.name = "WorkspaceAccessError";
  }
}

export class WorkspacePolicy {
  private readonly roots: string[];

  constructor(approvedRoots: readonly string[]) {
    if (approvedRoots.length === 0) throw new Error("At least one approved workspace root is required");
    this.roots = approvedRoots.map(root => resolve(root));
  }

  assertPath(path: string): string {
    let candidate: string;
    try {
      candidate = canonicalizeExistingAncestor(path);
    } catch {
      throw new WorkspaceAccessError(path);
    }
    const approved = this.roots.some(root => {
      let canonicalRoot: string;
      try {
        canonicalRoot = canonicalizeExistingAncestor(root);
      } catch {
        return false;
      }
      const remainder = relative(canonicalRoot, candidate);
      return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
    });
    if (!approved) throw new WorkspaceAccessError(path);
    return candidate;
  }
}

function canonicalizeExistingAncestor(path: string): string {
  let current = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      suffix.unshift(basename(current));
      current = parent;
      continue;
    }
    return join(realpathSync.native(current), ...suffix);
  }
}

export interface DeveloperCapabilities {
  readonly policy: WorkspacePolicy;
  shell(command: string, cwd: string): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  git(args: readonly string[], cwd: string): Promise<string>;
}

export interface LocalDeveloperOperations {
  shell(command: string, cwd: string): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  git(args: readonly string[], cwd: string): Promise<string>;
}

export function createRestrictedDeveloperCapabilities(
  approvedRoots: readonly string[],
  operations: LocalDeveloperOperations
): DeveloperCapabilities {
  const policy = new WorkspacePolicy(approvedRoots);
  return {
    policy,
    shell: (command, cwd) => operations.shell(command, policy.assertPath(cwd)),
    readFile: path => operations.readFile(policy.assertPath(path)),
    writeFile: (path, contents) => operations.writeFile(policy.assertPath(path), contents),
    git: (args, cwd) => operations.git(args, policy.assertPath(cwd))
  };
}
