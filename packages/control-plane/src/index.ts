import { randomUUID } from "node:crypto";
import type { AgentResponse, AgentRuntime, ConversationAgent, ConversationContext, Message, Route } from "../../core/src/index.js";
import type { EventBus } from "../../events/src/index.js";
import { InMemoryEventBus } from "../../events/src/index.js";
import type { WorkspacePolicy } from "../../security/src/index.js";
import {
  type ControlPlaneRepositories,
  type ConversationState,
  type ManagedConversation,
  InMemoryControlPlaneStore
} from "./persistence.js";

export type Role = "owner" | "operator" | "viewer";
export type CommandCategory = "SESSION" | "AGENTS" | "WORKSPACE" | "EXECUTION" | "SYSTEM";
export type CommandStatus = "success" | "warning" | "error";
export interface CommandAction { label: string; command: string; }
export interface CommandResult {
  text: string;
  status?: CommandStatus;
  metadata?: Record<string, string>;
  actions?: CommandAction[];
}
export interface ControlPlaneIdentity { id: string; role: Role; }
export interface ParsedCommand { name: string; args: string; }

export interface ModelResolution { alias: string; providerModel: string; }
export interface ModelPolicy {
  resolve(agent: string, alias?: string): ModelResolution | undefined;
  describe(agent: string): string;
  list?(agent: string): readonly string[];
}

export class ModelUnavailableError extends Error {
  constructor(readonly agent: string, readonly alias: string) {
    super(`Configured ${agent} model '${alias}' is unavailable.`);
    this.name = "ModelUnavailableError";
  }
}

export class ConfiguredModelPolicy implements ModelPolicy {
  constructor(
    private readonly aliases: Readonly<Record<string, Readonly<Record<string, string>>>>,
    private readonly defaults: Readonly<Record<string, string>> = {}
  ) {}

  resolve(agent: string, alias = this.defaults[agent]): ModelResolution | undefined {
    const selected = alias ?? (agent === "claude" ? "sonnet" : agent === "codex" ? "luna" : undefined);
    if (!selected) return undefined;
    const configured = Object.entries(this.aliases[agent] ?? {}).find(([name, model]) => name === selected || model === selected);
    if (!configured && alias === undefined && this.defaults[agent] === undefined) return undefined;
    if (!configured) throw new ModelUnavailableError(agent, selected);
    return { alias: configured[0], providerModel: configured[1] };
  }

  describe(agent: string): string {
    const alias = this.defaults[agent] ?? (agent === "claude" ? "sonnet" : agent === "codex" ? "luna" : "default");
    const providerModel = this.aliases[agent]?.[alias];
    return providerModel ?? "provider default";
  }

  list(agent: string): readonly string[] { return [...new Set(Object.values(this.aliases[agent] ?? {}))].sort(); }
}

export interface CommandContext {
  readonly message: Message;
  readonly identity: ControlPlaneIdentity;
  readonly session?: ManagedConversation;
  readonly args: string;
}

export interface CommandDefinition {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly usage: string;
  readonly category: CommandCategory;
  readonly requiresInitialization: boolean;
  readonly requiredRole?: Role;
  readonly states?: readonly ConversationState[];
  execute(context: CommandContext): Promise<CommandResult>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(definition: CommandDefinition): void {
    for (const name of [definition.name, ...(definition.aliases ?? [])]) this.commands.set(name.toLowerCase(), definition);
  }

  get(name: string): CommandDefinition | undefined { return this.commands.get(name.toLowerCase()); }

  parse(text: string): ParsedCommand | undefined {
    const match = text.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    return match ? { name: match[1].toLowerCase(), args: match[2]?.trim() ?? "" } : undefined;
  }

