/**
 * Lens Client
 * Handles API communication with Lens OS SaaS
 */

import type { TenantConfig, LLMTrace, Message } from './types';

/** Default LensOS SaaS API URL */
const LENS_OS_API_URL = 'https://osapi.ask-lens.ai';

export interface LensClientConfig {
  apiKey: string;
  /**
   * Base URL for LensOS API.
   * Default: https://osapi.ask-lens.ai
   */
  baseUrl?: string;
}

export class LensClient {
  private apiKey: string;
  private baseUrl: string;
  private configCache: TenantConfig | null = null;
  private configVersion: string | null = null;

  constructor(config: LensClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? LENS_OS_API_URL;
  }

  // ==================== Config ====================

  /**
   * Get tenant configuration (prompts, skills, tools, version)
   */
  async getConfig(): Promise<TenantConfig> {
    if (this.configCache) {
      return this.configCache;
    }

    const response = await this.fetch('/v1/config');

    // Normalize tools to include execution config
    const rawTools = response.tools || response.tool_registry || [];
    const normalizedTools = rawTools.map((tool: any) => ({
      id: tool.id,
      name: tool.name,
      displayName: tool.display_name || tool.displayName,
      description: tool.description,
      type: tool.type || 'custom',
      schema: tool.args_schema || tool.schema,
      config: tool.config,
      // Include execution config if present (from ToolConfig table join)
      execution: tool.execution || tool.tool_config ? {
        isEnabled: tool.execution?.is_enabled ?? tool.tool_config?.is_enabled ?? true,
        executionMode: tool.execution?.execution_mode || tool.tool_config?.execution_mode || 'PLATFORM',
        customerEndpoint: tool.execution?.customer_endpoint || tool.tool_config?.customer_endpoint,
        timeoutMs: tool.execution?.timeout_ms || tool.tool_config?.timeout_ms || 20000,
        maxRetries: tool.execution?.max_retries || tool.tool_config?.max_retries || 1,
        providerConfig: tool.execution?.provider_config || tool.tool_config?.provider_config,
      } : undefined,
    }));

    // Normalize API response to TenantConfig format
    this.configCache = {
      systemPrompt: response.system_prompt || response.systemPrompt || undefined,
      prompts: response.prompts || [],
      skills: response.skills || [],
      tools: normalizedTools,
      version: response.version || response.config_version || '1.0.0',
    };

    this.configVersion = this.configCache.version;
    return this.configCache;
  }

  /**
   * Refresh config cache
   */
  async refreshConfig(): Promise<TenantConfig> {
    this.configCache = null;
    this.configVersion = null;
    return this.getConfig();
  }

  /**
   * Get current config version
   */
  getConfigVersion(): string | null {
    return this.configVersion;
  }

  // ==================== Session ====================

  /**
   * Create a new session
   */
  async createSession(sessionId: string, externalUserId?: string): Promise<any> {
    const payload = {
      id: sessionId,
      external_user_id: externalUserId,
      channel: 'web',
    };
    console.log('[LensClient] Creating session:', payload);
    return this.fetch('/tenant/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<any> {
    return this.fetch(`/tenant/sessions/${sessionId}`);
  }

  /**
   * List sessions for a user
   */
  async listSessions(externalUserId: string, options?: { limit?: number; offset?: number }): Promise<any[]> {
    const params = new URLSearchParams({ external_user_id: externalUserId });
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());
    const response = await this.fetch(`/tenant/sessions?${params.toString()}`);
    return Array.isArray(response) ? response : response?.sessions || [];
  }

  /**
   * Update session status
   */
  async updateSession(sessionId: string, data: { status?: string; metadata?: any }): Promise<any> {
    return this.fetch(`/tenant/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // ==================== Messages ====================

  /**
   * Save a message to the session
   */
  async saveMessage(
    sessionId: string,
    message: Message,
    options?: {
      externalUserId?: string;
      requestId?: string;
      toolCallId?: string;
      meta?: Record<string, any>;
    }
  ): Promise<void> {
    await this.fetch('/tenant/messages', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        role: message.role,
        content: typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content),
        external_user_id: options?.externalUserId,
        request_id: options?.requestId,
        tool_call_id: options?.toolCallId,
        meta: options?.meta,
      }),
    });
  }

  /**
   * Get session messages
   */
  async getMessages(sessionId: string, options?: { includeArchived?: boolean }): Promise<Message[]> {
    const params = new URLSearchParams({ session_id: sessionId });
    if (options?.includeArchived) {
      params.append('include_archived', 'true');
    }
    const response = await this.fetch(`/tenant/messages?${params.toString()}`);

    // Normalize response to Message[]
    if (Array.isArray(response)) {
      return response.map((m: any) => ({
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
        timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
      }));
    }
    return [];
  }

  /**
   * Archive old messages (for memory compaction)
   */
  async archiveMessages(sessionId: string, messageIds: number[]): Promise<void> {
    await this.fetch('/tenant/messages/archive', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        message_ids: messageIds,
      }),
    });
  }

  // ==================== LLM Traces ====================

  /**
   * Save LLM trace
   */
  async saveTrace(trace: Omit<LLMTrace, 'createdAt'>): Promise<void> {
    const payload = {
      id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      session_id: trace.sessionId,
      external_user_id: trace.userId,
      input: { messages: trace.input }, // API expects { messages: [...] }
      output: trace.output,
      model: trace.model,
      provider: trace.provider,
      status: trace.status,
      prompt_tokens: trace.promptTokens,
      completion_tokens: trace.completionTokens,
      total_tokens: trace.totalTokens,
      latency_ms: trace.latencyMs,
      error: trace.error,
    };

    await this.fetch('/tenant/llm-traces', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // ==================== Knowledge Search ====================

  /**
   * Search knowledge base
   */
  async searchKnowledge(query: string, topK: number = 5): Promise<any[]> {
    return this.fetch(`/tenant/knowledge/search?q=${encodeURIComponent(query)}&top_k=${topK}`);
  }

  // ==================== Product Search ====================

  /**
   * Search products (books)
   */
  async searchProducts(query: string, topK: number = 10): Promise<any> {
    return this.fetch('/tenant/products/search', {
      method: 'POST',
      body: JSON.stringify({ query, top_k: topK }),
    });
  }

  // ==================== AI Page Generate ====================

  /**
   * Generate AI page
   */
  async generateAIPage(params: {
    title: string;
    books: any[];
    template?: string;
    userQuery?: string;
  }): Promise<any> {
    return this.fetch('/tenant/ai-pages', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // ==================== Internal ====================

  /**
   * Internal fetch wrapper with auth
   */
  private async fetch(path: string, options?: RequestInit): Promise<any> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[LensClient] API Error ${response.status} for ${path}:`, errorText);
      throw new Error(`Lens API Error (${response.status}): ${errorText}`);
    }

    const text = await response.text();
    if (!text) return null;

    return JSON.parse(text);
  }
}
