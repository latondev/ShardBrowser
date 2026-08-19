/**
 * AI BROWSER AGENT RUNNER (Node.js + Vision LLM + ShardX Anti-detect)
 * ===================================================================
 * TOÀN BỘ QUY TRÌNH TỰ ĐỘNG TỪ A - Z:
 * 1. Mở UnlimitMail -> Lấy email tạm thời.
 * 2. Mở tab mới GitHub -> Đăng ký tài khoản (Email, Pass, Username).
 * 3. Đọc mã OTP từ UnlimitMail -> Điền xác minh tài khoản.
 * 4. Đăng nhập vào GitHub -> Vào Settings bật 2FA (Two-Factor Authentication).
 * 5. Lấy Secret Key 2FA -> Mở tab 2fa.page lấy mã OTP 6 số.
 * 6. Điền OTP kích hoạt 2FA thành công -> Xuất báo cáo: email|pass|2fa.
 * 
 * Chạy bằng lệnh: node Testing/ai_agent_runner.js
 */

import axios from "axios";
import puppeteer from "puppeteer-core";

// ==============================================================================
// 1. CẤU HÌNH AI & TÀI KHOẢN MẪU
// ==============================================================================
export const AI_CONFIG = {
  baseUrl: "https://api.xkiro.com/v1",
  apiKey: "sk-xt-dfa9623373697bc9c6d720f7b974e459b54189998b56de42",
  model: "qwen/qwen3.8-max",

  // Mật khẩu cố định dùng cho toàn bộ quá trình đăng ký & đăng nhập
  defaultPassword: `ShardX@2026!Pass#${Date.now().toString().slice(-4)}`,
};

// ==============================================================================
// 2. CẤU HÌNH SHARDX LAUNCHER
// ==============================================================================
const LAUNCHER_API_URL = "http://127.0.0.1:40325";
const API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaGFyZHgtYXBpIiwiaWF0IjoxNzg3MTI4NjE5LCJleHAiOjIxMDI0ODg2MTl9.Y44-0maSpd_9e7_U3yLPHgvFb1O2_GBHReb6qs0H2p0";
const headers = { Authorization: `Bearer ${API_TOKEN}` };

// Trích xuất an toàn JSON từ câu trả lời của AI
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

  throw new Error(`Không thể trích xuất JSON: ${cleaned.slice(0, 150)}...`);
}

// Quét toàn bộ nội dung text & mã OTP từ trang chính và TẤT CẢ các iframes
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
    const keywordMatch = combinedText.match(/(?:launch code|verification code|mã xác minh|mã xác thực|your github launch code)[\s\S]{0,120}/i);
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

// Quét toàn bộ phần tử tương tác (Buttons, Inputs, Links) từ trang chính và TẤT CẢ các iframes
async function extractAllFramesElements(page) {
  const allElements = [];
  let frameIndex = 0;

  try {
    const frames = page.frames();
    for (const frame of frames) {
      try {
        const frameElements = await frame.evaluate((fIdx) => {
          const list = [];
          const nodes = document.querySelectorAll("input, button, a, textarea, select, [role='button'], .email-box, #email, tr, td, code, pre, summary, .btn, .Button, [class*='mail'], [class*='otp']");
          nodes.forEach((el, index) => {
            const rect = el.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== "hidden";
            if (!isVisible && el.tagName !== "INPUT" && el.tagName !== "BUTTON") return;

            const text = (el.innerText || el.value || el.textContent || "").trim().slice(0, 80);
            if (!text && el.tagName === "DIV") return;

            list.push({
              source: fIdx === 0 ? "main_page" : `iframe_${fIdx}`,
              tag: el.tagName.toLowerCase(),
              type: el.type || null,
              name: el.name || null,
              placeholder: el.placeholder || null,
              text: text,
              selector: el.id ? `#${el.id}` : el.name ? `[name='${el.name}']` : el.className ? `.${el.className.split(' ').filter(Boolean).slice(0, 2).join('.')}` : null,
            });
          });
          return list;
        }, frameIndex);

        if (Array.isArray(frameElements)) {
          allElements.push(...frameElements);
        }
      } catch {}
      frameIndex++;
    }
  } catch {}

  return allElements.slice(0, 60);
}