  get definitions(): CommandDefinition[] {
    return [...new Set(this.commands.values())].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  help(name?: string): string {
    const command = name ? this.get(name) : undefined;
    if (name && !command) return `Unknown command: /${name}\nUse /help to see available commands.`;
    if (command) return `${command.description}\n\nUsage: ${command.usage}`;
    const groups = new Map<CommandCategory, CommandDefinition[]>();
    for (const definition of this.definitions) groups.set(definition.category, [...(groups.get(definition.category) ?? []), definition]);
    const lines = ["🤖 Agent Remote", ""];
    for (const category of ["SESSION", "AGENTS", "WORKSPACE", "EXECUTION", "SYSTEM"] as const) {
      lines.push(category);
      for (const definition of groups.get(category) ?? []) lines.push(`${definition.usage} — ${definition.description}`);
      lines.push("");
    }
    return lines.join("\n").trim();
  }
}

export interface ControlPlaneOptions {
  repositories?: ControlPlaneRepositories;
  agents: Readonly<Record<string, ConversationAgent>>;
  runtimes: Readonly<Record<string, AgentRuntime>>;
  workspacePolicy: WorkspacePolicy;
  workspaceAliases?: Readonly<Record<string, string>>;
  defaultWorkspace: string;
  modelPolicy?: ModelPolicy;
  events?: EventBus;
  maxQueueDepth?: number;
  version?: string;
  diagnostics?: () => string;
  resetProviderSession?: (session: ManagedConversation, agent: string) => Promise<void>;
  onExecutionResponse?: (session: ManagedConversation, response: AgentResponse) => Promise<void>;
  onExecutionAccepted?: (session: ManagedConversation, message: Message) => Promise<void>;
  defaultAgent?: string;
  rateLimitPerMinute?: number;
}

export class ControlPlane {
  readonly registry: CommandRegistry;
  private readonly repositories: ControlPlaneRepositories;
  private readonly events: EventBus;
  private readonly queues = new Map<string, ExecutionQueue>();
  private readonly options: ControlPlaneOptions;
  private readonly rateHistory = new Map<string, number[]>();
  private accepting = true;

  constructor(options: ControlPlaneOptions) {
    this.options = options;
    this.repositories = options.repositories ?? new InMemoryControlPlaneStore();
    this.events = options.events ?? new InMemoryEventBus();
    this.registry = new CommandRegistry();
    this.registerCommands();
  }

  async load(): Promise<void> { await this.repositories.load(); }

  stopAccepting(): void { this.accepting = false; }

