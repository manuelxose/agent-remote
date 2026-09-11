import { createServer, type Server } from "node:http";
import type { AgentGeneratedMessageMetadata } from "../../../channels/whatsapp/src/agent-registry.js";

const MAX_SNAPSHOT_ENTRIES = 256;

export interface PresentationRegistryReader {
  snapshot(): AgentGeneratedMessageMetadata[];
}

export interface PresentationBridgeOptions {
  host: "127.0.0.1";
  port: number;
  token: string;
  readRegistry: () => readonly AgentGeneratedMessageMetadata[];
  allowedOrigin: string;
}

export interface PresentationBridge {
  start(): Promise<void>;
  stop(): Promise<void>;
  address(): string;
}

export function createPresentationBridge(options: PresentationBridgeOptions): PresentationBridge {
  if (options.host !== "127.0.0.1") throw new Error("Presentation bridge must bind to 127.0.0.1");
  const server = createServer((request, response) => {
    if (request.url !== "/registry") return send(response, 404);
    if (request.method === "OPTIONS") {
      if (request.headers.origin !== options.allowedOrigin || request.headers["access-control-request-headers"]?.toLowerCase() !== "x-agent-remote-token") return send(response, 403);
      if (request.headers["access-control-request-method"] !== "GET") return send(response, 405);
      response.writeHead(204, corsHeaders(options.allowedOrigin)).end();
      return;
    }
    if (request.method !== "GET") return send(response, 405);
    if (request.headers.origin !== options.allowedOrigin || request.headers["x-agent-remote-token"] !== options.token) return send(response, 403);
    response.writeHead(200, { ...corsHeaders(options.allowedOrigin), "Cache-Control": "no-store", "Content-Type": "application/json" });
    response.end(JSON.stringify(options.readRegistry().slice(0, MAX_SNAPSHOT_ENTRIES).map(cloneMetadata)));
  });

  return {
    start: () => listen(server, options.host, options.port),
    stop: () => close(server),
    address: () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Presentation bridge is not listening");
      return `${options.host}:${address.port}`;
    }
  };
}

function corsHeaders(origin: string): Record<string, string> {
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "x-agent-remote-token", "Access-Control-Allow-Methods": "GET", Vary: "Origin" };
}

function send(response: import("node:http").ServerResponse, status: number): void { response.writeHead(status).end(); }

function cloneMetadata(metadata: AgentGeneratedMessageMetadata): AgentGeneratedMessageMetadata {
  return { ...metadata, origin: { ...metadata.origin } };
}

function listen(server: Server, host: string, port: number): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => { server.off("listening", ready); reject(error); };
    const ready = () => { server.off("error", fail); resolve(); };
    server.once("error", fail);
    server.once("listening", ready);
    server.listen(port, host);
  });
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
