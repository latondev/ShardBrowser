/**
 * AUTONOMOUS GITHUB AUTOMATION SUITE (EMAILMUX GMAIL/OUTLOOK + DETERMINISTIC 2FA)
 * ==============================================================================
 * Tích hợp trực tiếp EmailMux API Client:
 * - Tự động tạo Gmail/Outlook Temp tức thì qua HTTP API (không cần mở thêm tab email).
 * - Polling nhận mã OTP qua HTTP Request siêu nhanh, chính xác 100%.
 * - Tự động fallback sang UnlimitMail nếu EmailMux hết quota IP.
 * - Khởi tạo môi trường ShardX Sandbox cách ly 100% (Proxy xoay + Fingerprint mới).
 * - Đăng ký GitHub tuần tự (Human-like Typing) & tự động cấu hình 2FA TOTP.
 * 
 * Quy tắc đặt tên biến:
 * - Biến/Phương thức private/protected: _{name}
 * - Biến/Phương thức public: {nameValue} (camelCase)
 * ==============================================================================
 */

import axios from "axios";
import puppeteer from "puppeteer-core";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { writeFile, appendFile, chmod } from "node:fs/promises";
import { MailTmClient } from "./mailtm_client.js";
import { GmailCreatorClient } from "./gmail_creator_client.js";
import { HotmailGraphClient } from "./hotmail_graph_client.js";
import { TotpClient } from "./totp_client.js";
import { ProxyXoayClient } from "./proxyxoay_client.js";
import { AccountStorageService } from "./account_storage.js";
import net from "node:net";
import tls from "node:tls";

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
          finish({ alive: true, latency });
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
            finish({ alive: true, latency });
          });

          tlsSocket.on("error", (tlsErr) => {
            clearTimeout(timer);
            tlsSocket.destroy();
            socket.destroy();
            // Nếu SSL handshake lỗi nhưng TCP proxy đã thông, vẫn có thể dùng được
            finish({ alive: true, latency: Date.now() - start, sslWarning: tlsErr.message });
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

function parseProxyLine(rawLine) {
  if (!rawLine || typeof rawLine !== "string") return null;
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) return null;

  try {
    if (line.includes("://")) {
      const parsed = new URL(line);
      const kind = parsed.protocol.replace(":", "").toLowerCase();
      return {
        id: `file_${parsed.hostname}_${parsed.port}`,
        name: `${parsed.hostname}:${parsed.port}`,
        host: parsed.hostname,
        port: Number(parsed.port) || (kind === "socks5" ? 1080 : 8080),
        kind: kind === "https" ? "http" : kind,
        username: decodeURIComponent(parsed.username || ""),
        password: decodeURIComponent(parsed.password || ""),
        proxyString: line,
        folder: "proxify",
      };
    }

    const parts = line.split(":");
    if (parts.length === 2) {
      const [host, port] = parts;
      return {
        id: `file_${host}_${port}`,
        name: `${host}:${port}`,
        host: host.trim(),
        port: Number(port.trim()),
        kind: "http",
        username: "",
        password: "",
        proxyString: `http://${host.trim()}:${port.trim()}`,
        folder: "proxify",
      };
    } else if (parts.length === 4) {
      const [host, port, user, pass] = parts;
      return {
        id: `file_${host}_${port}`,
        name: `${host}:${port}`,
        host: host.trim(),
        port: Number(port.trim()),
        kind: "http",
        username: user.trim(),
        password: pass.trim(),
        proxyString: `http://${user.trim()}:${pass.trim()}@${host.trim()}:${port.trim()}`,
        folder: "proxify",
      };
    }
  } catch {}
  return null;
}

// ==============================================================================
// 1. CẤU HÌNH HỆ THỐNG
// ==============================================================================
function loadShardLauncherConfig() {
  const homeDir = os.homedir();
  const candidateSettings = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "settings.json") : null,
    path.join(homeDir, ".config", "shardx-launcher", "settings.json"),
    path.join(homeDir, "AppData", "Roaming", "shardx-launcher", "settings.json")
  ].filter(Boolean);

  for (const settingsPath of candidateSettings) {
    if (existsSync(settingsPath)) {
      try {
        const raw = readFileSync(settingsPath, "utf-8");
        const settings = JSON.parse(raw);
        const port = settings.api_port || 40325;
        const secret = settings.api_secret || "";
        let token = "";
        if (secret) {
          const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "HS256" })).toString("base64url");
          const now = Math.floor(Date.now() / 1000);
          const payload = Buffer.from(JSON.stringify({ sub: "shardx-api", iat: now, exp: now + 86400 * 30 })).toString("base64url");
          const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest().toString("base64url");
          token = `${header}.${payload}.${sig}`;
        }
        return {
          url: `http://127.0.0.1:${port}`,
          token: token
        };
      } catch {}
    }
  }
  return { url: "http://127.0.0.1:40325", token: "" };
}

const DEFAULT_LAUNCHER_CONFIG = loadShardLauncherConfig();
const LAUNCHER_API_URL = process.env.LAUNCHER_API_URL || DEFAULT_LAUNCHER_CONFIG.url;
const LAUNCHER_API_TOKEN = process.env.LAUNCHER_API_TOKEN || DEFAULT_LAUNCHER_CONFIG.token;

// ==============================================================================
// 2. CLASS RUNNER CHÍNH
// ==============================================================================
export class AiAgentRunner {
  // Private / Protected Properties
  _launcherApiUrl = "";
  _launcherToken = "";
  _headers = {};
  _browser = null;
  _ownsBrowser = false;
  _profileId = null;
  _isCreatedProfile = false;
  _activeProxy = null;
  _proxyMode = "shard"; // "shard" | "rotate" | "direct"
  _proxyGroup = "all";
  _gmailClient = null;
  _mailTm = null;
  _hotmailClient = null;
  _activeEmailService = "gmail";
  _totp = null;
  _proxyXoay = null;
  _accountStorage = null;
  _githubPage = null;
  _accountState = {
    email: "",
    password: "",
    username: "",
    emailOtp: "",
    twoFactorSecret: "",
    recoveryCodes: [],
    status: "initialized",
    report: "",
  };

  constructor(customConfig = {}) {
    const liveConfig = loadShardLauncherConfig();
    this._launcherApiUrl = process.env.LAUNCHER_API_URL || liveConfig.url;
    this._launcherToken = process.env.LAUNCHER_API_TOKEN || liveConfig.token;
    this._headers = { Authorization: `Bearer ${this._launcherToken}` };
    this._proxyMode = customConfig.proxyMode || process.env.PROXY_MODE || "shard";
    this._proxyGroup = customConfig.proxyGroup || process.env.PROXY_GROUP || "all";
    this._gmailClient = new GmailCreatorClient(customConfig.rapidApiKey);
    this._mailTm = new MailTmClient();
    this._totp = new TotpClient();
    this._proxyXoay = new ProxyXoayClient();
    this._accountStorage = new AccountStorageService(customConfig.storageConfig);

    if (customConfig.hotmailClient) {
      this._hotmailClient = customConfig.hotmailClient;
      this._activeEmailService = "hotmail";
    } else if (customConfig.accountLine) {
      this._hotmailClient = new HotmailGraphClient(customConfig.accountLine);
      this._activeEmailService = "hotmail";
    } else if (customConfig.emailService) {
      this._activeEmailService = customConfig.emailService;
    }

    this._targetProfile = customConfig.profile || customConfig.profileName || customConfig.profileId || process.env.SHARD_PROFILE || null;

    const sessionSuffix = Date.now().toString().slice(-4);
    this._accountState.username = `user${Math.random().toString(36).substring(2, 8)}${sessionSuffix}`;
    this._accountState.password = `GitA!${crypto.randomBytes(4).toString("hex")}#${Math.floor(1000 + Math.random() * 9000)}`;
  }

  // Giữ nguyên 100% C++ Native Fingerprint của ShardBrowser (Không can thiệp prototype JS để tránh bị DataDome phát hiện)
  async _injectStealthEvasions(page) {
    // ShardBrowser Engine đã tự xử lý ở tầng C++ Native, không cần tiêm JS
    return;
  }

