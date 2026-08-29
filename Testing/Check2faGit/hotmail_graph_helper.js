/**
 * HOTMAIL GRAPH HELPER
 * ==============================================================================
 * Module quản lý danh bạ tài khoản Hotmail và tự động lấy mã OTP từ Microsoft Graph API.
 * - Tự động tra cứu email cần lấy OTP trong danh sách hotmail.txt.
 * - Đổi Refresh Token lấy Access Token với scope Mail.ReadWrite.
 * - Polling hòm thư Inbox để trích xuất mã Device Verification (6 chữ số).
 * 
 * Quy tắc đặt tên:
 * - Biến/Phương thức private/protected: _{name}
 * - Biến/Phương thức public: {nameValue}
 * ==============================================================================
 */

import axios from "axios";
import { readFileSync, existsSync } from "node:fs";

export class HotmailGraphHelper {
  // Private / Protected Properties
  _accountsMap = new Map();
  _tokenCache = new Map();
  _defaultClientId = "9e5f94bc-e8a4-4e73-b8be-63364c29d753";
  _tokenEndpoint = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
  _graphBaseUrl = "https://graph.microsoft.com/v1.0";

  /**
   * Khởi tạo với đường dẫn file danh sách Hotmail
   * @param {string} hotmailFilePath - Đường dẫn file hotmail.txt
   */
  constructor(hotmailFilePath = "") {
    if (hotmailFilePath) {
      this.loadHotmailAccounts(hotmailFilePath);
    }
  }

  /**
   * Đọc danh sách tài khoản từ file
   * @param {string} filePath - Đường dẫn file txt chứa email|pass|token|clientId|recovery
   */
  loadHotmailAccounts(filePath) {
    if (!existsSync(filePath)) {
      console.warn(`[HotmailGraphHelper] File không tồn tại: ${filePath}`);
      return;
    }

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      const parts = line.split("|").map((p) => p.trim());
      const email = parts[0]?.toLowerCase();
      if (!email) continue;

      this._accountsMap.set(email, {
        email: parts[0],
        password: parts[1] || "",
        refreshToken: parts[2] || "",
        clientId: parts[3] || this._defaultClientId,
        recoveryEmail: parts[4] || "",
      });
    }

