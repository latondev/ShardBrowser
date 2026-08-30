/**
 * ==============================================================================
 * ACCOUNT STORAGE SERVICE (DUAL-MODE STORAGE WITH RETRY & FALLBACK)
 * ==============================================================================
 * Quản lý việc lưu trữ tài khoản từ Tool Client:
 * - Chế độ "local" : Ghi vào file output.txt và github-2fa-secrets.txt cục bộ.
 * - Chế độ "api"   : Gửi trực tiếp lên Server DesployGit qua REST API.
 * - Chế độ "both"  : Lưu song song cả Local và gửi Server.
 * - Cơ chế Fallback: Nếu gửi API thất bại (mất mạng, server offline), tự động
 *                    lưu vào file fallback để đảm bảo KHÔNG BAO GIỜ MẤT TÀI KHOẢN.
 * 
 * Quy tắc đặt tên biến:
 * - Biến/Phương thức private: _{name}
 * - Biến/Phương thức public: {nameValue}
 * ==============================================================================
 */

import axios from "axios";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { writeFile, appendFile, chmod } from "node:fs/promises";

// Tự động nạp .env nếu có mà không cần thư viện dotenv bên ngoài
if (typeof process.loadEnvFile === "function" && existsSync(path.join(process.cwd(), ".env"))) {
  try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch {}
}

export class AccountStorageService {
  // Private / Protected Properties
  _storageMode = "local"; // "local" | "api" | "both"
  _serverUrl = "http://127.0.0.1:8080";
  _apiKey = "shardx-secret-api-key-2026-very-secure";
  _localOutputPath = "";
  _fallbackOutputPath = "";
  _secretsOutputPath = "";

  constructor(customConfig = {}) {
    this._storageMode = process.env.STORAGE_MODE || customConfig.storageMode || "local";
    this._serverUrl = (process.env.REMOTE_SERVER_URL || customConfig.serverUrl || "http://127.0.0.1:8080").replace(/\/+$/, "");
    this._apiKey = process.env.REMOTE_API_KEY || customConfig.apiKey || "shardx-secret-api-key-2026-very-secure";

    this._localOutputPath = path.join(process.cwd(), "Testing", "git", "output.txt");
    this._fallbackOutputPath = path.join(process.cwd(), "Testing", "git", "fallback_accounts.txt");
    this._secretsOutputPath = path.join(process.cwd(), "github-2fa-secrets.txt");
  }

  // Phương thức lưu tài khoản chính
  async saveAccount(accountData = {}) {
    const { email, password, username = "", twoFactorSecret = "", recoveryCodes = [], proxy = null } = accountData;

    if (!email || !password) {
      console.warn("⚠️ [Storage] Bỏ qua vì thiếu Email hoặc Mật khẩu!");
      return { success: false, reason: "Missing credentials" };
    }

    const proxyStr = proxy ? (typeof proxy === "string" ? proxy : `${proxy.host || ""}:${proxy.port || ""}`) : "Direct";
    const lineFormatted = `${email}|${password}|${twoFactorSecret || ""}`;

    const results = {
      localSaved: false,
      apiSaved: false,
      fallbackUsed: false
    };

    // 1. Lưu Local nếu chế độ là "local" hoặc "both"
    if (this._storageMode === "local" || this._storageMode === "both") {
      await this._saveToLocalFiles({ email, username, password, twoFactorSecret, recoveryCodes, proxyStr, lineFormatted });
      results.localSaved = true;
    }

    // 2. Gửi API nếu chế độ là "api" hoặc "both"
    if (this._storageMode === "api" || this._storageMode === "both") {
      const apiSuccess = await this._sendToRemoteApi({
        email,
        username,
        password,
        twoFactorSecret,
        recoveryCodes,
        proxy: proxyStr
      });

      if (apiSuccess) {
        results.apiSaved = true;
      } else {
        // Fallback: Nếu gửi API thất bại và chưa lưu local, lập tức ghi vào file fallback
        if (!results.localSaved) {
          console.warn("🚨 [Storage Fallback] Gửi API thất bại! Đang lưu khẩn cấp vào file cục bộ để chống mất account...");
          await this._saveToFallbackFile(lineFormatted);
          results.fallbackUsed = true;
        }
      }
    }

    return results;
  }

  // Ghi vào file local chuẩn
  async _saveToLocalFiles({ email, username, password, twoFactorSecret, recoveryCodes, proxyStr, lineFormatted }) {
    try {
      // Ghi secrets chi tiết
      const secretsContent = `GitHub Email: ${email}\nUsername: ${username}\nPassword: ${password}\n2FA Secret: ${twoFactorSecret}\nProxy: ${proxyStr}\n\nRecovery Codes:\n${(recoveryCodes || []).join("\n")}\n`;
      await writeFile(this._secretsOutputPath, secretsContent, "utf8").catch(() => {});
      await chmod(this._secretsOutputPath, 0o600).catch(() => {});

      // Ghi nối tiếp vào output.txt
      let prefixNewline = "";
      if (existsSync(this._localOutputPath)) {
        const currentContent = readFileSync(this._localOutputPath, "utf8");
        if (currentContent.length > 0 && !currentContent.endsWith("\n")) {
          prefixNewline = "\n";
        }
      }
      await appendFile(this._localOutputPath, `${prefixNewline}${lineFormatted}\n`, "utf8");
      console.log(`📁 [Storage Local] Đã lưu tài khoản vào: Testing/git/output.txt`);
    } catch (err) {
      console.error(`❌ [Storage Local Error] Không thể ghi file local: ${err.message}`);
    }
  }

  // Gửi dữ liệu qua REST API Server
  async _sendToRemoteApi(payload) {
    const endpoint = `${this._serverUrl}/api/v1/accounts`;
    try {
      console.log(`🌐 [Storage API] Đang gửi tài khoản về Server: ${endpoint}...`);
      const response = await axios.post(endpoint, payload, {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this._apiKey
        },
        timeout: 8000
      });

      if (response.status === 200 || response.status === 201) {
        console.log(`✅ [Storage API] Gửi Server thành công! (ID: ${response.data?.data?.id || "N/A"})`);
        return true;
      }
      return false;
    } catch (err) {
      console.error(`❌ [Storage API Error] Lỗi khi gửi API: ${err.response?.data?.error || err.message}`);
      return false;
    }
  }

  // Ghi vào file fallback khẩn cấp
  async _saveToFallbackFile(lineFormatted) {
    try {
      let prefixNewline = "";
      if (existsSync(this._fallbackOutputPath)) {
        const current = readFileSync(this._fallbackOutputPath, "utf8");
        if (current.length > 0 && !current.endsWith("\n")) {
          prefixNewline = "\n";
        }
      }
      await appendFile(this._fallbackOutputPath, `${prefixNewline}${lineFormatted}\n`, "utf8");
      console.log(`💾 [Storage Fallback] Đã bảo vệ an toàn tài khoản tại: Testing/git/fallback_accounts.txt`);
    } catch (err) {
      console.error(`💥 [Storage Critical Error] Không thể lưu file fallback: ${err.message}`);
    }
  }
}
