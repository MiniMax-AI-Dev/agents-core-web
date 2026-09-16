export type PageOrder = "asc" | "desc";

export interface ListPage<T> {
  data: T[];
  has_more: boolean;
  object?: "list";
  first_id?: string | null;
  last_id?: string | null;
}

export interface PageOptions {
  after?: string;
  limit?: number;
  order?: PageOrder;
}

export interface ReadOptions {
  signal?: AbortSignal;
}

export type AgentTextFormat =
  | { type: "text" }
  | { type: "json_schema"; schema: Record<string, unknown> };

export interface AgentTextConfig {
  format: AgentTextFormat;
  verbosity: "low" | "medium" | "high";
}

export interface AgentTextInput {
  format?: AgentTextConfig["format"] | null;
  verbosity?: AgentTextConfig["verbosity"] | null;
}

export type AgentServiceTier = "auto" | "default" | "flex" | "priority" | "fast";
export type AgentReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type AgentReasoningSummary = "concise" | "detailed" | "auto";

export interface AgentReasoning {
  effort?: AgentReasoningEffort | null;
  summary?: AgentReasoningSummary | null;
}

export interface MultiAgentInput {
  enabled: boolean;
  max_concurrent_subagents?: number | null;
}

export interface FunctionToolInput {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  defer_loading?: boolean;
}

export interface ToolSearchInput {
  type: "tool_search";
}

export interface ProgrammaticToolCallingInput {
  type: "programmatic_tool_calling";
  enabled?: boolean;
}

export type SavedAgentToolInput = FunctionToolInput | ToolSearchInput | ProgrammaticToolCallingInput;
export type SessionFunctionToolInput = Omit<FunctionToolInput, "defer_loading"> & { defer_loading?: false };

export interface SavedAgent {
  id: string;
  object: "agent";
  model: string;
  name: string | null;
  instructions: string | null;
  metadata: Record<string, string>;
  multi_agent: {
    enabled: boolean;
    max_concurrent_subagents: number | null;
  };
  reasoning: AgentReasoning;
  service_tier: AgentServiceTier;
  text: AgentTextConfig;
  tools: unknown[];
  created_at: number;
  updated_at: number;
}

export interface CreateAgentInput {
  model: string;
  name?: string | null;
  instructions?: string | null;
  metadata?: Record<string, string> | null;
  multi_agent?: MultiAgentInput | null;
  reasoning?: AgentReasoning | null;
  service_tier?: AgentServiceTier | null;
  text?: AgentTextInput | null;
  tools?: SavedAgentToolInput[] | null;
}

export type UpdateAgentInput = Partial<CreateAgentInput>;

export interface InlineAgentInput {
  model?: string;
  instructions?: string | null;
  tools?: SessionFunctionToolInput[] | null;
  text?: AgentTextInput | null;
  reasoning?: AgentReasoning | null;
  service_tier?: AgentServiceTier | null;
  multi_agent?: MultiAgentInput | null;
}

export type AgentSnapshot = Omit<SavedAgent, "object" | "metadata" | "created_at" | "updated_at">;

declare const unknownEnvironmentType: unique symbol;
declare const unknownItemType: unique symbol;
declare const unknownSessionEventType: unique symbol;

export interface NoneAgentEnvironment {
  type: "none";
}

export interface SelfHostedAgentEnvironmentInput {
  type: "self_hosted";
  workspace_directory: string;
  capability_directories?: string[] | null;
}

export type AgentEnvironmentInput = NoneAgentEnvironment | SelfHostedAgentEnvironmentInput;

export interface SelfHostedAgentEnvironment {
  type: "self_hosted";
  id: string;
  remote_url: string;
  workspace_directory: string;
  capability_directories: string[];
}

export type UnknownEnvironmentType = string & { readonly [unknownEnvironmentType]: true };

export interface UnknownAgentEnvironment {
  type: UnknownEnvironmentType;
  [key: string]: unknown;
}

