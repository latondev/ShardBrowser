const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");

// ==============================================================================
// 1. NẠP THƯ VIỆN ĐỘNG (PUPPETEER-CORE / AXIOS)
// ==============================================================================
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
        console.error(`❌ Không tìm thấy thư viện '${name}'. Vui lòng chạy npm install trong thư mục gốc hoặc thư mục hiện tại.`);
        process.exit(1);
      }
    }
  }
}

const puppeteer = requireModule("puppeteer-core");
const axios = requireModule("axios");

// ==============================================================================
// 2. CẤU HÌNH ĐƯỜNG DẪN & URL WAVESPEED
// ==============================================================================
const BASE_URL = "https://wavespeed.ai";
const SIGN_IN_URL = `${BASE_URL}/sign-in?redirect=${encodeURIComponent(BASE_URL + "/")}`;
const ACCESS_KEY_URL = `${BASE_URL}/accesskey`;
const SHARD_GROUP_NAME = "WaveSpeed";

const DEFAULT_ACCOUNTS_FILE = [
  path.resolve(__dirname, "accounts.txt"),
  path.resolve(__dirname, "../git/hotmail/github_accounts.txt"),
  path.resolve(__dirname, "../tabitoken/accounts.txt"),
].find((f) => fs.existsSync(f)) || path.resolve(__dirname, "accounts.txt");

const RESULT_TXT = path.resolve(__dirname, "results_wavespeed.txt");
const RESULT_JSON = path.resolve(__dirname, "results_wavespeed.json");
const RESULT_2FA_INVALID_TXT = path.resolve(__dirname, "wavespeed_2fa_invalid.txt");
const RESULT_FLAGGED_TXT = path.resolve(__dirname, "github_flagged_accounts.txt");
const ARTIFACTS_DIR = path.resolve(__dirname, "artifacts");

// ==============================================================================
// 3. TIỆN ÍCH CHỜ & ĐỘ ỔN ĐỊNH MẠNG (IDLE NETWORKING + CHỜ 2S)
// ==============================================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chờ mạng tĩnh (Idle Networking) và nghỉ thêm 2 giây để DOM & server ổn định hoàn toàn
 */
async function waitForStepReady(page, delayMs = 2000) {
  try {
    if (page && typeof page.waitForNetworkIdle === "function") {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 12000 }).catch(() => {});
    }
  } catch {}
  await sleep(delayMs);
}

async function saveScreenshot(page, filename) {
  try {
    if (!fs.existsSync(ARTIFACTS_DIR)) {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    }
    const fullPath = path.join(ARTIFACTS_DIR, filename);
    await page.screenshot({ path: fullPath, fullPage: true });
    return fullPath;
  } catch (err) {
    console.warn(`⚠️ Không lưu được ảnh màn hình: ${err.message}`);
    return null;
  }
}