// Lấy danh sách các Tab đang mở
async function getTabsInfo(browser) {
  const pages = await browser.pages();
  const tabs = [];
  for (let i = 0; i < pages.length; i++) {
    try {
      tabs.push({
        index: i,
        url: pages[i].url(),
        title: await pages[i].title(),
      });
    } catch {
      tabs.push({ index: i, url: "unknown", title: "unknown" });
    }
  }
  return tabs;
}

// Gọi LLM AI Vision để phân tích và đưa ra hành động tiếp theo
async function askAI(task, history, screenshotBase64, currentUrl, elements, tabs, activeTabIndex, frameData, accountState) {
  const systemPrompt = `Bạn là một AI Browser Agent siêu tốc điều khiển trình duyệt web để Đăng ký GitHub & Bật 2FA.

THÔNG TIN TÀI KHOẢN:
- Email tạm: "${accountState.email || "(Đang lấy từ UnlimitMail)"}"
- Password: "${accountState.password}"
- Username: "${accountState.username || "(devuserXXXX)"}"
- 2FA Secret: "${accountState.twoFactorSecret || "(Chưa lấy)"}"

HÀNH ĐỘNG NHANH CHÓNG THEO 5 BƯỚC:
1. Đăng ký & Nhận OTP Email:
   - Lấy email từ UnlimitMail (Tab 0) -> new_tab vào GitHub signup (Tab 1) -> Nhập Email, Password, Username -> Bấm Create account.
   - Khi GitHub đòi OTP: switch_tab về Tab 0 mở email lấy OTP -> switch_tab về Tab 1 gõ trọn bộ OTP 8 số (action='type', text='MÃ_OTP').
2. Đăng nhập:
   - Nếu chuyển sang trang login: Điền Email và Password -> Bấm Sign in.
3. Vào Security bật 2FA:
   - action="navigate", url="https://github.com/settings/security"
   - Bấm nút "Enable two-factor authentication" (hoặc "Set up using an app").
   - Bấm "setup key" / "enter this text code" để lấy chuỗi Base32 Secret Key (điền vào trường "secretKey").
4. Lấy OTP từ 2fa.page:
   - action="new_tab", url="https://2fa.page/"
   - Dán Secret Key vào 2fa.page lấy mã OTP 6 số.
5. Kích hoạt 2FA & Hoàn tất:
   - switch_tab về Tab GitHub -> Điền mã OTP 6 số vào ô xác nhận 2FA -> Bấm Save/Done -> Trả về action="finish".

Định dạng JSON trả về DUY NHẤT:
{
  "thought": "Mô tả ngắn gọn và hành động ngay",
  "action": "type" | "click" | "press" | "navigate" | "new_tab" | "switch_tab" | "scroll" | "wait" | "finish",
  "selector": "CSS Selector hoặc Text của phần tử (VD: 'Create account', 'Enable two-factor authentication')",
  "text": "Nội dung cần nhập (Email, Pass, Username, OTP email hoặc 2FA Secret Key)",
  "key": "Phím cần ấn (VD: Enter, Escape)",
  "url": "Địa chỉ URL nếu navigate hoặc new_tab",
  "tabIndex": 0 | 1 | 2,
  "secretKey": "Chuỗi 2FA Secret Key",
  "report": "email|pass|2fa (khi action=finish)",
  "waitMs": 2000
}`;

  const otpNotice = frameData.detectedOtps.length > 0
    ? `🔥 MÃ OTP EMAIL PHÁT HIỆN: [ ${frameData.detectedOtps.join(", ")} ]`
    : ``;

  const userContent = [
    {
      type: "text",
      text: `Tab đang hoạt động: Tab #${activeTabIndex} (${currentUrl})
Danh sách các Tab đang mở:
${JSON.stringify(tabs, null, 2)}

${otpNotice}
Nội dung văn bản quét được:
"${frameData.allTextSnippet}"

Lịch sử các bước:
${history.length === 0 ? "(Chưa có bước nào)" : history.map((h, i) => `${i + 1}. [${h.action}] ${h.thought || ""}`).join("\n")}

Danh sách phần tử DOM:
${JSON.stringify(elements, null, 2)}

Hãy quan sát ảnh và trả về hành động JSON tiếp theo:`
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
  const res = await axios.post(
    endpoint,
    {
      model: AI_CONFIG.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      max_tokens: 2048,
      temperature: 0.1
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${AI_CONFIG.apiKey}`
      }
    }
  );

  const rawMessage = res.data.choices[0].message.content;
  return parseAiJson(rawMessage);
}

// Hàm click thông minh toàn năng (bấm chuẩn xác trên cả trang chính & iframes)
async function smartClick(page, rawSelector, stepValue) {
  if (!rawSelector && !stepValue) return;

  // Nếu là nút đóng popup overlay
  if ((rawSelector || "").includes("Overlay") || (rawSelector || "").includes("close-button") || (rawSelector || "").includes("close")) {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const closeBtn = document.querySelector(".close-button, .Overlay-closeButton, [aria-label='Close']");
      if (closeBtn) closeBtn.click();
    });
    return;
  }

  let textToFind = null;
  const textPseudoPattern = /:(?:has-text|contains|text)\(['"]?(.*?)['"]?\)/i;
  const textEqualPattern = /text=(.+)/i;

  const match1 = (rawSelector || "").match(textPseudoPattern);
  const match2 = (rawSelector || "").match(textEqualPattern);

  if (match1) {
    textToFind = match1[1];
  } else if (match2) {
    textToFind = match2[1];
  } else if (stepValue && typeof stepValue === "string" && stepValue.length > 2 && !/^\d+$/.test(stepValue)) {
    textToFind = stepValue;
  } else if (rawSelector && !rawSelector.includes("#") && !rawSelector.includes(".") && !rawSelector.includes("[")) {
    textToFind = rawSelector;
  }

  const cleanTarget = textToFind ? textToFind.replace(/['"]/g, "").trim().toLowerCase() : null;
  let cleanSelector = (rawSelector || "")
    .replace(/:(?:has-text|contains|text)\(['"]?.*?['"]?\)/gi, "")
    .replace(/text=.*?(?=,|$)/gi, "")
    .trim();

  // Quét và click trên trang chính và TẤT CẢ iframes
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const clicked = await frame.evaluate((target, sel) => {
        // 1. Tìm theo Text
        if (target) {
          const candidates = Array.from(document.querySelectorAll("a, button, input[type='submit'], [role='button'], summary, span, div, p, tr, td"));
          for (const el of candidates) {
            const txt = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
            if (txt && (txt === target || txt.includes(target))) {
              el.scrollIntoView({ behavior: "instant", block: "center" });
              el.click();
              return true;
            }
          }
        }

        // 2. Tìm theo Selector
        if (sel) {
          const parts = sel.split(",").map(s => s.trim()).filter(Boolean);
          for (const part of parts) {
            try {
              const el = document.querySelector(part);
              if (el) {
                el.scrollIntoView({ behavior: "instant", block: "center" });
                el.click();
                return true;
              }
            } catch {}
          }
        }
        return false;
      }, cleanTarget, cleanSelector);

      if (clicked) return;
    } catch {}
  }
}

// Cuộn thông minh
async function smartScroll(page, direction = "down", stepValue = null) {
  const valStr = String(stepValue || "").toLowerCase();
  const dirStr = String(direction || "").toLowerCase();
  const isUp = dirStr === "up" || valStr.includes("up") || valStr.includes("-") || valStr.includes("home");

  await page.evaluate((up) => {
    if (up) {
      window.scrollTo({ top: 0, behavior: "instant" });
    } else {
      const mailBox = document.querySelector(".card-body, .email-content, #email-content, [class*='mail'], iframe");
      if (mailBox) {
        mailBox.scrollIntoView({ behavior: "instant", block: "center" });
      } else {
        window.scrollBy({ top: 400, behavior: "instant" });
      }
    }
  }, isUp);
}

// Thực thi hành động AI yêu cầu
async function executeAction(context, step, accountState) {
  console.log(`\n🧠 [AI Suy nghĩ]: "${step.thought}"`);
  console.log(`⚡ [Thực thi]  : Action=[${step.action}] | Selector=[${step.selector || ""}] | Value=[${step.text || step.key || step.url || step.tabIndex || ""}]`);

  if (step.secretKey) {
    accountState.twoFactorSecret = step.secretKey.trim();
    console.log(`🔑 [Ghi nhận 2FA Secret Key]: ${accountState.twoFactorSecret}`);
  }

  switch (step.action) {
    case "new_tab": {
      const newPage = await context.browser.newPage();
      if (step.url) {
        await newPage.goto(step.url, { waitUntil: "domcontentloaded" });
      }
      context.page = newPage;
      await new Promise((r) => setTimeout(r, 1000));
      break;
    }

    case "switch_tab": {
      const pages = await context.browser.pages();
      const targetIndex = typeof step.tabIndex === "number" ? step.tabIndex : 0;
      if (pages[targetIndex]) {
        context.page = pages[targetIndex];
        await context.page.bringToFront();
        await new Promise((r) => setTimeout(r, 800));
      }
      break;
    }

    case "navigate":
      await context.page.goto(step.url, { waitUntil: "domcontentloaded" });
      await new Promise((r) => setTimeout(r, 1000));
      break;

    case "scroll":
      await smartScroll(context.page, step.key || step.url || "down", step.selector || step.text);
      break;

    case "type": {
      const textToType = (step.text || "").trim();

      // Kiểm tra nếu đang ở trang verify OTP (6 hoặc 8 số)
      const isOtpCode = /^\d{6,8}$/.test(textToType);
      const isVerifyPage = context.page.url().includes("verification") || context.page.url().includes("two-factor") || context.page.url().includes("2fa");

      if (isOtpCode || isVerifyPage && /^\d{1,8}$/.test(textToType)) {
        console.log(`⚡ [Tự động điền mã OTP]: Đang nhập mã [${textToType}]...`);
        
        const firstBox = await context.page.$("#launch-code-0, #app_totp, #otp, input[data-index='0'], input[type='text']");
        if (firstBox) {
          await firstBox.click();
        }

        // Xóa sạch ô
        await context.page.evaluate(() => {
          for (let i = 0; i < 8; i++) {
            const el = document.querySelector(`#launch-code-${i}`) || document.querySelector(`input[data-index='${i}']`);
            if (el) {
              el.value = "";
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
          const singleOtp = document.querySelector("#app_totp, #otp, input[name='otp']");
          if (singleOtp) {
            singleOtp.value = "";
            singleOtp.dispatchEvent(new Event("input", { bubbles: true }));
          }
        });

        // Gõ số
        for (const digit of textToType) {
          await context.page.keyboard.press(digit);
          await new Promise((r) => setTimeout(r, 40));
        }

        await context.page.evaluate((code) => {
          for (let i = 0; i < code.length; i++) {
            const el = document.querySelector(`#launch-code-${i}`) || document.querySelector(`input[data-index='${i}']`);
            if (el) {
              el.value = code[i];
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
          const singleOtp = document.querySelector("#app_totp, #otp, input[name='otp']");
          if (singleOtp) {
            singleOtp.value = code;
            singleOtp.dispatchEvent(new Event("input", { bubbles: true }));
            singleOtp.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }, textToType);

        await new Promise((r) => setTimeout(r, 1000));
        break;
      }

      if (step.selector) {
        try {
          await context.page.waitForSelector(step.selector, { visible: true, timeout: 4000 });
          await context.page.click(step.selector, { clickCount: 3 });
          await context.page.keyboard.down("Control");
          await context.page.keyboard.press("KeyA");
          await context.page.keyboard.up("Control");
          await context.page.keyboard.press("Backspace");

          await context.page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) {
              el.value = "";
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }, step.selector);
        } catch {
          await smartClick(context.page, step.selector, textToType);
          await context.page.keyboard.down("Control");
          await context.page.keyboard.press("KeyA");
          await context.page.keyboard.up("Control");
          await context.page.keyboard.press("Backspace");
        }
      }

      if (textToType) {
        if (textToType.includes("@")) accountState.email = textToType;
        if (step.selector && step.selector.includes("login")) accountState.username = textToType;

        for (const char of textToType) {
          await context.page.keyboard.type(char, { delay: Math.floor(Math.random() * 20) + 25 });
        }

        // Kích hoạt event input/change/blur mà KHÔNG ấn Tab gây nhảy modal
        await context.page.evaluate((sel) => {
          if (sel) {
            const el = document.querySelector(sel);
            if (el) {
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("blur", { bubbles: true }));
            }
          }
        }, step.selector);
      }
      break;
    }

    case "click":
      await smartClick(context.page, step.selector, step.text || step.key);
      break;

    case "press":
      if (step.key === "PageDown" || step.key === "ArrowDown") {
        await smartScroll(context.page, "down");
      } else if (step.key === "Home" || step.key === "PageUp" || step.key === "ArrowUp") {
        await smartScroll(context.page, "up");
      } else {
        await context.page.keyboard.press(step.key || "Enter");
      }
      break;

    case "wait":
      await new Promise((r) => setTimeout(r, step.waitMs || 2000));
      break;

    case "finish": {
      console.log("\n🎉 AI Báo cáo: ĐÃ HOÀN TẤT TOÀN BỘ QUY TRÌNH!");
      accountState.report = step.report || `${accountState.email}|${accountState.password}|${accountState.twoFactorSecret}`;
      return true;
    }

    default:
      console.log(`(!) Hành động chưa hỗ trợ: ${step.action}`);
  }

  await new Promise((r) => setTimeout(r, 800));
  return false;
}

