import { Gateway, type GatewayDependencies } from "./index.js";
import {
  parseWhatsAppConfig,
  WhatsAppChannel,
  type WhatsAppAuthLoader,
  type WhatsAppHistorySink,
  type WhatsAppLogger,
  type WhatsAppSocketFactory
} from "../../../channels/whatsapp/src/index.js";
import type { Message } from "../../../packages/core/src/index.js";

export interface WhatsAppGatewayOptions {
  env?: Readonly<Record<string, string | undefined>>;
  onQr?: (qr: string) => void;
  logger?: WhatsAppLogger;
  loadAuthState?: WhatsAppAuthLoader;
  createSocket?: WhatsAppSocketFactory;
  historySink?: WhatsAppHistorySink;
  onMessage?: (message: Message, channel: WhatsAppChannel, gateway: Gateway) => Promise<void>;
  onError?: (error: unknown, payload: unknown, channel: WhatsAppChannel) => Promise<void>;
  onCommand?: (payload: unknown, channel: WhatsAppChannel, gateway: Gateway) => Promise<boolean>;
}

export interface WhatsAppGatewayApplication {
  gateway: Gateway;
  channel: WhatsAppChannel;
}

export function createWhatsAppGateway(
  dependencies: Omit<GatewayDependencies, "channel">,
  options: WhatsAppGatewayOptions = {}
): WhatsAppGatewayApplication {
  const env = options.env ?? (globalThis as typeof globalThis & {
    process?: { env: Readonly<Record<string, string | undefined>> };
  }).process?.env ?? {};
  let gateway!: Gateway;
  const channel = new WhatsAppChannel({
    config: parseWhatsAppConfig(env),
    onMessage: async payload => {
      try {
        const message = isCoreMessage(payload) ? payload : await channel.receive(payload);
        if (options.onMessage) {
          await options.onMessage(message, channel, gateway);
          return;
        }
        if (options.onCommand && await options.onCommand(payload, channel, gateway)) return;
        await gateway.handle(payload);
      } catch (error) {
        if (options.onError) await options.onError(error, payload, channel);
        else throw error;
      }
    },
    onQr: options.onQr,
    logger: options.logger,
    loadAuthState: options.loadAuthState,
    createSocket: options.createSocket,
    historySink: options.historySink
  });
  gateway = new Gateway({ ...dependencies, channel });
  return { gateway, channel };
}

function isCoreMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Message;
  return message.channel === "whatsapp" && typeof message.id === "string" && typeof message.conversationId === "string"
    && typeof message.senderId === "string" && typeof message.text === "string" && message.receivedAt instanceof Date;
}
