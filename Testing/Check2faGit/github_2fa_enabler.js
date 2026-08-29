/**
 * GITHUB 2FA ENABLER (AUTOMATION SUITE)
 * ==============================================================================
 * Module tự động hóa hoàn chỉnh:
 * 1. Kết nối qua Chrome DevTools Protocol (CDP) hoặc khởi tạo Puppeteer Browser.
 * 2. Cách ly phiên 100% bằng Incognito BrowserContext (chống dính cookie acc trước).
 * 3. Đăng nhập GitHub với thông tin Email + Password.
 * 4. Tự động nhận diện màn hình Device Verification & lấy mã OTP từ Hotmail qua Graph API.
 * 5. Điền OTP để hoàn tất đăng nhập.
 * 6. Điều hướng tới cài đặt bảo mật và kích hoạt 2FA (Authenticator App).
 * 7. Lấy Setup Secret Key, sinh mã TOTP xác nhận và trích xuất danh sách Recovery Codes.
 * 
 * Quy tắc đặt tên:
 * - Biến/Phương thức private/protected: _{name}
 * - Biến/Phương thức public: {nameValue}
 * ==============================================================================
 */

import puppeteer from "puppeteer-core";
import { TotpEngine } from "./totp_engine.js";
import { HotmailGraphHelper } from "./hotmail_graph_helper.js";

export class Github2faEnabler {
  // Private / Protected Properties
  _browser = null;
  _ownsBrowser = false;
  _totpEngine = null;
  _hotmailHelper = null;
  _options = {
    headless: false,
    cdpEndpoint: "",
    executablePath: "",
    timeoutMs: 60000,
  };

  /**
   * Khởi tạo class cấu hình 2FA cho GitHub
   * @param {HotmailGraphHelper} hotmailHelper - Đối tượng quản lý lấy OTP Hotmail
   * @param {object} options - Cấu hình trình duyệt
   */
  constructor(hotmailHelper, options = {}) {
    this._hotmailHelper = hotmailHelper || new HotmailGraphHelper();
    this._totpEngine = new TotpEngine();
    this._options = {
      headless: options.headless ?? false,
      cdpEndpoint: options.cdpEndpoint || "",
      executablePath: options.executablePath || this._findChromeExecutable(),
      timeoutMs: options.timeoutMs || 60000,
    };
  }

  // Tìm đường dẫn Google Chrome mặc định trên Windows
  _findChromeExecutable() {
    const candidatePaths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    ];

    for (const p of candidatePaths) {
      try {
        if (p && typeof p === "string") return p;
      } catch {}
    }
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  // Delay an toàn
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Random delay mô phỏng người thật
  _randomDelay(min = 35, max = 80) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Lấy nội dung text của trang
  async _getBodyText(page) {
    if (!page || page.isClosed()) return "";
    return page.evaluate(() => document.body?.innerText || "").catch(() => "");
  }

  // Click an toàn theo text
  async _clickVisibleButton(page, textArray) {
    if (!page || page.isClosed()) return false;
    const texts = Array.isArray(textArray) ? textArray : [textArray];

    return page.evaluate((wantedTexts) => {
      const normalize = (v) => (v || "").replace(/\s+/g, " ").trim().toLowerCase();
      const buttons = Array.from(document.querySelectorAll("button, a, input[type='submit'], summary, [role='button']"));

      for (const btn of buttons) {
        const txt = normalize(btn.innerText || btn.textContent || btn.value || "");
        for (const wanted of wantedTexts) {
          if (txt.includes(normalize(wanted))) {
            btn.scrollIntoView({ behavior: "smooth", block: "center" });
            btn.click();
            return true;
          }
        }
      }
      return false;
    }, texts).catch(() => false);
  }

  // Gõ phím mô phỏng người thật
  async _typeHuman(page, selector, text) {
    if (!page || page.isClosed()) return;
    await page.waitForSelector(selector, { visible: true, timeout: 15000 });
    const el = await page.$(selector);
    if (!el) throw new Error(`Không tìm thấy ô nhập: ${selector}`);

    await el.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await this._sleep(150);

    for (const char of String(text)) {
      await page.keyboard.type(char, { delay: this._randomDelay(25, 50) });
    }
  }

