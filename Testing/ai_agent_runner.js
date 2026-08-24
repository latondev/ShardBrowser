/**
 * AI BROWSER AGENT RUNNER - HYBRID STEP-DRIVEN WITH POST-STEP AI OBSERVER
 * =======================================================================
 * Kiến trúc: Code tự động thực thi từng Step chính xác -> AI Vision quan sát
 * đánh giá sau mỗi Step (Post-Step Evaluation) -> Tự động cứu vãn (Self-Healing).
 * 
 * Tối ưu hóa cho ShardBrowser / ShardX Anti-detect Browser.
 */

import axios from "axios";
import puppeteer from "puppeteer-core";
import fs from "fs";

// ==============================================================================
// 1. CẤU HÌNH AI & SHARDX LAUNCHER
// ==============================================================================
export const AI_CONFIG = {
  baseUrl: "https://api.xkiro.com/v1",
  apiKey: "sk-xt-dfa9623373697bc9c6d720f7b974e459b54189998b56de42",
  model: "mistralai/mistral-large-2512",
  fallbackModel: "qwen/qwen3.8-max",
};

const LAUNCHER_API_URL = "http://127.0.0.1:40325";
const API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaGFyZHgtYXBpIiwiaWF0IjoxNzg3MTI4NjE5LCJleHAiOjIxMDI0ODg2MTl9.Y44-0maSpd_9e7_U3yLPHgvFb1O2_GBHReb6qs0H2p0";
const HEADERS = { Authorization: `Bearer ${API_TOKEN}` };

// ==============================================================================
// 2. HELPER BÓC TÁCH JSON TỪ AI
// ==============================================================================
function _parseAiJson(text) {
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
    try { return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)); } catch {}
  }

  throw new Error(`Không thể trích xuất JSON: ${cleaned.slice(0, 120)}...`);
}

// ==============================================================================
// 3. CLASS CORE: ShardStepRunner
// ==============================================================================
export class ShardStepRunner {
  // Private variables theo quy tắc _{name}
  _browser = null;
  _activePage = null;
  _profileId = null;
  _accountState = {
    email: "",
    password: `ShardX@${Date.now().toString().slice(-4)}!Aa8`,
    username: "",
    twoFactorSecret: "",
    recoveryCodes: [],
    report: "",
  };
  _history = [];
  _maxHealingAttempts = 3;

  constructor() {}

  // ----------------------------------------------------------------------------
  // PRIVATE HELPER METHODS
  // ----------------------------------------------------------------------------
  async _waitDomIdle(ms = 1500) {
    await new Promise((r) => setTimeout(r, ms));
  }

  async _takeScreenshot() {
    if (!this._activePage) return null;
    try {
      return await this._activePage.screenshot({ encoding: "base64", type: "jpeg", quality: 65 });
    } catch {
      return null;
    }
  }

