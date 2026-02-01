/**
 * Prompt Builder
 * Assembles complete prompt with all context for LLM
 */

import type { SitePrompt, SessionContext, Message, PageState, Skill, ToolRegistryItem } from '../../core/types';
import { MemoryManager } from './MemoryManager';
import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_AVAILABLE_TOOLS,
} from './SystemPrompt';

/**
 * Manual executor info with optional metadata
 */
interface ManualExecutorInfo {
  name: string;
  description?: string;
  whenToUse?: string;
  schema?: Record<string, {
    type: string;
    required?: boolean;
    default?: any;
    description?: string;
  }>;
  output?: string;
}

/**
 * Tool configuration for prompt building
 */
interface ToolPromptConfig {
  /** Manual tool executors with metadata (highest priority) */
  manualExecutors?: ManualExecutorInfo[];
  /** Tools from TenantConfig */
  tools?: ToolRegistryItem[];
}

export class PromptBuilder {
  private systemPrompt: string = SYSTEM_PROMPT; // Default fallback
  private systemPromptTemplate: string | null = null; // Custom template from config
  private prompts: SitePrompt[] = [];
  private memoryManager: MemoryManager;
  private activeSkill: Skill | null = null;
  private toolConfig: ToolPromptConfig = {};

  constructor(memoryManager: MemoryManager) {
    this.memoryManager = memoryManager;
  }

  setSystemPrompt(prompt: string | undefined): void {
    if (prompt) {
      // Check if prompt contains placeholders - if so, it's a template
      if (prompt.includes('{{AVAILABLE_TOOLS}}') || prompt.includes('{{WHEN_TO_USE_TOOLS}}')) {
        this.systemPromptTemplate = prompt;
        console.log('[PromptBuilder] Using custom system prompt template from config');
      } else {
        this.systemPrompt = prompt;
        this.systemPromptTemplate = null;
        console.log('[PromptBuilder] Using custom system prompt from config');
      }
    }
  }

  setPrompts(prompts: SitePrompt[]): void {
    this.prompts = prompts;
  }

  setActiveSkill(skill: Skill | null): void {
    this.activeSkill = skill;
  }

  /**
   * Set tool configuration for dynamic prompt generation
   */
  setToolConfig(config: ToolPromptConfig): void {
    this.toolConfig = config;
    console.log('[PromptBuilder] Tool config set:', {
      manualExecutors: config.manualExecutors?.length || 0,
      tools: config.tools?.length || 0,
    });
  }

  /**
   * Build the final system prompt with dynamic tools
   */
  private buildSystemPromptWithTools(): string {
    const template = this.systemPromptTemplate || SYSTEM_PROMPT_TEMPLATE;

    // If no placeholders, return as-is
    if (!template.includes('{{AVAILABLE_TOOLS}}')) {
      return this.systemPrompt;
    }

    // Build unified tools section
    const availableTools = this.buildAvailableToolsSection();

    return template
      .replace('{{AVAILABLE_TOOLS}}', availableTools)
      .replace('{{WHEN_TO_USE_TOOLS}}', ''); // Remove separate section, now integrated
  }

  /**
   * Build the "# Available Tools" section with unified format
   * Each tool includes: description, when to use, parameters, output
   */
  private buildAvailableToolsSection(): string {
    const { manualExecutors = [], tools = [] } = this.toolConfig;

    // If no tools configured, use defaults
    if (manualExecutors.length === 0 && tools.length === 0) {
      return DEFAULT_AVAILABLE_TOOLS;
    }

    const lines: string[] = ['# Available Tools'];
    const addedTools = new Set<string>();

    // 1. Manual tool executors (highest priority)
    for (const executor of manualExecutors) {
      if (!addedTools.has(executor.name)) {
        const dbToolInfo = tools.find(t => t.name === executor.name);
        lines.push(this.formatToolEntry(
          executor.name,
          executor.description || dbToolInfo?.description,
          executor.whenToUse || this.getDefaultWhenToUse(executor.name),
          executor.schema || dbToolInfo?.schema,
          executor.output
        ));
        addedTools.add(executor.name);
      }
    }

    // 2. DB-configured tools (CUSTOMER mode and PLATFORM mode)
    for (const tool of tools) {
      if (addedTools.has(tool.name)) continue;

      const execution = tool.execution;
      if (execution && !execution.isEnabled) continue; // Skip disabled tools

      lines.push(this.formatToolEntry(
        tool.name,
        tool.description || `${tool.displayName || tool.name} tool.`,
        this.getDefaultWhenToUse(tool.name),
        tool.schema,
        undefined
      ));
      addedTools.add(tool.name);
    }

    return lines.join('\n');
  }

  /**
   * Format a single tool entry with unified format
   */
  private formatToolEntry(
    name: string,
    description?: string,
    whenToUse?: string,
    schema?: Record<string, any>,
    output?: string
  ): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(`## ${name}`);
    lines.push(description || 'Tool executor.');

    // When to Use section
    if (whenToUse) {
      lines.push('When to Use:');
      // Split by newline or comma to support multiple conditions
      const conditions = whenToUse.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      for (const condition of conditions) {
        lines.push(`- ${condition}`);
      }
    }

    // Parameters section
    if (schema) {
      lines.push('Parameters:');
      lines.push(this.formatToolSchema(schema));
    }

    // Output section
    if (output) {
      lines.push('Output:');
      lines.push(`- ${output}`);
    }

