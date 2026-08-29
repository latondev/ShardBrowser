const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

// Nạp thư viện puppeteer-core
let puppeteer = null;
try {
  puppeteer = require("puppeteer-core");
} catch (e) {
  try {
    puppeteer = require(path.resolve(__dirname, "../../node_modules/puppeteer-core"));
  } catch (e2) {
    console.error("❌ Không tìm thấy thư viện 'puppeteer-core'.");
    process.exit(1);
  }
}

// Cấu hình URL & Đường dẫn
const SIGNUP_URL = "https://tabitoken.com/sign-up?aff=rm5l";
const DEFAULT_ACCOUNTS_FILE = path.resolve(__dirname, "../git/hotmail/github_accounts.txt");
const RESULT_TXT = path.resolve(__dirname, "results_tabitoken.txt");
const RESULT_JSON = path.resolve(__dirname, "results_tabitoken.json");
const RESULT_2FA_INVALID_TXT = path.resolve(__dirname, "github_2fa_invalid.txt");
const PROXY_KEY = process.env.PROXY_KEY || process.env.PROXY_XOAY_KEY || "IaFVANxqBlxITSiAkJpGrG";

// ==============================================================================
// PROXY XOAY CLIENT (TỰ ĐỘNG XOAY IP DÂN CƯ CHO TỪNG PROFILE)
// ==============================================================================
class ProxyXoayClient {
  _apiKey = "IaFVANxqBlxITSiAkJpGrG";
  _apiUrl = "https://proxyxoay.shop/api/get.php";
  _lastProxy = null;

  constructor(apiKey = null) {
    if (apiKey) this._apiKey = apiKey;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getNewProxy(forceWait = true) {
    if (!this._apiKey) {
      console.log("ℹ️ [ProxyXoay] Không có API Key proxy, chạy IP trực tiếp.");
      return null;
    }

    console.log("🌐 [ProxyXoay] Đang yêu cầu cấp IP Proxy xoay mới từ proxyxoay.shop...");
    const url = `${this._apiUrl}?key=${this._apiKey}&nhamang=random&tinhthanh=0&whitelist=`;

    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const data = await res.json();

        // 1. Status 100: Cấp IP mới thành công
        if (data.status === 100) {
          const rawProxy = data.proxyhttp || data.proxysocks5;
          if (rawProxy) {
            const rawClean = String(rawProxy).replace(/[\r\n]/g, "").trim();
            const parts = rawClean.split(":");
            const host = parts[0];
            const port = parseInt(parts[1], 10);
            const username = parts[2] && parts[2] !== "" ? parts[2] : "";
            const password = parts[3] && parts[3] !== "" ? parts[3] : "";
            const auth = username && password ? `${username}:${password}@` : "";
            const proxyString = `http://${auth}${host}:${port}`;

            const result = {
              proxyString,
              host,
              port,
              username,
              password,
              ip: data.ip || host,
              isp: data["Network Provider"] || data["Nha Mang"] || data["nhamang"] || "Random",
              location: data["Location"] || data["Vi Tri"] || data["tinhthanh"] || "Vietnam",
            };

            this._lastProxy = result;
            console.log(`✅ [ProxyXoay] Đã nhận IP mới hoạt động: ${result.proxyString} | ISP: ${result.isp} | Vị trí: ${result.location}`);
            return result;
          }
        }

        // 2. Status 101: Đang chờ đổi IP -> Bắt buộc đợi để lấy IP mới hoạt động
        if (data.status === 101) {
          const waitMatch = (data.message || "").match(/(\d+)\s*(?:s|giây|second)?/i);
          const waitSec = waitMatch ? Math.min(parseInt(waitMatch[1], 10) + 2, 60) : 10;
          console.log(`⏳ [ProxyXoay] Cần đợi ${waitSec}s để lấy IP mới sống (${data.message}) [Lần ${attempt}/10]...`);
          await this._sleep(waitSec * 1000);
          continue;
        }

        // 3. Status khác
        console.warn(`⚠️ [ProxyXoay] Status ${data.status}: ${data.message}`);
        await this._sleep(3000);
      } catch (err) {
        console.warn(`⚠️ [ProxyXoay] Lỗi kết nối (${attempt}/10): ${err.message}`);
        await this._sleep(3000);
      }
    }

