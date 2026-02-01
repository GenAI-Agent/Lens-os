/**
 * Supervisor Agent
 * Main agent that orchestrates LLM calls, tool execution, and streaming responses
 */

import OpenAI from 'openai';
import { EventEmitter } from './utils/EventEmitter';
import { LensClient } from '../core/LensClient';
import type {
  LensSDKConfig,
  TenantConfig,
  SessionContext,
  StreamEvent,
  ToolCall,
  LLMTrace,
  Message,
  ToolExecutorConfig,
  ToolExecutorFunction,
} from '../core/types';
import { PromptBuilder } from './context-engineer/PromptBuilder';
import { MemoryManager } from './context-engineer/MemoryManager';
import { ToolParser } from './utils/ToolParser';
import { SkillParser } from './utils/SkillParser';
import { KnowledgeSearchTool } from './tools/KnowledgeSearch';
import { ProductSearchTool } from './tools/ProductSearch';
import { AIPageGenerateTool } from './tools/AIPageGenerate';
import { WebUseTool } from './tools/WebUse';

export class SupervisorAgent extends EventEmitter {
  private client: LensClient;
  private openai: OpenAI;
  private config: LensSDKConfig;
  private tenantConfig: TenantConfig | null = null;

  private memoryManager: MemoryManager;
  private promptBuilder: PromptBuilder;
  private skillParser: SkillParser;
  private knowledgeSearchTool: KnowledgeSearchTool;
  private productSearchTool: ProductSearchTool;
  private aiPageGenerateTool: AIPageGenerateTool;
  private webUseTool: WebUseTool;

  private abortController: AbortController | null = null;
  private initialized = false;
  private createdSessions = new Set<string>();

