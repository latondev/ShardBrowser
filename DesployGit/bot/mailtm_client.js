/**
 * MAIL.TM API CLIENT (NODE.JS / ES MODULES)
 * ==============================================================================
 * Dịch vụ Temp Mail REST API chính thức, miễn phí, siêu tốc:
 * - Tạo hòm thư tạm ngẫu nhiên trong 0.1s.
 * - Nhận thư đến và trích xuất mã OTP 6-8 chữ số tự động trong 2-4 giây.
 * - Hoạt động hoàn toàn qua HTTP REST API (không cần mở tab browser).
 * 
 * Quy tắc đặt tên biến:
 * - Biến/Phương thức private/protected: _{name}
 * - Biến/Phương thức public: {nameValue} (camelCase)
 * ==============================================================================
 */

import axios from "axios";

export class MailTmClient {
  // Private / Protected Properties
  _baseUrl = "https://api.mail.tm";
  _token = null;
  _account = null;

  constructor() {}

  // Lấy domain khả dụng từ mail.tm
  async _getAvailableDomain() {
    const res = await axios.get(`${this._baseUrl}/domains`, { timeout: 10000 });
    const members = res.data?.["hydra:member"] || [];
    const active = members.find((d) => d.isActive);
    if (!active) {
      throw new Error("Không có domain khả dụng trên Mail.tm.");
    }
    return active.domain;
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  /**
   * Tạo một tài khoản email tạm ngẫu nhiên
   * @param {string} prefix Tùy chọn tiền tố username
   * @param {string} customPassword Tùy chọn mật khẩu
   */
  async createAccount(prefix = "", customPassword = "") {
    const domain = await this._getAvailableDomain();
    const randStr = Math.random().toString(36).substring(2, 8);
    const username = prefix ? `${prefix}${randStr}` : `usr${Date.now().toString().slice(-6)}${randStr}`;
    const address = `${username}@${domain}`.toLowerCase();
    const password = customPassword || `MailTm@2026!${randStr}`;

    // 1. Tạo tài khoản
    await axios.post(`${this._baseUrl}/accounts`, {
      address,
      password,
    }, { timeout: 10000 });

    // 2. Lấy JWT Token
    const tokenRes = await axios.post(`${this._baseUrl}/token`, {
      address,
      password,
    }, { timeout: 10000 });

    this._token = tokenRes.data.token;
    this._account = {
      address,
      password,
      domain,
      username,
    };

    return this._account;
  }

  /**
   * Trích xuất mã OTP từ text hoặc html
   * @param {string} text 
   */
  extractVerificationCode(text) {
    if (!text || typeof text !== "string") return null;
    const clean = text.replace(/<[^>]+>/g, " ");

    const patterns = [
      /(?:launch code|verification code|verify|mã xác minh|mã xác thực|github launch code|otp|pin)[\s:=]+(?:is\s*|là\s*|:\s*)?([0-9]{6,8})\b/i,
      /\b[A-Za-z]-([0-9]{4,8})\b/i,
      /\b([0-9]{6})\b/,
      /\b([0-9]{8})\b/,
    ];

    for (const pat of patterns) {
      const match = clean.match(pat);
      if (match && match[1]) {
        if (["2024", "2025", "2026", "2027"].includes(match[1])) continue;
        return match[1];
      }
    }
    return null;
  }

  /**
   * Lắng nghe hộp thư và trích xuất mã OTP tự động
   * @param {number} timeoutSec Thời gian chờ tối đa (giây)
   * @param {number} pollIntervalSec Khoảng cách giữa các lần polling (giây)
   */
  async waitForVerificationCode(timeoutSec = 90, pollIntervalSec = 2) {
    if (!this._token || !this._account) {
      throw new Error("Chưa khởi tạo tài khoản Mail.tm.");
    }

    const email = this._account.address;
    console.log(`📬 [Mail.tm] Đang lắng nghe thư đến cho [${email}] (Timeout: ${timeoutSec}s)...`);

    const headers = { Authorization: `Bearer ${this._token}` };
    const startTime = Date.now();

    while ((Date.now() - startTime) / 1000 < timeoutSec) {
      await new Promise((r) => setTimeout(r, pollIntervalSec * 1000));

      try {
        const res = await axios.get(`${this._baseUrl}/messages`, { headers, timeout: 8000 });
        const messages = res.data?.["hydra:member"] || [];

        if (messages.length > 0) {
          for (const msg of messages) {
            console.log(`✨ [Mail.tm] Phát hiện thư mới từ: [${msg.from?.address || "Unknown"}] | Tiêu đề: "${msg.subject || ""}"`);

            // Đọc chi tiết nội dung email
            const detailRes = await axios.get(`${this._baseUrl}/messages/${msg.id}`, { headers, timeout: 8000 });
            const detail = detailRes.data;
            const fullContent = `${detail.subject || ""} ${detail.intro || ""} ${detail.text || ""} ${detail.html || ""}`;

            const otpCode = this.extractVerificationCode(fullContent);
            if (otpCode) {
              console.log(`🔥 [Mail.tm OTP] Trích xuất thành công mã OTP: [ ${otpCode} ]`);
              return {
                otpCode,
                subject: detail.subject,
                sender: detail.from?.address,
                content: fullContent,
              };
            }
          }
        }
      } catch (err) {
        console.warn(`(!) [Mail.tm Polling]: ${err.message}`);
      }
    }

    throw new Error(`Hết thời gian chờ OTP từ Mail.tm (${timeoutSec}s) cho hòm thư [${email}].`);
  }
}
