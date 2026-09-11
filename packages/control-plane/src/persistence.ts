import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ConversationState = "UNINITIALIZED" | "READY_NO_AGENT" | "IDLE" | "RUNNING" | "CANCELLING" | "ERROR" | "CLOSED";

export interface ManagedConversation {
  logicalSessionId: string;
  channel: string;
  externalConversationId: string;
  ownerId: string;
  displayName: string;
  workspace: string;
  activeAgent?: string;
  modelAlias?: string;
  providerSessionIds: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  status: ConversationState;
  lastError?: string;
  lastPrompt?: string;
}

export interface IdempotencyRecord {
  messageId: string;
  recordedAt: string;
  correlationId: string;
  ownerId: string;
  logicalSessionId?: string;
}

export interface ConversationRepository {
  get(logicalSessionId: string): Promise<ManagedConversation | undefined>;
  findByExternal(channel: string, externalConversationId: string): Promise<ManagedConversation | undefined>;
  listByOwner(ownerId: string): Promise<ManagedConversation[]>;
  save(conversation: ManagedConversation): Promise<void>;
}

export interface ProviderSessionRepository {
  getProviderSession(logicalSessionId: string, agent: string, workspace: string): Promise<string | undefined>;
  setProviderSession(logicalSessionId: string, agent: string, workspace: string, nativeSessionId: string): Promise<void>;
  list(logicalSessionId: string): Promise<Record<string, string>>;
}

export interface IdempotencyRepository {
  has(messageId: string): Promise<boolean>;
  record(record: IdempotencyRecord): Promise<void>;
}

export interface SelectionRepository {
  getSelection(ownerId: string, channel: string): Promise<string | undefined>;
  setSelection(ownerId: string, channel: string, logicalSessionId: string): Promise<void>;
}

export interface ControlPlaneRepositories extends ConversationRepository, ProviderSessionRepository, IdempotencyRepository, SelectionRepository {
  load(): Promise<void>;
}

interface PersistedState {
  version: 1;
  conversations: Record<string, ManagedConversation>;
  providerSessions: Record<string, string>;
  idempotency: Record<string, IdempotencyRecord>;
  selections: Record<string, string>;
}

export class ControlPlaneStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ControlPlaneStateError";
  }
}

export class InMemoryControlPlaneStore implements ControlPlaneRepositories {
  protected readonly conversations = new Map<string, ManagedConversation>();
  protected readonly providerSessions = new Map<string, string>();
  protected readonly idempotency = new Map<string, IdempotencyRecord>();
  protected readonly selections = new Map<string, string>();

  async load(): Promise<void> {}

  async findByExternal(channel: string, externalConversationId: string): Promise<ManagedConversation | undefined> {
    const value = [...this.conversations.values()].find(item => item.channel === channel && item.externalConversationId === externalConversationId && item.status !== "CLOSED");
    return value ? clone(value) : undefined;
  }

  async listByOwner(ownerId: string): Promise<ManagedConversation[]> {
    return [...this.conversations.values()].filter(item => item.ownerId === ownerId && item.status !== "CLOSED").map(clone);
  }

  async save(conversation: ManagedConversation): Promise<void> {
    this.conversations.set(conversation.logicalSessionId, clone(conversation));
  }

  async get(logicalSessionId: string): Promise<ManagedConversation | undefined> {
    const value = this.conversations.get(logicalSessionId);
    return value ? clone(value) : undefined;
  }

  async getProviderSession(logicalSessionId: string, agent: string, workspace: string): Promise<string | undefined> {
    return this.providerSessions.get(providerKey(logicalSessionId, agent, workspace));
  }

  async setProviderSession(logicalSessionId: string, agent: string, workspace: string, nativeSessionId: string): Promise<void> {
    this.providerSessions.set(providerKey(logicalSessionId, agent, workspace), nativeSessionId);
  }

