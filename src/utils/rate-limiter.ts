import PQueue from 'p-queue';
import pRetry from 'p-retry';
import logger from './logger';
import { RateLimitConfig } from '../types';

/**
 * レート制限とリトライ機能を提供するクラス
 */
export class RateLimiter {
  private queue: PQueue;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
    
    // キューを初期化（秒間リクエスト数を制限）
    this.queue = new PQueue({
      interval: 1000, // 1秒
      intervalCap: config.requestsPerSecond,
      concurrency: 1, // 並行実行数を1に制限
    });

    logger.info(`レート制限を初期化: ${config.requestsPerSecond}リクエスト/秒`);
  }

  /**
   * レート制限付きでリクエストを実行
   * @param fn 実行する関数
   * @param context コンテキスト情報（ログ用）
   * @returns 関数の実行結果
   */
  async execute<T>(
    fn: () => Promise<T>,
    context: string = '不明な操作'
  ): Promise<T> {
    return this.queue.add(async () => {
      try {
        logger.debug(`リクエスト実行: ${context}`);
        
        // リトライ機能付きで実行
        const result = await pRetry(fn, {
          retries: this.config.retryAttempts,
          onFailedAttempt: (error) => {
            logger.warn(
              `リトライ中 (${error.attemptNumber}/${this.config.retryAttempts}): ${context}`,
              { error: error.message }
            );
          },
          minTimeout: this.config.retryDelay,
          maxTimeout: this.config.retryDelay * 3,
        });

        return result;
      } catch (error) {
        logger.error(`リクエスト失敗: ${context}`, { error });
        throw error;
      }
    }) as Promise<T>;
  }

  /**
   * キューの待機中タスク数を取得
   */
  getPendingCount(): number {
    return this.queue.pending;
  }

  /**
   * キューのサイズを取得
   */
  getQueueSize(): number {
    return this.queue.size;
  }

  /**
   * キューを一時停止
   */
  pause(): void {
    this.queue.pause();
    logger.info('レート制限キューを一時停止');
  }

  /**
   * キューを再開
   */
  resume(): void {
    this.queue.start();
    logger.info('レート制限キューを再開');
  }

  /**
   * 全てのタスクが完了するまで待機
   */
  async waitForCompletion(): Promise<void> {
    await this.queue.onIdle();
    logger.info('全てのキュータスクが完了しました');
  }

  /**
   * 遅延処理（ミリ秒）
   */
  async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * デフォルトのレート制限設定
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  requestsPerSecond: 2,
  retryAttempts: 3,
  retryDelay: 1000, // 1秒
};

