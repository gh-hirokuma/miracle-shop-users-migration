import { loadConfig, getRateLimitConfig } from './config';
import logger from './utils/logger';
import { RateLimiter } from './utils/rate-limiter';
import { ShopifyService } from './services/shopify.service';
import { SupabaseService } from './services/supabase.service';
import { MigrationService } from './services/migration.service';

/**
 * メイン関数
 */
async function main() {
  try {
    logger.info('Shopify → Supabase ユーザーマイグレーションツール');
    logger.info('='.repeat(60));

    // 設定を読み込み
    const config = loadConfig();
    const rateLimitConfig = getRateLimitConfig();

    // サービスを初期化
    const rateLimiter = new RateLimiter(rateLimitConfig);
    const shopifyService = new ShopifyService(config, rateLimiter);
    const supabaseService = new SupabaseService(config);
    const migrationService = new MigrationService(
      shopifyService,
      supabaseService,
      config
    );

    // コマンドライン引数を確認
    const args = process.argv.slice(2);
    const command = args[0];
    const flags = args.slice(1);
    
    // フラグの確認
    const forceRefresh = flags.includes('--force') || flags.includes('--refresh') || flags.includes('-f');
    const noCache = flags.includes('--no-cache');

    switch (command) {
      case 'dry-run':
        // ドライラン（確認のみ）
        logger.info('ドライランモードで実行します');
        const dryRunResult = await migrationService.dryRun();
        logger.info('ドライラン完了');
        logger.info(`総顧客数: ${dryRunResult.totalCustomers}件`);
        logger.info('サンプルデータ:');
        console.log(JSON.stringify(dryRunResult.sampleCustomers, null, 2));
        break;

      case 'migrate-user':
        // 特定のユーザーのみマイグレーション
        const email = args[1];
        if (!email) {
          logger.error('メールアドレスを指定してください');
          logger.info('使用方法: npm run dev migrate-user user@example.com');
          process.exit(1);
        }
        await migrationService.migrateSpecificUser(email);
        break;

      case 'stats':
        // 統計情報を表示
        logger.info('マイグレーション統計を取得中...');
        const stats = await supabaseService.getMigrationStats();
        logger.info('='.repeat(60));
        logger.info(`総ユーザー数: ${stats.total}件`);
        logger.info(`マイグレーション済み: ${stats.migrated}件`);
        logger.info(`未マイグレーション: ${stats.notMigrated}件`);
        logger.info(
          `マイグレーション率: ${stats.total > 0 ? ((stats.migrated / stats.total) * 100).toFixed(2) : 0}%`
        );
        logger.info('='.repeat(60));
        break;

      case 'test':
        // 接続テスト
        logger.info('接続テストを実行中...');
        const shopifyConnected = await shopifyService.testConnection();
        const supabaseConnected = await supabaseService.testConnection();

        if (shopifyConnected && supabaseConnected) {
          logger.info('✅ 全ての接続テストに成功しました');
        } else {
          logger.error('❌ 接続テストに失敗しました');
          if (!shopifyConnected) {
            logger.error('- Shopify API接続失敗');
          }
          if (!supabaseConnected) {
            logger.error('- Supabase接続失敗');
          }
          process.exit(1);
        }
        break;

      case 'clear-cache':
        // キャッシュをクリア
        logger.info('キャッシュをクリアします...');
        const { cacheManager } = await import('./utils/cache');
        cacheManager.clear();
        logger.info('✅ キャッシュをクリアしました');
        break;

      case 'cache-info':
        // キャッシュ情報を表示
        logger.info('キャッシュ情報を取得中...');
        const { cacheManager: cm } = await import('./utils/cache');
        const cacheInfo = cm.getInfo('shopify-customers-with-metafields');
        if (cacheInfo && cacheInfo.exists) {
          const ageMinutes = Math.floor((cacheInfo.age || 0) / 1000 / 60);
          const ageHours = Math.floor(ageMinutes / 60);
          const sizeKB = Math.floor((cacheInfo.size || 0) / 1024);
          logger.info('='.repeat(60));
          logger.info('📦 キャッシュ情報');
          logger.info('='.repeat(60));
          logger.info(`存在: はい`);
          logger.info(`サイズ: ${sizeKB} KB`);
          logger.info(`経過時間: ${ageHours}時間${ageMinutes % 60}分`);
          logger.info('='.repeat(60));
        } else {
          logger.info('キャッシュは存在しません');
        }
        break;

      case 'migrate':
      case undefined:
        // フルマイグレーション実行
        logger.info('フルマイグレーションを実行します');

        if (forceRefresh) {
          logger.warn('🔄 強制再取得モード: キャッシュを無視して最新データを取得します');
        } else if (noCache) {
          logger.warn('🚫 キャッシュ無効モード: キャッシュを使用しません');
        } else {
          logger.info('💾 キャッシュ有効: 前回のデータがあれば使用します');
        }

        // 確認プロンプト（本番環境では慎重に）
        logger.warn('⚠️  この操作はデータベースにデータを書き込みます');
        logger.info('続行する場合は、環境変数が正しく設定されていることを確認してください');

        const result = await migrationService.execute(!noCache, forceRefresh);

        // 結果を表示
        logger.info('='.repeat(60));
        logger.info('マイグレーション結果');
        logger.info('='.repeat(60));
        logger.info(`総ユーザー数: ${result.totalUsers}件`);
        logger.info(`✅ 成功: ${result.migratedUsers}件`);
        logger.info(`❌ 失敗: ${result.failedUsers}件`);
        logger.info(`⏱️  処理時間: ${(result.duration / 1000).toFixed(2)}秒`);

        if (result.errors.length > 0) {
          logger.error('エラー詳細:');
          result.errors.forEach((err, index) => {
            logger.error(`[${index + 1}] ${err.email}: ${err.error}`);
          });
        }

        logger.info('='.repeat(60));

        if (result.success) {
          logger.info('✅ マイグレーションが正常に完了しました');
        } else {
          logger.warn('⚠️  一部のユーザーでエラーが発生しました');
          process.exit(1);
        }
        break;

      default:
        logger.error(`不明なコマンド: ${command}`);
        logger.info('使用可能なコマンド:');
        logger.info('');
        logger.info('📊 基本コマンド:');
        logger.info('  - migrate (またはコマンドなし): フルマイグレーションを実行');
        logger.info('  - dry-run: ドライラン（確認のみ）');
        logger.info('  - migrate-user <email>: 特定のユーザーのみマイグレーション');
        logger.info('  - stats: マイグレーション統計を表示');
        logger.info('  - test: 接続テストを実行');
        logger.info('');
        logger.info('💾 キャッシュコマンド:');
        logger.info('  - cache-info: キャッシュ情報を表示');
        logger.info('  - clear-cache: キャッシュをクリア');
        logger.info('');
        logger.info('🚩 オプションフラグ:');
        logger.info('  - --force, --refresh, -f: キャッシュを無視して強制再取得');
        logger.info('  - --no-cache: キャッシュ機能を完全に無効化');
        logger.info('');
        logger.info('使用例:');
        logger.info('  npm run migrate                  # キャッシュ使用（高速）');
        logger.info('  npm run migrate -- --force       # 強制再取得');
        logger.info('  npm run dev cache-info           # キャッシュ情報表示');
        logger.info('  npm run dev clear-cache          # キャッシュクリア');
        process.exit(1);
    }

    logger.info('プログラムを終了します');
    process.exit(0);
  } catch (error) {
    logger.error('致命的なエラーが発生しました', { error });
    process.exit(1);
  }
}

// メイン関数を実行
main();

