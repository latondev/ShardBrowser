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
    const parts = accountLine.trim().split("|");
    this._email = parts[0] || null;
    this._password = parts[1] || null;
    this._refreshToken = parts[2] || null;
    this._clientId = parts[3] || this._clientId;
    this._recoveryEmail = parts[4] || null;
  }

  // Trích xuất mã OTP 6-8 chữ số từ nội dung email
  _extractOtpFromText(text) {
    if (!text) return null;

    // Pattern 1: Tìm cụm từ chứa mã như "is 123456", "code: 123456", "OTP: 123456"
    const patternContext = /(?:code|mã|verification|otp|pin|is|là)[:\s]+([0-9]{6,8})/i;
    const matchContext = text.match(patternContext);
    if (matchContext && matchContext[1]) {
      return matchContext[1];
    }

    // Pattern 2: Tìm 6 chữ số đứng độc lập
    const patternDigits = /\b([0-9]{6,8})\b/;
    const matchDigits = text.match(patternDigits);
    if (matchDigits && matchDigits[1]) {
      return matchDigits[1];
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
   * Lấy danh sách thư mới nhất từ Hộp thư đến (Inbox)
   * @param {number} top Số lượng thư muốn lấy (mặc định: 10)
   * @returns {Promise<Array>} Danh sách email
   */
  async getInboxMessages(top = 10) {
    const token = await this.getAccessToken();
    const url = `${this._graphBaseUrl}/me/mailFolders/inbox/messages?$top=${top}&$select=id,from,subject,bodyPreview,receivedDateTime,body`;

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
   * @param {number} options.timeoutMs Thời gian chờ tối đa (mặc định 60s)
   * @param {number} options.intervalMs Chu kỳ kiểm tra lại (mặc định 3s)
   * @returns {Promise<{otpCode: string, message: object}>}
   */
  async waitForOtpCode({ filterSender = "", filterSubject = "", timeoutMs = 60000, intervalMs = 3000 } = {}) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const messages = await this.getInboxMessages(5);

        for (const msg of messages) {
          const fromAddress = msg.from?.emailAddress?.address || "";
          const subject = msg.subject || "";
          const preview = msg.bodyPreview || "";
          const bodyContent = msg.body?.content || "";

          // Kiểm tra bộ lọc
          const matchSender = !filterSender || fromAddress.toLowerCase().includes(filterSender.toLowerCase());
          const matchSubject = !filterSubject || subject.toLowerCase().includes(filterSubject.toLowerCase());

          if (matchSender && matchSubject) {
            const fullText = `${subject} ${preview} ${bodyContent}`;
            const otp = this._extractOtpFromText(fullText);

            if (otp) {
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
        // Nếu lỗi tạm thời thì thử lại ở lượt sau
        console.warn(`[HotmailGraphClient] Polling warning: ${err.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timeout: Không nhận được mã OTP sau ${Math.round(timeoutMs / 1000)}s.`);
  }

  // Getters
  get email() {
    return this._email;
  }
  get recoveryEmail() {
    return this._recoveryEmail;
  }
}
