/**
 * Memory Manager
 * Manages session messages with API sync and automatic memory compaction
 */

import OpenAI from 'openai';
import { LensClient } from '../../core/LensClient';
import type { Message, CompactedMemory } from '../../core/types';

const MAX_MESSAGES = 20;
const COMPACT_THRESHOLD = 15;
const KEEP_RECENT = 10;
const MAX_TOKENS_ESTIMATE = 8000;

export class MemoryManager {
  private openai: OpenAI;
  private client: LensClient;

  // Local cache for messages (synced with API)
  private messageCache: Map<string, Message[]> = new Map();
  private compactedMemories: Map<string, CompactedMemory[]> = new Map();

  constructor(client: LensClient, openaiApiKey: string) {
    this.client = client;
    this.openai = new OpenAI({
      apiKey: openaiApiKey,
      dangerouslyAllowBrowser: true,
    });
  }

  /**
   * Get active messages for a session
   * First checks local cache, then fetches from API if needed
   */
  async getActiveMessages(sessionId: string): Promise<Message[]> {
    // Check cache first
    if (this.messageCache.has(sessionId)) {
      return this.messageCache.get(sessionId) || [];
    }

    // Fetch from API
    try {
      const messages = await this.client.getMessages(sessionId);
      this.messageCache.set(sessionId, messages);
      return messages;
    } catch (error) {
      console.error('[MemoryManager] Failed to fetch messages:', error);
      return [];
    }
  }

  /**
   * Get messages for prompt building (local cache only for speed)
   */
  getMessages(sessionId: string): Message[] {
    return this.messageCache.get(sessionId) || [];
  }

  /**
   * Save a new message to both local cache and API
   */
  async saveMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    options?: {
      externalUserId?: string;
      requestId?: string;
      toolCallId?: string;
      meta?: Record<string, any>;
    }
  ): Promise<void> {
    const message: Message = {
      role,
      content,
      timestamp: new Date(),
    };

    // Update local cache
    const messages = this.messageCache.get(sessionId) || [];
    messages.push(message);
    this.messageCache.set(sessionId, messages);

    // Sync to API (fire and forget, don't block)
    this.client.saveMessage(sessionId, message, options).catch((error) => {
      console.error('[MemoryManager] Failed to sync message to API:', error);
    });

    // Check if compaction is needed
    if (await this.shouldCompact(sessionId)) {
      this.compactMemory(sessionId).catch((error) => {
        console.error('[MemoryManager] Memory compaction failed:', error);
      });
    }
  }

  /**
   * Check if memory compaction is needed
   */
  async shouldCompact(sessionId: string): Promise<boolean> {
    const messages = this.messageCache.get(sessionId) || [];

    if (messages.length < COMPACT_THRESHOLD) {
      return false;
    }

    const estimatedTokens = this.estimateTokens(messages);
    return messages.length > MAX_MESSAGES || estimatedTokens > MAX_TOKENS_ESTIMATE;
  }

  /**
   * Compact old messages into a summary
   * Keeps recent messages, compacts the rest
   */
  async compactMemory(sessionId: string): Promise<void> {
    const messages = this.messageCache.get(sessionId) || [];

    if (messages.length < COMPACT_THRESHOLD) {
      console.log('[MemoryManager] Not enough messages to compact');
      return;
    }

    // Keep recent messages, compact the rest
    const toCompact = messages.slice(0, -KEEP_RECENT);
    const toKeep = messages.slice(-KEEP_RECENT);

    if (toCompact.length === 0) {
      return;
    }

    console.log(`[MemoryManager] Compacting ${toCompact.length} messages for session ${sessionId}`);

    // Generate summary using LLM
    const summary = await this.generateSummary(toCompact);

    // Store compacted memory
    const compacted: CompactedMemory = {
      summary,
      fromId: 0,
      toId: toCompact.length,
      messageCount: toCompact.length,
    };

    const existingCompacted = this.compactedMemories.get(sessionId) || [];
    existingCompacted.push(compacted);
    this.compactedMemories.set(sessionId, existingCompacted);

    // Update local cache with compacted summary + recent messages
    const summaryMessage: Message = {
      role: 'system',
      content: `[Memory Summary]\n${summary}`,
      timestamp: new Date(),
    };

    this.messageCache.set(sessionId, [summaryMessage, ...toKeep]);

    console.log(`[MemoryManager] Compacted ${toCompact.length} messages into summary`);
  }

  /**
   * Get compacted memories for a session
   */
  getCompactedMemories(sessionId: string): CompactedMemory[] {
    return this.compactedMemories.get(sessionId) || [];
  }

  /**
   * Generate summary of messages using LLM
   */
  private async generateSummary(messages: Message[]): Promise<string> {
    // Check if there's a previous memory summary
    const previousSummary = messages.find(
      (m) => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[Memory Summary]')
    );

    const conversationText = messages
      .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n\n');

    const systemPrompt = previousSummary
      ? `Summarize the following conversation concisely.

IMPORTANT: There is a previous [Memory Summary] in the messages below. You MUST:
1. Include all key information from the previous summary
2. Add new information from the subsequent messages
3. Combine them into ONE comprehensive summary

Focus on:
- Previous context and history (from the old summary)
- Key topics discussed
- Important information exchanged
- User's requests and agent's responses
- Any actions taken

Keep the combined summary under 400 words.`
      : `Summarize the following conversation concisely. Focus on:
- Key topics discussed
- Important information exchanged
- User's requests and agent's responses
- Any actions taken

Keep it under 300 words.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: conversationText },
        ],
        temperature: 0.3,
      });

      return response.choices[0]?.message?.content || 'Summary unavailable';
    } catch (error) {
      console.error('[MemoryManager] Failed to generate summary:', error);
      return 'Summary generation failed';
    }
  }

  /**
   * Estimate token count for messages (rough approximation)
   * 1 token ≈ 4 characters for English, ~2 for Chinese
   */
  private estimateTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        // Use ~2.5 chars per token as middle ground for mixed content
        total += Math.ceil(msg.content.length / 2.5);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            total += Math.ceil(part.text.length / 2.5);
          } else if (part.type === 'image_url') {
            // Images cost fixed tokens (depends on size, ~85-255 tokens for low detail)
            total += 85;
          }
        }
      }
    }
    return total;
  }

  /**
   * Clear messages for a session (local cache only)
   */
  clearMessages(sessionId: string): void {
    this.messageCache.delete(sessionId);
    this.compactedMemories.delete(sessionId);
  }

  /**
   * Set messages for a session (local cache only)
   */
  setMessages(sessionId: string, messages: Message[]): void {
    this.messageCache.set(sessionId, messages);
  }

  /**
   * Preload messages from API into cache
   */
  async preloadMessages(sessionId: string): Promise<void> {
    try {
      const messages = await this.client.getMessages(sessionId);
      this.messageCache.set(sessionId, messages);
    } catch (error) {
      console.error('[MemoryManager] Failed to preload messages:', error);
    }
  }
}
