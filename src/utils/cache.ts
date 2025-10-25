import fs from 'fs';
import path from 'path';
import logger from './logger';

/**
 * キャッシュユーティリティ
 */
export class CacheManager {
  private cacheDir: string;

  constructor(cacheDir: string = 'cache') {
    this.cacheDir = path.join(process.cwd(), cacheDir);
    this.ensureCacheDir();
  }

  /**
   * キャッシュディレクトリを作成
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      logger.info(`キャッシュディレクトリを作成しました: ${this.cacheDir}`);
    }
  }

  /**
   * キャッシュファイルのパスを取得
   */
  private getCachePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json`);
  }

  /**
   * キャッシュを保存
   */
  save<T>(key: string, data: T): void {
    try {
      const cachePath = this.getCachePath(key);
      const cacheData = {
        data,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');
      logger.info(`キャッシュを保存しました: ${key}`);
    } catch (error) {
      logger.error(`キャッシュの保存に失敗しました: ${key}`, { error });
    }
  }

  /**
   * キャッシュを読み込み
   */
  load<T>(key: string, maxAgeMs?: number): T | null {
    try {
      const cachePath = this.getCachePath(key);

      if (!fs.existsSync(cachePath)) {
        logger.debug(`キャッシュが存在しません: ${key}`);
        return null;
      }

      const cacheContent = fs.readFileSync(cachePath, 'utf-8');
      const cacheData = JSON.parse(cacheContent);

      // 有効期限チェック
      if (maxAgeMs) {
        const age = Date.now() - cacheData.timestamp;
        if (age > maxAgeMs) {
          logger.info(
            `キャッシュが期限切れです: ${key} (${Math.floor(age / 1000 / 60)}分前)`
          );
          return null;
        }
      }

      const ageMinutes = Math.floor((Date.now() - cacheData.timestamp) / 1000 / 60);
      logger.info(
        `キャッシュを読み込みました: ${key} (${ageMinutes}分前のデータ)`
      );
      return cacheData.data as T;
    } catch (error) {
      logger.error(`キャッシュの読み込みに失敗しました: ${key}`, { error });
      return null;
    }
  }

  /**
   * キャッシュを削除
   */
  delete(key: string): void {
    try {
      const cachePath = this.getCachePath(key);
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
        logger.info(`キャッシュを削除しました: ${key}`);
      }
    } catch (error) {
      logger.error(`キャッシュの削除に失敗しました: ${key}`, { error });
    }
  }

  /**
   * 全キャッシュを削除
   */
  clear(): void {
    try {
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);
        files.forEach((file) => {
          fs.unlinkSync(path.join(this.cacheDir, file));
        });
        logger.info(`全てのキャッシュを削除しました (${files.length}件)`);
      }
    } catch (error) {
      logger.error('キャッシュのクリアに失敗しました', { error });
    }
  }

  /**
   * キャッシュの情報を取得
   */
  getInfo(key: string): { exists: boolean; age?: number; size?: number } | null {
    try {
      const cachePath = this.getCachePath(key);
      
      if (!fs.existsSync(cachePath)) {
        return { exists: false };
      }

      const stats = fs.statSync(cachePath);
      const cacheContent = fs.readFileSync(cachePath, 'utf-8');
      const cacheData = JSON.parse(cacheContent);

      return {
        exists: true,
        age: Date.now() - cacheData.timestamp,
        size: stats.size,
      };
    } catch (error) {
      logger.error(`キャッシュ情報の取得に失敗しました: ${key}`, { error });
      return null;
    }
  }
}

// デフォルトのキャッシュマネージャーをエクスポート
export const cacheManager = new CacheManager();

