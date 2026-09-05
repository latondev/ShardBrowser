/**
 * HOTMAIL / OUTLOOK GRAPH API CLIENT (NODE.JS / ES MODULES)
 * ==============================================================================
 * Module chuyên dụng quản lý, kiểm tra trạng thái và nhận mã OTP tự động từ
 * Microsoft Graph API cho tài khoản Hotmail/Outlook có Refresh Token.
 *
 * Tính năng chính:
 * - Đổi Refresh Token lấy Access Token qua OAuth2 v2.0 endpoint của Microsoft.
 * - Kiểm tra tình trạng tài khoản (LIVE / TOKEN_EXPIRED / LOCKED).
 * - Đọc danh sách thư mới nhất trong hộp thư đến (Inbox).
 * - Tự động chờ và trích xuất mã xác thực OTP (6-8 chữ số) trong thời gian thực.
 *
 * Quy tắc đặt tên biến:
 * - Biến/Phương thức private/protected: _{name}
 * - Biến/Phương thức public: {nameValue} (camelCase)
 * ==============================================================================
 */

import axios from "axios";

export class HotmailGraphClient {
  // Private / Protected Properties
  _email = null;
  _password = null;
  _refreshToken = null;
  _clientId = "9e5f94bc-e8a4-4e73-b8be-63364c29d753"; // Default Microsoft Client ID
  _recoveryEmail = null;
  _accessToken = null;
  _tokenExpiresAt = 0;

  _tokenEndpoint = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
  _graphBaseUrl = "https://graph.microsoft.com/v1.0";

