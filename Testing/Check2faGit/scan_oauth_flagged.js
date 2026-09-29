/**
 * TOOL QUÉT TÀI KHOẢN GITHUB BỊ DÍNH CỜ OAUTH (CHẠY QUA TRANG ĐĂNG NHẬP BÊN THỨ 3 THỰC TẾ)
 * ==============================================================================
 * Cơ chế hoạt động:
 * 1. Mở trang đăng nhập thực tế của bên thứ 3 (Supabase Dashboard / OAuth Partner).
 * 2. Bấm nút "Continue with GitHub" để khởi tạo phiên OAuth thực tế (đầy đủ state & redirect_uri).
 * 3. Tự động điền Email, Mật khẩu và sinh mã 2FA TOTP nội bộ (0ms).
 * 4. Bắt chính xác 100% kết quả:
 *    - BỊ FLAGGED: GitHub chặn và đẩy URL về https://github.com/dashboard (Kèm dải thông báo đỏ).
 *    - SẠCH (CLEAN): GitHub cho phép ủy quyền đăng nhập thành công vào trang bên thứ 3.
 * 5. Tự động phân loại và lưu kết quả theo thời gian thực:
 *    - Results_OAuth_Check/github_clean_accounts.txt
 *    - Results_OAuth_Check/github_flagged_oauth.txt
 *    - Results_OAuth_Check/github_failed_login.txt
 * ==============================================================================
 */

import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { TotpEngine } from "./totp_engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    inputFile: path.join(__dirname, "output_1.txt"),
    outputDir: path.join(__dirname, "Results_OAuth_Check"),
    headless: false,
    delaySec: 3,
    chromePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input" && args[i + 1]) {
      options.inputFile = path.resolve(process.cwd(), args[++i]);
    } else if (arg === "--headless") {
      options.headless = true;
    } else if (arg === "--delay" && args[i + 1]) {
      options.delaySec = parseInt(args[++i], 10) || 3;
    }
  }

  if (!existsSync(options.inputFile)) {
    const altInput = path.join(__dirname, "Results_CheckFlag", "github_live_good_2fa.txt");
    if (existsSync(altInput)) options.inputFile = altInput;
  }

  return options;
}

function isSuspendedOrFlagged(text, url) {
  const t = (text || "").toLowerCase();
  const u = (url || "").toLowerCase();

  if (
    u.includes("/suspended") ||
    t.includes("account suspended") ||
    t.includes("has been suspended") ||
    t.includes("violation of our terms of service") ||
    t.includes("your account has been locked")
  ) {
    return {
      blocked: true,
      status: "SUSPENDED",
      reason: "Account suspended: Access to your account has been suspended due to a violation of our Terms of Service.",
    };
  }

  if (
    t.includes("this account is flagged") ||
    t.includes("cannot authorize a third party application") ||
    t.includes("your account has been flagged") ||
    (u.includes("github.com/dashboard") && !u.includes("supabase"))
  ) {
    return {
      blocked: true,
      status: "FLAGGED",
      reason: "This account is flagged, and therefore cannot authorize a third party application.",
    };
  }

  return { blocked: false };
}

