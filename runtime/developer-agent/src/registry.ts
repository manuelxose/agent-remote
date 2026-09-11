import type { DeveloperAgentAdapter, DeveloperAgentAvailability } from "./contracts.js";

export interface ProviderRegistration {
  adapter: DeveloperAgentAdapter;
  availability: DeveloperAgentAvailability;
}

export class ProviderRegistry {
  private readonly registrations = new Map<string, ProviderRegistration>();
  private loaded?: Promise<void>;

  constructor(private readonly adapters: Readonly<Record<string, DeveloperAgentAdapter>>) {}

  async load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = Promise.all(Object.entries(this.adapters).map(async ([id, adapter]) => {
        const availability = await adapter.getAvailability();
        this.registrations.set(id, { adapter, availability });
      })).then(() => undefined);
    }
    await this.loaded;
  }

  async get(id: string): Promise<ProviderRegistration | undefined> {
    await this.load();
    return this.registrations.get(id);
  }

  async refresh(id?: string): Promise<void> {
    await this.load();
    const ids = id ? [id] : Object.keys(this.adapters);
    await Promise.all(ids.map(async provider => {
      const adapter = this.adapters[provider];
      if (adapter) this.registrations.set(provider, { adapter, availability: await (adapter.refreshAvailability?.() ?? adapter.getAvailability()) });
    }));
  }

  async health(): Promise<Readonly<Record<string, DeveloperAgentAvailability>>> {
    await this.load();
    return Object.fromEntries([...this.registrations.entries()].map(([id, registration]) => [id, registration.availability]));
  }
}
