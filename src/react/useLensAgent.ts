/**
 * useLensAgent - React hook for LensAgent
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { SupervisorAgent } from '../agent/SupervisorAgent';
import type {
  LensSDKConfig,
  TenantConfig,
  Message,
  StreamEvent,
  SessionContext,
} from '../core/types';

interface UseLensAgentOptions extends LensSDKConfig {
  autoInit?: boolean;
  userId?: string;
  onEvent?: (event: StreamEvent) => void;
}

interface SessionInfo {
  id: string;
  created_at: string;
  updated_at?: string;
  status?: string;
  metadata?: any;
}

interface UseLensAgentReturn {
  messages: Message[];
  isLoading: boolean;
  isInitialized: boolean;
  sessionId: string;
  config: TenantConfig | null;
  error: Error | null;
  init: () => Promise<void>;
  sendMessage: (message: string, context?: Partial<SessionContext>) => Promise<void>;
  abort: () => void;
  clearMessages: () => void;
  newSession: () => void;
  listSessions: () => Promise<SessionInfo[]>;
  loadSession: (sessionId: string) => Promise<void>;
}

export function useLensAgent(options: UseLensAgentOptions): UseLensAgentReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [sessionId, setSessionId] = useState(() => generateSessionId());
  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const agentRef = useRef<SupervisorAgent | null>(null);
  const userId = options.userId || 'default-user';

  // Initialize agent
  const init = useCallback(async () => {
    if (agentRef.current && isInitialized) return;

    try {
      setError(null);
      const agent = new SupervisorAgent(options);

      agent.on('event', (event: StreamEvent) => {
        // Call user's onEvent callback if provided
        if (options.onEvent) {
          options.onEvent(event);
        }

        if (event.type === 'text' && event.content) {
          const content = event.content;
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && typeof last.content === 'string') {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + content },
              ];
            }
            return [...prev, { role: 'assistant' as const, content }];
          });
        } else if (event.type === 'done') {
          setIsLoading(false);
        } else if (event.type === 'error') {
          setError(new Error(event.error || 'Unknown error'));
          setIsLoading(false);
        }
      });

      await agent.init();
      agentRef.current = agent;
      setConfig(agent.getTenantConfig());
      setIsInitialized(true);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Initialization failed'));
      setIsInitialized(false);
    }
  }, [options, isInitialized]);

  // Auto init
  useEffect(() => {
    if (options.autoInit !== false) {
      init();
    }

    return () => {
      if (agentRef.current) {
        agentRef.current.abort();
        agentRef.current.removeAllListeners();
      }
    };
  }, []);

  // Send message
  const sendMessage = useCallback(async (
    message: string,
    contextOverrides?: Partial<SessionContext>
  ) => {
    if (!agentRef.current || !isInitialized) {
      await init();
    }

    if (!agentRef.current) {
      setError(new Error('Agent not initialized'));
      return;
    }

    setIsLoading(true);
    setError(null);

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: message }]);

    const context: SessionContext = {
      sessionId,
      userId,
      currentUrl: typeof window !== 'undefined' ? window.location.href : '',
      currentPage: null,
      ...contextOverrides,
    };

    try {
      await agentRef.current.execute(context, message);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Execution failed'));
      setIsLoading(false);
    }
  }, [sessionId, userId, isInitialized, init]);

  // Abort
  const abort = useCallback(() => {
    if (agentRef.current) {
      agentRef.current.abort();
    }
    setIsLoading(false);
  }, []);

  // Clear messages
  const clearMessages = useCallback(() => {
    setMessages([]);
    if (agentRef.current) {
      agentRef.current.getMemoryManager().clearMessages(sessionId);
    }
  }, [sessionId]);

  // New session
  const newSession = useCallback(() => {
    setMessages([]);
    setSessionId(generateSessionId());
  }, []);

  // List sessions for user
  const listSessions = useCallback(async (): Promise<SessionInfo[]> => {
    if (!agentRef.current) {
      return [];
    }
    try {
      const sessions = await agentRef.current.getClient().listSessions(userId);
      return sessions;
    } catch (err) {
      console.error('[useLensAgent] Failed to list sessions:', err);
      return [];
    }
  }, [userId]);

  // Load a specific session
  const loadSession = useCallback(async (targetSessionId: string): Promise<void> => {
    if (!agentRef.current) {
      return;
    }
    try {
      const sessionMessages = await agentRef.current.getClient().getMessages(targetSessionId);
      setSessionId(targetSessionId);
      setMessages(sessionMessages);
      // Also load into memory manager cache
      agentRef.current.getMemoryManager().setMessages(targetSessionId, sessionMessages);
    } catch (err) {
      console.error('[useLensAgent] Failed to load session:', err);
      setError(err instanceof Error ? err : new Error('Failed to load session'));
    }
  }, []);

  return {
    messages,
    isLoading,
    isInitialized,
    sessionId,
    config,
    error,
    init,
    sendMessage,
    abort,
    clearMessages,
    newSession,
    listSessions,
    loadSession,
  };
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