  constructor(config: LensSDKConfig) {
    super();

    this.config = config;
    this.client = new LensClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });

    this.openai = new OpenAI({
      apiKey: config.openaiKey,
      dangerouslyAllowBrowser: true,
    });

    // Initialize components with LensClient
    this.memoryManager = new MemoryManager(this.client, config.openaiKey);
    this.promptBuilder = new PromptBuilder(this.memoryManager);
    this.skillParser = new SkillParser();
    this.knowledgeSearchTool = new KnowledgeSearchTool(this.client);
    this.productSearchTool = new ProductSearchTool(this.client);
    this.aiPageGenerateTool = new AIPageGenerateTool(this.client);
    this.webUseTool = new WebUseTool(config.onWidgetAction || (async () => ({ success: true })));
  }

  /**
   * Initialize agent by loading config from API
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    console.log('[SupervisorAgent] Initializing...');

    this.tenantConfig = await this.client.getConfig();

    this.promptBuilder.setSystemPrompt(this.tenantConfig.systemPrompt);
    this.promptBuilder.setPrompts(this.tenantConfig.prompts);
    this.skillParser.setSkills(this.tenantConfig.skills);

    // Set tool config for dynamic prompt generation
    // Priority: 1. Manual toolExecutors  2. DB-configured tools
    const manualExecutors = this.extractManualExecutorInfo();
    this.promptBuilder.setToolConfig({
      manualExecutors,
      tools: this.tenantConfig.tools,
    });

    this.initialized = true;
    console.log('[SupervisorAgent] Initialized with config:', {
      hasSystemPrompt: !!this.tenantConfig.systemPrompt,
      prompts: this.tenantConfig.prompts.length,
      skills: this.tenantConfig.skills.length,
      tools: this.tenantConfig.tools.length,
      manualToolExecutors: manualExecutors.map(e => e.name),
      version: this.tenantConfig.version,
    });
  }

  /**
   * Execute agent for a user query
   * Handles multi-turn LLM calls, tool execution, and streaming
   */
  async execute(context: SessionContext, userQuery: string): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }

    // Ensure session exists before saving traces
    await this.ensureSession(context.sessionId, context.userId);

    this.abortController = new AbortController();
    const model = this.config.model || 'gpt-5.2';
    const maxTurns = this.config.maxTurns || 10;

    try {
      // Parse skill if present (/skill_name query)
      const skillResult = this.skillParser.parseSkill(userQuery);
      console.log('[SupervisorAgent] Skill parsing result:', skillResult ? 'Found skill' : 'No skill');

      if (skillResult) {
        console.log('[SupervisorAgent] Skill prompt:', skillResult.skillPrompt.substring(0, 50) + '...');
        console.log('[SupervisorAgent] Modified query:', skillResult.modifiedQuery);
        // Set active skill for prompt builder
        this.promptBuilder.setActiveSkill(skillResult.skill);
      } else {
        this.promptBuilder.setActiveSkill(null);
      }

      const finalQuery = skillResult ? skillResult.modifiedQuery : userQuery;

      // Save user message to memory (syncs to API)
      await this.memoryManager.saveMessage(context.sessionId, 'user', finalQuery);

      // Multi-turn loop
      let turnCount = 0;

      while (turnCount < maxTurns) {
        if (this.abortController.signal.aborted) {
          this.emit('event', {
            type: 'error',
            error: 'Execution aborted by user',
          } as StreamEvent);
          break;
        }

        turnCount++;

        // Build prompt with all context
        const messages = await this.promptBuilder.buildPrompt(context);

        // Debug: Log what we're sending to LLM
        console.log('[SupervisorAgent] Messages to LLM:', messages.map((m) => ({
          role: m.role,
          contentLength: typeof m.content === 'string' ? m.content.length : 'multimodal',
          contentPreview: typeof m.content === 'string' ? m.content.substring(0, 100) + '...' : 'multimodal',
        })));

        // Call LLM with streaming
        const { response, toolCalls } = await this.streamLLM(messages, context, model);

        // Save assistant response to memory
        await this.memoryManager.saveMessage(context.sessionId, 'assistant', response);

        console.log('[SupervisorAgent] Turn', turnCount, '- toolCalls:', toolCalls.length);

        // Handle tool execution (tool calls have priority)
        if (toolCalls.length > 0) {
          // Deduplicate tool calls (LLM sometimes outputs identical tool blocks)
          const uniqueToolCalls = this.deduplicateToolCalls(toolCalls);
          if (uniqueToolCalls.length !== toolCalls.length) {
            console.log(`[SupervisorAgent] Deduplicated tool calls: ${toolCalls.length} -> ${uniqueToolCalls.length}`);
          }

          console.log('[SupervisorAgent] Executing', uniqueToolCalls.length, 'tool(s)');

          // Execute ALL tools (use Promise.all for parallel execution)
          const results = await Promise.all(
            uniqueToolCalls.map((tc) => this.executeTool(tc))
          );

          // Save all results to memory and emit events
          for (let i = 0; i < uniqueToolCalls.length; i++) {
            // Format tool result as a system message for LLM to understand
            const resultText = `[Tool Result for ${uniqueToolCalls[i].name}]\n${JSON.stringify(results[i], null, 2)}`;
            await this.memoryManager.saveMessage(context.sessionId, 'system', resultText);

            this.emit('event', {
              type: 'tool_result',
              toolCall: uniqueToolCalls[i],
              toolResult: results[i],
            } as StreamEvent);
          }

          // Continue to next LLM turn with all results
          continue;
        }

        // No tool calls = response is complete
        console.log('[SupervisorAgent] Response complete (no tool calls), ending execution');
        this.emit('event', { type: 'done' } as StreamEvent);
        break;
      }

      if (turnCount >= maxTurns) {
        this.emit('event', {
          type: 'error',
          error: 'Max turns reached',
        } as StreamEvent);
      }
    } catch (error) {
      console.error('[SupervisorAgent] Execution error:', error);
      this.emit('event', {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as StreamEvent);
    } finally {
      this.abortController = null;
      // Clear active skill after execution
      this.promptBuilder.setActiveSkill(null);
    }
  }

  /**
   * Stream LLM response and parse for tool calls
   */
  private async streamLLM(
    messages: any[],
    context: SessionContext,
    model: string
  ): Promise<{ response: string; toolCalls: ToolCall[] }> {
    console.log('[SupervisorAgent] streamLLM started, creating ToolParser...');
    const toolParser = new ToolParser();
    const chunks: string[] = [];
    const toolCalls: ToolCall[] = [];
    const startTime = Date.now();
    let hasToolCalls = false; // Stop emitting text once tool is detected

    const stream = await this.openai.chat.completions.create(
      {
        model,
        messages: messages as any,
        stream: true,
      },
      { signal: this.abortController?.signal }
    );

    for await (const chunk of stream) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      const content = chunk.choices[0]?.delta?.content || '';

      if (content) {
        chunks.push(content);

        // DEBUG: Log raw chunk
        // console.log('[SupervisorAgent] 📥 RAW CHUNK:', JSON.stringify(content));

        // Parse for tool calls and text
        const { text, toolCalls: parsedCalls } = toolParser.addChunk(content);

        // DEBUG: Log parser output
        // console.log('[SupervisorAgent] 🔍 PARSER OUTPUT:', { text: text ? text.substring(0, 50) + '...' : null, toolCalls: parsedCalls, hasToolCalls });

        // Only emit text if we haven't detected any tool calls yet
        // Once a tool is detected, we stop showing text (LLM should have stopped, but sometimes it doesn't)
        if (text && !hasToolCalls) {
          this.emit('event', {
            type: 'text',
            content: text,
          } as StreamEvent);
        }

        // Handle tool calls (can be one or multiple)
        if (parsedCalls && parsedCalls.length > 0) {
          hasToolCalls = true; // Mark that we found tool calls - stop emitting text
          console.log('[SupervisorAgent] 🔨 Tool calls detected:', parsedCalls.map(c => c.name));

          for (const call of parsedCalls) {
            toolCalls.push(call);
            this.emit('event', {
              type: 'tool_call',
              toolCall: call,
            } as StreamEvent);
          }
        }
      }
    }

    // Flush any remaining content for UI display
    // Note: Don't push to chunks[] because raw content was already pushed there
    const remaining = toolParser.flush();
    console.log('[SupervisorAgent] 🔚 FLUSH remaining:', JSON.stringify(remaining), 'hasToolCalls:', hasToolCalls);
    if (remaining && !hasToolCalls) {
      // Only emit for UI if no tool calls - chunks already contains all raw content
      this.emit('event', {
        type: 'text',
        content: remaining,
      } as StreamEvent);
    }

    const fullResponse = chunks.join('');
    const latencyMs = Date.now() - startTime;

    // DEBUG: Log full raw response
    console.log('[SupervisorAgent] 📄 FULL RAW RESPONSE:', fullResponse);
    console.log('[SupervisorAgent] 📊 Total tool calls found:', toolCalls.length);

    // Save LLMTrace to API
    const trace: LLMTrace = {
      sessionId: context.sessionId,
      userId: context.userId,
      input: messages as Message[],
      output: fullResponse,
      model,
      provider: 'openai',
      status: 'SUCCESS',
      latencyMs,
      createdAt: new Date(),
    };

    if (this.config.onTrace) {
      this.config.onTrace(trace);
    } else {
      try {
        await this.client.saveTrace(trace);
        console.log('[SupervisorAgent] LLM trace saved');
      } catch (error) {
        console.error('[SupervisorAgent] Failed to save trace:', error);
      }
    }

    return { response: fullResponse, toolCalls };
  }

  /**
   * Extract manual executor info with metadata for prompt building
   */
  private extractManualExecutorInfo(): Array<{
    name: string;
    description?: string;
    whenToUse?: string;
    schema?: Record<string, { type: string; required?: boolean; default?: any; description?: string }>;
    output?: string;
  }> {
    if (!this.config.toolExecutors) return [];

    return Object.entries(this.config.toolExecutors).map(([name, executor]) => {
      // Check if it's a config object or just a function
      if (typeof executor === 'function') {
        return { name };
      }
      // It's a ToolExecutorConfig
      return {
        name,
        description: executor.description,
        whenToUse: executor.whenToUse,
        schema: executor.schema,
        output: executor.output,
      };
    });
  }

  /**
   * Get the executor function from toolExecutors (handles both function and config)
   */
  private getExecutorFunction(name: string): ToolExecutorFunction | null {
    const executor = this.config.toolExecutors?.[name];
    if (!executor) return null;
    if (typeof executor === 'function') return executor;
    return executor.execute;
  }

  /**
   * Execute a single tool
   * Priority: 1. Manual toolExecutors  2. DB-configured CUSTOMER mode  3. Built-in PLATFORM mode
   */
  private async executeTool(toolCall: ToolCall): Promise<any> {
    const { name, parameters } = toolCall;

    console.log('[SupervisorAgent] Executing tool:', name, 'with params:', parameters);

    // Priority 1: Check for manual tool executor (code-defined, highest priority)
    const executorFn = this.getExecutorFunction(name);
    if (executorFn) {
      console.log('[SupervisorAgent] Using manual executor for:', name);
      try {
        return await executorFn(parameters);
      } catch (error) {
        console.error('[SupervisorAgent] Manual executor error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Manual tool executor failed',
        };
      }
    }

    // Priority 2: Check for database-configured CUSTOMER mode tool
    const toolConfig = this.tenantConfig?.tools.find((t) => t.name === name);
    if (toolConfig?.execution?.executionMode === 'CUSTOMER' && toolConfig.execution.customerEndpoint) {
      console.log('[SupervisorAgent] Using CUSTOMER mode for:', name, '→', toolConfig.execution.customerEndpoint);
      return this.executeCustomerTool(name, parameters, toolConfig.execution);
    }

    // Priority 3: Built-in PLATFORM mode implementations
    switch (name) {
      case 'knowledge_search':
        return this.knowledgeSearchTool.execute(parameters as { query: string; topK?: number });

      case 'product_search':
        return this.productSearchTool.execute(parameters as { query: string; topK?: number; generatePage?: boolean });

      case 'ai_page_generate':
        return this.aiPageGenerateTool.execute(parameters as any);

      // Web interaction tools
      case 'click':
      case 'doubleClick':
      case 'scroll':
      case 'scrollToElement':
      case 'highlight':
      case 'drag':
      case 'deepCrawl':
      case 'navigate':
        const webResult = await this.webUseTool.execute({ action: name, ...parameters } as any);
        console.log('[SupervisorAgent] Web use tool result:', webResult);
        return webResult;

      default:
        // Check if it's a registered custom tool
        const registeredTool = this.tenantConfig?.tools.find((t) => t.name === name);
        if (registeredTool && this.config.onWidgetAction) {
          return this.config.onWidgetAction(name, parameters);
        }
        return {
          success: false,
          error: `Unknown tool: ${name}. Available tools: knowledge_search, product_search, ai_page_generate, click, doubleClick, scroll, scrollToElement, highlight, drag, deepCrawl, navigate`,
        };
    }
  }

  /**
   * Execute a CUSTOMER mode tool by calling the configured endpoint
   * POST to customerEndpoint with { toolName, parameters }
   * Expects { success: boolean, result?: any, error?: string }
   */
  private async executeCustomerTool(
    toolName: string,
    parameters: Record<string, any>,
    execution: NonNullable<import('../core/types').ToolRegistryItem['execution']>
  ): Promise<any> {
    const { customerEndpoint, timeoutMs = 20000, maxRetries = 1 } = execution;

    if (!customerEndpoint) {
      return { success: false, error: 'No customerEndpoint configured for CUSTOMER mode tool' };
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(customerEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            toolName,
            parameters,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        console.log('[SupervisorAgent] CUSTOMER tool result:', toolName, result.success ? 'success' : 'failed');
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[SupervisorAgent] CUSTOMER tool error (attempt ${attempt + 1}/${maxRetries + 1}):`, lastError.message);

        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    return {
      success: false,
      error: `CUSTOMER tool failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`,
    };
  }

  /**
   * Deduplicate tool calls by comparing name and parameters
   * LLM sometimes outputs identical tool blocks, we only want to execute each unique call once
   */
  private deduplicateToolCalls(toolCalls: ToolCall[]): ToolCall[] {
    const seen = new Set<string>();
    const unique: ToolCall[] = [];

    for (const tc of toolCalls) {
      const key = JSON.stringify({ name: tc.name, parameters: tc.parameters });
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(tc);
      }
    }

    return unique;
  }

  /**
   * Abort current execution
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Check if agent is currently executing
   */
  isExecuting(): boolean {
    return this.abortController !== null;
  }

  /**
   * Get tenant config
   */
  getTenantConfig(): TenantConfig | null {
    return this.tenantConfig;
  }

  /**
   * Get memory manager
   */
  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  /**
   * Get LensClient for direct API access
   */
  getClient(): LensClient {
    return this.client;
  }

  /**
   * Ensure session exists before saving traces
   */
  private async ensureSession(sessionId: string, userId?: string): Promise<void> {
    if (this.createdSessions.has(sessionId)) {
      return;
    }

    try {
      await this.client.createSession(sessionId, userId);
      this.createdSessions.add(sessionId);
      console.log('[SupervisorAgent] Session created:', sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('[SupervisorAgent] Session create error:', errorMessage);

      // Only mark as created if it's a "already exists" error (409 or similar)
      if (errorMessage.includes('409') || errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
        console.log('[SupervisorAgent] Session already exists, continuing...');
        this.createdSessions.add(sessionId);
      } else {
        // For other errors, log but still proceed (session might exist in DB)
        // Try to get the session to verify
        try {
          await this.client.getSession(sessionId);
          console.log('[SupervisorAgent] Session exists (verified via GET)');
          this.createdSessions.add(sessionId);
        } catch (getError) {
          console.error('[SupervisorAgent] Session does not exist and cannot be created:', errorMessage);
          // Don't add to createdSessions - let it fail on trace save with better error
        }
      }
    }
  }
}
