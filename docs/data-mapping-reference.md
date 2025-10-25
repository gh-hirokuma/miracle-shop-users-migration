# データマッピング クイックリファレンス

> ShopifyのメタフィールドとSupabaseカラムの対応表

## 📊 基本フィールド

| Shopify | Supabase | 型 | 変換 | 必須 |
|---------|----------|-----|------|------|
| `customer.email` | `email` | TEXT | なし | ✅ |
| `customer.id` | `shopify_user_id` | TEXT | `toString()` | ✅ |
| `customer` (完全データ) | `shopify_meta_data` | JSONB | なし | ⭕ |

## 🔧 メタフィールド

### 1. routine → routine

**Shopify**:
```json
{
  "namespace": "custom",
  "key": "routine",
  "type": "json",
  "value": "{\"date\":\"2025-10-25T00:00:00.000\",\"routines\":{\"brush\":{\"count\":1},\"tongue_brush\":{\"count\":0},\"fross\":{\"count\":0}}}"
}
```

**Supabase**: `routine` (JSONB)
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

**変換**: `JSON.parse(value)`

---

### 2. dental_analysis → brush_score ⚠️

**Shopify**:
```json
{
  "namespace": "custom",
  "key": "dental_analysis",  // ⚠️ 名前が異なる
  "type": "json",
  "value": "{\"date\":\"\",\"score\":0}"
}
```

**Supabase**: `brush_score` (JSONB) ⚠️ 名前変更
```json
{
  "date": "",
  "score": 0
}
```

**変換**: `JSON.parse(value)`

**⚠️ 重要**: 
- Shopifyでは `dental_analysis`
- Supabaseでは `brush_score`

---

### 3. point → points ⚠️

**Shopify**:
```json
{
  "namespace": "custom",
  "key": "point",  // ⚠️ 単数形
  "type": "number_integer",
  "value": 5
}
```

**Supabase**: `points` (INTEGER) ⚠️ 複数形
```
5
```

**変換**: 
```javascript
typeof value === 'number' ? value : parseInt(value, 10) || 0
```

**⚠️ 重要**: 
- Shopifyでは `point` (単数形)
- Supabaseでは `points` (複数形)

---

## 🚫 ノータッチカラム

以下のSupabaseカラムは**絶対に触らない**（他システムで使用中）:

| カラム | 説明 |
|--------|------|
| `migrated` | マイグレーションフラグ（BOOLEAN） |
| `migrated_version` | マイグレーションバージョン（TEXT） |

**これらのカラムはINSERT/UPDATE時に含めない！**

---

## 💻 実装コード例

### TypeScript

```typescript
function mapShopifyToSupabase(
  customer: any,
  metafields: any[]
): SupabaseUser {
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

        case 'dental_analysis':  // ⚠️ 名前注意
          brushScore = JSON.parse(mf.value);
          break;

        case 'point':  // ⚠️ 単数形注意
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
    points: points,  // ⚠️ 複数形
    shopify_user_id: customer.id.toString(),
    routine: routine,
    brush_score: brushScore,  // ⚠️ 名前変更
    shopify_meta_data: customer
    // ⚠️ migrated, migrated_version は含めない
  };
}
```

### Python

```python
def map_shopify_to_supabase(customer, metafields):
    routine = None
    brush_score = None
    points = 0
    
    for mf in metafields:
        if mf['namespace'] != 'custom':
            continue
        
        try:
            if mf['key'] == 'routine':
                routine = json.loads(mf['value'])
            
            elif mf['key'] == 'dental_analysis':  # ⚠️ 名前注意
                brush_score = json.loads(mf['value'])
            
            elif mf['key'] == 'point':  # ⚠️ 単数形注意
                points = int(mf['value']) if isinstance(mf['value'], (int, float)) else 0
        
        except Exception as e:
            print(f"Parse error: {customer['email']}, {mf['key']}: {e}")
    
    return {
        'email': customer['email'],
        'points': points,  # ⚠️ 複数形
        'shopify_user_id': str(customer['id']),
        'routine': routine,
        'brush_score': brush_score,  # ⚠️ 名前変更
        'shopify_meta_data': customer
        # ⚠️ migrated, migrated_version は含めない
    }
```