  /**
   * Khởi tạo client với thông tin tài khoản hoặc chuỗi định dạng
   * @param {string|object} accountInfo Chuỗi 'email|pass|token|clientId|recovery' hoặc object
   */
  constructor(accountInfo = null) {
    if (typeof accountInfo === "string") {
      this._parseFromString(accountInfo);
    } else if (accountInfo && typeof accountInfo === "object") {
      this._email = accountInfo.email || null;
      this._password = accountInfo.password || null;
      this._refreshToken = accountInfo.refreshToken || null;
      this._clientId = accountInfo.clientId || this._clientId;
      this._recoveryEmail = accountInfo.recoveryEmail || null;
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  _parseFromString(accountLine) {
    if (!accountLine) return;
    let clean = accountLine.trim();
    if (clean.includes("\t")) {
      const tabParts = clean.split("\t");
      clean = tabParts[tabParts.length - 1].trim();
    }
    const parts = clean.split("|");
    this._email = (parts[0] || "").trim() || null;
    this._password = (parts[1] || "").trim() || null;
    this._refreshToken = (parts[2] || "").trim() || null;
    this._clientId = (parts[3] || "").trim() || this._clientId;
    this._recoveryEmail = (parts[4] || "").trim() || null;
  }

  // Trích xuất mã OTP 6-8 chữ số từ nội dung email
  _extractOtpFromText(text) {
    if (!text) return null;
    const clean = String(text).replace(/<[^>]+>/g, " ");

    // Ưu tiên 1: Cụm từ định danh của GitHub (Launch code / Verification code / Code is...)
    const launchMatch = clean.match(/(?:launch code|verification code|verify your account|security code|enter the code|code is|mã xác minh|mã xác thực)[^\d]{0,40}(\d{6,8})/i);
    if (launchMatch && launchMatch[1]) return launchMatch[1].trim();

    // Ưu tiên 2: Cụm số nằm trong dấu ngoặc vuông [ 12345678 ] hoặc dấu nháy
    const bracketMatch = clean.match(/\[\s*(\d{6,8})\s*\]/) || clean.match(/["'](\d{6,8})["']/);
    if (bracketMatch && bracketMatch[1]) return bracketMatch[1].trim();

    // Ưu tiên 3: Bất kỳ chuỗi 6 hoặc 8 chữ số đứng độc lập (loại trừ các năm 2024-2027)
    const numMatches = clean.match(/\b\d{6,8}\b/g);
    if (numMatches) {
      for (const num of numMatches) {
        if (!["2024", "2025", "2026", "2027"].includes(num)) {
          return num.trim();
        }
      }
    }

    return null;
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  /**
   * Đổi Refresh Token lấy Access Token mới
   * @param {boolean} forceRefresh Bắt buộc làm mới token
   * @returns {Promise<string>} Access Token
   */
  async getAccessToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this._accessToken && this._tokenExpiresAt > now + 60000) {
      return this._accessToken;
    }

    if (!this._refreshToken) {
      throw new Error("Không có Refresh Token để lấy Access Token.");
    }

    const params = new URLSearchParams();
    params.append("client_id", this._clientId);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", this._refreshToken);
    params.append("scope", "https://graph.microsoft.com/Mail.ReadWrite");

    try {
      const res = await axios.post(this._tokenEndpoint, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000,
      });

      if (res.data?.access_token) {
        this._accessToken = res.data.access_token;
        const expiresInSec = res.data.expires_in || 3600;
        this._tokenExpiresAt = now + expiresInSec * 1000;
        return this._accessToken;
      }

      throw new Error("Không tìm thấy access_token trong phản hồi từ Microsoft.");
    } catch (err) {
      const errData = err.response?.data;
      if (errData?.error === "invalid_grant") {
        throw new Error(`TOKEN_EXPIRED: ${errData.error_description || "Refresh token đã hết hạn hoặc bị hủy."}`);
      }
      throw new Error(`OAUTH_ERROR: ${errData?.error_description || err.message}`);
    }
  }

  /**
   * Kiểm tra trạng thái tài khoản qua Graph API
   * @returns {Promise<{isAlive: boolean, email: string, error?: string, profile?: object}>}
   */
  async checkAccountStatus() {
    try {
      const token = await this.getAccessToken();
      const res = await axios.get(`${this._graphBaseUrl}/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        timeout: 10000,
      });

      return {
        isAlive: true,
        email: this._email || res.data?.userPrincipalName || res.data?.mail,
        profile: {
          displayName: res.data?.displayName,
          userPrincipalName: res.data?.userPrincipalName,
          mail: res.data?.mail,
          id: res.data?.id,
        },
      };
    } catch (err) {
      return {
        isAlive: false,
        email: this._email,
        error: err.message,
      };
    }
  }

  /**
   * Lấy danh sách thư mới nhất từ Hộp thư đến (Inbox) và Thư rác (Junk / All Messages)
   * @param {number} top Số lượng thư muốn lấy (mặc định: 15)
   * @returns {Promise<Array>} Danh sách email
   */
  async getInboxMessages(top = 15) {
    const token = await this.getAccessToken();
    // Quét toàn bộ thư /me/messages (Bao gồm cả Inbox, Other và Thư rác Junk Email)
    const url = `${this._graphBaseUrl}/me/messages?$top=${top}&$select=id,from,subject,bodyPreview,receivedDateTime,body&$orderby=receivedDateTime desc`;

    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      timeout: 10000,
    });

    return res.data?.value || [];
  }

  /**
   * Lắng nghe và tự động lấy mã OTP từ email đến
   * @param {object} options Các tùy chọn lọc và thời gian chờ
   * @param {string} options.filterSender Lọc theo email người gửi (ví dụ: 'github.com', 'noreply')
   * @param {string} options.filterSubject Lọc theo tiêu đề thư
   * @param {number} options.timeoutMs Thời gian chờ tối đa (mặc định 90s)
   * @param {number} options.intervalMs Chu kỳ kiểm tra lại (mặc định 2.5s)
   * @returns {Promise<{otpCode: string, message: object}>}
   */
  async waitForOtpCode({ filterSender = "github", filterSubject = "", timeoutMs = 90000, intervalMs = 2500 } = {}) {
    const startTime = Date.now();
    let pollCount = 0;
    console.log(`📬 [Hotmail Graph API] Bắt đầu lắng nghe hộp thư đến cho ${this._email} (Timeout: ${Math.round(timeoutMs / 1000)}s)...`);

    while (Date.now() - startTime < timeoutMs) {
      pollCount++;
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);

      try {
        const messages = await this.getInboxMessages(10);
        if (pollCount % 2 === 1 || pollCount <= 3) {
          const recentTitles = messages.slice(0, 2).map(m => `"${m.subject || 'Không tiêu đề'}" từ ${m.from?.emailAddress?.address || 'N/A'}`).join(" | ");
          console.log(`   ⏳ [Hotmail Polling #${pollCount}] Quét ${messages.length} thư (đã chờ ${elapsedSec}s) -> Thư mới: [${recentTitles || 'Chưa có thư mới'}]`);
        }

        for (const msg of messages) {
          const fromAddress = msg.from?.emailAddress?.address || "";
          const subject = msg.subject || "";
          const preview = msg.bodyPreview || "";
          const bodyContent = msg.body?.content || "";

          // Kiểm tra bộ lọc người gửi hoặc tiêu đề GitHub
          const matchSender = !filterSender || fromAddress.toLowerCase().includes(filterSender.toLowerCase());
          const matchSubject = !filterSubject || subject.toLowerCase().includes(filterSubject.toLowerCase()) || subject.toLowerCase().includes("github") || subject.toLowerCase().includes("launch code");

          if (matchSender || matchSubject) {
            const fullText = `${subject} ${preview} ${bodyContent}`;
            const otp = this._extractOtpFromText(fullText);

            if (otp) {
              console.log(`\n🎉 \x1b[32m[HOTMAIL OTP SUCCESS]\x1b[0m Đã nhận mã xác thực từ GitHub: [ \x1b[1m${otp}\x1b[0m ] (Từ: ${fromAddress})`);
              return {
                otpCode: otp,
                subject,
                sender: fromAddress,
                receivedTime: msg.receivedDateTime,
                message: msg,
              };
            }
          }
        }
      } catch (err) {
        console.warn(`   ⚠️ [Hotmail Polling #${pollCount}] Lỗi kết nối Graph API: ${err.message} -> Thử lại ngay...`);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timeout: Không nhận được mã OTP từ GitHub sau ${Math.round(timeoutMs / 1000)}s.`);
  }

  // Getters
  get email() {
    return this._email;
  }
  get recoveryEmail() {
    return this._recoveryEmail;
  }
}
