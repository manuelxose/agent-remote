export type RuntimeType = "developer-agent" | "chatbot";

export type AgentType = string;

export type LogicalParticipantKind = "human" | "agent" | "system";

export interface LogicalParticipant {
  id: string;
  kind: LogicalParticipantKind;
  displayName: string;
}

export interface MessageOrigin {
  type: LogicalParticipantKind;
  agentId?: string;
  executionId?: string;
  logicalSessionId?: string;
}

export type Metadata = Record<string, string>;

export interface MessageReference {
  channel: string;
  conversationId: string;
  messageId: string;
  senderId?: string;
}

export interface OutboundMessage {
  text: string;
  replyTo?: MessageReference;
  metadata?: Metadata;
  origin?: MessageOrigin;
}

export interface MessageAttachment {
  kind: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
}

export interface Message {
  id: string;
  conversationId: string;
  channel: string;
  senderId: string;
  text: string;
  receivedAt: Date;
  groupId?: string;
  attachments?: MessageAttachment[];
  metadata?: Metadata;
  replyReference?: MessageReference;
  origin?: MessageOrigin;
}

export interface Conversation {
  id: string;
  channel: string;
  participantIds: string[];
  metadata: Metadata;
}

export interface Route {
  id: string;
  runtime: RuntimeType;
  agent: AgentType;
  tenant?: string;
  workspaceRoot?: string;
}

export interface ExecutionContext {
  correlationId: string;
  conversationId: string;
  executionId?: string;
  logicalSessionId?: string;
  workspaceRoot?: string;
  signal?: AbortSignal;
  metadata?: Metadata;
  observer?: { onEvent(event: unknown): void | Promise<void> };
}

export interface ConversationContext {
  message: Message;
  conversation: Conversation;
  route: Route;
  execution: ExecutionContext;
}

export interface AgentResponse extends OutboundMessage {}

export interface ConversationAgent {
  id: string;
  type: RuntimeType;
  handleMessage(context: ConversationContext): Promise<AgentResponse>;
}

export interface AgentRuntime {
  type: RuntimeType;
  execute(context: ConversationContext, agent: ConversationAgent): Promise<AgentResponse>;
  executeStreaming?(context: ConversationContext, agent: ConversationAgent, observer: { onEvent(event: unknown): void | Promise<void> }): Promise<AgentResponse>;
  cancel?(executionId: string): Promise<void>;
  close?(): Promise<void>;
}

export interface Channel {
  id: string;
  receive(payload: unknown): Promise<Message>;
  send(conversationId: string, response: OutboundMessage): Promise<void>;
}
