/**
 * AI Page Generate Tool
 * Generate AI-powered recommendation pages via Lens OS API
 */

import { LensClient } from '../../core/LensClient';
import type { ToolResult } from '../../core/types';

export interface AIPageGenerateParams {
  title: string;
  books: {
    book_id: string;
    title: string;
    author: string;
    price: string;
    imageUrl: string;
    description?: string;
  }[];
  template?: string;
  userQuery?: string;
}

// Available page templates
const PAGE_TEMPLATES = [
  'neon-gradient-style', // 科技、程式、AI、數位
  'magazine-style', // 時尚、生活、設計、藝術
  'social-feed-style', // 熱門、暢銷、推薦、排行
  'comic-pop-style', // 漫畫、輕小說、動漫、奇幻
  'love-letter-style', // 愛情、浪漫、心靈、療癒
] as const;

export type PageTemplate = (typeof PAGE_TEMPLATES)[number];

export class AIPageGenerateTool {
  private client: LensClient;

  constructor(client: LensClient) {
    this.client = client;
  }

  /**
   * Execute AI page generation via API
   */
  async execute(params: AIPageGenerateParams): Promise<ToolResult> {
    try {
      const { title, books, template = 'social-feed-style', userQuery } = params;

      console.log('[AIPageGenerate] Generating page:', title);
      console.log('[AIPageGenerate] Books count:', books.length);
      console.log('[AIPageGenerate] Template:', template);

      if (books.length === 0) {
        return {
          success: false,
          error: 'No books provided for page generation',
        };
      }

      // Validate template
      const validTemplate = PAGE_TEMPLATES.includes(template as PageTemplate)
        ? template
        : 'social-feed-style';

      const result = await this.client.generateAIPage({
        title,
        books,
        template: validTemplate,
        userQuery,
      });

      if (!result || !result.pageUrl) {
        return {
          success: false,
          error: 'Failed to generate page - no URL returned',
        };
      }

      return {
        success: true,
        result: {
          pageUrl: result.pageUrl,
          pageId: result.pageId,
          message: `Generated page: ${result.pageUrl}`,
        },
      };
    } catch (error) {
      console.error('[AIPageGenerate] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get available templates
   */
  getTemplates(): readonly string[] {
    return PAGE_TEMPLATES;
  }
}
