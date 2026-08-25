/**
 * ==============================================================================
 * BATCH RUNNER - AUTOMATED GITHUB REGISTRATION SUITE (ISOLATED INSTANCES)
 * ==============================================================================
 * 
 * Mỗi lượt chạy (iteration) sẽ tạo một instance AiAgentRunner hoàn toàn mới:
 * - Profile ShardBrowser riêng biệt 100% (Unique Fingerprint & Cookie isolation)
 * - Proxy ngẫu nhiên độc lập
 * - Tự động dọn dẹp profile khi xong
 * - Tự động ghi nối tiếp vào output.txt và theo dõi tiến độ tổng thể.
 * 
 * Cách dùng:
 *   node Testing/git/batch_runner.js 100       # Chạy 100 tài khoản
 *   node Testing/git/batch_runner.js 50 10    # Chạy 50 tài khoản, nghỉ 10s giữa mỗi acc
 */

import { AiAgentRunner } from "./ai_agent_runner.js";

// ==============================================================================
// 1. CLASS BATCH RUNNER
// ==============================================================================
export class BatchRunner {
  // Private / Protected Properties
  _totalTarget = 100;
  _cooldownSeconds = 5;
  _successCount = 0;
  _failedCount = 0;
  _currentRunner = null;
  _isStopping = false;
  _history = [];

  constructor(totalTarget = 100, cooldownSeconds = 5) {
    this._totalTarget = Number(totalTarget) || 100;
    this._cooldownSeconds = Number(cooldownSeconds) || 5;

    // Lắng nghe tín hiệu dừng an toàn (Ctrl + C)
    process.on("SIGINT", async () => {
      console.log("\n⚠️ [Dừng Hệ Thống] Đang dọn dẹp phiên hiện tại trước khi thoát...");
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

  // Chờ an toàn
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Định dạng thời gian (giây -> mm:ss)
  _formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  }

  // In bảng tổng kết tiến độ
  _printSummary(startTime) {
    const totalDone = this._successCount + this._failedCount;
    const totalTimeSec = startTime ? (Date.now() - startTime) / 1000 : 0;
    const successRate = totalDone > 0 ? ((this._successCount / totalDone) * 100).toFixed(1) : "0.0";

    console.log("\n==================================================================");
    console.log("                BẢNG TỔNG KẾT TIẾN ĐỘ BATCH RUNNER                ");
    console.log("==================================================================");
    console.log(`🎯 Mục tiêu đề ra   : ${this._totalTarget} tài khoản`);
    console.log(`✅ Thành công       : ${this._successCount} tài khoản`);
    console.log(`❌ Thất bại/Lỗi     : ${this._failedCount} tài khoản`);
    console.log(`📊 Tỉ lệ thành công : ${successRate}%`);
    if (startTime) {
      console.log(`⏱️ Tổng thời gian   : ${this._formatTime(totalTimeSec)}`);
    }
    console.log(`📁 File kết quả     : Testing/git/output.txt`);
    console.log("==================================================================\n");
  }

  // Thực thi toàn bộ chu kỳ Batch
  async run() {
    const overallStart = Date.now();

    console.log("==================================================================");
    console.log(`🚀 KHỞI ĐỘNG BATCH RUNNER: MỤC TIÊU ${this._totalTarget} TÀI KHOẢN GITHUB`);
    console.log(`⏱️ Nghỉ giữa các phiên: ${this._cooldownSeconds}s | File lưu: Testing/git/output.txt`);
    console.log("==================================================================\n");

    for (let index = 1; index <= this._totalTarget; index++) {
      if (this._isStopping) break;

      const accStart = Date.now();
      console.log(`\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
      console.log(`   [TIẾN ĐỘ BATCH: ${index}/${this._totalTarget}] - BẮT ĐẦU TÀI KHOẢN MỚI #${index}`);
      console.log(`<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<`);

      // 1. Khởi tạo một Instance Hoàn Toàn Mới (100% Tách Biệt Bộ Nhớ, Proxy, Profile)
      const runnerInstance = new AiAgentRunner();
      this._currentRunner = runnerInstance;

      let isSuccess = false;
      let accountEmail = "";

      try {
        const report = await runnerInstance.runFullE2EWorkflow({
          saveSecrets: true,
        });

        isSuccess = true;
        this._successCount++;
        accountEmail = runnerInstance._accountState?.email || "N/A";

        const accTime = (Date.now() - accStart) / 1000;
        console.log(`\n🎉 [XONG TÀI KHOẢN #${index}]: ${accountEmail} | Thời gian: ${this._formatTime(accTime)}`);
      } catch (err) {
        this._failedCount++;
        const accTime = (Date.now() - accStart) / 1000;
        console.error(`\n❌ [LỖI TÀI KHOẢN #${index}]: ${err.message} | Thời gian: ${this._formatTime(accTime)}`);
      } finally {
        this._currentRunner = null;
        this._history.push({
          index,
          email: accountEmail,
          success: isSuccess,
          duration: (Date.now() - accStart) / 1000,
        });
      }

      // 2. Nghỉ cooldown giữa mỗi tài khoản (tránh nghẽn mạng & IP)
      if (index < this._totalTarget && !this._isStopping) {
        console.log(`\n⏳ [Cooldown] Chờ ${this._cooldownSeconds}s trước khi chuyển sang tài khoản #${index + 1}...`);
        await this._sleep(this._cooldownSeconds * 1000);
      }
    }

    this._printSummary(overallStart);
  }
}

// ==============================================================================
// 2. CLI ENTRYPOINT
// ==============================================================================
async function main() {
  const args = process.argv.slice(2);
  const targetCount = parseInt(args[0] || process.env.BATCH_COUNT || "100", 10);
  const cooldownSec = parseInt(args[1] || process.env.COOLDOWN_SEC || "5", 10);

  const batch = new BatchRunner(targetCount, cooldownSec);
  await batch.run();
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("batch_runner.js"))) {
  main();
}