export type AgentEnvironment = NoneAgentEnvironment | SelfHostedAgentEnvironment | UnknownAgentEnvironment;

export type EnvironmentResourceStatus = "pending" | "connected" | "disconnected" | "expired" | "failed";

export interface AgentEnvironmentResource {
  id: string;
  object: "agent.environment";
  type: "self_hosted";
  status: EnvironmentResourceStatus;
  files: unknown[];
  plugins: unknown[];
  skills: unknown[];
}

export type SessionStatus = "idle" | "in_progress" | "requires_action" | "failed";

export interface FunctionCallAction {
  type: "function_call";
  call_id: string;
  turn_id: string;
  name: string;
  arguments: unknown;
}

export interface EnvironmentConnectionAction {
  type: "environment_connection";
  environment_id: string;
}

export type RequiredAction = FunctionCallAction | EnvironmentConnectionAction;

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details: {
    cached_tokens: number;
  };
  output_tokens_details: {
    reasoning_tokens: number;
  };
}

export interface AgentSession {
  id: string;
  object: "agent.session";
  agent: AgentSnapshot;
  environment: AgentEnvironment;
  status: SessionStatus;
  error: string | null;
  metadata: Record<string, string>;
  required_actions: RequiredAction[];
  vault_ids: string[];
  usage: TokenUsage | null;
  created_at: number;
  last_active_at: number;
}

export interface CreateSessionInput {
  agent_id?: string;
  agent?: InlineAgentInput;
  environment: AgentEnvironmentInput;
  input?: string | InputMessage[] | null;
  metadata?: Record<string, string> | null;
  /** This JSON-returning method does not support the endpoint's streaming create variant. */
  stream?: false;
  vault_ids?: string[];
}

export interface InputTextContent {
  type: "input_text";
  text: string;
}

export interface InputMessage {
  type?: "message";
  role: "user";
  content: InputTextContent[];
}

export type ItemStatus = "in_progress" | "completed" | "failed" | "incomplete";

export interface ItemContent {
  type: "input_text" | "output_text" | "input_image";
  text?: string | null;
  image_url?: string;
}

export type KnownSessionItemType =
  | "message"
  | "command_execution"
  | "mcp_call"
  | "function_call"
  | "function_call_output"
  | "web_search_call";

export type UnknownSessionItemType = string & { readonly [unknownItemType]: true };

export interface SessionItemBase {
  id: string;
  turn_id: string;
  status: ItemStatus;
  role?: "user" | "assistant";
  phase?: "commentary" | "final_answer";
  content?: ItemContent[];
  command?: string;
  cwd?: string | null;
  duration_ms?: number | null;
  exit_code?: number | null;
  name?: string;
  call_id?: string;
  server_label?: string;
  arguments?: unknown;
  output?: unknown;
  error?: unknown;
  action?: WebSearchAction;
}

export interface KnownSessionItem extends SessionItemBase {
  type: KnownSessionItemType;
}

export interface UnknownSessionItem extends SessionItemBase {
  type: UnknownSessionItemType;
  [key: string]: unknown;
}

export type SessionItem = KnownSessionItem | UnknownSessionItem;

export interface WebSearchAction {
  type: "search" | "open_page" | "find_in_page" | "other";
  query?: string | null;
  queries?: string[];
  url?: string | null;
  pattern?: string | null;
}

export type TurnStatus = "queued" | "in_progress" | "waiting" | "completed" | "failed" | "cancelled";

export interface AgentTurn {
  id: string;
  agent_id: string;
  session_id: string;
  object: "agent.session.turn";
  status: TurnStatus;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  error: { code: "internal_error"; message: string } | null;
  usage: TokenUsage | null;
}

export interface StreamError {
  code: string;
  type: string;
  message: string;
}

export type SessionEnvironmentStatus = "pending" | "ready" | "connected" | "disconnected" | "failed";

export interface SessionEnvironmentState {
  id: string;
  type: string;
  status: SessionEnvironmentStatus;
  error: StreamError | null;
}

