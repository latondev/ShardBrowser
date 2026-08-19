/**
 * Kịch bản tự động: Tạo Profile ngẫu nhiên -> Mở ShardX -> Thử đăng ký tài khoản GitHub
 * ===================================================================================
 * Chạy bằng lệnh: node Testing/test_github_register.js
 */

import axios from "axios";
import puppeteer from "puppeteer-core";

const LAUNCHER_API_URL = "http://127.0.0.1:40325";
const API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaGFyZHgtYXBpIiwiaWF0IjoxNzg3MTI4NjE5LCJleHAiOjIxMDI0ODg2MTl9.Y44-0maSpd_9e7_U3yLPHgvFb1O2_GBHReb6qs0H2p0";

const headers = { Authorization: `Bearer ${API_TOKEN}` };

// Hàm tạo chuỗi ngẫu nhiên (email, username, password)
function generateRandomData() {
  const timestamp = Date.now().toString().slice(-6);
  const randomStr = Math.random().toString(36).substring(2, 6);
  return {
    email: `test_user_${timestamp}_${randomStr}@gmail.com`,
    password: `ShardX@${timestamp}#Pass`,
    username: `dev-user-${timestamp}-${randomStr}`,
  };
}

// Hàm gõ phím mô phỏng người dùng thật (human-like typing) có retry chống Execution context destroyed
async function humanType(page, selector, text, delayMs = 120) {
  let attempts = 0;
  while (attempts < 5) {
    try {
      await page.waitForSelector(selector, { visible: true, timeout: 10000 });
      await page.click(selector);
      for (const char of text) {
        await page.keyboard.type(char, { delay: Math.floor(Math.random() * 40) + delayMs });
      }
      return;
    } catch (err) {
      attempts++;
      if (attempts >= 5) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main() {
  console.log("==================================================");
  console.log("   BẮT ĐẦU KỊCH BẢN TEST: ĐĂNG KÝ GITHUB RANDOM   ");
  console.log("==================================================");

  let profileId = null;

  try {
    // 1. Lấy cấu hình Fingerprint ngẫu nhiên từ Launcher (VD: Windows / macOS / Linux)
    console.log("\n[1] Đang tạo Fingerprint ngẫu nhiên...");
    const { data: fpRes } = await axios.get(`${LAUNCHER_API_URL}/fingerprint/new`, { headers });
    const fingerprint = fpRes.fingerprint;

    const randomName = `GitHub-Bot-${Date.now().toString().slice(-4)}`;
    console.log(`-> Đã sinh cấu hình: OS=${fingerprint.navigator?.platform}, GPU=${fingerprint.webgl?.renderer}`);

    // 2. Tạo một Profile mới với Fingerprint này
    console.log(`\n[2] Đang lưu profile mới '${randomName}' vào ShardX Launcher...`);
    const { data: createdProfile } = await axios.post(
      `${LAUNCHER_API_URL}/profiles`,
      {
        name: randomName,
        notes: "Tự động tạo để test đăng ký GitHub",
        fingerprint: fingerprint,
      },
      { headers }
    );

    profileId = createdProfile.id;
    console.log(`-> Tạo thành công Profile ID: ${profileId}`);

    // 3. Khởi chạy Profile và lấy WebSocket CDP
    console.log("\n[3] Đang khởi chạy Profile với kết nối CDP...");
    const { data: startRes } = await axios.post(
      `${LAUNCHER_API_URL}/profiles/${profileId}/start`,
      { headless: false },
      { headers }
    );

    const wsEndpoint = startRes.cdp?.web_socket_debugger_url;
    if (!wsEndpoint) {
      throw new Error(`Không lấy được CDP WebSocket URL: ${JSON.stringify(startRes)}`);
    }
    console.log(`-> Đã kết nối engine CDP: ${wsEndpoint}`);

    // 4. Kết nối Puppeteer vào trình duyệt
    console.log("\n[4] Đang gắn Puppeteer vào cửa sổ trình duyệt...");
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint,
      defaultViewport: null,
    });

    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    // 5. Điều hướng tới trang đăng ký GitHub
    console.log("\n[5] Đang mở trang https://github.com/signup...");
    await page.goto("https://github.com/signup", { waitUntil: "networkidle2" });

    const pageTitle = await page.title();
    console.log(`-> Tiêu đề trang: "${pageTitle}"`);

    // 6. Tạo dữ liệu giả lập và điền vào form đăng ký
    const mockData = generateRandomData();
    console.log("\n[6] Đang điền dữ liệu đăng ký tự động:");
    console.log(`    - Email    : ${mockData.email}`);
    console.log(`    - Password : ${mockData.password}`);
    console.log(`    - Username : ${mockData.username}`);

    // Đợi ô nhập Email xuất hiện
    console.log("\n[7] Đang nhập Email...");
    await humanType(page, "input#email, input[type='email']", mockData.email);
    await new Promise((r) => setTimeout(r, 1000));

    // Bấm nút Continue của bước Email nếu có
    const continueBtn1 = await page.$("button[data-continue-to='password-container']");
    if (continueBtn1) {
      await continueBtn1.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // Đợi ô nhập Password xuất hiện
    console.log("[8] Đang nhập Password...");
    await new Promise((r) => setTimeout(r, 1500));
    const passInput = await page.$("input#password, input[type='password']");
    if (passInput) {
      await humanType(page, "input#password, input[type='password']", mockData.password);
      await new Promise((r) => setTimeout(r, 1000));

      const continueBtn2 = await page.$("button[data-continue-to='username-container']");
      if (continueBtn2) {
        await continueBtn2.click();
      } else {
        await page.keyboard.press("Enter");
      }
    }

    // Đợi ô nhập Username xuất hiện
    console.log("[9] Đang nhập Username...");
    await new Promise((r) => setTimeout(r, 1500));
    const userInput = await page.$("input#login, input[name='user[login]']");
    if (userInput) {
      await humanType(page, "input#login, input[name='user[login]']", mockData.username);
      await new Promise((r) => setTimeout(r, 1000));

      const continueBtn3 = await page.$("button[data-continue-to='opt-in-container']");
      if (continueBtn3) {
        await continueBtn3.click();
      } else {
        await page.keyboard.press("Enter");
      }
    }

    console.log("\n==================================================");
    console.log("-> Đã điền xong các bước cơ bản!");
    console.log("-> Giữ trình duyệt 20 giây để bạn quan sát.");
    console.log("==================================================");
    await new Promise((r) => setTimeout(r, 20000));

    // 7. Đóng profile
    console.log("\n[10] Đang dừng profile...");
    await axios.post(`${LAUNCHER_API_URL}/profiles/${profileId}/stop`, {}, { headers });
    console.log("-> Đã hoàn thành kịch bản!");
  } catch (error) {
    console.error("\n(!) Đã xảy ra lỗi trong quá trình chạy:", error.message);
  }
}

main();
