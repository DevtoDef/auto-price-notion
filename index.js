import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const notionToken = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

const notion = new Client({ auth: notionToken });

async function getAllPrices() {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) throw new Error(`Binance API error: ${res.statusText}`);
    const data = await res.json();

    // Map lại thành object { BTCUSDT: 67200, ETHUSDT: 3200, ... }
    const priceMap = {};
    for (let item of data) {
      priceMap[item.symbol] = parseFloat(item.price);
    }
    return priceMap;
  } catch (e) {
    console.error(`❌ Không lấy được dữ liệu từ Binance: ${e.message}`);
    return {};
  }
}

async function main() {
  const response = await notion.databases.query({ database_id: databaseId });
  const pages = response.results;

  const priceMap = await getAllPrices();

  for (let page of pages) {
    const ticker = page.properties["Ticker"]?.rich_text?.[0]?.plain_text?.toUpperCase();
    if (!ticker) {
      console.log(`⚠️ Page ${page.id} chưa có Ticker, bỏ qua.`);
      continue;
    }

    const symbol = `${ticker}USDT`;
    const price = priceMap[symbol];

    if (price) {
      await notion.pages.update({
        page_id: page.id,
        properties: {
          "Current Price": { number: price },
        },
      });
      console.log(`✅ Updated ${ticker} (${symbol}) with price ${price}`);
    } else {
      console.log(`⚠️ Không tìm thấy giá cho ${ticker} (${symbol})`);
    }
  }
}

// Chạy ngay và lặp lại mỗi 5 phút với random jitter
async function scheduleNext() {
  await main();
  const jitter = Math.floor(Math.random() * 30 * 1000); // lệch ngẫu nhiên 0-30s
  setTimeout(scheduleNext, 5 * 60 * 1000 + jitter);
}

scheduleNext();
