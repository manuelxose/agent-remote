import type { EventBus } from "../../../packages/events/src/index.js";

export interface Worker {
  events: EventBus;
}

export function createWorker(events: EventBus): Worker {
  return { events };
}