  async drain(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while ([...this.queues.values()].some(queue => queue.running) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    for (const queue of this.queues.values()) if (queue.running) await queue.cancel();
  }

  async handle(message: Message, identity: ControlPlaneIdentity): Promise<CommandResult> {
    await this.repositories.load();
    const correlationId = message.id;
    if (!this.acceptRate(identity.id, message.conversationId)) return this.rejected(correlationId, "Rate limit exceeded. Try again later.");
    const parsed = this.registry.parse(message.text);
    if (!parsed && /^\s*\//.test(message.text)) {
      if (!(await this.claim(message, identity))) return this.duplicate(correlationId, identity.id);
      return this.rejected(correlationId, "Malformed command. Use /help to see available commands.");
    }
    let session = parsed?.name === "init"
      ? await this.repositories.findByExternal(message.channel, message.conversationId).then(value => value?.ownerId === identity.id ? value : undefined)
      : await this.resolveSession(message, identity);
    if (!session && roleAtLeast(identity.role, "operator") && (!parsed || ["claude", "codex", "copilot"].includes(parsed.name))) {
      session = await this.autoInitialize(message, identity, parsed?.name);
    }
    if (parsed) {
      await this.publish("command.received", correlationId, { name: parsed.name, ownerId: identity.id });
      const definition = this.registry.get(parsed.name);
      if (!definition) {
        if (!(await this.claim(message, identity))) return this.duplicate(correlationId, identity.id);
        return this.rejected(correlationId, `Unknown command: /${parsed.name}\nUse /help to see available commands.`);
      }
      if (definition.requiresInitialization && !session) {
        if (!(await this.claim(message, identity))) return this.duplicate(correlationId, identity.id);
        return this.rejected(correlationId, "This conversation is not initialized. Use /init first.");
      }
      if (session && definition.states && !definition.states.includes(session.status)) {
        if (!(await this.claim(message, identity))) return this.duplicate(correlationId, identity.id);
        return this.rejected(correlationId, `Command /${definition.name} is not available while this chat is ${session.status.toLowerCase()}.`);
      }
      if (definition.requiredRole && !roleAtLeast(identity.role, definition.requiredRole)) {
        await this.publish("security.denied", correlationId, { command: definition.name, ownerId: identity.id, role: identity.role });
        return this.rejected(correlationId, "You are not authorized to use this command.");
      }
      if (!(await this.claim(message, identity, session?.logicalSessionId))) return this.duplicate(correlationId, identity.id);
      const result = await definition.execute({ message, identity, session, args: parsed.args });
      await this.publish("command.completed", correlationId, { name: definition.name, ownerId: identity.id });
      return result;
    }
    if (!session) {
      if (!(await this.claim(message, identity))) return this.duplicate(correlationId, identity.id);
      return this.rejected(correlationId, "This conversation is not initialized. Use /init first.");
    }
    if (session.status === "CLOSED") {
      if (!(await this.claim(message, identity, session.logicalSessionId))) return this.duplicate(correlationId, identity.id);
      return this.rejected(correlationId, "This chat is closed. Use /init first.");
    }
    if (!roleAtLeast(identity.role, "operator")) {
      await this.publish("security.denied", correlationId, { command: "prompt", ownerId: identity.id, role: identity.role });
      if (!(await this.claim(message, identity, session.logicalSessionId))) return this.duplicate(correlationId, identity.id);
      return this.rejected(correlationId, "You are not authorized to submit provider prompts.");
    }
    if (!session.activeAgent) {
      if (!(await this.claim(message, identity, session.logicalSessionId))) return this.duplicate(correlationId, identity.id);
      return { text: "Select an agent first: /claude, /codex, or /copilot.", status: "warning" };
    }
    if (session.status === "CANCELLING") {
      if (!(await this.claim(message, identity, session.logicalSessionId))) return this.duplicate(correlationId, identity.id);
      return this.rejected(correlationId, "This chat is cancelling. Try again when it returns to idle.");
    }
    if (!this.accepting) {
      if (!(await this.claim(message, identity, session.logicalSessionId))) return this.duplicate(correlationId, identity.id);
      return { text: "Gateway is shutting down; no new executions are accepted.", status: "warning" };
    }
    return this.executePrompt(session, message, identity);
  }

  private registerCommands(): void {
    const add = (name: string, description: string, usage: string, category: CommandCategory, execute: (context: CommandContext) => Promise<CommandResult>, options: Partial<CommandDefinition> = {}) => this.registry.register({ name, description, usage, category, requiresInitialization: true, states: ["UNINITIALIZED", "READY_NO_AGENT", "IDLE", "RUNNING", "CANCELLING", "ERROR", "CLOSED"], execute, ...options });
    add("help", "Show available commands or detailed command help.", "/help [command]", "SYSTEM", async ({ args }) => ({ text: this.registry.help(args || undefined) }), { requiresInitialization: false });
    add("init", "Initialize or reactivate the current managed chat.", "/init [name]", "SESSION", context => this.init(context), { requiresInitialization: false, requiredRole: "operator", states: ["UNINITIALIZED", "READY_NO_AGENT", "IDLE", "ERROR", "CLOSED"] });
    add("chats", "List managed chats owned by the current identity.", "/chats", "SESSION", context => this.chats(context));
    add("chat", "Select an owned managed chat by name or ID.", "/chat <name|id>", "SESSION", context => this.chat(context));
    add("rename", "Rename the current managed chat.", "/rename <name>", "SESSION", context => this.rename(context), { states: ["READY_NO_AGENT", "IDLE", "ERROR"] });
    add("close", "Close the current managed chat without deleting provider sessions.", "/close", "SESSION", context => this.close(context), { requiredRole: "owner", states: ["READY_NO_AGENT", "IDLE", "ERROR"] });
    add("reset", "Start a fresh provider context for the active agent.", "/reset confirm", "SESSION", context => this.reset(context), { requiredRole: "operator", states: ["READY_NO_AGENT", "IDLE", "ERROR"] });
    for (const agent of ["claude", "codex", "copilot"]) add(agent, `Select ${agent} as the active developer agent.`, `/${agent}`, "AGENTS", context => this.selectAgent(context, agent), { requiredRole: "operator", states: ["READY_NO_AGENT", "IDLE", "ERROR"] });
    add("agent", "Show the currently selected agent.", "/agent", "AGENTS", async context => ({ text: `Agent: ${context.session?.activeAgent ?? "none"}` }));
    add("model", "Show or change the configured provider model.", "/model [provider-model-id]", "AGENTS", context => this.model(context), { requiredRole: "operator", states: ["READY_NO_AGENT", "IDLE", "ERROR"] });
    add("workspace", "Show or change the approved workspace.", "/workspace [use <alias-or-approved-path>]", "WORKSPACE", context => this.workspace(context), { requiredRole: "operator", states: ["READY_NO_AGENT", "IDLE", "ERROR"] });
    add("workspaces", "List approved workspaces.", "/workspaces", "WORKSPACE", context => this.workspaces(context));
    add("status", "Show safe gateway and conversation status.", "/status", "EXECUTION", context => this.status(context), { requiresInitialization: false });
    add("running", "Show current execution and queue information.", "/running", "EXECUTION", context => this.running(context));
    add("cancel", "Cancel the current execution.", "/cancel", "EXECUTION", context => this.cancel(context), { requiredRole: "operator", states: ["RUNNING"] });
    add("retry", "Retry the last failed prompt.", "/retry", "EXECUTION", context => this.retry(context), { requiredRole: "operator", states: ["ERROR"] });
    add("history", "Show safe recent interaction metadata.", "/history", "EXECUTION", context => this.history(context));
    add("doctor", "Show operator diagnostics.", "/doctor", "SYSTEM", async () => ({ text: this.options.diagnostics?.() ?? "Doctor diagnostics are available from the gateway process." }), { requiredRole: "operator" });
    add("health", "Show lightweight gateway health.", "/health", "SYSTEM", async () => ({ text: "Gateway: available" }));
    add("version", "Show application version.", "/version", "SYSTEM", async () => ({ text: `agent-remote ${this.options.version ?? "unknown"}` }));
    add("whoami", "Show safe channel, conversation, and identity information.", "/whoami", "SYSTEM", async ({ message, identity }) => ({ text: `Identity: ${identity.id}\nChannel: ${message.channel}\nConversation: ${message.conversationId}` }), { requiresInitialization: false });
  }

  private async init(context: CommandContext): Promise<CommandResult> {
    const existing = await this.repositories.findByExternal(context.message.channel, context.message.conversationId);
    if (existing && existing.ownerId !== context.identity.id) return { text: "This external conversation is already managed by another identity.", status: "error" };
    const workspace = this.resolveWorkspace(this.options.defaultWorkspace);
    if (!workspace) return { text: "The configured default workspace is unavailable or outside approved roots.", status: "error" };
    const now = new Date().toISOString();
    const session: ManagedConversation = existing ?? {
      logicalSessionId: randomUUID(), channel: context.message.channel, externalConversationId: context.message.conversationId,
      ownerId: context.identity.id, displayName: context.args || `${context.message.channel}-${context.message.conversationId.slice(0, 12)}`,
      workspace, providerSessionIds: {}, createdAt: now, updatedAt: now,
      lastActivityAt: now, status: "READY_NO_AGENT"
    };
    if (existing) {
      session.status = session.status === "CLOSED" ? "READY_NO_AGENT" : session.status;
      if (context.args) session.displayName = context.args;
      session.updatedAt = now;
      session.lastActivityAt = now;
    }
    await this.repositories.save(session);
    await this.repositories.setSelection(context.identity.id, context.message.channel, session.logicalSessionId);
    await this.publish("conversation.initialized", context.message.id, { logicalSessionId: session.logicalSessionId, ownerId: session.ownerId });
    return { text: `Chat initialized: ${session.displayName}\nWorkspace: ${session.workspace}\nSelect an agent with /claude, /codex, or /copilot.` };
  }

  private async autoInitialize(message: Message, identity: ControlPlaneIdentity, requestedAgent?: string): Promise<ManagedConversation | undefined> {
    const workspace = this.resolveWorkspace(this.options.defaultWorkspace);
    if (!workspace) return undefined;
    const activeAgent = requestedAgent ?? this.options.defaultAgent ?? "codex";
    if (!["claude", "codex", "copilot"].includes(activeAgent)) return undefined;
    const existing = await this.repositories.findByExternal(message.channel, message.conversationId);
    if (existing) return existing.ownerId === identity.id ? existing : undefined;
    const now = new Date().toISOString();
    const session: ManagedConversation = {
      logicalSessionId: randomUUID(), channel: message.channel, externalConversationId: message.conversationId,
      ownerId: identity.id, displayName: `${message.channel}-${message.conversationId.slice(0, 12)}`,
      workspace, activeAgent, providerSessionIds: {}, createdAt: now, updatedAt: now,
      lastActivityAt: now, status: "IDLE"
    };
    await this.repositories.save(session);
    await this.repositories.setSelection(identity.id, message.channel, session.logicalSessionId);
    await this.publish("conversation.initialized", message.id, { logicalSessionId: session.logicalSessionId, ownerId: session.ownerId, agent: activeAgent, automatic: true });
    return session;
  }

  private async chats(context: CommandContext): Promise<CommandResult> {
    const sessions = await this.repositories.listByOwner(context.identity.id);
    if (!sessions.length) return { text: "No initialized chats. Use /init [name]." };
    return { text: ["Your chats", "", ...sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => `${item.logicalSessionId === context.session?.logicalSessionId ? "●" : "○"} ${item.displayName}\n  Agent: ${item.activeAgent ?? "none"}\n  Workspace: ${item.workspace}\n  Status: ${item.status.toLowerCase()}`)].join("\n") };
  }

