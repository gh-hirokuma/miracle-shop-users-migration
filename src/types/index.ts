/**
 * Shopify顧客データの型定義
 */
export interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  state: string;
  verified_email: boolean;
  currency: string;
  created_at: string;
  updated_at: string;
  addresses?: any[];
  default_address?: any;
  metafields?: ShopifyMetafield[];
  [key: string]: any;
}

/**
 * Shopifyメタフィールドの型定義
 */
export interface ShopifyMetafield {
  id: number;
  namespace: string;
  key: string;
  value: string;
  type: string;
  owner_id: number;
  owner_resource: string;
  created_at: string;
  updated_at: string;
}

/**
 * Shopifyメタオブジェクトの型定義
 */
export interface ShopifyMetaobject {
  id: string;
  type: string;
  handle: string;
  fields: Array<{
    key: string;
    value: string;
    type: string;
  }>;
  created_at: string;
  updated_at: string;
}

/**
 * Supabaseユーザーテーブルの型定義
 */
export interface SupabaseUser {
  id?: string;
  email: string;
  points?: number;
  shopify_user_id: string | null;
  routine?: any;
  brush_score?: any;
  migrated?: boolean;
  migrated_version?: string;
  shopify_meta_data?: any;
  created_at?: string;
  updated_at?: string;
}

/**
 * マイグレーション結果の型定義
 */
export interface MigrationResult {
  success: boolean;
  totalUsers: number;
  migratedUsers: number;
  failedUsers: number;
  errors: Array<{
    email: string;
    error: string;
  }>;
  duration: number;
}

/**
 * レート制限設定の型定義
 */
export interface RateLimitConfig {
  requestsPerSecond: number;
  retryAttempts: number;
  retryDelay: number;
}

/**
 * マイグレーション設定の型定義
 */
export interface MigrationConfig {
  shopify: {
    storeDomain: string;
    accessToken: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  migration: {
    version: string;
    batchSize: number;
    rateLimitPerSecond: number;
  };
  logging: {
    level: string;
  };
}

/**
 * Shopify APIレスポンスの型定義
 */
export interface ShopifyCustomersResponse {
  customers: ShopifyCustomer[];
}

/**
 * Shopify APIページネーション情報
 */
export interface ShopifyPaginationInfo {
  hasNextPage: boolean;
  cursor?: string;
}

