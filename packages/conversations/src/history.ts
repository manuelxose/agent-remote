import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Message } from "../../core/src/index.js";

export interface HistoryChat {
  channel: string;
  conversationId: string;
  displayName: string;
  kind: "private" | "group" | "unknown";
  updatedAt: string;
}

export interface HistoryQueryLimits {
  maxMessages: number;
  maxCharacters: number;
}

export interface HistoryQueryResult {
  chat: HistoryChat;
  messages: Message[];
  importedMessageCount: number;
  oldestAvailableAt?: Date;
  newestAvailableAt?: Date;
  truncated: boolean;
}

export interface HistoryStore {
  upsertChat(chat: HistoryChat): Promise<void>;
  upsertMessage(message: Message): Promise<void>;
  listChats(channel: string, query?: string, limit?: number): Promise<HistoryChat[]>;
  query(channel: string, conversationId: string, question: string, limits: HistoryQueryLimits): Promise<HistoryQueryResult | undefined>;
}

const separator = "\u0000";

export class InMemoryHistoryStore implements HistoryStore {
  protected readonly chats = new Map<string, HistoryChat>();
  protected readonly messages = new Map<string, Message>();

  async upsertChat(chat: HistoryChat): Promise<void> {
    this.chats.set(chatKey(chat.channel, chat.conversationId), cloneChat(chat));
  }

  async upsertMessage(message: Message): Promise<void> {
    const key = messageKey(message);
    if (!this.messages.has(key)) this.messages.set(key, cloneMessage(message));
    const chatKeyValue = chatKey(message.channel, message.conversationId);
    if (!this.chats.has(chatKeyValue)) {
      this.chats.set(chatKeyValue, {
        channel: message.channel,
        conversationId: message.conversationId,
        displayName: message.conversationId,
        kind: "unknown",
        updatedAt: message.receivedAt.toISOString()
      });
    }
  }

  async listChats(channel: string, query?: string, limit?: number): Promise<HistoryChat[]> {
    const needle = query?.toLowerCase() ?? "";
    const chats = [...this.chats.values()]
      .filter(chat => chat.channel === channel && chat.displayName.toLowerCase().includes(needle))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit === undefined ? undefined : Math.max(0, Math.floor(limit)));
    return chats.map(cloneChat);
  }

  async query(channel: string, conversationId: string, question: string, limits: HistoryQueryLimits): Promise<HistoryQueryResult | undefined> {
    const chat = this.chats.get(chatKey(channel, conversationId));
    if (!chat) return undefined;

    const messages = [...this.messages.values()]
      .filter(message => message.channel === channel && message.conversationId === conversationId)
      .sort(compareMessages);
    const tokens = question.toLowerCase().split(/\s+/).filter(Boolean);
    // ponytail: linear lexical scan; move to SQLite FTS/indexing when history volume requires it.
    const matching = tokens.length === 0
      ? messages
      : messages.filter(message => tokens.some(token => message.text.toLowerCase().includes(token)));
    const recent = [...messages].sort((left, right) => compareMessages(right, left));
    const candidates = [...matching, ...recent];
    const selected: Message[] = [];
    const maxMessages = Math.max(0, Math.floor(limits.maxMessages));
    const maxCharacters = Math.max(0, Math.floor(limits.maxCharacters));
    let characters = 0;

    for (const message of candidates) {
      if (selected.some(item => item.id === message.id)) continue;
      if (selected.length >= maxMessages || characters + message.text.length > maxCharacters) continue;
      selected.push(message);
      characters += message.text.length;
    }

    return {
      chat: cloneChat(chat),
      messages: selected.sort(compareMessages).map(cloneMessage),
      importedMessageCount: messages.length,
      oldestAvailableAt: messages[0] ? new Date(messages[0].receivedAt) : undefined,
      newestAvailableAt: messages.at(-1) ? new Date(messages.at(-1)!.receivedAt) : undefined,
      truncated: selected.length < messages.length
    };
  }
}

export class JsonHistoryStore extends InMemoryHistoryStore {
  private loaded?: Promise<void>;
  private writeQueue = Promise.resolve();