  async list(logicalSessionId: string): Promise<Record<string, string>> {
    const prefix = `${logicalSessionId}\u0000`;
    return Object.fromEntries([...this.providerSessions.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
  }

  async has(messageId: string): Promise<boolean> {
    return this.idempotency.has(messageId);
  }

  async record(record: IdempotencyRecord): Promise<void> {
    this.idempotency.set(record.messageId, { ...record });
  }

  async getSelection(ownerId: string, channel: string): Promise<string | undefined> {
    return this.selections.get(selectionKey(ownerId, channel));
  }

  async setSelection(ownerId: string, channel: string, logicalSessionId: string): Promise<void> {
    this.selections.set(selectionKey(ownerId, channel), logicalSessionId);
  }

  protected snapshot(): PersistedState {
    return {
      version: 1,
      conversations: Object.fromEntries([...this.conversations.entries()].map(([key, value]) => [key, clone(value)])),
      providerSessions: Object.fromEntries(this.providerSessions),
      idempotency: Object.fromEntries([...this.idempotency.entries()].map(([key, value]) => [key, { ...value }])),
      selections: Object.fromEntries(this.selections)
    };
  }

  protected hydrate(data: PersistedState): void {
    this.conversations.clear();
    this.providerSessions.clear();
    this.idempotency.clear();
    this.selections.clear();
    for (const [key, value] of Object.entries(data.conversations)) this.conversations.set(key, clone(value));
    for (const [key, value] of Object.entries(data.providerSessions)) this.providerSessions.set(key, value);
    for (const [key, value] of Object.entries(data.idempotency)) this.idempotency.set(key, { ...value });
    for (const [key, value] of Object.entries(data.selections)) this.selections.set(key, value);
  }
}

export class JsonControlPlaneStore extends InMemoryControlPlaneStore {
  private loaded = false;
  private loading?: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(readonly path: string, private readonly maxIdempotencyEntries = 4096) {
    super();
  }

  override async load(): Promise<void> {
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

  override async get(logicalSessionId: string): Promise<ManagedConversation | undefined> {
    await this.load();
    return super.get(logicalSessionId);
  }

  override async findByExternal(channel: string, externalConversationId: string): Promise<ManagedConversation | undefined> {
    await this.load();
    return super.findByExternal(channel, externalConversationId);
  }

  override async listByOwner(ownerId: string): Promise<ManagedConversation[]> {
    await this.load();
    return super.listByOwner(ownerId);
  }

  override async save(conversation: ManagedConversation): Promise<void> {
    await this.load();
    super.save(conversation);
    await this.persist();
  }

  override async getProviderSession(logicalSessionId: string, agent: string, workspace: string): Promise<string | undefined> {
    await this.load();
    return super.getProviderSession(logicalSessionId, agent, workspace);
  }

  override async setProviderSession(logicalSessionId: string, agent: string, workspace: string, nativeSessionId: string): Promise<void> {
    await this.load();
    super.setProviderSession(logicalSessionId, agent, workspace, nativeSessionId);
    await this.persist();
  }

  override async list(logicalSessionId: string): Promise<Record<string, string>> {
    await this.load();
    return super.list(logicalSessionId);
  }

  override async has(messageId: string): Promise<boolean> {
    await this.load();
    return super.has(messageId);
  }

  override async record(record: IdempotencyRecord): Promise<void> {
    await this.load();
    super.record(record);
    while (this.idempotency.size > this.maxIdempotencyEntries) {
      const oldest = this.idempotency.keys().next().value;
      if (typeof oldest === "string") this.idempotency.delete(oldest);
      else break;
    }
    await this.persist();
  }

  override async getSelection(ownerId: string, channel: string): Promise<string | undefined> {
    await this.load();
    return super.getSelection(ownerId, channel);
  }

  override async setSelection(ownerId: string, channel: string, logicalSessionId: string): Promise<void> {
    await this.load();
    super.setSelection(ownerId, channel, logicalSessionId);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const current = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.snapshot(), null, 2)}\n`, "utf8");
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
      throw new ControlPlaneStateError(`Unable to read control-plane state: ${this.path}`, { cause: error });
    }
    let data: unknown;
    try { data = JSON.parse(contents); }
    catch (error) { throw new ControlPlaneStateError(`Malformed control-plane state JSON: ${this.path}`, { cause: error }); }
    if (!isPersistedState(data)) throw new ControlPlaneStateError(`Malformed control-plane state: ${this.path}`);
    this.hydrate(data);
  }
}

function providerKey(logicalSessionId: string, agent: string, workspace: string): string {
  return [logicalSessionId, agent, workspace].join("\u0000");
}

function selectionKey(ownerId: string, channel: string): string {
  return `${ownerId}\u0000${channel}`;
}

function clone(value: ManagedConversation): ManagedConversation {
  return { ...value, providerSessionIds: { ...value.providerSessionIds } };
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return state.version === 1 && isRecord(state.conversations) && isRecord(state.providerSessions)
    && isRecord(state.idempotency) && isRecord(state.selections)
    && Object.values(state.conversations).every(isManagedConversation)
    && Object.values(state.providerSessions).every(item => typeof item === "string")
    && Object.values(state.idempotency).every(isIdempotencyRecord)
    && Object.values(state.selections).every(item => typeof item === "string");
}

function isManagedConversation(value: unknown): value is ManagedConversation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ["logicalSessionId", "channel", "externalConversationId", "ownerId", "displayName", "workspace", "createdAt", "updatedAt", "lastActivityAt", "status"].every(key => typeof item[key] === "string")
    && ["UNINITIALIZED", "READY_NO_AGENT", "IDLE", "RUNNING", "CANCELLING", "ERROR", "CLOSED"].includes(item.status as string)
    && (item.activeAgent === undefined || typeof item.activeAgent === "string")
    && (item.modelAlias === undefined || typeof item.modelAlias === "string")
    && (item.lastError === undefined || typeof item.lastError === "string")
    && (item.lastPrompt === undefined || typeof item.lastPrompt === "string")
    && isRecord(item.providerSessionIds) && Object.values(item.providerSessionIds).every(value => typeof value === "string");
}

function isIdempotencyRecord(value: unknown): value is IdempotencyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.messageId === "string" && typeof item.recordedAt === "string" && typeof item.correlationId === "string" && typeof item.ownerId === "string"
    && (item.logicalSessionId === undefined || typeof item.logicalSessionId === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
