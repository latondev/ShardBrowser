import puppeteer from "puppeteer-core";
import { TotpEngine } from "./totp_engine.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkAccountFlagged(browser, email, pass, secret) {
  const totp = new TotpEngine();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  try {
    console.log(`\n==================================================`);
    console.log(`Đang kiểm tra: ${email}`);
    console.log(`==================================================`);

    // Dùng OAuth URL thực tế của TokenBay hoặc OAuth App
    // URL OAuth tiêu chuẩn
    const oauthUrl = "https://github.com/login/oauth/authorize?client_id=327a3c3e2182283ccb8e&scope=user:email";
    const loginOAuthUrl = `https://github.com/login?return_to=${encodeURIComponent("/login/oauth/authorize?client_id=327a3c3e2182283ccb8e&scope=user:email")}`;

    console.log("1. Mở trang đăng nhập qua luồng OAuth...");
    await page.goto(loginOAuthUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(1500);

    // Điền thông tin
    await page.type("#login_field", email, { delay: 20 });
    await page.type("#password", pass, { delay: 20 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
      page.click('input[type="submit"], button[type="submit"]'),
    ]);
    await sleep(2500);

    // Kiểm tra xem có đòi 2FA TOTP không
    const pageText = await page.evaluate(() => document.body?.innerText || "");
    const currentUrl = page.url();

    if (currentUrl.includes("verified-device") || pageText.includes("Device verification") || pageText.includes("sent a verification code")) {
      console.log("⚠️ TRẠNG THÁI: CHƯA BẬT 2FA (ĐÒI MÃ EMAIL) -> BỎ QUA");
      return { status: "EMAIL_CODE_REQUIRED", email };
    }

    if (pageText.includes("Incorrect username or password") || (currentUrl.includes("/login") && !currentUrl.includes("two-factor"))) {
      console.log("❌ TRẠNG THÁI: SAI MẬT KHẨU HOẶC BỊ KHÓA");
      return { status: "WRONG_PASSWORD", email };
    }

    if (!currentUrl.includes("two-factor") && !pageText.includes("Two-factor") && !pageText.includes("authenticator")) {
      console.log("⚠️ TRẠNG THÁI: KHÔNG PHẢI MÀN HÌNH 2FA");
      return { status: "NO_2FA", email };
    }

    console.log("2. Đã vào màn hình 2FA! Đang sinh mã TOTP 6 số...");
    const otpCode = totp.generateCode(secret);
    console.log(`-> Mã TOTP: [ ${otpCode} ]`);

    // Điền mã TOTP
    const otpEl = await page.waitForSelector('input[name="otp"], input[autocomplete="one-time-code"], #app_totp, input[id*="otp"]', { timeout: 10000 }).catch(() => null);
    if (otpEl) {
      await otpEl.type(otpCode, { delay: 30 });
      await sleep(1000);
      await page.keyboard.press("Enter");
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await sleep(3000);
    }

    // 3. KIỂM TRA TRẠNG THÁI SAU KHI ĐĂNG NHẬP OAUTH
    const finalUrl = page.url();
    const finalBodyText = await page.evaluate(() => document.body?.innerText || "");
    console.log("-> URL sau khi login:", finalUrl);

    // Kiểm tra lỗi flagged
    const isFlagged = finalUrl.includes("/dashboard") ||
                      finalBodyText.includes("This account is flagged") ||
                      finalBodyText.includes("cannot authorize a third party application") ||
                      finalBodyText.includes("Your account has been flagged");

    if (isFlagged) {
      console.log("🔥 KẾT QUẢ: ❌ TÀI KHOẢN BỊ FLAGGED (BỊ GẮN CỜ CHẶN ỨNG DỤNG BÊN THỨ 3)!");
      return { status: "FLAGGED", email, secret, url: finalUrl };
    } else {
      console.log("🎉 KẾT QUẢ: ✅ TÀI KHOẢN SẠCH (LIVE GOOD - 2FA OK - KHÔNG BỊ FLAGGED)!");
      return { status: "LIVE_GOOD", email, secret, url: finalUrl };
    }

  } catch (err) {
    console.error(`Lỗi: ${err.message}`);
    return { status: "ERROR", email, error: err.message };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: false,
    defaultViewport: null,
    args: ["--no-sandbox", "--window-size=1280,800"],
  });

  try {
    // Test tài khoản 1 (trong ảnh của user)
    await checkAccountFlagged(browser, "el.la.m.ed.arate.n@gmail.com", "ShardX@2026!Pass#4071", "YU6TMLEKHTIWSJUP");

    // Test tài khoản 2
    await checkAccountFlagged(browser, "le.st.er.bi.gsan.t.os@gmail.com", "ShardX@2026!Pass#6243", "MVWLVIEUICYRSU5J");
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
