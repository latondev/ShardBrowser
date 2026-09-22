const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

function requireModule(name) {
  try {
    return require(name);
  } catch (e) {
    try {
      return require(path.resolve(__dirname, `../../node_modules/${name}`));
    } catch (e2) {
      try {
        return require(path.resolve(__dirname, `../tabitoken/node_modules/${name}`));
      } catch (e3) {
        console.error(`❌ Không tìm thấy thư viện '${name}'.`);
        process.exit(1);
      }
    }
  }
}

const puppeteer = requireModule("puppeteer-core");

const BASE_URL = "https://wavespeed.ai";
const SIGN_IN_URL = `${BASE_URL}/sign-in?redirect=${encodeURIComponent(BASE_URL + "/")}`;
const ACCESS_KEY_URL = `${BASE_URL}/accesskey`;
const SHARD_GROUP_NAME = "WaveSpeed";
const API_KEY_NAME = process.env.WAVESPEED_KEY_NAME || `Key_${Date.now().toString().slice(-6)}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStepReady(page, delayMs = 2000) {
  try {
    if (page && typeof page.waitForNetworkIdle === "function") {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 12000 }).catch(() => {});
    }
  } catch {}
  await sleep(delayMs);
}

// 2FA TOTP
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

function getTotpCode(secret, time = Date.now()) {
  if (!secret) return "";
  const counter = Math.floor(time / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32ToBuffer(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

function loadAccountCredentials() {
  let email = process.env.WAVESPEED_GITHUB_EMAIL || process.env.TABITOKEN_GITHUB_EMAIL;
  let password = process.env.WAVESPEED_GITHUB_PASSWORD || process.env.TABITOKEN_GITHUB_PASSWORD;
  let secret = process.env.WAVESPEED_GITHUB_TOTP_SECRET || process.env.TABITOKEN_GITHUB_TOTP_SECRET;

  if (!email || !password) {
    const candidateFiles = [
      path.resolve(__dirname, "accounts.txt"),
      path.resolve(__dirname, "../git/hotmail/github_accounts.txt"),
      path.resolve(__dirname, "../tabitoken/accounts.txt"),
    ];
    for (const f of candidateFiles) {
      if (fs.existsSync(f)) {
        const lines = fs.readFileSync(f, "utf-8").split(/\r?\n/);
        for (const l of lines) {
          const trimmed = l.trim();
          if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
          const parts = trimmed.split("|").map((p) => p.trim());
          if (parts.length >= 2) {
            email = parts[0];
            password = parts[1];
            secret = parts[2] || "";
            console.log(`📋 [Tài khoản] Đọc từ file: ${path.basename(f)} (${email})`);
            break;
          }
        }
        if (email) break;
      }
    }
  }

  if (!email || !password) {
    throw new Error("Không tìm thấy thông tin tài khoản (cần WAVESPEED_GITHUB_EMAIL / PASSWORD hoặc file accounts.txt)");
  }

  return { email, password, secret };
}

// ShardBrowser launcher config
function loadShardConfig() {
  const homeDir = os.homedir();
  const candidateSettings = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "settings.json") : null,
    path.join(homeDir, ".config", "shardx-launcher", "settings.json"),
    path.join(homeDir, "AppData", "Roaming", "shardx-launcher", "settings.json"),
  ].filter(Boolean);

  let port = 40325;
  let secret = "";

  for (const p of candidateSettings) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const settings = JSON.parse(raw);
        port = settings.api_port || 40325;
        secret = settings.api_secret || "";
        break;
      } catch {}
    }
  }

  let token = "";
  if (secret) {
    const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "HS256" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ sub: "shardx-api", iat: now, exp: now + 86400 * 30 })
    ).toString("base64url");
    const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest().toString("base64url");
    token = `${header}.${payload}.${sig}`;
  }

  const apiUrl = process.env.LAUNCHER_API_URL || `http://127.0.0.1:${port}`;
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return { apiUrl, headers };
}