    if (this._lastProxy) {
      console.log(`ℹ️ [ProxyXoay] Thử dùng lại IP: ${this._lastProxy.proxyString}`);
      return this._lastProxy;
    }
    return null;
  }
}

/**
 * Quản lý kết nối & điều khiển Profile ShardBrowser qua REST API & CDP
 */
class ShardBrowserClient {
  _apiUrl = "http://127.0.0.1:40325";
  _apiToken = "";
  _headers = {};

  constructor() {
    this._loadConfig();
  }

  _loadConfig() {
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

    if (secret) {
      const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "HS256" })).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(
        JSON.stringify({ sub: "shardx-api", iat: now, exp: now + 86400 * 30 })
      ).toString("base64url");
      const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest().toString("base64url");
      this._apiToken = `${header}.${payload}.${sig}`;
    }

    this._apiUrl = process.env.LAUNCHER_API_URL || `http://127.0.0.1:${port}`;
    this._headers = {
      "Content-Type": "application/json",
      ...(this._apiToken ? { Authorization: `Bearer ${this._apiToken}` } : {}),
    };
  }

  async _fetchApi(endpoint, method = "GET", body = null) {
    const url = `${this._apiUrl}${endpoint}`;
    const options = { method, headers: this._headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`ShardBrowser API Lỗi (${res.status}): ${errorText || res.statusText}`);
    }
    return res.json();
  }

  getDefaultProxy() {
    const candidateProxies = [
      process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "proxies.json") : null,
      path.join(os.homedir(), ".config", "shardx-launcher", "proxies.json"),
      path.join(os.homedir(), "AppData", "Roaming", "shardx-launcher", "proxies.json"),
    ].filter(Boolean);

    for (const p of candidateProxies) {
      if (fs.existsSync(p)) {
        try {
          const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
          const list = raw.proxies || raw || [];
          if (list.length > 0) {
            const item = list[0];
            const auth = item.username && item.password ? `${item.username}:${item.password}@` : "";
            const kind = item.kind || "http";
            const proxyString = `${kind}://${auth}${item.host}:${item.port}`;
            return {
              id: item.id,
              proxyString,
              host: item.host,
              port: item.port,
              username: item.username || "",
              password: item.password || "",
              name: item.name || "",
            };
          }
        } catch {}
      }
    }
    return null;
  }

  async createIsolatedProfile(accountEmail, proxyData = null) {
    let fingerprint = {};
    try {
      const fpRes = await this._fetchApi("/fingerprint/new/windows", "GET");
      if (fpRes && typeof fpRes === "object") {
        fingerprint = fpRes.fingerprint || fpRes;
      }
    } catch (e) {
      console.warn(`[ShardBrowser] Fingerprint mặc định (${e.message}).`);
    }

    const cleanName = accountEmail.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_");
    const suffix = Date.now().toString().slice(-4);
    
    // Tự động gán Proxy có sẵn trong ShardBrowser
    const savedProxy = this.getDefaultProxy();
    const activeProxy = proxyData || savedProxy;
    const proxyStr = activeProxy ? (activeProxy.proxyString || `http://${activeProxy.host}:${activeProxy.port}`) : null;

    const profilePayload = {
      name: `Tabi_${cleanName}_${suffix}`,
      folder: "TabiToken-Auto",
      notes: `Proxy: ${proxyStr || "Direct"} | TabiToken cho ${accountEmail} lúc ${new Date().toLocaleTimeString()}`,
      fingerprint: (fingerprint && typeof fingerprint === "object") ? fingerprint : {},
    };

    if (activeProxy?.id) {
      profilePayload.proxy_id = activeProxy.id;
    } else if (proxyStr) {
      profilePayload.proxy = proxyStr;
    }

    const created = await this._fetchApi("/profiles", "POST", profilePayload);
    return created.id;
  }

  async startProfile(profileId) {
    const startRes = await this._fetchApi(`/profiles/${profileId}/start`, "POST", { headless: false });
    const wsUrl = startRes.cdp?.web_socket_debugger_url;
    if (!wsUrl && startRes.cdp?.port) {
      return `http://127.0.0.1:${startRes.cdp.port}`;
    }
    if (!wsUrl) {
      throw new Error(`ShardBrowser không trả về WebSocket CDP URL: ${JSON.stringify(startRes)}`);
    }
    return wsUrl;
  }

  async stopProfile(profileId) {
    if (!profileId) return;
    try {
      await this._fetchApi(`/profiles/${profileId}/stop`, "POST", {});
    } catch (e) {
      console.warn(`[ShardBrowser] Lỗi khi dừng profile ${profileId}: ${e.message}`);
    }
  }
}

