const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");

// Nạp thư viện puppeteer-core và axios
function requireModule(name) {
  try {
    return require(name);
  } catch (e) {
    try {
      return require(path.resolve(__dirname, `../../node_modules/${name}`));
    } catch (e2) {
      try {
        return require(path.resolve(__dirname, `../seekai-browser-use/node_modules/${name}`));
      } catch (e3) {
        console.error(`❌ Không tìm thấy thư viện '${name}'.`);
        process.exit(1);
      }
    }
  }
}

const puppeteer = requireModule("puppeteer-core");
const axios = requireModule("axios");

// Cấu hình URL & Đường dẫn
const SIGNUP_URL = "https://tabitoken.com/sign-up?aff=rm5l";
const KEYS_URL = "https://tabitoken.com/keys";
const DEFAULT_ACCOUNTS_FILE = path.resolve(__dirname, "../git/hotmail/github_accounts.txt");
const RESULT_TXT = path.resolve(__dirname, "results_tabitoken.txt");
const RESULT_JSON = path.resolve(__dirname, "results_tabitoken.json");
const RESULT_2FA_INVALID_TXT = path.resolve(__dirname, "github_2fa_invalid.txt");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ==============================================================================
// GIẢI MÃ TOTP 2FA (RFC 6238)
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

function getTotpCode(secret, time = Date.now()) {
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
// ĐỌC DANH SÁCH PROXIES TỪ SHARDBROWSER
// ==============================================================================
function loadProxyHistory() {
  const homeDir = os.homedir();
  const candidateHistoryFiles = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "proxies-history.json") : null,
    path.join(homeDir, ".config", "shardx-launcher", "proxies-history.json"),
    path.join(homeDir, "AppData", "Roaming", "shardx-launcher", "proxies-history.json"),
  ].filter(Boolean);

  for (const p of candidateHistoryFiles) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const data = JSON.parse(raw);
        if (data && typeof data.by_proxy === "object") {
          return data.by_proxy;
        }
      } catch {}
    }
  }
  return {};
}

async function getShardProxies(apiUrl, headers, group = null, requireAddress = false) {
  let proxies = [];
  const homeDir = os.homedir();
  const candidateProxyFiles = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "proxies.json") : null,
    path.join(homeDir, ".config", "shardx-launcher", "proxies.json"),
    path.join(homeDir, "AppData", "Roaming", "shardx-launcher", "proxies.json"),
  ].filter(Boolean);

  for (const p of candidateProxyFiles) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.proxies) && data.proxies.length > 0) {
          proxies = data.proxies;
          break;
        }
      } catch {}
    }
  }

  if (proxies.length === 0 && apiUrl) {
    try {
      const res = await axios.get(`${apiUrl}/proxies`, { headers, timeout: 3000 });
      if (Array.isArray(res.data)) proxies = res.data;
    } catch {}
  }

  if (group) {
    const gClean = group.trim().toLowerCase();
    const filtered = proxies.filter((p) => {
      const folderVal = (p.folder || p.group || p.tag || "").trim().toLowerCase();
      const nameVal = (p.name || "").trim().toLowerCase();
      return folderVal === gClean || folderVal.includes(gClean) || nameVal === gClean || nameVal.includes(gClean);
    });
    if (filtered.length > 0) proxies = filtered;
  }

  if (requireAddress) {
    const history = loadProxyHistory();
    const verified = proxies.filter((p) => {
      const hList = history[p.id];
      if (hList && Array.isArray(hList) && hList.length > 0) {
        const latest = hList[hList.length - 1];
        if (latest && latest.ip && latest.ip.trim().length > 0) {
          p._testedIp = latest.ip;
          p._testedLocation = [latest.city, latest.country_code || latest.country].filter(Boolean).join(", ");
          return true;
        }
      }
      return false;
    });
    if (verified.length > 0) return verified;
  }

  return proxies;
}