  // Điền mã OTP vào GitHub
  async _fillOtpDigits(page, otpCode) {
    if (!page || page.isClosed() || !otpCode) return false;
    const cleanCode = String(otpCode).trim();
    console.log(`⚡ [OTP] Đang điền mã OTP [ ${cleanCode} ] vào GitHub...`);

    // 1. Thử điền vào các ô digit đơn lẻ
    const digitInputs = await page.$$('[data-testid="otp-digit"], input[id^="launch-code-"], input[data-index]');
    if (digitInputs && digitInputs.length > 0) {
      for (let i = 0; i < Math.min(digitInputs.length, cleanCode.length); i++) {
        try {
          await digitInputs[i].click({ clickCount: 3 });
          await digitInputs[i].type(cleanCode[i], { delay: this._randomDelay(30, 60) });
        } catch {}
      }
    }

    // 2. Dispatch event trực tiếp để đảm bảo 100% không bị rỗng
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

    await this._sleep(1000);
    return true;
  }

  // ============================================================================
  // PUBLIC BROWSER MANAGEMENT
  // ============================================================================

  /**
   * Kết nối tới trình duyệt (CDP Port hoặc tự mở Chromium)
   * @param {string} cdpUrl - Tùy chọn WebSocket / HTTP Endpoint CDP (VD: http://127.0.0.1:9222)
   */
  async initBrowser(cdpUrl = "") {
    const endpoint = cdpUrl || this._options.cdpEndpoint;

    if (endpoint) {
      console.log(`🔌 [Browser] Đang kết nối tới trình duyệt qua CDP: ${endpoint}...`);
      this._browser = await puppeteer.connect({
        browserURL: endpoint.startsWith("http") ? endpoint : undefined,
        browserWSEndpoint: endpoint.startsWith("ws") ? endpoint : undefined,
        defaultViewport: null,
      });
      this._ownsBrowser = false;
      console.log("✅ Kết nối CDP thành công!");
    } else {
      console.log(`🚀 [Browser] Đang khởi chạy Puppeteer Browser...`);
      this._browser = await puppeteer.launch({
        executablePath: this._options.executablePath,
        headless: this._options.headless ? "new" : false,
        defaultViewport: null,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1280,800",
        ],
      });
      this._ownsBrowser = true;
      console.log("✅ Khởi chạy Browser thành công!");
    }

