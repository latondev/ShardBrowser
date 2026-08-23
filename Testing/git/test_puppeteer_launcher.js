/**
 * Hướng dẫn điều khiển ShardX Browser qua Node.js + Puppeteer / Playwright
 * =======================================================================
 * 1. Cài đặt thư viện:
 *    npm install puppeteer-core axios
 * 
 * 2. Chạy file:
 *    node test_puppeteer_launcher.js
 */

import axios from "axios";
import puppeteer from "puppeteer-core";

const LAUNCHER_API_URL = "http://127.0.0.1:40325";
const API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaGFyZHgtYXBpIiwiaWF0IjoxNzg3MTI4NjE5LCJleHAiOjIxMDI0ODg2MTl9.Y44-0maSpd_9e7_U3yLPHgvFb1O2_GBHReb6qs0H2p0";

async function main() {
  const headers = { Authorization: `Bearer ${API_TOKEN}` };

  console.log("[1] Đang lấy danh sách profile...");
  try {
    const { data: profiles } = await axios.get(`${LAUNCHER_API_URL}/profiles`, { headers });
    if (!profiles || profiles.length === 0) {
      console.log("(!) Không tìm thấy profile nào. Hãy tạo profile trong ShardX Launcher.");
      return;
    }

    const targetProfile = profiles[0];
    console.log(`[2] Khởi chạy profile '${targetProfile.name}' (ID: ${targetProfile.id})...`);

    const { data: startResult } = await axios.post(
      `${LAUNCHER_API_URL}/profiles/${targetProfile.id}/start`,
      { headless: false },
      { headers }
    );

    const wsEndpoint = startResult.cdp?.web_socket_debugger_url;
    if (!wsEndpoint) {
      console.log("(!) Không nhận được CDP WebSocket URL:", startResult);
      return;
    }

    console.log(`-> Kết nối CDP: ${wsEndpoint}`);

    // Kết nối Puppeteer vào trình duyệt đang mở
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint,
      defaultViewport: null,
    });

    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    console.log("[3] Đang điều hướng đến trang kiểm tra...");
    await page.goto("https://browserleaks.com/javascript", { waitUntil: "domcontentloaded" });

    const title = await page.title();
    console.log(`-> Tiêu đề trang: ${title}`);

    // Lấy thông tin fingerprint
    const fpInfo = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      cores: navigator.hardwareConcurrency,
      memory: navigator.deviceMemory,
    }));

    console.log("--- Thông số nhận diện trên trang ---");
    console.log(fpInfo);
    console.log("--------------------------------------");

    console.log("[4] Chờ 10 giây trước khi dừng...");
    await new Promise((r) => setTimeout(r, 10000));

    // Đóng profile qua API
    await axios.post(`${LAUNCHER_API_URL}/profiles/${targetProfile.id}/stop`, {}, { headers });
    console.log("-> Đã đóng profile thành công.");
  } catch (err) {
    console.error("(!) Lỗi:", err.message);
  }
}

main();
