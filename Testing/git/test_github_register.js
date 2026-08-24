/**
 * AI VISION AUTONOMOUS GITHUB REGISTRATION SCRIPT
 * ===================================================================
 * Tự động tạo Profile ShardBrowser riêng biệt -> Mở ShardBrowser với CDP
 * -> AI Vision (stealth/ox-alpha-free) trực tiếp quan sát màn hình từng bước,
 * suy luận logic và quyết định thao tác điền form / vượt bước chính xác 100%.
 *
 * Chạy bằng lệnh: node Testing/git/test_github_register.js
 */

import axios from "axios";
import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";

// ==============================================================================
// 1. CẤU HÌNH AI, PROXY & CLI OPTIONS
// ==============================================================================
function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {
    apiKey: process.env.AI_API_KEY || process.env.XKIRO_API_KEY || "sk-xt-dfa9623373697bc9c6d720f7b974e459b54189998b56de42",
    baseUrl: process.env.AI_BASE_URL || "https://api.xkiro.com/v1",
    model: process.env.AI_MODEL || "mistralai/mistral-large-2512",
    profileId: "",
    cdpPort: null,
    wsEndpoint: "",
    proxy: "",
    proxyId: "",
    noProxy: false,
    prompt: "Tự động quan sát màn hình GitHub, điền thông tin đăng ký Email, Mật khẩu, Tên người dùng và vượt qua các bước kiểm tra.",
  };

  for (const arg of args) {
    if (arg.startsWith("--api-key=")) options.apiKey = arg.slice(10);
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice(11);
    else if (arg.startsWith("--model=")) options.model = arg.slice(8);
    else if (arg.startsWith("--profile-id=")) options.profileId = arg.slice(13);
    else if (arg.startsWith("--cdp-port=")) options.cdpPort = parseInt(arg.slice(11), 10);
    else if (arg.startsWith("--ws=")) options.wsEndpoint = arg.slice(5);
    else if (arg.startsWith("--proxy=")) options.proxy = arg.slice(8);
    else if (arg.startsWith("--proxy-id=")) options.proxyId = arg.slice(11);
    else if (arg === "--no-proxy") options.noProxy = true;
    else if (arg.startsWith("--prompt=")) options.prompt = arg.slice(9);
  }

  return options;
}

const cliOpts = parseCliArgs();

export const AI_CONFIG = {
  baseUrl: cliOpts.baseUrl,
  apiKey: cliOpts.apiKey,
  model: cliOpts.model,
  prompt: cliOpts.prompt,
};

// Hàm sinh dữ liệu đăng ký ngẫu nhiên
function generateRegistrationData() {
  const timestamp = Date.now().toString().slice(-6);
  const randomStr = Math.random().toString(36).substring(2, 6);
  return {
    email: `dev_shardx_${timestamp}_${randomStr}@gmail.com`,
    password: `ShardX@2026!Pass#${timestamp}`,
    username: `shard-dev-${timestamp}-${randomStr}`,
  };
}

// ==============================================================================
// 2. PROXY & SHARDBROWSER PROFILE LAUNCHER
// ==============================================================================

// Lấy danh sách Proxy đã lưu trong ShardX Launcher
function getStoredProxies() {
  const configDir = process.env.APPDATA || (process.platform === "darwin" ? path.join(process.env.HOME || "", "Library/Application Support") : path.join(process.env.HOME || "", ".config"));
  const proxiesPath = path.join(configDir, "shardx-launcher", "proxies.json");
  if (fs.existsSync(proxiesPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(proxiesPath, "utf8"));
      if (Array.isArray(data.proxies) && data.proxies.length > 0) {
        return data.proxies;
      }
    } catch {}
  }
  return [];
}

