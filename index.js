import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import fetch from "node-fetch";


dotenv.config(); // Đảm bảo đã cài package dotenv để sử dụng biến môi trường

const notionToken = process.env.NOTION_TOKEN;   // API key lấy ở bước 1
const databaseId = process.env.NOTION_DATABASE_ID;  // API database ID
console.log(notionToken);
console.log(databaseId);

const notion = new Client({
  auth: notionToken
});

async function getPrice(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) throw new Error(`Binance API error: ${res.statusText}`);
    const data = await res.json();
    return parseFloat(data.price);
  } catch (e) {
    console.log(symbol);
    console.error(`❌ Không lấy được giá cho ${symbol}: ${e.message}`);
    return null;
  }
}

async function main() {
  const response = await notion.databases.query({ database_id: databaseId });
  const pages = response.results;

  for (let page of pages) {
    const ticker = page.properties["Ticker"]?.rich_text?.[0]?.plain_text?.toUpperCase();
    if (!ticker) {
      console.log(`⚠️ Page ${page.id} chưa có Ticker, bỏ qua.`);
      continue;
    }

    const symbol = `${ticker}USDT`;
    const price = await getPrice(symbol);

    if (price) {
      await notion.pages.update({
        page_id: page.id,
        properties: {
          "Current Price": { number: price }
        }
      });
      console.log(`✅ Updated ${ticker} (${symbol}) with price ${price}`);
    } else {
      console.log(ticker);
      console.log(`⚠️ Không tìm thấy giá cho ${ticker} (${symbol})`);
    }
  }
}

// Chạy ngay và lặp lại mỗi 5 phút
main();
setInterval(main, 5 * 60 * 1000);
