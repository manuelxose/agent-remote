import makeWASocket, {
  DisconnectReason,
  type AuthenticationState,
  type BaileysEventMap,
  type WAMessage,
  type WASocket
} from "@whiskeysockets/baileys";
import type { AgentResponse, Channel, Message } from "../../../packages/core/src/index.js";
import { authorizeWhatsAppMessage, type WhatsAppAuthorization, type WhatsAppConfig } from "./config.js";
import { translateWhatsAppMessage } from "./translate.js";

export type WhatsAppStatus = "stopped" | "connecting" | "qr" | "connected" | "reconnecting" | "logged_out" | "failed";

export interface WhatsAppHealth {
  status: WhatsAppStatus;
  changedAt: Date;
  reconnectAttempt: number;
  lastErrorCode?: number;
}

export interface WhatsAppLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface WhatsAppEvents {
  on<T extends keyof BaileysEventMap>(event: T, listener: (value: BaileysEventMap[T]) => void): void;
  off?<T extends keyof BaileysEventMap>(event: T, listener: (value: BaileysEventMap[T]) => void): void;
  removeAllListeners?<T extends keyof BaileysEventMap>(event: T): void;
}

export type WhatsAppSocket = Pick<WASocket, "sendMessage" | "end"> & { ev: WhatsAppEvents };
export type WhatsAppAuthState = { state: AuthenticationState; saveCreds: () => Promise<void> };
export type WhatsAppAuthLoader = (path: string) => Promise<WhatsAppAuthState>;
export type WhatsAppSocketFactory = (state: AuthenticationState) => WhatsAppSocket;

export interface WhatsAppChannelOptions {
  config: WhatsAppConfig;
  onMessage: (payload: unknown) => Promise<void>;
  onQr?: (qr: string) => void;
  logger?: WhatsAppLogger;
  loadAuthState?: WhatsAppAuthLoader;
  createSocket?: WhatsAppSocketFactory;
}

export class InvalidWhatsAppPayloadError extends Error {
  constructor() {
    super("Invalid WhatsApp payload");
    this.name = "InvalidWhatsAppPayloadError";
  }
}

export class UnauthorizedWhatsAppMessageError extends Error {
  constructor(reason: string) {
    super(`Unauthorized WhatsApp message: ${reason}`);
    this.name = "UnauthorizedWhatsAppMessageError";
  }
}

export class WhatsAppNotConnectedError extends Error {
  constructor() {
    super("WhatsApp is not connected");
    this.name = "WhatsAppNotConnectedError";
  }
}

interface SilentBaileysLogger {
  level: string;
  child(fields: Record<string, unknown>): SilentBaileysLogger;
  trace(value: unknown, message?: string): void;
  debug(value: unknown, message?: string): void;
  info(value: unknown, message?: string): void;
  warn(value: unknown, message?: string): void;
  error(value: unknown, message?: string): void;
}