  private async chat(context: CommandContext): Promise<CommandResult> {
    if (!context.args) return { text: "Usage: /chat <name|id>", status: "warning" };
    const sessions = await this.repositories.listByOwner(context.identity.id);
    const selected = sessions.find(item => item.channel === context.message.channel && (item.logicalSessionId === context.args || item.displayName.toLowerCase() === context.args.toLowerCase()));
    if (!selected) return { text: `Chat not found: ${context.args}`, status: "error" };
    await this.repositories.setSelection(context.identity.id, context.message.channel, selected.logicalSessionId);
    return { text: `Active chat: ${selected.displayName}\nAgent: ${selected.activeAgent ?? "none"}\nWorkspace: ${selected.workspace}` };
  }

  private async rename(context: CommandContext): Promise<CommandResult> {
    if (!context.session || !context.args) return { text: "Usage: /rename <name>", status: "warning" };
    context.session.displayName = context.args;
    await this.touch(context.session);
    await this.publish("conversation.renamed", context.message.id, { logicalSessionId: context.session.logicalSessionId });
    return { text: `Chat renamed to: ${context.args}` };
  }

  private async close(context: CommandContext): Promise<CommandResult> {
    if (!context.session) return { text: "No active chat.", status: "warning" };
    const queue = this.queue(context.session.logicalSessionId);
    if (queue.running) return { text: "Cannot close a running chat. Use /cancel first.", status: "warning" };
    context.session.status = "CLOSED";
    await this.touch(context.session);
    await this.repositories.clearSelection(context.identity.id, context.message.channel);
    await this.publish("conversation.closed", context.message.id, { logicalSessionId: context.session.logicalSessionId });
    return { text: `Chat closed: ${context.session.displayName}` };
  }

