/**
 * SCRIPT KIỂM TRA ĐỘ CHÍNH XÁC CỦA MÃ 2FA GITHUB (CHECK 2FA VALIDITY)
 * ==============================================================================
 * Mục tiêu:
 * - Đọc file `github_accounts.txt` (định dạng `email|password|2fa_secret`).
 * - Đăng nhập GitHub và nhập mã TOTP 2FA được sinh từ 2fa_secret.
 * - Kiểm tra chính xác 100% tài khoản nào 2FA ĐÚNG, tài khoản nào 2FA SAI.
 * - Xuất báo cáo và phân loại ra các file riêng biệt trong thư mục `Results_2FA_Check`.
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

function findChromePath() {
  const possiblePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of possiblePaths) {
    if (existsSync(p)) return p;
  }
  return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    inputFile: path.join(__dirname, "github_accounts.txt"),
    outputDir: path.join(__dirname, "Results_2FA_Check"),
    headless: false,
    delaySec: 2,
    chromePath: findChromePath(),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--input" || arg === "-i") && args[i + 1]) {
      options.inputFile = path.resolve(process.cwd(), args[++i]);
    } else if (arg === "--headless") {
      options.headless = true;
    } else if ((arg === "--delay" || arg === "-d") && args[i + 1]) {
      options.delaySec = parseInt(args[++i], 10) || 2;
    }
  }

  return options;
}

// Điền OTP đa năng
async function fillAndSubmitOtp(page, otpCode) {
  const cleanCode = String(otpCode).trim();
  try {
    const otpInput = await page.$("#app_totp, input[name='app_otp'], input[name='otp'], input[autocomplete='one-time-code']");
    if (otpInput) {
      await otpInput.click({ clickCount: 3 }).catch(() => {});
      await page.keyboard.press("Backspace").catch(() => {});
      await otpInput.type(cleanCode, { delay: 30 }).catch(() => {});
    }

    await page.evaluate((code) => {
      const singleOtp = document.querySelector("#app_totp, input[name='app_otp'], input[name='otp'], input[autocomplete='one-time-code']");
      if (singleOtp) {
        singleOtp.value = code;
        singleOtp.dispatchEvent(new Event("input", { bubbles: true }));
        singleOtp.dispatchEvent(new Event("change", { bubbles: true }));
      }

      for (let i = 0; i < code.length; i++) {
        const el = document.querySelector(`#launch-code-${i}`) ||
                   document.querySelector(`input[data-index='${i}']`) ||
                   document.querySelectorAll('[data-testid="otp-digit"]')[i];
        if (el) {
          el.value = code[i];
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }, cleanCode).catch(() => {});

    await sleep(600);
    await page.keyboard.press("Enter").catch(() => {});

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, input[type='submit']"));
      const verifyBtn = btns.find((b) => /Verify|Submit|Continue/i.test(b.innerText || b.value || ""));
      if (verifyBtn) verifyBtn.click();
    }).catch(() => {});
  } catch {}
}

async function verifyAccount2Fa(browser, acc, totpEngine) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  try {
    // 1. Mở trang đăng nhập GitHub
    await page.goto("https://github.com/login", { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(1500);

    // 2. Điền tài khoản & mật khẩu
    const loginField = await page.waitForSelector("#login_field, input[name='login']", { visible: true, timeout: 15000 }).catch(() => null);
    if (!loginField) {
      return { status: "ERROR", message: "Không tìm thấy form đăng nhập GitHub" };
    }

    await page.type("#login_field", acc.email, { delay: 20 });
    await page.type("#password", acc.password, { delay: 20 });

    await Promise.all([
      page.click("input[type='submit'], button[type='submit']"),
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
    ]);
    await sleep(2500);

    let currentUrl = page.url();
    let bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");

    // 3. Kiểm tra nếu sai mật khẩu
    if (bodyText.includes("Incorrect username or password")) {
      return { status: "WRONG_PASSWORD", message: "Sai tài khoản hoặc mật khẩu" };
    }

    // 4. Kiểm tra nếu tài khoản bị khóa / flagged
    if (bodyText.includes("This account is flagged") || bodyText.includes("Account suspended")) {
      return { status: "FLAGGED", message: "Tài khoản bị gắn cờ / khóa" };
    }

    // 5. Kiểm tra nếu không có 2FA mà vào thẳng
    if (!currentUrl.includes("/two-factor") && !currentUrl.includes("/sessions/two-factor")) {
      const has2FaField = await page.$("#app_totp, input[name='app_otp'], input[name='otp']").catch(() => null);
      if (!has2FaField) {
        if (currentUrl.includes("github.com") && !currentUrl.includes("/login")) {
          return { status: "NO_2FA", message: "Tài khoản không bật 2FA (Đăng nhập thẳng thành công)" };
        }
      }
    }

    // 6. Màn hình 2FA TOTP -> Tiến hành thử nghiệm mã OTP
    if (!acc.totpSecret) {
      return { status: "2FA_INVALID", message: "Không có Secret Key 2FA trong file" };
    }

    let otpCode = "";
    try {
      otpCode = totpEngine.generateCode(acc.totpSecret);
    } catch (err) {
      return { status: "2FA_INVALID", message: `Secret Key lỗi định dạng: ${err.message}` };
    }

    if (!otpCode || otpCode.length !== 6) {
      return { status: "2FA_INVALID", message: "Secret Key không sinh ra được mã 6 số" };
    }

    console.log(`      👉 Điền mã TOTP: [ ${otpCode} ]...`);
    await fillAndSubmitOtp(page, otpCode);
    await sleep(3500);

    // 7. Kiểm tra kết quả sau khi submit OTP
    currentUrl = page.url();
    bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    const flashError = await page.evaluate(() => {
      const el = document.querySelector(".flash-error, .flash-warn, #js-flash-container .flash");
      return el ? (el.innerText || el.textContent || "").trim() : "";
    }).catch(() => "");

    const is2FaError =
      /invalid.*code|two-factor.*failed|incorrect.*code/i.test(flashError) ||
      /Two-factor authentication code is invalid|Two-factor authentication failed|The code you entered is invalid/i.test(bodyText);

    if (is2FaError) {
      return { status: "2FA_INVALID", message: `Mã 2FA sai (${flashError || "GitHub từ chối mã OTP"})` };
    }

    // Nếu chuyển hướng ra khỏi trang 2FA -> Đăng nhập thành công -> 2FA ĐÚNG!
    if (!currentUrl.includes("/two-factor") && !currentUrl.includes("/sessions/two-factor")) {
      return { status: "2FA_VALID", message: "2FA Chính xác (Đăng nhập thành công)" };
    }

    // Vẫn ở trang 2FA nhưng không có lỗi rõ ràng -> Thử kiểm tra lại
    return { status: "2FA_INVALID", message: "Không vượt qua được xác minh 2FA" };

  } catch (err) {
    return { status: "ERROR", message: err.message };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const options = parseArgs();

  console.log("==============================================================================");
  console.log("🛡️  TOOL KIỂM TRA MÃ 2FA GITHUB (VALID vs INVALID 2FA CHECKER)");
  console.log("==============================================================================");
  console.log(`📁 File đầu vào: ${options.inputFile}`);
  console.log(`📂 Thư mục kết quả: ${options.outputDir}`);
  console.log(`⚡ Chế độ: ${options.headless ? "Headless (Ẩn giao diện)" : "Giao diện trực quan"}`);
  console.log("==============================================================================\n");

  if (!existsSync(options.inputFile)) {
    console.error(`❌ Không tìm thấy file: ${options.inputFile}`);
    process.exit(1);
  }

  if (!existsSync(options.outputDir)) {
    mkdirSync(options.outputDir, { recursive: true });
  }

  const rawLines = readFileSync(options.inputFile, "utf-8").split(/\r?\n/);
  const accounts = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const parts = trimmed.split("|").map((p) => p.trim());
    if (parts.length >= 2) {
      accounts.push({
        rawLine: trimmed,
        email: parts[0],
        password: parts[1],
        totpSecret: parts[2] || "",
      });
    }
  }

  console.log(`📋 Tổng số tài khoản cần kiểm tra: ${accounts.length}\n`);

  const file2FaValid = path.join(options.outputDir, "github_2fa_VALID.txt");
  const file2FaInvalid = path.join(options.outputDir, "github_2fa_INVALID.txt");
  const fileWrongPass = path.join(options.outputDir, "github_wrong_password.txt");
  const fileNo2Fa = path.join(options.outputDir, "github_no_2fa.txt");
  const fileFlagged = path.join(options.outputDir, "github_flagged.txt");
  const fileError = path.join(options.outputDir, "github_check_errors.txt");
  const fileReport = path.join(options.outputDir, "report_summary.txt");

  // Khởi tạo file trống nếu chưa có
  [file2FaValid, file2FaInvalid, fileWrongPass, fileNo2Fa, fileFlagged, fileError].forEach((f) => {
    if (!existsSync(f)) writeFileSync(f, "", "utf-8");
  });

  const totpEngine = new TotpEngine();
  const browser = await puppeteer.launch({
    executablePath: options.chromePath,
    headless: options.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-infobars", "--window-size=1200,800"],
    defaultViewport: null,
  });

  const stats = {
    total: accounts.length,
    valid2Fa: 0,
    invalid2Fa: 0,
    wrongPass: 0,
    no2Fa: 0,
    flagged: 0,
    error: 0,
  };

  const startTime = Date.now();

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const indexStr = `[${i + 1}/${accounts.length}]`;
    console.log(`\n⏳ ${indexStr} Đang kiểm tra: ${acc.email} ...`);

    const res = await verifyAccount2Fa(browser, acc, totpEngine);

    if (res.status === "2FA_VALID") {
      stats.valid2Fa++;
      console.log(`   \x1b[32m✅ 2FA ĐÚNG (VALID): ${acc.email} -> Đã lưu vào github_2fa_VALID.txt\x1b[0m`);
      appendFileSync(file2FaValid, `${acc.rawLine}\n`, "utf-8");
    } else if (res.status === "2FA_INVALID") {
      stats.invalid2Fa++;
      console.log(`   \x1b[31m❌ 2FA SAI (INVALID): ${acc.email} | Lý do: ${res.message} -> Đã lưu vào github_2fa_INVALID.txt\x1b[0m`);
      appendFileSync(file2FaInvalid, `${acc.rawLine}\n`, "utf-8");
    } else if (res.status === "WRONG_PASSWORD") {
      stats.wrongPass++;
      console.log(`   \x1b[33m⚠️ SAI PASSWORD: ${acc.email}\x1b[0m`);
      appendFileSync(fileWrongPass, `${acc.rawLine}\n`, "utf-8");
    } else if (res.status === "NO_2FA") {
      stats.no2Fa++;
      console.log(`   \x1b[36mℹ️ KHÔNG CÓ 2FA: ${acc.email}\x1b[0m`);
      appendFileSync(fileNo2Fa, `${acc.rawLine}\n`, "utf-8");
    } else if (res.status === "FLAGGED") {
      stats.flagged++;
      console.log(`   \x1b[35m🚫 TÀI KHOẢN FLAGGED: ${acc.email}\x1b[0m`);
      appendFileSync(fileFlagged, `${acc.rawLine}\n`, "utf-8");
    } else {
      stats.error++;
      console.log(`   \x1b[90m⚠️ LỖI KHÁC: ${acc.email} (${res.message})\x1b[0m`);
      appendFileSync(fileError, `${acc.rawLine} | Lỗi: ${res.message}\n`, "utf-8");
    }

    if (i < accounts.length - 1) {
      await sleep(options.delaySec * 1000);
    }
  }

  await browser.close().catch(() => {});

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  const reportText = `==============================================================================
🎉 BÁO CÁO KẾT QUẢ KIỂM TRA 2FA GITHUB
==============================================================================
- Thời gian thực hiện: ${new Date().toLocaleString()}
- Tổng thời gian quét: ${durationSec} giây
- Tổng số tài khoản: ${stats.total}

📊 THỐNG KÊ CHI TIẾT:
   ✅ 2FA ĐÚNG (VALID):     ${stats.valid2Fa}  -> file: github_2fa_VALID.txt
   ❌ 2FA SAI (INVALID):    ${stats.invalid2Fa}  -> file: github_2fa_INVALID.txt
   ⚠️ Sai Password:        ${stats.wrongPass}  -> file: github_wrong_password.txt
   ℹ️ Chưa bật 2FA:         ${stats.no2Fa}  -> file: github_no_2fa.txt
   🚫 Bị khóa / Flagged:   ${stats.flagged}  -> file: github_flagged.txt
   ⚠️ Lỗi kết nối / Khác:  ${stats.error}  -> file: github_check_errors.txt
==============================================================================`;

  console.log(`\n\n${reportText}`);
  writeFileSync(fileReport, reportText, "utf-8");
  console.log(`\n📁 Báo cáo chi tiết đã được lưu tại: ${fileReport}`);
}

main().catch((err) => {
  console.error("Lỗi chương trình:", err);
  process.exit(1);
});
