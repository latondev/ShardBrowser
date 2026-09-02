/**
 * ==============================================================================
 * MAIL.TM API CLIENT (ES MODULES)
 * ==============================================================================
 * Dịch vụ Temp Mail REST API miễn phí 100%, không cần API Key:
 * - Tạo hòm thư tạm ngẫu nhiên trong 0.2s.
 * - Nhận email và trích xuất mã OTP GitHub/SeekAI 6-8 chữ số tự động trong 2-4 giây.
 * - Hoạt động hoàn toàn qua HTTP REST API.
 * ==============================================================================
 */

import axios from "axios";

export class MailTmClient {
  _baseUrl = "https://api.mail.tm";
  _token = null;
  _account = null;

  constructor() {}

  async _getAvailableDomain() {
    const res = await axios.get(`${this._baseUrl}/domains`, { timeout: 10000 });
    const members = res.data?.["hydra:member"] || [];
    const active = members.find((d) => d.isActive);
    if (!active) {
      throw new Error("Không tìm thấy domain khả dụng trên Mail.tm.");
    }
    return active.domain;
  }

  /**
   * Tạo tài khoản email tạm ngẫu nhiên
   * @param {string} prefix 
   * @param {string} customPassword 
   */
  async createAccount(prefix = "", customPassword = "") {
    const domain = await this._getAvailableDomain();
    const randStr = Math.random().toString(36).substring(2, 8);
    const username = prefix ? `${prefix}${randStr}` : `usr${Date.now().toString().slice(-6)}${randStr}`;
    const address = `${username}@${domain}`.toLowerCase();
    const password = customPassword || `MailTm@2026!${randStr}`;

    console.log(`⏳ [Mail.tm] Đang tạo hòm thư tạm mới: ${address}...`);

    // 1. Tạo tài khoản
    await axios.post(
      `${this._baseUrl}/accounts`,
      { address, password },
      { timeout: 10000 }
    );

    // 2. Lấy JWT Token
    const tokenRes = await axios.post(
      `${this._baseUrl}/token`,
      { address, password },
      { timeout: 10000 }
    );

    this._token = tokenRes.data.token;
    this._account = {
      address,
      password,
      domain,
      username,
    };

    console.log(`✅ [Mail.tm Cấp Mới Thành Công]: ${address} (Username: ${username})`);
    return this._account;
  }

  /**
   * Trích xuất mã OTP từ nội dung thư
   */
  extractVerificationCode(text) {
    if (!text || typeof text !== "string") return null;
    const clean = text.replace(/<[^>]+>/g, " ");

    const patterns = [
      /(?:launch code|verification code|verify your account|security code|mã xác minh|mã xác thực|otp|pin)[\s:=]+(?:is\s*|là\s*|:\s*)?([0-9]{6,8})\b/i,
      /\b[A-Za-z]-([0-9]{4,8})\b/i,
      /\[\s*(\d{6,8})\s*\]/,
      /\b([0-9]{8})\b/,
      /\b([0-9]{6})\b/,
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
   * Lắng nghe hộp thư và trích xuất mã OTP
   * Tương thích với interface của pipeline (email, timeoutMs)
   */
  async waitForOtpCode(email = this._account?.address, timeoutMs = 90000) {
    if (!this._token || !this._account) {
      throw new Error("Chưa khởi tạo tài khoản Mail.tm.");
    }

    const targetEmail = email || this._account.address;
    console.log(`⏳ [Mail.tm] Đang lắng nghe thư đến cho [${targetEmail}] (Timeout: ${timeoutMs / 1000}s)...`);

    const headers = { Authorization: `Bearer ${this._token}` };
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2500));

      try {
        const res = await axios.get(`${this._baseUrl}/messages`, { headers, timeout: 8000 });
        const messages = res.data?.["hydra:member"] || [];

        if (messages.length > 0) {
          for (const msg of messages) {
            console.log(`✨ [Mail.tm] Nhận thư từ: [${msg.from?.address || "Unknown"}] - "${msg.subject || ""}"`);

            // Đọc chi tiết thư
            const detailRes = await axios.get(`${this._baseUrl}/messages/${msg.id}`, { headers, timeout: 8000 });
            const detail = detailRes.data;
            const fullContent = `${detail.subject || ""} ${detail.intro || ""} ${detail.text || ""} ${detail.html || ""}`;

            const otpCode = this.extractVerificationCode(fullContent);
            if (otpCode) {
              console.log(`🎉 [Mail.tm OTP] Nhận thành công mã OTP: [ ${otpCode} ]`);
              return otpCode;
            }
          }
        }
      } catch (err) {
        // Tiếp tục polling
      }
    }

    throw new Error(`Timeout: Không nhận được mã OTP từ Mail.tm cho [${targetEmail}] sau ${timeoutMs / 1000}s`);
  }
}
