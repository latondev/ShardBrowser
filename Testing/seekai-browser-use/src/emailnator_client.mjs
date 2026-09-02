/**
 * ==============================================================================
 * EMAILNATOR CLIENT (DISPOSABLE GMAIL GENERATOR & OTP EXTRACTOR)
 * ==============================================================================
 * Dịch vụ cung cấp địa chỉ @gmail.com (dotGmail / plusGmail) và nhận OTP tự động:
 * - Gọi trực tiếp REST API của Emailnator.
 * - Sinh hòm thư @gmail.com thật trong 0.3s.
 * - Tự động lắng nghe & trích xuất mã xác thực OTP từ SeekAI / các dịch vụ khác.
 * ==============================================================================
 */

import axios from "axios";

export class EmailnatorClient {
  _baseUrl = "https://www.emailnator.com/api";
  _currentEmail = null;
  _currentUsername = null;

  _headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Origin": "https://www.emailnator.com",
    "Referer": "https://www.emailnator.com/",
    "Accept": "application/json, text/plain, */*",
  };

  constructor() {}

  /**
   * Tạo hòm thư @gmail.com mới
   * @param {object} options Tùy chọn loại Gmail (dotGmail: 3, plusGmail: 2, googleMail: 8)
   */
  async createAccount(options = {}) {
    const {
      useDotGmail = true,
      usePlusGmail = false,
      useGoogleMail = false,
    } = options;

    const ids = [];
    if (useDotGmail) ids.push(3);
    if (usePlusGmail) ids.push(2);
    if (useGoogleMail) ids.push(8);
    if (ids.length === 0) ids.push(3);

    console.log(`⏳ [Emailnator] Đang yêu cầu cấp địa chỉ @gmail.com mới...`);

    let lastError = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await axios.post(
          `${this._baseUrl}/generate-email`,
          { ids },
          { headers: this._headers, timeout: 15000 }
        );

        if (res.data?.status === "success" && res.data?.email) {
          this._currentEmail = res.data.email.trim();
          const cleanUser = this._currentEmail.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
          this._currentUsername = `u${cleanUser.slice(0, 8)}${Math.random().toString(36).substring(2, 6)}`;

          console.log(`✅ [Emailnator Cấp Gmail Thành Công]: ${this._currentEmail} (Username: ${this._currentUsername})`);
          return {
            address: this._currentEmail,
            email: this._currentEmail,
            username: this._currentUsername,
          };
        }

        if (res.data?.message?.includes("Too many requests")) {
          console.log(`⏳ [Emailnator Rate-limit] Đợi 5s để thử lại...`);
          await new Promise((r) => setTimeout(r, 5500));
        }
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    throw new Error(`Emailnator Error: Không thể tạo Gmail sau các lần thử. (${lastError?.message || "Unknown"})`);
  }

  /**
   * Lấy danh sách email trong hộp thư đến
   */
  async getMessages(email = this._currentEmail) {
    if (!email) throw new Error("Chưa có địa chỉ email.");

    const res = await axios.post(
      `${this._baseUrl}/message-list`,
      { email },
      { headers: this._headers, timeout: 15000 }
    );

    if (res.data?.status === "success" && Array.isArray(res.data?.messages)) {
      return res.data.messages;
    }
    return [];
  }

  /**
   * Lấy nội dung chi tiết của một thư
   */
  async getMessageDetail(messageId, email = this._currentEmail) {
    if (!messageId || !email) return null;

    try {
      const res = await axios.post(
        `${this._baseUrl}/message-list`,
        { email, messageID: messageId },
        { headers: this._headers, timeout: 15000 }
      );
      return res.data;
    } catch {
      return null;
    }
  }

  /**
   * Trích xuất mã OTP từ text/subject/content
   */
  _extractOtp(text) {
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

  /**
   * Lắng nghe và tự động trích xuất mã OTP
   */
  async waitForOtpCode(email = this._currentEmail, timeoutMs = 90000) {
    const targetEmail = email || this._currentEmail;
    if (!targetEmail) throw new Error("Chưa khởi tạo email Emailnator.");

    console.log(`⏳ [Emailnator Gmail] Đang lắng nghe thư đến cho [${targetEmail}] (Timeout: ${timeoutMs / 1000}s)...`);
    const startTime = Date.now();
    const processedMsgIds = new Set();

    // Lưu các message id đã có từ trước (nếu có)
    try {
      const initialMsgs = await this.getMessages(targetEmail);
      for (const m of initialMsgs) {
        if (m.id) processedMsgIds.add(m.id);
      }
    } catch {}

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 3000));

      try {
        const messages = await this.getMessages(targetEmail);

        for (const msg of messages) {
          const from = msg.from || "";
          const subject = msg.subject || "";
          const isNew = !processedMsgIds.has(msg.id);

          // 1. Thử trích xuất từ Subject
          let otp = this._extractOtp(subject);

          // 2. Nếu là thư mới từ SeekAI / dịch vụ xác thực, thử đọc chi tiết
          if (!otp && isNew) {
            const detail = await this.getMessageDetail(msg.id, targetEmail);
            if (detail) {
              const fullText = typeof detail === "object" ? JSON.stringify(detail) : String(detail);
              otp = this._extractOtp(fullText);
            }
          }

          if (otp) {
            console.log(`🎉 [Emailnator Gmail OTP]: Nhận được mã OTP [ ${otp} ] từ [${from}] - "${subject}"`);
            return otp;
          }

          if (msg.id) processedMsgIds.add(msg.id);
        }
      } catch (err) {
        console.warn(`[Emailnator Polling Warning]: ${err.message}`);
      }
    }

    throw new Error(`Timeout: Không nhận được mã OTP từ Emailnator Gmail cho [${targetEmail}] sau ${timeoutMs / 1000}s.`);
  }

  get address() {
    return this._currentEmail;
  }
  get email() {
    return this._currentEmail;
  }
  get username() {
    return this._currentUsername;
  }
}