// ==============================================================================
// CÁC HÀM XỬ LÝ TOTP 2FA & TIỆN ÍCH
// ==============================================================================

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gõ văn bản an toàn chống lỗi timeout / detached frame khi mạng lag (Timeout 60s)
async function typeHuman(page, selector, text) {
  if (!page || page.isClosed()) return;
  try {
    const el = await page.waitForSelector(selector, { visible: true, timeout: 60000 }).catch(() => null);
    if (!el) {
      console.warn(`⏳ Ô nhập ${selector} chưa sẵn sàng sau 60s, đang tiếp tục...`);
      return;
    }

    await el.click({ clickCount: 3 }).catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await sleep(100);

    for (const char of String(text)) {
      await page.keyboard.type(char, { delay: Math.floor(Math.random() * 25) + 15 });
    }
  } catch (e) {
    if (!e.message.includes("detached")) console.warn(`[typeHuman]: ${e.message}`);
  }
}

// Điền mã OTP vào GitHub
async function fillAndSubmitOtp(page, otpCode) {
  if (!page || page.isClosed() || !otpCode) return false;
  const cleanCode = String(otpCode).trim();
  console.log(`⚡ [2FA OTP] Điền mã: [ ${cleanCode} ] vào GitHub...`);

  try {
    const otpInput = await page.$("#app_totp, input[name='app_otp'], input[name='otp'], input[autocomplete='one-time-code']");
    if (otpInput) {
      await otpInput.click({ clickCount: 3 }).catch(() => {});
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

    await sleep(800);
    console.log("👉 Bấm nút Verify 2FA / Enter...");
    await page.keyboard.press("Enter").catch(() => {});

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, input[type='submit']"));
      const verifyBtn = btns.find((b) => /Verify|Submit|Continue/i.test(b.innerText || b.value || ""));
      if (verifyBtn) verifyBtn.click();
    }).catch(() => {});
  } catch (e) {
    if (!e.message.includes("detached")) throw e;
  }
  return true;
}

