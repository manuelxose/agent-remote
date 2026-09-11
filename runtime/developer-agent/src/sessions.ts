import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface DeveloperSessionState {
  nativeSessionId: string;
}

export function createDeveloperSessionKey(channel: string, conversationId: string, agentId: string, workspaceRoot: string): string {
  return JSON.stringify([channel, conversationId, agentId, workspaceRoot]);
}

export interface DeveloperSessionStore {
  load(): Promise<void>;
  get(key: string): Promise<DeveloperSessionState | undefined>;
  set(key: string, state: DeveloperSessionState): Promise<void>;
  delete?(key: string): Promise<void>;
}

export class DeveloperSessionStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DeveloperSessionStateError";
  }
}

export class InMemoryDeveloperSessionStore implements DeveloperSessionStore {
  private readonly sessions = new Map<string, DeveloperSessionState>();

  async load(): Promise<void> {}

  async get(key: string): Promise<DeveloperSessionState | undefined> {
    return this.sessions.get(key);
  }

  async set(key: string, state: DeveloperSessionState): Promise<void> {
    this.sessions.set(key, state);
  }

  async delete(key: string): Promise<void> {
    this.sessions.delete(key);
  }
}

export class JsonDeveloperSessionStore implements DeveloperSessionStore {
  private readonly sessions = new Map<string, DeveloperSessionState>();
  // ponytail: in-process queue; use distributed per-conversation locks if the runtime becomes multi-process.
  private writeQueue: Promise<void> = Promise.resolve();
  private loaded = false;
  private loading?: Promise<void>;

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = this.read();
    try {
      await this.loading;
      this.loaded = true;
    } finally {
      this.loading = undefined;
    }
  }

  async get(key: string): Promise<DeveloperSessionState | undefined> {
    await this.load();
    return this.sessions.get(key);
  }

  async set(key: string, state: DeveloperSessionState): Promise<void> {
    await this.load();
    const current = this.writeQueue.then(async () => {
      const snapshot = new Map(this.sessions);
      snapshot.set(key, state);
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(snapshot), null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.path);
      this.sessions.set(key, state);
    });
    this.writeQueue = current.catch(() => undefined);
    await current;
  }

  async delete(key: string): Promise<void> {
    await this.load();
    const current = this.writeQueue.then(async () => {
      this.sessions.delete(key);
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(this.sessions), null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.path);
    });
    this.writeQueue = current.catch(() => undefined);
    await current;
  }

  private async read(): Promise<void> {
    let contents: string;
    try {
      contents = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new DeveloperSessionStateError(`Unable to read session state: ${this.path}`, { cause: error });
    }

    let data: unknown;
    try {
      data = JSON.parse(contents);
    } catch (error) {
      throw new DeveloperSessionStateError(`Malformed session state JSON: ${this.path}`, { cause: error });
    }
    if (!isSessionMap(data)) throw new DeveloperSessionStateError(`Malformed session state object: ${this.path}`);
    for (const [key, state] of Object.entries(data)) this.sessions.set(key, state);
  }
}

function isSessionMap(value: unknown): value is Record<string, DeveloperSessionState> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(state =>
    state !== null && typeof state === "object" && !Array.isArray(state) &&
    Object.keys(state).length === 1 && typeof state.nativeSessionId === "string"
  );
}
