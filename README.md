# @lens-os/sdk

AI Agent SDK for building conversational AI experiences in frontend applications.

[![npm version](https://badge.fury.io/js/@lens-os/sdk.svg)](https://www.npmjs.com/package/@lens-os/sdk)

## Features

- **Multi-turn Agent Loop** - Autonomous LLM orchestration with tool execution
- **Streaming Responses** - Real-time text and tool call events
- **React Hooks** - `useLensAgent` and `useChat` for easy integration
- **Tool System** - 3-tier priority: Manual → Customer → Platform
- **Session Management** - Conversation history with memory compaction
- **TypeScript** - Full type definitions included

## Installation

```bash
npm install @lens-os/sdk
# or
bun add @lens-os/sdk
```

## Quick Start

### React Hook

```tsx
import { useLensAgent } from '@lens-os/sdk/react';

function ChatComponent() {
  const {
    messages,
    isLoading,
    sendMessage,
  } = useLensAgent({
    apiKey: process.env.NEXT_PUBLIC_LENS_API_KEY!,
    openaiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
  });

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i} className={msg.role}>
          {msg.content}
        </div>
      ))}
      <input
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            sendMessage(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
        placeholder="Type a message..."
      />
    </div>
  );
}
```

### Direct Agent Usage

```typescript
import { SupervisorAgent } from '@lens-os/sdk';

const agent = new SupervisorAgent({
  apiKey: 'your-lens-api-key',
  openaiKey: 'your-openai-key',
  model: 'gpt-4o',
});

// Listen to events
agent.on('event', (event) => {
  switch (event.type) {
    case 'text':
      console.log('Text:', event.content);
      break;
    case 'tool_call':
      console.log('Tool:', event.toolCall?.name);
      break;
    case 'done':
      console.log('Complete');
      break;
  }
});

// Execute
await agent.execute(
  { sessionId: 'session-1', userId: 'user-1', currentUrl: '/' },
  'Hello, find me some books about TypeScript'
);
```

## Configuration

```typescript
interface LensSDKConfig {
  // Required
  apiKey: string;              // Lens OS API key
  openaiKey: string;           // OpenAI API key

  // Optional
  baseUrl?: string;            // Default: https://osapi.ask-lens.ai
  model?: string;              // Default: gpt-4o
  maxTurns?: number;           // Default: 10
  language?: 'zh-TW' | 'en-US';

  // Callbacks
  onTrace?: (trace: LLMTrace) => void;
  onWidgetAction?: (action: string, params: any) => Promise<any>;

  // Custom tool executors
  toolExecutors?: Record<string, ToolExecutorFunction | ToolExecutorConfig>;
}
```

## Custom Tool Executors

Override default tools or add custom ones:

```typescript
useLensAgent({
  apiKey: '...',
  openaiKey: '...',
  toolExecutors: {
    // Simple function
    my_tool: async (params) => {
      return { success: true, result: 'Hello!' };
    },

    // Full config with metadata
    product_search: {
      description: 'Search for products in the database',
      whenToUse: 'User wants to find products or books',
      schema: {
        query: { type: 'string', required: true },
        topK: { type: 'number', default: 10 },
      },
      execute: async (params) => {
        const res = await fetch('/api/products/search', {
          method: 'POST',
          body: JSON.stringify(params),
        });
        return res.json();
      },
    },
  },
});
```

## Tool Execution Priority

1. **Manual toolExecutors** - Code-defined (highest priority)
2. **CUSTOMER mode** - Database-configured external endpoints
3. **PLATFORM mode** - Built-in SDK implementations

## Exports

### Main (`@lens-os/sdk`)

```typescript
// Core
export { LensClient } from './core/LensClient';
export { SupervisorAgent, LensAgent } from './agent/SupervisorAgent';

// Types
export type {
  LensSDKConfig,
  TenantConfig,
  Message,
  StreamEvent,
  ToolCall,
  ToolResult,
  // ... and more
};
```

### React (`@lens-os/sdk/react`)

```typescript
export { useLensAgent } from './useLensAgent';
export { useChat } from './useChat';
```

## useLensAgent Hook API

```typescript
const {
  // State
  messages,           // Message[] - conversation history
  isLoading,          // boolean - execution in progress
  isInitialized,      // boolean - SDK ready
  sessionId,          // string - current session ID
  config,             // TenantConfig | null
  error,              // Error | null

  // Actions
  sendMessage,        // (message: string, context?: PageContext) => Promise<void>
  abort,              // () => void - cancel execution
  clearMessages,      // () => void
  newSession,         // () => void
  listSessions,       // () => Promise<SessionInfo[]>
  loadSession,        // (sessionId: string) => Promise<void>
} = useLensAgent(config);
```

## Stream Events

```typescript
interface StreamEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done';
  content?: string;        // For 'text' events
  toolCall?: ToolCall;     // For 'tool_call' events
  toolResult?: ToolResult; // For 'tool_result' events
  error?: string;          // For 'error' events
}
```

## Requirements

- Node.js >= 18
- React >= 18 (for React hooks)
- OpenAI API key

## License

MIT