  private async reset(context: CommandContext): Promise<CommandResult> {
    if (!context.session || !context.args || context.args.toLowerCase() !== "confirm") return { text: "Usage: /reset confirm", status: "warning" };
    if (context.session.activeAgent) {
      delete context.session.providerSessionIds[`${context.session.activeAgent}:${context.session.workspace}`];
      await this.repositories.deleteProviderSession(context.session.logicalSessionId, context.session.activeAgent, context.session.workspace);
      await this.options.resetProviderSession?.(context.session, context.session.activeAgent);
    }
    await this.touch(context.session);
    return { text: "Provider context reset. The next message starts a new context." };
  }

  private async selectAgent(context: CommandContext, agent: string): Promise<CommandResult> {
    if (!context.session) return { text: "Use /init first.", status: "warning" };
    if (context.args) return { text: `Usage: /${agent}`, status: "warning" };
    context.session.activeAgent = agent;
    context.session.modelAlias = undefined;
    context.session.status = "IDLE";
    await this.touch(context.session);
    await this.publish("agent.selected", context.message.id, { logicalSessionId: context.session.logicalSessionId, agent });
    return { text: `${agent[0].toUpperCase()}${agent.slice(1)} activated\nModel: ${this.options.modelPolicy?.describe(agent) ?? "provider default"}\nWorkspace: ${context.session.workspace}\nSession: ${context.session.displayName}\n\nAll following messages will be sent to ${agent}.` };
  }

