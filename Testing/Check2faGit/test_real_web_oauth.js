import puppeteer from "puppeteer-core";
import { TotpEngine } from "./totp_engine.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkAccount(email, pass, secret) {
  const totp = new TotpEngine();
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: false,
    defaultViewport: null,
    args: ["--no-sandbox", "--window-size=1280,800"],
  });

  const page = await browser.newPage();

  console.log(`\n==================================================`);
  console.log(`Bắt đầu test tài khoản: ${email}`);
  console.log(`==================================================`);

  // 1. Mở thẳng trang đăng nhập của Supabase
  console.log("1. Mở trang đăng nhập bên thứ 3 (Supabase)...");
  await page.goto("https://supabase.com/dashboard/sign-in", { waitUntil: "networkidle2" });
  await sleep(1500);

  // 2. Bấm nút Continue with GitHub
  console.log("2. Bấm nút 'Continue with GitHub'...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, a"));
    for (const b of btns) {
      if ((b.innerText || "").toLowerCase().includes("github")) {
        b.click();
        return true;
      }
    }
    return false;
  });

  await sleep(3500);
  console.log("URL trang GitHub:", page.url());

  // 3. Đăng nhập
  await page.type("#login_field", email, { delay: 25 });
  await page.type("#password", pass, { delay: 25 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);
  await sleep(2000);

  // 4. Nhập 2FA TOTP
  if (page.url().includes("two-factor")) {
    const code = totp.generateCode(secret);
    console.log("-> Nhập mã TOTP 6 số:", code);
    const otpInput = await page.waitForSelector('input[name="otp"], input[autocomplete="one-time-code"], #app_totp');
    await otpInput.type(code, { delay: 30 });
    await sleep(500);
    await page.keyboard.press("Enter");
    await sleep(5000);
  }

  // 5. Kiểm tra kết quả
  const finalUrl = page.url();
  const bodyText = await page.evaluate(() => document.body?.innerText || "");

  console.log("-> URL kết quả:", finalUrl);
  const isFlagged = finalUrl.includes("github.com/dashboard") || bodyText.includes("This account is flagged");

  if (isFlagged) {
    console.log("❌ KẾT QUẢ: BỊ FLAGGED (This account is flagged, and therefore cannot authorize a third party application)");
  } else {
    console.log("✅ KẾT QUẢ: TÀI KHOẢN SẠCH (Ủy quyền thành công sang bên thứ 3!)");
  }

  await sleep(5000);
  await browser.close();
}

async function main() {
  // Test tài khoản 2
  await checkAccount("le.st.er.bi.gsan.t.os@gmail.com", "ShardX@2026!Pass#6243", "MVWLVIEUICYRSU5J");
}

main().catch(console.error);