async function fetchShardApi(apiUrl, headers, endpoint, method = "GET", body = null) {
  const url = `${apiUrl}${endpoint}`;
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ShardBrowser API error (${res.status}): ${errText}`);
  }
  return res.json();
}

async function humanType(page, selector, text) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout: 5000 });
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    for (const ch of String(text || "")) {
      await page.keyboard.type(ch, { delay: 25 });
    }
  } catch {
    await page.evaluate((sel, val) => {
      const el = document.querySelector(sel);
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, selector, text);
  }
}

async function clickText(page, pattern) {
  const clicked = await page.evaluate((source) => {
    const re = new RegExp(source, "i");
    const elements = [...document.querySelectorAll("button, input[type=submit], a, [role=button]")];
    const element = elements.find((item) => re.test((item.innerText || item.value || item.textContent || item.getAttribute("aria-label") || "").trim()));
    if (!element) return false;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.click();
    return true;
  }, pattern.source);

  if (!clicked) throw new Error(`Không tìm thấy phần tử có chữ: ${pattern}`);
}

async function main() {
  const account = loadAccountCredentials();
  const isHeadless = process.env.HEADLESS === "true";

  console.log("===========================================================");
  console.log("🚀 WAVESPEED SINGLE RUNNER (2S STABILIZE + IDLE NETWORKING)");
  console.log(`👤 Email: ${account.email}`);
  console.log(`🔑 Key Name: ${API_KEY_NAME}`);
  console.log(`🖥 Headless: ${isHeadless}`);
  console.log("===========================================================");

  const { apiUrl, headers } = loadShardConfig();
  let browser = null;
  let profileId = null;
  let useShard = true;

  try {
    // 1. Kiểm tra / Khởi tạo Profile ShardBrowser
    try {
      const cleanName = account.email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_");
      const profileBaseName = `Wave_${cleanName}`;
      
      const profiles = await fetchShardApi(apiUrl, headers, "/profiles", "GET").catch(() => []);
      const existing = Array.isArray(profiles) ? profiles.find(p => (p.name || "").toLowerCase() === profileBaseName.toLowerCase()) : null;

      if (existing) {
        profileId = existing.id;
        console.log(`🛡️ [ShardBrowser] Tái sử dụng Profile ID: ${profileId}`);
      } else {
        const fpRes = await fetchShardApi(apiUrl, headers, "/fingerprint/new/windows", "GET").catch(() => ({}));
        const newProfile = await fetchShardApi(apiUrl, headers, "/profiles", "POST", {
          name: profileBaseName,
          folder: SHARD_GROUP_NAME,
          notes: `WaveSpeed Profile cho ${account.email}`,
          fingerprint: fpRes.fingerprint || fpRes || {},
        });
        profileId = newProfile.id;
        console.log(`🛡️ [ShardBrowser] Đã tạo Profile mới ID: ${profileId}`);
      }

      const startRes = await fetchShardApi(apiUrl, headers, `/profiles/${profileId}/start`, "POST", { headless: isHeadless });
      const wsUrl = startRes.cdp?.web_socket_debugger_url || `http://127.0.0.1:${startRes.cdp?.port}`;
      console.log(`🔗 Kết nối Puppeteer qua CDP: ${wsUrl}`);

      if (wsUrl.startsWith("ws")) {
        browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
      } else {
        browser = await puppeteer.connect({ browserURL: wsUrl, defaultViewport: null });
      }
    } catch (e) {
      console.warn(`⚠️ Không dùng được ShardBrowser Launcher (${e.message}). Mở Puppeteer trực tiếp...`);
      useShard = false;
      const cleanEmail = account.email.replace(/[^a-zA-Z0-9_-]/g, "_");
      browser = await puppeteer.launch({
        headless: isHeadless,
        userDataDir: path.resolve(__dirname, ".puppeteer-profile", cleanEmail),
        defaultViewport: null,
      });
    }

    await sleep(2000);

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    page.setDefaultTimeout(40000);

    // BƯỚC 1: Tới trang đăng nhập WaveSpeed
    console.log(`🌐 [BƯỚC 1] Mở ${SIGN_IN_URL}...`);
    await page.goto(SIGN_IN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForStepReady(page, 2000);

    // BƯỚC 2: Bấm Sign in with GitHub
    console.log(`🌐 [BƯỚC 2] Bấm 'Sign in with GitHub'...`);
    await page.waitForSelector('button[aria-label="Sign in with GitHub"]', { timeout: 15000 });
    await page.click('button[aria-label="Sign in with GitHub"]');
    await waitForStepReady(page, 2000);

    // BƯỚC 3: Xử lý GitHub Form / 2FA / Authorize
    console.log(`🌐 [BƯỚC 3] Kiểm tra và xác thực GitHub...`);
    const deadline = Date.now() + 90000;

    while (Date.now() < deadline) {
      const url = page.url();
      const text = await page.evaluate(() => document.body?.innerText || "");

      // Flagged check
      if (url.includes("github.com") && /(?:this account is flagged|cannot authorize a third party application)/i.test(text)) {
        throw new Error("BLOCKED_ACCOUNT_FLAGGED: Tài khoản GitHub bị hạn chế!");
      }

      // Đã vào dashboard
      if (url.includes("wavespeed.ai") && !url.includes("sign-in") && (/dashboard/i.test(text) || url.includes("/center/"))) {
        console.log(`✅ [WaveSpeed] Đăng nhập thành công!`);
        await waitForStepReady(page, 2000);
        break;
      }

      // Điền Email / Pass
      const loginField = await page.$("#login_field, input[name='login']");
      if (loginField && url.includes("github.com")) {
        console.log(`🔑 Điền form đăng nhập GitHub...`);
        await humanType(page, "#login_field, input[name='login']", account.email);
        await sleep(300);
        await humanType(page, "#password, input[name='password']", account.password);
        await sleep(500);
        await page.click("input[type='submit'], button[type='submit']");
        await waitForStepReady(page, 2000);
        continue;
      }

      // TOTP 2FA
      const otpField = await page.$("#app_totp, input[name='otp'], input[name='app_totp']");
      if (otpField && url.includes("github.com")) {
        const code = getTotpCode(account.secret);
        console.log(`🔐 Nhập 2FA TOTP: [ ${code} ]...`);
        await humanType(page, "#app_totp, input[name='otp'], input[name='app_totp']", code);
        await sleep(300);
        await page.keyboard.press("Enter");
        await waitForStepReady(page, 2000);
        continue;
      }

      // Passkey / Trusted Device
      if (/trusted-device/i.test(url) || /ask me later/i.test(text)) {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, a, input"));
          const b = btns.find(x => /ask me later|not now/i.test(x.innerText || x.value || ""));
          if (b) b.click();
        });
        await waitForStepReady(page, 2000);
        continue;
      }

      // OAuth consent
      if (/authorize wavespeedai/i.test(text) || url.includes("/login/oauth/authorize")) {
        console.log(`⚡ Bấm ủy quyền 'Authorize wavespeedai'...`);
        await clickText(page, /^authorize wavespeedai$/).catch(() => {});
        await waitForStepReady(page, 2000);
        continue;
      }

      await sleep(1500);
    }

    // BƯỚC 4: Vào trang Access Key
    console.log(`🌐 [BƯỚC 4] Mở trang ${ACCESS_KEY_URL}...`);
    await page.goto(ACCESS_KEY_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForStepReady(page, 2000);

    // BƯỚC 5: Bấm Create Key
    console.log(`🌐 [BƯỚC 5] Bấm 'Create Key' & điền tên [${API_KEY_NAME}]...`);
    await page.waitForSelector('button', { timeout: 30000 });
    await clickText(page, /^create key$/);
    await waitForStepReady(page, 2000);

    await page.waitForSelector('input[placeholder="Enter key name"]', { timeout: 15000 });
    await page.evaluate((name) => {
      const input = document.querySelector('input[placeholder="Enter key name"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, name);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, API_KEY_NAME);
    await waitForStepReady(page, 2000);

    // Xác nhận Create Key
    await clickText(page, /^create key$/);
    await waitForStepReady(page, 2000);

    // BƯỚC 6: Đọc API Key từ <code>
    console.log(`🌐 [BƯỚC 6] Đọc chuỗi Secret API Key...`);
    await page.waitForFunction(() => /copy and save this api key/i.test(document.body.innerText || ""), { timeout: 20000 });
    const apiKey = await page.$eval("code", (el) => el.textContent.trim());

    console.log("\n===========================================================");
    console.log(`🎉 THÀNH CÔNG:`);
    console.log(`success|${account.email}|${apiKey}`);
    console.log("===========================================================");

    // Lưu vào kết quả
    const resFile = path.resolve(__dirname, "results_wavespeed.txt");
    fs.appendFileSync(resFile, `${account.email}|${apiKey}\n`, "utf-8");
    console.log(`💾 Đã lưu kết quả vào ${path.basename(resFile)}`);

    await waitForStepReady(page, 2000);
  } finally {
    if (browser) {
      if (useShard) await browser.disconnect().catch(() => {});
      else await browser.close().catch(() => {});
    }
    if (useShard && profileId) {
      await fetchShardApi(apiUrl, headers, `/profiles/${profileId}/stop`, "POST", {}).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error(`\n❌ THẤT BẠI: ${err.message}`);
  process.exit(1);
});