    return lines.join('\n');
  }

  /**
   * Get default "When to Use" hint based on tool name
   */
  private getDefaultWhenToUse(toolName: string): string {
    switch (toolName) {
      case 'knowledge_search':
        return 'User asks about customer service questions (回饋金/運費/退貨/付款/會員/如何購買)\nWhenever the user is asking about customer service-related questions';
      case 'product_search':
        return 'User wants to find books, search products, or asks about specific titles/authors';
      case 'ai_page_generate':
        return 'User requests to generate recommendation pages, create book lists, or build themed pages';
      case 'navigate':
        return 'User wants to navigate to a specific URL or page';
      case 'user_orders':
        return 'User asks about order status, purchase history, or wants to cancel an order';
      default:
        return '';
    }
  }

  /**
   * Format tool schema for prompt
   */
  private formatToolSchema(schema: Record<string, any>): string {
    const lines: string[] = [];

    // Handle JSON Schema format
    const properties = schema.properties || schema;
    const required = schema.required || [];

    for (const [key, value] of Object.entries(properties)) {
      const prop = value as any;
      const isRequired = required.includes(key);
      const type = prop.type || 'any';
      const desc = prop.description || '';
      const defaultVal = prop.default !== undefined ? `, default: ${prop.default}` : '';

      lines.push(`- ${key} (${type}, ${isRequired ? 'required' : 'optional'}${defaultVal})${desc ? ': ' + desc : ''}`);
    }

    return lines.join('\n');
  }

  /**
   * Build complete prompt for LLM
   *
   * Order:
   * 1. System prompt (tool usage format and behavior)
   * 2. Current page state (text + screenshot) - Fixed Input
   * 3. Site-wide prompts
   * 4. Skill prompt (if active)
   * 5. Session messages (including compacted summaries)
   */
  async buildPrompt(context: SessionContext): Promise<Message[]> {
    const messages: Message[] = [];

    // 1. System Prompt with dynamic tools (from config or default)
    const systemPromptWithTools = this.buildSystemPromptWithTools();
    console.log('[PromptBuilder] System prompt with tools:', systemPromptWithTools);
    
    messages.push({
      role: 'system',
      content: systemPromptWithTools,
    });

    // 2. Current Page State (Fixed Input - never stored in DB)
    if (context.currentPage) {
      console.log('[PromptBuilder] Current page state:', {
        url: context.currentPage.url,
        title: context.currentPage.title,
        hasScreenshot: !!context.currentPage.screenshot,
        markdownLength: context.currentPage.markdown?.length || 0,
        actionableElements: context.currentPage.actionableElements?.length || 0,
      });

      const pageContent = this.buildPageStateContent(context.currentPage);
      messages.push({
        role: 'system',
        content: pageContent,
      });
    } else {
      console.log('[PromptBuilder] No current page state provided');
    }

    // 3. Site-wide Prompts
    const sitePrompt = this.buildSitePrompts();
    if (sitePrompt) {
      console.log('[PromptBuilder] Site prompts loaded');
      messages.push({
        role: 'system',
        content: `[Site Information]\n${sitePrompt}`,
      });
    }

    // 4. Skill Prompt (if active)
    if (this.activeSkill) {
      console.log('[PromptBuilder] Active skill:', this.activeSkill.name);
      messages.push({
        role: 'system',
        content: `[Active Skill: ${this.activeSkill.displayName || this.activeSkill.name}]\n${this.activeSkill.prompt}`,
      });
    }

    // 5. Compacted memories
    const compacted = this.memoryManager.getCompactedMemories(context.sessionId);
    if (compacted.length > 0) {
      const memorySummary = compacted.map((c) => c.summary).join('\n');
      messages.push({
        role: 'system',
        content: `[Memory Summary]\n${memorySummary}`,
      });
    }

    // 6. Session Messages (from cache, includes conversation history)
    const sessionMessages = this.memoryManager.getMessages(context.sessionId);
    messages.push(...sessionMessages);

    return messages;
  }

  /**
   * Build site-wide prompts from config
   */
  private buildSitePrompts(): string | null {
    const globalPrompts = this.prompts.filter((p) => p.isGlobal && p.isActive);
    if (globalPrompts.length === 0) {
      return null;
    }
    return globalPrompts.map((p) => p.prompt).join('\n\n');
  }

  /**
   * Build page state content (multimodal: text + image)
   */
  private buildPageStateContent(page: PageState): Message['content'] {
    const textContent = this.buildPageStateText(page);

    // Return multimodal content if screenshot available
    if (page.screenshot) {
      return [
        {
          type: 'text',
          text: textContent,
        },
        {
          type: 'image_url',
          image_url: {
            url: page.screenshot, // base64 data URL
          },
        },
      ];
    }

    // Text only if no screenshot
    return textContent;
  }

  /**
   * Build page state text description
   */
  private buildPageStateText(page: PageState): string {
    const lines: string[] = [];

    lines.push('[Current Page State]');
    lines.push(`URL: ${page.url}`);
    lines.push(`Title: ${page.title}`);
    lines.push('');

    if (page.markdown) {
      lines.push('Page Content (Markdown):');
      // Limit markdown length to avoid token overflow
      lines.push(page.markdown.slice(0, 4000));
      lines.push('');
    }

    if (page.actionableElements && page.actionableElements.length > 0) {
      lines.push('Actionable Elements:');
      for (const el of page.actionableElements) {
        lines.push(`- ${el.description} (selector: ${el.selector})`);
      }
    }

    return lines.join('\n');
  }
}
