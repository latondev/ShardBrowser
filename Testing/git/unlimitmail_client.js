/**
 * ==============================================================================
 * UNLIMITMAIL API / BROWSER CLIENT (NODE.JS / ES MODULES)
 * ==============================================================================
 * Module tích hợp dịch vụ Temp Mail không giới hạn từ unlimitmail.com:
 * - Tự động mở Chrome headless, duy trì session chính xác để sinh hòm thư tạm.
 * - Lắng nghe hộp thư đến và bóc tách mã OTP 6-8 chữ số tự động từ GitHub.
 * - Tự động dọn dẹp browser instance sau khi hoàn tất phiên làm việc.
 * 
 * Quy tắc đặt tên biến:
 * - Biến/Phương thức private/protected: _{name}
 * - Biến/Phương thức public: {nameValue} (camelCase)
 * ==============================================================================
 */

import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import path from "node:path";

export class UnlimitMailClient {
  // Private / Protected Properties
  _baseUrl = "https://unlimitmail.com/vi/temp-mail";
  _chromePath = "";
  _browser = null;
  _page = null;
  _currentEmail = "";
  _currentUsername = "";

  constructor(customChromePath = "") {
    this._chromePath = customChromePath || this._findChromePath();
  }

  // Tự động tìm đường dẫn Chrome / Chromium khả dụng trên hệ thống
  _findChromePath() {
    const candidatePaths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ];

