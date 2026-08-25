/**
 * ==============================================================================
 * GMAIL CREATOR API CLIENT (NODE.JS / ES MODULES)
 * ==============================================================================
 * Module tích hợp 0xfarben/gmail-creator-api qua RapidAPI:
 * - Sinh hòm thư tạm thật 100% dạng @gmail.com.
 * - Lắng nghe hộp thư và bóc tách mã OTP 6-8 chữ số tự động từ GitHub.
 * 
 * Quy tắc đặt tên biến:
 * - Biến/Phương thức private/protected: _{name}
 * - Biến/Phương thức public: {nameValue} (camelCase)
 * ==============================================================================
 */

import axios from "axios";
import { existsSync, readFileSync } from "node:fs";

export class GmailCreatorClient {
  // Private / Protected Properties
  _apiKey = "";
  _apiKeys = [];
  _apiHost = "free-gmail-api.p.rapidapi.com";
  _baseUrl = "https://free-gmail-api.p.rapidapi.com";
  _currentEmail = "";
  _currentUsername = "";

  constructor(apiKey = process.env.RAPIDAPI_KEY) {
    this._apiKey = apiKey || "";
    this._apiKeys = this._loadApiKeys();
    if (!this._apiKey && this._apiKeys.length > 0) {
      this._apiKey = this._apiKeys[0];
    }
  }

