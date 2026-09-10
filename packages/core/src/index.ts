export type RuntimeType = "developer-agent" | "chatbot";

export type AgentType = string;

export type Metadata = Record<string, string>;

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
  workspaceRoot?: string;
  signal?: AbortSignal;
  metadata?: Metadata;
}

export interface ConversationContext {
  message: Message;
  conversation: Conversation;
  route: Route;
  execution: ExecutionContext;
}

export interface AgentResponse {
  text: string;
  metadata?: Metadata;
}

export interface ConversationAgent {
  id: string;
  type: RuntimeType;
  handleMessage(context: ConversationContext): Promise<AgentResponse>;
}

export interface AgentRuntime {
  type: RuntimeType;
  execute(context: ConversationContext, agent: ConversationAgent): Promise<AgentResponse>;
}

export interface Channel {
  id: string;
  receive(payload: unknown): Promise<Message>;
  send(conversationId: string, response: AgentResponse): Promise<void>;
}
