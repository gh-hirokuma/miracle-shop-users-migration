# 📚 Shopify → Supabase マイグレーションツール ドキュメント

このディレクトリには、マイグレーションツールの詳細ドキュメントが含まれています。

## 📖 ドキュメント一覧

### 🏗️ システムドキュメント（既存）

| ファイル | 説明 |
|---------|------|
| [`system-summary.json`](./system-summary.json) | プロジェクト全体の概要とシステム構成 |
| [`database-schema.json`](./database-schema.json) | Supabaseデータベースのスキーマ定義 |
| [`migration-guide.json`](./migration-guide.json) | マイグレーション手順とデータマッピング |

### 🚀 API移行用ドキュメント（新規作成）

> **用途**: このマイグレーション機能を別のサービスや言語に移植する際に使用

| ファイル | 形式 | 説明 | おすすめ |
|---------|------|------|---------|
| [`api-migration-guide.md`](./api-migration-guide.md) | Markdown | **完全な実装ガイド**<br>- Shopify/Supabase API仕様<br>- データマッピング詳細<br>- エラーハンドリング<br>- 実装例（Node.js, Python） | 📖 まずはこれを読む |
| [`data-mapping-reference.md`](./data-mapping-reference.md) | Markdown | **データマッピングのクイックリファレンス**<br>- フィールド対応表<br>- 各言語のコード例<br>- よくある間違い<br>- デバッグSQL | 🗺️ 実装中の参照用 |
| [`quick-start-example.js`](./quick-start-example.js) | JavaScript | **最小限の実装例**<br>- 約200行の完全なコード<br>- コメント付き<br>- すぐに動かせる | 💻 実装のスタート |
| [`api-specification.json`](./api-specification.json) | JSON | **機械可読なAPI仕様**<br>- エンドポイント定義<br>- データマッピング<br>- エラーコード | 🤖 ツール連携用 |

## 🎯 目的別ガイド

### 📘 初めて実装する場合

1. **[`api-migration-guide.md`](./api-migration-guide.md)** を読む
   - システム全体の理解
   - データフローの確認
   - 必要な認証情報の準備

2. **[`data-mapping-reference.md`](./data-mapping-reference.md)** を確認
   - 重要な変換ルールの把握
   - `dental_analysis` → `brush_score`
   - `point` → `points`
   - `migrated` / `migrated_version` はノータッチ

3. **[`quick-start-example.js`](./quick-start-example.js)** をベースに実装
   - コピペして使える完全なコード
   - 自分の環境に合わせて設定を変更

### 🔧 実装中の場合

- **データマッピングの確認**: [`data-mapping-reference.md`](./data-mapping-reference.md)
- **エラーハンドリング**: [`api-migration-guide.md#エラーハンドリング`](./api-migration-guide.md#エラーハンドリング)
- **レート制限**: [`api-migration-guide.md#レート制限とリトライ`](./api-migration-guide.md#レート制限とリトライ)

### 🤖 自動化ツールを作る場合

- **JSON仕様**: [`api-specification.json`](./api-specification.json)
  - エンドポイント定義
  - データ型
  - 変換ルール

## ⚠️ 最重要ポイント

### 1. データマッピングの名前変更

| Shopify | Supabase | 理由 |
|---------|----------|------|
| `dental_analysis` | `brush_score` | Supabaseのカラム名が異なる |
| `point` | `points` | Supabaseでは複数形 |

### 2. ノータッチカラム

以下のカラムは**絶対に触らない**（他システムで使用中）:
- `migrated`
- `migrated_version`

### 3. 認証

- **Shopify**: カスタムアプリのアクセストークン（`read_customers`, `read_customer_metafields`スコープ）
- **Supabase**: **Service Role Key**を使用（anonキーでは不可）

### 4. レート制限

- **2リクエスト/秒**を厳守
- 超過すると429エラー
- 指数バックオフでリトライ

## 📊 データフロー概要

```
Shopify API (顧客データ)
  ↓ GET /customers.json (ページネーション)
  ↓ GET /customers/{id}/metafields.json (各顧客)
  │
  ├─ routine → routine (そのまま)
  ├─ dental_analysis → brush_score (名前変更)
  └─ point → points (名前変更)
  │
  ↓ データ変換
  │
Supabase (usersテーブル)
  ↓ upsert (onConflict: email)
  ✅ 完了
```

## 🔍 サンプルデータ

### Shopifyから取得するメタフィールド

```json
{
  "metafields": [
    {
      "namespace": "custom",
      "key": "routine",
      "value": "{\"date\":\"2025-10-25\",\"routines\":{\"brush\":{\"count\":1}}}"
    },
    {
      "namespace": "custom",
      "key": "dental_analysis",
      "value": "{\"date\":\"\",\"score\":0}"
    },
    {
      "namespace": "custom",
      "key": "point",
      "value": 5
    }
  ]
}
```

### Supabaseに保存されるデータ

```json
{
  "email": "user@example.com",
  "points": 5,
  "shopify_user_id": "26440965259635",
  "routine": {
    "date": "2025-10-25",
    "routines": {
      "brush": { "count": 1 }
    }
  },
  "brush_score": {
    "date": "",
    "score": 0
  },
  "shopify_meta_data": { /* 完全なShopifyデータ */ }
}
```

## 💡 Tips

### デバッグ用SQL

```sql
-- 全データ確認
SELECT email, points, routine, brush_score 
FROM users 
LIMIT 10;

-- ポイントがあるユーザー
SELECT email, points 
FROM users 
WHERE points > 0 
ORDER BY points DESC;

-- メタフィールドが設定されているユーザー
SELECT 
  COUNT(*) as total,
  COUNT(routine) as has_routine,
  COUNT(brush_score) as has_brush_score,
  COUNT(CASE WHEN points > 0 THEN 1 END) as has_points
FROM users;
```

### パフォーマンス

- **306ユーザーの場合**: 約2分30秒
- **顧客一覧取得**: 約1秒
- **メタフィールド取得**: 約2分30秒（306 × 0.5秒）
- **Supabase登録**: 約0.5秒

### キャッシュ機能

このプロジェクトではローカルキャッシュ機能があり、2回目以降は**1.5秒（105倍高速）**で完了します。

## 📞 サポート

実装中に不明点があれば、各ドキュメントの該当セクションを参照してください。

## 📝 変更履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2025-10-25 | 1.0.0 | 初版リリース |

---

**最終更新**: 2025-10-25  
**バージョン**: 1.0.0

