import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const notionToken = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

const notion = new Client({
  auth: notionToken
});

// Hàm tiện ích để tạo độ trễ
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getPrice(symbol) {
  try {
    // ✅ [CẢI TIẾN 1] Thêm User-Agent để giả lập trình duyệt
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
        }
    });

    if (!res.ok) {
        if (res.status === 429) {
            console.error(`❌ Bị giới hạn tốc độ (Rate Limited) khi lấy giá cho ${symbol}. Thử tăng độ trễ.`);
        }
        throw new Error(`Binance API error: ${res.statusText}`);
    }
    const data = await res.json();
    return parseFloat(data.price);
  } catch (e) {
    console.error(`❌ Không lấy được giá cho ${symbol}: ${e.message}`);
    return null;
  }
}

async function main() {
  const response = await notion.databases.query({ database_id: databaseId });
  const pages = response.results;
  console.log(`🔎 Tìm thấy ${pages.length} trang để cập nhật.`);

  for (const page of pages) {
    const ticker = page.properties["Ticker"]?.rich_text?.[0]?.plain_text?.toUpperCase();
    if (!ticker) {
      console.log(`⚠️ Page ${page.id} chưa có Ticker, bỏ qua.`);
      continue;
    }

    const symbol = `${ticker}USDT`;
    const price = await getPrice(symbol);

    if (price !== null) {
      await notion.pages.update({
        page_id: page.id,
        properties: {
          "Current Price": { number: price }
        }
      });
      console.log(`✅ Cập nhật ${ticker} (${symbol}) với giá ${price}`);
    } else {
      console.log(`⚠️ Không cập nhật được giá cho ${ticker} (${symbol})`);
    }

    // ✅ [CẢI TIẾN 2] Thêm độ trễ giữa các request
    await delay(300); // Chờ 0.3 giây
  }
}

// ✅ [CẢI TIẾN 3] Sử dụng setTimeout đệ quy để chạy ổn định hơn
async function run() {
    try {
        console.log(`\n🚀 Bắt đầu chu trình cập nhật giá lúc ${new Date().toLocaleTimeString()}`);
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
