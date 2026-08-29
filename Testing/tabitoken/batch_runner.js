const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const crypto = require("node:crypto");

const SIGNUP_URL = "https://tabitoken.com/sign-up?aff=rm5l";
const DEFAULT_ACCOUNTS_FILE = path.resolve(__dirname, "../git/hotmail/github_accounts.txt");
const RESULT_TXT = path.resolve(__dirname, "results_tabitoken.txt");
const RESULT_JSON = path.resolve(__dirname, "results_tabitoken.json");

// Giải mã Base32 Secret Key sang Buffer cho TOTP
function base32ToBuffer(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = (value || "").replace(/[ =-]/g, "").toUpperCase();
  let bits = "";

  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Secret 2FA không hợp lệ: ${char}`);
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

// Sinh mã 2FA TOTP 6 số
function generateTotp(secret, time = Date.now()) {
  const counter = Math.floor(time / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = crypto
    .createHmac("sha1", base32ToBuffer(secret))
    .update(counterBuffer)
    .digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(code % 1000000).padStart(6, "0");
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

// Đăng nhập GitHub và xử lý 2FA
async function completeGitHubLogin(page, account) {
  const loginField = await firstVisible(page, [
    "#login_field",
    "input[name=login]",
  ]);

  if (loginField) {
    await loginField.fill(account.email);
    await page.locator("#password, input[name=password]").first().fill(account.password);
    await page.locator("input[type=submit], button[type=submit]").first().click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  const otpField = await firstVisible(page, [
    "input[name=app_otp]",
    "input[name=otp]",
    "input[autocomplete=one-time-code]",
    "input[inputmode=numeric]",
  ]);

  if (otpField) {
    if (!account.totpSecret) {
      throw new Error("GitHub yêu cầu 2FA OTP nhưng tài khoản không có 2FA Secret Key");
    }
    const code = generateTotp(account.totpSecret);
    await otpField.fill(code);
    await otpField.press("Enter");
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  const authorize = await firstVisible(page, [
    "button:has-text('Authorize')",
    "input[value*='Authorize']",
  ]);

  if (authorize) {
    await authorize.click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }
}

// Tạo và trích xuất API Key Tabi Token
async function createApiKey(page, apiKeyName) {
  await page.goto("https://tabitoken.com/keys", {
    waitUntil: "domcontentloaded",
  });

  const createBtn = page.getByRole("button", { name: "Create API Key", exact: true });
  await createBtn.waitFor({ state: "visible", timeout: 15000 });
  await createBtn.click();

  await page.locator("[role=dialog] input[name=name]").fill(apiKeyName);
  await page.locator("[role=dialog]").getByRole("button", { name: "Save changes", exact: true }).click();

  await page.getByText(apiKeyName, { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });

  return page.evaluate(async (name) => {
    const refreshResponse = await fetch("/api/user/auth/refresh", {
      method: "POST",
      credentials: "include",
    });

    const refresh = await refreshResponse.json();
    const accessToken = refresh.data?.access_token;

    if (!accessToken) {
      throw new Error("Không thể refresh phiên đăng nhập Tabi Token");
    }

    const headers = { Authorization: `Bearer ${accessToken}` };
    const listResponse = await fetch("/api/token/?p=1&size=100", {
      headers,
      credentials: "include",
    });

    const list = await listResponse.json();
    const item = (list.data?.items || [])
      .filter((entry) => entry.name === name)
      .sort((a, b) => (b.created_time || b.id || 0) - (a.created_time || a.id || 0))[0];

    if (!item) {
      throw new Error("Không tìm thấy API Key vừa tạo");
    }

    const keyResponse = await fetch(`/api/token/${item.id}/key`, {
      method: "POST",
      headers,
      credentials: "include",
    });

    const key = await keyResponse.json();
    if (!key.success || !key.data?.key) {
      throw new Error("Không thể trích xuất API key bí mật");
    }

    return {
      account: refresh.data.user?.username || refresh.data.user?.email || "unknown",
      apiKey: `sk-${key.data.key}`,
    };
  }, apiKeyName);
}

// Xử lý 1 tài khoản
async function processAccount(account, index, total, isHeadless) {
  const apiKeyName = `Key_${Date.now().toString().slice(-6)}`;
  console.log(`\n-----------------------------------------------------------`);
  console.log(`⏳ [${index}/${total}] Đang xử lý: ${account.email}...`);

  const browser = await chromium.launch({
    headless: isHeadless,
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);

    const githubBtn = page.getByRole("button", {
      name: /Continue with GitHub|Sign in with GitHub/i,
    });
    await githubBtn.waitFor({ state: "visible", timeout: 15000 });
    await githubBtn.click();

    const popup = await popupPromise;
    const authPage = popup || page;

    await authPage.waitForLoadState("domcontentloaded").catch(() => {});
    await completeGitHubLogin(authPage, account);

    await Promise.race([
      authPage.waitForURL(/tabitoken\.com/, { timeout: 45000 }),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);

    const appPage =
      context.pages().find((candidate) => candidate.url().includes("tabitoken.com")) || page;

    const result = await createApiKey(appPage, apiKeyName);
    console.log(`✅ [${index}/${total}] Thành công: ${account.email} -> API Key: ${result.apiKey}`);

    return {
      success: true,
      email: account.email,
      accountName: result.account,
      apiKey: result.apiKey,
      rawLine: account.rawLine,
    };
  } catch (error) {
    console.error(`❌ [${index}/${total}] Thất bại: ${account.email} | Lỗi: ${error.message}`);
    return {
      success: false,
      email: account.email,
      error: error.message,
      rawLine: account.rawLine,
    };
  } finally {
    await browser.close();
  }
}

function loadCompletedAccounts(resultFilePath) {
  const completed = new Set();
  if (!fs.existsSync(resultFilePath)) return completed;
  const lines = fs.readFileSync(resultFilePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("FAILED")) continue;
    const parts = trimmed.split("|");
    if (parts.length >= 2 && parts[1].startsWith("sk-")) {
      completed.add(parts[0].trim().toLowerCase());
    }
  }
  return completed;
}

// Hàm main
async function main() {
  const filePath = process.argv[2] || process.env.ACCOUNTS_FILE || DEFAULT_ACCOUNTS_FILE;
  const isHeadless = process.env.HEADLESS !== "false";

  console.log("===========================================================");
  console.log("🚀 TABITOKEN BATCH RUNNER AUTOMATION");
  console.log(`📁 File tài khoản: ${filePath}`);
  console.log(`🖥 Chế độ Headless: ${isHeadless} (đặt HEADLESS=false để hiện trình duyệt)`);
  console.log("===========================================================");

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File không tồn tại: ${filePath}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const rawAccounts = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const parts = trimmed.split("|").map((p) => p.trim());
    if (parts.length >= 2) {
      rawAccounts.push({
        rawLine: trimmed,
        email: parts[0],
        password: parts[1],
        totpSecret: parts[2] || "",
      });
    }
  }

  console.log(`📋 Tổng số tài khoản trong file: ${rawAccounts.length}`);

  const completedSet = loadCompletedAccounts(RESULT_TXT);
  if (completedSet.size > 0) {
    console.log(`⚡ Đã có sẵn ${completedSet.size} tài khoản đã tạo API Key thành công (Tự động bỏ qua).`);
  }

  const accounts = rawAccounts.filter((acc) => !completedSet.has(acc.email.toLowerCase()));
  console.log(`🎯 Cần xử lý tiếp: ${accounts.length}/${rawAccounts.length} tài khoản.\n`);

  if (accounts.length === 0) {
    console.log("✅ Toàn bộ tài khoản đã có API Key. Hoàn tất!");
    return;
  }

  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const res = await processAccount(accounts[i], i + 1, accounts.length, isHeadless);
    results.push(res);

    // Ghi kết quả ngay lập tức vào file txt
    if (res.success) {
      fs.appendFileSync(RESULT_TXT, `${res.email}|${res.apiKey}\n`, "utf-8");
    } else {
      fs.appendFileSync(RESULT_TXT, `FAILED|${res.email}|${res.error}\n`, "utf-8");
    }

    // Nghỉ 2 giây giữa các tài khoản
    if (i < accounts.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  fs.writeFileSync(RESULT_JSON, JSON.stringify(results, null, 2), "utf-8");

  const successCount = results.filter((r) => r.success).length;
  console.log("\n===========================================================");
  console.log(`🎉 HOÀN THÀNH TOÀN BỘ:`);
  console.log(`   - Tổng số: ${results.length}`);
  console.log(`   - Thành công: ${successCount}`);
  console.log(`   - Thất bại: ${results.length - successCount}`);
  console.log(`   - File lưu kết quả: ${RESULT_TXT}`);
  console.log("===========================================================");
}

main().catch((err) => {
  console.error("Lỗi chương trình:", err);
  process.exit(1);
});
