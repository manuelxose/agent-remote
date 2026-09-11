export interface WhatsAppConfig {
  authPath: string;
  allowedUsers: readonly string[];
  allowedChats: readonly string[];
  allowSelfMessages: boolean;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  maxResponseChars: number;
  replyContextTtlMs: number;
  replyContextMaxEntries: number;
}

export class WhatsAppConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppConfigurationError";
  }
}

export function parseWhatsAppConfig(env: Readonly<Record<string, string | undefined>>): WhatsAppConfig {
  const authPath = env.WHATSAPP_AUTH_PATH?.trim();
  if (!authPath) throw new WhatsAppConfigurationError("WHATSAPP_AUTH_PATH is required");

  const reconnectBaseDelayMs = parsePositiveInteger(env.WHATSAPP_RECONNECT_BASE_DELAY_MS, 1000);
  const reconnectMaxDelayMs = parsePositiveInteger(env.WHATSAPP_RECONNECT_MAX_DELAY_MS, 30000);
  if (reconnectMaxDelayMs < reconnectBaseDelayMs) {
    throw new WhatsAppConfigurationError("WHATSAPP_RECONNECT_MAX_DELAY_MS must be at least the base delay");
  }

  return {
    authPath,
    allowedUsers: parseList(env.WHATSAPP_ALLOWED_USERS),
    allowedChats: parseList(env.WHATSAPP_ALLOWED_CHATS),
    allowSelfMessages: parseBoolean(env.WHATSAPP_ALLOW_SELF_MESSAGES, false),
    reconnectBaseDelayMs,
    reconnectMaxDelayMs,
    maxResponseChars: parsePositiveInteger(env.WHATSAPP_MAX_RESPONSE_CHARS, 4000),
    replyContextTtlMs: parsePositiveInteger(env.WHATSAPP_REPLY_CONTEXT_TTL_MS, 120_000),
    replyContextMaxEntries: parsePositiveInteger(env.WHATSAPP_REPLY_CONTEXT_MAX_ENTRIES, 256)
  };
}

function parseList(value: string | undefined): string[] {
  return value?.split(",").map(item => item.trim()).filter(Boolean) ?? [];
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new WhatsAppConfigurationError(`Invalid positive integer configuration value: ${value}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value.trim().toLowerCase() === "true") return true;
  if (value.trim().toLowerCase() === "false") return false;
  throw new WhatsAppConfigurationError(`Invalid boolean configuration value: ${value}`);
}

export type WhatsAppAuthorization =
  | { allowed: true }
  | { allowed: false; reason: "no_allowlist_configured" | "sender_not_allowlisted" | "chat_not_allowlisted" };

export function authorizeWhatsAppMessage(
  message: { senderId: string; conversationId: string; groupId?: string },
  config: WhatsAppConfig,
  selfSent = false
): WhatsAppAuthorization {
  if (config.allowedUsers.length === 0 && config.allowedChats.length === 0) {
    return { allowed: false, reason: "no_allowlist_configured" };
  }
  if (selfSent && config.allowSelfMessages) return { allowed: true };
  if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(message.senderId)) {
    return { allowed: false, reason: "sender_not_allowlisted" };
  }
  if (config.allowedChats.length > 0) {
    const chatAllowed = config.allowedChats.includes(message.conversationId)
      || (message.groupId !== undefined && config.allowedChats.includes(message.groupId));
    if (!chatAllowed) return { allowed: false, reason: "chat_not_allowlisted" };
  }
  return { allowed: true };
}
