import axios from "axios";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class GmailCreatorClient {
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

  _loadApiKeys() {
    const keys = [];
    const candidatePaths = [
      path.resolve(__dirname, "..", "..", "git", "rapidapikey.md"),
      path.resolve(__dirname, "..", "rapidapikey.md"),
      path.resolve(process.cwd(), "Testing", "git", "rapidapikey.md"),
      path.resolve(process.cwd(), "rapidapikey.md"),
    ];

    for (const p of candidatePaths) {
      if (existsSync(p)) {
        try {
          const raw = readFileSync(p, "utf8");
          const lines = raw.split("\n");
          for (const line of lines) {
            const clean = line.split("|")[0].trim().replace(/[>#\s]/g, "");
            if (clean && clean.length >= 30 && !keys.includes(clean)) {
              keys.push(clean);
            }
          }
          if (keys.length > 0) break;
        } catch {}
      }
    }

    if (this._apiKey && !keys.includes(this._apiKey)) {
      keys.unshift(this._apiKey);
    }
    return keys;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _getHeaders(customKey) {
    return {
      "Content-Type": "application/json",
      "x-rapidapi-host": this._apiHost,
      "x-rapidapi-key": customKey || this._apiKey,
    };
  }

  _extractOtpCode(rawText) {
    if (!rawText) return null;
    const clean = String(rawText);
    const launchMatch = clean.match(/(?:launch code|verification code|verify your account|security code)[^\d]{0,20}(\d{6,8})/i);
    if (launchMatch && launchMatch[1]) return launchMatch[1].trim();

    const bracketMatch = clean.match(/\[\s*(\d{6,8})\s*\]/);
    if (bracketMatch && bracketMatch[1]) return bracketMatch[1].trim();

    const numMatch = clean.match(/\b\d{8}\b/) || clean.match(/\b\d{6}\b/);
    if (numMatch && numMatch[0]) return numMatch[0].trim();

    return null;
  }

  async createAccount(maxRetries = 2) {
    const rawKeys = this._loadApiKeys();
    this._apiKeys = [...rawKeys].sort(() => Math.random() - 0.5);
    console.log(`⏳ [RapidAPI Gmail] Đang quét ${this._apiKeys.length} keys trong pool để cấp @gmail.com mới...`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      for (let i = 0; i < this._apiKeys.length; i++) {
        const activeKey = this._apiKeys[i];
        process.stdout.write(`\r🔍 Thử key [${i + 1}/${this._apiKeys.length} - ${activeKey.slice(0, 8)}...] `);

        try {
          const res = await axios.post(
            `${this._baseUrl}/generate-email`,
            { email: ["Gmail"] },
            { headers: this._getHeaders(activeKey), timeout: 5000 }
          );

          const email = res.data?.email;
          if (email && typeof email === "string" && email.includes("@")) {
            this._apiKey = activeKey;
            this._currentEmail = email;
            const rawUser = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
            this._currentUsername = `user${rawUser.slice(0, 10)}${Math.random().toString(36).substring(2, 6)}`;

            console.log(`\n✅ [Gmail Cấp Mới Thành Công]: ${this._currentEmail} (Username: ${this._currentUsername}) | Key [${activeKey.slice(0, 8)}...]`);
            return {
              address: this._currentEmail,
              username: this._currentUsername,
            };
          }
        } catch (err) {
          // Timeout hoặc lỗi -> thử key tiếp theo ngay
        }
      }
      console.log("\n");
      if (attempt < maxRetries) {
        await this._sleep(2000);
      }
    }

    throw new Error("RAPIDAPI_QUOTA_EXHAUSTED: Toàn bộ key trong pool đều bận hoặc hết lượt tạo.");
  }

  async getMessages(email = this._currentEmail) {
    if (!email) throw new Error("Chưa có địa chỉ email.");
    const keys = this._apiKeys.length > 0 ? this._apiKeys : this._loadApiKeys();

    for (const key of keys) {
      try {
        const res = await axios.post(
          `${this._baseUrl}/message-list`,
          { email },
          { headers: this._getHeaders(key), timeout: 6000 }
        );
        const msgs = res.data?.messages;
        if (Array.isArray(msgs)) return msgs;
      } catch {}
    }
    return [];
  }

  async waitForOtpCode(email = this._currentEmail, timeoutMs = 60000) {
    const startTime = Date.now();
    console.log(`⏳ [RapidAPI Gmail] Đang lắng nghe thư đến cho [${email}]...`);

    while (Date.now() - startTime < timeoutMs) {
      try {
        const messages = await this.getMessages(email);
        if (Array.isArray(messages) && messages.length > 0) {
          for (const msg of messages) {
            const raw = typeof msg === "object" ? `${msg.subject || ""} ${msg.text || ""} ${msg.content || ""}` : String(msg);
            const code = this._extractOtpCode(raw);
            if (code) {
              console.log(`🎉 [OTP Nhận Thành Công]: Mã xác nhận là [${code}]`);
              return code;
            }
          }
        }
      } catch {}
      await this._sleep(3000);
    }
    throw new Error(`Timeout: Không nhận được mã OTP cho [${email}] sau ${timeoutMs / 1000}s`);
  }
}
