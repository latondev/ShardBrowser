/**
 * ==============================================================================
 * BATCH HOTMAIL RUNNER - GITHUB REGISTRATION SUITE (HOTMAIL GRAPH OAUTH2)
 * ==============================================================================
 * - Đọc danh sách tài khoản Hotmail có Refresh Token (Hotmail_2.txt / Hotmail_1.txt).
 * - Nhận mã OTP qua Microsoft Graph API siêu tốc (1-3s), không cần mở tab email.
 * - Tự động tạo Sandbox Profile ShardBrowser, cấu hình Proxy/Direct IP, điền form, và bật 2FA TOTP.
 * - Tự động lưu tài khoản hoàn tất vào output.txt và hotmail/github_accounts.txt.
 * 
 * ==============================================================================
 * CÁCH DÙNG LINH HOẠT:
 * 
 * 1. Chạy với IP DIRECT (Mạng thật của máy tính, không qua Proxy):
 *    node Testing/git/batch_hotmail_runner.js --direct --cooldown=60
 *    node Testing/git/batch_hotmail_runner.js Testing/git/hotmail/Hotmail_2.txt 60 direct
 * 
 * 2. Chạy với Proxy có sẵn trong ShardBrowser (Local proxies):
 *    node Testing/git/batch_hotmail_runner.js --shard --cooldown=30
 *    node Testing/git/batch_hotmail_runner.js Testing/git/hotmail/Hotmail_2.txt 30 shard
 * 
 * 3. Chạy với Proxy xoay động từ proxyxoay.shop:
 *    node Testing/git/batch_hotmail_runner.js --rotate --cooldown=20
 *    node Testing/git/batch_hotmail_runner.js Testing/git/hotmail/Hotmail_2.txt 20 rotate
 * ==============================================================================
 */

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { AiAgentRunner } from "./ai_agent_runner.js";
import { HotmailGraphClient } from "./hotmail_graph_client.js";

export class BatchHotmailRunner {
  _filePath = "";
  _cooldownSeconds = 15;
  _proxyMode = "rotate"; // "direct" | "shard" | "rotate"
  _accounts = [];
  _successCount = 0;
  _failedCount = 0;
  _currentRunner = null;
  _isStopping = false;

  constructor(filePath = "", cooldownSeconds = 15, proxyMode = "rotate") {
    this._filePath = filePath || path.join(process.cwd(), "Testing", "git", "hotmail", "Hotmail_2.txt");
    this._cooldownSeconds = Number(cooldownSeconds) || 15;
    this._proxyMode = proxyMode || "rotate";

    // Lắng nghe tín hiệu dừng an toàn (Ctrl + C)
    process.on("SIGINT", async () => {
      console.log("\n⚠️ [Dừng Hệ Thống] Đang dọn dẹp phiên trước khi thoát...");
      this._isStopping = true;
      if (this._currentRunner) {
        try {
          await this._currentRunner._cleanup?.();
        } catch {}
      }
      this._printSummary();
      process.exit(0);
    });
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
  }

  _loadAccounts() {
    if (!existsSync(this._filePath)) {
      throw new Error(`Không tìm thấy file tài khoản: ${this._filePath}`);
    }
    const raw = readFileSync(this._filePath, "utf8");
    const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
    this._accounts = lines;
    return lines;
  }

  _printSummary(startTime) {
    const totalDone = this._successCount + this._failedCount;
    const totalTimeSec = startTime ? (Date.now() - startTime) / 1000 : 0;
    const successRate = totalDone > 0 ? ((this._successCount / totalDone) * 100).toFixed(1) : "0.0";

    console.log("\n==================================================================");
    console.log("             BẢNG TỔNG KẾT BATCH HOTMAIL RUNNER                   ");
    console.log("==================================================================");
    console.log(`📁 File nguồn       : ${this._filePath}`);
    console.log(`🌐 Chế độ mạng      : ${this._proxyMode.toUpperCase()}`);
    console.log(`📋 Tổng tài khoản   : ${this._accounts.length}`);
    console.log(`✅ Đã tạo thành công: ${this._successCount} tài khoản`);
    console.log(`❌ Thất bại/Lỗi     : ${this._failedCount} tài khoản`);
    console.log(`📊 Tỉ lệ thành công : ${successRate}%`);
    if (startTime) {
      console.log(`⏱️ Tổng thời gian   : ${this._formatTime(totalTimeSec)}`);
    }
    console.log("==================================================================\n");
  }