async function checkAccountRealOAuth(browser, acc, totpEngine) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  try {
    // 1. Mở trang đăng nhập bên thứ 3 thực tế (Supabase Dashboard)
    await page.goto("https://supabase.com/dashboard/sign-in", { waitUntil: "networkidle2", timeout: 45000 });
    await sleep(1500);

    // 2. Bấm nút Continue with GitHub
    const clickedBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      for (const b of btns) {
        if ((b.innerText || "").toLowerCase().includes("github")) {
          b.click();
          return true;
        }
      }
      return false;
    });

    if (!clickedBtn) {
      return { status: "ERROR", error: "Không tìm thấy nút 'Continue with GitHub' trên trang bên thứ 3" };
    }

    await sleep(3500);

    // 3. Đăng nhập nếu GitHub yêu cầu
    if (page.url().includes("github.com/login") || page.url().includes("github.com/session")) {
      await page.waitForSelector("#login_field, input[name='login']", { visible: true, timeout: 15000 });
      await page.type("#login_field", acc.email, { delay: 25 });
      await page.type("#password", acc.password, { delay: 25 });

      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
        page.click('input[type="submit"], button[type="submit"]'),
      ]);
      await sleep(2500);
    }

    let currentUrl = page.url();
    let bodyText = await page.evaluate(() => document.body?.innerText || "");

    // 3.1. Kiểm tra tài khoản bị Suspended hoặc Flagged ngay sau login
    const checkAfterLogin = isSuspendedOrFlagged(bodyText, currentUrl);
    if (checkAfterLogin.blocked) {
      return {
        status: checkAfterLogin.status,
        reason: checkAfterLogin.reason,
        url: currentUrl,
      };
    }

    // 3.2. Kiểm tra sai mật khẩu
    if (bodyText.includes("Incorrect username or password") || (currentUrl.includes("/login") && !currentUrl.includes("two-factor"))) {
      return { status: "WRONG_PASSWORD", error: "Sai mật khẩu hoặc bị khóa đăng nhập" };
    }

    // 3.3. Kiểm tra đòi mã email
    if (currentUrl.includes("verified-device") || bodyText.includes("Device verification") || bodyText.includes("sent a verification code")) {
      return { status: "NOT_2FA_EMAIL_CODE", error: "Chưa bật 2FA (Đòi mã xác minh Email)" };
    }

    // 4. Nhập mã TOTP 2FA
    if (currentUrl.includes("two-factor") || bodyText.includes("Two-factor") || bodyText.includes("authenticator")) {
      if (!acc.secret) {
        return { status: "MISSING_SECRET", error: "Tài khoản có 2FA nhưng không có Secret Key" };
      }

      const otpCode = totpEngine.generateCode(acc.secret);
      const otpInput = await page.waitForSelector('input[name="otp"], input[autocomplete="one-time-code"], #app_totp', { timeout: 10000 }).catch(() => null);

      if (otpInput) {
        await otpInput.type(otpCode, { delay: 30 });
        await sleep(600);
        await page.keyboard.press("Enter");
        await sleep(5000);
      }
    }

    // 4.1. Kiểm tra lại sau bước 2FA
    currentUrl = page.url();
    bodyText = await page.evaluate(() => document.body?.innerText || "");
    const checkAfter2fa = isSuspendedOrFlagged(bodyText, currentUrl);
    if (checkAfter2fa.blocked) {
      return {
        status: checkAfter2fa.status,
        reason: checkAfter2fa.reason,
        url: currentUrl,
      };
    }

    // 5. Kiểm tra nếu có nút "Authorize" trên trang GitHub
    if (page.url().includes("github.com/login/oauth/authorize")) {
      await page.evaluate(() => {
        const btn = document.querySelector('button[name="authorize"], #js-oauth-authorize-btn');
        if (btn) btn.click();
      }).catch(() => {});
      await sleep(4000);
    }

    // 6. KIỂM TRA KẾT QUẢ CUỐI CÙNG
    const finalUrl = page.url();
    const finalBodyText = await page.evaluate(() => document.body?.innerText || "");

    const checkFinal = isSuspendedOrFlagged(finalBodyText, finalUrl);
    if (checkFinal.blocked) {
      return {
        status: checkFinal.status,
        reason: checkFinal.reason,
        url: finalUrl,
      };
    }

    // Phải thực sự chuyển hướng về ứng dụng bên thứ 3 hoặc hoàn tất OAuth
    const isSuccess = (finalUrl.includes("supabase.com") && !finalUrl.includes("/sign-in")) ||
                      (!finalUrl.includes("github.com/login") && !finalUrl.includes("github.com/session") && !finalUrl.includes("github.com/suspended"));

    if (isSuccess && !finalUrl.includes("github.com")) {
      return {
        status: "CLEAN",
        message: "Tài khoản sạch, ủy quyền bên thứ 3 thành công",
        url: finalUrl,
      };
    }

    return {
      status: "FAILED",
      error: `Chưa hoàn tất ủy quyền (vẫn ở ${finalUrl})`,
      url: finalUrl,
    };

  } catch (err) {
    return { status: "ERROR", error: err.message };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function main() {
  const options = parseArgs();

  console.log("================================================================================");
  console.log("       HỆ THỐNG QUÉT TÀI KHOẢN GITHUB BỊ DÍNH CỜ OAUTH (QUA BÊN THỨ 3 THẬT)     ");
  console.log("================================================================================");
  console.log(`📁 File nguồn đầu vào  : ${options.inputFile}`);
  console.log(`📁 Thư mục xuất kết quả : ${options.outputDir}`);
  console.log(`🖥️ Chế độ hiển thị      : ${options.headless ? "Headless (Ẩn cửa sổ)" : "Trực quan (Hiện cửa sổ)"}`);
  console.log("================================================================================\n");

  if (!existsSync(options.inputFile)) {
    console.error(`❌ [Lỗi] Không tìm thấy file: ${options.inputFile}`);
    process.exit(1);
  }

  if (!existsSync(options.outputDir)) {
    mkdirSync(options.outputDir, { recursive: true });
  }

  const fileClean = path.join(options.outputDir, "github_clean_accounts.txt");
  const fileSuspended = path.join(options.outputDir, "github_suspended_accounts.txt");
  const fileFlagged = path.join(options.outputDir, "github_flagged_oauth.txt");
  const fileFailed = path.join(options.outputDir, "github_failed_login.txt");
  const fileSummaryJson = path.join(options.outputDir, "oauth_summary.json");

  // Xóa kết quả cũ
  writeFileSync(fileClean, "", "utf-8");
  writeFileSync(fileSuspended, "", "utf-8");
  writeFileSync(fileFlagged, "", "utf-8");
  writeFileSync(fileFailed, "", "utf-8");

  // Nạp danh sách tài khoản
  const rawContent = readFileSync(options.inputFile, "utf-8");
  const lines = rawContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const accounts = [];
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts[0] && parts[1]) {
      accounts.push({
        email: parts[0],
        password: parts[1],
        secret: parts[2] || "",
        raw: line,
      });
    }
  }

  const total = accounts.length;
  console.log(`🎯 Tìm thấy tổng cộng ${total} tài khoản cần quét.\n`);

  const totpEngine = new TotpEngine();
  const browser = await puppeteer.launch({
    executablePath: options.chromePath,
    headless: options.headless ? "new" : false,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,800"],
  });

  let cleanCount = 0;
  let suspendedCount = 0;
  let flaggedCount = 0;
  let failedCount = 0;

  try {
    for (let i = 0; i < total; i++) {
      const acc = accounts[i];
      const prefix = `[${i + 1}/${total}] ${acc.email}`;

      console.log(`----------------------------------------------------------------`);
      console.log(`▶️ ${prefix} -> Bắt đầu quét qua bên thứ 3...`);

      const result = await checkAccountRealOAuth(browser, acc, totpEngine);

      if (result.status === "CLEAN") {
        cleanCount++;
        console.log(`✅ ${prefix} -> [TÀI KHOẢN SẠCH] (Ủy quyền bên thứ 3 OK)`);
        appendFileSync(fileClean, `${acc.raw}\n`, "utf-8");
      } else if (result.status === "SUSPENDED") {
        suspendedCount++;
        console.log(`🚫 ${prefix} -> [TÀI KHOẢN BỊ SUSPENDED / KHÓA VĨNH VIỄN 🚫]: ${result.reason}`);
        appendFileSync(fileSuspended, `${acc.raw} | SUSPENDED: ${result.reason}\n`, "utf-8");
      } else if (result.status === "FLAGGED") {
        flaggedCount++;
        console.log(`❌ ${prefix} -> [BỊ FLAGGED GẮN CỜ ❌]: ${result.reason}`);
        appendFileSync(fileFlagged, `${acc.raw} | FLAGGED: ${result.reason}\n`, "utf-8");
      } else {
        failedCount++;
        console.log(`⚠️ ${prefix} -> [LỖI / BỎ QUA]: ${result.error || result.status}`);
        appendFileSync(fileFailed, `${acc.raw} | ERROR: ${result.error || result.status}\n`, "utf-8");
      }

      if (i < total - 1) {
        await sleep(options.delaySec * 1000);
      }
    }
  } finally {
    await browser.close();
  }

  // Tổng kết
  const summary = {
    Total: total,
    Clean: cleanCount,
    Suspended: suspendedCount,
    Flagged: flaggedCount,
    Failed: failedCount,
    Timestamp: new Date().toISOString(),
  };
  writeFileSync(fileSummaryJson, JSON.stringify(summary, null, 2), "utf-8");

  console.log("\n================================================================================");
  console.log("                        TỔNG KẾT QUÉT OAUTH THIRD-PARTY                         ");
  console.log("================================================================================");
  console.log(`Tổng số tài khoản đã quét            : ${total}`);
  console.log(`✅ SẠCH (Cấp quyền bên thứ 3 OK)      : ${cleanCount} tài khoản`);
  console.log(`🚫 BỊ SUSPENDED (Khóa ToS vĩnh viễn) : ${suspendedCount} tài khoản`);
  console.log(`❌ BỊ FLAGGED (Không thể cấp quyền)  : ${flaggedCount} tài khoản`);
  console.log(`⚠️ Thất bại / Sai mật khẩu / Lỗi     : ${failedCount} tài khoản`);
  console.log("--------------------------------------------------------------------------------");
  console.log(`📁 File TÀI KHOẢN SẠCH đã lưu        : ${fileClean}`);
  console.log(`📁 File TÀI KHOẢN BỊ SUSPENDED đã lưu: ${fileSuspended}`);
  console.log(`📁 File TÀI KHOẢN BỊ FLAGGED đã lưu  : ${fileFlagged}`);
  console.log(`📁 File THẤT BẠI/LỖI đã lưu          : ${fileFailed}`);
  console.log("================================================================================\n");

}

main().catch((err) => {
  console.error(`Lỗi hệ thống: ${err.message}`);
  process.exit(1);
});
