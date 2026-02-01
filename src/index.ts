/**
 * Lens OS SDK - Main exports
 */

// Core
export { LensClient } from './core/LensClient';
export type {
  LensSDKConfig,
  TenantConfig,
  SitePrompt,
  Skill,
  ToolRegistryItem,
  SessionContext,
  PageState,
  ActionableElement,
  Message,
  MessageContent,
  ToolCall,
  ToolResult,
  StreamEvent,
  LLMTrace,
  CompactedMemory,
  ToolExecutorFunction,
  ToolExecutorConfig,
} from './core/types';

// Agent
export { SupervisorAgent } from './agent/SupervisorAgent';
export { MemoryManager } from './agent/context-engineer/MemoryManager';
export { PromptBuilder } from './agent/context-engineer/PromptBuilder';
export { SkillParser } from './agent/utils/SkillParser';
export { ToolParser } from './agent/utils/ToolParser';
export { KnowledgeSearchTool } from './agent/tools/KnowledgeSearch';
export { WebUseTool } from './agent/tools/WebUse';

// Convenience alias
export { SupervisorAgent as LensAgent } from './agent/SupervisorAgent';
