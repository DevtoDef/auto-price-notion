import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { HttpsProxyAgent } from "https-proxy-agent";

// Tải các biến môi trường từ file .env
dotenv.config();

// --- CẤU HÌNH ---
const notionToken = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;
const proxyUrl = process.env.PROXY_URL; // Lấy URL của proxy từ biến môi trường

// Kiểm tra các biến môi trường cần thiết
if (!notionToken || !databaseId) {
  throw new Error("Vui lòng cung cấp NOTION_TOKEN và NOTION_DATABASE_ID trong file .env hoặc GitHub Secrets.");
}

// --- KHỞI TẠO ---
const notion = new Client({ auth: notionToken });

// Chỉ khởi tạo proxy agent nếu PROXY_URL được cung cấp
// Ghi chú: Khi chạy local mà không cần proxy, chỉ cần không đặt biến PROXY_URL
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;
if (proxyUrl) {
    console.log("💡 Đang sử dụng proxy để gửi yêu cầu.");
} else {
    console.log("💡 Không sử dụng proxy.");
}


// --- CÁC HÀM CHỨC NĂNG ---

/**
 * Hàm tiện ích để tạo độ trễ giữa các yêu cầu.
 * @param {number} ms - Thời gian chờ tính bằng mili giây.
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Lấy giá của một mã ticker từ API Binance.
 * @param {string} symbol - Tên biểu tượng (ví dụ: BTCUSDT).
 * @returns {Promise<number|null>} - Trả về giá hoặc null nếu có lỗi.
 */
async function getPrice(symbol) {
  try {
    const fetchOptions = {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      }
    };

    // Thêm proxy agent vào yêu cầu nếu nó đã được cấu hình
    if (agent) {
      fetchOptions.agent = agent;
    }

    const res = await fetch(`https://api.binance.com/api/v1/ticker/price?symbol=${symbol}`, fetchOptions);

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`❌ Lỗi từ API Binance cho ${symbol}. Status: ${res.status}`);
      console.error(`❌ Nội dung lỗi: ${errorBody}`);
      return null;
    }

    const data = await res.json();
    return parseFloat(data.price);
  } catch (e) {
    console.error(`❌ Đã xảy ra lỗi kết nối khi fetch giá cho ${symbol}:`, e.message);
    return null;
  }
}

/**
 * Hàm chính để quét database Notion và cập nhật giá.
 */
async function main() {
  const response = await notion.databases.query({ database_id: databaseId });
  const pages = response.results;
  console.log(`🔎 Tìm thấy ${pages.length} trang để cập nhật.`);

  for (const page of pages) {
    const tickerProperty = page.properties["Ticker"];
    const ticker = tickerProperty?.rich_text?.[0]?.plain_text?.toUpperCase();

    if (!ticker) {
      console.log(`⚠️ Page ${page.id} chưa có Ticker, bỏ qua.`);
      continue;
    }

    const symbol = `${ticker}USDT`;
    const price = await getPrice(symbol);

    if (price !== null) {
      await notion.pages.update({
        page_id: page.id,
        properties: { "Current Price": { number: price } }
      });
      console.log(`✅ Cập nhật ${ticker} (${symbol}) với giá ${price}`);
    } else {
      console.log(`⚠️ Không cập nhật được giá cho ${ticker} (${symbol})`);
    }

    // Thêm độ trễ 500ms để tránh bị rate limit và hoạt động "giống người" hơn
    await delay(500);
  }
}

/**
 * Hàm điều khiển vòng lặp, chạy `main` và lên lịch chạy lại.
 */
async function run() {
  try {
    console.log(`\n🚀 Bắt đầu chu trình cập nhật giá lúc ${new Date().toLocaleString('vi-VN')}`);
    await main();
    console.log("✨ Chu trình hoàn tất.");
  } catch (error) {
    console.error("❌ Đã xảy ra lỗi nghiêm trọng trong chu trình chính:", error);
  } finally {
    const fiveMinutes = 5 * 60 * 1000;
    console.log(`--- Chờ 5 phút cho lần chạy tiếp theo... ---`);
    setTimeout(run, fiveMinutes);
  }
}

// Bắt đầu chạy ngay lần đầu tiên
run();
