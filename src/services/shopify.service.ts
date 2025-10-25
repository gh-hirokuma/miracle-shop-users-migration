import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';
import { RateLimiter } from '../utils/rate-limiter';
import {
  ShopifyCustomer,
  ShopifyMetafield,
  ShopifyMetaobject,
  MigrationConfig,
} from '../types';

/**
 * Shopify APIサービス
 */
export class ShopifyService {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;
  private apiVersion = '2024-10';
  private lastResponse: any = null; // 最後のレスポンスを保持

  constructor(config: MigrationConfig, rateLimiter: RateLimiter) {
    this.rateLimiter = rateLimiter;

    // Axios クライアントを初期化
    this.client = axios.create({
      baseURL: `https://${config.shopify.storeDomain}/admin/api/${this.apiVersion}`,
      headers: {
        'X-Shopify-Access-Token': config.shopify.accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    logger.info('Shopify APIサービスを初期化しました');
  }

  /**
   * 全ての顧客を取得（ページネーション対応）
   */
  async getAllCustomers(): Promise<ShopifyCustomer[]> {
    logger.info('全顧客データの取得を開始します');
    const allCustomers: ShopifyCustomer[] = [];
    let pageInfo: string | null = null;
    let pageCount = 0;

    try {
      do {
        const customers = await this.rateLimiter.execute(
          async () => this.fetchCustomersPage(pageInfo),
          `顧客取得 (ページ ${pageCount + 1})`
        );

        if (customers.length === 0) {
          break;
        }

        allCustomers.push(...customers);
        pageCount++;

        logger.info(
          `${customers.length}件の顧客を取得しました (累計: ${allCustomers.length}件, ページ: ${pageCount})`
        );

        // 次のページがあるかチェック（Linkヘッダーから判定）
        pageInfo = this.getNextPageInfo();
      } while (pageInfo);

      logger.info(`全顧客の取得完了: 合計 ${allCustomers.length}件`);
      return allCustomers;
    } catch (error) {
      logger.error('顧客データの取得に失敗しました', { error });
      throw error;
    }
  }

  /**
   * 顧客の1ページ分を取得
   */
  private async fetchCustomersPage(
    pageInfo: string | null
  ): Promise<ShopifyCustomer[]> {
    try {
      const params: any = {
        limit: 250, // Shopify APIの最大値
      };

      if (pageInfo) {
        params.page_info = pageInfo;
      }

      const response = await this.client.get('/customers.json', { params });
      
      // レスポンスを保存（Linkヘッダー取得用）
      this.lastResponse = response;
      
      return response.data.customers || [];
    } catch (error: any) {
      if (error.response?.status === 429) {
        logger.warn('レート制限に達しました。待機します...');
        await this.rateLimiter.delay(2000);
        throw error;
      }
      throw error;
    }
  }

  /**
   * 次のページ情報を取得（Linkヘッダーから抽出）
   */
  private getNextPageInfo(): string | null {
    if (!this.lastResponse || !this.lastResponse.headers) {
      return null;
    }

    const linkHeader = this.lastResponse.headers.link;
    if (!linkHeader) {
      return null;
    }

    // Linkヘッダーから next の page_info を抽出
    // 例: <https://store.myshopify.com/admin/api/2024-10/customers.json?page_info=xxxxx>; rel="next"
    const nextLinkMatch = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    
    if (nextLinkMatch && nextLinkMatch[1]) {
      logger.debug(`次ページのpage_infoを検出: ${nextLinkMatch[1]}`);
      return nextLinkMatch[1];
    }

    return null;
  }

  /**
   * 顧客のメタフィールドを取得
   */
  async getCustomerMetafields(customerId: number): Promise<ShopifyMetafield[]> {
    try {
      const metafields = await this.rateLimiter.execute(
        async () => {
          const response = await this.client.get(
            `/customers/${customerId}/metafields.json`
          );
          return response.data.metafields || [];
        },
        `メタフィールド取得 (顧客ID: ${customerId})`
      );

      logger.debug(
        `顧客 ${customerId} のメタフィールドを ${metafields.length}件取得しました`
      );
      return metafields;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.debug(`顧客 ${customerId} にメタフィールドが存在しません`);
        return [];
      }
      logger.error(
        `顧客 ${customerId} のメタフィールド取得に失敗しました`,
        { error }
      );
      throw error;
    }
  }

  /**
   * 全てのメタオブジェクトを取得
   */
  async getAllMetaobjects(type?: string): Promise<ShopifyMetaobject[]> {
    logger.info(
      `メタオブジェクトの取得を開始します${type ? ` (タイプ: ${type})` : ''}`
    );

    try {
      const metaobjects = await this.rateLimiter.execute(
        async () => {
          const query = type
            ? `{ metaobjects(type: "${type}", first: 250) { edges { node { id type handle fields { key value type } } } } }`
            : `{ metaobjects(first: 250) { edges { node { id type handle fields { key value type } } } } }`;

          const response = await this.client.post('/graphql.json', {
            query,
          });

          const edges = response.data.data?.metaobjects?.edges || [];
          return edges.map((edge: any) => edge.node);
        },
        `メタオブジェクト取得${type ? ` (タイプ: ${type})` : ''}`
      );

      logger.info(`メタオブジェクトを ${metaobjects.length}件取得しました`);
      return metaobjects;
    } catch (error) {
      logger.error('メタオブジェクトの取得に失敗しました', { error });
      throw error;
    }
  }

  /**
   * 顧客データをメタフィールド付きで取得
   */
  async getCustomerWithMetafields(
    customerId: number
  ): Promise<ShopifyCustomer & { metafields: ShopifyMetafield[] }> {
    const customer = await this.getCustomerById(customerId);
    const metafields = await this.getCustomerMetafields(customerId);

    return {
      ...customer,
      metafields,
    };
  }

  /**
   * IDで顧客を取得
   */
  async getCustomerById(customerId: number): Promise<ShopifyCustomer> {
    try {
      const customer = await this.rateLimiter.execute(
        async () => {
          const response = await this.client.get(
            `/customers/${customerId}.json`
          );
          return response.data.customer;
        },
        `顧客取得 (ID: ${customerId})`
      );

      return customer;
    } catch (error) {
      logger.error(`顧客 ${customerId} の取得に失敗しました`, { error });
      throw error;
    }
  }

  /**
   * 全顧客をメタフィールド付きで取得（キャッシュ対応）
   */
  async getAllCustomersWithMetafields(
    useCache: boolean = true,
    maxCacheAgeMs?: number
  ): Promise<Array<ShopifyCustomer & { metafields: ShopifyMetafield[] }>> {
    logger.info('全顧客データ（メタフィールド含む）の取得を開始します');

    // キャッシュを試す
    if (useCache) {
      const { cacheManager } = await import('../utils/cache');
      const cached = cacheManager.load<
        Array<ShopifyCustomer & { metafields: ShopifyMetafield[] }>
      >('shopify-customers-with-metafields', maxCacheAgeMs);

      if (cached) {
        logger.info(
          `✨ キャッシュから${cached.length}件の顧客データを読み込みました`
        );
        return cached;
      }
    }

    // キャッシュがない場合は取得
    logger.info('キャッシュが見つかりません。Shopify APIから取得します...');

    // まず全顧客を取得
    const customers = await this.getAllCustomers();

    // 各顧客のメタフィールドを取得
    const customersWithMetafields: Array<
      ShopifyCustomer & { metafields: ShopifyMetafield[] }
    > = [];

    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];
      logger.info(
        `顧客 ${i + 1}/${customers.length} のメタフィールドを取得中...`
      );

      try {
        const metafields = await this.getCustomerMetafields(customer.id);
        customersWithMetafields.push({
          ...customer,
          metafields,
        });
      } catch (error) {
        logger.warn(
          `顧客 ${customer.id} のメタフィールド取得をスキップしました`,
          { error }
        );
        // メタフィールド取得失敗時は空配列で続行
        customersWithMetafields.push({
          ...customer,
          metafields: [],
        });
      }
    }

    // キャッシュに保存
    if (useCache) {
      const { cacheManager } = await import('../utils/cache');
      cacheManager.save('shopify-customers-with-metafields', customersWithMetafields);
    }

    logger.info(
      `全顧客データ（メタフィールド含む）の取得完了: ${customersWithMetafields.length}件`
    );
    return customersWithMetafields;
  }

  /**
   * 接続テスト
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/shop.json');
      logger.info('Shopify API接続テスト成功');
      return true;
    } catch (error) {
      logger.error('Shopify API接続テスト失敗', { error });
      return false;
    }
  }
}