  private async model(context: CommandContext): Promise<CommandResult> {
    if (!context.session?.activeAgent) return { text: "No active agent. Select one first." };
    try {
      const resolution = this.options.modelPolicy?.resolve(context.session.activeAgent, context.args || context.session.modelAlias);
      if (!resolution) {
        const available = this.options.modelPolicy?.list?.(context.session.activeAgent) ?? [];
        return { text: [`Model: ${this.options.modelPolicy?.describe(context.session.activeAgent) ?? "provider default"}`, ...(available.length ? [`Available: ${available.join(", ")}`] : [])].join("\n") };
      }
      if (context.args) context.session.modelAlias = resolution.alias;
      await this.touch(context.session);
      await this.publish("model.resolved", context.message.id, { logicalSessionId: context.session.logicalSessionId, agent: context.session.activeAgent, alias: resolution.alias });
      return { text: `${context.session.activeAgent} → ${resolution.providerModel}` };
    } catch (error) {
      return { text: error instanceof ModelUnavailableError ? `${error.message}\nRun /doctor for details.` : "Configured model is unavailable.\nRun /doctor for details.", status: "error" };
    }
  }

  private async workspace(context: CommandContext): Promise<CommandResult> {
    if (!context.session) return { text: "Use /init first." };
    if (!context.args) return { text: `Workspace: ${context.session.workspace}` };
    const match = context.args.match(/^use\s+(.+)$/i);
    if (!match) return { text: "Usage: /workspace use <alias-or-approved-path>", status: "warning" };
    const resolved = this.resolveWorkspace(match[1].trim());
    if (!resolved) return { text: "Workspace is outside the approved roots or is not configured.", status: "error" };
    context.session.workspace = resolved;
    await this.touch(context.session);
    await this.publish("workspace.selected", context.message.id, { logicalSessionId: context.session.logicalSessionId, workspace: resolved });
    return { text: `Workspace selected: ${resolved}` };
  }

  private async workspaces(_context: CommandContext): Promise<CommandResult> {
    const aliases = Object.entries(this.options.workspaceAliases ?? {});
    const lines = aliases.length ? aliases.map(([alias, path]) => `${alias} → ${path}`) : [this.options.defaultWorkspace];
    return { text: `Approved workspaces\n${lines.join("\n")}` };
  }

  private async status(context: CommandContext): Promise<CommandResult> {
    if (!context.session) return { text: "Gateway: available\nConversation: uninitialized" };
    return { text: `Gateway: available\nChat: ${context.session.displayName}\nState: ${context.session.status}\nAgent: ${context.session.activeAgent ?? "none"}\nWorkspace: ${context.session.workspace}` };
  }

  private async running(context: CommandContext): Promise<CommandResult> {
    if (!context.session) return { text: "Nothing is currently running." };
    const queue = this.queue(context.session.logicalSessionId);
    return { text: queue.running ? `Running\nQueued: ${queue.depth}` : "Nothing is currently running." };
  }

  private async cancel(context: CommandContext): Promise<CommandResult> {
    if (!context.session) return { text: "Nothing is currently running." };
    const queue = this.queue(context.session.logicalSessionId);
    if (!queue.running) return { text: "Nothing is currently running." };
    context.session.status = "CANCELLING";
    await this.touch(context.session);
    await this.publish("execution.cancelled", context.message.id, { logicalSessionId: context.session.logicalSessionId });
    await queue.cancel();
    return { text: "Cancelled" };
  }

  private async retry(context: CommandContext): Promise<CommandResult> {
    if (!context.session?.lastError || !context.session.activeAgent || !context.session.lastPrompt) return { text: "There is no failed execution to retry.", status: "warning" };
    const message: Message = { ...context.message, id: `${context.message.id}:retry`, text: context.session.lastPrompt };
    return this.executePrompt(context.session, message, context.identity);
  }

  private async history(context: CommandContext): Promise<CommandResult> {
    if (!context.session) return { text: "No initialized chat." };
    return { text: `Chat: ${context.session.displayName}\nCreated: ${context.session.createdAt}\nLast activity: ${context.session.lastActivityAt}\nState: ${context.session.status}` };
  }

