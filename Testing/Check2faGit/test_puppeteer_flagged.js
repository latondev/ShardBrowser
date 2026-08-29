import puppeteer from "puppeteer-core";
import { TotpEngine } from "./totp_engine.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const totp = new TotpEngine();
  const email = "el.la.m.ed.arate.n@gmail.com";
  const pass = "ShardX@2026!Pass#4071";
  const secret = "YU6TMLEKHTIWSJUP";

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: false,
    defaultViewport: null,
    args: ["--no-sandbox", "--window-size=1280,800"],
  });

  const page = await browser.newPage();

  console.log("1. Đang mở trang login...");
  await page.goto("https://github.com/login", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  await page.type("#login_field", email, { delay: 30 });
  await page.type("#password", pass, { delay: 30 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click('input[type="submit"]'),
  ]);
  await sleep(2500);

  console.log("2. Đang nhập mã 2FA TOTP...");
  const code = totp.generateCode(secret);
  console.log("TOTP code:", code);

  const otpInput = await page.waitForSelector('input[name="otp"], input[autocomplete="one-time-code"], #app_totp');
  await otpInput.type(code, { delay: 40 });
  await sleep(3000);

  console.log("URL sau đăng nhập:", page.url());

  console.log("\n3. Đang mở Dashboard kiểm tra thông báo...");
  await page.goto("https://github.com/dashboard", { waitUntil: "domcontentloaded" });
  await sleep(2000);

  const dashText = await page.evaluate(() => document.body?.innerText || "");
  console.log("-> Dashboard text chứa 'This account is flagged':", dashText.includes("This account is flagged"));

  console.log("\n4. Đang mở OAuth Authorize TokenBay / Supabase...");
  // Thử mở trang authorize OAuth của ứng dụng bên thứ 3
  await page.goto("https://github.com/login/oauth/authorize?client_id=327a3c3e2182283ccb8e&scope=user:email", { waitUntil: "domcontentloaded" });
  await sleep(3000);

  console.log("-> URL OAuth hiện tại:", page.url());
  let oauthText = await page.evaluate(() => document.body?.innerText || "");
  console.log("-> OAuth text chứa 'This account is flagged':", oauthText.includes("This account is flagged"));

  console.log("\n5. Thử bấm nút Authorize trên trang...");
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('button[name="authorize"], #js-oauth-authorize-btn');
    if (btn) {
      btn.click();
      return true;
    }
    const btns = Array.from(document.querySelectorAll("button, input[type='submit']"));
    for (const b of btns) {
      if ((b.innerText || b.value || "").toLowerCase().includes("authorize")) {
        b.click();
        return true;
      }
    }
    return false;
  });

  console.log("-> Đã bấm nút Authorize:", clicked);
  await sleep(4000);

  console.log("-> URL sau khi bấm Authorize:", page.url());
  const postAuthText = await page.evaluate(() => document.body?.innerText || "");
  console.log("-> Text sau Authorize chứa 'This account is flagged':", postAuthText.includes("This account is flagged"));

  // In ra các thông báo banner nếu có
  const banners = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.flash, [role="alert"], .banner, .flash-warn, .flash-error')).map(el => el.innerText.trim()).filter(Boolean);
  });
  console.log("-> Các thông báo banner trên trang:", banners);

  await sleep(15000);
  await browser.close();
}

main().catch(console.error);