  async run() {
    const overallStart = Date.now();
    const lines = this._loadAccounts();

    console.log("==================================================================");
    console.log(`🚀 KHỞI ĐỘNG BATCH HOTMAIL RUNNER (MICROSOFT GRAPH API OAUTH2)`);
    console.log(`📁 File nguồn : ${this._filePath} (${lines.length} tài khoản)`);
    console.log(`🌐 Chế độ IP  : [${this._proxyMode.toUpperCase()}] ${this._proxyMode === 'direct' ? '(IP Direct máy thật)' : (this._proxyMode === 'shard' ? '(Proxy có sẵn trong Shard)' : '(Proxy xoay proxyxoay.shop)')}`);
    console.log(`⏱️ Nghỉ giữa  : ${this._cooldownSeconds}s mỗi tài khoản`);
    console.log("==================================================================\n");

    for (let i = 0; i < lines.length && !this._isStopping; i++) {
      const line = lines[i];
      const accIndex = i + 1;
      const accStart = Date.now();

      const hotmailClient = new HotmailGraphClient(line);
      const targetEmail = hotmailClient.email || `Line #${accIndex}`;

      console.log(`\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
      console.log(`   [TIẾN ĐỘ: ${accIndex}/${lines.length}] -> ĐĂNG KÝ GITHUB CHO: ${targetEmail}`);
      console.log(`<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<`);

      // Khởi tạo Runner với Hotmail Client & Proxy Mode
      const runner = new AiAgentRunner({
        hotmailClient: hotmailClient,
        proxyMode: this._proxyMode,
      });
      this._currentRunner = runner;

      try {
        const result = await runner.runFullE2EWorkflow({
          saveSecrets: true,
          proxyMode: this._proxyMode,
        });

        this._successCount++;
        const accTime = (Date.now() - accStart) / 1000;
        console.log(`\n🎉 [XONG #${accIndex}/${lines.length}]: ${result.email} (User: ${result.username || 'OK'}) | Thời gian: ${this._formatTime(accTime)}`);

        // Ghi thêm vào file chuyên biệt của hotmail
        try {
          const hotmailOutPath = path.join(process.cwd(), "Testing", "git", "hotmail", "github_accounts.txt");
          const outLine = `${result.email}|${result.password}|${result.twoFactorSecret || "N/A"}\n`;
          appendFileSync(hotmailOutPath, outLine, "utf8");
        } catch {}

      } catch (err) {
        this._failedCount++;
        const accTime = (Date.now() - accStart) / 1000;
        console.error(`\n❌ [LỖI #${accIndex}/${lines.length} - ${targetEmail}]: ${err.message} | Thời gian: ${this._formatTime(accTime)}`);
      } finally {
        this._currentRunner = null;
      }

      // Nghỉ cooldown giữa các tài khoản nếu chưa phải tài khoản cuối
      if (accIndex < lines.length && !this._isStopping) {
        console.log(`\n⏳ [Cooldown] Chờ ${this._cooldownSeconds}s trước khi chuyển sang tài khoản tiếp theo...`);
        await this._sleep(this._cooldownSeconds * 1000);
      }
    }

    this._printSummary(overallStart);
  }
}

// Helper phân tích command line arguments
function parseCommandLineArgs() {
  const args = process.argv.slice(2);
  let filePath = path.join(process.cwd(), "Testing", "git", "hotmail", "Hotmail_2.txt");
  let cooldownSec = 15;
  let proxyMode = "rotate";

  for (const arg of args) {
    if (arg.startsWith("--file=")) {
      filePath = arg.replace(/^--file=/, "").trim();
    } else if (arg.startsWith("--cooldown=")) {
      cooldownSec = parseInt(arg.replace(/^--cooldown=/, ""), 10) || 15;
    } else if (arg.startsWith("--proxy=")) {
      proxyMode = arg.replace(/^--proxy=/, "").toLowerCase().trim();
    } else if (arg === "--direct" || arg === "-d") {
      proxyMode = "direct";
    } else if (arg === "--shard" || arg === "-s") {
      proxyMode = "shard";
    } else if (arg === "--rotate" || arg === "-r") {
      proxyMode = "rotate";
    } else if (arg.endsWith(".txt") || arg.includes("/") || arg.includes("\\")) {
      filePath = arg;
    } else if (/^\d+$/.test(arg)) {
      cooldownSec = parseInt(arg, 10);
    } else if (["direct", "shard", "rotate"].includes(arg.toLowerCase())) {
      proxyMode = arg.toLowerCase();
    }
  }

  return { filePath, cooldownSec, proxyMode };
}

// CLI Entrypoint
async function main() {
  const { filePath, cooldownSec, proxyMode } = parseCommandLineArgs();
  const batch = new BatchHotmailRunner(filePath, cooldownSec, proxyMode);
  await batch.run();
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("batch_hotmail_runner.js"))) {
  main();
}