// ==============================================================================
// 4. GIẢI MÃ TOTP 2FA (RFC 6238) TỰ ĐỘNG BẰNG CRYPTO
// ==============================================================================
function base32ToBuffer(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = (value || "").replace(/[ =-]/g, "").toUpperCase();
  let bits = "";

  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Secret 2FA không hợp lệ (ký tự '${char}')`);
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

// ==============================================================================
// 5. PHÁT HIỆN TÀI KHOẢN GITHUB BỊ CỜ / KHÓA (FLAGGED ACCOUNT DETECTOR)
// ==============================================================================
const restrictionPattern = /(?:this account is flagged[\s\S]{0,500}cannot authorize a third party application|cannot authorize a third party application)/i;

function detectGithubRestriction(text) {
  return restrictionPattern.test(text || "");
}

// ==============================================================================
// 6. KIỂM TRA PROXY SỐNG & ĐỘ TRỄ < 1.5S TỪ SHARDBROWSER
// ==============================================================================
async function checkProxyFastAndLive(proxy, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    let isDone = false;
    const finish = (val) => {
      if (!isDone) {
        isDone = true;
        resolve(val);
      }
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    const host = proxy.host;
    const port = Number(proxy.port);
    const kind = (proxy.kind || "http").toLowerCase();

    if (!host || !port || isNaN(port)) return finish(false);

    const socket = net.connect({ host, port }, () => {
      if (kind === "socks5") {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      } else {
        let authHeader = "";
        if (proxy.username && proxy.password) {
          const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");
          authHeader = `Proxy-Authorization: Basic ${auth}\r\n`;
        }
        socket.write(`CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n${authHeader}\r\n`);
      }
    });

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      finish(false);
    });

    socket.on("data", (buf) => {
      if (kind === "socks5") {
        clearTimeout(timer);
        socket.destroy();
        const latency = Date.now() - start;
        if (buf[0] === 0x05 && (buf[1] === 0x00 || buf[1] === 0x02)) {
          if (latency > 1500) finish({ alive: false, tooSlow: true, latency });
          else finish({ alive: true, latency });
        } else finish(false);
      } else {
        const text = buf.toString("utf-8");
        if (text.includes("200") || text.toLowerCase().includes("connection established")) {
          const tlsSocket = tls.connect({
            socket,
            servername: "github.com",
            rejectUnauthorized: true,
          }, () => {
            clearTimeout(timer);
            const latency = Date.now() - start;
            tlsSocket.destroy();
            socket.destroy();
            if (latency > 1500) finish({ alive: false, tooSlow: true, latency });
            else finish({ alive: true, latency });
          });

          tlsSocket.on("error", (tlsErr) => {
            clearTimeout(timer);
            tlsSocket.destroy();
            socket.destroy();
            finish({ alive: false, sslError: tlsErr.message });
          });
        } else {
          clearTimeout(timer);
          socket.destroy();
          finish(false);
        }
      }
    });

    socket.on("error", () => {
      clearTimeout(timer);
      socket.destroy();
      finish(false);
    });
  });
}

// ==============================================================================
// 7. QUẢN LÝ PROFILE & CDP SHARDBROWSER (GROUP: "WaveSpeed")
// ==============================================================================
class ShardProfileManager {
  constructor(groupName = SHARD_GROUP_NAME) {
    this.groupName = groupName;
    this.apiUrl = null;
    this.headers = null;
    this.currentProfileId = null;
    this.loadConfig();
  }

  loadConfig() {
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

    this.apiUrl = process.env.LAUNCHER_API_URL || `http://127.0.0.1:${port}`;
    this.headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async fetchApi(endpoint, method = "GET", body = null) {
    const url = `${this.apiUrl}${endpoint}`;
    const options = { method, headers: this.headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(url, options);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`ShardBrowser API Lỗi (${res.status}): ${errText || res.statusText}`);
    }
    return res.json();
  }

  async findFastLiveProxy(maxTests = 20) {
    try {
      const proxies = await this.fetchApi("/proxies", "GET");
      if (!Array.isArray(proxies) || proxies.length === 0) {
        console.log("ℹ️ [Proxy Pool] Không có proxy trong ShardBrowser (sử dụng Direct IP).");
        return null;
      }

      console.log(`🌐 [Proxy Pool] Tìm thấy ${proxies.length} proxy trong ShardBrowser. Đang kiểm tra độ trễ < 1.5s...`);
      const shuffled = [...proxies].sort(() => Math.random() - 0.5);
      const limit = Math.min(shuffled.length, maxTests);
      const batchSize = 4;

      for (let i = 0; i < limit; i += batchSize) {
        const batch = shuffled.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (candidate) => {
            const res = await checkProxyFastAndLive(candidate, 2500);
            return { candidate, res };
          })
        );

        const passed = batchResults.find((r) => r.res && r.res.alive && r.res.latency <= 1500);
        if (passed) {
          const { candidate, res } = passed;
          candidate._verifiedLatency = res.latency;
          console.log(`   \x1b[32m[✓ PROXY LIVE & NHANH]\x1b[0m [${candidate.name || candidate.host + ':' + candidate.port}] (ping: ${res.latency}ms <= 1500ms) -> Gán vào Profile!`);
          return candidate;
        }
      }
    } catch (err) {
      console.warn(`⚠️ [Proxy Pool] Không thể kiểm tra proxy: ${err.message}`);
    }
    return null;
  }

  async createProfile(accountEmail, reuseExisting = true) {
    const cleanName = (accountEmail || "User").split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_");
    const profileBaseName = `Wave_${cleanName}`;
    const targetFolder = this.groupName.trim().toLowerCase();

    // 1. Kiểm tra xem profile đã có trong group "WaveSpeed" chưa để tái sử dụng
    if (reuseExisting) {
      try {
        const profiles = await this.fetchApi("/profiles", "GET");
        if (Array.isArray(profiles)) {
          const existing = profiles.find((p) => {
            const pFolder = (p.folder || "").trim().toLowerCase();
            const pName = (p.name || "").trim().toLowerCase();
            const pNotes = (p.notes || "").toLowerCase();
            return pFolder === targetFolder && (pName === profileBaseName.toLowerCase() || pNotes.includes((accountEmail || "").toLowerCase()));
          });
          if (existing) {
            console.log(`🛡️ [ShardBrowser] Tái sử dụng Profile có sẵn trong group [${this.groupName}]: [${existing.name}] ID [${existing.id}]`);
            this.currentProfileId = existing.id;
            return existing.id;
          }
        }
      } catch (err) {
        console.warn(`[ShardBrowser] Không kiểm tra được profile cũ: ${err.message}`);
      }
    }

    // 2. Tạo mới profile
    let fingerprint = {};
    try {
      const fpRes = await this.fetchApi("/fingerprint/new/windows", "GET");
      if (fpRes && typeof fpRes === "object") {
        fingerprint = fpRes.fingerprint || fpRes;
      }
    } catch {}

    const fpObj = fingerprint && typeof fingerprint === "object" ? { ...fingerprint } : {};
    if (!fpObj.navigator || typeof fpObj.navigator !== "object") {
      fpObj.navigator = {};
    }
    fpObj.navigator.language = "en-US";
    fpObj.navigator.accept_language = "en-US,en;q=0.9";
    fpObj.navigator.languages = ["en-US", "en"];
    fpObj.icu_locale = "en-US";

    const selectedProxy = await this.findFastLiveProxy();

    const profilePayload = {
      name: profileBaseName,
      folder: this.groupName,
      notes: `WaveSpeed Profile cho ${accountEmail}${selectedProxy ? ` | Proxy [${selectedProxy.name || selectedProxy.host + ':' + selectedProxy.port}] (${selectedProxy._verifiedLatency}ms)` : ''}`,
      fingerprint: fpObj,
    };

    if (selectedProxy && selectedProxy.id) {
      profilePayload.proxy_id = selectedProxy.id;
    }

    const created = await this.fetchApi("/profiles", "POST", profilePayload);
    console.log(`🛡️ [ShardBrowser] Đã tạo Profile mới: [${profileBaseName}] ID [${created.id}] trong group [${this.groupName}]${selectedProxy ? ` (Proxy: ${selectedProxy.host}:${selectedProxy.port})` : ''}`);
    this.currentProfileId = created.id;
    return created.id;
  }

  async startBrowser(isHeadless = false) {
    if (!this.currentProfileId) throw new Error("Chưa có Profile ID để khởi động!");
    const startRes = await this.fetchApi(`/profiles/${this.currentProfileId}/start`, "POST", { headless: isHeadless });
    const wsUrl = startRes.cdp?.web_socket_debugger_url;
    if (wsUrl) {
      console.log(`🚀 [ShardBrowser] Khởi chạy thành công qua CDP: ${wsUrl}`);
      return wsUrl;
    }
    if (startRes.cdp?.port) {
      const cdpUrl = `http://127.0.0.1:${startRes.cdp.port}`;
      console.log(`🚀 [ShardBrowser] Khởi chạy thành công qua CDP URL: ${cdpUrl}`);
      return cdpUrl;
    }
    throw new Error(`Không nhận được WebSocket CDP từ ShardBrowser: ${JSON.stringify(startRes)}`);
  }

  async stopBrowser() {
    if (!this.currentProfileId) return;
    try {
      await this.fetchApi(`/profiles/${this.currentProfileId}/stop`, "POST", {}).catch(() => {});
      console.log(`⏹️ [ShardBrowser] Đã dừng phiên trình duyệt Profile ID [${this.currentProfileId}] (Lưu giữ profile trong group "${this.groupName}")`);
    } catch (err) {
      console.warn(`⚠️ Lỗi khi dừng Profile: ${err.message}`);
    }
  }
}