    return this._browser;
  }

  /**
   * Đóng trình duyệt
   */
  async closeBrowser() {
    if (this._browser && this._ownsBrowser) {
      await this._browser.close().catch(() => {});
    }
    this._browser = null;
  }

  // ============================================================================
  // PUBLIC 2FA ENABLING FLOW
  // ============================================================================

  /**
   * Thực hiện quy trình đăng nhập, nhận OTP email và bật 2FA cho 1 tài khoản
   * @param {string} email - Email tài khoản GitHub
   * @param {string} password - Mật khẩu tài khoản GitHub
   * @returns {Promise<{success: boolean, email: string, twoFactorSecret?: string, recoveryCodes?: Array<string>, error?: string, status?: string}>}
   */
  async processAccount(email, password) {
    if (!this._browser) {
      await this.initBrowser();
    }

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    console.log(`\n================================================================`);
    console.log(`🚀 [BẮT ĐẦU XỬ LÝ] Tài khoản: ${cleanEmail}`);
    console.log(`================================================================`);

    // TẠO INCOGNITO BROWSER CONTEXT ĐỂ CÁCH LY HOÀN TOÀN COOKIE/SESSION GIỮA CÁC TÀI KHOẢN
    let context = null;
    let page = null;

    try {
      if (this._ownsBrowser) {
        context = await this._browser.createBrowserContext();
        page = await context.newPage();
      } else {
        page = await this._browser.newPage();
        try {
          const client = await page.target().createCDPSession();
          await client.send("Network.clearBrowserCookies");
          await client.send("Network.clearBrowserCache");
        } catch {}
      }

      // ------------------------------------------------------------------------
      // BƯỚC 1: ĐĂNG NHẬP GITHUB
      // ------------------------------------------------------------------------
      console.log("📍 [Bước 1] Mở trang đăng nhập GitHub (https://github.com/login)...");
      await page.goto("https://github.com/login", { waitUntil: "domcontentloaded", timeout: 60000 });
      await this._sleep(1500);

      // Điền thông tin đăng nhập
      await this._typeHuman(page, "#login_field, input[name='login']", cleanEmail);
      await this._sleep(300);
      await this._typeHuman(page, "#password, input[name='password']", cleanPassword);
      await this._sleep(500);

      console.log("-> Bấm 'Sign in'...");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
        page.click('input[type="submit"], button[type="submit"]'),
      ]);
      await this._sleep(3000);

      // Kiểm tra nếu tài khoản ĐÃ CÓ 2FA TOTP (yêu cầu app_totp)
      let currentUrl = page.url();
      let bodyText = await this._getBodyText(page);

      if (currentUrl.includes("two-factor/app") || currentUrl.includes("sessions/two-factor") || bodyText.includes("Two-factor authentication code") || bodyText.includes("authenticator app")) {
        console.log(`✅ [ĐÃ CÓ 2FA] Tài khoản ${cleanEmail} đã được bật 2FA TOTP Authenticator App trước đó.`);
        return {
          success: true,
          email: cleanEmail,
          status: "ALREADY_ENABLED",
        };
      }

      // Kiểm tra lỗi sai mật khẩu
      if (bodyText.includes("Incorrect username or password") || (currentUrl.includes("/login") && !bodyText.includes("Device verification"))) {
        throw new Error("SAI MẬT KHẨU hoặc bị chặn đăng nhập tại trang login.");
      }

      // ------------------------------------------------------------------------
      // BƯỚC 2: XỬ LÝ DEVICE VERIFICATION (NẾU GỬI CODE VỀ EMAIL)
      // ------------------------------------------------------------------------
      if (currentUrl.includes("/sessions/verified-device") || bodyText.includes("Device verification") || bodyText.includes("verification code")) {
        console.log(`📬 [Bước 2] GitHub yêu cầu mã Device Verification gửi về email ${cleanEmail}...`);
        
        const loginStartTime = Date.now();
        const otpData = await this._hotmailHelper.waitForGitHubOtp(cleanEmail, {
          timeoutMs: 60000,
          intervalMs: 3000,
          receivedAfterTime: loginStartTime - 30000,
        });

        console.log(`⚡ [Bước 2] Đã nhận mã OTP: [ ${otpData.otpCode} ], đang nhập vào GitHub...`);
        await this._fillOtpDigits(page, otpData.otpCode);
        await this._sleep(3000);

        // Bấm nút Verify nếu có
        await this._clickVisibleButton(page, ["verify", "submit", "continue"]);
        await this._sleep(4000);
      }

      // ------------------------------------------------------------------------
      // BƯỚC 3: KIỂM TRA ĐÃ ĐĂNG NHẬP THÀNH CÔNG VÀO GITHUB
      // ------------------------------------------------------------------------
      console.log("📍 [Bước 3] Kiểm tra trạng thái sau đăng nhập...");
      await page.goto("https://github.com/settings/security", { waitUntil: "domcontentloaded", timeout: 60000 });
      await this._sleep(2500);

      bodyText = await this._getBodyText(page);

      // Xử lý nếu gặp màn hình Sudo Password
      if (page.url().includes("/sessions/sudo") || bodyText.includes("Confirm password")) {
        console.log("🛡️ [Sudo Mode] Xác nhận lại mật khẩu tại trang cài đặt bảo mật...");
        const sudoInput = await page.waitForSelector('#sudo_password, input[name="password"]', { visible: true, timeout: 10000 }).catch(() => null);
        if (sudoInput) {
          await this._typeHuman(page, '#sudo_password, input[name="password"]', cleanPassword);
          await this._sleep(500);
          await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
            page.click('button[type="submit"], input[type="submit"]'),
          ]);
          await this._sleep(3000);
        }
      }

      // Kiểm tra xem tài khoản đã bật 2FA chưa
      bodyText = await this._getBodyText(page);
      if (bodyText.includes("Authenticator app") && bodyText.includes("Configured")) {
        console.log(`✅ [ĐÃ BẬT SẴN] Tài khoản ${cleanEmail} đã có sẵn 2FA Authenticator App.`);
        return {
          success: true,
          email: cleanEmail,
          status: "ALREADY_ENABLED",
        };
      }

      // ------------------------------------------------------------------------
      // BƯỚC 4: BẬT 2FA (TWO-FACTOR AUTHENTICATION SETUP)
      // ------------------------------------------------------------------------
      console.log("📍 [Bước 4] Mở trang cấu hình 2FA (https://github.com/settings/two_factor_authentication/setup/intro)...");
      await page.goto("https://github.com/settings/two_factor_authentication/setup/intro", { waitUntil: "domcontentloaded", timeout: 60000 });
      await this._sleep(2500);

      // Bấm nút Continue hoặc Set up an app
      await this._clickVisibleButton(page, ["continue", "set up using an app", "authenticator app", "enable two-factor"]);
      await this._sleep(2000);

      // Bấm nút để hiển thị Text Key (setup key / enter this text code)
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
      }).catch(() => false);
      await this._sleep(1500);

      // Trích xuất Base32 Secret Key
      let setupKey = null;
      const keyStartTime = Date.now();

      while (Date.now() - keyStartTime < 15000) {
        setupKey = await page.evaluate(() => {
          const copyEl = document.querySelector("two-factor-setup-verification clipboard-copy, clipboard-copy[value]");
          if (copyEl && copyEl.getAttribute("value")) {
            const val = copyEl.getAttribute("value").trim().replace(/[\s-]/g, "");
            if (/^[A-Z2-7]{16,32}$/i.test(val)) return val;
          }

          const txt = document.body ? document.body.innerText : "";
          const match = txt.match(/Your two-factor secret\s*([A-Z2-7]{16,})/i) ||
                        txt.match(/secret key\s*:\s*([A-Z2-7]{16,})/i) ||
                        txt.match(/\b([A-Z2-7]{16,32})\b/);
          return match ? match[1] : null;
        }).catch(() => null);

        if (setupKey && setupKey.length >= 16) break;
        await this._sleep(1000);
      }

      if (!setupKey) {
        throw new Error("Không thể trích xuất Secret Key 2FA từ trang GitHub.");
      }

      setupKey = setupKey.replace(/[\s-]/g, "").toUpperCase();
      console.log(`🔐 [Bước 4] Đã lấy được 2FA Secret Key: [ ${setupKey} ]`);

      // ------------------------------------------------------------------------
      // BƯỚC 5: TÍNH TOÁN VÀ ĐIỀN MÃ TOTP 6 SỐ
      // ------------------------------------------------------------------------
      const totpCode = this._totpEngine.generateCode(setupKey);
      console.log(`🔑 [Bước 5] Sinh mã TOTP nội bộ (0ms): [ ${totpCode} ]`);

      const otpInputSelector = 'input[placeholder="XXXXXX"], input[name="otp"], input[autocomplete="one-time-code"], input[id*="otp"], form[action*="setup/verify"] input[type="text"]';
      await page.waitForSelector(otpInputSelector, { visible: true, timeout: 15000 });

      // Điền mã TOTP
      await page.evaluate((selector, code) => {
        const el = document.querySelector(selector);
        if (el) {
          el.value = code;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        }
      }, otpInputSelector, totpCode);

      await this._typeHuman(page, otpInputSelector, totpCode);
      await this._sleep(1000);

      console.log("-> Bấm 'Continue' để xác nhận kích hoạt 2FA...");
      await this._clickVisibleButton(page, ["continue", "verify", "save"]);
      await this._sleep(5000);

      // ------------------------------------------------------------------------
      // BƯỚC 6: TRÍCH XUẤT RECOVERY CODES & HOÀN TẤT
      // ------------------------------------------------------------------------
      console.log("🛡️ [Bước 6] Trích xuất Recovery Backup Codes...");
      await page.waitForSelector('ul[data-target*="recovery-codes.codes"] li, .recovery-code-list li, [data-testid="recovery-code"]', { visible: true, timeout: 20000 }).catch(() => {});

      const recoveryCodes = await page.$$eval(
        'ul[data-target*="recovery-codes.codes"] li, .recovery-code-list li, [data-testid="recovery-code"]',
        (items) => items.map((i) => i.innerText.trim()).filter(Boolean)
      ).catch(async () => {
        const full = await page.evaluate(() => document.body?.innerText || "");
        const m = full.match(/\b[a-f0-9]{5}-[a-f0-9]{5}\b/gi);
        return m ? Array.from(new Set(m)) : [];
      });

      console.log(`✅ [Bước 6] Thu thập được ${recoveryCodes.length} mã Recovery Codes.`);

      // Bấm nút Download & I have saved my recovery codes
      await this._clickVisibleButton(page, ["download", "download recovery codes"]);
      await this._sleep(1500);
      await this._clickVisibleButton(page, ["i have saved my recovery codes", "saved my recovery codes", "done"]);
      await this._sleep(3000);

      console.log(`🎉 [HOÀN TẤT] Kích hoạt 2FA thành công cho: ${cleanEmail}!`);

      return {
        success: true,
        email: cleanEmail,
        password: cleanPassword,
        twoFactorSecret: setupKey,
        recoveryCodes: recoveryCodes,
        status: "SUCCESS_2FA_ENABLED",
      };

    } catch (err) {
      console.error(`❌ [LỖI] Xử lý tài khoản ${cleanEmail} thất bại: ${err.message}`);
      return {
        success: false,
        email: cleanEmail,
        error: err.message,
        status: "FAILED",
      };
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }
}
