import { createClient, SupabaseClient } from '@supabase/supabase-js';
import logger from '../utils/logger';
import { SupabaseUser, MigrationConfig, ShopifyCustomer, ShopifyMetafield } from '../types';

/**
 * Supabaseサービス
 */
export class SupabaseService {
  private client: SupabaseClient;

  constructor(config: MigrationConfig) {
    // Supabaseクライアントを初期化
    this.client = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    logger.info('Supabaseサービスを初期化しました');
  }

  /**
   * ユーザーを作成または更新（Upsert）
   */
  async upsertUser(user: SupabaseUser): Promise<void> {
    try {
      const { error } = await this.client
        .from('users')
        .upsert(user, {
          onConflict: 'email',
          ignoreDuplicates: false,
        });

      if (error) {
        throw error;
      }

      logger.debug(`ユーザーを登録/更新しました: ${user.email}`);
    } catch (error) {
      logger.error(`ユーザー登録/更新に失敗しました: ${user.email}`, { error });
      throw error;
    }
  }

  /**
   * 複数ユーザーを一括登録（バッチ処理）
   */
  async upsertUsersBatch(users: SupabaseUser[]): Promise<void> {
    try {
      const { error } = await this.client
        .from('users')
        .upsert(users, {
          onConflict: 'email',
          ignoreDuplicates: false,
        });

      if (error) {
        throw error;
      }

      logger.info(`${users.length}件のユーザーを一括登録/更新しました`);
    } catch (error) {
      logger.error('ユーザー一括登録/更新に失敗しました', { error });
      throw error;
    }
  }

  /**
   * メールアドレスでユーザーを検索
   */
  async getUserByEmail(email: string): Promise<SupabaseUser | null> {
    try {
      const { data, error } = await this.client
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // レコードが見つからない場合
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      logger.error(`ユーザー検索に失敗しました: ${email}`, { error });
      throw error;
    }
  }

  /**
   * Shopify User IDでユーザーを検索
   */
  async getUserByShopifyId(shopifyUserId: string): Promise<SupabaseUser | null> {
    try {
      const { data, error } = await this.client
        .from('users')
        .select('*')
        .eq('shopify_user_id', shopifyUserId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      logger.error(`ユーザー検索に失敗しました: Shopify ID ${shopifyUserId}`, {
        error,
      });
      throw error;
    }
  }

  /**
   * 全ユーザー数を取得
   */
  async getTotalUsersCount(): Promise<number> {
    try {
      const { count, error } = await this.client
        .from('users')
        .select('*', { count: 'exact', head: true });

      if (error) {
        throw error;
      }

      return count || 0;
    } catch (error) {
      logger.error('ユーザー数の取得に失敗しました', { error });
      throw error;
    }
  }

  /**
   * マイグレーション済みユーザー数を取得
   */
  async getMigratedUsersCount(version?: string): Promise<number> {
    try {
      let query = this.client
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('migrated', true);

      if (version) {
        query = query.eq('migrated_version', version);
      }

      const { count, error } = await query;

      if (error) {
        throw error;
      }

      return count || 0;
    } catch (error) {
      logger.error('マイグレーション済みユーザー数の取得に失敗しました', {
        error,
      });
      throw error;
    }
  }

  /**
   * Shopify顧客データからSupabaseユーザーデータに変換
   */
  convertShopifyCustomerToSupabaseUser(
    customer: ShopifyCustomer & { metafields?: ShopifyMetafield[] },
    _migrationVersion: string
  ): SupabaseUser {
    // メタフィールドからroutine、dental_analysis(brush_score)、pointを抽出
    let routine = null;
    let brushScore = null;
    let points = 0;

    if (customer.metafields) {
      // routine
      const routineField = customer.metafields.find(
        (m) => m.namespace === 'custom' && m.key === 'routine'
      );

      // dental_analysis → brush_score にマッピング
      const dentalAnalysisField = customer.metafields.find(
        (m) => m.namespace === 'custom' && m.key === 'dental_analysis'
      );

      // point → points にマッピング
      const pointField = customer.metafields.find(
        (m) => m.namespace === 'custom' && m.key === 'point'
      );

      if (routineField) {
        try {
          routine = JSON.parse(routineField.value);
        } catch (e) {
          logger.warn(`ルーティンデータのパースに失敗: ${customer.email}`);
        }
      }

      if (dentalAnalysisField) {
        try {
          brushScore = JSON.parse(dentalAnalysisField.value);
        } catch (e) {
          logger.warn(`dental_analysisのパースに失敗: ${customer.email}`);
        }
      }

      if (pointField) {
        try {
          // pointは数値または文字列の可能性があるため、パース処理
          const pointValue = pointField.value;
          points = typeof pointValue === 'number' 
            ? pointValue 
            : parseInt(pointValue, 10) || 0;
        } catch (e) {
          logger.warn(`ポイントデータのパースに失敗: ${customer.email}`);
          points = 0;
        }
      }
    }

    return {
      email: customer.email,
      points,
      shopify_user_id: customer.id.toString(),
      routine,
      brush_score: brushScore,
      shopify_meta_data: customer, // 完全なShopifyデータを保存
    };
  }

  /**
   * マイグレーション統計を取得
   */
  async getMigrationStats(): Promise<{
    total: number;
    migrated: number;
    notMigrated: number;
  }> {
    try {
      const total = await this.getTotalUsersCount();
      const migrated = await this.getMigratedUsersCount();
      const notMigrated = total - migrated;

      return {
        total,
        migrated,
        notMigrated,
      };
    } catch (error) {
      logger.error('マイグレーション統計の取得に失敗しました', { error });
      throw error;
    }
  }

  /**
   * マイグレーション済みフラグを更新
   */
  async updateMigrationStatus(
    email: string,
    migrated: boolean,
    version?: string
  ): Promise<void> {
    try {
      const updateData: any = { migrated };
      if (version) {
        updateData.migrated_version = version;
      }

      const { error } = await this.client
        .from('users')
        .update(updateData)
        .eq('email', email);

      if (error) {
        throw error;
      }

      logger.debug(`マイグレーションステータスを更新しました: ${email}`);
    } catch (error) {
      logger.error(`マイグレーションステータス更新に失敗: ${email}`, { error });
      throw error;
    }
  }

  /**
   * 接続テスト
   */
  async testConnection(): Promise<boolean> {
    try {
      const { error } = await this.client.from('users').select('id').limit(1);

      if (error) {
        throw error;
      }

      logger.info('Supabase接続テスト成功');
      return true;
    } catch (error) {
      logger.error('Supabase接続テスト失敗', { error });
      return false;
    }
  }

  /**
   * テーブルをクリア（開発用）
   * ⚠️ 本番環境では使用しないでください
   */
  async clearUsersTable(): Promise<void> {
    try {
      const { error } = await this.client.from('users').delete().neq('id', '');

      if (error) {
        throw error;
      }

      logger.warn('usersテーブルをクリアしました');
    } catch (error) {
      logger.error('usersテーブルのクリアに失敗しました', { error });
      throw error;
    }
  }
}

