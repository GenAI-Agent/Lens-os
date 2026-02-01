/**
 * Lens OS SDK - Core Type Definitions
 */

// ==================== SDK Config ====================

export interface LensSDKConfig {
  /** API Key for authentication */
  apiKey: string;

  /** OpenAI API Key */
  openaiKey: string;

  /**
   * Base URL for LensOS API.
   * Default: https://osapi.ask-lens.ai
   */
  baseUrl?: string;

  /** Model to use (default: gpt-4o) */
  model?: string;

  /** Maximum turns for agent loop (default: 10) */
  maxTurns?: number;

  /** Language (default: zh-TW) */
  language?: 'zh-TW' | 'en-US';

  /** Callback when trace is generated */
  onTrace?: (trace: LLMTrace) => void;

  /** Callback for widget actions (click, scroll, etc.) */
  onWidgetAction?: (action: string, params: any) => Promise<any>;

  /**
   * Custom tool executors - override default tool implementations
   * Key is the tool name (e.g., 'product_search', 'knowledge_search')
   * Value can be:
   *   - A function that takes params and returns ToolResult
   *   - A ToolExecutorConfig object with execute function and metadata
   *
   * Example:
   * ```
   * toolExecutors: {
   *   product_search: {
   *     execute: async (params) => {
   *       const res = await fetch('/api/products/search', { method: 'POST', body: JSON.stringify(params) });
   *       return { success: true, result: await res.json() };
   *     },
   *     description: 'Search for books/products',
   *     whenToUse: 'User wants to find books, search products, or asks about specific titles',
   *     schema: { query: { type: 'string', required: true }, topK: { type: 'number', default: 10 } }
   *   }
   * }
   * ```
   */
  toolExecutors?: {
    [toolName: string]: ToolExecutorFunction | ToolExecutorConfig;
  };
}

/** Simple tool executor function */
export type ToolExecutorFunction = (params: any) => Promise<ToolResult>;

/** Tool executor with metadata for prompt generation */
export interface ToolExecutorConfig {
  /** The executor function */
  execute: ToolExecutorFunction;
  /** Tool description for Available Tools section */
  description?: string;
  /** When to use guidance for LLM (can be multi-line, separated by \n or ,) */
  whenToUse?: string;
  /** Parameter schema for prompt */
  schema?: Record<string, {
    type: string;
    required?: boolean;
    default?: any;
    description?: string;
  }>;
  /** Output description */
  output?: string;
}

// ==================== Tenant Config (from API /v1/config) ====================

export interface TenantConfig {
  /** System prompt (main agent behavior and tool definitions) */
  systemPrompt?: string;

  /** Site prompts (additional context prompts) */
  prompts: SitePrompt[];

  /** Available skills */
  skills: Skill[];

  /** Registered tools */
  tools: ToolRegistryItem[];

  /** Config version for cache invalidation */
  version: string;
}

export interface SitePrompt {
  id: string;
  name: string;
  prompt: string;
  isGlobal: boolean;
  isActive: boolean;
}

export interface Skill {
  id: string;
  name: string;
  displayName: string;
  prompt: string;
  description?: string;
  temperature?: number;
  maxTokens?: number;
  enabledTools?: string[];
}

export interface ToolRegistryItem {
  id: string;
  name: string;
  displayName: string;
  description: string;
  type: 'builtin' | 'custom' | 'mcp';
  schema?: Record<string, any>;
  config?: Record<string, any>;

  /**
   * Tool execution configuration (from ToolConfig table)
   * If present, SDK will auto-execute based on executionMode
   */
  execution?: ToolExecutionConfig;
}

export interface ToolExecutionConfig {
  /** Whether this tool is enabled for this tenant */
  isEnabled: boolean;

  /**
   * Execution mode:
   * - PLATFORM: executed by Lens OS built-in implementation
   * - CUSTOMER: executed by calling customerEndpoint URL
   */
  executionMode: 'PLATFORM' | 'CUSTOMER';

  /**
   * For CUSTOMER mode: the endpoint URL to call
   * SDK will POST to this URL with { toolName, parameters }
   * and expect { success: boolean, result?: any, error?: string }
   */
  customerEndpoint?: string;

  /** Timeout in milliseconds (default: 20000) */
  timeoutMs?: number;

  /** Max retries on failure (default: 1) */
  maxRetries?: number;

  /** Provider-specific config for PLATFORM mode */
  providerConfig?: Record<string, any>;
}

// ==================== Session & Messages ====================

export interface SessionContext {
  sessionId: string;
  userId: string;
  currentUrl: string;
  currentPage: PageState | null;
}

export interface PageState {
  url: string;
  title: string;
  markdown: string;
  screenshot: string;
  actionableElements: ActionableElement[];
  timestamp: Date;
}

export interface ActionableElement {
  id: string;
  type: 'button' | 'input' | 'link' | 'select' | 'textarea';
  selector: string;
  text?: string;
  placeholder?: string;
  description: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | MessageContent[];
  timestamp?: Date;
}

export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

// ==================== Tools ====================

export interface ToolCall {
  name: string;
  parameters: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  result?: any;
  error?: string;
}

// ==================== Events ====================

export interface StreamEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
}

// ==================== Traces ====================

export interface LLMTrace {
  sessionId?: string;
  userId?: string;
  input: Message[];
  output: string;
  model: string;
  provider: string;
  status: 'SUCCESS' | 'ERROR' | 'TIMEOUT';
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  error?: string;
  createdAt: Date;
}

// ==================== Compacted Memory ====================

export interface CompactedMemory {
  summary: string;
  fromId: number;
  toId: number;
  messageCount: number;
}