    for (const p of candidatePaths) {
      if (p && existsSync(p)) {
        return p;
      }
    }
    throw new Error(
      "Không tìm thấy Google Chrome hoặc trình duyệt Chromium tương thích để khởi chạy UnlimitMail."
    );
  }

  // Helper chờ an toàn
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Khởi tạo browser session nếu chưa có
  async _ensureBrowser() {
    if (this._browser && this._page && !this._page.isClosed()) {
      return;
    }

    this._browser = await puppeteer.launch({
      headless: true,
      executablePath: this._chromePath,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    this._page = await this._browser.newPage();
    await this._page.setViewport({ width: 1366, height: 768 });
    await this._page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
    );
    await this._page.setExtraHTTPHeaders({
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    await this._page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["vi-VN", "vi", "en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      window.chrome = window.chrome || { runtime: {} };
    });
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  get email() {
    return this._currentEmail;
  }

  get username() {
    return this._currentUsername;
  }

  /**
   * Khởi tạo hòm thư tạm UnlimitMail và duy trì session
   * @param {string} prefix Tiền tố gợi ý username GitHub
   */
  async createAccount(prefix = "") {
    await this._ensureBrowser();

    console.log(`🌐 [UnlimitMail] Đang kết nối tới ${this._baseUrl}...`);
    await this._page.goto(this._baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    await this._page.waitForSelector("[data-current-email]", { timeout: 25000 });

    const email = await this._page.evaluate(() => {
      return document.querySelector("[data-current-email]")?.innerText?.trim() || "";
    });

    if (!email || !email.includes("@")) {
      throw new Error("Không thể lấy địa chỉ email từ giao diện UnlimitMail.");
    }

    this._currentEmail = email;

    const rawUser = (prefix || email.split("@")[0]).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    this._currentUsername = `user${rawUser.slice(0, 8)}${Math.random().toString(36).substring(2, 6)}`;

    console.log(`📬 [UnlimitMail] Đã tạo hòm thư thành công: [ ${this._currentEmail} ]`);

    return {
      address: this._currentEmail,
      email: this._currentEmail,
      username: this._currentUsername,
      domain: this._currentEmail.split("@")[1] || "",
    };
  }

  /**
   * Trích xuất mã OTP từ chuỗi văn bản
   * @param {string} text 
   */
  extractVerificationCode(text) {
    if (!text || typeof text !== "string") return null;
    const clean = text.replace(/<[^>]+>/g, " ");

    const patterns = [
      /(?:launch code|verification code|verify|mã xác minh|mã xác thực|github launch code|security code|otp|pin)[\s:=]+(?:is\s*|là\s*|:\s*)?([0-9]{6,8})\b/i,
      /\[\s*([0-9]{6,8})\s*\]/,
      /\b[A-Za-z]-([0-9]{4,8})\b/i,
      /\b([0-9]{6})\b/,
      /\b([0-9]{8})\b/,
    ];

    for (const pat of patterns) {
      const match = clean.match(pat);
      if (match && match[1]) {
        if (["2024", "2025", "2026", "2027"].includes(match[1])) continue;
        return match[1].trim();
      }
    }
    return null;
  }

  /**
   * Lắng nghe thư đến và trích xuất mã OTP GitHub
   * @param {number} timeoutSec Thời gian chờ tối đa (giây)
   * @param {number} pollIntervalSec Khoảng cách mỗi lần kiểm tra (giây)
   */
  async waitForVerificationCode(timeoutSec = 90, pollIntervalSec = 3) {
    if (!this._page || !this._currentEmail) {
      throw new Error("Hòm thư UnlimitMail chưa được khởi tạo. Hãy gọi createAccount() trước.");
    }

    const email = this._currentEmail;
    console.log(`📬 [UnlimitMail] Đang lắng nghe mã OTP cho [${email}] (Timeout: ${timeoutSec}s)...`);

    const startTime = Date.now();
    while ((Date.now() - startTime) / 1000 < timeoutSec) {
      await this._sleep(pollIntervalSec * 1000);

      try {
        const inboxData = await this._page.evaluate(async (address) => {
          const root = document.querySelector("[data-temp-mail]");
          const endpoint = root?.dataset?.endpointInbox || "/temp-mail/inbox";
          const sep = endpoint.includes("?") ? "&" : "?";
          const url = endpoint + sep + new URLSearchParams({ email: address });
          const res = await fetch(url, {
            headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
          });
          return await res.json();
        }, email);

        const items = inboxData?.data || [];
        if (items.length > 0) {
          for (const item of items) {
            const mailId = item.id || item.mail_id;
            console.log(`✨ [UnlimitMail] Phát hiện thư mới: ID [${mailId}] | Tiêu đề: "${item.subject || ""}" | Từ: "${item.from || ""}"`);

            // Đọc chi tiết nội dung email
            const detailRes = await this._page.evaluate(async ({ address, id }) => {
              const root = document.querySelector("[data-temp-mail]");
              const endpoint = root?.dataset?.endpointDetail || "/temp-mail/detail";
              const sep = endpoint.includes("?") ? "&" : "?";
              const url = endpoint + sep + new URLSearchParams({ email: address, mail_id: id });
              const res = await fetch(url, {
                headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
              });
              return await res.json();
            }, { address: email, id: mailId });

            const detailData = detailRes?.data || {};
            const directCode = detailData.code;
            if (directCode && String(directCode).trim().length >= 6) {
              const codeStr = String(directCode).trim();
              console.log(`🔥 [UnlimitMail OTP] Nhận được mã OTP trực tiếp: [ ${codeStr} ]`);
              return {
                otpCode: codeStr,
                subject: item.subject,
                sender: item.from,
                content: JSON.stringify(detailData),
              };
            }

            const fullContent = `${item.subject || ""} ${detailData.text || ""} ${detailData.html || ""}`;
            const otpCode = this.extractVerificationCode(fullContent);
            if (otpCode) {
              console.log(`🔥 [UnlimitMail OTP] Trích xuất thành công mã OTP: [ ${otpCode} ]`);
              return {
                otpCode,
                subject: item.subject,
                sender: item.from,
                content: fullContent,
              };
            }
          }
        }
      } catch (pollErr) {
        console.warn(`(!) [UnlimitMail Polling]: ${pollErr.message}`);
      }
    }

    throw new Error(`Hết thời gian chờ OTP từ UnlimitMail (${timeoutSec}s) cho hòm thư [${email}].`);
  }

  /**
   * Đóng trình duyệt UnlimitMail an toàn
   */
  async close() {
    if (this._browser) {
      try {
        await this._browser.close();
      } catch {}
      this._browser = null;
      this._page = null;
    }
  }
}
