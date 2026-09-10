import type { Route } from "../../core/src/index.js";

export interface RouteResolver {
  resolve(channel: string, conversationId: string): Route;
}

export class RouteNotFoundError extends Error {
  constructor(channel: string, conversationId: string) {
    super(`No route configured for ${channel}/${conversationId}`);
    this.name = "RouteNotFoundError";
  }
}

export class ConfigurationRouter implements RouteResolver {
  constructor(private readonly routes: Readonly<Record<string, Route>>) {}

  resolve(channel: string, conversationId: string): Route {
    const route = this.routes[`${channel}-${conversationId}`];
    if (!route) throw new RouteNotFoundError(channel, conversationId);
    return route;
  }
}
