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
import { TotpClient } from "./totp_client.js";
import { ProxyXoayClient } from "./proxyxoay_client.js";

// ==============================================================================
// 1. CẤU HÌNH HỆ THỐNG
// ==============================================================================
const LAUNCHER_API_URL = process.env.LAUNCHER_API_URL || "http://127.0.0.1:40325";
const LAUNCHER_API_TOKEN = process.env.LAUNCHER_API_TOKEN || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaGFyZHgtYXBpIiwiaWF0IjoxNzg3MTI4NjE5LCJleHAiOjIxMDI0ODg2MTl9.Y44-0maSpd_9e7_U3yLPHgvFb1O2_GBHReb6qs0H2p0";

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
  _gmailClient = null;
  _mailTm = null;
  _activeEmailService = "gmail";
  _totp = null;
  _proxyXoay = null;
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
    this._launcherApiUrl = LAUNCHER_API_URL;
    this._launcherToken = LAUNCHER_API_TOKEN;
    this._headers = { Authorization: `Bearer ${this._launcherToken}` };
    this._gmailClient = new GmailCreatorClient(customConfig.rapidApiKey);
    this._mailTm = new MailTmClient();
    this._totp = new TotpClient();
    this._proxyXoay = new ProxyXoayClient();
    const sessionSuffix = Date.now().toString().slice(-4);
    this._accountState.password = customConfig.password || `ShardX@2026!Pass#${sessionSuffix}`;
  }

  // Helper chờ an toàn
  _safeSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Độ trễ ngẫu nhiên mô phỏng người thật gõ phím
  _randomDelay(min = 35, max = 80) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Bọc thực thi promise với timeout an toàn chống treo
  async _evalWithTimeout(promise, ms = 3000) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(null), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
  }

  // Di chuột tự nhiên mô phỏng người dùng
  async _humanMouseMove(page, targetX, targetY) {
    if (!page || page.isClosed() || !targetX || !targetY) return;
    try {
      await page.mouse.move(targetX, targetY, { steps: 6 });
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
        window.scrollBy({ top: 400, behavior: "smooth" });
      }
    }, isUp).catch(() => {});
    await this._safeSleep(600);
  }

  // Tự động đóng Cookie Banner an toàn
  async _detectAndCloseOverlays(page) {
    if (!page || page.isClosed()) return;
    try {
      await page.evaluate(() => {
        const cookieSelectors = [
          "button.js-cookie-consent-reject",
          "button.js-cookie-consent-accept",
          "button[data-cookie-banner-action='reject']",
          "button[data-cookie-banner-action='accept']",
          "#accept-cookie-banner",
          ".Overlay-closeButton",
          "[aria-label='Close']"
        ];
        cookieSelectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            try { el.click(); } catch {}
          });
        });

        // Tìm nút có text Accept / Reject
        const allButtons = Array.from(document.querySelectorAll("button, a, [role='button']"));
        for (const btn of allButtons) {
          const txt = (btn.innerText || btn.textContent || "").trim().toLowerCase();
          if (txt === "accept" || txt === "reject" || txt === "accept all" || txt === "reject all" || txt === "i accept") {
            try {
              btn.click();
            } catch {}
          }
        }

        // Ẩn banner cookie container
        const banners = Array.from(document.querySelectorAll("div, section, aside")).filter((el) => {
          const txt = (el.innerText || "").toLowerCase();
          return txt.includes("we use optional cookies") || txt.includes("cookie preferences") || txt.includes("cookie-consent");
        });
        banners.forEach((b) => {
          try {
            b.style.display = "none";
            b.remove();
          } catch {}
        });
      });
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

      // Dispatch đầy đủ sự kiện input, change, blur
      await page.evaluate((element, val) => {
        if (element) {
          element.value = val;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          element.dispatchEvent(new Event("blur", { bubbles: true }));
        }
      }, el, textToType).catch(() => {});

      await this._safeSleep(500);

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
        await this._safeSleep(1000);
        return true;
      }
    } catch {}

    return false;
  }

  // Bấm vào phần tử có văn bản hiển thị
  async _clickVisibleText(page, textToFind) {
    if (!page || page.isClosed()) return false;
    return this._clickElementOrText(page, textToFind);
  }

  // Điền mã OTP vào GitHub
  async _fillOtpDigits(page, otpCode) {
    if (!page || page.isClosed() || !otpCode) return false;
    const cleanCode = String(otpCode).trim();
    console.log(`⚡ [OTP Filling] Đang nhập mã OTP [${cleanCode}] vào GitHub...`);

    try {
      const digitInputs = await page.$$('[data-testid="otp-digit"], input[id^="launch-code-"], input[data-index]');
      if (digitInputs && digitInputs.length > 0) {
        for (let i = 0; i < Math.min(digitInputs.length, cleanCode.length); i++) {
          try {
            await digitInputs[i].click({ clickCount: 3 });
            await digitInputs[i].type(cleanCode[i], { delay: this._randomDelay(40, 80) });
          } catch {}
        }
      }

      await page.evaluate((code) => {
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

        const singleOtp = document.querySelector("#app_totp, #otp, input[name='otp'], input[autocomplete='one-time-code']");
        if (singleOtp) {
          singleOtp.value = code;
          singleOtp.dispatchEvent(new Event("input", { bubbles: true }));
          singleOtp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, cleanCode).catch(() => {});

      await this._safeSleep(1000);
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

  // Đọc danh sách proxy từ proxies.json cục bộ để lấy đầy đủ username và password
  _loadLocalProxies() {
    try {
      const roamingPath = path.join(os.homedir(), "AppData", "Roaming", "shardx-launcher", "proxies.json");
      if (existsSync(roamingPath)) {
        const data = JSON.parse(readFileSync(roamingPath, "utf8"));
        return data.proxies || [];
      }
    } catch {}
    return [];
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

      // BƯỚC 0: TỰ ĐỘNG XÓA SẠCH TOÀN BỘ PROFILE CŨ TRONG SHARDBROWSER
      await this._deleteAllOldProfiles();

      // BƯỚC 1: LẤY PROXY KÈM ĐẦY ĐỦ USERNAME & PASSWORD TỪ SHARDBROWSER
      let chosenProxy = null;
      try {
        const localList = this._loadLocalProxies();
        if (Array.isArray(localList) && localList.length > 0) {
          if (options.proxyId) {
            chosenProxy = localList.find(p => p.id === options.proxyId);
          }
          if (!chosenProxy) {
            chosenProxy = localList[Math.floor(Math.random() * localList.length)];
          }
          this._activeProxy = chosenProxy;
          const authInfo = chosenProxy.username ? ` | User: ${chosenProxy.username}` : " | No Auth";
          console.log(`🌐 [Proxy ShardX] Đã chọn Proxy: [${chosenProxy.name || chosenProxy.host}] (${chosenProxy.kind || 'http'}://${chosenProxy.host}:${chosenProxy.port}${authInfo}) | Country: ${chosenProxy.country || 'N/A'}`);
        } else {
          const { data: proxies } = await axios.get(`${this._launcherApiUrl}/proxies`, { headers: this._headers, timeout: 3000 });
          if (Array.isArray(proxies) && proxies.length > 0) {
            chosenProxy = proxies[Math.floor(Math.random() * proxies.length)];
            this._activeProxy = chosenProxy;
          }
        }
      } catch (proxyErr) {
        console.log(`🌐 [Network] Chạy IP Direct (${proxyErr.message}).`);
      }

      // BƯỚC 2: SINH BỘ FINGERPRINT WINDOWS ĐỒNG NHẤT (CANVAS/WEBGL/AUDIO NOISE)
      console.log("🛡️ [Fingerprint Isolation] Đang sinh Fingerprint Windows đồng nhất (Canvas/WebGL/Audio Noise)...");
      const { data: fpRes } = await axios.get(`${this._launcherApiUrl}/fingerprint/new/windows`, { headers: this._headers, timeout: 4000 });
      
      // BƯỚC 3: TẠO PROFILE MỚI THUỘC NHÓM 'GitHub-Auto'
      const sessionSuffix = Date.now().toString().slice(-4);
      const profilePayload = {
        name: `SHARDX-AUTO-${sessionSuffix}`,
        folder: "GitHub-Auto",
        notes: `Tách biệt hoàn toàn | Proxy: ${chosenProxy ? chosenProxy.proxyString || `${chosenProxy.host}:${chosenProxy.port}` : 'Direct'} | Time: ${new Date().toLocaleTimeString()}`,
        proxy: chosenProxy ? (chosenProxy.proxyString || `http://${chosenProxy.host}:${chosenProxy.port}`) : null,
        proxy_id: chosenProxy?.id || null,
        fingerprint: fpRes.fingerprint,
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

    throw new Error("Không tìm thấy kết nối trình duyệt. Hãy bật ShardX Launcher hoặc khởi chạy Chrome với --remote-debugging-port=9222.");
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
      const pages = await this._browser.pages();
      const firstPage = pages[0] || (await this._browser.newPage());
      firstPage.setDefaultNavigationTimeout(120000);
      firstPage.setDefaultTimeout(120000);

      // Tự động xác thực Proxy Authentication nếu proxy có User & Password
      const applyProxyAuth = async (p) => {
        if (!p || p.isClosed()) return;
        if (this._activeProxy && (this._activeProxy.username || this._activeProxy.user) && (this._activeProxy.password || this._activeProxy.pass)) {
          const u = this._activeProxy.username || this._activeProxy.user;
          const pwd = this._activeProxy.password || this._activeProxy.pass;
          try {
            await p.authenticate({ username: u, password: pwd });
            console.log(`🔐 [Proxy Auth] Đã nạp xác thực Proxy thành công cho tài khoản [${u}].`);
          } catch (authErr) {
            console.warn(`(!) Lỗi authenticate proxy: ${authErr.message}`);
          }
        }
      };

      await applyProxyAuth(firstPage);

      // Tự động áp dụng xác thực Proxy cho tất cả các tab mới
      this._browser.on("targetcreated", async (target) => {
        try {
          const newP = await target.page();
          if (newP) await applyProxyAuth(newP);
        } catch {}
      });

      // 2. Khởi tạo Email Thật @gmail.com qua GmailCreatorClient (Bảo đảm 100% không bị suspended)
      console.log("\n[Bước 1] Khởi tạo Email @gmail.com thật từ RapidAPI...");
      const acc = await this._gmailClient.createAccount();
      this._activeEmailService = "gmail";
      this._accountState.email = acc.address;
      this._accountState.username = acc.username;
      console.log(`📧 [Gmail Tạo Lập]: ${this._accountState.email}`);
      console.log(`👤 [Username Tạo lập]: ${this._accountState.username}`);

      // 3. Mở Form Đăng ký GitHub (https://github.com/signup?source=login)
      console.log("\n[Bước 2] Mở Form Đăng ký GitHub https://github.com/signup?source=login...");
      this._githubPage = firstPage;
      this._githubPage.setDefaultNavigationTimeout(120000);
      this._githubPage.setDefaultTimeout(120000);

      const maxRetries = 10;
      let isFormReady = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`⏳ [Tải trang Đăng ký] Lần thử ${attempt}/${maxRetries}...`);
          if (attempt === 1) {
            await this._githubPage.goto("https://github.com/signup?source=login", {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            });
          } else {
            console.log(`🔄 [Reload trang] Chờ 5s và tải lại trang đăng ký GitHub (Lần ${attempt})...`);
            await this._safeSleep(5000);
            await this._githubPage.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(async () => {
              await this._githubPage.goto("https://github.com/signup?source=login", { waitUntil: "domcontentloaded", timeout: 60000 });
            });
          }

          // Chờ mạng ổn định và xử lý overlay nếu có
          await this._safeSleep(3000);
          await this._detectAndCloseOverlays(this._githubPage);

          // Kiểm tra nếu bị trang chặn Rate-Limit
          const blockText = await this._githubPage.evaluate(() => {
            const body = document.body ? document.body.innerText : "";
            if (body.includes("Truy cập tạm thời bị hạn chế") || body.includes("Access restricted") || body.includes("robot on the same network")) {
              return body;
            }
            return null;
          }).catch(() => null);

          if (blockText) {
            console.warn("\n⚠️ [CẢNH BÁO RATE-LIMIT]: IP hiện tại đang bị GitHub hạn chế tạm thời do tạo tài khoản liên tiếp!");
            console.warn("💡 [Giải pháp]: Đổi sang 1 Proxy khác trong ShardBrowser hoặc chờ 3 - 5 phút để IP tự giải phóng.");
            throw new Error("GitHub tạm thời hạn chế truy cập từ IP này (Rate Limit). Vui lòng đổi Proxy mới!");
          }

          // Chờ ô email xuất hiện (Timeout 25s mỗi lần thử)
          await this._githubPage.waitForSelector("#email, input[type='email'], input[name='user[email]'], input[autocomplete='email']", {
            visible: true,
            timeout: 25000,
          });

          isFormReady = true;
          console.log("✅ [Trang Sẵn Sàng] Form đăng ký GitHub đã tải hoàn tất!");
          break;
        } catch (loadErr) {
          if (loadErr.message.includes("Rate Limit")) throw loadErr;
          console.warn(`⚠️ [Thử lại ${attempt}/${maxRetries}] Chưa thấy ô nhập Email (${loadErr.message}).`);
          await this._safeSleep(4000);
        }
      }

      if (!isFormReady) {
        throw new Error("Không thể tải form đăng ký GitHub (Do Proxy hoặc mạng quá chậm/Bị Rate Limit).");
      }

      // 4. Điền Form Đăng Ký GitHub Theo Quy Trình Single-Page Chuẩn Xác (Human-like)
      console.log("\n[Bước 3] Thực hiện điền form đăng ký GitHub (Human-like với delay 1.5s mỗi bước)...");

      // 4.1 Điền Email
      console.log(`-> 1. Nhập Email: ${this._accountState.email}`);
      await this._humanType(this._githubPage, "#email, input[type='email'], input[name='user[email]'], input[autocomplete='email']", this._accountState.email, false);
      await this._safeSleep(1500);

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
      await this._safeSleep(1500);

      // 4.3 Điền Username
      console.log(`-> 3. Nhập Username: ${this._accountState.username}`);
      await this._githubPage.waitForSelector("#login, input[name='user[login]']", { visible: true, timeout: 20000 });
      await this._humanType(this._githubPage, "#login, input[name='user[login]']", this._accountState.username, false);
      await this._safeSleep(1500);

      // Kiểm tra nếu username bị trùng
      let isUsernameTaken = await this._githubPage.evaluate(() => {
        const text = document.body ? document.body.innerText : "";
        return text.includes("is not available") || text.includes("is already taken");
      }).catch(() => false);

      if (isUsernameTaken) {
        this._accountState.username = `${this._accountState.username}${Date.now().toString().slice(-4)}`;
        console.log(`🔄 [Username Thay thế]: ${this._accountState.username}`);
        await this._humanType(this._githubPage, "#login, input[name='user[login]']", this._accountState.username, false);
        await this._safeSleep(1500);
      }

      // 4.4 Chờ validation hoàn tất và kiểm tra lại Email lần 2
      console.log("-> 4. Chờ 1.5s để GitHub kiểm tra tính hợp lệ của toàn bộ Form...");
      await this._safeSleep(1500);

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
        await this._safeSleep(1200);
      }

      // Nếu ô Email bị thiếu, điền bù
      if (!formValues.emailVal) {
        console.warn("⚠️ [Email Đang Rỗng] Kích hoạt điền bù Email ngay lập tức...");
        await this._humanType(this._githubPage, "#email, input[type='email'], input[name='user[email]'], input[autocomplete='email']", this._accountState.email, false);
        await this._safeSleep(1200);
      }

      // Nếu ô Username bị thiếu, điền bù
      if (!formValues.loginVal) {
        console.warn("⚠️ [Username Đang Rỗng] Kích hoạt điền bù Username ngay lập tức...");
        await this._humanType(this._githubPage, "#login, input[name='user[login]']", this._accountState.username, false);
        await this._safeSleep(1200);
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
      
      let isMovedToVerify = false;
      const submitStartTime = Date.now();
      const maxSubmitWaitMs = 60000; // 60s cho bước chuyển tiếp form

      while (Date.now() - submitStartTime < maxSubmitWaitMs) {
        if (!this._githubPage || this._githubPage.isClosed()) break;

        const currentUrl = this._githubPage.url();
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

        // Nếu vẫn còn kẹt ở trang signup -> Kích hoạt click lại 'Create account'
        console.log(`⏳ [Kiểm Tra URL] Vẫn ở trang đăng ký (${currentUrl}). Tiến hành cuộn và click lại 'Create account'...`);
        
        await this._detectAndCloseOverlays(this._githubPage);
        await this._smartScroll(this._githubPage, "down");
        await this._safeSleep(600);

        // 1. Thử click qua DOM evaluate
        await this._githubPage.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']"));
          const createBtn = buttons.find(b => {
            const txt = (b.innerText || b.value || b.textContent || "").trim().toLowerCase();
            return txt.includes("create account");
          });
          if (createBtn) {
            createBtn.scrollIntoView({ behavior: "smooth", block: "center" });
            createBtn.removeAttribute("disabled");
            createBtn.click();
          }
        }).catch(() => {});

        // 2. Thử click native Puppeteer
        try {
          const allButtons = await this._githubPage.$$("button, input[type='submit']");
          for (const btn of allButtons) {
            const text = await this._githubPage.evaluate(el => (el.innerText || el.value || el.textContent || "").trim().toLowerCase(), btn);
            if (text.includes("create account")) {
              await btn.evaluate(el => el.scrollIntoView({ behavior: "smooth", block: "center" }));
              await btn.click({ delay: 50 });
              break;
            }
          }
        } catch {}

        // 3. Nhấn Enter trên toàn form
        await this._githubPage.keyboard.press("Enter");

        // Chờ 5s để GitHub phản hồi trước khi kiểm tra lại vòng lặp
        await this._safeSleep(5000);
      }

      // 5. Chờ chuyển sang trang Nhập OTP (Hỗ trợ nếu có bước giải Captcha)
      console.log("\n[Bước 4] Đang theo dõi trạng thái màn hình OTP (Nếu có Captcha, hãy hoàn tất giải trên trình duyệt)...");
      let isOtpScreenReady = false;
      const maxOtpWaitTime = 90000; // 90s
      const otpWaitStart = Date.now();

      while (Date.now() - otpWaitStart < maxOtpWaitTime) {
        if (!this._githubPage || this._githubPage.isClosed()) break;

        const currentUrl = this._githubPage.url();
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

      // 6. Xác thực OTP Email trực tiếp từ Gmail API / Mail.tm REST API
      console.log(`\n[Bước 5] Đang lấy mã OTP trực tiếp từ ${this._activeEmailService === 'gmail' ? 'Gmail API' : 'Mail.tm'}...`);
      let result;
      if (this._activeEmailService === "gmail") {
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
        const secretsContent = `GitHub Email: ${this._accountState.email}\nUsername: ${this._accountState.username}\nPassword: ${this._accountState.password}\n2FA Secret: ${this._accountState.twoFactorSecret}\nProxy: ${this._activeProxy ? `${this._activeProxy.host}:${this._activeProxy.port}` : 'Direct'}\n\nRecovery Codes:\n${this._accountState.recoveryCodes.join("\n")}\n`;
        await writeFile("github-2fa-secrets.txt", secretsContent, "utf8");
        await chmod("github-2fa-secrets.txt", 0o600).catch(() => {});
        console.log("📁 Đã lưu thông tin bảo mật tại: github-2fa-secrets.txt");

        const outputPath = path.join(process.cwd(), "Testing", "git", "output.txt");
        let prefixNewline = "";
        if (existsSync(outputPath)) {
          const currentContent = readFileSync(outputPath, "utf8");
          if (currentContent.length > 0 && !currentContent.endsWith("\n")) {
            prefixNewline = "\n";
          }
        }
        const oneLineReport = `${prefixNewline}${this._accountState.email}|${this._accountState.password}|${this._accountState.twoFactorSecret}\n`;
        await appendFile(outputPath, oneLineReport, "utf8").catch(() => {});
        console.log("📁 Đã nối thêm tài khoản vào: Testing/git/output.txt");
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
  const runner = new AiAgentRunner();
  try {
    await runner.runFullE2EWorkflow({
      saveSecrets: true,
    });
  } catch (error) {
    console.error(`\n❌ [Lỗi Hệ Thống]: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("ai_agent_runner.js"))) {
  main();
}
