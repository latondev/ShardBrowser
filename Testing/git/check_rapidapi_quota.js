/**
 * ==============================================================================
 * RAPIDAPI QUOTA MONITOR & REPORTING TOOL
 * ==============================================================================
 * 
 * Kiểm tra hạn mức sử dụng (Used, Remaining, Limit) của tất cả RapidAPI Key
 * được định nghĩa trong Testing/git/rapidapikey.md.
 */

import axios from "axios";
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI Color Codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

export class RapidApiQuotaChecker {
  _filePath = "";
  _keys = [];

  constructor(filePath) {
    if (filePath) {
      this._filePath = filePath;
    } else {
      const localPath = path.join(__dirname, "rapidapikey.md");
      const rootPath = path.join(process.cwd(), "Testing", "git", "rapidapikey.md");
      this._filePath = fs.existsSync(localPath) ? localPath : rootPath;
    }
  }

  // Đọc danh sách key từ file
  _loadKeys() {
    if (!fs.existsSync(this._filePath)) {
      throw new Error(`Không tìm thấy file: ${this._filePath}`);
    }
    const content = fs.readFileSync(this._filePath, "utf8");
    const lines = content.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));

    this._keys = lines.map((line, idx) => {
      const parts = line.split("|").map(s => s.trim());
      return {
        stt: idx + 1,
        apiKey: parts[0],
        username: parts[1] || `Account_${idx + 1}`,
      };
    });

    return this._keys;
  }

  // Kiểm tra quota của 1 key
  async _checkSingleKey(item) {
    const { stt, apiKey, username } = item;
    try {
      const res = await axios.post(
        "https://free-gmail-api.p.rapidapi.com/generate-email",
        { email: ["Gmail"] },
        {
          headers: {
            "Content-Type": "application/json",
            "x-rapidapi-host": "free-gmail-api.p.rapidapi.com",
            "x-rapidapi-key": apiKey,
          },
          timeout: 15000,
        }
      );

      const limit = parseInt(res.headers["x-ratelimit-requests-limit"] || res.headers["x-ratelimit-limit"] || "100", 10);
      const remaining = parseInt(res.headers["x-ratelimit-requests-remaining"] || res.headers["x-ratelimit-remaining"] || "0", 10);
      const used = Math.max(0, limit - remaining);

      return {
        stt,
        username,
        apiKey,
        limit,
        remaining,
        used,
        status: "ACTIVE",
        message: "Hoạt động tốt",
      };
    } catch (err) {
      const statusCode = err.response?.status;
      const headers = err.response?.headers || {};
      const limit = parseInt(headers["x-ratelimit-requests-limit"] || "100", 10);
      const remaining = parseInt(headers["x-ratelimit-requests-remaining"] || "0", 10);
      const used = Math.max(0, limit - remaining);

      if (statusCode === 429) {
        return {
          stt,
          username,
          apiKey,
          limit,
          remaining: 0,
          used: limit,
          status: "QUOTA_EXCEEDED",
          message: "Hết 100/100 lượt (Chờ reset 24h)",
        };
      }

      if (statusCode === 403) {
        return {
          stt,
          username,
          apiKey,
          limit: 0,
          remaining: 0,
          used: 0,
          status: "FORBIDDEN",
          message: "Chưa Subscribe Free trên RapidAPI",
        };
      }

      if (statusCode === 500 || statusCode === 502) {
        return {
          stt,
          username,
          apiKey,
          limit,
          remaining,
          used,
          status: "SERVER_BUSY",
          message: "Server bận (Key còn lượt)",
        };
      }

      return {
        stt,
        username,
        apiKey,
        limit: 0,
        remaining: 0,
        used: 0,
        status: "ERROR",
        message: err.message,
      };
    }
  }

  // Chạy kiểm tra toàn bộ
  async runReport() {
    this._loadKeys();
    console.log(`\n${BOLD}${CYAN}========================================================================================================${RESET}`);
    console.log(`${BOLD}${CYAN}                      BÁO CÁO HẠN MỨC SỬ DỤNG RAPIDAPI (GMAIL CREATOR POOL)                             ${RESET}`);
    console.log(`${BOLD}${CYAN}========================================================================================================${RESET}`);
    console.log(`${GRAY}Đang kiểm tra ${this._keys.length} tài khoản trong danh sách... Vui lòng chờ giây lát.${RESET}\n`);

    // Xử lý song song từng nhóm 5 keys để nhanh nhưng không bị nghẽn mạng
    const results = [];
    const chunkSize = 5;
    for (let i = 0; i < this._keys.length; i += chunkSize) {
      const chunk = this._keys.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map(k => this._checkSingleKey(k)));
      results.push(...chunkResults);
    }

    // In bảng kết quả
    console.log(`+-----+--------------------------+-----------------+----------+----------+---------+-------------------------------+`);
    console.log(`| STT | Username / Account       | Key (Rút gọn)   | Đã Dùng  | Còn Lại  | Hạn Mức | Trạng Thái                    |`);
    console.log(`+-----+--------------------------+-----------------+----------+----------+---------+-------------------------------+`);

    let totalUsed = 0;
    let totalRemaining = 0;
    let totalLimit = 0;
    let activeKeysCount = 0;
    let exhaustedKeysCount = 0;

    for (const r of results) {
      totalUsed += r.used;
      totalRemaining += r.remaining;
      totalLimit += r.limit;

      let statusFormatted = "";
      if (r.status === "ACTIVE") {
        activeKeysCount++;
        statusFormatted = `${GREEN}✅ ${r.message}${RESET}`;
      } else if (r.status === "SERVER_BUSY") {
        activeKeysCount++;
        statusFormatted = `${YELLOW}⏳ ${r.message}${RESET}`;
      } else if (r.status === "QUOTA_EXCEEDED") {
        exhaustedKeysCount++;
        statusFormatted = `${RED}⚠️  ${r.message}${RESET}`;
      } else {
        statusFormatted = `${RED}❌ ${r.message}${RESET}`;
      }

      const sttStr = r.stt.toString().padEnd(3);
      const userStr = r.username.padEnd(24);
      const keyStr = `${r.apiKey.slice(0, 10)}...`.padEnd(15);
      const usedStr = `${r.used}`.padStart(6) + "   ";
      const remStr = `${r.remaining}`.padStart(6) + "   ";
      const limitStr = `${r.limit}`.padStart(5) + "  ";

      console.log(`| ${sttStr} | ${userStr} | ${keyStr} | ${usedStr}| ${remStr}| ${limitStr}| ${statusFormatted.padEnd(39)} |`);
    }

    console.log(`+-----+--------------------------+-----------------+----------+----------+---------+-------------------------------+`);

    // In phần tổng kết
    console.log(`\n${BOLD}========================================================================================================${RESET}`);
    console.log(`${BOLD}                                        TỔNG HỢP TOÀN BỘ POOL                                            ${RESET}`);
    console.log(`${BOLD}========================================================================================================${RESET}`);
    console.log(`📌 Tổng số Key đã nạp      : ${BOLD}${this._keys.length}${RESET} tài khoản`);
    console.log(`🟢 Key sẵn sàng hoạt động   : ${BOLD}${GREEN}${activeKeysCount}${RESET} tài khoản`);
    console.log(`🔴 Key đã dùng hết hôm nay  : ${BOLD}${RED}${exhaustedKeysCount}${RESET} tài khoản (tự động reset sau 24h)`);
    console.log(`--------------------------------------------------------------------------------------------------------`);
    console.log(`📊 Tổng Request ĐÃ DÙNG    : ${BOLD}${YELLOW}${totalUsed}${RESET} requests`);
    console.log(`🔥 Tổng Request CÒN LẠI    : ${BOLD}${GREEN}${totalRemaining}${RESET} requests (Khả dụng ngay)`);
    console.log(`🎯 Tổng Hạn Mức Tối Đa     : ${BOLD}${CYAN}${totalLimit}${RESET} requests / ngày (100% MIỄN PHÍ)`);
    console.log(`========================================================================================================\n`);
  }
}

// CLI Execution
async function main() {
  const checker = new RapidApiQuotaChecker();
  await checker.runReport();
}

main();
