/**
 * Shopify to Supabase User Migration - Quick Start Example
 * 
 * このファイルは、最小限のコードでマイグレーション機能を実装する例です。
 * 本番環境では、エラーハンドリングやログ機能を追加してください。
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// ========================================
// 設定
// ========================================
const CONFIG = {
  // Shopify設定
  shopify: {
    store: 'your-store.myshopify.com',
    accessToken: 'shpat_xxxxxxxxxxxxx',
    apiVersion: '2024-10'
  },
  
  // Supabase設定（⚠️ service_roleキーを使用）
  supabase: {
    url: 'https://your-project.supabase.co',
    serviceRoleKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  },
  
  // 処理設定
  batchSize: 50,  // バッチサイズ（50件推奨）
  rateLimit: 500  // リクエスト間隔（ミリ秒）2リクエスト/秒 = 500ms
};

// ========================================
// クライアント初期化
// ========================================
const supabase = createClient(
  CONFIG.supabase.url,
  CONFIG.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// ========================================
// ユーティリティ関数
// ========================================

/**
 * レート制限を考慮した待機
 */
async function wait(ms = CONFIG.rateLimit) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Shopify APIリクエスト
 */
async function shopifyRequest(path) {
  await wait();
  
  const url = `https://${CONFIG.shopify.store}/admin/api/${CONFIG.shopify.apiVersion}${path}`;
  const response = await axios.get(url, {
    headers: {
      'X-Shopify-Access-Token': CONFIG.shopify.accessToken,
      'Content-Type': 'application/json'
    }
  });
  
  return response;
}

// ========================================
// メイン処理
// ========================================

/**
 * 全顧客を取得（ページネーション対応）
 */
async function getAllCustomers() {
  console.log('📥 顧客データを取得中...');
  
  const customers = [];
  let pageInfo = null;
  let pageNum = 1;
  
  do {
    // URLの構築
    const path = pageInfo
      ? `/customers.json?limit=250&page_info=${pageInfo}`
      : `/customers.json?limit=250`;
    
    // リクエスト実行
    const response = await shopifyRequest(path);
    const data = response.data.customers;
    customers.push(...data);
    
    console.log(`  ページ ${pageNum}: ${data.length}件取得 (累計: ${customers.length}件)`);
    
    // 次ページのpage_infoを取得
    const linkHeader = response.headers.link || '';
    if (linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/page_info=([^&>]+)/);
      pageInfo = match ? match[1] : null;
      pageNum++;
    } else {
      pageInfo = null;
    }
  } while (pageInfo);
  
  console.log(`✅ 合計 ${customers.length}件の顧客を取得しました\n`);
  return customers;
}

/**
 * 顧客のメタフィールドを取得
 */
async function getCustomerMetafields(customerId) {
  const response = await shopifyRequest(`/customers/${customerId}/metafields.json`);
  return response.data.metafields;
}

/**
 * ShopifyデータをSupabase形式に変換
 * 
 * ⚠️ 重要な変換ルール:
 * - Shopify: dental_analysis → Supabase: brush_score
 * - Shopify: point（単数） → Supabase: points（複数）
 */
function convertToSupabase(customer, metafields) {
  // 初期値
  let routine = null;
  let brushScore = null;  // ⚠️ dental_analysis → brush_score
  let points = 0;         // ⚠️ point → points
  
  // メタフィールドから抽出
  for (const mf of metafields) {
    // custom名前空間のみ処理
    if (mf.namespace !== 'custom') continue;
    
    try {
      switch (mf.key) {
        case 'routine':
          // JSONパース
          routine = JSON.parse(mf.value);
          break;
          
        case 'dental_analysis':  // ⚠️ Shopifyでは dental_analysis
          // JSONパース → brush_scoreに保存
          brushScore = JSON.parse(mf.value);
          break;
          
        case 'point':  // ⚠️ Shopifyでは point（単数形）
          // 数値変換 → pointsに保存
          points = typeof mf.value === 'number'
            ? mf.value
            : parseInt(mf.value, 10) || 0;
          break;
      }
    } catch (error) {
      console.warn(`  ⚠️ パースエラー: ${customer.email}, ${mf.key}`);
    }
  }
  
  // Supabase用のデータ構造
  return {
    email: customer.email,
    points: points,                          // ⚠️ points（複数形）
    shopify_user_id: customer.id.toString(),
    routine: routine,
    brush_score: brushScore,                 // ⚠️ brush_score（名前変更）
    shopify_meta_data: customer              // 完全なShopifyデータを保存
    
    // ⚠️ 重要: 以下のカラムは絶対に含めない（他システムで使用中）
    // migrated: false,
    // migrated_version: '1.0.0'
  };
}

/**
 * Supabaseにバッチ登録
 */
async function upsertToSupabase(usersData) {
  console.log(`💾 Supabaseに登録中... (${usersData.length}件)`);
  
  for (let i = 0; i < usersData.length; i += CONFIG.batchSize) {
    const batch = usersData.slice(i, i + CONFIG.batchSize);
    const batchNum = Math.floor(i / CONFIG.batchSize) + 1;
    const totalBatches = Math.ceil(usersData.length / CONFIG.batchSize);
    
    console.log(`  バッチ ${batchNum}/${totalBatches}: ${batch.length}件処理中...`);
    
    const { error } = await supabase
      .from('users')
      .upsert(batch, {
        onConflict: 'email',      // emailで競合判定
        ignoreDuplicates: false   // 既存データは更新
      });
    
    if (error) {
      console.error(`  ❌ エラー発生:`, error);
      throw error;
    }
    
    console.log(`  ✅ 完了 (累計: ${Math.min(i + CONFIG.batchSize, usersData.length)}/${usersData.length})`);
  }
  
  console.log(`✅ 全${usersData.length}件の登録が完了しました\n`);
}

/**
 * メインのマイグレーション処理
 */
async function migrate() {
  console.log('🚀 Shopify → Supabase マイグレーション開始\n');
  console.log('='.repeat(60));
  
  const startTime = Date.now();
  
  try {
    // ステップ1: 全顧客を取得
    const customers = await getAllCustomers();
    
    // ステップ2: 各顧客のメタフィールドを取得 & 変換
    console.log('🔄 メタフィールドを取得中...');
    const usersData = [];
    
    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];
      
      // 進捗表示（10件ごと）
      if ((i + 1) % 10 === 0 || i === customers.length - 1) {
        console.log(`  進捗: ${i + 1}/${customers.length}件`);
      }
      
      // メタフィールド取得
      const metafields = await getCustomerMetafields(customer.id);
      
      // データ変換
      const userData = convertToSupabase(customer, metafields);
      usersData.push(userData);
    }
    
    console.log(`✅ ${usersData.length}件のデータを変換しました\n`);
    
    // ステップ3: Supabaseに登録
    await upsertToSupabase(usersData);
    
    // 完了
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('='.repeat(60));
    console.log(`🎉 マイグレーション完了！`);
    console.log(`   処理時間: ${duration}秒`);
    console.log(`   総件数: ${usersData.length}件`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ エラーが発生しました:', error.message);
    throw error;
  }
}

// ========================================
// 実行
// ========================================
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('\n✅ 正常終了');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ 異常終了:', error);
      process.exit(1);
    });
}

// ========================================
// エクスポート（モジュールとして使用する場合）
// ========================================
module.exports = {
  migrate,
  getAllCustomers,
  getCustomerMetafields,
  convertToSupabase,
  upsertToSupabase
};