function checkProxyAlive(proxy, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let host = "";
    let port = 0;
    let kind = "http";
    let username = "";
    let password = "";

    if (typeof proxy === "object" && proxy !== null) {
      host = proxy.host || "";
      port = Number(proxy.port || 0);
      kind = (proxy.kind || "http").toLowerCase();
      username = proxy.username || "";
      password = proxy.password || "";
    } else if (typeof proxy === "string") {
      let str = proxy.trim();
      if (str.startsWith("socks5://")) {
        kind = "socks5";
        str = str.replace("socks5://", "");
      } else if (str.startsWith("https://")) {
        kind = "https";
        str = str.replace("https://", "");
      } else if (str.startsWith("http://")) {
        kind = "http";
        str = str.replace("http://", "");
      }
      const parts = str.split(":");
      if (parts.length >= 2) {
        host = parts[0];
        port = Number(parts[1]);
        username = parts[2] || "";
        password = parts[3] || "";
      }
    }

    if (!host || !port || isNaN(port)) return resolve(false);

    const start = Date.now();
    let isFinished = false;

    const finish = (result) => {
      if (!isFinished) {
        isFinished = true;
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);

    const socket = net.createConnection({ host, port }, () => {
      if (kind === "socks5") {
        const authMethod = username ? 0x02 : 0x00;
        socket.write(Buffer.from([0x05, 0x01, authMethod]));
      } else {
        let authHeader = "";
        if (username || password) {
          const creds = Buffer.from(`${username}:${password}`).toString("base64");
          authHeader = `Proxy-Authorization: Basic ${creds}\r\n`;
        }
        // Gửi CONNECT tới tabitoken.com:443 để test cả tunnel lẫn TLS
        socket.write(
          `CONNECT tabitoken.com:443 HTTP/1.1\r\nHost: tabitoken.com:443\r\n${authHeader}\r\n`
        );
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
          if (latency > 1500) {
            finish({ alive: false, tooSlow: true, latency });
          } else {
            finish({ alive: true, latency });
          }
        } else {
          finish(false);
        }
      } else {
        const text = buf.toString("utf-8");
        if (text.includes("200") || text.toLowerCase().includes("connection established")) {
          // BƯỚC THẨM ĐỊNH SSL QUAN TRỌNG:
          // Bắt tay TLS thực tế tới tabitoken.com với rejectUnauthorized: true.
          // Bất kỳ proxy nào can thiệp MITM, chứng chỉ expired, self-signed sẽ bị LOẠI BỎ NGAY LẬP TỨC.
          const tlsSocket = tls.connect({
            socket: socket,
            servername: "tabitoken.com",
            rejectUnauthorized: true,
          }, () => {
            clearTimeout(timer);
            const latency = Date.now() - start;
            tlsSocket.destroy();
            socket.destroy();
            if (latency > 1500) {
              finish({ alive: false, tooSlow: true, latency });
            } else {
              finish({ alive: true, latency });
            }
          });

          tlsSocket.on("error", (tlsErr) => {
            clearTimeout(timer);
            tlsSocket.destroy();
            socket.destroy();
            // Bị lỗi chứng chỉ SSL / Expired -> Báo lỗi & loại bỏ
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

async function getRandomShardProxy(apiUrl, headers, group = null, maxCandidates = 30) {
  let list = await getShardProxies(apiUrl, headers, group, false);
  if (!list || list.length === 0) {
    list = await getShardProxies(apiUrl, headers, null, false);
  }
  if (!list || list.length === 0) return null;

  // Xáo trộn ngẫu nhiên danh sách proxy
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  const attempts = Math.min(shuffled.length, maxCandidates);

  console.log(`🌐 [Proxy Check] Đang kiểm tra để tìm 1 proxy NHANH & SỐNG (ping <= 1500ms, SSL chuẩn)...`);

  for (let i = 0; i < attempts; i++) {
    const candidate = shuffled[i];
    const label = candidate.name || `${candidate.host}:${candidate.port}`;

    const testRes = await checkProxyAlive(candidate, 2500);
    if (testRes && testRes.alive && testRes.latency <= 1500) {
      console.log(`   \x1b[32m[✓ NHANH & LIVE]\x1b[0m Proxy [${label}] phản hồi mượt (${testRes.latency}ms <= 1500ms) -> ĐÃ CHỌN GÁN VÀO PROFILE!`);
      return candidate;
    } else {
      let reason = "Không phản hồi";
      if (testRes?.tooSlow) reason = `Quá chậm (${testRes.latency}ms > 1500ms)`;
      else if (testRes?.sslError) reason = `Lỗi SSL: ${testRes.sslError}`;
      console.log(`   \x1b[31m[✗ BỎ QUA]\x1b[0m Proxy [${label}] (${reason}).`);
    }
  }

  console.warn(`⚠️ [Proxy Check] Không tìm thấy proxy nào dưới 1500ms trong ${attempts} proxy vừa test. Tạm thời sử dụng Direct IP để tải trang siêu tốc.`);
  return null;
}

// ==============================================================================
// SHARDBROWSER PROFILE MANAGER (REST API + CDP + PROXY)
// ==============================================================================
class ShardProfileManager {
  _apiUrl = "http://127.0.0.1:40325";
  _apiToken = "";
  _headers = {};
  _folder = "TabiToken-Auto";
  _profileId = null;

  constructor(folder = "TabiToken-Auto") {
    this._folder = folder;
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

  async cleanupFolderProfiles(maxAllowed = 10) {
    try {
      const profiles = await this._fetchApi("/profiles", "GET");
      if (!Array.isArray(profiles)) return;

      const targetFolder = (this._folder || "TabiToken-Auto").trim().toLowerCase();
      const folderProfiles = profiles.filter((p) => {
        const pFolder = (p.folder || "").trim().toLowerCase();
        return pFolder === targetFolder;
      });

      if (folderProfiles.length > maxAllowed) {
        console.log(`🧹 [ShardBrowser Cleanup] Group [${this._folder}] có ${folderProfiles.length} profile (> ${maxAllowed}). Đang dọn dẹp...`);
        for (const p of folderProfiles) {
          if (this._profileId && p.id === this._profileId) continue;
          if (p.running) {
            await this._fetchApi(`/profiles/${p.id}/stop`, "POST", {}).catch(() => {});
          }
          await this._fetchApi(`/profiles/${p.id}`, "DELETE").catch(() => {});
        }
        console.log(`✨ [ShardBrowser Cleanup] Đã dọn dẹp profile cũ.`);
      }
    } catch (err) {
      console.warn(`⚠️ [ShardBrowser Cleanup] ${err.message}`);
    }
  }

  async createProfile(accountEmail, proxyOption = true) {
    await this.cleanupFolderProfiles(10);

    let fingerprint = {};
    try {
      const fpRes = await this._fetchApi("/fingerprint/new/windows", "GET");
      if (fpRes && typeof fpRes === "object") {
        fingerprint = fpRes.fingerprint || fpRes;
      }
    } catch (e) {
      console.warn(`[ShardBrowser] Dùng Fingerprint mặc định (${e.message}).`);
    }

    const cleanName = (accountEmail || "User").split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_");
    const suffix = Date.now().toString().slice(-4);
    const profileName = `Tabi_${cleanName}_${suffix}`;

    // Xử lý gán Proxy vào Profile
    let proxyId = null;
    let proxyStr = null;
    let selectedProxyInfo = null;

    if (proxyOption) {
      if (typeof proxyOption === "string" && !proxyOption.includes("://") && !proxyOption.includes(":")) {
        selectedProxyInfo = await getRandomShardProxy(this._apiUrl, this._headers, proxyOption);
      } else if (typeof proxyOption === "object" && proxyOption.id) {
        console.log(`🌐 [Proxy Check] Đang kiểm tra proxy được chỉ định [${proxyOption.name || proxyOption.host}]...`);
        const testRes = await checkProxyAlive(proxyOption, 3500);
        if (testRes && testRes.alive) {
          console.log(`   \x1b[32m[✓ LIVE]\x1b[0m Proxy hoạt động tốt (${testRes.latency}ms).`);
          selectedProxyInfo = proxyOption;
        } else {
          console.warn(`   \x1b[31m[✗ DIE]\x1b[0m Proxy được chỉ định bị lỗi! Chuyển sang tìm proxy ngẫu nhiên khác...`);
          selectedProxyInfo = await getRandomShardProxy(this._apiUrl, this._headers, null);
        }
      } else if (typeof proxyOption === "string") {
        console.log(`🌐 [Proxy Check] Đang kiểm tra proxy dạng chuỗi [${proxyOption}]...`);
        const testRes = await checkProxyAlive(proxyOption, 3500);
        if (testRes && testRes.alive) {
          console.log(`   \x1b[32m[✓ LIVE]\x1b[0m Proxy hoạt động tốt (${testRes.latency}ms).`);
          proxyStr = proxyOption;
        } else {
          console.warn(`   \x1b[31m[✗ DIE]\x1b[0m Proxy [${proxyOption}] không kết nối được! Chuyển sang tìm proxy ngẫu nhiên...`);
          selectedProxyInfo = await getRandomShardProxy(this._apiUrl, this._headers, null);
        }
      } else if (proxyOption === true) {
        // Tự động tìm và kiểm tra 1 proxy sống có sẵn trong ShardBrowser
        selectedProxyInfo = await getRandomShardProxy(this._apiUrl, this._headers, process.env.PROXY_GROUP || null);
      }

      if (selectedProxyInfo) {
        proxyId = selectedProxyInfo.id;
      }
    }

    const proxyDesc = selectedProxyInfo
      ? ` | 🌐 Proxy [${selectedProxyInfo.name || selectedProxyInfo.host + ':' + selectedProxyInfo.port}]`
      : proxyStr
      ? ` | 🌐 Proxy: ${proxyStr}`
      : " | ⚡ Direct IP";

    const fpObj = (fingerprint && typeof fingerprint === "object") ? { ...fingerprint } : {};
    if (!fpObj.navigator || typeof fpObj.navigator !== "object") {
      fpObj.navigator = {};
    }
    // Cố định ngôn ngữ trình duyệt là Tiếng Anh (en-US) để tránh lỗi giao diện đa ngôn ngữ
    fpObj.navigator.language = "en-US";
    fpObj.navigator.accept_language = "en-US,en;q=0.9";
    fpObj.navigator.languages = ["en-US", "en"];
    fpObj.icu_locale = "en-US";

    const profilePayload = {
      name: profileName,
      folder: this._folder,
      notes: `TabiToken CDP Flow cho ${accountEmail} lúc ${new Date().toLocaleTimeString()}${proxyDesc}`,
      fingerprint: fpObj,
    };

    if (proxyId) {
      profilePayload.proxy_id = proxyId;
    } else if (proxyStr) {
      profilePayload.proxy = proxyStr;
    }

    const created = await this._fetchApi("/profiles", "POST", profilePayload);
    this._profileId = created.id;
    console.log(`🛡️ [ShardBrowser] Đã tạo Profile: [${profileName}] ID [${this._profileId}]${proxyDesc}`);
    return this._profileId;
  }

  async startBrowser(headless = false) {
    if (!this._profileId) throw new Error("Chưa khởi tạo Profile!");

    const startRes = await this._fetchApi(`/profiles/${this._profileId}/start`, "POST", { headless });
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

    throw new Error(`Không nhận được WebSocket CDP: ${JSON.stringify(startRes)}`);
  }

  async destroyProfile() {
    if (!this._profileId) return;
    try {
      await this._fetchApi(`/profiles/${this._profileId}/stop`, "POST", {}).catch(() => {});
      await this._fetchApi(`/profiles/${this._profileId}`, "DELETE").catch(() => {});
      console.log(`🧹 [ShardBrowser] Đã giải phóng Profile ID [${this._profileId}]`);
      this._profileId = null;
    } catch (err) {
      console.warn(`⚠️ Lỗi khi đóng Profile: ${err.message}`);
    }
  }
}

// ==============================================================================
// HELPERS THAO TÁC TRANG CHUẨN SEEKAI
// ==============================================================================
async function safeQuery(page, selector) {
  try {
    return await page.$(selector);
  } catch {
    return null;
  }
}

async function humanType(page, selector, textToType) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  } catch {}

  const el = await safeQuery(page, selector);
  if (!el) throw new Error(`Không tìm thấy ô nhập: ${selector}`);

  try {
    await el.click({ clickCount: 3 }).catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await sleep(100);

    for (const char of textToType) {
      const delay = Math.floor(Math.random() * 30) + 20;
      await page.keyboard.type(char, { delay }).catch(() => {});
    }

    await page.evaluate((element, val) => {
      if (element) {
        element.value = val;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    }, el, textToType).catch(() => {});
  } catch {}
  await sleep(300);
}

async function safeClick(page, selectorOrText) {
  try {
    return await page.evaluate((target) => {
      const normalize = (s) => (s || "").trim().toLowerCase();
      const tClean = normalize(target);

      if (target.startsWith("#") || target.startsWith(".") || target.startsWith("[") || target.startsWith("button")) {
        const el = document.querySelector(target);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.click();
          return true;
        }
      }

      const elements = Array.from(document.querySelectorAll("button, a, input[type='submit'], [role='button'], summary"));
      for (const el of elements) {
        const txt = normalize(el.innerText || el.textContent || el.value || "");
        if (txt === tClean || txt.includes(tClean)) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.click();
          return true;
        }
      }
      return false;
    }, selectorOrText);
  } catch {
    return false;
  }
}

// ==============================================================================
// LUỒNG XÁC THỰC GITHUB TOÀN DIỆN (LOGIN -> 2FA -> PASSKEY SKIP -> AUTHORIZE)
// ==============================================================================
async function handleGithubAuthFlow(page, account) {
  console.log(`🌐 [GitHub Auth Flow] Bắt đầu xác thực tài khoản: ${account.email}...`);

  for (let step = 0; step < 90; step++) {
    let currentUrl = "";
    try {
      currentUrl = page.url();
    } catch {
      await sleep(1000);
      continue;
    }

    // 1. Đã chuyển về TabiToken và đăng nhập thành công
    if (currentUrl.includes("tabitoken.com") && !currentUrl.includes("sign-up") && !currentUrl.includes("sign-in")) {
      console.log("🎉 Đã chuyển về TabiToken Dashboard!");
      return;
    }

    // Kiểm tra có session token trên TabiToken
    if (currentUrl.includes("tabitoken.com")) {
      const hasSession = await page.evaluate(async () => {
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
        return;
      }
    }

    // 2. Điền form đăng nhập GitHub
    const loginField = await safeQuery(page, "#login_field, input[name='login']");
    if (loginField && currentUrl.includes("github.com")) {
      console.log(`🔑 [GitHub Login] Điền tài khoản [${account.email}]...`);
      await humanType(page, "#login_field, input[name='login']", account.email);
      await sleep(300);
      await humanType(page, "#password, input[name='password']", account.password);
      await sleep(500);
      await safeClick(page, "Sign in");
      await sleep(2500);
      continue;
    }

    // 3. Nếu GitHub ở màn hình chọn phương thức 2FA khác -> Chuyển sang Authenticator App
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
        await sleep(1500);
      }
    }

    // 4. Xử lý 2FA TOTP (6 số)
    const totpField = await safeQuery(page, "#app_totp, input[name='otp'], input[name='app_totp'], input[autocomplete='one-time-code'], input[placeholder*='6-digit']");
    if (totpField && currentUrl.includes("github.com")) {
      if (account.totpSecret) {
        const code = getTotpCode(account.totpSecret);
        console.log(`🔐 [2FA TOTP] Nhập mã 6 số: [ ${code} ]...`);
        await humanType(page, "#app_totp, input[name='otp'], input[name='app_totp'], input[autocomplete='one-time-code']", code);
        await sleep(300);
        await safeClick(page, "Verify");
        await sleep(2500);
        continue;
      }
    }

    // 5. Màn hình cấu hình Passkey / Trusted Device (https://github.com/sessions/trusted-device)
    if (currentUrl.includes("github.com/sessions/trusted-device") || currentUrl.includes("/trusted-device")) {
      console.log("⏩ [Passkey / Trusted Device] Phát hiện URL https://github.com/sessions/trusted-device -> Bấm 'Ask me later'...");
      const clicked = await page.evaluate(() => {
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

      if (clicked) {
        console.log("✅ Đã bấm 'Ask me later' thành công!");
      } else {
        await safeClick(page, "Ask me later");
      }
      await sleep(2000);
      continue;
    }

    // 5b. Bỏ qua Passkey thông thường nếu xuất hiện nút "Ask me later" trên bất kỳ trang nào
    const generalAskLater = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("button, a, input[type='submit'], input[type='button'], [role='button']"));
      for (const el of candidates) {
        const txt = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
        if (txt === "ask me later" || txt === "not now") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (generalAskLater) {
      console.log("⏩ Bỏ qua thông báo Passkey ('Ask me later')...");
      await sleep(2000);
      continue;
    }

    // 6. Xử lý Sudo Mode (nếu GitHub hỏi lại password trước khi authorize)
    const sudoField = await safeQuery(page, "#sudo_password, input[name='sudo_password']");
    if (sudoField) {
      console.log("🔑 [Sudo Mode] Xác nhận lại mật khẩu GitHub...");
      await humanType(page, "#sudo_password, input[name='sudo_password']", account.password);
      await sleep(500);
      await safeClick(page, "Confirm password");
      await sleep(1800);
      continue;
    }

    // 7. Trang ủy quyền OAuth ("Authorize tabitoken")
    if (currentUrl.includes("github.com/login/oauth/authorize")) {
      console.log("⚡ [OAuth] Xử lý trang ủy quyền GitHub ('Authorize tabitoken')...");
      
      // 1. Cuộn trang xuống và hover vào vùng form
      try {
        await page.evaluate(() => {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        });
        await sleep(600);
      } catch {}

      // 2. Kích hoạt trạng thái nút và gửi form
      await page.evaluate(() => {
        const selectors = [
          "#js-oauth-authorize-btn",
          "button[name='authorize'][value='1']",
          "button[name='authorize']",
          "button[type='submit'].btn-primary",
          "input[name='authorize']"
        ];

        let btn = null;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            btn = el;
            break;
          }
        }

        if (!btn) {
          const buttons = Array.from(document.querySelectorAll("button, input[type='submit']"));
          btn = buttons.find(b => {
            const txt = (b.innerText || b.value || b.textContent || "").toLowerCase().trim();
            return txt.includes("authorize") || txt.includes("ủy quyền");
          });
        }

        if (btn) {
          btn.scrollIntoView({ behavior: "smooth", block: "center" });

          // Bỏ thuộc tính disabled nếu GitHub chưa kịp enable
          if (btn.disabled || btn.hasAttribute("disabled")) {
            btn.disabled = false;
            btn.removeAttribute("disabled");
            btn.classList.remove("disabled");
          }

          btn.focus();
          btn.click();

          const form = btn.closest("form") || document.querySelector("form.js-oauth-form, form[action*='/login/oauth/authorize']");
          if (form) {
            if (typeof form.requestSubmit === "function") {
              try { form.requestSubmit(btn); } catch { form.submit(); }
            } else {
              form.submit();
            }
          }
        }
      }).catch(() => {});

      // 3. Sử dụng chuột vật lý Puppeteer click vào tọa độ thực của nút
      try {
        const btnHandle = await page.$("#js-oauth-authorize-btn, button[name='authorize'][value='1'], button.btn-primary");
        if (btnHandle) {
          const box = await btnHandle.boundingBox();
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await sleep(300);
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          }
        }
      } catch {}

      await sleep(2500);
      continue;
    }

    await sleep(1800);
  }
}

// ==============================================================================
// LUỒNG TẠO & TRÍCH XUẤT API KEY TABITOKEN
// ==============================================================================
async function executeTabiTokenFlow(page, account, keyName = "Auto_API_Key_01") {
  console.log(`🌐 [TabiToken] Đang mở ${SIGNUP_URL}...`);

  let onGithubOrDashboard = false;
  const maxReloadAttempts = 6;

  for (let attempt = 1; attempt <= maxReloadAttempts; attempt++) {
    try {
      if (attempt === 1) {
        await page.goto(SIGNUP_URL, { waitUntil: "networkidle2", timeout: 45000 }).catch(async () => {
          await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
        });
      } else {
        console.log(`🔄 [TabiToken Reload #${attempt}/${maxReloadAttempts}] Tải lại trang...`);
        await sleep(1000);
        await page.reload({ waitUntil: "networkidle2", timeout: 45000 }).catch(async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
        });
      }
    } catch (e) {
      console.warn(`⚠️ Lỗi tải trang TabiToken: ${e.message}`);
    }

    // Tự động kiểm tra và vượt cảnh báo chứng chỉ SSL Chrome nếu xuất hiện
    try {
      const isCertError = await page.evaluate(() => {
        const txt = document.body ? document.body.innerText : "";
        return txt.includes("Your connection is not private") || txt.includes("NET::ERR_CERT") || document.querySelector("#details-button") !== null;
      }).catch(() => false);

      if (isCertError) {
        console.log("🔓 [SSL Bypass] Phát hiện cảnh báo SSL Chrome ('Your connection is not private'). Đang tự động bấm 'Advanced' -> 'Proceed'...");
        await page.click("#details-button").catch(() => {});
        await sleep(500);
        await page.click("#proceed-link").catch(() => {});
        await sleep(2000);
      }
    } catch {}

    const pollStart = Date.now();
    while (Date.now() - pollStart < 25000) {
      let curUrl = "";
      try { curUrl = page.url(); } catch {}

      if (curUrl.includes("github.com") || (curUrl.includes("tabitoken.com") && !curUrl.includes("sign-up") && !curUrl.includes("sign-in"))) {
        onGithubOrDashboard = true;
        console.log(`-> 🚀 Đã chuyển hướng thành công: ${curUrl}`);
        break;
      }

      console.log(`⏳ [Lần #${attempt}] Tích checkbox điều khoản & Bấm 'Continue with GitHub'...`);

      // 1. Tích vào Checkbox đồng ý điều khoản nếu có
      await page.evaluate(() => {
        const chks = document.querySelectorAll("input[type='checkbox'], [role='checkbox']");
        for (const chk of chks) {
          if (!chk.checked) chk.click();
        }
      }).catch(() => {});

      await sleep(600);

      // 2. Tìm và Bấm nút Continue with GitHub (DOM click)
      const btnInfo = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a, [role='button']"));
        for (const b of btns) {
          const txt = (b.innerText || b.textContent || b.getAttribute("aria-label") || "").toLowerCase().trim();
          const isMatch =
            txt.includes("continue with github") ||
            txt.includes("sign in with github") ||
            (txt.includes("github") && (txt.includes("tiếp tục") || txt.includes("continue") || txt.includes("với")));

          if (isMatch) {
            b.scrollIntoView({ behavior: "smooth", block: "center" });
            b.click();
            return { found: true, text: txt };
          }
        }
        return { found: false };
      }).catch(() => ({ found: false }));

      if (btnInfo && btnInfo.found) {
        console.log(`-> ✅ Đã bấm nút: "${btnInfo.text}". Bấm bổ sung bằng chuột vật lý Puppeteer...`);
      }

      // 3. Click bổ sung bằng chuột vật lý Puppeteer
      try {
        const btnHandles = await page.$$("button, a, [role='button']");
        for (const handle of btnHandles) {
          const txt = await page.evaluate(el => (el.innerText || el.textContent || "").toLowerCase(), handle);
          if (txt.includes("github") && (txt.includes("tiếp tục") || txt.includes("continue") || txt.includes("với"))) {
            const box = await handle.boundingBox();
            if (box) {
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await sleep(200);
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              break;
            }
          }
        }
      } catch {}

      // 4. Chờ 5 giây kiểm tra chuyển hướng
      for (let w = 0; w < 5; w++) {
        await sleep(1000);
        try { curUrl = page.url(); } catch {}
        if (curUrl.includes("github.com") || (curUrl.includes("tabitoken.com") && !curUrl.includes("sign-up") && !curUrl.includes("sign-in"))) {
          onGithubOrDashboard = true;
          break;
        }
      }

      if (onGithubOrDashboard) {
        console.log(`-> 🚀 Chuyển hướng thành công sang GitHub: ${curUrl}`);
        break;
      }
    }

    if (onGithubOrDashboard) break;
  }

  await sleep(2000);

  // Xử lý xác thực GitHub & Authorize
  await handleGithubAuthFlow(page, account);

  // Chờ TabiToken tải xong hoàn toàn
  const waitRedirect = Date.now();
  while (Date.now() - waitRedirect < 30000) {
    let u = "";
    try { u = page.url(); } catch {}
    if (u.includes("tabitoken.com") && !u.includes("sign-up") && !u.includes("sign-in")) break;
    await sleep(1000);
  }
  await sleep(2000);

  // Mở trang "API Keys"
  console.log("🔑 [API Key] Bấm vào Tab 'API Keys' trên giao diện...");
  let onKeysPage = false;

  for (let attempt = 0; attempt < 10; attempt++) {
    let curUrl = "";
    try { curUrl = page.url(); } catch {}
    if (curUrl.includes("/keys") || curUrl.includes("/api-keys")) {
      onKeysPage = true;
      break;
    }

    const clicked = await page.evaluate(() => {
      const link = document.querySelector("a[href*='/keys'], a[href*='keys'], a[href*='api-key']");
      if (link) {
        link.scrollIntoView({ behavior: "smooth", block: "center" });
        link.click();
        return true;
      }

      const elements = Array.from(document.querySelectorAll("a, button, [role='tab'], [role='link'], li, div > span"));
      for (const el of elements) {
        const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (txt.includes("api key") || txt === "keys" || txt === "api keys") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);

    if (clicked) {
      await sleep(1800);
      let nextUrl = "";
      try { nextUrl = page.url(); } catch {}
      if (nextUrl.includes("/keys")) {
        onKeysPage = true;
        break;
      }
    }
    await sleep(1800);
  }

  if (!onKeysPage) {
    let curUrl = "";
    try { curUrl = page.url(); } catch {}
    if (!curUrl.includes("/keys")) {
      console.log(`⚠️ Fallback điều hướng đến ${KEYS_URL}...`);
      await page.goto(KEYS_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(2000);
    }
  }

  // 1. Tìm và bấm nút "Create API Key"
  console.log("-> Bấm 'Create API Key'...");
  for (let attempt = 0; attempt < 10; attempt++) {
    const isModalOpen = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll("[role='dialog'], [data-state='open'], .modal"));
      return dialogs.length > 0;
    }).catch(() => false);

    if (isModalOpen) break;

    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("button, [role='button'], a"));
      for (const el of elements) {
        const txt = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
        if (txt.includes("create api key") || txt.includes("create key") || txt.includes("new key")) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);

    await sleep(1500);
  }

  // 2. Điền tên khóa vào Modal
  console.log(`-> Điền tên khóa: ${keyName} vào Modal...`);
  await page.evaluate((kVal) => {
    const dialogs = Array.from(document.querySelectorAll("[role='dialog'], [data-state='open'], .modal"));
    const activeDialog = dialogs[0] || document.body;
    const inputs = Array.from(activeDialog.querySelectorAll("input:not([type='hidden']):not([type='checkbox'])"));
    const nameInput = inputs.find(i => {
      const ph = (i.placeholder || "").toLowerCase();
      const n = (i.name || "").toLowerCase();
      return ph.includes("name") || n.includes("name") || ph.includes("tên");
    }) || inputs[0];

    if (nameInput) {
      nameInput.focus();
      nameInput.click();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (nativeSetter) nativeSetter.call(nameInput, kVal);
      else nameInput.value = kVal;
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, keyName).catch(() => {});

  // Gõ bàn phím ảo
  try {
    const dialogHandle = await page.$("[role='dialog'], [data-state='open'], .modal");
    if (dialogHandle) {
      const inputHandle = await dialogHandle.$("input:not([type='hidden']):not([type='checkbox'])");
      if (inputHandle) {
        await inputHandle.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        await page.keyboard.type(keyName, { delay: 25 });
      }
    }
  } catch {}

  await sleep(1000);

  // 3. Bấm Save changes
  console.log("-> Bấm 'Save changes'...");
  await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll("[role='dialog'], [data-state='open'], .modal"));
    const activeDialog = dialogs[0] || document.body;
    const buttons = Array.from(activeDialog.querySelectorAll("button, input[type='submit']"));
    for (const b of buttons) {
      const txt = (b.innerText || b.textContent || b.value || "").trim().toLowerCase();
      if (txt.includes("save changes") || txt.includes("save") || txt.includes("create") || txt.includes("submit")) {
        b.scrollIntoView({ behavior: "smooth", block: "center" });
        b.click();
        return true;
      }
    }
    return false;
  }).catch(() => {});

  await sleep(2500);

  // 4. Trích xuất Secret Key trực tiếp từ session backend (An toàn & Chính xác 100%)
  console.log("⚡ Đang trích xuất Secret API Key...");
  let lastError = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const result = await page.evaluate(async (name) => {
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

        let listResponse = await fetch("/api/token/?p=1&size=100", {
          headers,
          credentials: "include",
        });
        let list = await listResponse.json();
        let items = list.data?.items || [];

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

          listResponse = await fetch("/api/token/?p=1&size=100", { headers, credentials: "include" });
          list = await listResponse.json();
          items = list.data?.items || [];
          targetItem = items.find((entry) => entry.name === name) || items[0];
        }

        if (!targetItem) {
          throw new Error("Không tìm thấy hoặc tạo được API Key");
        }

        const keyResponse = await fetch(`/api/token/${targetItem.id}/key`, {
          method: "POST",
          headers,
          credentials: "include",
        });

        const key = await keyResponse.json();
        if (!key.success || !key.data?.key) {
          throw new Error("API TabiToken không trả về secret key");
        }

        return {
          account: refresh.data.user?.username || refresh.data.user?.email || "unknown",
          apiKey: `sk-${key.data.key}`,
        };
      }, keyName);

      if (result && result.apiKey) {
        return result;
      }
    } catch (err) {
      lastError = err;
      await sleep(2000);
    }
  }

  if (lastError) throw lastError;
}