  // Đọc toàn bộ API keys từ rapidapikey.md
  _loadApiKeys() {
    const keys = [];
    try {
      if (existsSync("Testing/git/rapidapikey.md")) {
        const raw = readFileSync("Testing/git/rapidapikey.md", "utf8");
        const lines = raw.split("\n");
        for (const line of lines) {
          const clean = line.split("|")[0].trim().replace(/[>#\s]/g, "");
          if (clean && clean.length >= 30) {
            keys.push(clean);
          }
        }
      }
    } catch {}
    if (this._apiKey && !keys.includes(this._apiKey)) {
      keys.unshift(this._apiKey);
    }
    if (keys.length === 0) {
      keys.push("b6886ec1f7mshbb17b1e26e0fab2p11d6b0jsna02d376b7db5");
    }
    return keys;
  }

  // Đợi an toàn
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Tạo headers chuẩn RapidAPI với key hiện tại
  _getHeaders(customKey) {
    return {
      "Content-Type": "application/json",
      "x-rapidapi-host": this._apiHost,
      "x-rapidapi-key": customKey || this._apiKey,
    };
  }

  // Trích xuất mã OTP 6 - 8 số từ tiêu đề hoặc nội dung email
  _extractOtpCode(rawText) {
    if (!rawText) return null;
    const clean = String(rawText);

    // Ưu tiên 1: Cụm từ định danh của GitHub
    const launchMatch = clean.match(/(?:launch code|verification code|verify your account|security code)[^\d]{0,20}(\d{6,8})/i);
    if (launchMatch && launchMatch[1]) return launchMatch[1].trim();

    // Ưu tiên 2: Cụm số nằm trong dấu ngoặc vuông [ 12345678 ]
    const bracketMatch = clean.match(/\[\s*(\d{6,8})\s*\]/);
    if (bracketMatch && bracketMatch[1]) return bracketMatch[1].trim();

    // Ưu tiên 3: Bất kỳ chuỗi 6 hoặc 8 chữ số đứng độc lập
    const numMatch = clean.match(/\b\d{8}\b/) || clean.match(/\b\d{6}\b/);
    if (numMatch && numMatch[0]) return numMatch[0].trim();

    return null;
  }

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  // Tạo địa chỉ Gmail tạm thời mới (tự động thử các key trong pool)
  async createAccount(maxRetries = 2) {
    // Đọc danh sách key mới nhất từ rapidapikey.md trong thời gian thực
    const rawKeys = this._loadApiKeys();
    // Xáo trộn ngẫu nhiên để chia đều tải cho tất cả các key
    this._apiKeys = [...rawKeys].sort(() => Math.random() - 0.5);
    console.log(`⏳ [Gmail API] Đang yêu cầu sinh địa chỉ @gmail.com mới từ RapidAPI (${this._apiKeys.length} keys sẵn sàng trong pool)...`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      for (let i = 0; i < this._apiKeys.length; i++) {
        const activeKey = this._apiKeys[i];
        try {
          const res = await axios.post(
            `${this._baseUrl}/generate-email`,
            { email: ["Gmail"] },
            { headers: this._getHeaders(activeKey), timeout: 25000 }
          );

          const email = res.data?.email;
          if (email && typeof email === "string" && email.includes("@")) {
            this._apiKey = activeKey;
            this._currentEmail = email;
            // Sinh username hợp lệ từ prefix trước @
            const rawUser = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
            this._currentUsername = `user${rawUser.slice(0, 12)}${Math.random().toString(36).substring(2, 5)}`;

            console.log(`✅ [Gmail Tạo Thành Công]: ${this._currentEmail} (User: ${this._currentUsername}) | Key [${activeKey.slice(0, 10)}...]`);
            return {
              address: this._currentEmail,
              username: this._currentUsername,
            };
          }
        } catch (err) {
          const errMsg = err.response?.data?.message || err.response?.data?.detail || err.message;
          console.warn(`(!) Key [${activeKey.slice(0, 10)}...] gặp lỗi (${errMsg}) -> Thử key tiếp theo...`);
        }
      }
      if (attempt < maxRetries) {
        console.log(`⏳ Máy chủ bận, chờ 3s trước khi thử lại lần ${attempt + 1}/${maxRetries}...`);
        await this._sleep(3000);
      }
    }

    throw new Error(`Máy chủ RapidAPI Gmail hiện đang tạm thời bận/bảo trì. Vui lòng thử lại sau giây lát.`);
  }

  // Lấy danh sách tin nhắn trong hộp thư (tự động thử các key)
  async getMessages(email = this._currentEmail) {
    if (!email) throw new Error("Chưa có địa chỉ email để kiểm tra hộp thư.");
    const keys = this._apiKeys.length > 0 ? this._apiKeys : this._loadApiKeys();

    for (const key of keys) {
      try {
        const res = await axios.post(
          `${this._baseUrl}/message-list`,
          { email },
          { headers: this._getHeaders(key), timeout: 12000 }
        );

        const msgs = res.data?.messages;
        if (Array.isArray(msgs)) return msgs;
      } catch (err) {
        // Tiếp tục thử nếu là timeout hoặc network
      }
    }
    return [];
  }

  // Lấy chi tiết nội dung 1 tin nhắn
  async getMessageDetails(messageId, email = this._currentEmail) {
    if (!messageId || !email) return null;
    const keys = this._apiKeys.length > 0 ? this._apiKeys : this._loadApiKeys();

    for (const key of keys) {
      try {
        const res = await axios.post(
          `${this._baseUrl}/message-details`,
          { email, message_id: messageId },
          { headers: this._getHeaders(key), timeout: 12000 }
        );
        if (res.data) return res.data;
      } catch (err) {}
    }
    return null;
  }

  // Lắng nghe và trích xuất mã OTP từ GitHub
  async waitForVerificationCode(maxWaitSeconds = 120, pollIntervalSeconds = 2.5) {
    const email = this._currentEmail;
    if (!email) throw new Error("Chưa có địa chỉ email để nhận mã OTP.");

    console.log(`📬 [Gmail API] Đang lắng nghe thư đến cho [${email}] (Timeout: ${maxWaitSeconds}s)...`);
    const startTime = Date.now();
    const maxTime = maxWaitSeconds * 1000;
    const pollInterval = pollIntervalSeconds * 1000;

    while (Date.now() - startTime < maxTime) {
      const messages = await this.getMessages(email);

      // Lọc bỏ các tin nhắn quảng cáo mặc định (ADSVPN, etc.)
      const realMessages = messages.filter(
        (m) => m && m.messageID !== "ADSVPN" && (
          (m.from && String(m.from).toLowerCase().includes("github")) ||
          (m.subject && String(m.subject).toLowerCase().includes("github")) ||
          (m.subject && String(m.subject).toLowerCase().includes("launch code")) ||
          (m.subject && String(m.subject).toLowerCase().includes("verification"))
        )
      );

      if (realMessages.length > 0) {
        const targetMsg = realMessages[0];
        console.log(`✨ [Gmail API] Phát hiện thư từ: [${targetMsg.from}] | Tiêu đề: "${targetMsg.subject}"`);

        // 1. Thử lấy mã trực tiếp từ tiêu đề
        let otp = this._extractOtpCode(targetMsg.subject);
        if (otp) {
          console.log(`🔥 [Gmail OTP] Trích xuất thành công mã OTP từ tiêu đề: [ ${otp} ]`);
          return { otpCode: otp, subject: targetMsg.subject, from: targetMsg.from };
        }

        // 2. Lấy nội dung chi tiết nếu trong tiêu đề chưa có mã
        const details = await this.getMessageDetails(targetMsg.messageID, email);
        if (details) {
          const combinedBody = `${details.refined_content || ""} ${details.subject || ""}`;
          otp = this._extractOtpCode(combinedBody);
          if (otp) {
            console.log(`🔥 [Gmail OTP] Trích xuất thành công mã OTP từ nội dung thư: [ ${otp} ]`);
            return { otpCode: otp, subject: targetMsg.subject, from: targetMsg.from };
          }
        }
      }

      await this._sleep(pollInterval);
    }

    throw new Error(`Hết thời gian chờ mã OTP (${maxWaitSeconds}s) cho hòm thư ${email}`);
  }

  getCurrentEmail() {
    return this._currentEmail;
  }

  getCurrentUsername() {
    return this._currentUsername;
  }
}
