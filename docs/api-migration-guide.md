# Shopify → Supabase ユーザーマイグレーション API 仕様書

> このドキュメントは、Shopifyからユーザーデータを取得してSupabaseに登録する機能を、別サービスのAPIに移植するための詳細な仕様書です。

## 📋 目次

1. [概要](#概要)
2. [データフロー](#データフロー)
3. [Shopify API 仕様](#shopify-api-仕様)
4. [データマッピング仕様](#データマッピング仕様)
5. [Supabase API 仕様](#supabase-api-仕様)
6. [エラーハンドリング](#エラーハンドリング)
7. [レート制限とリトライ](#レート制限とリトライ)
8. [実装例](#実装例)

---

## 概要

### システムの目的

Shopifyの顧客データとメタフィールドを取得し、Supabaseデータベースに同期するマイグレーションツール。

### 主要機能

- ✅ Shopify APIから全顧客データの取得（ページネーション対応）
- ✅ 顧客ごとのメタフィールドの取得
- ✅ メタフィールドのデータマッピング
- ✅ Supabaseへのバッチ登録（upsert）
- ✅ レート制限の遵守（2リクエスト/秒）
- ✅ 自動リトライ機能
- ✅ ローカルキャッシュ機能

---

## データフロー

```
┌─────────────────┐
│  Shopify API    │
│                 │
│  1. 顧客一覧    │◄────┐
│  2. メタフィールド│    │ ページネーション
└────────┬────────┘     │ (250件/page)
         │               │
         │ GET /customers.json
         │ GET /customers/{id}/metafields.json
         │
         ▼
┌─────────────────┐
│  データ変換     │
│                 │
│  - routine      │
│  - dental_analysis → brush_score
│  - point → points
│  - shopify_user_id
└────────┬────────┘
         │
         │ 50件ずつバッチ処理
         │
         ▼
┌─────────────────┐
│  Supabase       │
│                 │
│  upsert()       │
│  ON CONFLICT    │
│  (email)        │
└─────────────────┘
```

---

## Shopify API 仕様

### 1. 認証

**方式**: Bearer Token認証（カスタムアプリのアクセストークン）

```
Authorization: Bearer shpat_xxxxxxxxxxxxxxxxxxxxx
```

**必要なスコープ**:
- `read_customers` - 顧客データの読み取り
- `read_customer_metafields` - 顧客メタフィールドの読み取り

### 2. 顧客一覧の取得

**エンドポイント**:
```
GET https://{store-name}.myshopify.com/admin/api/2024-10/customers.json
```

**パラメータ**:
| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| limit | integer | No | 取得件数（最大250、デフォルト50） |
| page_info | string | No | ページネーション用トークン |

**レスポンス例**:
```json
{
  "customers": [
    {
      "id": 26440965259635,
      "email": "user@example.com",
      "first_name": "太郎",
      "last_name": "山田",
      "phone": "+819012345678",
      "state": "enabled",
      "verified_email": true,
      "currency": "JPY",
      "created_at": "2025-10-25T21:29:15+09:00",
      "updated_at": "2025-10-25T21:29:15+09:00"
    }
  ]
}
```

**ページネーション**:

レスポンスヘッダーの`Link`に次ページのURLが含まれます：

```
Link: <https://store.myshopify.com/admin/api/2024-10/customers.json?page_info=xxxxx>; rel="next"
```

`page_info`パラメータを抽出して次のリクエストに使用します。

**実装の注意点**:
- `limit=250`で最大件数を取得
- `Link`ヘッダーがない場合は最後のページ
- `page_info`は毎回異なる一時的なトークン

### 3. 顧客のメタフィールド取得

**エンドポイント**:
```
GET https://{store-name}.myshopify.com/admin/api/2024-10/customers/{customer_id}/metafields.json
```

**パラメータ**: なし

**レスポンス例**:
```json
{
  "metafields": [
    {
      "id": 181328973070707,
      "namespace": "custom",
      "key": "routine",
      "value": "{\"date\":\"\",\"routines\":{\"brush\":{\"count\":0}}}",
      "type": "json",
      "owner_id": 26434056585587,
      "owner_resource": "customer",
      "created_at": "2025-10-25T04:02:03+09:00",
      "updated_at": "2025-10-25T04:02:03+09:00"
    },
    {
      "id": 181328973103475,
      "namespace": "custom",
      "key": "dental_analysis",
      "value": "{\"date\":\"\",\"score\":0}",
      "type": "json",
      "owner_id": 26434056585587,
      "owner_resource": "customer",
      "created_at": "2025-10-25T04:02:03+09:00",
      "updated_at": "2025-10-25T04:02:03+09:00"
    },
    {
      "id": 181289906274675,
      "namespace": "custom",
      "key": "point",
      "value": 1,
      "type": "number_integer",
      "owner_id": 26427051606387,
      "owner_resource": "customer",
      "created_at": "2025-10-22T23:23:25+09:00",
      "updated_at": "2025-10-22T23:23:25+09:00"
    }
  ]
}
```

**メタフィールドの型**:
- `json`: JSON文字列（パース必要）
- `number_integer`: 整数
- `single_line_text_field`: テキスト
- その他多数

---

## データマッピング仕様

### 1. 基本フィールドのマッピング

| Shopify | Supabase | 変換処理 |
|---------|----------|---------|
| `email` | `email` | そのまま |
| `id` | `shopify_user_id` | 文字列に変換 |
| 全体 | `shopify_meta_data` | JSON全体を保存 |

### 2. メタフィールドのマッピング

#### 2.1 routine (ルーティンデータ)

**Shopifyメタフィールド**:
```json
{
  "namespace": "custom",
  "key": "routine",
  "type": "json",
  "value": "{\"date\":\"2025-10-25T00:00:00.000\",\"routines\":{\"brush\":{\"count\":1},\"tongue_brush\":{\"count\":0},\"fross\":{\"count\":0}}}"
}
```

**変換処理**:
```javascript
// 1. JSON文字列をパース
const routine = JSON.parse(metafield.value);

// 2. Supabaseのroutineカラムに保存
// 型: JSONB
```

**保存後のデータ構造**:
```json
{
  "date": "2025-10-25T00:00:00.000",
  "routines": {
    "brush": { "count": 1 },
    "tongue_brush": { "count": 0 },
    "fross": { "count": 0 }
  }
}
```

#### 2.2 dental_analysis → brush_score (ブラッシングスコア)

**Shopifyメタフィールド**:
```json
{
  "namespace": "custom",
  "key": "dental_analysis",
  "type": "json",
  "value": "{\"date\":\"\",\"score\":0}"
}
```

**変換処理**:
```javascript
// 1. JSON文字列をパース
const dentalAnalysis = JSON.parse(metafield.value);

// 2. Supabaseのbrush_scoreカラムに保存（名前変更に注意）
// 型: JSONB
```

**保存後のデータ構造**:
```json
{
  "date": "",
  "score": 0
}
```

**⚠️ 重要**: Shopifyでは`dental_analysis`という名前ですが、Supabaseでは`brush_score`カラムに保存します。

#### 2.3 point → points (ポイント)

**Shopifyメタフィールド**:
```json
{
  "namespace": "custom",
  "key": "point",
  "type": "number_integer",
  "value": 5
}
```

**変換処理**:
```javascript
// 1. 数値を取得（文字列の場合はパース）
const points = typeof metafield.value === 'number' 
  ? metafield.value 
  : parseInt(metafield.value, 10) || 0;

// 2. Supabaseのpointsカラムに保存
// 型: INTEGER
```

**⚠️ 重要**: Shopifyでは`point`（単数形）ですが、Supabaseでは`points`（複数形）です。

### 3. データ変換の実装例

```typescript
function convertShopifyToSupabase(customer, metafields) {
  // メタフィールドから各データを抽出
  let routine = null;
  let brushScore = null;
  let points = 0;
  
  for (const metafield of metafields) {
    if (metafield.namespace !== 'custom') continue;
    
    switch (metafield.key) {
      case 'routine':
        try {
          routine = JSON.parse(metafield.value);
        } catch (e) {
          console.warn(`routine parse error: ${customer.email}`, e);
        }
        break;
        
      case 'dental_analysis':  // 注意: Shopifyでは dental_analysis
        try {
          brushScore = JSON.parse(metafield.value);
        } catch (e) {
          console.warn(`dental_analysis parse error: ${customer.email}`, e);
        }
        break;
        
      case 'point':  // 注意: Shopifyでは point（単数形）
        try {
          points = typeof metafield.value === 'number'
            ? metafield.value
            : parseInt(metafield.value, 10) || 0;
        } catch (e) {
          console.warn(`point parse error: ${customer.email}`, e);
          points = 0;
        }
        break;
    }
  }
  
  // Supabase用のデータ構造に変換
  return {
    email: customer.email,
    points: points,  // Supabaseではpoints（複数形）
    shopify_user_id: customer.id.toString(),
    routine: routine,
    brush_score: brushScore,  // Supabaseではbrush_score
    shopify_meta_data: customer  // 完全なShopifyデータを保存
  };
}
```

---

## Supabase API 仕様

### 1. 認証

**方式**: API Key認証（Service Role Key使用）

```javascript
const supabase = createClient(
  'https://your-project.supabase.co',
  'your-service-role-key',  // 注意: service_role キーを使用
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
```

**⚠️ 重要**: 
- `anon`キーではなく`service_role`キーを使用
- RLS（Row Level Security）をバイパスできる
- 必ず環境変数で管理し、外部に漏らさない

### 2. ユーザーデータの登録（Upsert）

**メソッド**: `upsert()`

```javascript
const { data, error } = await supabase
  .from('users')
  .upsert(userData, {
    onConflict: 'email',  // emailが重複した場合は更新
    ignoreDuplicates: false
  });
```

**バッチ処理**:
```javascript
// 複数件を一度に登録（推奨: 50件ずつ）
const { data, error } = await supabase
  .from('users')
  .upsert(userDataArray, {
    onConflict: 'email',
    ignoreDuplicates: false
  });
```

### 3. テーブルスキーマ

**テーブル名**: `users`

| カラム名 | 型 | NULL | デフォルト | 説明 |
|---------|-----|------|-----------|------|
| id | UUID | NO | gen_random_uuid() | 主キー（自動生成） |
| email | TEXT | NO | - | メールアドレス（UNIQUE制約） |
| points | INTEGER | NO | 0 | ポイント数 |
| shopify_user_id | TEXT | YES | NULL | Shopify顧客ID |
| routine | JSONB | YES | NULL | ルーティンデータ |
| brush_score | JSONB | YES | NULL | ブラッシングスコア |
| migrated | BOOLEAN | NO | false | マイグレーションフラグ（**ノータッチ**） |
| migrated_version | TEXT | YES | NULL | マイグレーションバージョン（**ノータッチ**） |
| shopify_meta_data | JSONB | YES | NULL | Shopifyの完全データ |
| created_at | TIMESTAMPTZ | YES | now() | 作成日時（自動） |
| updated_at | TIMESTAMPTZ | YES | now() | 更新日時（自動） |

**⚠️ 重要制約**:
```sql
-- emailにUNIQUE制約が必要（upsertのため）
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
```

**⚠️ 絶対に触らないカラム**:
- `migrated`: 他システムで使用中
- `migrated_version`: 他システムで使用中

これらのカラムはINSERT/UPDATE時に**含めない**でください。

---

## エラーハンドリング

### 1. Shopify APIのエラー

#### 429 Too Many Requests (レート制限)

```json
{
  "errors": "Exceeded 2 calls per second for api client. Reduce request rates to resume uninterrupted service."
}
```

**対処**:
- 指数バックオフで再試行
- 初回待機: 1秒
- 2回目: 2秒
- 3回目: 4秒
- 最大3回まで再試行

#### 404 Not Found

```json
{
  "errors": "Not Found"
}
```

**対処**:
- 顧客が削除された可能性
- ログに記録して次の顧客へ
- マイグレーション自体は継続

#### 401 Unauthorized

```json
{
  "errors": "[API] Invalid API key or access token"
}
```

**対処**:
- アクセストークンの確認
- スコープの確認
- マイグレーション中断

### 2. Supabaseのエラー

#### UNIQUE制約違反

```json
{
  "code": "23505",
  "message": "duplicate key value violates unique constraint \"users_email_unique\""
}
```

**対処**:
- 通常は発生しない（upsertのため）
- 発生した場合はコンフリクト設定を確認

#### ON CONFLICT制約がない

```json
{
  "message": "there is no unique or exclusion constraint matching the ON CONFLICT specification"
}
```

**対処**:
- emailカラムにUNIQUE制約を追加
```sql
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
```

### 3. データパースエラー

**JSON parse失敗**:
```javascript
try {
  const routine = JSON.parse(metafield.value);
} catch (error) {
  console.warn(`JSON parse failed for ${customer.email}`, error);
  // nullを設定して続行
  routine = null;
}
```

**数値変換失敗**:
```javascript
const points = parseInt(metafield.value, 10) || 0;  // デフォルト0
```

---

## レート制限とリトライ

### 1. Shopify API レート制限

**制限**: 2リクエスト/秒（REST Admin API）

**実装方法**:

```javascript
// キュー方式
const queue = new PQueue({
  concurrency: 1,  // 同時実行数1
  interval: 1000,  // 1秒間隔
  intervalCap: 2   // 1秒あたり2リクエスト
});

// 使用例
const result = await queue.add(() => 
  axios.get(`${baseURL}/customers.json`)
);
```

**バックオフ付きリトライ**:

```javascript
const retry = require('p-retry');

const result = await retry(
  async () => {
    const response = await axios.get(url);
    return response.data;
  },
  {
    retries: 3,  // 最大3回再試行
    factor: 2,   // 指数バックオフ係数
    minTimeout: 1000,  // 初回待機時間: 1秒
    maxTimeout: 10000, // 最大待機時間: 10秒
    onFailedAttempt: (error) => {
      console.log(`リトライ ${error.attemptNumber}回目`);
    }
  }
);
```

### 2. 処理時間の目安

| 項目 | 時間 |
|------|------|
| 顧客一覧取得（250件） | 約0.5秒 |
| メタフィールド取得（1顧客） | 約0.5秒 |
| 306顧客の完全取得 | 約2分30秒 |
| Supabase登録（306件） | 約0.5秒 |
| **合計** | **約2分30秒** |

---

## 実装例

### Node.js + TypeScript

```typescript
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import PQueue from 'p-queue';
import pRetry from 'p-retry';

// 設定
const SHOPIFY_STORE = 'your-store.myshopify.com';
const SHOPIFY_TOKEN = 'shpat_xxxxx';
const SUPABASE_URL = 'https://xxx.supabase.co';
const SUPABASE_KEY = 'service_role_key';
const BATCH_SIZE = 50;

// クライアント初期化
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const queue = new PQueue({
  concurrency: 1,
  interval: 1000,
  intervalCap: 2
});

// Shopify APIクライアント
async function fetchWithRetry(url: string) {
  return pRetry(
    async () => {
      const response = await axios.get(url, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_TOKEN,
          'Content-Type': 'application/json'
        }
      });
      return response;
    },
    {
      retries: 3,
      factor: 2,
      minTimeout: 1000
    }
  );
}

// 全顧客取得
async function getAllCustomers() {
  const customers = [];
  let pageInfo = null;
  
  do {
    const url = pageInfo
      ? `https://${SHOPIFY_STORE}/admin/api/2024-10/customers.json?limit=250&page_info=${pageInfo}`
      : `https://${SHOPIFY_STORE}/admin/api/2024-10/customers.json?limit=250`;
    
    const response = await queue.add(() => fetchWithRetry(url));
    customers.push(...response.data.customers);
    
    // 次ページのpage_infoを取得
    const linkHeader = response.headers.link;
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/page_info=([^&>]+)/);
      pageInfo = match ? match[1] : null;
    } else {
      pageInfo = null;
    }
  } while (pageInfo);
  
  return customers;
}

// メタフィールド取得
async function getMetafields(customerId: number) {
  const url = `https://${SHOPIFY_STORE}/admin/api/2024-10/customers/${customerId}/metafields.json`;
  const response = await queue.add(() => fetchWithRetry(url));
  return response.data.metafields;
}

// データ変換
function convertToSupabase(customer: any, metafields: any[]) {
  let routine = null;
  let brushScore = null;
  let points = 0;
  
  for (const mf of metafields) {
    if (mf.namespace !== 'custom') continue;
    
    try {
      switch (mf.key) {
        case 'routine':
          routine = JSON.parse(mf.value);
          break;
        case 'dental_analysis':
          brushScore = JSON.parse(mf.value);
          break;
        case 'point':
          points = typeof mf.value === 'number' 
            ? mf.value 
            : parseInt(mf.value, 10) || 0;
          break;
      }
    } catch (e) {
      console.warn(`Parse error: ${customer.email}, ${mf.key}`, e);
    }
  }
  
  return {
    email: customer.email,
    points,
    shopify_user_id: customer.id.toString(),
    routine,
    brush_score: brushScore,
    shopify_meta_data: customer
  };
}

// メイン処理
async function migrate() {
  // 1. 全顧客取得
  console.log('顧客データを取得中...');
  const customers = await getAllCustomers();
  console.log(`${customers.length}件の顧客を取得しました`);
  
  // 2. メタフィールド取得
  const customersWithMeta = [];
  for (let i = 0; i < customers.length; i++) {
    console.log(`メタフィールド取得中: ${i + 1}/${customers.length}`);
    const metafields = await getMetafields(customers[i].id);
    const userData = convertToSupabase(customers[i], metafields);
    customersWithMeta.push(userData);
  }
  
  // 3. バッチ登録
  console.log('Supabaseに登録中...');
  for (let i = 0; i < customersWithMeta.length; i += BATCH_SIZE) {
    const batch = customersWithMeta.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('users')
      .upsert(batch, { onConflict: 'email' });
    
    if (error) {
      console.error(`バッチ登録エラー:`, error);
      throw error;
    }
    console.log(`登録完了: ${i + batch.length}/${customersWithMeta.length}`);
  }
  
  console.log('✅ マイグレーション完了');
}

// 実行
migrate().catch(console.error);
```

### Python

```python
import requests
import time
from supabase import create_client, Client
import json

# 設定
SHOPIFY_STORE = "your-store.myshopify.com"
SHOPIFY_TOKEN = "shpat_xxxxx"
SUPABASE_URL = "https://xxx.supabase.co"
SUPABASE_KEY = "service_role_key"
BATCH_SIZE = 50
RATE_LIMIT_DELAY = 0.5  # 2リクエスト/秒 = 0.5秒/リクエスト

# クライアント初期化
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def fetch_with_retry(url, max_retries=3):
    """リトライ付きHTTPリクエスト"""
    headers = {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
    }
    
    for attempt in range(max_retries):
        try:
            time.sleep(RATE_LIMIT_DELAY)
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            return response
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 429:
                wait_time = 2 ** attempt
                print(f"レート制限: {wait_time}秒待機")
                time.sleep(wait_time)
            else:
                raise
    raise Exception("最大リトライ回数を超過")

def get_all_customers():
    """全顧客を取得"""
    customers = []
    page_info = None
    
    while True:
        if page_info:
            url = f"https://{SHOPIFY_STORE}/admin/api/2024-10/customers.json?limit=250&page_info={page_info}"
        else:
            url = f"https://{SHOPIFY_STORE}/admin/api/2024-10/customers.json?limit=250"
        
        response = fetch_with_retry(url)
        data = response.json()
        customers.extend(data['customers'])
        
        # 次ページのチェック
        link_header = response.headers.get('Link', '')
        if 'rel="next"' in link_header:
            import re
            match = re.search(r'page_info=([^&>]+)', link_header)
            page_info = match.group(1) if match else None
        else:
            break
    
    return customers

def get_metafields(customer_id):
    """メタフィールドを取得"""
    url = f"https://{SHOPIFY_STORE}/admin/api/2024-10/customers/{customer_id}/metafields.json"
    response = fetch_with_retry(url)
    return response.json()['metafields']

def convert_to_supabase(customer, metafields):
    """Supabase用に変換"""
    routine = None
    brush_score = None
    points = 0
    
    for mf in metafields:
        if mf['namespace'] != 'custom':
            continue
        
        try:
            if mf['key'] == 'routine':
                routine = json.loads(mf['value'])
            elif mf['key'] == 'dental_analysis':
                brush_score = json.loads(mf['value'])
            elif mf['key'] == 'point':
                points = int(mf['value']) if isinstance(mf['value'], (int, float)) else 0
        except Exception as e:
            print(f"Parse error: {customer['email']}, {mf['key']}: {e}")
    
    return {
        'email': customer['email'],
        'points': points,
        'shopify_user_id': str(customer['id']),
        'routine': routine,
        'brush_score': brush_score,
        'shopify_meta_data': customer
    }

def migrate():
    """メイン処理"""
    # 1. 全顧客取得
    print("顧客データを取得中...")
    customers = get_all_customers()
    print(f"{len(customers)}件の顧客を取得しました")
    
    # 2. メタフィールド取得
    customers_with_meta = []
    for i, customer in enumerate(customers):
        print(f"メタフィールド取得中: {i + 1}/{len(customers)}")
        metafields = get_metafields(customer['id'])
        user_data = convert_to_supabase(customer, metafields)
        customers_with_meta.append(user_data)
    
    # 3. バッチ登録
    print("Supabaseに登録中...")
    for i in range(0, len(customers_with_meta), BATCH_SIZE):
        batch = customers_with_meta[i:i + BATCH_SIZE]
        result = supabase.table('users').upsert(
            batch,
            on_conflict='email'
        ).execute()
        print(f"登録完了: {i + len(batch)}/{len(customers_with_meta)}")
    
    print("✅ マイグレーション完了")

if __name__ == "__main__":
    migrate()
```

---

## チェックリスト

実装時に確認すべき項目：

### Shopify API
- [ ] アクセストークンの取得（`read_customers`, `read_customer_metafields`スコープ）
- [ ] ページネーション実装（`Link`ヘッダーのパース）
- [ ] レート制限の遵守（2リクエスト/秒）
- [ ] リトライ機能の実装
- [ ] エラーハンドリング（429, 404, 401）

### データ変換
- [ ] `routine`のJSONパース
- [ ] `dental_analysis` → `brush_score`の名前変更
- [ ] `point` → `points`の名前変更
- [ ] `shopify_user_id`の文字列変換
- [ ] `shopify_meta_data`に完全データを保存

### Supabase
- [ ] Service Role Keyの使用
- [ ] `email`カラムのUNIQUE制約確認
- [ ] Upsert処理の実装（`onConflict: 'email'`）
- [ ] バッチ処理の実装（50件推奨）
- [ ] `migrated`と`migrated_version`を触らない

### テスト
- [ ] 1件のユーザーで動作確認
- [ ] 10件のユーザーで動作確認
- [ ] 全件マイグレーションの実行
- [ ] データの整合性確認

---

## よくある質問（FAQ）

### Q1. `migrated`と`migrated_version`は何に使われる？
A1. 他のシステムで使用中のフラグです。このマイグレーションツールでは**一切触らない**でください。

### Q2. なぜ`dental_analysis`が`brush_score`になる？
A2. Shopifyでは`dental_analysis`という名前ですが、Supabaseデータベースのカラム名は`brush_score`として設計されています。

### Q3. レート制限を超えたらどうなる？
A3. Shopifyから429エラーが返されます。指数バックオフでリトライしてください。

### Q4. メタフィールドがないユーザーはどうなる？
A4. `routine`、`brush_score`、`points`が初期値（null、null、0）で登録されます。

### Q5. 同じメールアドレスのユーザーが再度登録されたら？
A5. Upsert処理により、既存データが更新されます（emailがUNIQUE制約のため）。

---

## サポート情報

### 参考リンク
- [Shopify Admin API Documentation](https://shopify.dev/api/admin-rest)
- [Shopify REST Admin API Rate Limits](https://shopify.dev/api/usage/rate-limits)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)

### 連絡先
実装中に不明点があれば、プロジェクトの管理者にお問い合わせください。

---

**最終更新**: 2025-10-25  
**バージョン**: 1.0.0