// Chọn Proxy phù hợp (từ CLI hoặc tự động lấy 1 proxy trong ShardX)
function resolveProxyForProfile() {
  if (cliOpts.noProxy) return null;

  const storedProxies = getStoredProxies();

  // 1. Chỉ định qua ID
  if (cliOpts.proxyId) {
    const found = storedProxies.find((p) => p.id === cliOpts.proxyId);
    if (found) return found;
  }

  // 2. Chỉ định qua chuỗi host:port hoặc http://...
  if (cliOpts.proxy) {
    let raw = cliOpts.proxy.trim();
    let kind = "http";
    if (raw.startsWith("socks5://")) { kind = "socks5"; raw = raw.slice(9); }
    else if (raw.startsWith("http://")) { kind = "http"; raw = raw.slice(7); }
    else if (raw.startsWith("https://")) { kind = "https"; raw = raw.slice(8); }

    let username = "";
    let password = "";
    if (raw.includes("@")) {
      const [auth, hp] = raw.split("@");
      const [u, p] = auth.split(":");
      username = u || "";
      password = p || "";
      raw = hp;
    }
    const [host, portStr] = raw.split(":");
    return {
      id: "cli-custom-proxy",
      name: cliOpts.proxy,
      kind,
      host,
      port: parseInt(portStr || "80", 10),
      username,
      password,
      country: "",
    };
  }

  // 3. Tự động lấy 1 proxy có sẵn trong ShardX Launcher
  if (storedProxies.length > 0) {
    // Chọn ngẫu nhiên hoặc proxy đầu tiên
    return storedProxies[Math.floor(Math.random() * storedProxies.length)];
  }

  return null;
}

