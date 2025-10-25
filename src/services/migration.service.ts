import logger from '../utils/logger';
import { ShopifyService } from './shopify.service';
import { SupabaseService } from './supabase.service';
import { MigrationResult, MigrationConfig } from '../types';

/**
 * マイグレーションサービス
 */
export class MigrationService {
  private shopifyService: ShopifyService;
  private supabaseService: SupabaseService;
  private config: MigrationConfig;

  constructor(
    shopifyService: ShopifyService,
    supabaseService: SupabaseService,
    config: MigrationConfig
  ) {
    this.shopifyService = shopifyService;
    this.supabaseService = supabaseService;
    this.config = config;
  }

  /**
   * マイグレーション実行
   */
  async execute(useCache: boolean = true, forceFresh: boolean = false): Promise<MigrationResult> {
    const startTime = Date.now();
    const errors: Array<{ email: string; error: string }> = [];

    logger.info('='.repeat(60));
    logger.info('マイグレーション処理を開始します');
    logger.info(`バージョン: ${this.config.migration.version}`);
    logger.info(`バッチサイズ: ${this.config.migration.batchSize}`);
    logger.info('='.repeat(60));

    try {
      // 1. 接続テスト
      logger.info('[STEP 1/5] 接続テストを実行中...');
      await this.testConnections();

      // 2. 既存データの確認
      logger.info('[STEP 2/5] 既存データを確認中...');
      const stats = await this.supabaseService.getMigrationStats();
      logger.info(`既存ユーザー数: ${stats.total}件`);
      logger.info(`マイグレーション済み: ${stats.migrated}件`);
      logger.info(`未マイグレーション: ${stats.notMigrated}件`);

      // 3. Shopifyから全顧客データを取得
      logger.info('[STEP 3/5] Shopifyから顧客データを取得中...');
      if (forceFresh) {
        logger.warn('🔄 強制再取得モード: キャッシュを使用しません');
      }
      const customers = await this.shopifyService.getAllCustomersWithMetafields(
        useCache && !forceFresh
      );
      logger.info(`取得した顧客数: ${customers.length}件`);

      if (customers.length === 0) {
        logger.warn('マイグレーション対象の顧客が見つかりませんでした');
        return {
          success: true,
          totalUsers: 0,
          migratedUsers: 0,
          failedUsers: 0,
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      // 4. Supabaseにデータを登録
      logger.info('[STEP 4/5] Supabaseにデータを登録中...');
      const { migratedCount, failedCount, migrationErrors } =
        await this.migrateCustomers(customers);

      errors.push(...migrationErrors);

      // 5. 結果の確認
      logger.info('[STEP 5/5] マイグレーション結果を確認中...');
      const finalStats = await this.supabaseService.getMigrationStats();
      logger.info(`最終ユーザー数: ${finalStats.total}件`);
      logger.info(`マイグレーション済み: ${finalStats.migrated}件`);

      const duration = Date.now() - startTime;
      const result: MigrationResult = {
        success: failedCount === 0,
        totalUsers: customers.length,
        migratedUsers: migratedCount,
        failedUsers: failedCount,
        errors,
        duration,
      };

      logger.info('='.repeat(60));
      logger.info('マイグレーション処理が完了しました');
      logger.info(`成功: ${result.migratedUsers}件`);
      logger.info(`失敗: ${result.failedUsers}件`);
      logger.info(`処理時間: ${(duration / 1000).toFixed(2)}秒`);
      logger.info('='.repeat(60));

      return result;
    } catch (error) {
      logger.error('マイグレーション処理でエラーが発生しました', { error });
      throw error;
    }
  }

  /**
   * 顧客データをマイグレーション
   */
  private async migrateCustomers(
    customers: Array<any>
  ): Promise<{
    migratedCount: number;
    failedCount: number;
    migrationErrors: Array<{ email: string; error: string }>;
  }> {
    let migratedCount = 0;
    let failedCount = 0;
    const migrationErrors: Array<{ email: string; error: string }> = [];
    const batchSize = this.config.migration.batchSize;

    // バッチ処理で登録
    for (let i = 0; i < customers.length; i += batchSize) {
      const batch = customers.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(customers.length / batchSize);

      logger.info(
        `バッチ ${batchNumber}/${totalBatches} を処理中 (${batch.length}件)...`
      );

      try {
        // Supabaseユーザーデータに変換
        const supabaseUsers = batch.map((customer) =>
          this.supabaseService.convertShopifyCustomerToSupabaseUser(
            customer,
            this.config.migration.version
          )
        );

        // 一括登録
        await this.supabaseService.upsertUsersBatch(supabaseUsers);

        migratedCount += batch.length;
        logger.info(
          `バッチ ${batchNumber}/${totalBatches} 完了 (累計: ${migratedCount}/${customers.length})`
        );
      } catch (error: any) {
        logger.error(`バッチ ${batchNumber} の処理に失敗しました`, { error });

        // バッチ処理失敗時は1件ずつリトライ
        for (const customer of batch) {
          try {
            const supabaseUser =
              this.supabaseService.convertShopifyCustomerToSupabaseUser(
                customer,
                this.config.migration.version
              );

            await this.supabaseService.upsertUser(supabaseUser);
            migratedCount++;
          } catch (singleError: any) {
            failedCount++;
            migrationErrors.push({
              email: customer.email,
              error: singleError.message || '不明なエラー',
            });
            logger.error(`ユーザー登録失敗: ${customer.email}`, {
              error: singleError,
            });
          }
        }
      }
    }

    return {
      migratedCount,
      failedCount,
      migrationErrors,
    };
  }

  /**
   * 接続テスト
   */
  private async testConnections(): Promise<void> {
    const shopifyConnected = await this.shopifyService.testConnection();
    const supabaseConnected = await this.supabaseService.testConnection();

    if (!shopifyConnected) {
      throw new Error('Shopify APIへの接続に失敗しました');
    }

    if (!supabaseConnected) {
      throw new Error('Supabaseへの接続に失敗しました');
    }

    logger.info('全ての接続テストに成功しました');
  }

  /**
   * ドライラン（実際にデータを登録せずに確認のみ）
   */
  async dryRun(): Promise<{
    totalCustomers: number;
    sampleCustomers: any[];
  }> {
    logger.info('ドライランモードで実行中...');

    // 接続テスト
    await this.testConnections();

    // 顧客データ取得（最初の10件のみ）
    const customers = await this.shopifyService.getAllCustomers();
    const sampleCustomers = customers.slice(0, 10);

    logger.info(`総顧客数: ${customers.length}件`);
    logger.info(`サンプル顧客数: ${sampleCustomers.length}件`);

    // サンプル顧客の情報を表示
    sampleCustomers.forEach((customer, index) => {
      logger.info(`[${index + 1}] ${customer.email} (ID: ${customer.id})`);
    });

    return {
      totalCustomers: customers.length,
      sampleCustomers: sampleCustomers.map((c) => ({
        id: c.id,
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
      })),
    };
  }

  /**
   * 特定のメールアドレスのみマイグレーション（テスト用）
   */
  async migrateSpecificUser(email: string): Promise<void> {
    logger.info(`特定ユーザーのマイグレーション: ${email}`);

    try {
      // Shopifyから全顧客を取得
      const customers = await this.shopifyService.getAllCustomersWithMetafields();
      const customer = customers.find((c) => c.email === email);

      if (!customer) {
        throw new Error(`顧客が見つかりません: ${email}`);
      }

      // Supabaseに登録
      const supabaseUser =
        this.supabaseService.convertShopifyCustomerToSupabaseUser(
          customer,
          this.config.migration.version
        );

      await this.supabaseService.upsertUser(supabaseUser);

      logger.info(`ユーザーのマイグレーション完了: ${email}`);
    } catch (error) {
      logger.error(`ユーザーのマイグレーション失敗: ${email}`, { error });
      throw error;
    }
  }
}

