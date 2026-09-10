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
    onMessage: payload => gateway.handle(payload),
    onQr: options.onQr,
    logger: options.logger,
    loadAuthState: options.loadAuthState,
    createSocket: options.createSocket
  });
  gateway = new Gateway({ ...dependencies, channel });
  return { gateway, channel };
}
