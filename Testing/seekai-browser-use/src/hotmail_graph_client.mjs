/**
 * ==============================================================================
 * HOTMAIL GRAPH CLIENT (ES MODULES)
 * ==============================================================================
 * Quản lý tài khoản Hotmail/Outlook có Refresh Token & nhận OTP qua Microsoft Graph API.
 * ==============================================================================
 */

import axios from "axios";

export class HotmailGraphClient {
  _email = null;
  _password = null;
  _refreshToken = null;
  _clientId = "9e5f94bc-e8a4-4e73-b8be-63364c29d753";
  _recoveryEmail = null;
  _accessToken = null;
  _tokenExpiresAt = 0;

  _tokenEndpoint = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
  _graphBaseUrl = "https://graph.microsoft.com/v1.0";

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

  _extractOtpFromText(text) {
    if (!text) return null;
    const clean = String(text).replace(/<[^>]+>/g, " ");

    const launchMatch = clean.match(/(?:launch code|verification code|verify your account|security code|mã xác minh|mã xác thực|otp|code)[^\d]{0,20}(\d{6,8})/i);
    if (launchMatch && launchMatch[1]) return launchMatch[1].trim();

    const bracketMatch = clean.match(/\[\s*(\d{6,8})\s*\]/);
    if (bracketMatch && bracketMatch[1]) return bracketMatch[1].trim();

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
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
   * Chờ và nhận mã OTP (tương thích interface emailClient)
   */
  async waitForOtpCode(email = this._email, timeoutMs = 60000) {
    const startTime = Date.now();
    console.log(`⏳ [Hotmail Graph API] Đang lắng nghe thư đến cho [${this._email}] (Timeout: ${timeoutMs / 1000}s)...`);

    while (Date.now() - startTime < timeoutMs) {
      try {
        const messages = await this.getInboxMessages(5);

        for (const msg of messages) {
          const fromAddress = msg.from?.emailAddress?.address || "";
          const subject = msg.subject || "";
          const preview = msg.bodyPreview || "";
          const bodyContent = msg.body?.content || "";

          const fullText = `${subject} ${preview} ${bodyContent}`;
          const otp = this._extractOtpFromText(fullText);

          if (otp) {
            console.log(`🎉 [Hotmail OTP Thành Công]: Nhận được mã OTP [ ${otp} ] từ [${fromAddress}] - "${subject}"`);
            return otp;
          }
        }
      } catch (err) {
        console.warn(`[Hotmail Graph Polling]: ${err.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error(`Timeout: Không nhận được mã OTP qua Hotmail Graph API cho [${this._email}] sau ${Math.round(timeoutMs / 1000)}s.`);
  }

  get address() {
    return this._email;
  }
  get username() {
    return (this._email || "").split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  }
  get email() {
    return this._email;
  }
  get password() {
    return this._password;
  }
}