// ==============================================================================
// XỬ LÝ 1 TÀI KHOẢN TRÊN SHARDBROWSER PROFILE QUA CDP
// ==============================================================================
async function processAccount(shardManager, account, index, total, isHeadless) {
  const apiKeyName = `Key_${Date.now().toString().slice(-6)}`;
  console.log(`\n===========================================================`);
  console.log(`⏳ [${index}/${total}] BẮT ĐẦU: ${account.email}`);
  console.log(`===========================================================`);

  let browser = null;

  try {
    // 1. Tạo Profile mới trong ShardBrowser (tự động gán Proxy có sẵn trong ShardBrowser)
    await shardManager.createProfile(account.email, true);

    // 2. Khởi chạy Profile và kết nối CDP qua Puppeteer
    const cdpEndpoint = await shardManager.startBrowser(isHeadless);
    console.log(`🔗 Đang kết nối Puppeteer vào CDP ShardBrowser...`);

    if (cdpEndpoint.startsWith("ws")) {
      browser = await puppeteer.connect({ browserWSEndpoint: cdpEndpoint, defaultViewport: null });
    } else {
      browser = await puppeteer.connect({ browserURL: cdpEndpoint, defaultViewport: null });
    }

    await sleep(2000);

    const applyEnglishLocale = async (targetPage) => {
      try {
        await targetPage.setExtraHTTPHeaders({
          "Accept-Language": "en-US,en;q=0.9",
        }).catch(() => {});
        await targetPage.evaluateOnNewDocument(() => {
          try {
            Object.defineProperty(navigator, "language", { get: () => "en-US" });
            Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
          } catch {}
        }).catch(() => {});

        // Bỏ qua lỗi SSL ở tầng CDP để Chrome không hiện trang cảnh báo đỏ
        const client = await targetPage.target().createCDPSession();
        await client.send("Security.setIgnoreCertificateErrors", { ignore: true }).catch(() => {});
      } catch {}
    };

    browser.on("targetcreated", async (target) => {
      try {
        const p = await target.page();
        if (p) await applyEnglishLocale(p);
      } catch {}
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    await applyEnglishLocale(page);
    await page.bringToFront().catch(() => {});

    // 3. Thực hiện toàn bộ luồng SeekAI/TabiToken chuẩn
    const result = await executeTabiTokenFlow(page, account, apiKeyName);
    console.log(`\n\x1b[32m🎉 [${index}/${total}] THÀNH CÔNG: ${account.email}\x1b[0m`);
    console.log(`🔑 Account: ${result.account} | API Key: \x1b[33m${result.apiKey}\x1b[0m`);

    return {
      success: true,
      email: account.email,
      accountName: result.account,
      apiKey: result.apiKey,
      rawLine: account.rawLine,
    };
  } catch (error) {
    console.error(`\n\x1b[31m❌ [${index}/${total}] THẤT BẠI: ${account.email} | Lỗi: ${error.message}\x1b[0m`);
    const is2FaInvalid = error.message.includes("2FA_INVALID") || error.message.includes("TOTP");
    return {
      success: false,
      email: account.email,
      error: error.message,
      rawLine: account.rawLine,
      is2FaInvalid: is2FaInvalid,
    };
  } finally {
    if (browser) {
      await browser.disconnect().catch(() => {});
    }
    await shardManager.destroyProfile();
  }
}

// Đọc danh sách tài khoản đã hoàn thành
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
// MAIN BATCH RUNNER
// ==============================================================================
async function main() {
  const filePath = process.argv[2] || process.env.ACCOUNTS_FILE || DEFAULT_ACCOUNTS_FILE;
  const isHeadless = process.env.HEADLESS === "true";

  console.log("===========================================================");
  console.log("🚀 TABITOKEN BATCH RUNNER (SHARDBROWSER + CDP + PROXY AUTO)");
  console.log(`📁 File tài khoản: ${filePath}`);
  console.log(`🖥 Chế độ Headless: ${isHeadless} (HEADLESS=false: hiện cửa sổ)`);
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

  const shardManager = new ShardProfileManager("TabiToken-Auto");
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const res = await processAccount(shardManager, accounts[i], i + 1, accounts.length, isHeadless);
    results.push(res);

    if (res.success) {
      fs.appendFileSync(RESULT_TXT, `${res.email}|${res.apiKey}\n`, "utf-8");
    } else {
      if (res.is2FaInvalid || res.error?.includes("2FA_INVALID")) {
        fs.appendFileSync(RESULT_2FA_INVALID_TXT, `${res.rawLine || res.email}\n`, "utf-8");
        console.log(`⚠️ \x1b[33m[2FA SAI]: Đã lưu tài khoản vào: ${path.basename(RESULT_2FA_INVALID_TXT)} -> Chuyển sang tài khoản tiếp theo!\x1b[0m`);
      }
      fs.appendFileSync(RESULT_TXT, `FAILED|${res.email}|${res.error}\n`, "utf-8");
    }

    if (i < accounts.length - 1) {
      const waitSeconds = Math.floor(Math.random() * (70 - 30 + 1)) + 30; // Random 30 - 70 giây
      console.log(`\n⏳ [Nghỉ ngẫu nhiên] Đang chờ ${waitSeconds}s trước khi xử lý tài khoản tiếp theo...`);
      await sleep(waitSeconds * 1000);
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