// Hàm chính khởi động Runner
async function main() {
  console.log("==================================================");
  console.log("   AI AGENT: GITHUB REGISTER + 2FA ACTIVATION     ");
  console.log("==================================================");
  console.log(`-> Model AI : ${AI_CONFIG.model}`);
  console.log(`-> Base URL : ${AI_CONFIG.baseUrl}`);

  const accountState = {
    email: "",
    password: AI_CONFIG.defaultPassword,
    username: "",
    twoFactorSecret: "",
    report: "",
  };

  let profileId = null;

  try {
    // 1. Tạo profile mới trên ShardX
    console.log("\n[1] Đang sinh Fingerprint ngẫu nhiên & tạo profile...");
    const { data: fpRes } = await axios.get(`${LAUNCHER_API_URL}/fingerprint/new`, { headers });
    const { data: createdProfile } = await axios.post(
      `${LAUNCHER_API_URL}/profiles`,
      {
        name: `AI-GitHub-2FA-${Date.now().toString().slice(-4)}`,
        notes: "Profile AI tự đăng ký & kích hoạt 2FA",
        fingerprint: fpRes.fingerprint,
      },
      { headers }
    );
    profileId = createdProfile.id;

    // 2. Mở trình duyệt với cổng CDP
    console.log(`[2] Khởi chạy ShardX Profile ID: ${profileId}...`);
    const { data: startRes } = await axios.post(
      `${LAUNCHER_API_URL}/profiles/${profileId}/start`,
      { headless: false },
      { headers }
    );

    const wsEndpoint = startRes.cdp?.web_socket_debugger_url;
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint,
      defaultViewport: null,
    });

    const pages = await browser.pages();
    let activePage = pages[0] || (await browser.newPage());

    // 3. Mở trang UnlimitMail trước
    console.log("\n[3] Đang mở trang https://unlimitmail.com/vi/temp-mail để lấy email...");
    await activePage.goto("https://unlimitmail.com/vi/temp-mail", { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 2000));

    const context = { browser, page: activePage };

    // 4. Bắt đầu vòng lặp AI Agent
    console.log("\n[4] Bắt đầu vòng lặp AI tự động thực hiện từ A - Z:");
    console.log(`    - Mật khẩu thiết lập: ${accountState.password}\n`);

    const history = [];
    const maxSteps = 35; // Tối đa 35 bước

    for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
      console.log(`\n--------------------------------------------------`);
      
      const allPages = await browser.pages();
      const currentActiveIndex = allPages.indexOf(context.page);
      const currentUrl = context.page.url();
      const tabs = await getTabsInfo(browser);

      // Tự động đóng cookie / popup nếu có
      await context.page.evaluate(() => {
        const cookieBtn = document.querySelector("button._1XuCi2WhiqeWRUVp3pnFG3, [aria-label*='Cookie']");
        if (cookieBtn) cookieBtn.click();
      });

      // Nếu đang ở UnlimitMail, tự động căn giữa khung Hộp thư đến
      if (currentUrl.includes("unlimitmail.com")) {
        await context.page.evaluate(() => {
          const mailSection = document.querySelector("#inbox, .card-body, [class*='inbox'], [class*='mail']");
          if (mailSection) {
            mailSection.scrollIntoView({ behavior: "instant", block: "center" });
          }
        });
      }

      // Quét toàn bộ text & OTP từ trang chính + tất cả iframes
      const frameData = await extractAllFramesTextAndOtp(context.page);

      console.log(`📍 [Bước ${stepIndex}/${maxSteps}] Đang quan sát Tab #${currentActiveIndex} (${currentUrl})...`);
      if (frameData.detectedOtps.length > 0) {
        console.log(`🔍 [Gợi ý OTP Email phát hiện]: ${frameData.detectedOtps.join(", ")}`);
      }

      // Chụp màn hình tab đang active
      const screenshot = await context.page.screenshot({ encoding: "base64", type: "jpeg", quality: 65 });
      // Quét toàn bộ phần tử tương tác từ trang chính & iframes
      const elements = await extractAllFramesElements(context.page);

      // Hỏi AI quyết định bước đi tiếp theo
      let stepDecision;
      try {
        stepDecision = await askAI(null, history, screenshot, currentUrl, elements, tabs, currentActiveIndex, frameData, accountState);
      } catch (err) {
        console.warn("(!) Thử lại bước do định dạng phản hồi:", err.message);
        continue;
      }

      history.push(stepDecision);

      // Thực thi hành động
      try {
        const isDone = await executeAction(context, stepDecision, accountState);
        if (isDone) break;
      } catch (actErr) {
        console.warn(`(!) Gặp lỗi khi thao tác (${actErr.message}) -> AI sẽ quan sát ảnh mới ở bước sau để tự sửa.`);
      }
    }

    console.log("\n==================================================");
    console.log("       KẾT QUẢ TÀI KHOẢN GITHUB HOÀN TẤT + 2FA    ");
    console.log("==================================================");
    console.log(`📧 Email       : ${accountState.email}`);
    console.log(`🔑 Password    : ${accountState.password}`);
    console.log(`🛡️ 2FA Secret  : ${accountState.twoFactorSecret || "N/A"}`);
    console.log("--------------------------------------------------");
    console.log(`📋 ĐỊNH DẠNG   : ${accountState.email}|${accountState.password}|${accountState.twoFactorSecret}`);
    console.log("==================================================");

    console.log("\n-> Giữ trình duyệt 35s để bạn quan sát kết quả trước khi đóng.");
    await new Promise((r) => setTimeout(r, 35000));

    await axios.post(`${LAUNCHER_API_URL}/profiles/${profileId}/stop`, {}, { headers });
    console.log("-> Đã đóng profile.");
  } catch (e) {
    console.error("(!) Lỗi hệ thống:", e.message);
  }
}

main();
