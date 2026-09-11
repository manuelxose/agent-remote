import { Gateway, type GatewayDependencies } from "./index.js";
import {
  parseWhatsAppConfig,
  WhatsAppChannel,
  type WhatsAppAuthLoader,
  type WhatsAppLogger,
  type WhatsAppSocketFactory
} from "../../../channels/whatsapp/src/index.js";

export interface WhatsAppGatewayOptions {
  env?: Readonly<Record<string, string | undefined>>;
  onQr?: (qr: string) => void;
  logger?: WhatsAppLogger;
  loadAuthState?: WhatsAppAuthLoader;
  createSocket?: WhatsAppSocketFactory;
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
    createSocket: options.createSocket
  });
  gateway = new Gateway({ ...dependencies, channel });
  return { gateway, channel };
}