    console.log(`[HotmailGraphHelper] Đã nạp thành công ${this._accountsMap.size} tài khoản Hotmail/Outlook.`);
  }

  /**
   * Trích xuất mã OTP 6-8 chữ số từ nội dung email
   * @param {string} text - Nội dung tiêu đề + body email
   * @returns {string|null}
   */
  _extractOtpCode(text) {
    if (!text) return null;

    // Pattern 1: Tìm theo ngữ cảnh "verification code is: 123456" hoặc "code: 123456"
    const patternContext = /(?:verification code|device verification|code is|mã xác minh|mã là)[:\s]+([0-9]{6,8})/i;
    const matchContext = text.match(patternContext);
    if (matchContext && matchContext[1]) {
      return matchContext[1];
    }

    // Pattern 2: Tìm 6 chữ số độc lập
    const patternDigits = /\b([0-9]{6})\b/;
    const matchDigits = text.match(patternDigits);
    if (matchDigits && matchDigits[1]) {
      return matchDigits[1];
    }

    return null;
  }

  /**
   * Lấy Access Token cho một email cụ thể
   * @param {string} email - Địa chỉ email
   * @returns {Promise<string>}
   */
  async _getAccessTokenForEmail(email) {
    const cleanEmail = email.toLowerCase().trim();
    const acc = this._accountsMap.get(cleanEmail);

    if (!acc) {
      throw new Error(`Không tìm thấy cấu hình Hotmail cho email: ${cleanEmail} trong danh sách nạp.`);
    }

    if (!acc.refreshToken) {
      throw new Error(`Tài khoản ${cleanEmail} không có Refresh Token.`);
    }

    // Kiểm tra cache token
    const cached = this._tokenCache.get(cleanEmail);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return cached.token;
    }

    const params = new URLSearchParams();
    params.append("client_id", acc.clientId || this._defaultClientId);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", acc.refreshToken);
    params.append("scope", "https://graph.microsoft.com/Mail.ReadWrite");

    try {
      const res = await axios.post(this._tokenEndpoint, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 12000,
      });

      const accessToken = res.data?.access_token;
      if (!accessToken) throw new Error("Không nhận được access_token từ Microsoft OAuth.");

      const expiresInSec = res.data?.expires_in || 3600;
      this._tokenCache.set(cleanEmail, {
        token: accessToken,
        expiresAt: Date.now() + expiresInSec * 1000,
      });

      return accessToken;
    } catch (err) {
      const desc = err.response?.data?.error_description || err.message;
      throw new Error(`Lỗi đổi Access Token cho ${cleanEmail}: ${desc}`);
    }
  }

  /**
   * Chờ và lấy mã OTP từ GitHub gửi về email Hotmail
   * @param {string} email - Địa chỉ email nhận OTP
   * @param {object} options
   * @param {number} options.timeoutMs - Thời gian chờ tối đa (mặc định: 60s)
   * @param {number} options.intervalMs - Chu kỳ kiểm tra lại (mặc định: 3s)
   * @param {number} options.receivedAfterTime - Chỉ lấy thư nhận sau thời điểm này
   * @returns {Promise<{otpCode: string, subject: string, sender: string}>}
   */
  async waitForGitHubOtp(email, { timeoutMs = 60000, intervalMs = 3000, receivedAfterTime = 0 } = {}) {
    const startTime = Date.now();
    const thresholdTime = receivedAfterTime || startTime - 60000; // Lấy thư trong vòng 1 phút trước hoặc mới hơn

    console.log(`⏳ [HotmailGraphHelper] Đang chờ mã OTP GitHub gửi tới ${email}...`);

    while (Date.now() - startTime < timeoutMs) {
      try {
        const token = await this._getAccessTokenForEmail(email);
        const url = `${this._graphBaseUrl}/me/mailFolders/inbox/messages?$top=5&$select=id,from,subject,bodyPreview,receivedDateTime,body`;

        const res = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          timeout: 10000,
        });

        const messages = res.data?.value || [];

        for (const msg of messages) {
          const fromAddr = (msg.from?.emailAddress?.address || "").toLowerCase();
          const subject = msg.subject || "";
          const preview = msg.bodyPreview || "";
          const bodyHtml = msg.body?.content || "";
          const receivedDate = new Date(msg.receivedDateTime).getTime();

          // Kiểm tra xem có phải thư từ GitHub và thời gian hợp lệ không
          const isGitHub = fromAddr.includes("github.com") || subject.toLowerCase().includes("github") || preview.toLowerCase().includes("github");
          const isRecent = receivedDate >= thresholdTime;

          if (isGitHub && isRecent) {
            const fullContent = `${subject} ${preview} ${bodyHtml}`;
            const otpCode = this._extractOtpCode(fullContent);

            if (otpCode) {
              console.log(`✅ [HotmailGraphHelper] Đã trích xuất mã OTP thành công: [ ${otpCode} ] từ thư '${subject}'`);
              return {
                otpCode,
                subject,
                sender: fromAddr,
                receivedTime: msg.receivedDateTime,
              };
            }
          }
        }
      } catch (err) {
        console.warn(`[HotmailGraphHelper] Polling warning: ${err.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timeout: Không nhận được mã OTP GitHub gửi tới ${email} sau ${Math.round(timeoutMs / 1000)}s.`);
  }

  /**
   * Kiểm tra xem email có tồn tại trong danh bạ hay không
   * @param {string} email
   * @returns {boolean}
   */
  hasAccount(email) {
    return this._accountsMap.has(email.toLowerCase().trim());
  }
}