export interface SessionEventBase {
  event_id: string;
  session_id?: string;
  turn_id?: string;
  session?: AgentSession;
  turn?: AgentTurn;
  item?: SessionItem;
  item_id?: string;
  output_index?: number;
  content_index?: number;
  part?: ItemContent;
  delta?: string;
  text?: string;
  error?: StreamError;
}

export type AgentSessionEnvironmentEvent = {
  [Status in SessionEnvironmentStatus]: SessionEventBase & {
    type: `agent.session.environment.${Status}`;
    environment: SessionEnvironmentState & { status: Status };
  };
}[SessionEnvironmentStatus];

export type KnownSessionEventType =
  | "agent.session.created"
  | "agent.session.in_progress"
  | "agent.session.requires_action"
  | "agent.session.idle"
  | "agent.session.failed"
  | "agent.session.turn.created"
  | "agent.session.turn.in_progress"
  | "agent.session.turn.waiting"
  | "agent.session.turn.completed"
  | "agent.session.turn.failed"
  | "agent.session.turn.cancelled"
  | "agent.session.turn.item.added"
  | "agent.session.turn.item.done"
  | "agent.session.turn.output_text.delta"
  | "agent.session.turn.output_text.done";

export interface KnownSessionEvent extends SessionEventBase {
  type: KnownSessionEventType;
}

export type UnknownSessionEventType = string & { readonly [unknownSessionEventType]: true };

export interface UnknownSessionEvent extends SessionEventBase {
  type: UnknownSessionEventType;
  [key: string]: unknown;
}

export type SessionEvent = AgentSessionEnvironmentEvent | KnownSessionEvent | UnknownSessionEvent;

export interface AgentDeleted {
  id: string;
  object: "agent.deleted";
  deleted: true;
}

export interface SessionDeleted {
  id: string;
  object: "agent.session.deleted";
  deleted: true;
}

export interface FunctionResultInput {
  callId: string;
  turnId: string;
  success: boolean;
  output?: string | FunctionResultContent[] | null;
  error?: string | null;
}

export type FunctionResultContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export interface StreamOptions {
  signal?: AbortSignal;
  /** Called once the authenticated streaming response has been accepted. */
  onOpen?: () => void;
  onEvent: (event: SessionEvent) => void;
}

export interface AgentCore {
  listAgents(options?: PageOptions): Promise<ListPage<SavedAgent>>;
  createAgent(input: CreateAgentInput): Promise<SavedAgent>;
  retrieveAgent(agentId: string): Promise<SavedAgent>;
  updateAgent(agentId: string, input: UpdateAgentInput): Promise<SavedAgent>;
  deleteAgent(agentId: string): Promise<AgentDeleted>;
  listSessions(options?: PageOptions & { agentId?: string }): Promise<ListPage<AgentSession>>;
  createSession(input: CreateSessionInput, idempotencyKey?: string): Promise<AgentSession>;
  retrieveSession(sessionId: string, options?: ReadOptions): Promise<AgentSession>;
  retrieveEnvironment(environmentId: string, options?: ReadOptions): Promise<AgentEnvironmentResource>;
  updateSession(sessionId: string, metadata: Record<string, string> | null): Promise<AgentSession>;
  deleteSession(sessionId: string): Promise<SessionDeleted>;
  listItems(sessionId: string, options?: PageOptions & ReadOptions): Promise<ListPage<SessionItem>>;
  listTurns(sessionId: string, options?: PageOptions & ReadOptions): Promise<ListPage<AgentTurn>>;
  retrieveTurn(sessionId: string, turnId: string): Promise<AgentTurn>;
  sendMessage(sessionId: string, text: string, idempotencyKey?: string): Promise<void>;
  cancelTurn(sessionId: string, idempotencyKey?: string): Promise<void>;
  submitFunctionResult(sessionId: string, input: FunctionResultInput, idempotencyKey?: string): Promise<void>;
  streamEvents(sessionId: string, options: StreamOptions): Promise<void>;
}
