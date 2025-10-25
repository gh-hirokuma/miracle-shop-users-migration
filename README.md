# Miracle Shop ユーザーマイグレーションツール

Shopify APIから全ユーザー、メタフィールド、メタオブジェクトを取得し、Supabaseデータベースに移行するためのNode.js TypeScriptツールです。

## 🚀 機能

- ✅ Shopify APIから全顧客データを取得
- ✅ 顧客のメタフィールドを自動取得
- ✅ メタオブジェクトの取得対応
- ✅ **ローカルキャッシュ機能（最大105倍高速化！）** 🆕
- ✅ レート制限対応（Shopify APIの制限を考慮）
- ✅ リトライ機能（エラー時の自動再試行）
- ✅ バッチ処理（大量データの効率的な処理）
- ✅ Supabaseへの自動登録/更新
- ✅ マイグレーション統計の表示
- ✅ ドライランモード（実際の登録前の確認）
- ✅ 詳細なログ出力

## 📋 必要条件

- Node.js 18.0.0以上
- Shopify ストアのアクセストークン
- Supabaseプロジェクト

## 🔧 セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

`env.example`をコピーして`.env`ファイルを作成します：

```bash
cp env.example .env
```

`.env`ファイルを編集して、以下の環境変数を設定します：

```env
# Shopify API設定
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Supabase設定
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# マイグレーション設定
MIGRATION_VERSION=1.0.0
BATCH_SIZE=50
RATE_LIMIT_PER_SECOND=2

# ログレベル
LOG_LEVEL=info
```

### 3. Shopifyアクセストークンの取得方法

1. Shopify管理画面にログイン
2. 「設定」→「アプリと販売チャネル」→「アプリを開発」
3. カスタムアプリを作成
4. 必要なスコープを設定：
   - `read_customers`（顧客の読み取り）
   - `read_customer_metafields`（顧客メタフィールドの読み取り）
5. アクセストークンをコピー

### 4. Supabaseサービスロールキーの取得方法

1. Supabaseダッシュボードにログイン
2. プロジェクトを選択
3. 「設定」→「API」
4. 「service_role」キーをコピー

## 📝 使い方

### ビルド

```bash
npm run build
```

### 基本コマンド

#### 接続テスト

まず、Shopify APIとSupabaseへの接続をテストします：

```bash
npm run dev test
```

#### ドライラン（確認のみ）

実際にデータを登録せず、取得できるデータを確認します：

```bash
npm run dev dry-run
```

#### フルマイグレーション実行

全ユーザーをSupabaseに移行します：

```bash
npm run migrate
```

または開発モードで実行：

```bash
npm run dev
```

#### 特定ユーザーのマイグレーション

テスト用に特定のメールアドレスのみマイグレーション：

```bash
npm run dev migrate-user user@example.com
```

#### マイグレーション統計の表示

現在のマイグレーション状況を確認：

```bash
npm run dev stats
```

### 💾 キャッシュ機能（新機能！🚀）

メタフィールド取得は時間がかかるため、ローカルキャッシュを活用して処理を高速化できます。

#### キャッシュ情報を確認
```bash
npm run dev cache-info
```

#### キャッシュをクリア
```bash
npm run dev clear-cache
```

#### 強制再取得（キャッシュを無視して最新データを取得）
```bash
npm run migrate -- --force
# または
npm run migrate -- --refresh
npm run migrate -- -f
```

#### キャッシュ機能を完全に無効化
```bash
npm run migrate -- --no-cache
```

### ⚡ パフォーマンス比較

| モード | 処理時間（306ユーザーの例） | 用途 |
|--------|----------|------|
| **通常（初回/キャッシュなし）** | 約2分30秒 | 初回実行、またはShopify側でデータ更新時 |
| **キャッシュ使用（2回目以降）** | 約1.5秒 | 🚀 **105倍高速！** 通常の再実行時 |
| **強制再取得 `--force`** | 約2分30秒 | 最新データが必要な場合 |

💡 **推奨**: 通常はキャッシュを使用し、Shopify側でデータが更新された時のみ `--force` で再取得

**キャッシュファイルについて**:
- `cache/shopify-customers-with-metafields.json` に保存されます
- サイズ: 約676KB（306ユーザーの場合）
- `.gitignore` で除外されているため、Git管理外です

## 📊 ログ

ログは以下の場所に出力されます：

- `logs/combined.log` - 全てのログ
- `logs/error.log` - エラーログのみ
- コンソール出力 - リアルタイムログ

