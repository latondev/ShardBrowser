/**
 * ==============================================================================
 * BATCH RUNNER - AUTOMATED GITHUB REGISTRATION SUITE (INFINITE MODE & SMART COOLDOWN)
 * ==============================================================================
 * - Chạy vô hạn liên tục không giới hạn (hoặc theo target chỉ định).
 * - Tách biệt 100% từng phiên (Unique Fingerprint & Cookie isolation).
 * - Cơ chế tự động chờ 1 giờ khi hết Quota RapidAPI và tự động tiếp tục khi có lượt mới.
 * - Tự động lưu tài khoản vào output.txt và bắn về Web Dashboard qua API.
 * 
 * Cách dùng:
 *   node batch_runner.js           # Chạy vô hạn liên tục (Default)
 *   node batch_runner.js 0 10      # Chạy vô hạn, nghỉ 10s giữa mỗi acc
 *   node batch_runner.js 500 15    # Chạy 500 tài khoản, nghỉ 15s giữa mỗi acc
 * ==============================================================================
 */

import { AiAgentRunner } from "./ai_agent_runner.js";

export class BatchRunner {
  // Private / Protected Properties
  _totalTarget = Infinity; // Mặc định chạy vô hạn
  _cooldownSeconds = 10;
  _successCount = 0;
  _failedCount = 0;
  _currentRunner = null;
  _isStopping = false;
  _history = [];

