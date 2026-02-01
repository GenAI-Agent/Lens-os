/**
 * Product Search Tool
 * Search products via Lens OS API
 */

import { LensClient } from '../../core/LensClient';
import type { ToolResult } from '../../core/types';

interface ProductSearchParams {
  query: string;
  topK?: number;
  generatePage?: boolean;
}

export class ProductSearchTool {
  private client: LensClient;

  constructor(client: LensClient) {
    this.client = client;
  }

  /**
   * Execute product search via API
   */
  async execute(params: ProductSearchParams): Promise<ToolResult> {
    try {
      const { query, topK = 10, generatePage = true } = params;

      console.log('[ProductSearch] Query:', query);

      const result = await this.client.searchProducts(query, topK);

      if (!result || !result.results || result.results.length === 0) {
        return {
          success: true,
          result: {
            message: 'No products found matching your query.',
            results: [],
          },
        };
      }

      // Format results for display
      const products = result.results.map((r: any) => ({
        prodId: r.prod_id || r.prodId,
        orgProdId: r.org_prod_id || r.orgProdId,
        productName: r.prod_title_main || r.productName,
        subtitle: r.prod_title_next || r.subtitle || '',
        author: r.main_author || r.author || '',
        publisher: r.publisher_name || r.publisher || '',
        salePrice: r.sale_price || r.salePrice,
        listPrice: r.list_price || r.listPrice,
        discount: r.sale_disc || r.discount,
        category: r.cat4xsx_cat_nm || r.category || '',
        isbn: r.main_isbn || r.isbn || '',
        description: r.prod_pf || r.description || '',
        score: r.search_rank || r.score || 0,
      }));

      return {
        success: true,
        result: {
          message: result.pageUrl
            ? `Found ${products.length} products. View your personalized recommendations: ${result.pageUrl}`
            : `Found ${products.length} products.`,
          results: products,
          pageUrl: result.pageUrl || null,
          reasoning: result.reasoning || '',
        },
      };
    } catch (error) {
      console.error('[ProductSearch] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