// ==============================================================================
// 8. TƯƠNG TÁC THỰC TẾ TRÊN DOM (HUMAN-LIKE TYPING & CLICK)
// ==============================================================================
async function safeQuery(page, selector) {
  try {
    return await page.$(selector);
  } catch {
    return null;
  }
}

async function humanType(page, selector, text) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout: 5000 });
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    for (const ch of String(text || "")) {
      await page.keyboard.type(ch, { delay: Math.floor(Math.random() * 25) + 15 });
    }
  } catch {
    await page.evaluate((sel, val) => {
      const input = document.querySelector(sel);
      if (input) {
        input.value = val;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
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

  if (!clicked) {
    throw new Error(`Không tìm thấy phần tử có chữ: ${pattern}`);
  }
}

// ==============================================================================
// 9. XỬ LÝ TOÀN DIỆN LUỒNG XÁC THỰC GITHUB CHO WAVESPEED
// ==============================================================================
async function handleGithubAuthFlow(page, account) {
  console.log(`🌐 [GitHub Auth] Bắt đầu kiểm tra và xác thực tài khoản: ${account.email}...`);

  for (let step = 0; step < 60; step++) {
    let currentUrl = "";
    let pageText = "";
    try {
      currentUrl = page.url();
      pageText = await page.evaluate(() => document.body?.innerText || "");
    } catch {
      await sleep(1000);
      continue;
    }

    // 1. Kiểm tra đã quay về WaveSpeed (Dashboard hoặc Callback)
    if (currentUrl.includes("wavespeed.ai") && !currentUrl.includes("sign-in")) {
      if (currentUrl.includes("/center/default/github/callback") || /dashboard/i.test(pageText) || currentUrl.includes("/accesskey")) {
        console.log(`✅ [WaveSpeed] Đã xác thực thành công và quay lại WaveSpeed: ${currentUrl}`);
        await waitForStepReady(page, 2000);
        return;
      }
    }

    // 2. PHÁT HIỆN TÀI KHOẢN GITHUB BỊ CỜ / KHÓA BỞI GITHUB
    if (currentUrl.includes("github.com") && detectGithubRestriction(pageText)) {
      const cleanEmail = account.email.replace(/[^a-zA-Z0-9_-]/g, "_");
      await saveScreenshot(page, `github-flagged-${cleanEmail}.png`);
      console.error(`❌ [BLOCKED] Tài khoản GitHub [${account.email}] bị hạn chế (Account Flagged) không thể ủy quyền OAuth!`);
      throw new Error("BLOCKED_ACCOUNT_FLAGGED: GitHub blocked third-party OAuth authorization");
    }

    // 3. Màn hình điền Email / Password GitHub
    const loginField = await safeQuery(page, "#login_field, input[name='login']");
    if (loginField && currentUrl.includes("github.com")) {
      console.log(`🔑 [GitHub Login] Điền email [${account.email}]...`);
      await humanType(page, "#login_field, input[name='login']", account.email);
      await sleep(300);
      await humanType(page, "#password, input[name='password']", account.password);
      await sleep(500);

      const submitBtn = await safeQuery(page, "input[type='submit'], button[type='submit']");
      if (submitBtn) await submitBtn.click();
      else await page.keyboard.press("Enter");

      console.log("   -> Đã bấm 'Sign in'. Chờ ổn định mạng và 2s...");
      await waitForStepReady(page, 2000);
      continue;
    }

    // 4. Nếu GitHub ở màn hình chọn phương thức 2FA khác -> Chuyển sang Authenticator App
    if (currentUrl.includes("github.com/sessions/two-factor")) {
      const switched = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("button, a, [data-hydro-click*='authenticator']"));
        for (const el of links) {
          const txt = (el.innerText || el.textContent || "").toLowerCase();
          if (txt.includes("use an authenticator app") || txt.includes("authenticator app")) {
            el.click();
            return true;
          }
        }
        return false;
      });
      if (switched) {
        console.log("🔄 Chuyển sang phương thức Authenticator App TOTP...");
        await waitForStepReady(page, 2000);
      }
    }

    // 5. Xử lý 2FA TOTP (6 số)
    const totpField = await safeQuery(page, "#app_totp, input[name='otp'], input[name='app_totp'], input[autocomplete='one-time-code'], input[placeholder*='6-digit']");
    if (totpField && currentUrl.includes("github.com")) {
      if (!account.totpSecret) {
        throw new Error("2FA_MISSING_SECRET: Tài khoản yêu cầu mã 2FA TOTP nhưng không có secret");
      }
      const code = getTotpCode(account.totpSecret);
      console.log(`🔐 [2FA TOTP] Nhập mã 6 số: [ ${code} ]...`);
      await humanType(page, "#app_totp, input[name='otp'], input[name='app_totp'], input[autocomplete='one-time-code']", code);
      await sleep(300);

      // Thử bấm Verify hoặc Enter
      const verifyBtn = await safeQuery(page, "button:has-text('Verify'), input[value*='Verify'], button[type='submit']");
      if (verifyBtn) await verifyBtn.click();
      else await page.keyboard.press("Enter");

      console.log("   -> Đã gửi mã 2FA. Chờ ổn định mạng và 2s...");
      await waitForStepReady(page, 2000);
      continue;
    }

    // 6. Bỏ qua màn hình Passkey / Trusted Device ("Ask me later")
    if (currentUrl.includes("/trusted-device") || /trusted-device|passkey/i.test(currentUrl) || /ask me later/i.test(pageText)) {
      const skipped = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll("button, a, input[type='submit'], input[type='button'], [role='button']"));
        for (const el of candidates) {
          const txt = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
          if (txt.includes("ask me later") || txt.includes("not now") || txt.includes("don't ask again")) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.click();
            return true;
          }
        }
        const declineForm = document.querySelector("form[action*='/sessions/trusted-device/decline'], form[action*='decline']");
        if (declineForm) {
          const submitBtn = declineForm.querySelector("button, input[type='submit']");
          if (submitBtn) {
            submitBtn.click();
            return true;
          }
          declineForm.submit();
          return true;
        }
        return false;
      }).catch(() => false);

      if (skipped) {
        console.log("⏩ [Passkey / Device] Bấm 'Ask me later' thành công!");
        await waitForStepReady(page, 2000);
        continue;
      }
    }

    // 7. Sudo mode (nếu GitHub yêu cầu nhập lại mật khẩu trước khi authorize)
    const sudoField = await safeQuery(page, "#sudo_password, input[name='sudo_password']");
    if (sudoField) {
      console.log("🔑 [Sudo Mode] Xác nhận lại mật khẩu GitHub...");
      await humanType(page, "#sudo_password, input[name='sudo_password']", account.password);
      await sleep(400);
      const confirmBtn = await safeQuery(page, "button:has-text('Confirm password'), input[value*='Confirm password']");
      if (confirmBtn) await confirmBtn.click();
      else await page.keyboard.press("Enter");

      await waitForStepReady(page, 2000);
      continue;
    }

    // 8. Trang ủy quyền OAuth ("Authorize WaveSpeedAI")
    if (/authorize wavespeedai/i.test(pageText) || currentUrl.includes("/login/oauth/authorize")) {
      console.log("⚡ [OAuth Consent] Phát hiện trang ủy quyền WaveSpeed. Bấm 'Authorize wavespeedai'...");
      try {
        await page.evaluate(() => {
          const btn = document.querySelector("#js-oauth-authorize-btn, button[name='authorize'], input[name='authorize']");
          if (btn) {
            btn.disabled = false;
            btn.click();
          }
        });
        await clickText(page, /^authorize wavespeedai$/).catch(() => {});
      } catch {}

      console.log("   -> Đã bấm ủy quyền. Chờ ổn định mạng và 2s...");
      await waitForStepReady(page, 2000);
      continue;
    }

    await sleep(1500);
  }

  throw new Error("TIMEOUT: Hết thời gian chờ xác thực GitHub và chuyển hướng WaveSpeed (90s)");
}