### PHP

```php
function mapShopifyToSupabase($customer, $metafields) {
    $routine = null;
    $brushScore = null;
    $points = 0;
    
    foreach ($metafields as $mf) {
        if ($mf['namespace'] !== 'custom') continue;
        
        try {
            switch ($mf['key']) {
                case 'routine':
                    $routine = json_decode($mf['value'], true);
                    break;
                
                case 'dental_analysis':  // ⚠️ 名前注意
                    $brushScore = json_decode($mf['value'], true);
                    break;
                
                case 'point':  // ⚠️ 単数形注意
                    $points = is_numeric($mf['value']) 
                        ? intval($mf['value']) 
                        : 0;
                    break;
            }
        } catch (Exception $e) {
            error_log("Parse error: {$customer['email']}, {$mf['key']}: {$e->getMessage()}");
        }
    }
    
    return [
        'email' => $customer['email'],
        'points' => $points,  // ⚠️ 複数形
        'shopify_user_id' => strval($customer['id']),
        'routine' => $routine,
        'brush_score' => $brushScore,  // ⚠️ 名前変更
        'shopify_meta_data' => $customer
        // ⚠️ migrated, migrated_version は含めない
    ];
}
```

---

## ⚠️ よくある間違い

### ❌ 間違い 1: 名前をそのまま使う

```javascript
// ❌ 間違い
{
  dental_analysis: JSON.parse(mf.value)  // SupabaseにはこのカラムはないThis column doesn't exist in Supabase
}

// ✅ 正しい
{
  brush_score: JSON.parse(mf.value)  // brush_scoreに保存
}
```

### ❌ 間違い 2: 単数形・複数形を間違える

```javascript
// ❌ 間違い
{
  point: parseInt(mf.value)  // Supabaseにはpointカラムはない
}

// ✅ 正しい
{
  points: parseInt(mf.value)  // pointsカラムに保存
}
```

### ❌ 間違い 3: migratedフラグを設定する

```javascript
// ❌ 間違い（他システムで使用中！）
{
  email: customer.email,
  migrated: true,           // ⚠️ 触らない！
  migrated_version: '1.0.0' // ⚠️ 触らない！
}

// ✅ 正しい
{
  email: customer.email
  // migrated, migrated_versionは含めない
}
```

---

## 📝 チェックリスト

実装前に確認:

- [ ] `dental_analysis` → `brush_score` に変換している
- [ ] `point` → `points` に変換している
- [ ] `routine` はそのまま `routine`
- [ ] `shopify_user_id` は文字列変換している
- [ ] `migrated` と `migrated_version` を含めていない
- [ ] JSON値は `JSON.parse()` している
- [ ] 数値は `parseInt()` している
- [ ] パースエラーは適切に処理している

---

## 🔍 デバッグ用SQL

### データが正しく入っているか確認

```sql
-- 全データを確認
SELECT 
  email,
  points,
  shopify_user_id,
  routine,
  brush_score,
  created_at
FROM users
LIMIT 10;

-- pointsが0より大きいユーザー
SELECT email, points 
FROM users 
WHERE points > 0
ORDER BY points DESC;

-- brush_scoreが設定されているユーザー
SELECT email, brush_score 
FROM users 
WHERE brush_score IS NOT NULL
LIMIT 5;

-- routineが設定されているユーザー
SELECT email, routine 
FROM users 
WHERE routine IS NOT NULL
LIMIT 5;

-- migrated/migrated_versionをチェック（触ってないことを確認）
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN migrated = true THEN 1 END) as migrated_count,
  COUNT(CASE WHEN migrated_version IS NOT NULL THEN 1 END) as version_count
FROM users;
```

---

**最終更新**: 2025-10-25  
**バージョン**: 1.0.0