function findBrowserExecutable() {
  const configDir = process.env.APPDATA || (process.platform === "darwin" ? path.join(process.env.HOME || "", "Library/Application Support") : path.join(process.env.HOME || "", ".config"));

  const possiblePaths = [
    // 1. Ưu tiên hàng đầu: Lõi Anti-detect của ShardBrowser
    path.join(configDir, "shardx-launcher", "runtime", "ShardX-Windows", "chrome.exe"),
    path.join(configDir, "shardx-launcher", "runtime", "ShardX-Mac-arm64", "ShardX.app", "Contents", "MacOS", "ShardX"),
    path.join(configDir, "shardx-launcher", "runtime", "ShardX-Linux", "chrome"),
    "C:\\Program Files\\ShardX\\ShardX.exe",
    // 2. Fallback sang Chrome/Edge hệ thống
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(process.env.LOCALAPPDATA || "", "Microsoft\\Edge\\Application\\msedge.exe"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Tạo Profile Fingerprint độc lập + Gán 1 Proxy và lưu vào ShardBrowser
function createShardProfileOnDisk(profileId, profileName = `GitHub-AI-${Date.now().toString().slice(-4)}`) {
  const configDir = process.env.APPDATA || (process.platform === "darwin" ? path.join(process.env.HOME || "", "Library/Application Support") : path.join(process.env.HOME || "", ".config"));
  const fpDir = path.join(configDir, "shardx-launcher", "fingerprints");
  const profilesDir = path.join(configDir, "shardx-launcher", "profiles");
  const uddDir = path.join(configDir, "shardx-launcher", "user-data", profileId);

  fs.mkdirSync(profilesDir, { recursive: true });
  fs.mkdirSync(uddDir, { recursive: true });

  const boundProxy = resolveProxyForProfile();

  let baseFp = {
    name: profileName,
    notes: `Profile AI tự động tạo | Prompt: ${cliOpts.prompt.slice(0, 50)}`,
    navigator: {
      user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      platform: "Win32",
      platform_version: "15.0.0",
      hardware_concurrency: 8,
      device_memory: 8,
    },
  };

  try {
    if (fs.existsSync(fpDir)) {
      const files = fs.readdirSync(fpDir).filter((f) => f.endsWith(".json"));
      if (files.length > 0) {
        const randFile = files[Math.floor(Math.random() * files.length)];
        const content = JSON.parse(fs.readFileSync(path.join(fpDir, randFile), "utf8"));
        baseFp = { ...baseFp, ...content };
      }
    }
  } catch {}

  const randSeed = Math.floor(Math.random() * 1000000);
  baseFp.name = profileName;
  baseFp.noise = {
    canvas: { enabled: true, seed: randSeed },
    webgl: { enabled: true, seed: randSeed + 1, intensity: 1 },
    audio: { enabled: true, seed: randSeed + 2 },
    client_rects: { enabled: true, seed: randSeed + 3, max_offset: 1 },
    sensors: { enabled: false, seed: 0 },
    fonts: { enabled: true, seed: randSeed + 4 },
  };

  const fullProfile = {
    _meta: {
      id: profileId,
      proxy_id: boundProxy ? boundProxy.id : null,
      folder: "",
      created_at: new Date().toISOString(),
      pinned: false,
    },
    ...baseFp,
  };

  fs.writeFileSync(path.join(profilesDir, `${profileId}.json`), JSON.stringify(fullProfile, null, 2), "utf8");

  const runtimeFp = { ...baseFp };
  delete runtimeFp._meta;
  const fpPath = path.join(uddDir, "fingerprint.json");
  fs.writeFileSync(fpPath, JSON.stringify(runtimeFp, null, 2), "utf8");

  return { profileId, profileName, uddDir, fpPath, proxy: boundProxy };
}

// Khởi chạy ShardBrowser kèm CDP WebSocket & Proxy
async function launchShardBrowserProfile(execPath, profileInfo, cdpPort = 9222) {
  const browserArgs = [
    `--fingerprint-profile=${profileInfo.fpPath}`,
    `--user-data-dir=${profileInfo.uddDir}`,
    `--remote-debugging-port=${cdpPort}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-sandbox",
    "--test-type",
    "--start-maximized",
  ];

  if (profileInfo.proxy) {
    const p = profileInfo.proxy;
    let proxyArg = "";
    const scheme = p.kind || "http";
    const hostPort = `${p.host}:${p.port}`;
    if (p.username && p.password) {
      proxyArg = `${scheme}://${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@${hostPort}`;
    } else {
      proxyArg = `${scheme}://${hostPort}`;
    }
    browserArgs.push(`--proxy-server=${proxyArg}`);
    console.log(`    🌐 Đã kích hoạt Proxy: [${p.name || hostPort}] (${p.country || "VN"}) -> ${proxyArg}`);
  } else {
    console.log(`    ⚠️ Chạy ở chế độ Direct IP (Không gán Proxy)`);
  }

  console.log(`    -> Khởi động ShardBrowser với Profile '${profileInfo.profileName}' (CDP Port: ${cdpPort})...`);
  const child = spawn(execPath, browserArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  console.log(`    -> Đang đợi CDP cổng ${cdpPort} sẵn sàng...`);
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await axios.get(`http://127.0.0.1:${cdpPort}/json/version`, { timeout: 1500, proxy: false });
      if (res.data && res.data.webSocketDebuggerUrl) {
        wsUrl = res.data.webSocketDebuggerUrl;
        break;
      }
    } catch {}
  }

  if (!wsUrl) {
    throw new Error(`Không thể kết nối cổng CDP ${cdpPort} sau khi khởi động ShardBrowser.`);
  }

  console.log(`    -> Đã kết nối CDP WebSocket thành công: ${wsUrl}`);
  return await puppeteer.connect({
    browserWSEndpoint: wsUrl,
    defaultViewport: null,
  });
}

// ==============================================================================
// 3. AI VISION REASONING & DECISION ENGINE
// ==============================================================================
function parseAiJson(text) {
  if (typeof text !== "string") return text;
  let cleaned = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch {}
  }

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)); } catch {}
  }

  const origFirst = text.indexOf("{");
  const origLast = text.lastIndexOf("}");
  if (origFirst !== -1 && origLast !== -1 && origLast > origFirst) {
    try { return JSON.parse(text.slice(origFirst, origLast + 1)); } catch {}
  }

  throw new Error(`Không thể trích xuất JSON từ phản hồi: ${cleaned.slice(0, 150)}`);
}