  private async executePrompt(session: ManagedConversation, message: Message, identity: ControlPlaneIdentity): Promise<CommandResult> {
    const agentId = session.activeAgent!;
    let model: ModelResolution | undefined;
    try { model = this.options.modelPolicy?.resolve(agentId, session.modelAlias); }
    catch (error) { return { text: error instanceof ModelUnavailableError ? `${error.message}\nRun /doctor for details.` : "Configured model is unavailable.\nRun /doctor for details.", status: "error" }; }
    const queue = this.queue(session.logicalSessionId);
    if (!queue.hasCapacity) return { text: "Execution queue is full. Try again later.", status: "warning" };
    if (!(await this.claim(message, identity, session.logicalSessionId))) return this.duplicate(message.id, identity.id);
    try { await this.options.onExecutionAccepted?.(session, message); } catch {}
    let deferred = false;
    const task = async (signal: AbortSignal): Promise<AgentResponse> => {
      const current = await this.repositories.get(session.logicalSessionId) ?? session;
      current.status = "RUNNING";
      current.lastPrompt = message.text;
      current.lastError = undefined;
      await this.touch(current);
      await this.publish("execution.started", message.id, { logicalSessionId: current.logicalSessionId, agent: agentId });
      let response: AgentResponse;
      try {
        const runtime = this.options.runtimes["developer-agent"];
        const agent = this.options.agents[agentId];
        if (!runtime || !agent) throw new Error(`Agent is unavailable: ${agentId}`);
        const route: Route = { id: `managed-${current.logicalSessionId}`, runtime: "developer-agent", agent: agentId, workspaceRoot: current.workspace };
        const conversation = { id: current.logicalSessionId, channel: current.channel, participantIds: [identity.id], metadata: {} };
        const context: ConversationContext = { message, conversation, route, execution: { correlationId: message.id, conversationId: current.logicalSessionId, workspaceRoot: current.workspace, signal, metadata: model ? { model: model.providerModel, modelAlias: model.alias } : undefined } };
        response = await runtime.execute(context, agent);
      } catch {
        response = { text: "Unable to complete the developer-agent request.", metadata: { agent: agentId, reason: "execution-failed" } };
      }
      await this.finalizeExecution(current, message.id, agentId, response);
      if (deferred) {
        try { await this.options.onExecutionResponse?.(current, response); } catch {}
      }
      return response;
    };
    const result = queue.enqueue(task);
    if (!result.started && result.position < 0) {
      await this.repositories.release(message.id);
      return { text: "Execution queue is full. Try again later.", status: "warning" };
    }
    if (!result.started) {
      deferred = true;
      await this.publish("execution.queued", message.id, { logicalSessionId: session.logicalSessionId, position: result.position });
      return { text: `Queued · position ${result.position}`, status: "success" };
    }
    try {
      const response = await result.promise;
      return { text: response.text, metadata: response.metadata };
    } catch {
      return { text: "Unable to complete the developer-agent request.", status: "error" };
    }
  }

  private async finalizeExecution(session: ManagedConversation, messageId: string, agentId: string, response: AgentResponse): Promise<void> {
    const current = await this.repositories.get(session.logicalSessionId) ?? session;
    const failed = Boolean(response.metadata?.reason && response.metadata.reason !== "cancelled");
    current.status = failed ? "ERROR" : "IDLE";
    current.lastError = failed ? response.metadata?.reason : undefined;
    if (response.metadata?.sessionId) {
      current.providerSessionIds[`${agentId}:${current.workspace}`] = response.metadata.sessionId;
      await this.repositories.setProviderSession(current.logicalSessionId, agentId, current.workspace, response.metadata.sessionId);
    }
    await this.touch(current);
    await this.publish(response.metadata?.reason === "cancelled" ? "execution.cancelled" : failed ? "execution.failed" : "execution.completed", messageId, { logicalSessionId: current.logicalSessionId, agent: agentId });
  }

  private async resolveSession(message: Message, identity: ControlPlaneIdentity): Promise<ManagedConversation | undefined> {
    const external = await this.repositories.findByExternal(message.channel, message.conversationId);
    if (external && external.ownerId === identity.id) return external;
    const selected = await this.repositories.getSelection(identity.id, message.channel);
    const chosen = selected ? await this.repositories.get(selected) : undefined;
    if (chosen && chosen.ownerId === identity.id && chosen.channel === message.channel) return chosen;
    return undefined;
  }

  private resolveWorkspace(value: string): string | undefined {
    const candidate = this.options.workspaceAliases?.[value] ?? value;
    try { return this.options.workspacePolicy.assertPath(candidate); } catch { return undefined; }
  }

  private async touch(session: ManagedConversation): Promise<void> {
    const now = new Date().toISOString();
    session.updatedAt = now;
    session.lastActivityAt = now;
    await this.repositories.save(session);
  }