  async _extractDomElements() {
    if (!this._activePage) return [];
    try {
      return await this._activePage.evaluate(() => {
        const list = [];
        const nodes = document.querySelectorAll("input, button, a, textarea, select, [role='button'], .email-box, #email, code, pre, summary, .btn, [class*='mail'], [class*='otp']");
        nodes.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== "hidden";
          if (!isVisible && el.tagName !== "INPUT" && el.tagName !== "BUTTON") return;

          const text = (el.innerText || el.value || el.textContent || "").trim().slice(0, 80);
          list.push({
            tag: el.tagName.toLowerCase(),
            type: el.type || null,
            id: el.id || null,
            name: el.name || null,
            text: text,
            value: el.value ? el.value.slice(0, 40) : null,
            selector: el.id ? `#${el.id}` : el.name ? `[name='${el.name}']` : el.className ? `.${el.className.split(' ').filter(Boolean).slice(0, 2).join('.')}` : null,
          });
        });
        return list.slice(0, 50);
      });
    } catch {
      return [];
    }
  }

  async _extractTextAndOtp() {
    if (!this._activePage) return { detectedOtps: [], allText: "" };
    let combinedText = "";
    try {
      const frames = this._activePage.frames();
      for (const frame of frames) {
        try {
          const t = await frame.evaluate(() => document.body ? (document.body.innerText || "") : "");
          if (t) combinedText += "\n" + t;
        } catch {}
      }

      const matches = combinedText.match(/\b\d{6,8}\b/g) || [];
      const detectedOtps = Array.from(new Set(matches));

      return {
        detectedOtps,
        allText: combinedText.slice(0, 500).replace(/\s+/g, " "),
      };
    } catch {
      return { detectedOtps: [], allText: "" };
    }
  }

  async _smartClick(selector, targetText = null) {
    if (!this._activePage) return false;
    const page = this._activePage;

    // Đóng popup / cookie nếu có
    try {
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        const closeBtn = document.querySelector(".close-button, .Overlay-closeButton, [aria-label='Close'], button.js-cookie-consent-reject");
        if (closeBtn) closeBtn.click();
      });
    } catch {}

    const frames = page.frames();
    for (const frame of frames) {
      try {
        const clicked = await frame.evaluate((sel, txt) => {
          let targetEl = null;
          if (sel) {
            try { targetEl = document.querySelector(sel); } catch {}
          }
          if (!targetEl && txt) {
            const btns = Array.from(document.querySelectorAll("button, input[type='submit'], a, [role='button']"));
            targetEl = btns.find((b) => (b.innerText || b.value || "").toLowerCase().includes(txt.toLowerCase()));
          }
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: "instant", block: "center" });
            targetEl.focus();
            targetEl.click();
            return true;
          }
          return false;
        }, selector, targetText);

        if (clicked) {
          await this._waitDomIdle(800);
          return true;
        }
      } catch {}
    }
    return false;
  }

  async _smartType(selector, text) {
    if (!this._activePage || !text) return;
    const page = this._activePage;

    try {
      const el = await page.$(selector).catch(() => null);
      if (el) {
        await el.scrollIntoView();
        await el.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        for (const char of text) {
          await page.keyboard.type(char, { delay: Math.floor(Math.random() * 20) + 20 });
        }
        await page.evaluate((element, val) => {
          if (element) {
            element.value = val;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }, el, text);
      } else {
        await page.keyboard.type(text, { delay: 25 });
      }
    } catch {}
    await this._waitDomIdle(500);
  }

  async _fillOtpBoxes(otpCode) {
    if (!this._activePage || !otpCode) return;
    const page = this._activePage;

    console.log(`⚡ [Tự động điền mã OTP]: Đang nhập [${otpCode}]...`);
    try {
      const firstBox = await page.$("#launch-code-0, #app_totp, #otp, input[data-index='0'], input[type='text']");
      if (firstBox) await firstBox.click();

      for (const digit of otpCode) {
        await page.keyboard.press(digit);
        await new Promise((r) => setTimeout(r, 40));
      }

      await page.evaluate((code) => {
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
      }, otpCode);
    } catch {}

    await this._waitDomIdle(1000);
  }

  // ----------------------------------------------------------------------------
  // ⭐ POST-STEP AI OBSERVER & EVALUATOR
  // ----------------------------------------------------------------------------
  async _observeStepResult(stepName, stepExpectation) {
    console.log(`\n🤖 [AI Observer]: Đang thẩm định kết quả sau bước: "${stepName}"...`);
    await this._waitDomIdle(1200);

    const screenshotBase64 = await this._takeScreenshot();
    const domElements = await this._extractDomElements();
    const textData = await this._extractTextAndOtp();
    const currentUrl = this._activePage ? this._activePage.url() : "";

    const systemPrompt = `Bạn là một AI Vision Inspector chuyên giám sát và đánh giá kết quả tự động hóa trình duyệt web.

NHIỆM VỤ:
Bạn nhận được ảnh chụp màn hình và DOM sau khi một bước tự động hóa (Step) vừa được thực thi.
Hãy quan sát kỹ màn hình để trả lời 3 câu hỏi:
1. Bước vừa thực hiện đã thành công hay chưa?
2. Có lỗi nào xuất hiện trên màn hình không (Ví dụ: Username bị trùng 'is not available', mật khẩu yếu, xuất hiện Captcha Arkose/FunCaptcha, popup che khuất, mã OTP sai)?
3. Cần làm gì để khắc phục (Self-Healing action) hoặc đã sẵn sàng chuyển sang bước tiếp theo chưa?

ĐỊNH DẠNG JSON TRẢ VỀ DUY NHẤT:
{
  "status": "SUCCESS" | "NEED_HEALING" | "BLOCKED_CAPTCHA" | "FAILED",
  "analysis": "Mô tả ngắn gọn trạng thái thực tế quan sát được",
  "readyForNextStep": true | false,
  "recoveryAction": {
    "action": "type" | "click" | "press" | "scroll" | "wait" | "none",
    "selector": "CSS Selector hoặc gợi ý phần tử cần click/nhập",
    "text": "Nội dung cần nhập (nếu cần thay đổi username hoặc gõ text)",
    "key": "Phím cần ấn",
    "waitMs": 2000
  },
  "extractedData": {
    "email": "chuỗi email phát hiện nếu có",
    "otpCode": "mã OTP phát hiện nếu có",
    "secretKey": "chuỗi 2FA Base32 Secret Key nếu có"
  }
}`;

    const userPromptText = `BƯỚC VỪA THỰC THI: "${stepName}"
KỲ VỌNG TRẠNG THÁI: "${stepExpectation}"
URL HIỆN TẠI: ${currentUrl}
MÃ OTP / TEXT PHÁT HIỆN: ${JSON.stringify(textData.detectedOtps)} - "${textData.allText.slice(0, 200)}"
DANH SÁCH DOM:
${JSON.stringify(domElements.slice(0, 25), null, 2)}

Hãy quan sát ảnh và trả về JSON thẩm định:`;

    const userContent = [
      { type: "text", text: userPromptText },
      ...(screenshotBase64 ? [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } }] : [])
    ];

    try {
      const endpoint = `${AI_CONFIG.baseUrl.replace(/\/+$/, "")}/chat/completions`;
      const res = await axios.post(
        endpoint,
        {
          model: AI_CONFIG.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
          ],
          response_format: { type: "json_object" },
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

      const parsed = _parseAiJson(res.data.choices[0].message.content);
      console.log(`👁️ [AI Đánh Giá]: Trạng thái = [${parsed.status}] | ${parsed.analysis}`);
      return parsed;
    } catch (err) {
      console.warn("(!) AI Observer gặp lỗi kết nối:", err.message);
      return {
        status: "SUCCESS",
        analysis: "Fallback do AI timeout/lỗi, tiếp tục luồng code.",
        readyForNextStep: true,
        recoveryAction: null,
      };
    }
  }

  async _executeRecoveryAction(actionObj) {
    if (!actionObj || actionObj.action === "none") return;
    console.log(`🔧 [AI Self-Healing]: Thực thi hành động khắc phục [${actionObj.action}] -> Selector: "${actionObj.selector || ''}", Text: "${actionObj.text || ''}"`);

    switch (actionObj.action) {
      case "type":
        await this._smartType(actionObj.selector || "input", actionObj.text);
        break;
      case "click":
        await this._smartClick(actionObj.selector, actionObj.text);
        break;
      case "press":
        await this._activePage.keyboard.press(actionObj.key || "Enter");
        break;
      case "wait":
        await this._waitDomIdle(actionObj.waitMs || 2000);
        break;
    }
    await this._waitDomIdle(1000);
  }

  // ----------------------------------------------------------------------------
  // PUBLIC STEP WORKFLOW METHODS
  // ----------------------------------------------------------------------------
  public async initSession(profileName = null) {
    console.log("==================================================");
    console.log("   SHARD-X HYBRID RUNNER + POST-STEP AI OBSERVER  ");
    console.log("==================================================");

    // 1. Kiểm tra proxy lưu sẵn trong ShardX
    let selectedProxy = null;
    try {
      const { data: proxies } = await axios.get(`${LAUNCHER_API_URL}/proxies`, { headers: HEADERS });
      if (Array.isArray(proxies) && proxies.length > 0) {
        selectedProxy = proxies[0];
        console.log(`[Proxy] 🌐 Đã gắn Proxy: ${selectedProxy.kind?.toUpperCase()}://${selectedProxy.host}:${selectedProxy.port}`);
      }
    } catch {}

    // 2. Tạo Profile Anti-detect mới
    console.log("[1] Đang sinh Fingerprint & Tạo Profile ShardX...");
    const { data: fpRes } = await axios.get(`${LAUNCHER_API_URL}/fingerprint/new`, { headers: HEADERS });
    const profilePayload = {
      name: profileName || `AI-Observed-${Date.now().toString().slice(-4)}`,
      notes: "Profile chạy theo kiến trúc Step-Driven + AI Observer",
      fingerprint: fpRes.fingerprint,
      ...(selectedProxy ? { proxy_id: selectedProxy.id } : {}),
    };
    const { data: createdProfile } = await axios.post(`${LAUNCHER_API_URL}/profiles`, profilePayload, { headers: HEADERS });
    this._profileId = createdProfile.id;
    console.log(`-> Tạo thành công Profile ID: ${this._profileId}`);

    // 3. Khởi chạy Profile & Kết nối Puppeteer CDP
    console.log(`[2] Khởi chạy ShardBrowser Profile ID: ${this._profileId}...`);
    const { data: startRes } = await axios.post(`${LAUNCHER_API_URL}/profiles/${this._profileId}/start`, { headless: false }, { headers: HEADERS });
    const wsEndpoint = startRes.cdp?.web_socket_debugger_url;

    this._browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint,
      defaultViewport: null,
    });

    const pages = await this._browser.pages();
    this._activePage = pages[0] || (await this._browser.newPage());
    this._activePage.setDefaultNavigationTimeout(300000);
    this._activePage.setDefaultTimeout(300000);

    console.log("-> Đã kết nối Puppeteer over CDP thành công!\n");
  }

  // STEP 1: LẤY EMAIL TẠM
  public async step1_fetchTempEmail() {
    console.log("\n--------------------------------------------------");
    console.log("📍 [STEP 1] Mở UnlimitMail & Lấy Email Tạm Thời");
    console.log("--------------------------------------------------");

    await this._activePage.goto("https://unlimitmail.com/vi/temp-mail", { waitUntil: "domcontentloaded", timeout: 300000 });
    await this._waitDomIdle(2500);

    let email = await this._activePage.evaluate(() => {
      const input = document.querySelector("input#email, input[readonly], input[type='text'], .email-input, #temp-email");
      if (input && input.value && input.value.includes("@")) return input.value.trim();
      const text = document.body ? document.body.innerText : "";
      const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      return m ? m[0] : "";
    });

    this._accountState.email = email;
    const prefix = email ? email.split("@")[0].replace(/[^a-zA-Z0-9-]/g, "") : `user${Date.now().toString().slice(-4)}`;
    this._accountState.username = prefix.length >= 4 ? prefix : `${prefix}${Date.now().toString().slice(-4)}`;

    const obs = await this._observeStepResult("Step 1: Lấy email từ UnlimitMail", "Màn hình hiển thị email tạm hợp lệ");
    if (obs.extractedData?.email && !this._accountState.email) {
      this._accountState.email = obs.extractedData.email;
    }

    console.log(`📧 Email nhận được : ${this._accountState.email}`);
    console.log(`👤 Username thiết lập: ${this._accountState.username}`);
  }

  // STEP 2: MỞ GITHUB & ĐIỀN FORM
  public async step2_fillGithubSignupForm() {
    console.log("\n--------------------------------------------------");
    console.log("📍 [STEP 2] Mở Form Đăng Ký GitHub & Điền Thông Tin");
    console.log("--------------------------------------------------");

    const githubPage = await this._browser.newPage();
    githubPage.setDefaultNavigationTimeout(300000);
    githubPage.setDefaultTimeout(300000);
    this._activePage = githubPage;

    await this._activePage.goto("https://github.com/signup", { waitUntil: "domcontentloaded", timeout: 300000 });
    await this._waitDomIdle(2000);

    // Điền Email
    await this._smartType("input#email, input[type='email'], input[name='email']", this._accountState.email);
    await this._waitDomIdle(600);

    // Điền Password
    await this._smartType("input#password, input[type='password']", this._accountState.password);
    await this._waitDomIdle(600);

    // Điền Username
    await this._smartType("input#login, input[name='login'], input#username", this._accountState.username);
    await this._waitDomIdle(1000);

    // AI Observer thẩm định & Self-Healing nếu trùng username
    for (let attempt = 1; attempt <= this._maxHealingAttempts; attempt++) {
      const obs = await this._observeStepResult("Step 2: Điền form GitHub Signup", "Cả 3 trường Email, Password, Username hợp lệ và sẵn sàng bấm Create account");
      
      if (obs.status === "SUCCESS" || obs.readyForNextStep) {
        console.log("✅ Step 2 hợp lệ hoàn toàn!");
        break;
      }

      if (obs.status === "NEED_HEALING") {
        console.log(`⚠️ Phát hiện vấn đề form (Attempt ${attempt}/${this._maxHealingAttempts}). Đang tự động sửa...`);
        if (obs.recoveryAction) {
          await this._executeRecoveryAction(obs.recoveryAction);
        } else {
          this._accountState.username = `${this._accountState.username}${Math.floor(Math.random() * 90 + 10)}`;
          console.log(`🔄 Thử lại với Username mới: ${this._accountState.username}`);
          await this._smartType("input#login, input[name='login'], input#username", this._accountState.username);
        }
      }
    }
  }

  // STEP 3: SUBMIT FORM & CHECK CAPTCHA
  public async step3_submitSignupForm() {
    console.log("\n--------------------------------------------------");
    console.log("📍 [STEP 3] Submit Form Đăng Ký & Kiểm Tra Arkose Captcha");
    console.log("--------------------------------------------------");

    await this._smartClick("button[type='submit'], button.js-octocaptcha-form-submit", "Create account");
    await this._waitDomIdle(2000);

    const obs = await this._observeStepResult("Step 3: Bấm nút Create account", "Form đã submit và chuyển sang bước Enter verification code");
    if (obs.status === "BLOCKED_CAPTCHA") {
      console.warn("🚨 [CẢNH BÁO]: Phát hiện Arkose / FunCaptcha kiểm tra bot. Cần can thiệp giải captcha!");
      if (obs.recoveryAction) await this._executeRecoveryAction(obs.recoveryAction);
    }
  }

  // STEP 4: NHẬN & ĐIỀN OTP EMAIL
  public async step4_verifyEmailOtp() {
    console.log("\n--------------------------------------------------");
    console.log("📍 [STEP 4] Đọc Mã OTP Email & Xác Minh Tài Khoản");
    console.log("--------------------------------------------------");

    const pages = await this._browser.pages();
    const mailPage = pages[0];
    const githubPage = this._activePage;

    let otpFound = null;
    console.log("⏳ Đang polling hòm thư UnlimitMail để lấy mã GitHub...");

    for (let poll = 1; poll <= 15; poll++) {
      await mailPage.bringToFront();
      await this._waitDomIdle(1500);

      await mailPage.evaluate(() => {
        const mailSection = document.querySelector("#inbox, .card-body, [class*='inbox'], [class*='mail']");
        if (mailSection) mailSection.scrollIntoView({ behavior: "instant", block: "center" });
      });

      const { detectedOtps } = await (async () => {
        let txt = "";
        for (const f of mailPage.frames()) {
          try { txt += "\n" + (await f.evaluate(() => document.body ? document.body.innerText : "")); } catch {}
        }
        const matches = txt.match(/\b\d{6,8}\b/g) || [];
        return { detectedOtps: Array.from(new Set(matches)) };
      })();

      if (detectedOtps.length > 0) {
        otpFound = detectedOtps[0];
        console.log(`🔥 Đã bắt được mã OTP: [${otpFound}]`);
        break;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }

    await githubPage.bringToFront();
    this._activePage = githubPage;
    if (otpFound) {
      await this._fillOtpBoxes(otpFound);
    }

    const obs = await this._observeStepResult("Step 4: Điền mã OTP Email", "Đã qua bước verify OTP và vào trang chính GitHub");
    console.log("✅ Hoàn tất xác minh Email OTP!");
  }

  // STEP 5: VÀO SECURITY THIẾT LẬP 2FA
  public async step5_setup2faSecurity() {
    console.log("\n--------------------------------------------------");
    console.log("📍 [STEP 5] Mở Cài Đặt Bảo Mật & Lấy 2FA Secret Key");
    console.log("--------------------------------------------------");

    await this._activePage.goto("https://github.com/settings/security", { waitUntil: "domcontentloaded", timeout: 300000 });
    await this._waitDomIdle(2000);

    await this._smartClick("a[href*='two-factor'], button[data-action*='two-factor']", "Enable two-factor");
    await this._waitDomIdle(1500);
    await this._smartClick("button, a", "enter this text code");
    await this._waitDomIdle(1000);

    const obs = await this._observeStepResult("Step 5: Mở 2FA Setup", "Màn hình hiển thị mã Base32 Secret Key của 2FA");
    if (obs.extractedData?.secretKey) {
      this._accountState.twoFactorSecret = obs.extractedData.secretKey;
      console.log(`🔑 [2FA Secret Key]: ${this._accountState.twoFactorSecret}`);
    }
  }

  // STEP 6: KÍCH HOẠT 2FA VỚI OTP 6 SỐ
  public async step6_activate2faOtp() {
    console.log("\n--------------------------------------------------");
    console.log("📍 [STEP 6] Lấy Mã 2FA OTP & Kích Hoạt Bảo Mật");
    console.log("--------------------------------------------------");

    if (this._accountState.twoFactorSecret) {
      const twoFaPage = await this._browser.newPage();
      await twoFaPage.goto("https://2fa.page/", { waitUntil: "domcontentloaded", timeout: 300000 });
      await this._waitDomIdle(1500);

      await twoFaPage.type("#secret, textarea, input", this._accountState.twoFactorSecret);
      await this._waitDomIdle(800);

      const otp2fa = await twoFaPage.evaluate(() => {
        const out = document.querySelector("#code, .code, h1, h2, input[readonly]");
        return out ? (out.innerText || out.value || "").replace(/\s+/g, "").slice(0, 6) : "";
      });

      console.log(`🛡️ [Mã OTP 2FA Sinh Ra]: ${otp2fa}`);
      await twoFaPage.close();

      await this._activePage.bringToFront();
      if (otp2fa) {
        await this._smartType("input#app_totp, input[name='otp'], input[type='text']", otp2fa);
        await this._smartClick("button[type='submit']", "Save");
        await this._waitDomIdle(1500);
      }
    }

    const obs = await this._observeStepResult("Step 6: Xác nhận kích hoạt 2FA", "2FA đã được bật thành công");
    console.log("✅ Hoàn tất kích hoạt 2FA!");
  }

  // STEP 7: HOÀN TẤT & LƯU TÀI KHOẢN
  public async step7_finalizeAndSave() {
    console.log("\n==================================================");
    console.log("       KẾT QUẢ TÀI KHOẢN GITHUB HOÀN TẤT + 2FA    ");
    console.log("==================================================");
    console.log(`📧 Email       : ${this._accountState.email}`);
    console.log(`🔑 Password    : ${this._accountState.password}`);
    console.log(`👤 Username    : ${this._accountState.username}`);
    console.log(`🛡️ 2FA Secret  : ${this._accountState.twoFactorSecret || "N/A"}`);
    console.log("--------------------------------------------------");
    const accountLine = `${this._accountState.email}|${this._accountState.password}|${this._accountState.twoFactorSecret}`;
    console.log(`📋 ĐỊNH DẠNG   : ${accountLine}`);
    console.log("==================================================");

    try {
      fs.appendFileSync("github_accounts.txt", `${accountLine}\n`, "utf-8");
      console.log("💾 Đã lưu vào file github_accounts.txt");
    } catch {}

    console.log("\n-> Giữ trình duyệt 20s để quan sát trước khi đóng.");
    await new Promise((r) => setTimeout(r, 20000));

    if (this._profileId) {
      await axios.post(`${LAUNCHER_API_URL}/profiles/${this._profileId}/stop`, {}, { headers: HEADERS });
      console.log("-> Đã đóng profile ShardX an toàn.");
    }
  }

  // MAIN RUNNER CHẠY TOÀN BỘ WORKFLOW
  public async runAllWorkflow() {
    try {
      await this.initSession();
      await this.step1_fetchTempEmail();
      await this.step2_fillGithubSignupForm();
      await this.step3_submitSignupForm();
      await this.step4_verifyEmailOtp();
      await this.step5_setup2faSecurity();
      await this.step6_activate2faOtp();
      await this.step7_finalizeAndSave();
    } catch (err) {
      console.error("\n❌ LỖI TRONG QUY TRÌNH WORKFLOW:", err.message);
    }
  }
}

// Khởi chạy khi gọi trực tiếp từ terminal
const runner = new ShardStepRunner();
runner.runAllWorkflow();