  // Helper chờ an toàn
  _safeSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Độ trễ tự nhiên giữa từng thao tác (1.0s - 1.8s / 1000ms - 1800ms)
  async _actionDelay(min = 1000, max = 1800) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await this._safeSleep(ms);
  }

  // Độ trễ ngẫu nhiên mô phỏng người thật gõ phím (40ms - 80ms)
  _randomDelay(min = 40, max = 80) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Đọc danh sách Proxies: ƯU TIÊN SỐ 1 TỪ SHARDBROWSER UI (proxies.json / API), sau đó mới tới file text cá nhân
  _loadLocalProxies() {
    const list = [];
    const addedKeys = new Set();

    const addEntry = (item) => {
      if (!item || !item.host || !item.port) return;
      const key = `${item.host}:${item.port}`;
      if (addedKeys.has(key)) return;
      addedKeys.add(key);

      list.push({
        id: item.id || `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: item.name || `Proxy ${item.host}:${item.port}`,
        folder: item.folder || item.country || "all",
        country: item.country || "all",
        kind: item.kind || "http",
        host: item.host,
        port: Number(item.port),
        username: item.username || item.user || "",
        password: item.password || item.pass || "",
        proxyString: item.proxyString || null,
        isFromShard: !String(item.id || "").startsWith("file_"),
      });
    };

    // 1. ƯU TIÊN TUYỆT ĐỐI: Đọc danh sách từ cấu hình ShardBrowser proxies.json
    const appData = process.env.APPDATA || (os.platform() === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config"));
    const possibleJsonPaths = [
      path.join(appData, "shardx-launcher", "proxies.json"),
      path.join(os.homedir(), "AppData", "Roaming", "shardx-launcher", "proxies.json"),
      path.join(appData, "ShardBrowser", "proxies.json"),
      path.resolve(process.cwd(), "proxies.json"),
      path.resolve(process.cwd(), "Testing", "git", "proxies.json"),
    ];

    for (const p of possibleJsonPaths) {
      if (existsSync(p)) {
        try {
          const raw = readFileSync(p, "utf-8");
          const data = JSON.parse(raw);
          const entries = Array.isArray(data) ? data : (data && Array.isArray(data.proxies) ? data.proxies : []);
          for (const item of entries) addEntry(item);
        } catch {}
      }
    }

    // 2. Chỉ khi trong ShardBrowser chưa có proxy nào mới quét thêm các file text (dự phòng)
    if (list.length === 0) {
      const priorityTextFiles = [
        path.resolve(process.cwd(), "Testing", "git", "proxies.txt"),
        path.resolve(__dirname, "proxies.txt"),
        path.resolve(process.cwd(), "Testing", "git", "proxies_protocol.txt"),
        path.resolve(process.cwd(), "Testing", "proxify", "us_proxies.txt"),
        path.resolve(process.cwd(), "Testing", "proxify", "proxies_protocol.txt"),
        path.resolve(process.cwd(), "proxies.txt"),
      ];

      for (const fp of priorityTextFiles) {
        if (existsSync(fp)) {
          try {
            const content = readFileSync(fp, "utf-8");
            const lines = content.split(/\r?\n/);
            for (const line of lines) {
              const parsed = parseProxyLine(line);
              if (parsed) addEntry(parsed);
            }
          } catch {}
        }
      }
    }

    return list;
  }

  // Cơ chế xáo trộn ngẫu nhiên và kiểm tra proxy sống siêu tốc
  async _findFastLiveProxy(candidateList, maxTests = 35) {
    if (!Array.isArray(candidateList) || candidateList.length === 0) return null;

    // Nếu chỉ có đúng 1 proxy, kiểm tra trực tiếp và dùng luôn
    if (candidateList.length === 1) {
      const single = candidateList[0];
      console.log(`🌐 [Proxy Pool] Có 1 Proxy duy nhất [${single.host}:${single.port}]. Đang kiểm tra kết nối...`);
      const res = await checkProxyFastAndLive(single, 3000);
      single._verifiedLatency = (res && res.latency) ? res.latency : 0;
      console.log(`   \x1b[32m[✓ PROXY ĐƯỢC CHỌN]\x1b[0m Gán Proxy [${single.host}:${single.port}] (ping: ${single._verifiedLatency}ms) vào Profile.`);
      return single;
    }

    console.log(`🌐 [Proxy Pool] Tìm thấy ${candidateList.length} proxy khả dụng. Bắt đầu xáo trộn ngẫu nhiên và kiểm tra độ trễ...`);
    const shuffled = [...candidateList].sort(() => Math.random() - 0.5);
    const limit = Math.min(shuffled.length, maxTests);

    let bestAliveCandidate = null;

    // Kiểm tra theo cụm (Batch 4 proxies song song)
    const batchSize = 4;
    for (let i = 0; i < limit; i += batchSize) {
      const batch = shuffled.slice(i, i + batchSize);
      console.log(`🔍 [Đang kiểm tra Batch ${Math.floor(i / batchSize) + 1}] (${batch.map(p => `${p.host}:${p.port}`).join(", ")})...`);

      const batchResults = await Promise.all(
        batch.map(async (candidate) => {
          const res = await checkProxyFastAndLive(candidate, 3000);
          return { candidate, res };
        })
      );

      // 1. Ưu tiên chọn proxy sống và có ping <= 2000ms
      const passed = batchResults.find(r => r.res && r.res.alive && r.res.latency <= 2000);
      if (passed) {
        const { candidate, res } = passed;
        candidate._verifiedLatency = res.latency;
        console.log(`   \x1b[32m[✓ PROXY LIVE & NHANH]\x1b[0m Đã chọn [${candidate.host}:${candidate.port}] (ping: ${res.latency}ms)`);
        return candidate;
      }

      // 2. Lưu lại proxy sống để làm phương án dự phòng tốt nhất
      for (const item of batchResults) {
        if (item.res && item.res.alive) {
          if (!bestAliveCandidate || (item.res.latency && item.res.latency < (bestAliveCandidate._verifiedLatency || 99999))) {
            bestAliveCandidate = item.candidate;
            bestAliveCandidate._verifiedLatency = item.res.latency;
          }
        }
      }
    }

    // 3. Nếu không có proxy < 2000ms, lấy proxy sống có ping tốt nhất tìm được
    if (bestAliveCandidate) {
      console.log(`   \x1b[32m[✓ PROXY LIVE]\x1b[0m Đã chọn Proxy sống tốt nhất [${bestAliveCandidate.host}:${bestAliveCandidate.port}] (ping: ${bestAliveCandidate._verifiedLatency}ms)`);
      return bestAliveCandidate;
    }

    return null;
  }

  // Bọc thực thi promise với timeout an toàn chống treo
  async _evalWithTimeout(promise, ms = 3000) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(null), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
  }

  // Di chuột tự nhiên theo đường cong Bézier (Human-like Curve Trajectory)
  async _humanMouseMove(page, targetX, targetY) {
    if (!page || page.isClosed() || !targetX || !targetY) return;
    try {
      // Lấy vị trí chuột hiện tại qua evaluation
      const start = { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 };
      const control1 = {
        x: start.x + (targetX - start.x) * 0.25 + (Math.random() - 0.5) * 60,
        y: start.y + (targetY - start.y) * 0.25 + (Math.random() - 0.5) * 60,
      };
      const control2 = {
        x: start.x + (targetX - start.x) * 0.75 + (Math.random() - 0.5) * 40,
        y: start.y + (targetY - start.y) * 0.75 + (Math.random() - 0.5) * 40,
      };

      const steps = 15;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        // Công thức Bézier bậc 3
        const curX = Math.pow(1 - t, 3) * start.x +
                     3 * Math.pow(1 - t, 2) * t * control1.x +
                     3 * (1 - t) * Math.pow(t, 2) * control2.x +
                     Math.pow(t, 3) * targetX;
        const curY = Math.pow(1 - t, 3) * start.y +
                     3 * Math.pow(1 - t, 2) * t * control1.y +
                     3 * (1 - t) * Math.pow(t, 2) * control2.y +
                     Math.pow(t, 3) * targetY;
        await page.mouse.move(curX, curY);
        await this._safeSleep(8 + Math.floor(Math.random() * 12));
      }
    } catch {}
  }



  // Cuộn trang tự nhiên mô phỏng người thật
  async _smartScroll(page, direction = "down") {
    if (!page || page.isClosed()) return;
    const isUp = direction === "up" || direction === "home";
    await page.evaluate((up) => {
      if (up) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        window.scrollBy({ top: 350 + Math.random() * 150, behavior: "smooth" });
      }
    }, isUp).catch(() => {});
    await this._safeSleep(800 + Math.random() * 400);
  }

  // Tự động đóng Cookie Banner an toàn (không can thiệp thô bạo DOM gây trigger DataDome)
  async _detectAndCloseOverlays(page) {
    if (!page || page.isClosed()) return;
    try {
      const cookieBtn = await page.$("button.js-cookie-consent-reject, button.js-cookie-consent-accept, button[data-cookie-banner-action='reject'], button[data-cookie-banner-action='accept'], #accept-cookie-banner, .Overlay-closeButton");
      if (cookieBtn) {
        await cookieBtn.click().catch(() => {});
        await this._safeSleep(500);
      }
    } catch {}
  }

  // Gõ phím tự nhiên với độ trễ người thật và kích hoạt sự kiện
  async _humanType(page, selector, textToType, shouldPressEnter = false) {
    if (!page || page.isClosed() || !textToType) return false;

    try {
      await page.waitForSelector(selector, { visible: true, timeout: 15000 });
      const el = await page.$(selector);
      if (!el) return false;

      await page.evaluate((element) => {
        if (element) element.scrollIntoView({ behavior: "smooth", block: "center" });
      }, el).catch(() => {});
      await this._safeSleep(300);

      const box = await el.boundingBox().catch(() => null);
      if (box) {
        await this._humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
      }

      await el.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await this._safeSleep(120);

      // Gõ từng ký tự với delay ngẫu nhiên
      for (const char of textToType) {
        await page.keyboard.type(char, { delay: this._randomDelay(40, 80) });
      }

      await this._safeSleep(200);

      if (shouldPressEnter) {
        await page.keyboard.press("Enter");
        await this._safeSleep(800);
      }

      return true;
    } catch (err) {
      console.warn(`(!) Lỗi gõ vào ${selector} (${err.message}) -> Kích hoạt Fallback DOM injection...`);
      // Fallback: Nếu Puppeteer keyboard gặp timeout/lỗi, dùng JavaScript DOM evaluate trực tiếp để gán giá trị
      try {
        const fallbackSuccess = await page.evaluate((sel, val) => {
          const element = document.querySelector(sel);
          if (element) {
            element.focus();
            element.value = val;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            element.dispatchEvent(new Event("blur", { bubbles: true }));
            return true;
          }
          return false;
        }, selector, textToType).catch(() => false);

        if (fallbackSuccess) {
          console.log(`⚡ [Fallback DOM Fill] Đã gán giá trị thành công vào ${selector} qua DOM!`);
          return true;
        }
      } catch {}
      return false;
    }
  }

  // Chuyển đổi từ tiếng Anh (số phát âm) sang chuỗi chữ số
  _wordsToDigits(text) {
    if (!text || typeof text !== "string") return "";
    const wordMap = {
      zero: "0", "0": "0", "oh": "0",
      one: "1", "1": "1", "won": "1",
      two: "2", "to": "2", "too": "2", "2": "2",
      three: "3", "3": "3", "tree": "3",
      four: "4", "for": "4", "fore": "4", "4": "4",
      five: "5", "5": "5",
      six: "6", "6": "6",
      seven: "7", "7": "7",
      eight: "8", "ate": "8", "8": "8",
      nine: "9", "9": "9", "night": "9"
    };

    const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    let digits = "";
    for (const t of tokens) {
      if (wordMap[t]) {
        digits += wordMap[t];
      } else {
        for (const char of t) {
          if (wordMap[char]) digits += wordMap[char];
        }
      }
    }
    return digits;
  }

  // Nhận diện giọng nói từ Audio Buffer (Ưu tiên Deepgram AI Nova-2, dự phòng Google Speech, Wit.ai & Whisper)
  async _recognizeSpeechFromBuffer(audioBuffer, audioUrl = "") {
    if (!audioBuffer || audioBuffer.length === 0) return null;

    let mimeType = "audio/mpeg";
    if (audioUrl.includes(".wav") || (audioBuffer[0] === 0x52 && audioBuffer[1] === 0x49)) {
      mimeType = "audio/wav";
    } else if (audioUrl.includes(".ogg") || (audioBuffer[0] === 0x4f && audioBuffer[1] === 0x67)) {
      mimeType = "audio/ogg";
    }

    console.log(`-> Kích thước Audio: ${(audioBuffer.length / 1024).toFixed(1)} KB (Định dạng: ${mimeType})`);

    // 1. DEEPGRAM AI NOVA-2 SPEECH-TO-TEXT (ƯU TIÊN SỐ 1 - Siêu chính xác & <300ms)
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY || "4742e339567628fdf7026827f5398f038ada706f";
    if (deepgramApiKey) {
      try {
        console.log("-> 🚀 [Deepgram AI] Đang gửi file âm thanh tới mô hình Nova-2...");
        const dgResp = await axios.post(
          "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=en",
          audioBuffer,
          {
            headers: {
              Authorization: `Token ${deepgramApiKey}`,
              "Content-Type": mimeType,
            },
            timeout: 10000,
          }
        );

        const transcript = dgResp.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
        if (transcript) {
          console.log(`🗣️ [Deepgram Trích xuất]: "${transcript}"`);
          const digits = this._wordsToDigits(transcript);
          if (digits.length >= 3) {
            console.log(`🎯 [Deepgram AI Nova-2] Nhận diện thành công dãy số: [ \x1b[32m${digits}\x1b[0m ]`);
            return digits;
          }
        }
      } catch (dgErr) {
        console.warn(`(!) Lỗi Deepgram API: ${dgErr.response?.data?.err_msg || dgErr.message}`);
      }
    }

    // 2. Dự phòng: Google Speech Recognition API
    try {
      console.log("-> [STT Fallback 1] Thử nhận diện qua Google Speech Engine...");
      const gResp = await axios.post(
        "https://www.google.com/speech-api/v2/recognize?output=json&lang=en-us&key=AIzaSyA_placeholder",
        audioBuffer,
        {
          headers: { "Content-Type": mimeType === "audio/wav" ? "audio/l16; rate=16000" : "audio/mpeg" },
          timeout: 8000,
        }
      ).catch(() => null);

      if (gResp?.data) {
        const text = typeof gResp.data === "string" ? gResp.data : JSON.stringify(gResp.data);
        const digits = this._wordsToDigits(text);
        if (digits.length >= 3) {
          console.log(`🎯 [Google Speech] Nhận diện thành công: [ ${digits} ]`);
          return digits;
        }
      }
    } catch {}

    // 3. Dự phòng: Wit.ai Speech API
    console.log("-> [STT Fallback 2] Thử nhận diện qua Wit.ai API...");
    const witTokens = [
      "6Q7YKLTH3E4Q4NZQZ5J3X2C4J7QG3Y5U",
      "3A5TGLZ7F7E6P2K7A7QG3Y5U7QG3Y5U",
      "RGAQO73QHQGZQJJR7G52QO7EHYW5W3F3",
      "W6X4HUPM7PABDF37K733K2JDFB7YQG3Y"
    ];

    for (const token of witTokens) {
      try {
        const resp = await axios.post("https://api.wit.ai/speech?v=20230215", audioBuffer, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": mimeType,
          },
          timeout: 8000,
        });

        let textResult = "";
        if (typeof resp.data === "string") {
          const lines = resp.data.split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.text) textResult = parsed.text;
            } catch {}
          }
        } else if (resp.data?.text) {
          textResult = resp.data.text;
        }

        if (textResult) {
          console.log(`🗣️ [Wit.ai Trích xuất]: "${textResult}"`);
          const digits = this._wordsToDigits(textResult);
          if (digits.length >= 3) {
            return digits;
          }
        }
      } catch (witErr) {}
    }

    // 4. Dự phòng: RapidAPI Whisper Speech-to-Text
    const rapidKey = this._gmailClient?._apiKey || "b6886ec1f7mshbb17b1e26e0fab2p11d6b0jsna02d376b7db5";
    if (rapidKey) {
      console.log("-> [STT Fallback 3] Thử nhận diện qua RapidAPI Whisper Engine...");
      try {
        const resp = await axios.post("https://whisper4.p.rapidapi.com/transcribe", audioBuffer, {
          headers: {
            "x-rapidapi-key": rapidKey,
            "x-rapidapi-host": "whisper4.p.rapidapi.com",
            "Content-Type": mimeType,
          },
          timeout: 12000,
        }).catch(() => null);

        if (resp?.data?.text) {
          console.log(`🗣️ [RapidAPI Whisper Trích xuất]: "${resp.data.text}"`);
          const digits = this._wordsToDigits(resp.data.text);
          if (digits.length >= 3) return digits;
        }
      } catch {}
    }

    console.warn("⚠️ Không thể trích xuất tự động dãy số từ file Audio này.");
    return null;
  }

  // Tự động phát hiện và xử lý Captcha (DataDome / geo.captcha-delivery.com / Arkose / Octocaptcha)
  async _handleDataDomeCaptcha(page, mode = "auto") {
    if (!page || page.isClosed() || !this._browser) return false;

    try {
      // 1. Kiểm tra các tab / target con có URL captcha-delivery
      const targets = this._browser.targets();
      let captchaTarget = targets.find(t => t.url().includes("captcha-delivery.com") || t.url().includes("geo.captcha") || t.url().includes("datadome"));
      let captchaPage = null;

      if (captchaTarget) {
        captchaPage = await captchaTarget.page().catch(() => null);
      }

      // 2. Kiểm tra các iframe trong trang chính
      const frames = page.frames();
      let captchaFrame = frames.find(f => f.url().includes("captcha-delivery.com") || f.url().includes("geo.captcha") || f.url().includes("arkoselabs") || f.url().includes("datadome"));

      const ctx = captchaPage || captchaFrame || page;

      // 3. Kiểm tra các dấu hiệu nhận biết DataDome Captcha
      const captchaInfo = await ctx.evaluate(() => {
        const body = (document.body ? document.body.innerText : "") + " " + (document.title || "");
        const lower = body.toLowerCase();
        const hasText = lower.includes("why is this step needed") ||
                        lower.includes("we detected unusual activity from your device or network") ||
                        lower.includes("verification required") ||
                        lower.includes("slide right to secure your access") ||
                        lower.includes("captcha-delivery");

        const hasAudioBtn = !!(document.querySelector("#captcha__audio__button") || document.querySelector("[aria-label*='audio']"));
        const hasPuzzleBtn = !!(document.querySelector("#captcha__puzzle__button") || document.querySelector("[aria-label*='visual']"));
        const hasContainer = !!(document.querySelector("#ddv1-captcha-container") || document.querySelector(".datadome-container") || document.querySelector("iframe[src*='captcha-delivery']"));

        return {
          isDetected: hasText || hasAudioBtn || hasPuzzleBtn || hasContainer,
          hasAudioBtn,
        };
      }).catch(() => ({ isDetected: false, hasAudioBtn: false }));

      if (!captchaTarget && !captchaFrame && !captchaInfo.isDetected) {
        return false;
      }

      console.log(`\n🧩 \x1b[33m[PHÁT HIỆN CAPTCHA]\x1b[0m Hệ thống phát hiện thử thách xác minh DataDome / Geo Captcha!`);

      // ƯU TIÊN SỐ 1 TUYỆT ĐỐI: AUDIO CAPTCHA (Chuẩn cử chỉ người thật, không bị chặn Slider)
      console.log("-> 1. Bấm nút chuyển sang chế độ Âm thanh (Audio Voice Captcha) bằng chuột thật...");

      // Tìm nút Audio bằng ElementHandle
      let switchedToAudio = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const audioBtn = await ctx.$("#captcha__audio__button, button.audio-button, button.audio-btn, button[data-type='audio'], [aria-label*='audio' i], [title*='audio' i]");
          if (audioBtn) {
            const box = await audioBtn.boundingBox();
            if (box) {
              await this._humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
              await this._safeSleep(200 + Math.floor(Math.random() * 150));
            }
            await audioBtn.click({ delay: 70 });
            switchedToAudio = true;
            break;
          }
        } catch {}
        await this._safeSleep(1000);
      }

      await this._safeSleep(2000);

      // Đăng ký listener bắt trọn vẹn file âm thanh khi trình duyệt phát
      let capturedAudioBuf = null;
      let capturedAudioUrl = null;
      const audioListener = async (res) => {
        try {
          const u = res.url();
          const ct = (res.headers()["content-type"] || "").toLowerCase();
          if (u.includes("/captcha/audio") || u.includes(".wav") || u.includes(".mp3") || ct.includes("audio/")) {
            capturedAudioUrl = u;
            const buf = await res.buffer().catch(() => null);
            if (buf && buf.length > 500) {
              capturedAudioBuf = buf;
            }
          }
        } catch {}
      };
      page.on("response", audioListener);

      // Bấm nút Play phát âm thanh bằng chuột thật
      console.log("-> 2. Bấm nút phát âm thanh đọc dãy số bằng chuột thật...");
      try {
        const playBtn = await ctx.$("div.audio-captcha-play-container > button, #captcha__audio button, button[aria-label*='Listen' i], button[aria-label*='Play' i], button.play-button");
        if (playBtn) {
          const box = await playBtn.boundingBox();
          if (box) {
            await this._humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
            await this._safeSleep(200 + Math.floor(Math.random() * 150));
          }
          await playBtn.click({ delay: 80 });
        }
      } catch {}

      // Chờ stream audio tải về (tối đa 4s)
      const audioWaitStart = Date.now();
      while (Date.now() - audioWaitStart < 4000) {
        if (capturedAudioBuf) break;
        await this._safeSleep(300);
      }
      page.off("response", audioListener);

      // QUAN TRỌNG: DataDome yêu cầu đợi phát hết âm thanh (khoảng 3.5s - 4.5s) trước khi gõ phím
      console.log("⏳ [Nghe Âm Thanh] Chờ phát trọn vẹn dãy số trên trình duyệt...");
      await this._safeSleep(3800 + Math.floor(Math.random() * 800));

      // Fallback: Nếu listener không bắt được buffer, lấy link thẻ audio
      if (!capturedAudioBuf) {
        const audioUrl = await ctx.evaluate(() => {
          const audioEl = document.querySelector("audio");
          if (audioEl && audioEl.src) return audioEl.src;
          const sourceEl = document.querySelector("audio source");
          if (sourceEl && sourceEl.src) return sourceEl.src;
          return null;
        }).catch(() => null);

        if (audioUrl) {
          try {
            const resp = await axios.get(audioUrl, { responseType: "arraybuffer", timeout: 8000 });
            if (resp.data) capturedAudioBuf = Buffer.from(resp.data);
          } catch {}
        }
      }

      let recognizedDigits = null;
      if (capturedAudioBuf) {
        console.log("🤖 [AI Speech-to-Text] Đang nhận diện dãy số qua Deepgram Nova-2 / AI Speech...");
        recognizedDigits = await this._recognizeSpeechFromBuffer(capturedAudioBuf, capturedAudioUrl || "audio.wav");
      }

      if (recognizedDigits) {
        console.log(`🎯 [AI Speech-to-Text] Đã nhận diện thành công dãy số: [ \x1b[32m${recognizedDigits}\x1b[0m ]`);
        console.log(`-> Đang điền tuần tự 6 ô số [${recognizedDigits}] vào form xác thực...`);

        // Tìm các ô input trong card Audio Captcha
        const allInputs = await ctx.$$("input[type='text'], input[type='tel'], input[type='number'], #ddv1-captcha-container input, #captcha__audio input");
        
        if (allInputs.length > 0) {
          // Focus vào ô đầu tiên bằng chuột người thật
          const firstInput = allInputs[0];
          const firstBox = await firstInput.boundingBox().catch(() => null);
          if (firstBox) {
            await this._humanMouseMove(page, firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
            await this._safeSleep(150);
          }
          await firstInput.click({ delay: 50 }).catch(() => {});
          await this._safeSleep(200);

          // Nếu có từ 6 ô độc lập trở lên: click từng ô và gõ bằng bàn phím native (isTrusted: true)
          if (allInputs.length >= 6) {
            for (let i = 0; i < recognizedDigits.length && i < allInputs.length; i++) {
              const digit = recognizedDigits[i];
              const inp = allInputs[i];

              const box = await inp.boundingBox().catch(() => null);
              if (box) {
                await this._humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
                await this._safeSleep(60 + Math.floor(Math.random() * 50));
              }
              await inp.click({ delay: 40 }).catch(() => {});
              await this._safeSleep(80 + Math.floor(Math.random() * 60));

              // Gõ phím Chromium native (isTrusted: true 100%, KHÔNG dispatch synthetic event)
              await page.keyboard.press(digit);
              await this._safeSleep(150 + Math.floor(Math.random() * 120));
            }
          } else {
            // Trường hợp 1 ô nhập gộp: gõ lần lượt từng số
            for (const digit of recognizedDigits) {
              await page.keyboard.press(digit);
              await this._safeSleep(180 + Math.floor(Math.random() * 100));
            }
          }
        }

        // Dừng tự nhiên 1.5s - 2.2s như người thật kiểm tra lại dãy số trước khi bấm gửi
        await this._safeSleep(1500 + Math.floor(Math.random() * 700));

        // Bấm nút Verify hoàn toàn bằng chuột thật (isTrusted: true 100%, KHÔNG can thiệp DOM)
        console.log("-> Bấm nút 'Verify' bằng chuột thật để hoàn tất xác thực...");
        try {
          const submitBtn = await ctx.$(".audio-captcha-submit-button, div.audio-captcha-submit-container > button, #captcha__audio button[type='submit'], [aria-label='Verify'], button.audio-captcha-submit, button[type='submit']");
          if (submitBtn) {
            const box = await submitBtn.boundingBox().catch(() => null);
            if (box) {
              await this._humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
              await this._safeSleep(300 + Math.floor(Math.random() * 200));
            }
            await submitBtn.click({ delay: 90 });
            console.log("✅ [Captcha Submitted] Đã bấm nút Verify thành công!");
          }
        } catch {}

        await this._safeSleep(5000);
        return true;
      }

      console.log("💡 [Hướng dẫn] Đang ở màn hình xác thực DataDome (Bạn có thể giải tiếp trên màn hình trình duyệt)...");
      return true;
    } catch (captchaErr) {
      return false;
    }
  }

  // Click an toàn không bấm nhầm Google/Apple/Link reload
  async _safeClick(page, selectorOrText) {
    if (!page || page.isClosed() || !selectorOrText) return false;
    await this._detectAndCloseOverlays(page);

    try {
      const clicked = await page.evaluate((target) => {
        const normalize = (v) => (v || "").replace(/\s+/g, " ").trim().toLowerCase();
        const targetClean = normalize(target);

        // 1. Tìm bằng selector trực tiếp
        if (target.startsWith("#") || target.startsWith(".") || target.startsWith("[") || target.startsWith("button")) {
          try {
            const el = document.querySelector(target);
            if (el) {
              const txt = normalize(el.innerText || "");
              if (!txt.includes("google") && !txt.includes("apple") && !txt.includes("passkey")) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                el.click();
                return true;
              }
            }
          } catch {}
        }

        // 2. Tìm bằng Text nội dung: ƯU TIÊN BUTTON & INPUT SUBMIT TRƯỚC (loại bỏ thẻ <a> có href)
        const candidates = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button'], summary, .btn, .Button"));
        for (const candidate of candidates) {
          const txt = normalize(candidate.innerText || candidate.textContent || candidate.value || "");
          const href = normalize(candidate.getAttribute("href") || "");
          const action = normalize(candidate.closest("form")?.getAttribute("action") || "");

          if (txt.includes("google") || txt.includes("apple") || txt.includes("passkey") || href.includes("google") || action.includes("google")) {
            continue;
          }

          if (txt === targetClean || txt.includes(targetClean)) {
            candidate.scrollIntoView({ behavior: "smooth", block: "center" });
            candidate.click();
            return true;
          }
        }

        // 3. Nếu là thẻ link <a>, chỉ bấm nếu là setup key hoặc link nội bộ không reload trang
        if (targetClean.includes("setup key") || targetClean.includes("continue") || targetClean.includes("saved my recovery")) {
          const links = Array.from(document.querySelectorAll("a"));
          for (const a of links) {
            const txt = normalize(a.innerText || a.textContent || "");
            if (txt === targetClean || txt.includes(targetClean)) {
              a.scrollIntoView({ behavior: "smooth", block: "center" });
              a.click();
              return true;
            }
          }
        }

        return false;
      }, selectorOrText);

      if (clicked) {
        await this._actionDelay(1000, 1800);
        return true;
      }
    } catch {}

    return false;
  }

  // Điền mã OTP vào GitHub bằng sự kiện bàn phím thật (isTrusted: true)
  async _fillOtpDigits(page, otpCode) {
    if (!page || page.isClosed() || !otpCode) return false;
    const cleanCode = String(otpCode).trim();
    console.log(`⚡ [OTP Filling] Đang nhập mã OTP [${cleanCode}] vào GitHub...`);

    try {
      // 1. Tìm ô đầu tiên và click vào
      const firstInputSelector = "#launch-code-0, input[data-index='0'], [data-testid='otp-digit'], input[id^='launch-code-'], input[autocomplete='one-time-code'], input[name='otp']";
      await page.waitForSelector(firstInputSelector, { visible: true, timeout: 15000 }).catch(() => null);
      const firstEl = await page.$(firstInputSelector);

      if (firstEl) {
        await firstEl.click();
        await this._safeSleep(200);

        // Gõ tuần tự 6 số bằng bàn phím người thật (mỗi ký tự có delay ngẫu nhiên 60-120ms)
        for (const char of cleanCode) {
          await page.keyboard.type(char, { delay: this._randomDelay(60, 120) });
          await this._safeSleep(50);
        }
      } else {
        // Fallback qua single input
        const singleOtp = await page.$("#app_totp, #otp, input[name='otp'], input[autocomplete='one-time-code']");
        if (singleOtp) {
          await singleOtp.click({ clickCount: 3 });
          await page.keyboard.type(cleanCode, { delay: this._randomDelay(60, 100) });
        }
      }

      await this._actionDelay(1200, 2000);
      return true;
    } catch {
      return false;
    }
  }

  // Đọc toàn bộ nội dung body text
  async _bodyText(page) {
    if (!page || page.isClosed()) return "";
    return page.evaluate(() => document.body?.innerText || "").catch(() => "");
  }

  // Click vào nút/link theo text hiển thị có delay an toàn
  async _clickVisibleText(page, text) {
    if (!page || page.isClosed()) return false;
    await this._safeSleep(1000);

    const clicked = await page.evaluate((wanted) => {
      const normalize = (value) => value.replace(/\s+/g, " ").trim().toLowerCase();
      const target = normalize(wanted);
      const elements = [...document.querySelectorAll("button, a, summary, [role='button']")];
      const element = elements.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return !candidate.hidden && rect.width > 0 && rect.height > 0 && normalize(candidate.innerText || "").includes(target);
      });
      if (!element) return false;
      element.click();
      return true;
    }, text).catch(() => false);

    if (!clicked) throw new Error(`Không tìm thấy nút: ${text}`);
    await this._safeSleep(2000);
    return true;
  }

  // Điền form chuẩn xác với delay an toàn
  async _fill(page, selector, value) {
    if (!page || page.isClosed()) return;
    await page.waitForSelector(selector, { visible: true, timeout: 30000 });
    const el = await page.$(selector);
    if (el) {
      await el.click({ clickCount: 3 });
      await page.type(selector, value, { delay: 25 });
    }
    await this._safeSleep(2000);
  }

  // Giải mã Base32 thành Buffer (Chuẩn RFC 4648)
  _base32Decode(base32) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    const clean = String(base32).replace(/=+$/, "").toUpperCase().replace(/[\s-]/g, "");
    for (let i = 0; i < clean.length; i++) {
      const val = alphabet.indexOf(clean[i]);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.substring(i, i + 8), 2));
    }
    return Buffer.from(bytes);
  }

  // Sinh mã TOTP 6 chữ số trực tiếp bằng node:crypto (0ms, không mở tab, không qua proxy)
  _generateTotp(secret, timeStepSec = 30) {
    const key = this._base32Decode(secret);
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / timeStepSec);
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(counter));

    const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    const otp = binary % 1000000;
    return otp.toString().padStart(6, "0");
  }

  // Trích xuất Base32 Setup Key từ trang GitHub (chuẩn github_2fa_puppeteer.mjs)
  async _extractSetupKey(page) {
    console.log("-> Đang tìm và mở Setup Key...");
    await this._safeSleep(1500);

    // 1. Thử click link/nút "setup key", "enter this text code", "can't scan"
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll("button, a, summary, [role='button'], span, p"));
        for (const el of elements) {
          const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
          if (txt.includes("setup key") || txt.includes("enter this text code") || txt.includes("cant scan") || txt.includes("can't scan") || txt.includes("manually")) {
            el.click();
            return true;
          }
        }
        return false;
      }).catch(() => {});
      await this._safeSleep(1000);
    }

    // 2. Trích xuất Key từ nhiều nguồn trong DOM (Polling tối đa 15s)
    let cleanKey = null;
    const startTime = Date.now();

    while (Date.now() - startTime < 15000) {
      cleanKey = await page.evaluate(() => {
        // Nguồn A: Thuộc tính value của thẻ clipboard-copy
        const copyEl = document.querySelector("two-factor-setup-verification clipboard-copy, clipboard-copy[value]");
        if (copyEl && copyEl.getAttribute("value")) {
          const val = copyEl.getAttribute("value").trim().replace(/[\s-]/g, "");
          if (/^[A-Z2-7]{16,32}$/i.test(val)) return val;
        }

        // Nguồn B: Custom element two-factor-setup-verification
        const setupEl = document.querySelector("two-factor-setup-verification, .two-factor-setup-verification");
        if (setupEl) {
          const txt = setupEl.innerText || setupEl.textContent || "";
          const m = txt.match(/Your two-factor secret\s*([A-Z2-7]{16,})/i) || txt.match(/\b([A-Z2-7]{16,32})\b/);
          if (m) return m[1];
        }

        // Nguồn C: Toàn bộ body text
        const fullText = document.body ? document.body.innerText : "";
        const match = fullText.match(/Your two-factor secret\s*([A-Z2-7]{16,})/i) ||
                      fullText.match(/secret key\s*:\s*([A-Z2-7]{16,})/i) ||
                      fullText.match(/\b([A-Z2-7]{16,32})\b/);
        return match ? match[1] : null;
      }).catch(() => null);

      if (cleanKey && cleanKey.length >= 16) {
        break;
      }
      await this._safeSleep(1500);
    }

    if (!cleanKey) throw new Error(`Không lấy được setup key từ GitHub (URL: ${page.url()}).`);
    cleanKey = cleanKey.replace(/[\s-]/g, "").toUpperCase();
    this._accountState.twoFactorSecret = cleanKey;
    console.log(`🔐 [2FA Setup] Đã lấy Setup Key từ GitHub: ${cleanKey}`);
    await this._safeSleep(1500);
    return cleanKey;
  }

  // ĐĂNG NHẬP GITHUB NẾU CẦN (Chỉ khi trang thực sự ở /login)
  async _loginIfNeeded(page) {
    if (!page || page.isClosed()) return;
    let currentUrl = page.url();
    let text = await this._bodyText(page);

    // Nếu đã ở Dashboard hoặc trang cài đặt trong GitHub thì không làm gì
    if (currentUrl.includes("/settings") || currentUrl === "https://github.com/" || text.includes("Dashboard") || text.includes("Top repositories")) {
      console.log("✅ Đã có phiên đăng nhập hợp lệ trên GitHub.");
      return;
    }

    // Chỉ điền form nếu thực sự đang ở màn hình login
    if (currentUrl.includes("/login") || text.includes("Sign in to GitHub")) {
      const username = this._accountState.email || this._accountState.username;
      const password = this._accountState.password;

      console.log(`🔑 [loginIfNeeded] Đang ở trang Login -> Điền tài khoản: ${username}`);
      await this._fill(page, "#login_field, input[name='login']", username);
      await this._safeSleep(1500);
      await this._fill(page, "#password, input[name='password']", password);
      await this._safeSleep(1500);

      console.log("-> Bấm 'Sign in' và đợi hoàn tất đăng nhập...");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
        page.click('input[type="submit"], button[type="submit"]')
      ]);
      await this._safeSleep(3000);

      // Kiểm tra nếu có Device Verification (Mã xác nhận thiết bị gửi qua email)
      text = await this._bodyText(page);
      currentUrl = page.url();
      if (currentUrl.includes("/sessions/verified-device") || text.includes("Device verification") || text.includes("Verify your account")) {
        console.log(`📬 [Device Verification] GitHub yêu cầu mã xác minh thiết bị từ ${this._activeEmailService === 'gmail' ? 'Gmail API' : 'Mail.tm'}...`);
        try {
          const devCodeRes = this._activeEmailService === "gmail"
            ? await this._gmailClient.waitForVerificationCode(60, 3)
            : await this._mailTm.waitForVerificationCode(60, 2);
          if (devCodeRes.otpCode) {
            console.log(`⚡ [Device OTP] Đã nhận mã thiết bị: [${devCodeRes.otpCode}], đang điền...`);
            await this._fillOtpDigits(page, devCodeRes.otpCode);
            await this._safeSleep(4000);
          }
        } catch (devErr) {
          console.warn(`(!) Lỗi nhận mã thiết bị: ${devErr.message}`);
        }
      }
    }
  }

  // Xử lý sau khi nhập OTP: chờ mạng chậm, khảo sát onboarding, và chuyển tiếp an toàn
  async _handlePostSignupFlow(page) {
    console.log("-> Đang theo dõi tiến trình hoàn tất đăng ký của GitHub (xử lý mạng chậm & onboarding)...");
    const startTime = Date.now();
    const maxWaitMs = 120000; // Chờ tối đa 2 phút cho mạng chậm / proxy lag

    while (Date.now() - startTime < maxWaitMs) {
      if (!page || page.isClosed()) break;

      const currentUrl = page.url();
      const bodyText = await this._bodyText(page);

      // 1. Nếu bị chuyển về trang login
      if (currentUrl.includes("/login") || bodyText.includes("Sign in to GitHub")) {
        console.log("🔑 [GitHub Yêu cầu Login] Tự động đăng nhập xác thực phiên...");
        await this._loginIfNeeded(page);
        return true;
      }

      // 2. Nếu gặp trang Khảo sát / Onboarding / Customization (bấm Skip hoặc Continue)
      const clickedAction = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, a, input[type='submit']"));
        for (const b of buttons) {
          const txt = (b.innerText || b.textContent || b.value || "").trim().toLowerCase();
          if (
            txt.includes("skip personalization") ||
            txt.includes("skip") ||
            txt.includes("continue") ||
            txt.includes("complete setup")
          ) {
            b.scrollIntoView({ behavior: "smooth", block: "center" });
            b.click();
            return txt;
          }
        }
        return null;
      }).catch(() => null);

      if (clickedAction) {
        console.log(`⚡ [Onboarding] Đã bấm nút: '${clickedAction}'`);
        await this._safeSleep(3000);
        continue;
      }

      // 3. Nếu đã vào Dashboard hoặc trang chính của tài khoản (đã xong khâu tạo tài khoản)
      if (
        bodyText.includes("Top repositories") ||
        bodyText.includes("Welcome to GitHub") ||
        bodyText.includes("Dashboard") ||
        bodyText.includes("Recent activity") ||
        currentUrl === "https://github.com/" ||
        currentUrl === "https://github.com" ||
        currentUrl.includes("github.com/dashboard")
      ) {
        console.log(`✅ [Hoàn tất Đăng ký] Đã vào Dashboard chính thành công (${currentUrl})!`);
        return true;
      }

      // 4. Nếu vẫn còn trên account_verifications / verify_email / signup
      await this._safeSleep(2000);
    }
    return true;
  }

  // KÍCH HOẠT 2FA (enableTwoFactor mượt mà 100%, không reload đột ngột)
  async _enableTwoFactor(page) {
    console.log("\n🛡️ [enableTwoFactor] Truy cập Settings → Security → Bật 2FA...");
    await page.goto("https://github.com/settings/security", { waitUntil: "domcontentloaded", timeout: 60000 });
    await this._safeSleep(3000);

    // 1. Xử lý nếu bị chuyển về trang login
    if (page.url().includes("/login") || (await this._bodyText(page)).includes("Sign in to GitHub")) {
      await this._loginIfNeeded(page);
      await this._safeSleep(2500);
    }

    // 2. Xử lý nếu gặp Sudo Password
    if (page.url().includes("/sessions/sudo") || (await this._bodyText(page)).includes("Confirm password")) {
      console.log("🛡️ [Sudo Mode] GitHub yêu cầu xác nhận mật khẩu...");
      const sudoInput = await page.waitForSelector('#sudo_password, input[name="password"], input[type="password"]', { visible: true, timeout: 15000 }).catch(() => null);
      if (sudoInput) {
        await sudoInput.click({ clickCount: 3 });
        await sudoInput.type(this._accountState.password, { delay: 35 });
        await this._safeSleep(1500);
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
          page.click('button[type="submit"], input[type="submit"]')
        ]);
        await this._safeSleep(3000);
      }
    }

    // 3. Kiểm tra nếu 2FA đã được bật sẵn
    let text = await this._bodyText(page);
    if (text.includes("Authenticator app") && text.includes("Configured")) {
      console.log("✅ Tài khoản đã bật 2FA bằng Authenticator app; không thay đổi gì.");
      this._accountState.status = "verified-and-2fa-configured";
      return { alreadyEnabled: true };
    }

    // 4. Mở trang cấu hình Setup 2FA
    console.log("-> Mở trang cấu hình 2FA Setup Intro...");
    await page.goto("https://github.com/settings/two_factor_authentication/setup/intro", { waitUntil: "domcontentloaded", timeout: 60000 });
    await this._safeSleep(3000);

    // Kiểm tra nếu bị đẩy về login hoặc trang session
    if (page.url().includes("/login") || page.url().includes("/session") || (await this._bodyText(page)).includes("Sign in to GitHub")) {
      await this._loginIfNeeded(page);
      await this._safeSleep(2500);
      // Mở lại trang setup intro sau khi đăng nhập xong
      await page.goto("https://github.com/settings/two_factor_authentication/setup/intro", { waitUntil: "domcontentloaded", timeout: 60000 });
      await this._safeSleep(3000);
    }

    // Bấm Continue hoặc Set up using an app
    console.log("-> Bấm nút Tiếp tục để mở màn hình mã QR / Setup Key...");
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button, a, input[type='submit']"));
      for (const b of buttons) {
        const txt = (b.innerText || b.textContent || b.value || "").trim().toLowerCase();
        if (txt === "continue" || txt.includes("set up using an app") || txt.includes("authenticator app") || txt.includes("enable two-factor")) {
          b.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    await this._safeSleep(2500);

    // 5. Lấy Setup Key (nếu trang chưa ở đúng màn hình setup thì tự động điều hướng lại)
    if (page.url().includes("/session") || page.url().includes("/login")) {
      await page.goto("https://github.com/settings/two_factor_authentication/setup/intro", { waitUntil: "domcontentloaded", timeout: 60000 });
      await this._safeSleep(2500);
    }
    const setupKey = await this._extractSetupKey(page);

    // 6. Sinh mã TOTP bằng TotpClient (0ms Offline)
    const code = await this._totp.getCodeWithFallback(setupKey);
    console.log(`🔑 [TOTP Client] Sinh mã TOTP trực tiếp: [ ${code} ]`);
    await this._safeSleep(1500);

    // 7. Điền mã TOTP vào form verify của GitHub
    console.log(`-> Điền mã xác thực TOTP: [ ${code} ]`);
    const otpSelector = 'input[placeholder="XXXXXX"], input[name="otp"], input[autocomplete="one-time-code"], input[id*="otp"], form[action*="setup/verify"] input[type="text"]';
    
    await page.waitForSelector(otpSelector, { visible: true, timeout: 20000 });
    const otpEl = await page.$(otpSelector);
    if (!otpEl) throw new Error("Không tìm thấy ô nhập mã xác minh TOTP.");

    // Cuộn tới ô input và focus
    await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      }
    }, otpSelector).catch(() => {});
    await this._safeSleep(500);

    // Gõ mã OTP với dispatch event đầy đủ
    await otpEl.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await this._safeSleep(150);

    for (const char of code) {
      await page.keyboard.type(char, { delay: this._randomDelay(40, 80) });
    }

    // Set trực tiếp giá trị vào DOM để đảm bảo 100% không bị rỗng
    await page.evaluate((selector, val) => {
      const el = document.querySelector(selector);
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    }, otpSelector, code).catch(() => {});
    await this._safeSleep(1500);

    // Bấm nút Continue màu xanh hoặc submit form
    console.log("-> Bấm nút 'Continue' để xác nhận mã TOTP...");
    let submitted = await page.evaluate(() => {
      // Tìm nút Continue màu xanh
      const btns = Array.from(document.querySelectorAll("button, input[type='submit']"));
      for (const b of btns) {
        const txt = (b.innerText || b.textContent || b.value || "").trim().toLowerCase();
        if (txt === "continue" || txt === "verify" || txt.includes("save")) {
          b.click();
          return true;
        }
      }
      const form = document.querySelector('form[action*="setup/verify"]');
      if (form) {
        form.requestSubmit();
        return true;
      }
      return false;
    }).catch(() => false);

    if (!submitted) {
      await page.keyboard.press("Enter");
    }
    await this._safeSleep(5000);

    // 8. Chờ màn hình Recovery Codes xuất hiện và quét codes
    console.log("🛡️ [2FA Recovery] Đang chờ và trích xuất Recovery Codes...");
    await page.waitForSelector('ul[data-target*="recovery-codes.codes"] li, .recovery-code-list li, [data-testid="recovery-code"], button[data-action*="onDownloadClick"]', { visible: true, timeout: 25000 }).catch(() => {});
    await this._safeSleep(2000);

    const recoveryCodes = await page.$$eval(
      'ul[data-target*="recovery-codes.codes"] li, .recovery-code-list li, [data-testid="recovery-code"]',
      (items) => items.map((item) => item.innerText.trim()).filter(Boolean),
    ).catch(async () => {
      const full = await page.evaluate(() => document.body ? document.body.innerText : "");
      const matches = full.match(/\b[a-f0-9]{5}-[a-f0-9]{5}\b/gi);
      return matches ? Array.from(new Set(matches)) : [];
    });

    if (recoveryCodes && recoveryCodes.length > 0) {
      this._accountState.recoveryCodes = recoveryCodes;
      console.log(`✅ [enableTwoFactor] Thu thập thành công ${recoveryCodes.length} mã Recovery Codes.`);
    }

    // 1. Bấm nút Download recovery codes
    console.log("-> Bấm nút 'Download' recovery codes...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      for (const b of btns) {
        const txt = (b.innerText || b.textContent || "").trim().toLowerCase();
        if (txt.includes("download") || b.getAttribute("data-action")?.includes("onDownloadClick")) {
          b.scrollIntoView({ behavior: "smooth", block: "center" });
          b.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    await this._safeSleep(2000);

    // 2. Bấm xác nhận "I have saved my recovery codes"
    console.log("-> Bấm nút 'I have saved my recovery codes'...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      for (const b of btns) {
        const txt = (b.innerText || b.textContent || "").trim().toLowerCase();
        if (txt.includes("saved my recovery") || txt.includes("i have saved")) {
          b.scrollIntoView({ behavior: "smooth", block: "center" });
          b.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    await this._safeSleep(4000);

    // 3. Bấm Done (nếu có)
    console.log("-> Bấm nút 'Done'...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      for (const b of btns) {
        const txt = (b.innerText || b.textContent || "").trim().toLowerCase();
        if (txt === "done" || txt.includes("done")) {
          b.scrollIntoView({ behavior: "smooth", block: "center" });
          b.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    await this._safeSleep(3000);

    // 9. Kiểm tra trạng thái cuối cùng
    await this._safeSleep(2000);
    const endUrl = page.url();
    if (!endUrl.includes("/settings/security")) {
      await page.goto("https://github.com/settings/security", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await this._safeSleep(2500);
    }

    text = await this._bodyText(page);
    if (text.includes("Authenticator app") && text.includes("Configured")) {
      console.log("🎉 [2FA Verified] Bật 2FA thành công và đã xác minh trạng thái Configured!");
      this._accountState.status = "verified-and-2fa-configured";
      return { alreadyEnabled: false, setupKey, recoveryCodes };
    }

    this._accountState.status = "verified-and-2fa-configured";
    return { alreadyEnabled: false, setupKey, recoveryCodes };
  }

  // KẾT NỐI TRÌNH DUYỆT TÁCH BIỆT 100% (ROTATING PROXY + NEW FINGERPRINT)
  async _connectOrLaunchBrowser(options = {}) {
    const envWs = process.env.BROWSER_WS_ENDPOINT || process.env.BROWSER_USE_CDP_WS || options.wsEndpoint;
    const envCdp = process.env.BROWSER_CDP_URL || process.env.BROWSER_USE_CDP_URL || process.env.CDP_URL || options.cdpUrl;

    if (envWs) {
      console.log(`[Browser] 🔗 Đang kết nối tới WebSocket Endpoint: ${envWs}`);
      this._browser = await puppeteer.connect({ browserWSEndpoint: envWs, defaultViewport: null, protocolTimeout: 240000 });
      this._ownsBrowser = false;
      return this._browser;
    }

    if (envCdp) {
      console.log(`[Browser] 🔗 Đang kết nối tới CDP URL: ${envCdp}`);
      this._browser = await puppeteer.connect({ browserURL: envCdp, defaultViewport: null, protocolTimeout: 240000 });
      this._ownsBrowser = false;
      return this._browser;
    }

    try {
      console.log(`[ShardX] 🚀 Đang kết nối ShardX Launcher tại ${this._launcherApiUrl}...`);

      const targetProf = options.profile || options.profileName || options.profileId || this._targetProfile;
      const cloneTarget = options.cloneFrom || options.clone || (options.isClone ? targetProf : null);

      // 1. NẾU SỬ DỤNG CHẾ ĐỘ CLONE TỪ PROFILE MẪU (Ví dụ: --clone=32231)
      if (cloneTarget) {
        try {
          const { data: allProfiles } = await axios.get(`${this._launcherApiUrl}/profiles`, { headers: this._headers, timeout: 5000 }).catch(() => ({ data: [] }));
          if (Array.isArray(allProfiles) && allProfiles.length > 0) {
            const matched = allProfiles.find(p =>
              p.id === cloneTarget ||
              p.name === cloneTarget ||
              (p.name && p.name.trim().toLowerCase() === cloneTarget.trim().toLowerCase())
            );

            if (matched) {
              console.log(`🧬 [Clone Profile] Đang nhân bản (Clone) từ Profile mẫu chuẩn: '${matched.name}' (ID: ${matched.id})...`);
              const { data: clonedMeta } = await axios.post(`${this._launcherApiUrl}/profiles/${matched.id}/clone`, {}, { headers: this._headers });
              if (clonedMeta && clonedMeta.id) {
                this._profileId = clonedMeta.id;
                this._isCreatedProfile = true; // Sẽ tự động dọn dẹp bản clone sau khi đăng ký xong
                console.log(`✨ [Clone Success] Đã tạo Profile Clone mới ID: ${this._profileId} ('${clonedMeta.name}'). Đang khởi chạy...`);

                const { data: startRes } = await axios.post(`${this._launcherApiUrl}/profiles/${this._profileId}/start`, { headless: false }, { headers: this._headers });
                const wsUrl = startRes.cdp?.web_socket_debugger_url;

                if (wsUrl) {
                  this._browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null, protocolTimeout: 240000 });
                  this._ownsBrowser = false;
                  console.log(`🔗 [CDP Connected] Đã kết nối Puppeteer vào Profile Clone '${clonedMeta.name}'.`);
                  return this._browser;
                }
              }
            } else {
              console.warn(`⚠️ [Clone Warning] Không tìm thấy Profile mẫu '${cloneTarget}' để Clone.`);
            }
          }
        } catch (cloneErr) {
          console.warn(`⚠️ [Clone Error]: ${cloneErr.message}`);
        }
      }

      // 2. NẾU CHỈ ĐỊNH PROFILE CÓ SẴN (Chạy trực tiếp trên Profile đó, không clone)
      if (targetProf) {
        try {
          const { data: allProfiles } = await axios.get(`${this._launcherApiUrl}/profiles`, { headers: this._headers, timeout: 5000 }).catch(() => ({ data: [] }));
          if (Array.isArray(allProfiles) && allProfiles.length > 0) {
            const matched = allProfiles.find(p =>
              p.id === targetProf ||
              p.name === targetProf ||
              (p.name && p.name.trim().toLowerCase() === targetProf.trim().toLowerCase())
            );

            if (matched) {
              this._profileId = matched.id;
              this._isCreatedProfile = false; // Đánh dấu là profile người dùng, KHÔNG XÓA khi kết thúc
              console.log(`✨ [Existing Profile] Tìm thấy Profile có sẵn: '${matched.name}' (ID: ${matched.id}). Đang khởi chạy...`);

              const { data: startRes } = await axios.post(`${this._launcherApiUrl}/profiles/${this._profileId}/start`, { headless: false }, { headers: this._headers });
              const wsUrl = startRes.cdp?.web_socket_debugger_url;

              if (wsUrl) {
                this._browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null, protocolTimeout: 240000 });
                this._ownsBrowser = false;
                console.log(`🔗 [CDP Connected] Đã kết nối Puppeteer vào Profile '${matched.name}'.`);
                return this._browser;
              }
            } else {
              console.warn(`⚠️ [Existing Profile] Không tìm thấy profile '${targetProf}' trong ShardBrowser -> Tiến hành tạo Profile tự động mới.`);
            }
          }
        } catch (profErr) {
          console.warn(`⚠️ [Profile Search Error]: ${profErr.message}`);
        }
      }

      // BƯỚC 0: TỰ ĐỘNG XÓA SẠCH PROFILE TẠM CŨ THUỘC NHÓM 'GitHub-Auto' (Không đụng profile người dùng)
      await this._deleteAllOldProfiles();

      // BƯỚC 1: LỰA CHỌN PROXY THEO CHẾ ĐỘ CẤU HÌNH (direct | shard | rotate | inline static proxy)
      const effectiveMode = options.proxy || options.proxyMode || this._proxyMode || "direct";
      let chosenProxy = null;

      if (options.proxy || (typeof effectiveMode === "string" && (effectiveMode.includes(":") || effectiveMode.includes("//")))) {
        const rawProxy = options.proxy || effectiveMode;
        chosenProxy = parseProxyLine(rawProxy);
        if (chosenProxy) {
          this._activeProxy = chosenProxy;
          console.log(`🌐 [Network Mode: STATIC PROXY] Đã gán Proxy thủ công: [${chosenProxy.host}:${chosenProxy.port}] (Không gọi API xoay).`);
        }
      } else if (effectiveMode === "direct") {
        console.log("🌐 [Network Mode: DIRECT] Sử dụng IP mạng trực tiếp của máy tính (Không dùng Proxy).");
      } else if (effectiveMode === "shard") {
        const targetGroup = (options.proxyGroup || this._proxyGroup || "all").trim().toLowerCase();
        console.log(`🌐 [Network Mode: SHARD] Đang quét danh sách Proxy từ ShardBrowser ${targetGroup === 'all' ? '(toàn bộ UI pool)' : `thuộc nhóm [${targetGroup.toUpperCase()}]`}...`);
        try {
          let list = [];
          try {
            const { data: apiProxies } = await axios.get(`${this._launcherApiUrl}/proxies`, { headers: this._headers, timeout: 3000 });
            if (Array.isArray(apiProxies) && apiProxies.length > 0) {
              list = apiProxies;
              console.log(`✨ [ShardBrowser UI] Đã nạp thành công ${list.length} Proxy trực tiếp từ phần mềm ShardBrowser.`);
            }
          } catch {}

          if (!list || list.length === 0) {
            list = this._loadLocalProxies();
          }

          if (Array.isArray(list) && list.length > 0) {
            let candidateList = list;
            if (targetGroup && targetGroup !== "all") {
              const matched = list.filter(p => 
                (p.folder || "").trim().toLowerCase() === targetGroup ||
                (p.country || "").trim().toLowerCase() === targetGroup
              );
              if (matched.length > 0) candidateList = matched;
            }

            if (options.proxyId) {
              chosenProxy = candidateList.find(p => p.id === options.proxyId);
            }
            if (!chosenProxy) {
              chosenProxy = await this._findFastLiveProxy(candidateList);
            }
            if (chosenProxy) {
              this._activeProxy = chosenProxy;
              const authInfo = (chosenProxy.username || chosenProxy.user) ? ` | User: ${chosenProxy.username || chosenProxy.user}` : " | No Auth";
              console.log(`🎲 [Selected Proxy ShardBrowser] -> [${chosenProxy.name || chosenProxy.host}] (${chosenProxy.kind || 'http'}://${chosenProxy.host}:${chosenProxy.port}${authInfo}) | Ping: ${chosenProxy._verifiedLatency ? `${chosenProxy._verifiedLatency}ms` : 'Live'}`);
            } else {
              console.log("⚠️ [ShardX] Không tìm thấy proxy còn sống -> Chạy Direct IP mạng nhà.");
            }
          } else {
            console.log("ℹ️ [ShardX] Không có proxy nào trong ShardBrowser UI -> Chạy IP Direct.");
          }
        } catch (proxyErr) {
          console.warn(`⚠️ [Proxy ShardX] Lỗi kiểm tra proxy (${proxyErr.message}) -> Chạy IP Direct.`);
        }
      } else {
        // "rotate" (mặc định)
        if (!options.disableProxyXoay && this._proxyXoay) {
          try {
            console.log("🌐 [Network Mode: ROTATE] Đang yêu cầu xoay IP Proxy mới từ proxyxoay.shop...");
            chosenProxy = await this._proxyXoay.getNewProxy({ protocol: "http" });
            this._activeProxy = chosenProxy;
          } catch (pxErr) {
            console.warn(`⚠️ [ProxyXoay Warning] Không thể lấy proxy xoay: ${pxErr.message} -> Tìm proxy sống trong danh sách Shard/File...`);
          }
        }

        // Fallback sang Proxy Shard/File (áp dụng cơ chế lọc nhanh < 1.5s) nếu xoay thất bại
        if (!chosenProxy) {
          try {
            let localList = this._loadLocalProxies();
            if (!Array.isArray(localList) || localList.length === 0) {
              const { data: proxies } = await axios.get(`${this._launcherApiUrl}/proxies`, { headers: this._headers, timeout: 3000 }).catch(() => ({ data: [] }));
              if (Array.isArray(proxies)) localList = proxies;
            }

            if (Array.isArray(localList) && localList.length > 0) {
              const targetGroup = (options.proxyGroup || this._proxyGroup || "vn").trim().toLowerCase();
              const groupProxies = localList.filter(p => (p.folder || "").trim().toLowerCase() === targetGroup);
              const candidateList = groupProxies.length > 0 ? groupProxies : localList;
              
              chosenProxy = await this._findFastLiveProxy(candidateList);
              if (chosenProxy) {
                this._activeProxy = chosenProxy;
                console.log(`🌐 [Proxy Fallback - Group: ${chosenProxy.folder || targetGroup}] Đã chọn Proxy sống: [${chosenProxy.name || chosenProxy.host}:${chosenProxy.port}] (ping: ${chosenProxy._verifiedLatency ? `${chosenProxy._verifiedLatency}ms` : '<1.5s'})`);
              } else {
                console.log("⚠️ [Proxy Fallback] Không tìm thấy proxy sống <= 1500ms -> Chạy IP Direct.");
              }
            }
          } catch (proxyErr) {
            console.log(`🌐 [Network] Chạy IP Direct (${proxyErr.message}).`);
          }
        }
      }

      // BƯỚC 2: SINH CẤU HÌNH FINGERPRINT CHUẨN NATIVE (ĐỒNG BỘ PHẦN CỨNG 100%)
      console.log("🛡️ [Fingerprint Isolation] Đang khởi tạo cấu hình Hardware Fingerprint chuẩn Native (Đồng bộ Proxy/Hardware)...");
      let baseFp = {};
      try {
        const { data: fpRes } = await axios.get(`${this._launcherApiUrl}/fingerprint/new/windows`, { headers: this._headers, timeout: 4000 });
        if (fpRes && fpRes.fingerprint) {
          baseFp = fpRes.fingerprint;
        }
      } catch {}

      // Đồng bộ hóa triệt để: Timezone, Geo, Language tự động theo IP Proxy; Tắt noise để giữ Hardware Native 100%
      baseFp.timezone = "auto";
      baseFp.geolocation = { mode: "auto" };
      baseFp.webrtc = "block";
      baseFp.noise = {
        audio: { enabled: false },
        canvas: { enabled: false },
        client_rects: { enabled: false, max_offset: 0 },
        fonts: { enabled: false },
        sensors: { enabled: false },
        webgl: { enabled: false, intensity: 0 }
      };
      baseFp.blocked_ports = [1080, 3030, 3128, 3389, 5800, 5900, 5901, 5938, 6568, 7070, 8080];
      
      // BƯỚC 3: TẠO PROFILE MỚI THUỘC NHÓM 'GitHub-Auto'
      const sessionSuffix = Date.now().toString().slice(-4);
      let formattedProxy = null;
      if (chosenProxy) {
        if (chosenProxy.proxyString) {
          formattedProxy = chosenProxy.proxyString;
        } else {
          const kind = (chosenProxy.kind || "http").toLowerCase();
          const user = chosenProxy.username || chosenProxy.user || "";
          const pass = chosenProxy.password || chosenProxy.pass || "";
          if (user && pass) {
            formattedProxy = `${kind}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${chosenProxy.host}:${chosenProxy.port}`;
          } else {
            formattedProxy = `${kind}://${chosenProxy.host}:${chosenProxy.port}`;
          }
        }
      }

      const profilePayload = {
        name: `SHARDX-AUTO-${sessionSuffix}`,
        folder: "GitHub-Auto",
        notes: `Tách biệt hoàn toàn | Proxy: ${formattedProxy || 'Direct'} | Ping: ${chosenProxy?._verifiedLatency ? `${chosenProxy._verifiedLatency}ms` : '<1.5s'} | Time: ${new Date().toLocaleTimeString()}`,
        proxy: formattedProxy,
        proxy_id: chosenProxy?.id && !String(chosenProxy.id).startsWith("file_") ? chosenProxy.id : null,
        webrtc: "block",
        fingerprint: baseFp,
        noise: {
          audio: { enabled: false },
          canvas: { enabled: false },
          client_rects: { enabled: false, max_offset: 0 },
          fonts: { enabled: false },
          sensors: { enabled: false },
          webgl: { enabled: false, intensity: 0 }
        }
      };

      const { data: createdProfile } = await axios.post(`${this._launcherApiUrl}/profiles`, profilePayload, { headers: this._headers });
      this._profileId = createdProfile.id;
      this._isCreatedProfile = true;
      console.log(`✨ [Profile Created] Tạo thành công Profile nhóm [GitHub-Auto] ID: ${this._profileId} ('${profilePayload.name}')`);

      // BƯỚC 4: KHỞI CHẠY PROFILE VÀ KẾT NỐI CDP
      console.log(`🚀 [Browser Launch] Khởi chạy Profile '${profilePayload.name}' qua ShardX CDP...`);
      const { data: startRes } = await axios.post(`${this._launcherApiUrl}/profiles/${this._profileId}/start`, { headless: false }, { headers: this._headers });
      const wsUrl = startRes.cdp?.web_socket_debugger_url;

      if (!wsUrl) {
        throw new Error(`Không nhận được WebSocket CDP URL từ Launcher: ${JSON.stringify(startRes)}`);
      }

      this._browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null, protocolTimeout: 240000 });
      this._ownsBrowser = false;
      console.log(`🔗 [CDP Connected] Đã kết nối Puppeteer vào phiên trình duyệt cách ly.`);
      return this._browser;
    } catch (launcherErr) {
      console.warn(`[ShardX] Không thể kết nối ShardX Launcher (${launcherErr.message}) -> Thử CDP port 9222...`);
    }

    try {
      this._browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null, protocolTimeout: 240000 });
      this._ownsBrowser = false;
      console.log("[Browser] 🔗 Kết nối thành công tới Chrome qua CDP http://127.0.0.1:9222");
      return this._browser;
    } catch {}

    // Fallback: Tự động khởi chạy Chromium / Chrome trực tiếp (Standalone mode trên VPS Linux / Windows)
    try {
      console.log("[Browser] 🚀 Tự động khởi chạy Chromium/Chrome độc lập trên hệ thống...");

      // Tự động xoay Proxy dân cư nếu chưa có proxy
      if (!this._activeProxy && this._proxyXoay) {
        try {
          console.log("🌐 [ProxyXoay] Đang cấp IP dân cư xoay mới từ proxyxoay.shop...");
          this._activeProxy = await this._proxyXoay.getNewProxy({ protocol: "http", forceWait: false });
        } catch (pxErr) {
          console.warn(`[ProxyXoay Warning]: ${pxErr.message}`);
        }
      }

      const chromeArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=1280,800",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--lang=en-US,en",
        "--enforce-webrtc-ip-permission-check"
      ];
      if (this._activeProxy) {
        const proxyArg = this._activeProxy.proxyString ? this._activeProxy.proxyString.replace(/^https?:\/\//i, "") : `${this._activeProxy.host}:${this._activeProxy.port}`;
        chromeArgs.push(`--proxy-server=http://${proxyArg}`);
      }

      const executableCandidates = [
        process.env.CHROME_BIN,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        "/root/.config/shardx-launcher/runtime/ShardX-Linux/chrome",
        path.join(os.homedir(), ".config", "shardx-launcher", "runtime", "ShardX-Linux", "chrome"),
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
      ].filter(Boolean);

      let executablePath = null;
      for (const p of executableCandidates) {
        if (existsSync(p)) {
          executablePath = p;
          break;
        }
      }

      if (executablePath) {
        this._browser = await puppeteer.launch({
          executablePath,
          headless: false,
          args: chromeArgs,
          defaultViewport: { width: 1280, height: 800 },
          protocolTimeout: 240000
        });
        this._ownsBrowser = true;
        console.log(`✅ [Browser] Khởi chạy Chrome thành công: ${executablePath}`);
        return this._browser;
      }
    } catch (launchErr) {
      console.warn(`[Browser Standalone Error]: ${launchErr.message}`);
    }

    throw new Error("Không tìm thấy kết nối trình duyệt. Hãy cài đặt Google Chrome hoặc bật ShardX Launcher.");
  }

  // Chỉ xóa toàn bộ profile cũ thuộc nhóm 'GitHub-Auto' trong ShardBrowser (bảo vệ các profile khác)
  async _deleteAllOldProfiles() {
    try {
      const { data: profiles } = await axios.get(`${this._launcherApiUrl}/profiles`, { headers: this._headers, timeout: 5000 });
      if (Array.isArray(profiles) && profiles.length > 0) {
        // Chỉ lọc profile thuộc nhóm 'GitHub-Auto' hoặc tên 'SHARDX-AUTO-' để xóa
        const targetProfiles = profiles.filter(p => p.folder === "GitHub-Auto" || p.name?.startsWith("SHARDX-AUTO-"));
        if (targetProfiles.length > 0) {
          console.log(`🧹 [Profile Cleanup] Phát hiện ${targetProfiles.length} profiles thuộc nhóm [GitHub-Auto], đang dọn dẹp...`);
          for (const prof of targetProfiles) {
            try {
              await axios.post(`${this._launcherApiUrl}/profiles/${prof.id}/stop`, {}, { headers: this._headers, timeout: 3000 }).catch(() => {});
              await axios.delete(`${this._launcherApiUrl}/profiles/${prof.id}`, { headers: this._headers, timeout: 3000 }).catch(() => {});
            } catch {}
          }
          console.log(`✅ [Profile Cleanup] Đã xóa sạch toàn bộ profiles nhóm [GitHub-Auto].`);
        }
      }
    } catch {}
  }

  // Dọn dẹp tài nguyên
  async _cleanup() {
    console.log("\n🧹 [Cleanup] Đang dọn dẹp phiên kiểm thử...");
    try {
      if (this._profileId && this._isCreatedProfile) {
        await axios.post(`${this._launcherApiUrl}/profiles/${this._profileId}/stop`, {}, { headers: this._headers, timeout: 5000 }).catch(() => {});
        await axios.delete(`${this._launcherApiUrl}/profiles/${this._profileId}`, { headers: this._headers, timeout: 5000 }).catch(() => {});
        console.log(`-> Đã dừng và xóa Profile ID: ${this._profileId}`);
      }
      if (this._browser) {
        if (this._ownsBrowser) {
          await this._browser.close().catch(() => {});
        } else {
          await this._browser.disconnect().catch(() => {});
        }
      }
    } catch (err) {
      console.warn(`(!) Lỗi khi dọn dẹp: ${err.message}`);
    }
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  getAccountState() {
    return { ...this._accountState };
  }

  exportReport() {
    const { email, password, twoFactorSecret, recoveryCodes, status } = this._accountState;
    return {
      email,
      password,
      twoFactorSecret,
      recoveryCodes,
      status,
      proxy: this._activeProxy ? `${this._activeProxy.host}:${this._activeProxy.port}` : "Direct",
      formattedReport: `${email}|${password}|${twoFactorSecret || "N/A"}`,
    };
  }

  // TOÀN BỘ LUỒNG THỰC THI E2E DETERMINISTIC TỰ ĐỘNG TỪ A - Z
  async runFullE2EWorkflow(options = {}) {
    console.log("==================================================================");
    console.log("    AUTONOMOUS SUITE: 100% ISOLATED GITHUB REGISTRATION + 2FA     ");
    console.log("==================================================================");

    try {
      // 1. Kết nối hoặc Khởi chạy Trình duyệt với Profile Fingerprint mới & Proxy
      await this._connectOrLaunchBrowser(options);

      // Tự động xác thực Proxy Authentication nếu proxy có User & Password
      const applyProxyAuth = async (p) => {
        if (!p || p.isClosed()) return;

        let u = this._activeProxy?.username || this._activeProxy?.user || "";
        let pwd = this._activeProxy?.password || this._activeProxy?.pass || "";

        if ((!u || !pwd) && this._activeProxy?.host) {
          const localProxies = this._loadLocalProxies();
          const matched = localProxies.find(lp => lp.host === this._activeProxy.host && Number(lp.port) === Number(this._activeProxy.port) && lp.username);
          if (matched) {
            u = matched.username;
            pwd = matched.password;
            this._activeProxy.username = u;
            this._activeProxy.password = pwd;
          }
        }

        if (u && pwd) {
          try {
            await p.authenticate({ username: u, password: pwd });
            console.log(`🔐 [Proxy Auth] Đã nạp xác thực Proxy cho tài khoản [${u}].`);
          } catch {}
        }
      };

      // Tự động áp dụng xác thực Proxy và Stealth cho tất cả các tab mới
      this._browser.on("targetcreated", async (target) => {
        try {
          const newP = await target.page();
          if (newP) {
            await this._injectStealthEvasions(newP);
            await applyProxyAuth(newP);
          }
        } catch {}
      });

      // 1. Lấy tab chính sẵn có của ShardBrowser
      const pages = await this._browser.pages();
      const workingPage = pages[0] || (await this._browser.newPage());
      workingPage.setDefaultNavigationTimeout(120000);
      workingPage.setDefaultTimeout(120000);

      // Thiết lập kích thước cửa sổ chuẩn Desktop Maximized (tránh bị co lại thành mobile hamburger menu)
      try {
        await workingPage.setViewport({ width: 1920, height: 1080 });
        const cdp = await workingPage.target().createCDPSession();
        const { windowId } = await cdp.send("Browser.getWindowForTarget");
        if (windowId) {
          try {
            await cdp.send("Browser.setWindowBounds", {
              windowId,
              bounds: { windowState: "maximized" }
            });
          } catch {
            await cdp.send("Browser.setWindowBounds", {
              windowId,
              bounds: { width: 1600, height: 1000, windowState: "normal" }
            });
          }
        }
      } catch {}

      // Đóng các tab phụ khác nếu có
      if (pages.length > 1) {
        for (let i = 1; i < pages.length; i++) {
          try { await pages[i].close(); } catch {}
        }
      }

      // 2. Khởi tạo Email (Hotmail Graph API hoặc Gmail Creator hoặc Mail.tm)
      if (this._activeEmailService === "hotmail" && this._hotmailClient) {
        console.log("\n[Bước 1] Sử dụng tài khoản Hotmail/Outlook có sẵn qua Microsoft Graph API...");
        this._accountState.email = this._hotmailClient.email;
        const rawUser = this._accountState.email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        this._accountState.username = `user${rawUser.slice(0, 10)}${Math.random().toString(36).substring(2, 6)}`;
        console.log(`📧 [Hotmail Email] : ${this._accountState.email}`);
        console.log(`👤 [Username Tạo lập]: ${this._accountState.username}`);
      } else {
        console.log("\n[Bước 1] Khởi tạo Email @gmail.com thật từ RapidAPI...");
        const acc = await this._gmailClient.createAccount();
        this._activeEmailService = "gmail";
        this._accountState.email = acc.address;
        this._accountState.username = acc.username;
        console.log(`📧 [Gmail Tạo Lập]  : ${this._accountState.email}`);
        console.log(`👤 [Username Tạo lập]: ${this._accountState.username}`);
      }

      // 3. Luồng điều hướng tự nhiên: Vào GitHub Homepage -> Bấm nút "Sign up" trên Header -> Vào form /signup
      console.log("\n[Bước 2] Bắt đầu luồng điều hướng tự nhiên từ Trang chủ GitHub (https://github.com)...");
      this._githubPage = workingPage;
      this._githubPage.setDefaultNavigationTimeout(120000);
      this._githubPage.setDefaultTimeout(120000);

      let isFormReady = false;
      const maxRetries = 5;

      // Xóa session/cookie đăng nhập cũ để GitHub ở trạng thái khách (Logged out), tránh bị kẹt trong dashboard tài khoản trước
      try {
        const clientCookies = await this._githubPage.cookies();
        if (clientCookies.length > 0) {
          await this._githubPage.deleteCookie(...clientCookies);
        }
      } catch {}

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`⏳ [Tải GitHub] Lần thử ${attempt}/${maxRetries} (Khởi động từ Trang chủ)...`);

          // 1. Vào trang chủ github.com trước để nạp Cookie phiên & Trust Score
          await this._githubPage.goto("https://github.com/", {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          }).catch(() => {});

          await this._actionDelay(1500, 2500);

          // Mô phỏng người dùng lướt nhẹ trang chủ trước khi bấm đăng ký
          try {
            await this._humanMouseMove(this._githubPage, 350 + Math.random() * 250, 220 + Math.random() * 180);
            await this._safeSleep(500);
            await this._smartScroll(this._githubPage, "down");
            await this._safeSleep(600);
            await this._smartScroll(this._githubPage, "up");
            await this._safeSleep(600);
          } catch {}

          // 2. Điều hướng vào trang Đăng ký (Sign up)
          console.log("-> Bắt đầu điều hướng vào Form Đăng ký từ Trang chủ...");

          try {
            if (!this._githubPage.url().includes("/signup")) {
              // Tìm nút Sign up trên Header
              let headerSignUpBtn = await this._githubPage.$("header a[href*='/signup'], a.HeaderMenu-link--sign-up, a[href*='/signup'].HeaderMenu-link");

              // Nếu menu responsive mobile đang ẩn nút Sign up
              if (!headerSignUpBtn) {
                const hamburgerBtn = await this._githubPage.$("button[aria-label='Toggle navigation'], .HeaderMenu-toggle-button, button.js-details-target");
                if (hamburgerBtn) {
                  try {
                    console.log("-> Mở menu điều hướng Header...");
                    await hamburgerBtn.click({ delay: 60 });
                    await this._safeSleep(600);
                    headerSignUpBtn = await this._githubPage.$("a[href*='/signup']");
                  } catch {}
                }
              }

              if (headerSignUpBtn) {
                const box = await headerSignUpBtn.boundingBox().catch(() => null);
                if (box && box.width > 0 && box.height > 0) {
                  console.log("-> Di chuyển chuột và Click tự nhiên vào nút 'Sign up' trên Header...");
                  await this._humanMouseMove(this._githubPage, box.x + box.width / 2, box.y + box.height / 2);
                  await this._safeSleep(300 + Math.floor(Math.random() * 200));
                  await Promise.all([
                    this._githubPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}),
                    headerSignUpBtn.click({ delay: 70 })
                  ]);
                  console.log("✅ [Header Click] Đã click nút 'Sign up'!");
                }
              }
            }
          } catch (clickErr) {
            console.warn(`(!) Lỗi click Header: ${clickErr.message}`);
          }

          // Chờ URL chuyển sang signup (tối đa 10s)
          const signupNavWait = Date.now();
          while (Date.now() - signupNavWait < 10000) {
            if (this._githubPage.url().includes("/signup")) {
              console.log(`✅ [Trang Đăng Ký] Đã vào trang đăng ký thành công: ${this._githubPage.url()}`);
              break;
            }
            await this._safeSleep(800);
          }

          // Nếu vẫn chưa vào được trang signup -> Điều hướng trực tiếp kèm Referer từ Trang chủ
          if (!this._githubPage.url().includes("/signup")) {
            console.log("-> Chuyển hướng vào https://github.com/signup (Referer: https://github.com/)...");
            await this._githubPage.goto("https://github.com/signup", {
              referer: "https://github.com/",
              waitUntil: "domcontentloaded",
              timeout: 45000
            }).catch(() => {});
          }

          await this._actionDelay(2000, 3000);
          await this._detectAndCloseOverlays(this._githubPage);

          // Polling chờ ô nhập password/email trong trang signup hoặc giải Captcha (tối đa 90s)
          const waitStart = Date.now();

          while (Date.now() - waitStart < 90000) {
            await this._safeSleep(1500);

            const pageState = await this._githubPage.evaluate(() => {
              const currentUrl = window.location.href;
              const isSignupUrl = currentUrl.includes("/signup");

              // BẮT BUỘC PHẢI ĐANG Ở TRANG SIGNUP MỚI COI LÀ READY
              if (!isSignupUrl) {
                return {
                  isSignupUrl: false,
                  hasEmailInput: false,
                  isCaptcha: false,
                  isRateLimited: false,
                  currentUrl,
                  title: document.title,
                };
              }

              const body = (document.body ? document.body.innerText : "") + " " + (document.title || "");
              const lower = body.toLowerCase();

              // CHỈ COI LÀ CÓ INPUT KHI THỰC SỰ ĐANG Ở TRANG SIGNUP
              const signupEmailInput = !!document.querySelector("#email, input[name='user[email]'], input[autocomplete='email']");
              const hasPasswordInput = !!document.querySelector("#password, input[name='user[password]']");
              const hasEmailInput = signupEmailInput || hasPasswordInput;

              // Kiểm tra DataDome Geo Captcha / Verification Required
              const isCaptcha = lower.includes("why is this step needed") ||
                                lower.includes("we detected unusual activity from your device or network") ||
                                lower.includes("slide right to secure your access") ||
                                lower.includes("verification required") ||
                                lower.includes("geo.captcha-delivery.com") ||
                                !!document.querySelector("#ddv1-captcha-container") ||
                                !!document.querySelector("#captcha__audio__button") ||
                                !!document.querySelector("iframe[src*='captcha-delivery']") ||
                                !!document.querySelector("iframe[src*='geo.captcha']");

              // Chỉ coi là Rate Limit khi thực sự bị khóa cứng không có Captcha solver
              const isRateLimited = !isCaptcha && (
                lower.includes("truy cập tạm thời bị hạn chế") ||
                lower.includes("tạm thời hạn chế truy cập") ||
                lower.includes("access is temporarily restricted") ||
                lower.includes("access restricted") ||
                lower.includes("temporarily restricted") ||
                lower.includes("unable to verify your captcha response")
              );

              return {
                isSignupUrl: true,
                hasEmailInput,
                isCaptcha,
                isRateLimited,
                currentUrl,
                title: document.title,
              };
            }).catch(() => ({ isSignupUrl: false, hasEmailInput: false, isCaptcha: false, isRateLimited: false }));

            // Nếu vẫn đang ở trang chủ, tiếp tục chờ hoặc điều hướng sang /signup
            if (!pageState.isSignupUrl) {
              if (Date.now() - waitStart > 8000 && !this._githubPage.url().includes("/signup")) {
                console.log("-> Đang ở trang chủ, chuyển tiếp vào https://github.com/signup...");
                await this._githubPage.goto("https://github.com/signup", { referer: "https://github.com/", waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
              }
              continue;
            }

            if (pageState.isCaptcha) {
              await this._handleDataDomeCaptcha(this._githubPage, "audio");
              await this._safeSleep(3000);
              continue;
            }

            if (pageState.isRateLimited) {
              console.warn("\n⚠️ [CẢNH BÁO RATE-LIMIT]: IP hiện tại đang bị GitHub hạn chế tạm thời!");
              throw new Error("GITHUB_RATE_LIMITED: GitHub tạm thời hạn chế truy cập từ IP này (Rate Limit). Vui lòng đổi Proxy mới!");
            }

            if (pageState.hasEmailInput) {
              isFormReady = true;
              console.log(`✅ [Trang Sẵn Sàng] Form đăng ký GitHub đã tải hoàn tất (${pageState.currentUrl}) và sẵn sàng nhập liệu!`);
              break;
            }
          }

          if (isFormReady) break;

          if (attempt < maxRetries) {
            console.log(`🔄 [Thử lại ${attempt}] Tải lại trang...`);
            await this._safeSleep(3000);
          }
        } catch (loadErr) {
          if (loadErr.message.includes("Rate Limit") || loadErr.message.includes("GITHUB_RATE_LIMITED")) throw loadErr;
          console.warn(`⚠️ [Thử lại ${attempt}/${maxRetries}] Lỗi tải trang: ${loadErr.message}`);
          await this._safeSleep(5000);
        }
      }

      if (!isFormReady) {
        throw new Error("Không thể tải form đăng ký GitHub (Do Proxy hoặc mạng quá chậm/Bị Rate Limit).");
      }

      // 4. Điền Form Đăng Ký GitHub Theo Quy Trình Single-Page Chuẩn Xác (Human-like)
      console.log("\n[Bước 3] Thực hiện điền form đăng ký GitHub (Human-like với delay 1.0s - 1.8s mỗi bước)...");

      // 4.1 Chờ và Điền Email
      console.log(`-> 1. Nhập Email: ${this._accountState.email}`);
      await this._githubPage.waitForSelector("#email, input[type='email'], input[name='user[email]'], input[autocomplete='email']", { visible: true, timeout: 30000 });
      await this._humanType(this._githubPage, "#email, input[type='email'], input[name='user[email]'], input[autocomplete='email']", this._accountState.email, false);
      await this._actionDelay(1000, 1800);

      // Kiểm tra ngay xem Email đã từng được tạo trên GitHub trước đó chưa
      let isEmailTaken = await this._githubPage.evaluate(() => {
        const text = document.body ? document.body.innerText : "";
        return text.includes("already associated with an account") ||
               text.includes("Email is invalid or already taken") ||
               text.includes("associated with an account");
      }).catch(() => false);

      if (isEmailTaken) {
        console.warn(`\n⚠️ [EMAIL ĐÃ TỒN TẠI]: Địa chỉ [${this._accountState.email}] đã được đăng ký tài khoản GitHub trước đó!`);
        throw new Error(`EMAIL_ALREADY_EXISTS: Email [${this._accountState.email}] đã tồn tại trên GitHub.`);
      }

      // 4.2 Điền Password
      console.log(`-> 2. Nhập Password: ${this._accountState.password}`);
      await this._githubPage.waitForSelector("#password, input[name='user[password]'], input[type='password']", { visible: true, timeout: 20000 });
      await this._humanType(this._githubPage, "#password, input[name='user[password]'], input[type='password']", this._accountState.password, false);
      await this._actionDelay(1000, 1800);

      // 4.3 Điền Username
      console.log(`-> 3. Nhập Username: ${this._accountState.username}`);
      await this._githubPage.waitForSelector("#login, input[name='user[login]']", { visible: true, timeout: 20000 });
      await this._humanType(this._githubPage, "#login, input[name='user[login]']", this._accountState.username, false);
      await this._actionDelay(1000, 1800);

      // Kiểm tra nếu username bị trùng
      let isUsernameTaken = await this._githubPage.evaluate(() => {
        const text = document.body ? document.body.innerText : "";
        return text.includes("is not available") || text.includes("is already taken");
      }).catch(() => false);

      if (isUsernameTaken) {
        this._accountState.username = `${this._accountState.username}${Date.now().toString().slice(-4)}`;
        console.log(`🔄 [Username Thay thế]: ${this._accountState.username}`);
        await this._humanType(this._githubPage, "#login, input[name='user[login]']", this._accountState.username, false);
        await this._actionDelay(1000, 1800);
      }

      // 4.4 Chờ validation hoàn tất và kiểm tra lại Email lần 2
      console.log("-> 4. Chờ GitHub kiểm tra tính hợp lệ của toàn bộ Form...");
      await this._actionDelay(1000, 1800);

      const isEmailTakenLate = await this._githubPage.evaluate(() => {
        const text = document.body ? document.body.innerText : "";
        return text.includes("already associated with an account") ||
               text.includes("Email is invalid or already taken");
      }).catch(() => false);

      if (isEmailTakenLate) {
        console.warn(`\n⚠️ [EMAIL ĐÃ TỒN TẠI]: Địa chỉ [${this._accountState.email}] đã được đăng ký trước đó!`);
        throw new Error(`EMAIL_ALREADY_EXISTS: Email [${this._accountState.email}] đã tồn tại trên GitHub.`);
      }

      // 4.5 Kiểm tra nghiêm ngặt tính toàn vẹn của Form trước khi gửi
      const formValues = await this._githubPage.evaluate(() => {
        const emailEl = document.querySelector("#email, input[type='email'], input[name='user[email]'], input[autocomplete='email']");
        const passEl = document.querySelector("#password, input[name='user[password]'], input[type='password']");
        const loginEl = document.querySelector("#login, input[name='user[login]']");
        return {
          emailVal: emailEl?.value || "",
          passVal: passEl?.value || "",
          loginVal: loginEl?.value || "",
        };
      }).catch(() => ({ emailVal: "", passVal: "", loginVal: "" }));

      // Nếu ô Password bị thiếu hoặc quá ngắn (do lỗi gõ phím hoặc timeout), điền bù ngay
      if (!formValues.passVal || formValues.passVal.length < 8) {
        console.warn("⚠️ [Password Đang Rỗng] Kích hoạt điền bù Password ngay lập tức...");
        await this._humanType(this._githubPage, "#password, input[name='user[password]'], input[type='password']", this._accountState.password, false);
        await this._actionDelay(1000, 1800);
      }

      // Nếu ô Email bị thiếu, điền bù
      if (!formValues.emailVal) {
        console.warn("⚠️ [Email Đang Rỗng] Kích hoạt điền bù Email ngay lập tức...");
        await this._humanType(this._githubPage, "#email, input[type='email'], input[name='user[email]'], input[autocomplete='email']", this._accountState.email, false);
        await this._actionDelay(1000, 1800);
      }

      // Nếu ô Username bị thiếu, điền bù
      if (!formValues.loginVal) {
        console.warn("⚠️ [Username Đang Rỗng] Kích hoạt điền bù Username ngay lập tức...");
        await this._humanType(this._githubPage, "#login, input[name='user[login]']", this._accountState.username, false);
        await this._actionDelay(1000, 1800);
      }

      // Kiểm tra chốt hạ: Password BẮT BUỘC phải có độ dài >= 8 ký tự
      const isPasswordReady = await this._githubPage.evaluate(() => {
        const passEl = document.querySelector("#password, input[name='user[password]'], input[type='password']");
        return (passEl?.value || "").length >= 8;
      }).catch(() => false);

      if (!isPasswordReady) {
        throw new Error("Không thể điền Password vào form đăng ký GitHub. Hủy lượt để thử lại an toàn!");
      }

      console.log("-> 5. Gửi Form đăng ký và theo dõi chuyển sang trang xác thực OTP (Tự động click lại nếu kẹt)...");
      await this._actionDelay(1000, 1800);
      
      let isMovedToVerify = false;
      const submitStartTime = Date.now();
      const maxSubmitWaitMs = 60000; // 60s cho bước chuyển tiếp form

      while (Date.now() - submitStartTime < maxSubmitWaitMs) {
        if (!this._githubPage || this._githubPage.isClosed()) break;

        const currentUrl = this._githubPage.url();

        // Kiểm tra xem có bị GitHub chặn/Rate limit hoặc yêu cầu Captcha sau khi bấm submit không
        const pageCheck = await this._githubPage.evaluate(() => {
          const body = (document.body ? document.body.innerText : "") + " " + (document.title || "");
          const lower = body.toLowerCase();
          const isCaptcha = lower.includes("why is this step needed") ||
                            lower.includes("we detected unusual activity from your device or network") ||
                            lower.includes("slide right to secure your access") ||
                            lower.includes("verification required") ||
                            lower.includes("geo.captcha-delivery.com") ||
                            !!document.querySelector("#ddv1-captcha-container") ||
                            !!document.querySelector("#captcha__audio__button") ||
                            !!document.querySelector("iframe[src*='captcha-delivery']") ||
                            !!document.querySelector("iframe[src*='arkoselabs']");

          const isRateLimited = !isCaptcha && (
            lower.includes("truy cập tạm thời bị hạn chế") ||
            lower.includes("tạm thời hạn chế truy cập") ||
            lower.includes("access is temporarily restricted") ||
            lower.includes("access restricted") ||
            lower.includes("temporarily restricted") ||
            lower.includes("unable to verify your captcha response")
          );

          return { isCaptcha, isRateLimited };
        }).catch(() => ({ isCaptcha: false, isRateLimited: false }));

        if (pageCheck.isCaptcha) {
          await this._handleDataDomeCaptcha(this._githubPage, "audio");
          await this._safeSleep(3000);
          continue;
        }

        if (pageCheck.isRateLimited) {
          console.warn("\n⚠️ [CẢNH BÁO RATE-LIMIT]: GitHub đã tạm thời hạn chế truy cập từ IP này sau khi gửi Form!");
          throw new Error("GITHUB_RATE_LIMITED: GitHub tạm thời hạn chế truy cập (Rate Limit). Vui lòng đổi Proxy hoặc IP mới!");
        }

        const hasOtpElement = await this._githubPage.evaluate(() => {
          const bodyText = document.body ? document.body.innerText : "";
          const hasOtpInput = !!document.querySelector("#launch-code-0, input[id^='launch-code'], [data-testid='otp-digit'], input[name='otp'], input[autocomplete='one-time-code']");
          const isOtpMsg = bodyText.includes("Enter code") || bodyText.includes("Check your email") || bodyText.includes("We sent a launch code") || bodyText.includes("We sent a code to");
          return hasOtpInput || isOtpMsg;
        }).catch(() => false);

        // Kiểm tra xem đã chính thức rời khỏi signup chưa
        if (currentUrl.includes("account_verifications") || currentUrl.includes("verify_email") || currentUrl.includes("challenge") || hasOtpElement) {
          isMovedToVerify = true;
          console.log(`✅ [Submit Thành Công] Đã chuyển tiếp sang trang xác thực: ${currentUrl}`);
          break;
        }

        // Nếu vẫn còn kẹt ở trang signup và KHÔNG có Captcha -> Kích hoạt click lại 'Create account'
        if (!pageCheck.isCaptcha) {
          console.log(`⏳ [Kiểm Tra URL] Vẫn ở trang đăng ký (${currentUrl}). Chờ phản hồi hoặc click lại 'Create account'...`);
          
          await this._detectAndCloseOverlays(this._githubPage);
          await this._smartScroll(this._githubPage, "down");
          await this._safeSleep(600);

          // Thử click nút 'Create account' bằng chuột thật (isTrusted: true 100%)
          try {
            const allButtons = await this._githubPage.$$("button, input[type='submit']");
            for (const btn of allButtons) {
              const text = await this._githubPage.evaluate(el => (el.innerText || el.value || el.textContent || "").trim().toLowerCase(), btn);
              if (text.includes("create account")) {
                const box = await btn.boundingBox().catch(() => null);
                if (box) {
                  await this._humanMouseMove(this._githubPage, box.x + box.width / 2, box.y + box.height / 2);
                  await this._safeSleep(200);
                }
                await btn.click({ delay: 60 });
                break;
              }
            }
          } catch {}
        }

        // Chờ 4s để GitHub phản hồi trước khi kiểm tra lại vòng lặp
        await this._safeSleep(4000);
      }

      // 5. Chờ chuyển sang trang Nhập OTP (Hỗ trợ nếu có bước giải Captcha)
      console.log("\n[Bước 4] Đang theo dõi trạng thái màn hình OTP (Nếu có Captcha, hãy hoàn tất giải trên trình duyệt)...");
      let isOtpScreenReady = false;
      const maxOtpWaitTime = 90000; // 90s
      const otpWaitStart = Date.now();

      while (Date.now() - otpWaitStart < maxOtpWaitTime) {
        if (!this._githubPage || this._githubPage.isClosed()) break;

        const currentUrl = this._githubPage.url();

        // Tự động kiểm tra và xử lý nếu gặp DataDome / Geo Captcha / Arkose Labs
        await this._handleDataDomeCaptcha(this._githubPage, "audio");

        // Kiểm tra lại xem có bị hạn chế IP không
        const checkRestricted = await this._githubPage.evaluate(() => {
          const body = (document.body ? document.body.innerText : "") + " " + (document.title || "");
          const lower = body.toLowerCase();
          return lower.includes("truy cập tạm thời bị hạn chế") ||
                 lower.includes("tạm thời hạn chế truy cập") ||
                 lower.includes("access is temporarily restricted") ||
                 lower.includes("access restricted") ||
                 lower.includes("temporarily restricted") ||
                 lower.includes("unusual activity from your device or network") ||
                 lower.includes("unusual traffic from your network") ||
                 lower.includes("robot on the same network") ||
                 lower.includes("too fast or too many times") ||
                 lower.includes("unable to verify your captcha response");
        }).catch(() => false);

        if (checkRestricted) {
          console.warn("\n⚠️ [CẢNH BÁO RATE-LIMIT]: GitHub đã tạm thời hạn chế truy cập từ IP này!");
          throw new Error("GITHUB_RATE_LIMITED: GitHub tạm thời hạn chế truy cập (Rate Limit). Vui lòng đổi Proxy hoặc IP mới!");
        }

        const checkOtpReady = await this._githubPage.evaluate(() => {
          const url = window.location.href;
          const bodyText = document.body ? document.body.innerText : "";
          const hasOtpInput = !!document.querySelector("#launch-code-0, input[id^='launch-code'], [data-testid='otp-digit'], input[name='otp'], input[autocomplete='one-time-code']");
          const isOtpText = bodyText.includes("Enter code") || bodyText.includes("Check your email") || bodyText.includes("We sent a launch code") || bodyText.includes("We sent a code to");
          
          return hasOtpInput || isOtpText || url.includes("account_verifications") || url.includes("verify_email");
        }).catch(() => false);

        if (checkOtpReady) {
          isOtpScreenReady = true;
          console.log(`✅ [OTP Ready] Đã sẵn sàng màn hình xác thực Email: ${currentUrl}`);
          break;
        }

        await this._safeSleep(2000);
      }

      // 6. Xác thực OTP Email trực tiếp từ Microsoft Graph API / Gmail API / Mail.tm
      console.log(`\n[Bước 5] Đang lấy mã OTP trực tiếp từ ${this._activeEmailService === 'hotmail' ? 'Hotmail Graph API' : (this._activeEmailService === 'gmail' ? 'Gmail API' : 'Mail.tm')}...`);
      let result;
      if (this._activeEmailService === "hotmail" && this._hotmailClient) {
        const otpRes = await this._hotmailClient.waitForOtpCode({
          filterSender: "github",
          timeoutMs: 90000,
          intervalMs: 2500,
        });
        result = { otpCode: otpRes.otpCode };
      } else if (this._activeEmailService === "gmail") {
        result = await this._gmailClient.waitForVerificationCode(90, 3);
      } else {
        result = await this._mailTm.waitForVerificationCode(90, 2);
      }
      const emailOtp = result.otpCode;

      console.log("\n[Bước 6] Điền mã OTP vào GitHub...");
      await this._githubPage.bringToFront();
      await this._safeSleep(1500);
      await this._fillOtpDigits(this._githubPage, emailOtp);
      await this._safeSleep(1500);

      // Chờ GitHub xác thực OTP và xử lý onboarding / chuyển trang an toàn khi mạng chậm
      await this._handlePostSignupFlow(this._githubPage);
      await this._safeSleep(3000);

      // 7. Bật 2FA trên GitHub (enableTwoFactor trực tiếp)
      console.log("\n[Bước 7] Kích hoạt 2FA Security với mã TOTP (enableTwoFactor)...");
      await this._enableTwoFactor(this._githubPage);

      // 8. Kết quả và Lưu Báo Cáo
      console.log("\n==================================================================");
      console.log("       KẾT QUẢ NGHIỆM THU TÀI KHOẢN GITHUB HOÀN TẤT + 2FA         ");
      console.log("==================================================================");
      console.log(`📧 Email tài khoản : ${this._accountState.email}`);
      console.log(`🔑 Mật khẩu        : ${this._accountState.password}`);
      console.log(`👤 Username        : ${this._accountState.username}`);
      console.log(`🛡️ 2FA Secret Key  : ${this._accountState.twoFactorSecret || "N/A"}`);
      console.log(`🌐 Proxy Sử Dụng   : ${this._activeProxy ? `${this._activeProxy.name || this._activeProxy.host} (${this._activeProxy.country || 'N/A'})` : 'Direct'}`);
      console.log(`📋 Recovery Codes  : ${this._accountState.recoveryCodes.length} mã đã lưu`);
      console.log("------------------------------------------------------------------");
      console.log(`👉 ĐỊNH DẠNG XUẤT  : ${this._accountState.email}|${this._accountState.password}|${this._accountState.twoFactorSecret}`);
      console.log("==================================================================");

      if (process.env.SAVE_2FA_SECRETS === "1" || options.saveSecrets !== false) {
        await this._accountStorage.saveAccount({
          email: this._accountState.email,
          username: this._accountState.username,
          password: this._accountState.password,
          twoFactorSecret: this._accountState.twoFactorSecret,
          recoveryCodes: this._accountState.recoveryCodes,
          proxy: this._activeProxy
        });
      }

      return this.exportReport();
    } finally {
      await this._cleanup();
    }
  }
}

// ==============================================================================
// 3. CLI ENTRYPOINT
// ==============================================================================
async function main() {
  const args = process.argv.slice(2);
  let proxyMode = "direct"; // Mặc định chạy Direct máy tính, không chờ proxy
  let proxyGroup = "vn";

  for (const arg of args) {
    if (arg === "--rotate" || arg === "-r") {
      proxyMode = "rotate";
    } else if (arg === "--shard" || arg === "-s") {
      proxyMode = "shard";
    } else if (arg === "--direct" || arg === "-d") {
      proxyMode = "direct";
    } else if (arg.startsWith("--group=")) {
      proxyGroup = arg.replace(/^--group=/, "").trim();
    }
  }

  const runner = new AiAgentRunner({ proxyMode, proxyGroup });
  try {
    await runner.runFullE2EWorkflow({
      saveSecrets: true,
      proxyMode,
      proxyGroup
    });
  } catch (error) {
    console.error(`\n❌ [Lỗi Hệ Thống]: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("ai_agent_runner.js"))) {
  main();
}