  private queue(logicalSessionId: string): ExecutionQueue {
    let queue = this.queues.get(logicalSessionId);
    if (!queue) {
      queue = new ExecutionQueue(this.options.maxQueueDepth ?? 8);
      this.queues.set(logicalSessionId, queue);
    }
    return queue;
  }

  private async rejected(correlationId: string, text: string): Promise<CommandResult> {
    await this.publish("command.rejected", correlationId, { reason: text.slice(0, 160) });
    return { text, status: "warning" };
  }

  private async claim(message: Message, identity: ControlPlaneIdentity, logicalSessionId?: string): Promise<boolean> {
    const claimed = await this.repositories.claim({ messageId: message.id, recordedAt: new Date().toISOString(), correlationId: message.id, ownerId: identity.id, ...(logicalSessionId ? { logicalSessionId } : {}) });
    return claimed;
  }

  private duplicate(correlationId: string, ownerId: string): CommandResult {
    void this.publish("message.duplicate", correlationId, { messageId: correlationId, ownerId });
    return { text: "Duplicate message ignored.", status: "warning" };
  }

  private async publish(type: Parameters<EventBus["publish"]>[0]["type"], correlationId: string, payload: Record<string, unknown>): Promise<void> {
    try { await this.events.publish({ type, occurredAt: new Date(), correlationId, payload }); } catch {}
  }

  private acceptRate(identityId: string, conversationId: string): boolean {
    const limit = this.options.rateLimitPerMinute;
    if (!limit) return true;
    const key = `${identityId}\u0000${conversationId}`;
    const cutoff = Date.now() - 60_000;
    const history = (this.rateHistory.get(key) ?? []).filter(timestamp => timestamp >= cutoff);
    if (history.length >= limit) {
      this.rateHistory.set(key, history);
      return false;
    }
    history.push(Date.now());
    this.rateHistory.set(key, history);
    return true;
  }
}

class ExecutionQueue {
  private active?: { controller: AbortController; promise: Promise<AgentResponse> };
  private readonly pending: Array<{ task: (signal: AbortSignal) => Promise<AgentResponse>; resolve: (response: AgentResponse) => void; reject: (error: unknown) => void }> = [];
  private cancelling = false;

  constructor(private readonly maxDepth: number) {}

  get running(): boolean { return this.active !== undefined; }
  get depth(): number { return this.pending.length; }
  get hasCapacity(): boolean { return !this.cancelling && (!this.active || this.pending.length < this.maxDepth); }

  enqueue(task: (signal: AbortSignal) => Promise<AgentResponse>): { started: true; promise: Promise<AgentResponse> } | { started: false; position: number } {
    if (this.cancelling) return { started: false, position: -2 };
    if (!this.active) {
      const promise = this.start(task);
      return { started: true, promise };
    }
    if (this.pending.length >= this.maxDepth) return { started: false, position: -1 };
    let resolve!: (response: AgentResponse) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<AgentResponse>((res, rej) => { resolve = res; reject = rej; });
    this.pending.push({ task, resolve, reject });
    promise.catch(() => {});
    return { started: false, position: this.pending.length };
  }

  async cancel(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.cancelling = true;
    for (const item of this.pending.splice(0)) item.reject(new Error("cancelled"));
    active.controller.abort();
    try { await active.promise; } catch {}
    this.cancelling = false;
  }

  private start(task: (signal: AbortSignal) => Promise<AgentResponse>): Promise<AgentResponse> {
    const controller = new AbortController();
    const promise = task(controller.signal).finally(() => {
      if (this.active?.promise !== promise) return;
      this.active = undefined;
      if (this.cancelling) return;
      const next = this.pending.shift();
      if (next) {
        const nextPromise = this.start(next.task);
        nextPromise.then(next.resolve, next.reject);
      }
    });
    this.active = { controller, promise };
    return promise;
  }
}

function roleAtLeast(actual: Role, required: Role): boolean {
  const rank: Record<Role, number> = { viewer: 1, operator: 2, owner: 3 };
  return rank[actual] >= rank[required];
}

export { type ControlPlaneRepositories, type ManagedConversation, type ConversationState, InMemoryControlPlaneStore, JsonControlPlaneStore, ControlPlaneStateError } from "./persistence.js";
