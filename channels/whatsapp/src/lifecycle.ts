import makeWASocket, {
  DisconnectReason,
  type AuthenticationState,
  type BaileysEventMap,
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
    const message = isCoreMessage(payload) ? payload : translateWhatsAppMessage(payload);
    if (!message) throw new InvalidWhatsAppPayloadError();
    const authorization: WhatsAppAuthorization = this.config
      ? authorizeWhatsAppMessage(message, this.config)
      : { allowed: true };
    if (!authorization.allowed) {
      this.logRejection(message, authorization);
      throw new UnauthorizedWhatsAppMessageError(authorization.reason);
    }
    return message;
  }

  async send(conversationId: string, response: AgentResponse): Promise<void> {
    if (this.legacyDeliver) return this.legacyDeliver(conversationId, response.text);
    if (!this.socket || this.status !== "connected") throw new WhatsAppNotConnectedError();
    await this.socket.sendMessage(conversationId, { text: response.text });
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
      socket.ev.on("connection.update", update => { void this.handleConnectionUpdate(update); });
      socket.ev.on("messages.upsert", update => { void this.handleMessages(update); });
    } catch {
      this.lastErrorCode = undefined;
      this.setStatus("failed");
      this.logger.error("whatsapp_connection_failed");
      if (!this.stopping) this.scheduleReconnect();
    }
  }

  private async handleMessages(update: BaileysEventMap["messages.upsert"]): Promise<void> {
    if (update.requestId) return;
    for (const payload of update.messages) {
      try {
        await this.onMessage?.(await this.receive(payload));
      } catch (error) {
        if (error instanceof InvalidWhatsAppPayloadError || error instanceof UnauthorizedWhatsAppMessageError) continue;
        const message = translateWhatsAppMessage(payload);
        this.logger.error("whatsapp_message_handler_failed", message ? { messageId: message.id } : undefined);
      }
    }
  }

  private async handleConnectionUpdate(update: BaileysEventMap["connection.update"]): Promise<void> {
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
      this.socket = undefined;
      this.setStatus("logged_out");
      this.logger.warn("whatsapp_logged_out", { statusCode });
      return;
    }
    if (this.stopping) {
      this.setStatus("stopped");
      return;
    }
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