// Điều hướng an toàn có cơ chế tự động thử lại khi proxy bị lag hoặc abort (Timeout 60s)
async function safeNavigate(page, targetUrl, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🌐 Đang mở: ${targetUrl} (Lần thử ${attempt}/${maxRetries})...`);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      return true;
    } catch (err) {
      console.warn(`⚠️ Lỗi tải trang (${err.message}). Đang thử tải lại sau 2s...`);
      await sleep(2000);
      if (attempt === maxRetries) {
        throw new Error(`Không thể mở trang ${targetUrl}: ${err.message}`);
      }
    }
  }
}

// ==============================================================================
// LUỒNG TỔNG THỂ: TABITOKEN OAUTH -> GITHUB LOGIN -> 2FA -> AUTHORIZE -> API KEY
// ==============================================================================
async function handleTabiTokenOAuthFlow(browser, page, account) {
  console.log(`🌐 [Bước 1] Mở trang đăng ký TabiToken: ${SIGNUP_URL}...`);
  await page.bringToFront().catch(() => {});
  await sleep(1500); // Chờ Proxy khởi tạo kết nối

  await safeNavigate(page, SIGNUP_URL, 3);
  console.log("⏳ Chờ 5s cho trang TabiToken tải đầy đủ tài nguyên và chống spam...");
  await sleep(5000);

  // Bấm nút "Continue with GitHub"
  console.log("👆 Bấm nút 'Continue with GitHub'...");
  try {
    await page.waitForFunction(
      () => {
        const btns = Array.from(document.querySelectorAll("button, a"));
        return btns.some((b) => /Continue with GitHub|Sign in with GitHub/i.test(b.innerText || b.textContent || ""));
      },
      { timeout: 60000 }
    );
    await sleep(1500);

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      const githubBtn = btns.find((b) => /Continue with GitHub|Sign in with GitHub/i.test(b.innerText || b.textContent || ""));
      if (githubBtn) githubBtn.click();
    });
  } catch {}

  await sleep(4000);

  // Vòng lặp State Machine theo dõi chuyển hướng (Tổng timeout 3 phút)
  const maxWaitTime = Date.now() + 180000;
  let isDoneOAuth = false;

  while (Date.now() < maxWaitTime) {
    let currentPages = [];
    try {
      currentPages = await browser.pages();
    } catch {
      await sleep(1000);
      continue;
    }

    const activePage = currentPages.find((p) => p.url().includes("github.com")) || currentPages[0] || page;
    if (!activePage || activePage.isClosed()) {
      await sleep(1500);
      continue;
    }

    let currentUrl = "";
    let bodyText = "";

    try {
      currentUrl = activePage.url();
      bodyText = await activePage.evaluate(() => document.body?.innerText || "");
    } catch (e) {
      await sleep(1000);
      continue;
    }

    // 1. Đang ở trang callback OAuth -> Chờ TabiToken trao đổi code lấy session
    if (currentUrl.includes("/oauth/github") || currentUrl.includes("code=")) {
      console.log("⏳ Đang xử lý OAuth Callback & lưu phiên đăng nhập TabiToken...");
      await sleep(3500);
      continue;
    }

    // 2. Đã về trang chính TabiToken và có phiên hợp lệ
    if (currentUrl.includes("tabitoken.com") && !currentUrl.includes("sign-up?aff=") && !currentUrl.includes("/sign-in")) {
      console.log(`🎉 Đã đăng nhập thành công vào TabiToken: ${currentUrl}`);
      console.log("⏳ Chờ 3s cho phiên đăng nhập được lưu hoàn tất...");
      await sleep(3000);
      isDoneOAuth = true;
      break;
    }

    // Nếu quay về trang sign-up nhưng đã có token session
    if (currentUrl.includes("tabitoken.com")) {
      const hasSession = await activePage.evaluate(async () => {
        try {
          const res = await fetch("/api/user/auth/refresh", { method: "POST", credentials: "include" });
          const data = await res.json();
          return !!data.data?.access_token;
        } catch {
          return false;
        }
      }).catch(() => false);

      if (hasSession) {
        console.log("✅ Đã nhận được phiên đăng nhập TabiToken hợp lệ!");
        await sleep(3000);
        isDoneOAuth = true;
        break;
      }
    }

    // 2. Màn hình Đăng nhập GitHub
    const hasLoginField = await activePage.$("#login_field, input[name='login']").catch(() => null);
    if (currentUrl.includes("github.com/login") || hasLoginField) {
      const isReady = await activePage.waitForSelector("#login_field, input[name='login']", { visible: true, timeout: 60000 }).catch(() => null);
      if (!isReady) {
        console.log("⏳ Đang đợi form đăng nhập GitHub tải xong...");
        await sleep(2500);
        continue;
      }

      console.log(`📝 Đang điền tài khoản GitHub: ${account.email}...`);
      await typeHuman(activePage, "#login_field, input[name='login']", account.email);
      await sleep(300);

      console.log("🔑 Đang điền mật khẩu GitHub...");
      await typeHuman(activePage, "#password, input[name='password']", account.password);
      await sleep(400);

      console.log("-> Bấm 'Sign in'...");
      try {
        await Promise.all([
          activePage.click("input[type='submit'], button[type='submit']"),
          activePage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {}),
        ]);
      } catch {}
      await sleep(3000);
      continue;
    }

    // 3. Màn hình lỗi sai mật khẩu
    if (bodyText.includes("Incorrect username or password")) {
      throw new Error("Sai mật khẩu hoặc tài khoản GitHub!");
    }

    // 4. Màn hình tài khoản bị khóa
    if (bodyText.includes("This account is flagged") || bodyText.includes("Account suspended")) {
      throw new Error("Tài khoản GitHub bị FLAGGED/KHÓA không thể Authorize bên thứ 3!");
    }

    // 5. Màn hình 2FA TOTP
    const has2FaInput = await activePage.$("#app_totp, input[name='app_otp'], input[name='otp'], input[autocomplete='one-time-code']").catch(() => null);
    const is2FaScreen =
      currentUrl.includes("/two-factor") ||
      currentUrl.includes("/sessions/two-factor") ||
      bodyText.includes("Two-factor authentication") ||
      bodyText.includes("authenticator app") ||
      has2FaInput !== null;

    if (is2FaScreen) {
      if (!account.totpSecret) {
        throw new Error("2FA_INVALID: Tài khoản không có Secret Key 2FA");
      }

      let otpCode = "";
      try {
        otpCode = generateTotp(account.totpSecret);
      } catch (err) {
        throw new Error(`2FA_INVALID: Lỗi sinh mã OTP từ Secret Key (${err.message})`);
      }

      if (!otpCode || otpCode.length !== 6) {
        throw new Error("2FA_INVALID: Secret Key không tạo được mã 6 số hợp lệ");
      }

      await fillAndSubmitOtp(activePage, otpCode);
      await sleep(3500);

      // Kiểm tra xem GitHub có báo lỗi mã OTP 2FA sai không
      const flashError = await activePage.evaluate(() => {
        const el = document.querySelector(".flash-error, .flash-warn, #js-flash-container .flash");
        return el ? (el.innerText || el.textContent || "").trim() : "";
      }).catch(() => "");

      const pageText = await activePage.evaluate(() => document.body?.innerText || "").catch(() => "");
      const is2FaError =
        /invalid.*code|two-factor.*failed|incorrect.*code/i.test(flashError) ||
        /Two-factor authentication code is invalid|Two-factor authentication failed|The code you entered is invalid/i.test(pageText);

      if (is2FaError) {
        throw new Error(`2FA_INVALID: Mã 2FA bị GitHub từ chối (${flashError || "Mã 2FA không chính xác"})`);
      }

      continue;
    }

    // 6. Màn hình Authorize TabiToken OAuth (Nhận diện chính xác giao diện Authorize tabitoken)
    const isAuthorizeScreen =
      currentUrl.includes("/oauth/authorize") ||
      currentUrl.includes("/login/oauth") ||
      bodyText.includes("Authorize tabitoken") ||
      bodyText.includes("wants to access your") ||
      (await activePage.$("button[name='authorize'], #js-oauth-authorize-btn, input[name='authorize']").catch(() => null)) !== null;

    if (isAuthorizeScreen) {
      console.log("🔓 Tìm thấy màn hình 'Authorize tabitoken', đang bấm nút chấp thuận Authorize...");
      await sleep(1500); // Chờ nút Authorize sẵn sàng

      let clicked = false;
      try {
        const btnHandles = await activePage.$$("button, input[type='submit'], [role='button']");
        for (const h of btnHandles) {
          const txt = await activePage.evaluate((el) => (el.innerText || el.value || el.textContent || "").trim(), h);
          if (/Authorize/i.test(txt)) {
            await h.scrollIntoViewIfNeeded().catch(() => {});
            await h.click().catch(() => {});
            clicked = true;
            console.log(`👉 Đã click thành công nút: "${txt}"`);
            break;
          }
        }
      } catch {}

      if (!clicked) {
        await activePage.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, input[type='submit'], #js-oauth-authorize-btn, button[name='authorize']"));
          const authBtn = btns.find((b) => /Authorize/i.test(b.innerText || b.value || b.textContent || ""));
          if (authBtn) {
            authBtn.click();
            authBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          }
        }).catch(() => {});
      }

      await sleep(4000);
      continue;
    }

    await sleep(2000);
  }

  if (!isDoneOAuth) {
    throw new Error("Hết thời gian chờ liên kết OAuth với TabiToken.");
  }

  const pages = await browser.pages();
  return pages.find((p) => p.url().includes("tabitoken.com")) || page;
}

// ==============================================================================
// BƯỚC TẠO VÀ TRÍCH XUẤT API KEY
// ==============================================================================
async function createAndFetchApiKey(page, apiKeyName) {
  console.log(`📍 Đang mở trang quản lý API Keys...`);
  
  // 1. Thử click menu 'API Keys' trên thanh điều hướng để chuyển trang SPA mượt mà
  const clickedMenu = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a, button, [role='button'], [role='menuitem']"));
    const keyLink = links.find((el) => {
      const href = el.getAttribute("href") || "";
      const text = (el.innerText || el.textContent || "").trim().toLowerCase();
      return href.includes("/keys") || href.includes("/tokens") || text.includes("api key") || text === "keys";
    });
    if (keyLink) {
      keyLink.click();
      return true;
    }
    return false;
  }).catch(() => false);

  if (!clickedMenu && !page.url().includes("/keys")) {
    await safeNavigate(page, "https://tabitoken.com/keys", 3);
  }

  console.log("⏳ Chờ 4s cho trang quản lý Keys tải ổn định...");
  await sleep(4000);

  // 2. Thử bấm nút 'Create API Key' bằng Native Mouse Click của Puppeteer
  console.log("👆 Bấm nút 'Create API Key'...");
  try {
    const buttons = await page.$$("button, a, [role='button']");
    for (const btn of buttons) {
      const txt = await page.evaluate((el) => (el.innerText || el.textContent || "").trim(), btn);
      if (txt.includes("Create API Key") || txt.includes("Create New Key")) {
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click().catch(() => {});
        break;
      }
    }
  } catch {}

  await sleep(1500);

  // 3. Thử tìm và điền tên Key vào Modal UI nếu có mở
  try {
    const inputSelectors = [
      "[role='dialog'] input",
      "input[name='name']",
      "div.modal input",
      "input[placeholder*='name' i]",
      "input[placeholder*='key' i]",
      "input[type='text']",
    ];

    let foundInput = null;
    for (const s of inputSelectors) {
      foundInput = await page.waitForSelector(s, { visible: true, timeout: 3000 }).catch(() => null);
      if (foundInput) break;
    }

    if (foundInput) {
      console.log(`📝 Điền tên API Key vào UI dialog: ${apiKeyName}...`);
      await foundInput.click({ clickCount: 3 }).catch(() => {});
      await page.keyboard.press("Backspace").catch(() => {});
      for (const char of String(apiKeyName)) {
        await page.keyboard.type(char, { delay: 30 });
      }
      await sleep(500);

      // Bấm Save changes
      console.log("💾 Bấm 'Save changes'...");
      await page.evaluate(() => {
        const dialogBtns = Array.from(document.querySelectorAll("[role='dialog'] button, .modal button, button"));
        const saveBtn = dialogBtns.find((b) => /Save changes|Create|Submit|Save/i.test(b.innerText || b.textContent || ""));
        if (saveBtn) saveBtn.click();
      }).catch(() => {});

      await sleep(2000);
    }
  } catch {}

  // 4. Trích xuất hoặc tạo Key trực tiếp qua Session API với cơ chế tự động thử lại
  console.log("⚡ Đang xác thực session và lấy mã Secret API Key...");
  let lastError = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const result = await page.evaluate(async (name) => {
        // 4.1. Lấy Access Token từ session
        const refreshResponse = await fetch("/api/user/auth/refresh", {
          method: "POST",
          credentials: "include",
        });

        const refresh = await refreshResponse.json();
        const accessToken = refresh.data?.access_token;

        if (!accessToken) {
          throw new Error("Không lấy được token xác thực (access_token) từ Tabi Token");
        }

        const headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        };

        // 4.2. Lấy danh sách API Keys
        let listResponse = await fetch("/api/token/?p=1&size=100", {
          headers,
          credentials: "include",
        });
        let list = await listResponse.json();
        let items = list.data?.items || [];

        // 4.3. Nếu chưa thấy Key vừa tạo trong danh sách, gọi API POST tạo luôn
        let targetItem = items.find((entry) => entry.name === name) || items[0];
        if (!targetItem) {
          await fetch("/api/token/", {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({
              name: name,
              remain_quota: 500000,
              expired_time: -1,
              unlimited_quota: true,
            }),
          });

          // Lấy lại danh sách sau khi tạo
          listResponse = await fetch("/api/token/?p=1&size=100", { headers, credentials: "include" });
          list = await listResponse.json();
          items = list.data?.items || [];
          targetItem = items.find((entry) => entry.name === name) || items[0];
        }

        if (!targetItem) {
          throw new Error("Không tìm thấy hoặc tạo được API Key trên Tabi Token");
        }

        // 4.4. Lấy Secret Key raw
        const keyResponse = await fetch(`/api/token/${targetItem.id}/key`, {
          method: "POST",
          headers,
          credentials: "include",
        });

        const key = await keyResponse.json();
        if (!key.success || !key.data?.key) {
          throw new Error("API TabiToken không trả về giá trị raw secret key");
        }

        return {
          account: refresh.data.user?.username || refresh.data.user?.email || "unknown",
          apiKey: `sk-${key.data.key}`,
        };
      }, apiKeyName);

      if (result && result.apiKey) {
        return result;
      }
    } catch (err) {
      lastError = err;
      if (err.message.includes("destroyed") || err.message.includes("detached")) {
        console.log(`⏳ Đang đợi giao diện SPA ổn định (Lần thử ${attempt}/5)...`);
        await sleep(2000);
        continue;
      }
      throw err;
    }
  }

  if (lastError) throw lastError;
}

// ==============================================================================
// XỬ LÝ 1 TÀI KHOẢN TRÊN SHARDBROWSER PROFILE
// ==============================================================================
async function processAccountOnShardBrowser(shardClient, proxyClient, account, index, total) {
  const apiKeyName = `Key_${Date.now().toString().slice(-6)}`;
  console.log(`\n===========================================================`);
  console.log(`⏳ [${index}/${total}] BẮT ĐẦU: ${account.email}`);
  console.log(`===========================================================`);

  let profileId = null;
  let browser = null;

  try {
    // 1. Cấp IP Proxy xoay mới (luôn đảm bảo lấy IP còn hoạt động)
    let proxyData = null;
    if (proxyClient) {
      try {
        proxyData = await proxyClient.getNewProxy(true);
      } catch (pxErr) {
        console.warn(`[ProxyXoay Warning]: ${pxErr.message}`);
      }
    }

    // 2. Tạo Profile ShardBrowser riêng biệt gắn kèm Proxy xoay
    console.log(`🛡️ Đang tạo Profile ShardBrowser mới...`);
    profileId = await shardClient.createIsolatedProfile(account.email, proxyData);
    console.log(`✨ Đã tạo Profile ID: ${profileId}`);

    // 3. Khởi chạy Profile và kết nối CDP
    console.log(`🚀 Đang khởi chạy Profile qua ShardBrowser...`);
    const cdpUrl = await shardClient.startProfile(profileId);
    console.log(`🔗 Đang kết nối Puppeteer vào CDP...`);

    if (cdpUrl.startsWith("ws")) {
      browser = await puppeteer.connect({ browserWSEndpoint: cdpUrl, defaultViewport: null });
    } else {
      browser = await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null });
    }

    await sleep(2000); // Chờ trình duyệt và proxy socket sẵn sàng 100%

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    await page.bringToFront().catch(() => {});

    // 4. Thực hiện liên kết OAuth TabiToken (Tự động login GitHub + giải 2FA + Authorize)
    const tabiPage = await handleTabiTokenOAuthFlow(browser, page, account);

    // 5. Tạo và lấy API Key
    const result = await createAndFetchApiKey(tabiPage, apiKeyName);
    console.log(`\n\x1b[32m🎉 [${index}/${total}] THÀNH CÔNG: ${account.email}\x1b[0m`);
    console.log(`🔑 Account: ${result.account} | API Key: \x1b[33m${result.apiKey}\x1b[0m`);

    return {
      success: true,
      email: account.email,
      accountName: result.account,
      apiKey: result.apiKey,
      rawLine: account.rawLine,
      profileId: profileId,
    };
  } catch (error) {
    console.error(`\n\x1b[31m❌ [${index}/${total}] THẤT BẠI: ${account.email} | Lỗi: ${error.message}\x1b[0m`);
    const is2FaInvalid = error.message.includes("2FA_INVALID");
    return {
      success: false,
      email: account.email,
      error: error.message,
      rawLine: account.rawLine,
      is2FaInvalid: is2FaInvalid,
      profileId: profileId,
    };
  } finally {
    if (browser) {
      await browser.disconnect().catch(() => {});
    }
    if (profileId) {
      console.log(`🛑 Đang dừng Profile ShardBrowser ID: ${profileId}...`);
      await shardClient.stopProfile(profileId);
    }
  }
}

// Đọc danh sách các tài khoản đã có API Key để bỏ qua
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

// ==============================================================================
// MAIN ENTRY
// ==============================================================================
async function main() {
  const filePath = process.argv[2] || process.env.ACCOUNTS_FILE || DEFAULT_ACCOUNTS_FILE;

  console.log("===========================================================");
  console.log("🚀 TABITOKEN + SHARDBROWSER CDP BATCH RUNNER (AUTO PROXY XOAY)");
  console.log(`📁 File tài khoản: ${filePath}`);
  console.log(`🌐 Proxy API Key: ${PROXY_KEY}`);
  console.log("===========================================================");

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File tài khoản không tồn tại: ${filePath}`);
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
    console.log("✅ Toàn bộ tài khoản trong danh sách đã có API Key. Hoàn tất!");
    return;
  }

  const shardClient = new ShardBrowserClient();
  const defaultProxy = shardClient.getDefaultProxy();
  if (defaultProxy) {
    console.log(`🌐 [Proxy Cài Sẵn ShardBrowser]: Tự động nạp Proxy: \x1b[32m${defaultProxy.proxyString} (ID: ${defaultProxy.id})\x1b[0m`);
  } else {
    console.log("⚡ [Proxy]: Chạy Direct IP.");
  }
  const proxyClient = null;
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const res = await processAccountOnShardBrowser(shardClient, proxyClient, accounts[i], i + 1, accounts.length);
    results.push(res);

    if (res.success) {
      fs.appendFileSync(RESULT_TXT, `${res.email}|${res.apiKey}\n`, "utf-8");
    } else {
      if (res.is2FaInvalid || res.error?.includes("2FA_INVALID")) {
        fs.appendFileSync(RESULT_2FA_INVALID_TXT, `${res.rawLine || res.email}\n`, "utf-8");
        console.log(`⚠️ \x1b[33m[2FA SAI]: Đã lưu tài khoản vào: ${path.basename(RESULT_2FA_INVALID_TXT)} -> Tự động chuyển sang tài khoản tiếp theo!\x1b[0m`);
      }
      fs.appendFileSync(RESULT_TXT, `FAILED|${res.email}|${res.error}\n`, "utf-8");
    }

    if (i < accounts.length - 1) {
      await sleep(2500);
    }
  }

  fs.writeFileSync(RESULT_JSON, JSON.stringify(results, null, 2), "utf-8");

  const successCount = results.filter((r) => r.success).length;
  console.log("\n===========================================================");
  console.log(`🎉 HOÀN THÀNH TOÀN BỘ TIẾN TRÌNH:`);
  console.log(`   - Tổng tài khoản: ${results.length}`);
  console.log(`   - Thành công: \x1b[32m${successCount}\x1b[0m`);
  console.log(`   - Thất bại: \x1b[31m${results.length - successCount}\x1b[0m`);
  console.log(`   - Báo cáo TXT: ${RESULT_TXT}`);
  console.log(`   - Báo cáo JSON: ${RESULT_JSON}`);
  console.log("===========================================================");
}

main().catch((err) => {
  console.error("Lỗi chương trình:", err);
  process.exit(1);
});
