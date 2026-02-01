/**
 * useChat - Simplified chat hook
 */

import { useLensAgent } from './useLensAgent';
import type { LensSDKConfig } from '../core/types';

interface UseChatOptions extends LensSDKConfig {
  userId?: string;
}

export function useChat(options: UseChatOptions) {
  const {
    messages,
    isLoading,
    isInitialized,
    error,
    sendMessage,
    abort,
    clearMessages,
    newSession,
  } = useLensAgent({ ...options, autoInit: true });

  return {
    messages,
    isLoading,
    isReady: isInitialized,
    error,
    send: sendMessage,
    stop: abort,
    clear: clearMessages,
    reset: newSession,
  };
}
