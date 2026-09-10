import { isAbsolute, relative, resolve } from "node:path";

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
    const candidate = resolve(path);
    const approved = this.roots.some(root => {
      const remainder = relative(root, candidate);
      return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
    });
    if (!approved) throw new WorkspaceAccessError(path);
    return candidate;
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
