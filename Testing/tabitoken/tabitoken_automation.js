const { chromium } = require("playwright");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const tls = require("node:tls");

const SIGNUP_URL = "https://tabitoken.com/sign-up?aff=rm5l";
const API_KEY_NAME = process.env.TABITOKEN_API_KEY_NAME || "Auto_API_Key_01";
const SHARD_GROUP_NAME = "Daily Tokken";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

// ==============================================================================
// SHARDBROWSER CDP & PROFILE HELPER (Group: "Daily Tokken", KHÔNG XÓA PROFILE)
// ==============================================================================
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
    const errorText = await res.text().catch(() => "");
    throw new Error(`ShardBrowser API Lỗi (${res.status}): ${errorText || res.statusText}`);
  }
  return res.json();
}

// ==============================================================================
// KIỂM TRA PROXY SỐNG & LỌC ĐỘ TRỄ < 1.5s (1500ms) TỪ SHARDBROWSER
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

async function findFastLiveProxyFromShard(apiUrl, headers, maxTests = 30) {
  try {
    const proxies = await fetchShardApi(apiUrl, headers, "/proxies", "GET");
    if (!Array.isArray(proxies) || proxies.length === 0) {
      console.log("ℹ️ [Proxy Pool] Không có proxy nào trong ShardBrowser (dùng Direct IP).");
      return null;
    }

    console.log(`🌐 [Proxy Pool] Tìm thấy ${proxies.length} proxy trong ShardBrowser. Bắt đầu xáo trộn ngẫu nhiên và kiểm tra độ trễ < 1.5s (1500ms)...`);
    const shuffled = [...proxies].sort(() => Math.random() - 0.5);
    const limit = Math.min(shuffled.length, maxTests);
    const batchSize = 4;

    for (let i = 0; i < limit; i += batchSize) {
      const batch = shuffled.slice(i, i + batchSize);
      console.log(`🔍 [Đang kiểm tra Batch ${Math.floor(i / batchSize) + 1}] (${batch.map(p => p.name || `${p.host}:${p.port}`).join(", ")})... (lọc < 1.5s)`);

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
        console.log(`   \x1b[32m[✓ PROXY LIVE & NHANH]\x1b[0m Đã chọn [${candidate.name || candidate.host + ':' + candidate.port}] (ping: ${res.latency}ms <= 1500ms) -> Gán vào Profile!`);
        return candidate;
      }

      for (const item of batchResults) {
        if (item.res && item.res.tooSlow) {
          console.log(`   \x1b[33m[✗ BỎ QUA - CHẬM]\x1b[0m [${item.candidate.name || item.candidate.host + ':' + item.candidate.port}] ping ${item.res.latency}ms > 1500ms`);
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ [Proxy Pool] Lỗi khi lấy hoặc kiểm tra proxy: ${err.message}`);
  }
  return null;
}

async function getOrCreateShardProfile(apiUrl, headers, accountEmail) {
  const cleanName = (accountEmail || "User").split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_");
  const profileBaseName = `Tabi_${cleanName}`;
  const targetFolder = SHARD_GROUP_NAME.trim().toLowerCase();

  // 1. Kiểm tra xem Profile đã có trong group "Daily Tokken" chưa để tái sử dụng (không xóa profile)
  try {
    const profiles = await fetchShardApi(apiUrl, headers, "/profiles", "GET");
    if (Array.isArray(profiles)) {
      const existing = profiles.find((p) => {
        const pFolder = (p.folder || "").trim().toLowerCase();
        const pName = (p.name || "").trim().toLowerCase();
        const pNotes = (p.notes || "").toLowerCase();
        return pFolder === targetFolder && (pName === profileBaseName.toLowerCase() || pNotes.includes((accountEmail || "").toLowerCase()));
      });
      if (existing) {
        console.log(`🛡️ [ShardBrowser] Tái sử dụng Profile có sẵn trong group [${SHARD_GROUP_NAME}]: [${existing.name}] ID [${existing.id}]`);
        return existing.id;
      }
    }
  } catch (err) {
    console.warn(`[ShardBrowser] Không kiểm tra được profile cũ: ${err.message}`);
  }

  // 2. Tạo mới profile trong group "Daily Tokken" nếu chưa có
  let fingerprint = {};
  try {
    const fpRes = await fetchShardApi(apiUrl, headers, "/fingerprint/new/windows", "GET");
    if (fpRes && typeof fpRes === "object") {
      fingerprint = fpRes.fingerprint || fpRes;
    }
  } catch (e) {
    console.warn(`[ShardBrowser] Dùng Fingerprint mặc định (${e.message}).`);
  }

  const fpObj = fingerprint && typeof fingerprint === "object" ? { ...fingerprint } : {};
  if (!fpObj.navigator || typeof fpObj.navigator !== "object") {
    fpObj.navigator = {};
  }
  fpObj.navigator.language = "en-US";
  fpObj.navigator.accept_language = "en-US,en;q=0.9";
  fpObj.navigator.languages = ["en-US", "en"];
  fpObj.icu_locale = "en-US";

  // Tìm 1 proxy sống và độ trễ < 1.5s (1500ms) có sẵn trong ShardBrowser
  const selectedProxy = await findFastLiveProxyFromShard(apiUrl, headers);

  const profilePayload = {
    name: profileBaseName,
    folder: SHARD_GROUP_NAME,
    notes: `TabiToken Profile cho ${accountEmail}${selectedProxy ? ` | Proxy [${selectedProxy.name || selectedProxy.host + ':' + selectedProxy.port}] (${selectedProxy._verifiedLatency}ms)` : ''}`,
    fingerprint: fpObj,
  };

  if (selectedProxy && selectedProxy.id) {
    profilePayload.proxy_id = selectedProxy.id;
  }

  const created = await fetchShardApi(apiUrl, headers, "/profiles", "POST", profilePayload);
  console.log(`🛡️ [ShardBrowser] Đã tạo Profile mới: [${profileBaseName}] ID [${created.id}] trong group [${SHARD_GROUP_NAME}]${selectedProxy ? ` (Proxy: ${selectedProxy.host}:${selectedProxy.port})` : ''}`);
  return created.id;
}

async function startShardBrowser(apiUrl, headers, profileId, headless = false) {
  const startRes = await fetchShardApi(apiUrl, headers, `/profiles/${profileId}/start`, "POST", { headless });
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

async function stopShardBrowser(apiUrl, headers, profileId) {
  if (!profileId) return;
  try {
    await fetchShardApi(apiUrl, headers, `/profiles/${profileId}/stop`, "POST", {}).catch(() => {});
    console.log(`⏹️ [ShardBrowser] Đã dừng phiên trình duyệt Profile ID [${profileId}] (Lưu giữ profile trong group "${SHARD_GROUP_NAME}")`);
  } catch (err) {
    console.warn(`⚠️ Lỗi khi dừng Profile: ${err.message}`);
  }
}

// ==============================================================================
// TOTP 2FA HELPER (RFC 6238)
// ==============================================================================
function base32ToBuffer(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.replace(/[ =-]/g, "").toUpperCase();
  let bits = "";

  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

function totp(secret, time = Date.now()) {
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


function loadAccountCredentials() {
  let email = process.env.TABITOKEN_GITHUB_EMAIL;
  let password = process.env.TABITOKEN_GITHUB_PASSWORD;
  let secret = process.env.TABITOKEN_GITHUB_TOTP_SECRET;

  if (!email || !password) {
    const candidateFiles = [
      path.resolve(__dirname, "../git/hotmail/github_accounts.txt"),
      path.resolve(__dirname, "accounts.txt"),
    ];
    for (const f of candidateFiles) {
      if (fs.existsSync(f)) {
        const accLines = fs.readFileSync(f, "utf-8").split(/\r?\n/);
        for (const l of accLines) {
          const trimmed = l.trim();
          if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
          const parts = trimmed.split("|").map((p) => p.trim());
          if (parts.length >= 2) {
            email = parts[0];
            password = parts[1];
            secret = parts[2] || "";
            process.env.TABITOKEN_GITHUB_EMAIL = email;
            process.env.TABITOKEN_GITHUB_PASSWORD = password;
            process.env.TABITOKEN_GITHUB_TOTP_SECRET = secret;
            console.log(`📋 [Auto Account] Tự động nạp tài khoản từ ${path.basename(f)}: ${email}`);
            break;
          }
        }
        if (email) break;
      }
    }
  }

  if (!email || !password) {
    throw new Error("Missing environment variable: TABITOKEN_GITHUB_EMAIL / PASSWORD");
  }
  return { email, password, secret };
}

async function completeGitHubLogin(page) {
  const { email, password, secret } = loadAccountCredentials();

  const loginField = await firstVisible(page, [
    "#login_field",
    "input[name=login]",
  ]);

  if (loginField) {
    await loginField.fill(email);
    await page.locator("#password, input[name=password]").first().fill(password);
    await page.locator("input[type=submit], button[type=submit]").first().click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  const otpField = await firstVisible(page, [
    "#app_totp",
    "input[name=app_otp]",
    "input[name=otp]",
    "input[autocomplete=one-time-code]",
    "input[inputmode=numeric]",
  ]);

  if (otpField) {
    await otpField.fill(totp(secret));
    await otpField.press("Enter");
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  const authorize = await firstVisible(page, [
    "#js-oauth-authorize-btn",
    "button:has-text('Authorize')",
    "input[value*='Authorize']",
  ]);

  if (authorize) {
    await authorize.click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }
}

async function createApiKey(page) {
  await page.goto("https://tabitoken.com/keys", {
    waitUntil: "domcontentloaded",
  });

  await page
    .getByRole("button", { name: "Create API Key", exact: true })
    .click();

  await page
    .locator("[role=dialog] input[name=name]")
    .fill(API_KEY_NAME);

  await page
    .locator("[role=dialog]")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();

  await page
    .getByText(API_KEY_NAME, { exact: true })
    .first()
    .waitFor({ state: "visible" });

  return page.evaluate(async (name) => {
    const refreshResponse = await fetch("/api/user/auth/refresh", {
      method: "POST",
      credentials: "include",
    });

    const refresh = await refreshResponse.json();
    const accessToken = refresh.data?.access_token;

    if (!accessToken) {
      throw new Error("Could not refresh the Tabi Token session");
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };

    const listResponse = await fetch("/api/token/?p=1&size=100", {
      headers,
      credentials: "include",
    });

    const list = await listResponse.json();

    const item = (list.data?.items || [])
      .filter((entry) => entry.name === name)
      .sort(
        (a, b) =>
          (b.created_time || b.id || 0) -
          (a.created_time || a.id || 0)
      )[0];

    if (!item) {
      throw new Error("The newly created API key was not found");
    }

    const keyResponse = await fetch(`/api/token/${item.id}/key`, {
      method: "POST",
      headers,
      credentials: "include",
    });

    const key = await keyResponse.json();

    if (!key.success || !key.data?.key) {
      throw new Error("Could not retrieve the full API key");
    }

    return {
      account:
        refresh.data.user?.username ||
        refresh.data.user?.email ||
        "unknown",
      apiKey: `sk-${key.data.key}`,
    };
  }, API_KEY_NAME);
}

// ==============================================================================
// CHẠY QUA SHARDBROWSER CDP
// ==============================================================================
(async () => {
  const { email } = loadAccountCredentials();
  const isHeadless = process.env.HEADLESS === "true";

  console.log("===========================================================");
  console.log("🚀 TABITOKEN AUTOMATION VIA SHARDBROWSER CDP");
  console.log(`📁 Group: ${SHARD_GROUP_NAME} (Không xóa Profile)`);
  console.log(`👤 Email: ${email}`);
  console.log(`🖥 Headless: ${isHeadless}`);
  console.log("===========================================================");

  const { apiUrl, headers } = loadShardConfig();
  let profileId = null;
  let browser = null;

  try {
    profileId = await getOrCreateShardProfile(apiUrl, headers, email);
    const wsUrl = await startShardBrowser(apiUrl, headers, profileId, isHeadless);

    console.log("🔌 Đang kết nối Playwright tới ShardBrowser qua CDP...");
    browser = await chromium.connectOverCDP(wsUrl);

    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    await page.goto(SIGNUP_URL, {
      waitUntil: "domcontentloaded",
    });

    const popupPromise = context
      .waitForEvent("page", { timeout: 5000 })
      .catch(() => null);

    await page
      .getByRole("button", {
        name: /Continue with GitHub|Sign in with GitHub/i,
      })
      .click();

    const popup = await popupPromise;
    const authPage = popup || page;

    await authPage.waitForLoadState("domcontentloaded").catch(() => {});
    await completeGitHubLogin(authPage);

    await Promise.race([
      authPage.waitForURL(/tabitoken\.com/, { timeout: 60000 }),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);

    const appPage =
      context.pages().find((candidate) =>
        candidate.url().includes("tabitoken.com")
      ) || page;

    const result = await createApiKey(appPage);

    console.log(`
🎉 THÀNH CÔNG:`);
    console.log(`success|${result.account}|${result.apiKey}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (profileId) {
      await stopShardBrowser(apiUrl, headers, profileId);
    }
  }
})().catch((error) => {
  console.error(`failed||${error.message}`);
  process.exitCode = 1;
});
