/**
 * SHARDX AUTONOMOUS AI BROWSER AGENT ENGINE
 * ===================================================================
 * Fully autonomous AI browser agent with Vision LLM reasoning,
 * multi-tab control, all-frames inspection, and live event streaming.
 */

import axios from "axios";
import puppeteer from "puppeteer-core";

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    profileId: "",
    prompt: "Tự động đăng ký tài khoản GitHub bằng email tạm thời và bật 2FA.",
    baseUrl: "https://api.xkiro.com/v1",
    apiKey: "sk-xt-dfa9623373697bc9c6d720f7b974e459b54189998b56de42",
    model: "stealth/ox-alpha-free",
    password: `ShardX@2026!Pass#${Date.now().toString().slice(-4)}`,
    maxSteps: 35,
    launcherUrl: "http://127.0.0.1:40325",
    apiToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaGFyZHgtYXBpIiwiaWF0IjoxNzg3MTI4NjE5LCJleHAiOjIxMDI0ODg2MTl9.Y44-0maSpd_9e7_U3yLPHgvFb1O2_GBHReb6qs0H2p0",
  };

  for (const arg of args) {
    if (arg.startsWith("--profile-id=")) options.profileId = arg.slice(13);
    else if (arg.startsWith("--prompt=")) options.prompt = arg.slice(9);
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice(11);
    else if (arg.startsWith("--api-key=")) options.apiKey = arg.slice(10);
    else if (arg.startsWith("--model=")) options.model = arg.slice(8);
    else if (arg.startsWith("--password=")) options.password = arg.slice(11);
    else if (arg.startsWith("--max-steps=")) options.maxSteps = parseInt(arg.slice(12), 10) || 35;
    else if (arg.startsWith("--launcher-url=")) options.launcherUrl = arg.slice(15);
    else if (arg.startsWith("--api-token=")) options.apiToken = arg.slice(12);
  }

  return options;
}

const config = parseArgs();

// Emit structured JSON event to stdout
function emitEvent(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

function parseAiJson(text) {
  if (typeof text !== "string") return text;
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

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
    const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(jsonStr); } catch {}
  }

  throw new Error(`Không thể trích xuất JSON từ phản hồi: ${cleaned.slice(0, 150)}...`);
}

async function extractAllFramesTextAndOtp(page) {
  let combinedText = "";
  try {
    const frames = page.frames();
    for (const frame of frames) {
      try {
        const frameText = await frame.evaluate(() => {
          return document.body ? (document.body.innerText || document.body.textContent || "") : "";
        });
        if (frameText) combinedText += "\n" + frameText;
      } catch {}
    }

    const matches = combinedText.match(/\b\d{6,8}\b/g) || [];
    let snippet = "";
    const keywordMatch = combinedText.match(/(?:launch code|verification code|mã xác minh|mã xác thực|your github launch code|security code)[\s\S]{0,120}/i);
    if (keywordMatch) {
      snippet = keywordMatch[0].replace(/\s+/g, " ");
    }

    return {
      detectedOtps: Array.from(new Set(matches)),
      emailSnippet: snippet,
      allTextSnippet: combinedText.slice(0, 400).replace(/\s+/g, " "),
    };
  } catch {
    return { detectedOtps: [], emailSnippet: "", allTextSnippet: "" };
  }
}

async function extractAllFramesElements(page) {
  const allElements = [];
  let frameIndex = 0;

  try {
    const frames = page.frames();
    for (const frame of frames) {
      try {
        const elements = await frame.evaluate((fIdx) => {
          const items = [];
          const candidates = document.querySelectorAll(
            'button, a, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="tab"], .btn, .Button, [tabindex="0"]'
          );

          for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight + 200;
            if (!isVisible) continue;

            const text = (el.innerText || el.textContent || el.value || el.placeholder || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().slice(0, 60);
            
            let selector = "";
            if (el.id) selector = `#${el.id}`;
            else if (el.name) selector = `[name="${el.name}"]`;
            else if (el.getAttribute("data-testid")) selector = `[data-testid="${el.getAttribute("data-testid")}"]`;
            else if (el.className && typeof el.className === "string") {
              const mainClass = el.className.split(" ").filter(c => c && !c.includes(":") && !c.includes("[") && !c.includes("/"))[0];
              if (mainClass) selector = `${el.tagName.toLowerCase()}.${mainClass}`;
            }
            if (!selector) selector = el.tagName.toLowerCase();

            items.push({
              tag: el.tagName.toLowerCase(),
              type: el.type || undefined,
              text,
              selector,
              frame: fIdx,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
            });
          }
          return items.slice(0, 40);
        }, frameIndex);

        if (elements && elements.length > 0) {
          allElements.push(...elements);
        }
      } catch {}
      frameIndex++;
    }
  } catch {}

  return allElements.slice(0, 60);
}