// ==============================================================================
// 10. THỰC HIỆN TỪNG BƯỚC WAVESPEED FLOW (CHỜ 2S & IDLE NETWORKING Ở MỖI BƯỚC)
// ==============================================================================
async function executeWaveSpeedFlow(page, account, keyName) {
  console.log(`\n-----------------------------------------------------------`);
  console.log(`🚀 [BƯỚC 1/6] Mở trang đăng nhập WaveSpeed: ${SIGN_IN_URL}...`);
  await page.goto(SIGN_IN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitForStepReady(page, 2000);

  console.log(`🚀 [BƯỚC 2/6] Bấm 'Sign in with GitHub'...`);
  let clickedGithub = false;
  try {
    await page.waitForSelector('button[aria-label="Sign in with GitHub"], button:has-text("Sign in with GitHub")', { timeout: 15000 });
    clickedGithub = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Sign in with GitHub"]') ||
        Array.from(document.querySelectorAll('button')).find(b => /sign in with github/i.test(b.innerText || ""));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
  } catch {}

  if (!clickedGithub) {
    await clickText(page, /sign in with github/i);
  }
  console.log("   -> Đã bấm 'Sign in with GitHub'. Chờ chuyển hướng & ổn định 2s...");
  await waitForStepReady(page, 2000);

  console.log(`🚀 [BƯỚC 3/6] Xử lý xác thực đăng nhập GitHub & Authorize...`);
  await handleGithubAuthFlow(page, account);

  // Đảm bảo đã tải vào WaveSpeed
  console.log(`🚀 [BƯỚC 4/6] Chuyển hướng tới trang tạo Access Key (${ACCESS_KEY_URL})...`);
  await page.goto(ACCESS_KEY_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitForStepReady(page, 2000);

  console.log(`🚀 [BƯỚC 5/6] Bấm 'Create Key' & điền tên: [${keyName}]...`);
  await page.waitForSelector('button', { timeout: 30000 });
  await clickText(page, /^create key$/);
  await waitForStepReady(page, 2000);

  // Điền tên Key vào input
  await page.waitForSelector('input[placeholder="Enter key name"]', { timeout: 15000 });
  await page.evaluate((name) => {
    const input = document.querySelector('input[placeholder="Enter key name"]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, name);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, keyName);

  // Gõ thêm bằng bàn phím để chắc chắn
  try {
    const inputHandle = await page.$('input[placeholder="Enter key name"]');
    if (inputHandle) {
      await inputHandle.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.keyboard.type(keyName, { delay: 25 });
    }
  } catch {}

  await waitForStepReady(page, 2000);

  // Bấm Create Key lần thứ hai để xác nhận tạo
  console.log("   -> Xác nhận tạo Key (bấm 'Create Key')...");
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    const confirmBtn = buttons.find((b) => /^(create key|confirm|submit)$/i.test((b.innerText || "").trim()));
    if (confirmBtn) confirmBtn.click();
  });
  await waitForStepReady(page, 2000);

  console.log(`🚀 [BƯỚC 6/6] Trích xuất Secret API Key từ thẻ <code>...`);
  await page.waitForFunction(
    () => /copy and save this api key/i.test(document.body.innerText || ""),
    { timeout: 20000 }
  );

  const apiKey = await page.$eval("code", (el) => el.textContent.trim());
  if (!apiKey || apiKey.length < 10) {
    throw new Error("Không thể trích xuất API Key từ thẻ <code>");
  }

  // Tùy chọn: bấm nút đóng modal hoặc Done nếu có
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const closeBtn = buttons.find((b) => /^(done|close|confirm|ok)$/i.test((b.innerText || "").trim()));
    if (closeBtn) closeBtn.click();
  }).catch(() => {});

  await waitForStepReady(page, 2000);

  return {
    account: account.email,
    apiKey,
    keyName,
  };
}

// ==============================================================================
// 11. XỬ LÝ ĐƠN LẺ TỪNG TÀI KHOẢN (PROCESS ACCOUNT)
// ==============================================================================
async function processAccount(shardManager, account, index, total, isHeadless) {
  const keyName = `Key_${Date.now().toString().slice(-6)}`;
  console.log(`\n===========================================================`);
  console.log(`⏳ [${index}/${total}] BẮT ĐẦU XỬ LÝ: ${account.email}`);
  console.log(`===========================================================`);

  let browser = null;
  let useShard = true;

  try {
    // 1. Tạo/Tái sử dụng Profile trong ShardBrowser (kèm Proxy nếu có)
    let cdpEndpoint = null;
    try {
      await shardManager.createProfile(account.email, true);
      cdpEndpoint = await shardManager.startBrowser(isHeadless);
    } catch (shardErr) {
      console.warn(`⚠️ Không khởi động được qua ShardBrowser Launcher (${shardErr.message}).`);
      console.log(`ℹ️ Chuyển sang chế độ Fallback: Khởi chạy Puppeteer cục bộ...`);
      useShard = false;
    }

    if (useShard && cdpEndpoint) {
      console.log(`🔗 Đang kết nối Puppeteer vào CDP ShardBrowser...`);
      if (cdpEndpoint.startsWith("ws")) {
        browser = await puppeteer.connect({ browserWSEndpoint: cdpEndpoint, defaultViewport: null, protocolTimeout: 300000 });
      } else {
        browser = await puppeteer.connect({ browserURL: cdpEndpoint, defaultViewport: null, protocolTimeout: 300000 });
      }
    } else {
      const cleanEmail = account.email.replace(/[^a-zA-Z0-9_-]/g, "_");
      const profileDir = path.resolve(__dirname, ".puppeteer-profile", cleanEmail);
      browser = await puppeteer.launch({
        headless: isHeadless,
        userDataDir: profileDir,
        defaultViewport: null,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--lang=en-US,en",
        ],
      });
    }

    await sleep(2000);

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    page.setDefaultTimeout(40000);

    // Cấu hình ngôn ngữ tiếng Anh & bỏ qua lỗi SSL
    try {
      await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" }).catch(() => {});
      const client = await page.target().createCDPSession();
      await client.send("Security.setIgnoreCertificateErrors", { ignore: true }).catch(() => {});
    } catch {}

    await page.bringToFront().catch(() => {});

    // 2. Thực hiện luồng WaveSpeed Flow
    const result = await executeWaveSpeedFlow(page, account, keyName);

    console.log(`\n\x1b[32m🎉 [${index}/${total}] THÀNH CÔNG: ${account.email}\x1b[0m`);
    console.log(`🔑 Key Name: ${result.keyName} | API Key: \x1b[33m${result.apiKey}\x1b[0m`);

    return {
      success: true,
      email: account.email,
      keyName: result.keyName,
      apiKey: result.apiKey,
      rawLine: account.rawLine,
    };
  } catch (error) {
    console.error(`\n\x1b[31m❌ [${index}/${total}] THẤT BẠI: ${account.email} | Lỗi: ${error.message}\x1b[0m`);
    const is2FaInvalid = error.message.includes("2FA") || error.message.includes("TOTP");
    const isFlagged = error.message.includes("BLOCKED_ACCOUNT_FLAGGED");

    return {
      success: false,
      email: account.email,
      error: error.message,
      rawLine: account.rawLine,
      is2FaInvalid,
      isFlagged,
    };
  } finally {
    if (browser) {
      if (useShard) {
        await browser.disconnect().catch(() => {});
      } else {
        await browser.close().catch(() => {});
      }
    }
    if (useShard) {
      await shardManager.stopBrowser();
    }
  }
}