  constructor(readonly path: string) {
    super();
  }

  override async upsertChat(chat: HistoryChat): Promise<void> {
    await this.ensureLoaded();
    const key = chatKey(chat.channel, chat.conversationId);
    const next = cloneChat(chat);
    if (JSON.stringify(this.chats.get(key)) === JSON.stringify(next)) return;
    this.chats.set(key, next);
    await this.enqueue({ type: "chat", chat: next });
  }

  override async upsertMessage(message: Message): Promise<void> {
    await this.ensureLoaded();
    const key = messageKey(message);
    if (this.messages.has(key)) return;
    const next = cloneMessage(message);
    const chatKeyValue = chatKey(next.channel, next.conversationId);
    const hadChat = this.chats.has(chatKeyValue);
    await super.upsertMessage(next);
    if (!hadChat) {
      const chat = this.chats.get(chatKeyValue);
      if (chat) await this.enqueue({ type: "chat", chat });
    }
    await this.enqueue({ type: "message", message: next });
  }

  override async listChats(channel: string, query?: string, limit?: number): Promise<HistoryChat[]> {
    await this.ensureLoaded();
    return super.listChats(channel, query, limit);
  }

  override async query(channel: string, conversationId: string, question: string, limits: HistoryQueryLimits): Promise<HistoryQueryResult | undefined> {
    await this.ensureLoaded();
    return super.query(channel, conversationId, question, limits);
  }

  private async ensureLoaded(): Promise<void> {
    this.loaded ??= this.load();
    await this.loaded;
  }

  private async load(): Promise<void> {
    let contents: string;
    try {
      contents = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as { type?: string; chat?: unknown; message?: unknown };
        if (record.type === "chat") {
          const chat = parseChat(record.chat);
          if (chat) await super.upsertChat(chat);
        } else if (record.type === "message") {
          const message = parseMessage(record.message);
          if (message) await super.upsertMessage(message);
        }
      } catch {
        // Ignore malformed records and continue loading valid history.
      }
    }
  }

  private enqueue(record: object): Promise<void> {
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
      await chmod(this.path, 0o600);
    });
    this.writeQueue = write.then(() => undefined, () => undefined);
    return write;
  }
}

function chatKey(channel: string, conversationId: string): string {
  return `${channel}${separator}${conversationId}`;
}

function messageKey(message: Message): string {
  return `${message.channel}${separator}${message.conversationId}${separator}${message.id}`;
}

function compareMessages(left: Message, right: Message): number {
  return left.receivedAt.getTime() - right.receivedAt.getTime() || left.id.localeCompare(right.id);
}

function cloneChat(chat: HistoryChat): HistoryChat {
  return { ...chat };
}

function cloneMessage(message: Message): Message {
  return {
    ...message,
    receivedAt: new Date(message.receivedAt),
    attachments: message.attachments?.map(attachment => ({ ...attachment })),
    metadata: message.metadata ? { ...message.metadata } : undefined,
    replyReference: message.replyReference ? { ...message.replyReference } : undefined,
    origin: message.origin ? { ...message.origin } : undefined
  };
}

function parseChat(value: unknown): HistoryChat | undefined {
  if (!value || typeof value !== "object") return undefined;
  const chat = value as Partial<HistoryChat>;
  if (typeof chat.channel !== "string" || typeof chat.conversationId !== "string" || typeof chat.displayName !== "string" || typeof chat.updatedAt !== "string") return undefined;
  if (chat.kind !== "private" && chat.kind !== "group" && chat.kind !== "unknown") return undefined;
  return chat as HistoryChat;
}

function parseMessage(value: unknown): Message | undefined {
  if (!value || typeof value !== "object") return undefined;
  const message = value as Partial<Message> & { receivedAt?: unknown };
  if (typeof message.id !== "string" || typeof message.conversationId !== "string" || typeof message.channel !== "string" || typeof message.senderId !== "string" || typeof message.text !== "string" || typeof message.receivedAt !== "string") return undefined;
  const receivedAt = new Date(message.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) return undefined;
  return { ...message, receivedAt } as Message;
}