  constructor(totalTarget = 0, cooldownSeconds = 10) {
    const num = Number(totalTarget);
    this._totalTarget = (!num || num <= 0) ? Infinity : num;
    this._cooldownSeconds = Number(cooldownSeconds) || 10;

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

  // Định dạng thời gian (giây -> mm:ss hoặc hh:mm:ss)
  _formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    }
    return `${mins}m ${secs}s`;
  }

  // Cơ chế chờ 1 giờ khi hết Quota RapidAPI
  async _waitForQuotaReset(waitDurationSec = 3600) {
    console.log("\n==================================================================");
    console.log("⏳ [RAPIDAPI COOLDOWN] TẤT CẢ KEY ĐÃ HẾT LƯỢT TẠO GMAIL TRONG GIỜ NÀY!");
    console.log(`⏳ [TỰ ĐỘNG CHỜ] Bot sẽ tạm nghỉ ${Math.round(waitDurationSec / 60)} phút để chờ reset quota...`);
    console.log("💡 [Mẹo] Bạn có thể thêm key mới vào 'rapidapikey.md' bất cứ lúc nào.");
    console.log("==================================================================\n");

    const checkIntervalSec = 300; // Log tiến độ mỗi 5 phút
    let elapsed = 0;

    while (elapsed < waitDurationSec && !this._isStopping) {
      const remainingSec = waitDurationSec - elapsed;
      console.log(`⏱️ [Đang chờ Quota]: Đã nghỉ ${Math.round(elapsed / 60)}m / ${Math.round(waitDurationSec / 60)}m (Còn lại ${Math.round(remainingSec / 60)} phút)...`);
      await this._sleep(Math.min(checkIntervalSec, remainingSec) * 1000);
      elapsed += checkIntervalSec;
    }

    if (!this._isStopping) {
      console.log("\n✨ [Hết Thời Gian Chờ] Bắt đầu quét lại pool key RapidAPI và tiếp tục tạo tài khoản!\n");
    }
  }

  // In bảng tổng kết tiến độ
  _printSummary(startTime) {
    const totalDone = this._successCount + this._failedCount;
    const totalTimeSec = startTime ? (Date.now() - startTime) / 1000 : 0;
    const successRate = totalDone > 0 ? ((this._successCount / totalDone) * 100).toFixed(1) : "0.0";

    console.log("\n==================================================================");
    console.log("                BẢNG TỔNG KẾT TIẾN ĐỘ BATCH RUNNER                ");
    console.log("==================================================================");
    console.log(`🎯 Mục tiêu đề ra   : ${this._totalTarget === Infinity ? "VÔ HẠN (24/7)" : `${this._totalTarget} tài khoản`}`);
    console.log(`✅ Thành công       : ${this._successCount} tài khoản`);
    console.log(`❌ Thất bại/Lỗi     : ${this._failedCount} tài khoản`);
    console.log(`📊 Tỉ lệ thành công : ${successRate}%`);
    if (startTime) {
      console.log(`⏱️ Tổng thời gian   : ${this._formatTime(totalTimeSec)}`);
    }
    console.log("==================================================================\n");
  }

  // Thực thi chu kỳ Batch
  async run() {
    const overallStart = Date.now();
    const isInfinite = this._totalTarget === Infinity;

    console.log("==================================================================");
    console.log(`🚀 KHỞI ĐỘNG BATCH RUNNER: ${isInfinite ? "CHẾ ĐỘ VÔ HẠN (24/7)" : `MỤC TIÊU ${this._totalTarget} TÀI KHOẢN`}`);
    console.log(`⏱️ Nghỉ giữa các phiên: ${this._cooldownSeconds}s | Chế độ: Tự động chờ 1h khi hết Quota`);
    console.log("==================================================================\n");

    let index = 1;
    while ((isInfinite || index <= this._totalTarget) && !this._isStopping) {
      const accStart = Date.now();
      const targetLabel = isInfinite ? "∞" : this._totalTarget;
      console.log(`\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
      console.log(`   [TIẾN ĐỘ BATCH: ${index}/${targetLabel}] - BẮT ĐẦU TÀI KHOẢN MỚI #${index}`);
      console.log(`<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<`);

      // 1. Khởi tạo một Instance Hoàn Toàn Mới (100% Tách Biệt Bộ Nhớ, Proxy, Profile)
      const runnerInstance = new AiAgentRunner();
      this._currentRunner = runnerInstance;

      let isSuccess = false;
      let accountEmail = "";

      try {
        await runnerInstance.runFullE2EWorkflow({
          saveSecrets: true,
        });

        isSuccess = true;
        this._successCount++;
        accountEmail = runnerInstance._accountState?.email || "N/A";

        const accTime = (Date.now() - accStart) / 1000;
        console.log(`\n🎉 [XONG TÀI KHOẢN #${index}]: ${accountEmail} | Thời gian: ${this._formatTime(accTime)}`);
        index++;
      } catch (err) {
        const accTime = (Date.now() - accStart) / 1000;

        // Xử lý hết quota RapidAPI: Tự động chờ 1 giờ rồi thử lại chính tài khoản này
        if (err.isQuotaExhausted || (err.message && err.message.includes("RAPIDAPI_QUOTA_EXHAUSTED"))) {
          await this._waitForQuotaReset(3600);
          // Không tăng index để thử lại ngay sau khi hết giờ chờ
          continue;
        }

        if (err.message && err.message.includes("EMAIL_ALREADY_EXISTS")) {
          console.warn(`\n🔄 [EMAIL ĐÃ TỒN TẠI]: Tự động bỏ qua lượt này và làm lại tài khoản #${index} mới từ đầu...`);
          // Không tăng index
        } else {
          this._failedCount++;
          console.error(`\n❌ [LỖI TÀI KHOẢN #${index}]: ${err.message} | Thời gian: ${this._formatTime(accTime)}`);
          index++;
        }
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
      if ((isInfinite || index <= this._totalTarget) && !this._isStopping) {
        console.log(`\n⏳ [Cooldown] Chờ ${this._cooldownSeconds}s trước khi chuyển sang tài khoản tiếp theo...`);
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
  const targetCount = parseInt(args[0] || process.env.BATCH_COUNT || "0", 10);
  const cooldownSec = parseInt(args[1] || process.env.COOLDOWN_SEC || "10", 10);

  const batch = new BatchRunner(targetCount, cooldownSec);
  await batch.run();
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("batch_runner.js"))) {
  main();
}