async function smartClick(page, selector, textTarget = "") {
  try {
    const frames = page.frames();
    for (const frame of frames) {
      try {
        if (selector) {
          const el = await frame.$(selector);
          if (el) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            await el.click().catch(() => {});
            return true;
          }
        }
      } catch {}
    }

    if (textTarget) {
      for (const frame of frames) {
        try {
          const clicked = await frame.evaluate((targetText) => {
            const buttons = Array.from(document.querySelectorAll('button, a, [role="button"], .btn, input[type="submit"]'));
            for (const btn of buttons) {
              const t = (btn.innerText || btn.textContent || btn.value || "").trim().toLowerCase();
              if (t.includes(targetText.toLowerCase())) {
                btn.scrollIntoView({ behavior: 'instant', block: 'center' });
                btn.click();
                return true;
              }
            }
            return false;
          }, textTarget);
          if (clicked) return true;
        } catch {}
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function smartType(page, selector, value) {
  try {
    const frames = page.frames();
    for (const frame of frames) {
      try {
        const el = await frame.$(selector);
        if (el) {
          await el.scrollIntoViewIfNeeded().catch(() => {});
          await el.click({ clickCount: 3 }).catch(() => {});
          await page.keyboard.press("Backspace").catch(() => {});
          await el.type(value, { delay: 30 });
          await frame.evaluate((sel, val) => {
            const input = document.querySelector(sel);
            if (input) {
              input.value = val;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('blur', { bubbles: true }));
            }
          }, selector, value).catch(() => {});
          return true;
        }
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

async function smartScroll(page, direction = "down") {
  try {
    const scrollDelta = direction === "up" ? -450 : 450;
    await page.evaluate((delta) => {
      window.scrollBy({ top: delta, left: 0, behavior: 'smooth' });
    }, scrollDelta);
    await new Promise((r) => setTimeout(r, 600));
    return true;
  } catch {
    return false;
  }
}

async function takeScreenshot(page) {
  try {
    await page.evaluate(() => {
      const overlays = document.querySelectorAll('.Overlay--hidden, [data-portal-root] .backdrop, .js-cookie-consent-banner');
      overlays.forEach(el => el.remove());
    }).catch(() => {});

    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 60,
      clip: { x: 0, y: 0, width: 1280, height: 720 },
      optimizeForSpeed: true,
    });
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  } catch (e) {
    return null;
  }
}

async function callVisionAi(screenshotDataUrl, elements, textInfo, tabIndex, currentUrl, history, goalPrompt) {
  const systemPrompt = `Bạn là một AI Browser Agent tự động điều khiển trình duyệt chuyên nghiệp.
Nhiệm vụ của bạn: "${goalPrompt}".
Mật khẩu cố định để đăng ký/đăng nhập: "${config.password}".

QUY TRÌNH HÀNH ĐỘNG:
- Bạn có toàn quyền mở tab (new_tab), chuyển tab (switch_tab), click, gõ phím (type), cuộn trang (scroll), giải OTP (solve_otp), hoặc hoàn thành (finish).
- Nếu trang có iframes (như hộp thư Temp Mail), hệ thống đã trích xuất toàn bộ text & OTP trong iframe ở trường 'textInfo'.
- Nếu gặp lỗi tên đăng nhập bị trùng hoặc captcha, hãy tự động sửa username hoặc xử lý tiếp.
- Trả về kết quả ĐÚNG định dạng JSON sau:
{
  "thought": "Suy nghĩ ngắn gọn về tình trạng hiện tại và bước tiếp theo",
  "action": "click | type | key_press | new_tab | switch_tab | close_tab | scroll | solve_otp | wait | finish",
  "selector": "CSS selector của phần tử cần click/type",
  "value": "Nội dung cần nhập hoặc URL cần mở",
  "tabIndex": 0
}`;

  const userPrompt = `Đang ở Tab #${tabIndex} (${currentUrl}).
OTP phát hiện: ${JSON.stringify(textInfo.detectedOtps)}
Trích đoạn text: "${textInfo.emailSnippet || textInfo.allTextSnippet}"
Danh sách phần tử giao diện: ${JSON.stringify(elements)}

Lịch sử các bước trước:
${history.slice(-4).map((h, i) => `Bước ${i + 1}: ${h}`).join("\n")}

Hãy suy nghĩ và trả về JSON hành động tiếp theo:`;

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        ...(screenshotDataUrl ? [{ type: "image_url", image_url: { url: screenshotDataUrl } }] : []),
      ],
    },
  ];

  const response = await axios.post(
    `${config.baseUrl}/chat/completions`,
    {
      model: config.model,
      messages,
      temperature: 0.1,
      max_tokens: 800,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 45000,
    }
  );

  return parseAiJson(response.data.choices[0].message.content);
}

// MAIN RUNNER
async function main() {
  emitEvent({ type: "log", message: `🤖 Khởi động ShardX AI Agent: Model ${config.model}` });
  emitEvent({ type: "status", status: "initializing" });

  let profileId = config.profileId;
  const headers = { Authorization: `Bearer ${config.apiToken}` };

  // 1. Tạo profile nếu chưa có
  if (!profileId) {
    emitEvent({ type: "log", message: "Đang sinh ngẫu nhiên Fingerprint Profile..." });
    try {
      const fpRes = await axios.get(`${config.launcherUrl}/fingerprints/new`, { headers });
      const profileRes = await axios.post(`${config.launcherUrl}/profiles`, {
        name: `AI-Agent-${Date.now().toString().slice(-4)}`,
        notes: `Tác vụ AI: ${config.prompt.slice(0, 50)}`,
        fingerprint: fpRes.data.fingerprint,
      }, { headers });
      profileId = profileRes.data.id;
      emitEvent({ type: "log", message: `Đã tạo Profile ID: ${profileId}` });
    } catch (createErr) {
      emitEvent({ type: "log", message: `Thử tạo temporary profile...` });
      const tempRes = await axios.post(`${config.launcherUrl}/profiles/temporary`, {
        name: `AI-Agent-${Date.now().toString().slice(-4)}`,
      }, { headers });
      profileId = tempRes.data.id;
      emitEvent({ type: "log", message: `Đã tạo Profile ID: ${profileId}` });
    }
  }

  // 2. Khởi chạy Profile
  emitEvent({ type: "log", message: `Khởi chạy Profile ID: ${profileId}...` });
  const launchRes = await axios.post(`${config.launcherUrl}/profiles/${profileId}/start`, {}, { headers });
  const cdpPort = launchRes.data.cdp_port;

  await new Promise((r) => setTimeout(r, 2000));

  // 3. Kết nối Puppeteer
  const versionRes = await axios.get(`http://127.0.0.1:${cdpPort}/json/version`);
  const browser = await puppeteer.connect({
    browserWSEndpoint: versionRes.data.webSocketDebuggerUrl,
    defaultViewport: { width: 1280, height: 720 },
  });

  const pages = await browser.pages();
  const mainPage = pages[0] || (await browser.newPage());

  // Mở trang temp-mail mặc định nếu cần
  if (config.prompt.toLowerCase().includes("github") || config.prompt.toLowerCase().includes("temp mail") || config.prompt.toLowerCase().includes("email")) {
    emitEvent({ type: "log", message: "Mở trang https://unlimitmail.com/vi/temp-mail để lấy email..." });
    await mainPage.goto("https://unlimitmail.com/vi/temp-mail", { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  const history = [];
  let currentTabIndex = 0;
  let isDone = false;

  emitEvent({ type: "status", status: "running" });

  for (let step = 1; step <= config.maxSteps && !isDone; step++) {
    const allPages = await browser.pages();
    if (currentTabIndex >= allPages.length) currentTabIndex = allPages.length - 1;
    const activePage = allPages[currentTabIndex] || mainPage;
    await activePage.bringToFront().catch(() => {});

    const currentUrl = activePage.url();
    const [screenshotDataUrl, elements, textInfo] = await Promise.all([
      takeScreenshot(activePage),
      extractAllFramesElements(activePage),
      extractAllFramesTextAndOtp(activePage),
    ]);

    emitEvent({
      type: "step_start",
      step,
      maxSteps: config.maxSteps,
      tabIndex: currentTabIndex,
      url: currentUrl,
      screenshot: screenshotDataUrl,
    });

    emitEvent({ type: "status", status: "thinking" });

    let decision;
    try {
      decision = await callVisionAi(screenshotDataUrl, elements, textInfo, currentTabIndex, currentUrl, history, config.prompt);
    } catch (err) {
      emitEvent({ type: "log", message: `⚠️ AI Vision lỗi: ${err.message}. Đang thử lại sau 2s...` });
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    emitEvent({
      type: "step",
      step,
      maxSteps: config.maxSteps,
      tabIndex: currentTabIndex,
      url: currentUrl,
      thought: decision.thought,
      action: decision.action,
      selector: decision.selector || "",
      value: decision.value || "",
      screenshot: screenshotDataUrl,
      status: "executing",
    });

    history.push(`[Bước ${step}] ${decision.action}: ${decision.selector || decision.value || ""} -> ${decision.thought}`);

    // Thực thi hành động
    try {
      switch (decision.action) {
        case "click":
          await smartClick(activePage, decision.selector, decision.value);
          await new Promise((r) => setTimeout(r, 1200));
          break;

        case "type":
          await smartType(activePage, decision.selector, decision.value);
          await new Promise((r) => setTimeout(r, 800));
          break;

        case "key_press":
          await activePage.keyboard.press(decision.value || "Enter");
          await new Promise((r) => setTimeout(r, 1000));
          break;

        case "new_tab": {
          const newP = await browser.newPage();
          await newP.goto(decision.value, { waitUntil: "domcontentloaded", timeout: 30000 });
          const newPages = await browser.pages();
          currentTabIndex = newPages.indexOf(newP);
          break;
        }

        case "switch_tab":
          if (typeof decision.tabIndex === "number") currentTabIndex = decision.tabIndex;
          break;

        case "close_tab":
          if (allPages.length > 1) {
            await activePage.close();
            currentTabIndex = Math.max(0, currentTabIndex - 1);
          }
          break;

        case "scroll":
          await smartScroll(activePage, decision.value || "down");
          break;

        case "solve_otp":
          if (textInfo.detectedOtps.length > 0) {
            const otpCode = textInfo.detectedOtps[0];
            emitEvent({ type: "log", message: `🎯 Tự động điền mã OTP: ${otpCode}` });
            await smartType(activePage, decision.selector || 'input[autocomplete="one-time-code"]', otpCode);
          }
          break;

        case "finish":
          isDone = true;
          emitEvent({
            type: "result",
            success: true,
            result: decision.value || "Tác vụ hoàn thành xuất sắc!",
            data: { prompt: config.prompt, profileId },
          });
          emitEvent({ type: "status", status: "success" });
          break;

        case "wait":
        default:
          await new Promise((r) => setTimeout(r, 2000));
          break;
      }
    } catch (execErr) {
      emitEvent({ type: "log", message: `⚠️ Thực thi action thất bại: ${execErr.message}` });
    }
  }

  if (!isDone) {
    emitEvent({
      type: "result",
      success: false,
      result: `Đã đạt giới hạn ${config.maxSteps} bước mà chưa kết thúc tác vụ.`,
    });
    emitEvent({ type: "status", status: "completed" });
  }
}

main().catch((err) => {
  emitEvent({ type: "error", error: err.message });
  emitEvent({ type: "status", status: "error" });
  process.exit(1);
});