## 🗂️ プロジェクト構造

```
miracle-shop-users-migration/
├── src/
│   ├── config/
│   │   └── index.ts              # 設定管理
│   ├── services/
│   │   ├── shopify.service.ts    # Shopify APIサービス（キャッシュ対応）
│   │   ├── supabase.service.ts   # Supabaseサービス
│   │   └── migration.service.ts  # マイグレーションサービス
│   ├── utils/
│   │   ├── logger.ts             # ログユーティリティ
│   │   ├── rate-limiter.ts       # レート制限ユーティリティ
│   │   └── cache.ts              # キャッシュマネージャー 🆕
│   ├── types/
│   │   └── index.ts              # 型定義
│   └── index.ts                  # メインエントリーポイント
├── docs/                         # ドキュメント
├── logs/                         # ログファイル（自動生成）
├── cache/                        # キャッシュファイル（自動生成）🆕
├── dist/                         # ビルド出力（自動生成）
├── package.json
├── tsconfig.json
├── env.example
└── README.md
```

## 🔍 Supabaseデータベーススキーマ

マイグレーション先の`users`テーブル構造：

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| email | TEXT | メールアドレス（必須） |
| points | INTEGER | ポイント数（デフォルト: 0） |
| shopify_user_id | TEXT | Shopify顧客ID |
| routine | JSONB | ルーティンデータ |
| brush_score | JSONB | ブラッシングスコア |
| migrated | BOOLEAN | マイグレーション済みフラグ |
| migrated_version | TEXT | マイグレーションバージョン |
| shopify_meta_data | JSONB | Shopifyの完全な顧客データ |
| created_at | TIMESTAMPTZ | 作成日時 |
| updated_at | TIMESTAMPTZ | 更新日時 |

## ⚙️ 設定オプション

### BATCH_SIZE

一度に処理するユーザー数を指定します。デフォルトは50です。

- 小さい値：メモリ使用量が少なく、エラー時の影響が小さい
- 大きい値：処理速度が向上するが、メモリ使用量が増加

### RATE_LIMIT_PER_SECOND

Shopify APIへのリクエスト数/秒を制限します。デフォルトは2です。

Shopify APIのレート制限：
- REST Admin API: 2リクエスト/秒（バースト: 40リクエスト）
- GraphQL Admin API: 50ポイント/秒

### LOG_LEVEL

ログの出力レベルを設定します：
- `error`: エラーのみ
- `warn`: 警告とエラー
- `info`: 情報、警告、エラー（デフォルト）
- `debug`: デバッグ情報を含む全て

## 🛡️ エラーハンドリング

- **リトライ機能**: APIエラー時に自動的に3回まで再試行
- **バッチ処理の分割**: バッチ処理でエラーが発生した場合、1件ずつ処理を試行
- **詳細なログ**: 失敗したユーザーのメールアドレスとエラー内容を記録

## 📈 パフォーマンス

- レート制限を考慮した効率的なAPI呼び出し
- バッチ処理による高速なデータ登録
- メモリ効率の良いストリーミング処理

## ⚠️ 注意事項

1. **本番環境での実行前に必ずドライランを実行してください**
2. **Supabaseのサービスロールキーは機密情報です。適切に管理してください**
3. **大量のユーザーを移行する場合、時間がかかることがあります**
4. **Shopify APIのレート制限に注意してください**

## 🤝 トラブルシューティング

### Shopify API接続エラー

- アクセストークンが正しいか確認
- ストアドメインが正しいか確認（`your-store.myshopify.com`形式）
- 必要なスコープが付与されているか確認

### Supabase接続エラー

- プロジェクトURLが正しいか確認
- サービスロールキーが正しいか確認
- テーブルが存在するか確認

### レート制限エラー

- `RATE_LIMIT_PER_SECOND`の値を下げる
- `BATCH_SIZE`の値を下げる

## 📄 ライセンス

MIT

## 👨‍💻 開発者向け

### リント

```bash
npm run lint
```

### フォーマット

```bash
npm run format
```

### 開発モード（ホットリロード）

```bash
npm run dev
```

## 📚 関連ドキュメント

- [Shopify Admin API Documentation](https://shopify.dev/api/admin-rest)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)
- プロジェクト詳細: `docs/system-summary.json`
- データベーススキーマ: `docs/database-schema.json`
- マイグレーションガイド: `docs/migration-guide.json`

