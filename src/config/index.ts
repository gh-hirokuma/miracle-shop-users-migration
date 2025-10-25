import dotenv from 'dotenv';
import { MigrationConfig, RateLimitConfig } from '../types';
import logger from '../utils/logger';

// 環境変数を読み込み
dotenv.config();

/**
 * 必須環境変数をチェック
 */
function validateEnv(): void {
  const required = [
    'SHOPIFY_STORE_DOMAIN',
    'SHOPIFY_ACCESS_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `必須環境変数が設定されていません: ${missing.join(', ')}\n` +
      'env.exampleを参考に.envファイルを作成してください。'
    );
  }
}

/**
 * 環境変数から設定を読み込み
 */
export function loadConfig(): MigrationConfig {
  validateEnv();

  const config: MigrationConfig = {
    shopify: {
      storeDomain: process.env.SHOPIFY_STORE_DOMAIN!,
      accessToken: process.env.SHOPIFY_ACCESS_TOKEN!,
    },
    supabase: {
      url: process.env.SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    },
    migration: {
      version: process.env.MIGRATION_VERSION || '1.0.0',
      batchSize: parseInt(process.env.BATCH_SIZE || '50', 10),
      rateLimitPerSecond: parseInt(process.env.RATE_LIMIT_PER_SECOND || '2', 10),
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
    },
  };

  logger.info('設定を読み込みました', {
    shopifyDomain: config.shopify.storeDomain,
    supabaseUrl: config.supabase.url,
    migrationVersion: config.migration.version,
    batchSize: config.migration.batchSize,
    rateLimit: config.migration.rateLimitPerSecond,
  });

  return config;
}

/**
 * レート制限設定を取得
 */
export function getRateLimitConfig(): RateLimitConfig {
  return {
    requestsPerSecond: parseInt(process.env.RATE_LIMIT_PER_SECOND || '2', 10),
    retryAttempts: 3,
    retryDelay: 1000,
  };
}

