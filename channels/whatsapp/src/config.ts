export interface WhatsAppConfig {
  authPath: string;
  allowedUsers: readonly string[];
  allowedChats: readonly string[];
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
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
    reconnectBaseDelayMs,
    reconnectMaxDelayMs
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

export type WhatsAppAuthorization =
  | { allowed: true }
  | { allowed: false; reason: "no_allowlist_configured" | "sender_not_allowlisted" | "chat_not_allowlisted" };

export function authorizeWhatsAppMessage(
  message: { senderId: string; conversationId: string; groupId?: string },
  config: WhatsAppConfig
): WhatsAppAuthorization {
  if (config.allowedUsers.length === 0 && config.allowedChats.length === 0) {
    return { allowed: false, reason: "no_allowlist_configured" };
  }
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