const silentBaileysLogger: SilentBaileysLogger = {
  level: "silent",
  child: () => silentBaileysLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

const defaultLogger: WhatsAppLogger = {
  info: (event, fields) => console.log(JSON.stringify({ level: "info", event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: "warn", event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields }))
};

export class WhatsAppChannel implements Channel {
  readonly id = "whatsapp";

  private readonly config?: WhatsAppConfig;
  private readonly onMessage?: (payload: unknown) => Promise<void>;
  private readonly onQr: (qr: string) => void;
  private readonly logger: WhatsAppLogger;
  private readonly loadAuthState: WhatsAppAuthLoader;
  private readonly createSocket: WhatsAppSocketFactory;
  private readonly legacyDeliver?: (conversationId: string, text: string) => Promise<void>;
  private socket?: WhatsAppSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private startPromise?: Promise<void>;
  private stopping = true;
  private reconnectAttempt = 0;
  private lastErrorCode?: number;
  private status: WhatsAppStatus = "stopped";
  private changedAt = new Date();
  private readonly outboundMessageIds = new Map<string, number>();
  private readonly inboundMessages = new Map<string, { message: WAMessage; receivedAt: number }>();

  constructor(options: WhatsAppChannelOptions | ((conversationId: string, text: string) => Promise<void>)) {
    if (typeof options === "function") {
      this.legacyDeliver = options;
      this.onQr = () => {};
      this.logger = defaultLogger;
      this.loadAuthState = async () => { throw new Error("WhatsApp lifecycle is not configured"); };
      this.createSocket = () => { throw new Error("WhatsApp lifecycle is not configured"); };
      return;
    }
    this.config = options.config;
    this.onMessage = options.onMessage;
    this.onQr = options.onQr ?? (() => {});
    this.logger = options.logger ?? defaultLogger;
    this.loadAuthState = options.loadAuthState ?? (async path => {
      const { useMultiFileAuthState } = await import("@whiskeysockets/baileys");
      return useMultiFileAuthState(path);
    });
    this.createSocket = options.createSocket ?? (state => makeWASocket({
      auth: state,
      logger: silentBaileysLogger,
      printQRInTerminal: false,
      markOnlineOnConnect: false
    }));
    this.stopping = false;
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.stopping = false;
    this.startPromise = this.connect();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const socket = this.socket;
    this.socket = undefined;
    this.outboundMessageIds.clear();
    this.inboundMessages.clear();
    this.removeListeners(socket);
    if (socket) await socket.end(undefined);
    this.setStatus("stopped");
  }

  health(): WhatsAppHealth {
    return {
      status: this.status,
      changedAt: new Date(this.changedAt),
      reconnectAttempt: this.reconnectAttempt,
      ...(this.lastErrorCode === undefined ? {} : { lastErrorCode: this.lastErrorCode })
    };
  }

  async receive(payload: unknown): Promise<Message> {
    const message = isCoreMessage(payload)
      ? payload
      : translateWhatsAppMessage(payload, { allowSelfMessages: this.config?.allowSelfMessages });
    if (!message) throw new InvalidWhatsAppPayloadError();
    const authorization: WhatsAppAuthorization = this.config
      ? authorizeWhatsAppMessage(message, this.config, isSelfSentPayload(payload))
      : { allowed: true };
    if (!authorization.allowed) {
      this.logRejection(message, authorization);
      throw new UnauthorizedWhatsAppMessageError(authorization.reason);
    }
    if (!isCoreMessage(payload)) {
      const messageId = messageIdFromPayload(payload);
      if (messageId) this.rememberInboundMessage(messageId, payload as WAMessage);
    }
    return message;
  }

  async send(conversationId: string, response: AgentResponse): Promise<void> {
    if (this.legacyDeliver) return this.legacyDeliver(conversationId, response.text);
    if (!this.socket || this.status !== "connected") throw new WhatsAppNotConnectedError();
    for (const chunk of chunkText(response.text, this.config?.maxResponseChars ?? 4000)) {
      const replyToMessageId = response.metadata?.replyToMessageId;
      const quoted = replyToMessageId ? this.getInboundMessage(replyToMessageId) : undefined;
      const sent = quoted
        ? await this.socket.sendMessage(conversationId, { text: chunk }, { quoted: quoted.message })
        : await this.socket.sendMessage(conversationId, { text: chunk });
      const messageId = messageIdFromPayload(sent);
      if (messageId) this.rememberOutboundMessage(messageId);
    }
  }

  private async connect(): Promise<void> {
    if (this.stopping || !this.config || !this.onMessage) return;
    this.setStatus(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");
    try {
      const { state, saveCreds } = await this.loadAuthState(this.config.authPath);
      if (this.stopping) return;
      const socket = this.createSocket(state);
      this.socket = socket;
      socket.ev.on("creds.update", () => {
        void saveCreds().catch(() => this.logger.error("whatsapp_auth_persistence_failed"));
      });
      socket.ev.on("connection.update", update => { void this.handleConnectionUpdate(update, socket); });
      socket.ev.on("messages.upsert", update => { void this.handleMessages(update, socket); });
    } catch {
      this.lastErrorCode = undefined;
      this.setStatus("failed");
      this.logger.error("whatsapp_connection_failed");
      if (!this.stopping) this.scheduleReconnect();
    }
  }

  private async handleMessages(update: BaileysEventMap["messages.upsert"], socket: WhatsAppSocket): Promise<void> {
    if (this.socket !== socket) return;
    if (update.requestId) return;
    for (const payload of update.messages) {
      if (this.isTrackedOutbound(payload)) continue;
      try {
        await this.onMessage?.(await this.receive(payload));
      } catch (error) {
        if (error instanceof InvalidWhatsAppPayloadError || error instanceof UnauthorizedWhatsAppMessageError) continue;
        const message = translateWhatsAppMessage(payload);
        this.logger.error("whatsapp_message_handler_failed", message ? { messageId: message.id } : undefined);
      }
    }
  }

  private async handleConnectionUpdate(update: BaileysEventMap["connection.update"], socket: WhatsAppSocket): Promise<void> {
    if (this.socket !== socket) return;
    if (update.qr) {
      this.setStatus("qr");
      try {
        this.onQr(update.qr);
      } catch {
        this.logger.error("whatsapp_qr_handler_failed");
      }
    }
    if (update.connection === "open") {
      this.reconnectAttempt = 0;
      this.lastErrorCode = undefined;
      this.setStatus("connected");
      this.logger.info("whatsapp_connected");
      return;
    }
    if (update.connection !== "close") return;
    const statusCode = disconnectStatusCode(update.lastDisconnect?.error);
    this.lastErrorCode = statusCode;
    if (statusCode === DisconnectReason.loggedOut) {
      this.removeListeners(socket);
      this.socket = undefined;
      this.setStatus("logged_out");
      this.logger.warn("whatsapp_logged_out", { statusCode });
      return;
    }
    if (this.stopping) {
      this.setStatus("stopped");
      return;
    }
    this.removeListeners(socket);
    this.socket = undefined;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined || this.stopping || !this.config) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(
      this.config.reconnectMaxDelayMs,
      this.config.reconnectBaseDelayMs * (2 ** (this.reconnectAttempt - 1))
    );
    this.setStatus("reconnecting");
    this.logger.warn("whatsapp_reconnect_scheduled", { attempt: this.reconnectAttempt, delayMs: delay, statusCode: this.lastErrorCode });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private setStatus(status: WhatsAppStatus): void {
    this.status = status;
    this.changedAt = new Date();
  }

  private rememberOutboundMessage(messageId: string): void {
    this.pruneOutboundMessageIds();
    // ponytail: a 256-entry/2-minute ceiling keeps echo suppression bounded; use a durable outbound-id store if Baileys ever delays echoes beyond it.
    if (this.outboundMessageIds.size >= 256) {
      const oldest = this.outboundMessageIds.keys().next().value;
      if (typeof oldest === "string") this.outboundMessageIds.delete(oldest);
    }
    this.outboundMessageIds.set(messageId, Date.now());
  }

  private isTrackedOutbound(payload: unknown): boolean {
    const messageId = messageIdFromPayload(payload);
    if (!messageId) return false;
    this.pruneOutboundMessageIds();
    return this.outboundMessageIds.delete(messageId);
  }

  private pruneOutboundMessageIds(): void {
    const cutoff = Date.now() - 120_000;
    for (const [messageId, createdAt] of this.outboundMessageIds) {
      if (createdAt < cutoff) this.outboundMessageIds.delete(messageId);
    }
  }

  private rememberInboundMessage(messageId: string, message: WAMessage): void {
    this.pruneInboundMessages();
    // ponytail: a 256-entry/2-minute ceiling covers the reply window without retaining chat history; use durable message lookup if replies need to outlive the process.
    if (this.inboundMessages.size >= 256) {
      const oldest = this.inboundMessages.keys().next().value;
      if (typeof oldest === "string") this.inboundMessages.delete(oldest);
    }
    this.inboundMessages.set(messageId, { message, receivedAt: Date.now() });
  }

  private getInboundMessage(messageId: string): { message: WAMessage; receivedAt: number } | undefined {
    this.pruneInboundMessages();
    return this.inboundMessages.get(messageId);
  }

  private pruneInboundMessages(): void {
    const cutoff = Date.now() - 120_000;
    for (const [messageId, entry] of this.inboundMessages) {
      if (entry.receivedAt < cutoff) this.inboundMessages.delete(messageId);
    }
  }

  private logRejection(message: Message, authorization: Exclude<WhatsAppAuthorization, { allowed: true }>): void {
    this.logger.warn("whatsapp_security_rejection", {
      senderId: message.senderId,
      conversationId: message.conversationId,
      ...(message.groupId ? { groupId: message.groupId } : {}),
      reason: authorization.reason
    });
  }

  private removeListeners(socket: WhatsAppSocket | undefined): void {
    if (!socket?.ev.off && !socket?.ev.removeAllListeners) return;
    socket.ev.removeAllListeners?.("creds.update");
    socket.ev.removeAllListeners?.("connection.update");
    socket.ev.removeAllListeners?.("messages.upsert");
  }
}

function disconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const output = (error as { output?: unknown }).output;
  if (!output || typeof output !== "object") return undefined;
  const statusCode = (output as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function isCoreMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.channel === "whatsapp"
    && typeof message.id === "string"
    && typeof message.conversationId === "string"
    && typeof message.senderId === "string"
    && typeof message.text === "string"
    && message.receivedAt instanceof Date;
}

function messageIdFromPayload(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const key = (value as Record<string, unknown>).key;
  if (!key || typeof key !== "object") return undefined;
  const id = (key as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function isSelfSentPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const key = (value as Record<string, unknown>).key;
  return Boolean(key && typeof key === "object" && (key as Record<string, unknown>).fromMe === true);
}

function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += maxChars) chunks.push(text.slice(offset, offset + maxChars));
  return chunks;
}