// Quét các phần tử tương tác trên trang
async function scanPageElements(page) {
  try {
    return await page.evaluate(() => {
      const nodes = document.querySelectorAll("input, button, a, [role='button'], .Button, summary");
      const list = [];
      nodes.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 60);
          const type = el.getAttribute("type") || el.tagName.toLowerCase();
          const id = el.id ? `#${el.id}` : "";
          const name = el.name ? `[name='${el.name}']` : "";
          const dataContinue = el.getAttribute("data-continue-to") ? `[data-continue-to='${el.getAttribute("data-continue-to")}']` : "";
          list.push({
            tag: el.tagName.toLowerCase(),
            type,
            selector: id || dataContinue || name || el.className.split(" ")[0] || el.tagName.toLowerCase(),
            text,
            disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
          });
        }
      });
      return list.slice(0, 35);
    });
  } catch {
    return [];
  }
}

// Hỏi AI Vision quan sát màn hình và đưa ra hành động tối ưu
async function askVisualDecision(screenshotBase64, currentUrl, elements, registrationData, history) {
  const systemPrompt = `Bạn là một AI Browser Visual Agent chuyên nghiệp điều khiển trình duyệt theo yêu cầu.

CHỈ ĐẠO CHÍNH / PROMPT:
"${AI_CONFIG.prompt || "Tự động quan sát màn hình GitHub, điền thông tin đăng ký Email, Mật khẩu, Tên người dùng và vượt qua các bước kiểm tra."}"

THÔNG TIN TÀI KHOẢN CẦN ĐIỀN:
- Email    : "${registrationData.email}"
- Password : "${registrationData.password}"
- Username : "${registrationData.username}"

NHIỆM VỤ:
1. Quan sát ảnh chụp màn hình hiện tại để nhận diện trạng thái form đăng ký GitHub:
   - Nếu đang ở ô nhập Email -> Nhập Email, sau đó bấm nút Continue (hoặc ấn Enter).
   - Nếu đang ở ô nhập Password -> Nhập Password, sau đó bấm Continue (hoặc ấn Enter).
   - Nếu đang ở ô nhập Username -> Nhập Username, sau đó bấm Continue. (Nếu màn hình báo lỗi 'Username is not available', hãy đổi sang text username ngẫu nhiên mới).
   - Nếu xuất hiện câu hỏi nhận thông báo 'Email preferences (y/n)' -> Nhập 'n' hoặc 'y' rồi bấm Continue.
   - Nếu xuất hiện Captcha / Puzzle -> Báo trong thought và bấm nút 'Verify' hoặc đợi giải.
   - Nếu chuyển sang màn hình 'Check your email' / 'Enter code' -> Báo action='finish'.
2. Trả về định dạng JSON DUY NHẤT:
{
  "thought": "Mô tả ngắn gọn những gì bạn quan sát thấy trên ảnh và lý do hành động",
  "action": "type" | "click" | "press" | "wait" | "finish",
  "selector": "CSS Selector hoặc Text của phần tử cần thao tác (VD: 'input#email', 'button[data-continue-to=password-container]', 'Continue')",
  "text": "Nội dung cần nhập (nếu action='type')",
  "key": "Phím cần ấn (VD: 'Enter')",
  "waitMs": 1500
}`;

  const userContent = [
    {
      type: "text",
      text: `URL hiện tại: ${currentUrl}
Lịch sử các bước đã thực hiện:
${history.length === 0 ? "(Bắt đầu quy trình)" : history.map((h, i) => `${i + 1}. [${h.action}] ${h.thought || ""}`).join("\n")}

Danh sách phần tử phát hiện trên trang:
${JSON.stringify(elements, null, 2)}

Hãy quan sát ảnh màn hình và trả về JSON hành động tiếp theo:`
    }
  ];

  if (screenshotBase64) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${screenshotBase64}`
      }
    });
  }

  const endpoint = AI_CONFIG.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  let res;
  try {
    res = await axios.post(
      endpoint,
      {
        model: AI_CONFIG.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        max_tokens: 1500,
        temperature: 0.1
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${AI_CONFIG.apiKey}`
        },
        timeout: 45000
      }
    );
  } catch (err) {
    console.log(`    (!) API chính (${AI_CONFIG.baseUrl}) gặp lỗi: ${err.response?.data?.error?.message || err.message}`);
    console.log("    -> Tự động chuyển sang Endpoint dự phòng (Xkiro qwen/qwen3.8-max)...");
    res = await axios.post(
      "https://api.xkiro.com/v1/chat/completions",
      {
        model: "qwen/qwen3.8-max",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        max_tokens: 1500,
        temperature: 0.1
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer sk-xt-dfa9623373697bc9c6d720f7b974e459b54189998b56de42"
        },
        timeout: 45000
      }
    );
  }

  const rawText = res.data?.choices?.[0]?.message?.content || "";
  if (rawText.includes("Sorry, to prevent abuse") || rawText.includes("accounts that have not been recharged")) {
    console.log("    (!) AIHubMix báo hết 10 lượt dùng thử -> Tự động chuyển sang Endpoint dự phòng (Xkiro)...");
    const fallbackRes = await axios.post(
      "https://api.xkiro.com/v1/chat/completions",
      {
        model: "qwen/qwen3.8-max",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        max_tokens: 1500,
        temperature: 0.1
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer sk-xt-dfa9623373697bc9c6d720f7b974e459b54189998b56de42"
        },
        timeout: 45000
      }
    );
    return parseAiJson(fallbackRes.data.choices[0].message.content);
  }

  return parseAiJson(rawText);
}

