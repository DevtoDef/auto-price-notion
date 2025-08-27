import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import fetch from "node-fetch"; // Thêm node-fetch để tương thích

// Tải các biến môi trường từ file .env
dotenv.config();

// --- CẤU HÌNH ---
const notionToken = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

// Kiểm tra các biến môi trường cần thiết
if (!notionToken || !databaseId) {
  console.error("❌ Thiếu biến môi trường cần thiết:");
  console.error("- NOTION_TOKEN:", notionToken ? "✅" : "❌");
  console.error("- NOTION_DATABASE_ID:", databaseId ? "✅" : "❌");
  process.exit(1);
}

// --- KHỞI TẠO ---
const notion = new Client({ auth: notionToken });

// --- CÁC HÀM CHỨC NĂNG ---

/**
 * Hàm tiện ích để tạo độ trễ giữa các yêu cầu.
 * @param {number} ms - Thời gian chờ tính bằng mili giây.
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Lấy giá của một mã ticker từ API Binance với retry logic.
 * @param {string} symbol - Tên biểu tượng (ví dụ: BTCUSDT).
 * @param {number} retries - Số lần thử lại (mặc định: 3).
 * @returns {Promise<number|null>} - Trả về giá hoặc null nếu có lỗi.
 */
async function getPrice(symbol, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔄 Đang lấy giá ${symbol} (lần thử ${attempt}/${retries})`);
      
      const response = await fetch(`https://api.binance.com/api/v1/ticker/price?symbol=${symbol}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
        },
        timeout: 10000 // 10 giây timeout
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`❌ Lỗi API Binance cho ${symbol}. Status: ${response.status}, Body: ${errorBody}`);
        
        // Nếu là lỗi 4xx, không cần retry
        if (response.status >= 400 && response.status < 500) {
          return null;
        }
        
        // Nếu là lỗi 5xx, thử lại
        if (attempt < retries) {
          console.log(`⏳ Chờ ${attempt * 1000}ms trước khi thử lại...`);
          await delay(attempt * 1000);
          continue;
        }
        return null;
      }

      const data = await response.json();
      const price = parseFloat(data.price);
      
      if (isNaN(price)) {
        console.error(`❌ Giá không hợp lệ cho ${symbol}: ${data.price}`);
        return null;
      }
      
      return price;
    } catch (error) {
      console.error(`❌ Lỗi khi fetch giá ${symbol} (lần thử ${attempt}/${retries}):`, error.message);
      
      if (attempt < retries) {
        console.log(`⏳ Chờ ${attempt * 1000}ms trước khi thử lại...`);
        await delay(attempt * 1000);
      }
    }
  }
  
  return null;
}

/**
 * Cập nhật giá cho một page trong Notion.
 * @param {Object} page - Page object từ Notion.
 * @returns {Promise<boolean>} - Trả về true nếu thành công.
 */
async function updatePagePrice(page) {
  const tickerProperty = page.properties["Ticker"];
  const ticker = tickerProperty?.rich_text?.[0]?.plain_text?.trim()?.toUpperCase();

  if (!ticker) {
    console.log(`⚠️ Page ${page.id} không có Ticker, bỏ qua.`);
    return false;
  }

  const symbol = `${ticker}USDT`;
  console.log(`📊 Đang xử lý ${ticker}...`);
  
  const price = await getPrice(symbol);

  if (price !== null) {
    try {
      await notion.pages.update({
        page_id: page.id,
        properties: { 
          "Current Price": { number: price },
        }
      });
      console.log(`✅ Cập nhật thành công ${ticker}: $${price.toFixed(6)}`);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi khi cập nhật Notion cho ${ticker}:`, error.message);
      return false;
    }
  } else {
    console.log(`⚠️ Không thể lấy giá cho ${ticker} (${symbol})`);
    return false;
  }
}

/**
 * Hàm chính để quét database Notion và cập nhật giá.
 */
async function main() {
  try {
    console.log("🔍 Đang truy vấn Notion database...");
    const response = await notion.databases.query({ 
      database_id: databaseId,
      page_size: 100 // Giới hạn số lượng để tránh timeout
    });
    
    const pages = response.results;
    console.log(`📋 Tìm thấy ${pages.length} trang để xử lý.`);

    if (pages.length === 0) {
      console.log("ℹ️ Không có trang nào để cập nhật.");
      return { success: 0, failed: 0, skipped: 0 };
    }

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // Xử lý từng page một cách tuần tự để tránh rate limit
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      console.log(`\n--- Xử lý trang ${i + 1}/${pages.length} ---`);
      
      const result = await updatePagePrice(page);
      
      if (result === true) {
        successCount++;
      } else if (result === false) {
        const ticker = page.properties["Ticker"]?.rich_text?.[0]?.plain_text;
        if (ticker) {
          failedCount++;
        } else {
          skippedCount++;
        }
      }

      // Thêm delay giữa các request để tránh rate limit
      if (i < pages.length - 1) {
        console.log("⏳ Chờ 1 giây...");
        await delay(1000);
      }
    }

    const summary = { success: successCount, failed: failedCount, skipped: skippedCount };
    console.log(`\n📊 Tóm tắt: ${successCount} thành công, ${failedCount} thất bại, ${skippedCount} bỏ qua`);
    return summary;
    
  } catch (error) {
    console.error("❌ Lỗi trong hàm main:", error.message);
    throw error;
  }
}

/**
 * Hàm chạy một lần cho GitHub Actions.
 */
async function runOnce() {
  const startTime = new Date();
  console.log(`\n🚀 Bắt đầu cập nhật giá crypto lúc ${startTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
  console.log(`🌍 Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  
  try {
    const summary = await main();
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);
    
    console.log(`\n✨ Hoàn thành trong ${duration} giây`);
    console.log(`📈 Kết quả: ${summary.success} thành công, ${summary.failed} thất bại, ${summary.skipped} bỏ qua`);
    
    // Exit với code phù hợp
    if (summary.failed > 0) {
      console.log("⚠️ Có một số lỗi xảy ra, nhưng quá trình đã hoàn thành.");
      process.exit(0); // Vẫn exit thành công vì một số cập nhật đã thành công
    } else {
      console.log("🎉 Tất cả đều thành công!");
      process.exit(0);
    }
    
  } catch (error) {
    console.error("💥 Lỗi nghiêm trọng:", error);
    process.exit(1);
  }
}

// Kiểm tra môi trường và chạy
if (process.env.GITHUB_ACTIONS) {
  console.log("🤖 Đang chạy trên GitHub Actions");
  runOnce();
} else {
  console.log("💻 Đang chạy local - sử dụng chế độ một lần");
  runOnce();
}
