export type ToolHandler = (input: unknown) => unknown | Promise<unknown>;

export interface ToolRegistry {
  names(): readonly string[];
  has(name: string): boolean;
  invoke(name: string, input: unknown): Promise<unknown>;
}

export class ToolNotAllowedError extends Error {
  constructor(name: string) {
    super(`Tool is not allowlisted: ${name}`);
    this.name = "ToolNotAllowedError";
  }
}

export class DeveloperCapabilityError extends Error {
  constructor(name: string) {
    super(`Developer capability is forbidden in chatbot runtime: ${name}`);
    this.name = "DeveloperCapabilityError";
  }
}

export class AllowlistedToolRegistry implements ToolRegistry {
  private readonly tools: ReadonlyMap<string, ToolHandler>;

  constructor(tools: Readonly<Record<string, ToolHandler>>) {
    this.tools = new Map(Object.entries(tools));
  }

  names(): readonly string[] {
    return [...this.tools.keys()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async invoke(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolNotAllowedError(name);
    return tool(input);
  }
}