// Thực thi hành động do AI Vision quyết định
async function executeVisualAction(page, decision, regData) {
  switch (decision.action) {
    case "type": {
      const selector = decision.selector || "input";
      const textToType = decision.text || "";

      try {
        await page.waitForSelector(selector, { visible: true, timeout: 5000 });
        await page.click(selector);
        await page.keyboard.down("Control");
        await page.keyboard.press("KeyA");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");
      } catch {
        try {
          const handles = await page.$x(`//*[contains(text(), '${selector}') or @placeholder='${selector}']`);
          if (handles.length > 0) await handles[0].click();
        } catch {}
      }

      // Gõ phím mô phỏng người thật
      for (const char of textToType) {
        await page.keyboard.type(char, { delay: Math.floor(Math.random() * 30) + 30 });
      }

      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, selector);

      await new Promise((r) => setTimeout(r, 600));
      break;
    }

    case "click": {
      const sel = decision.selector || "button";
      let clicked = false;

      try {
        await page.waitForSelector(sel, { visible: true, timeout: 4000 });
        await page.click(sel);
        clicked = true;
      } catch {}

      if (!clicked) {
        try {
          const handles = await page.$x(`//button[contains(., '${sel}')] | //a[contains(., '${sel}')] | //*[contains(text(), '${sel}')]`);
          if (handles.length > 0) {
            await handles[0].click();
            clicked = true;
          }
        } catch {}
      }

      if (!clicked) {
        await page.keyboard.press("Enter");
      }
      break;
    }

    case "press": {
      await page.keyboard.press(decision.key || "Enter");
      break;
    }

    case "wait": {
      await new Promise((r) => setTimeout(r, decision.waitMs || 2000));
      break;
    }

    case "finish": {
      console.log("\n🎉 AI Vision xác nhận: ĐÃ ĐẾN BƯỚC HOÀN TẤT HOẶC XÁC MINH OTP!");
      return true;
    }

    default:
      console.log(`(!) Hành động chưa hỗ trợ: ${decision.action}`);
  }

  await new Promise((r) => setTimeout(r, 1000));
  return false;
}