// ==============================================================================
// 12. BỘ LỌC TÀI KHOẢN ĐÃ HOÀN THÀNH (RESUME/SKIP CHECK)
// ==============================================================================
function loadCompletedAccounts(resultFilePath) {
  const completed = new Set();
  if (!fs.existsSync(resultFilePath)) return completed;
  const lines = fs.readFileSync(resultFilePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("FAILED") || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("|");
    if (parts.length >= 2 && parts[1].length > 10) {
      completed.add(parts[0].trim().toLowerCase());
    }
  }
  return completed;
}

// ==============================================================================
// 13. HÀM MAIN BATCH RUNNER
// ==============================================================================
async function main() {
  const filePath = process.argv[2] || process.env.ACCOUNTS_FILE || DEFAULT_ACCOUNTS_FILE;
  const isHeadless = process.env.HEADLESS === "true";

  console.log("===========================================================");
  console.log("🚀 WAVESPEED BATCH RUNNER (SHARDBROWSER + CDP + WAVESPEED KEY AUTO)");
  console.log(`📁 File danh sách tài khoản: ${filePath}`);
  console.log(`🖥 Chế độ Headless: ${isHeadless} (HEADLESS=true để chạy ẩn)`);
  console.log(`⏱️ Thời gian ổn định mỗi bước: 2s + Idle Networking`);
  console.log("===========================================================");

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Không tìm thấy file tài khoản: ${filePath}`);
    console.log(`💡 Hãy tạo file 'accounts.txt' (xem mẫu tại 'accounts.example.txt') hoặc truyền đường dẫn file:`);
    console.log(`   node batch_runner.js path/to/accounts.txt`);
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

  const shardManager = new ShardProfileManager(SHARD_GROUP_NAME);
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const res = await processAccount(shardManager, accounts[i], i + 1, accounts.length, isHeadless);
    results.push(res);

    if (res.success) {
      fs.appendFileSync(RESULT_TXT, `${res.email}|${res.apiKey}\n`, "utf-8");
      console.log(`💾 Đã lưu API Key vào: ${path.basename(RESULT_TXT)}`);
    } else {
      if (res.is2FaInvalid) {
        fs.appendFileSync(RESULT_2FA_INVALID_TXT, `${res.rawLine || res.email}\n`, "utf-8");
        console.log(`⚠️ \x1b[33m[2FA LỖI]: Đã lưu tài khoản vào: ${path.basename(RESULT_2FA_INVALID_TXT)}\x1b[0m`);
      }
      if (res.isFlagged) {
        fs.appendFileSync(RESULT_FLAGGED_TXT, `${res.rawLine || res.email}\n`, "utf-8");
        console.log(`🚫 \x1b[31m[TÀI KHOẢN BỊ CỜ]: Đã lưu tài khoản vào: ${path.basename(RESULT_FLAGGED_TXT)}\x1b[0m`);
      }
      fs.appendFileSync(RESULT_TXT, `FAILED|${res.email}|${res.error}\n`, "utf-8");
    }

    // Nghỉ ngẫu nhiên giữa các tài khoản để bảo vệ IP và tránh rate-limit
    if (i < accounts.length - 1) {
      const waitSeconds = Math.floor(Math.random() * (18 - 10 + 1)) + 10;
      console.log(`\n⏳ [Nghỉ giải lao] Đang chờ ${waitSeconds}s trước khi chuyển sang tài khoản tiếp theo...`);
      await sleep(waitSeconds * 1000);
    }
  }

  fs.writeFileSync(RESULT_JSON, JSON.stringify(results, null, 2), "utf-8");

  const successCount = results.filter((r) => r.success).length;
  console.log("\n===========================================================");
  console.log(`🎉 HOÀN THÀNH TOÀN BỘ TIẾN TRÌNH:`);
  console.log(`   - Tổng tài khoản xử lý: ${results.length}`);
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
