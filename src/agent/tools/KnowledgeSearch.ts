/**
 * Knowledge Search Tool - Search via API
 */

import { LensClient } from '../../core/LensClient';

export class KnowledgeSearchTool {
  private client: LensClient;

  constructor(client: LensClient) {
    this.client = client;
  }

  async execute(params: { query: string; topK?: number }): Promise<any> {
    const { query, topK = 5 } = params;

    try {
      const results = await this.client.searchKnowledge(query, topK);
      return {
        success: true,
        results,
      };
    } catch (error) {
      console.error('[KnowledgeSearch] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  }
}