// ==============================================================================
// 4. MAIN FLOW
// ==============================================================================
async function main() {
  console.log("==================================================");
  console.log("   AI VISION AUTONOMOUS GITHUB REGISTRATION       ");
  console.log("==================================================");
  console.log(`-> Model AI    : ${AI_CONFIG.model}`);
  console.log(`-> AI Base URL : ${AI_CONFIG.baseUrl}`);
  console.log(`-> AI Prompt   : "${AI_CONFIG.prompt}"`);

  const regData = generateRegistrationData();
  console.log("\n📋 DỮ LIỆU ĐĂNG KÝ MẪU:");
  console.log(`   - Email    : ${regData.email}`);
  console.log(`   - Password : ${regData.password}`);
  console.log(`   - Username : ${regData.username}`);

  let browser = null;

  try {
    const execPath = findBrowserExecutable();
    if (!execPath) {
      throw new Error("Không tìm thấy file thực thi ShardBrowser trên hệ thống.");
    }

    console.log(`\n[1] Lõi trình duyệt ShardBrowser:`);
    console.log(`    -> ${execPath}`);

    // 1. Tạo Profile riêng biệt với Fingerprint + Proxy độc lập
    const profileId = cliOpts.profileId || `github-ai-${Date.now().toString().slice(-6)}`;
    console.log(`\n[2] Đang tạo Profile Anti-detect riêng biệt cho ShardBrowser...`);
    const profileInfo = createShardProfileOnDisk(profileId, `GitHub-Vision-${Date.now().toString().slice(-4)}`);
    console.log(`    -> Đã tạo Profile: '${profileInfo.profileName}' (ID: ${profileInfo.profileId})`);
    if (profileInfo.proxy) {
      console.log(`    -> Đã gán Proxy  : [${profileInfo.proxy.name}] (${profileInfo.proxy.country || "VN"})`);
    } else {
      console.log(`    -> Không gán Proxy (Chạy IP trực tiếp)`);
    }

    // 2. Khởi chạy ShardBrowser và kết nối qua CDP
    console.log(`\n[3] Khởi chạy ShardBrowser qua cổng CDP WebSocket...`);
    browser = await launchShardBrowserProfile(execPath, profileInfo, 9222);

    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());
    page.setDefaultNavigationTimeout(300000);
    page.setDefaultTimeout(300000);

    // 3. Mở trang chủ GitHub
    console.log("\n[4] Đang mở trang chủ https://github.com/...");
    await page.goto("https://github.com/", { waitUntil: "domcontentloaded", timeout: 300000 });
    await new Promise((r) => setTimeout(r, 2000));

    // 4. Vòng lặp AI Vision quan sát màn hình và đưa ra quyết định
    console.log("\n[5] Bắt đầu Vòng Lặp AI Vision Phân Tích Màn Hình Từng Bước:");
    console.log("--------------------------------------------------");

    const history = [];
    const maxSteps = 15;

    for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
      console.log(`\n📍 [Bước ${stepIndex}/${maxSteps}] Đang quan sát màn hình: ${page.url()}`);

      // Chụp ảnh màn hình hiện tại
      const screenshot = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 65 });
      const elements = await scanPageElements(page);

      console.log(`🤖 Đang gửi ảnh cho AI Vision (${AI_CONFIG.model}) suy luận...`);
      let decision;
      try {
        decision = await askVisualDecision(screenshot, page.url(), elements, regData, history);
        console.log(`💡 [AI Suy Luận] : ${decision.thought || "(không có)"}`);
        console.log(`👉 [AI Quyết Định]: Action="${decision.action}", Selector="${decision.selector || ''}", Text="${decision.text || decision.key || ''}"`);
      } catch (err) {
        console.warn("(!) Lỗi khi gọi AI Vision:", err.response?.data || err.message);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      history.push(decision);

      try {
        const isFinished = await executeVisualAction(page, decision, regData);
        if (isFinished) break;
      } catch (actErr) {
        console.warn(`(!) Lỗi thao tác (${actErr.message}) -> AI sẽ chụp ảnh mới để quan sát lại.`);
      }
    }

    console.log("\n==================================================");
    console.log("       KẾT THÚC QUY TRÌNH ĐĂNG KÝ VISION         ");
    console.log("==================================================");
    console.log(`📧 Email    : ${regData.email}`);
    console.log(`🔑 Password : ${regData.password}`);
    console.log(`👤 Username : ${regData.username}`);
    console.log("--------------------------------------------------");
    console.log("-> Giữ trình duyệt 30 giây để bạn quan sát kết quả.");
    await new Promise((r) => setTimeout(r, 30000));

  } catch (error) {
    console.error("\n❌ Đã xảy ra lỗi:", error.message);
  }
}

main();
