/**
 * ==============================================================================
 * BATCH UNLIMITMAIL RUNNER - GITHUB REGISTRATION SUITE (UNLIMITMAIL AUTOMATION)
 * ==============================================================================
 * - Tự động tạo email tạm không giới hạn qua UnlimitMail (unlimitmail.com).
 * - Tự động nhận mã OTP siêu tốc và điền vào GitHub E2E flow.
 * - Tự động tạo Sandbox Profile ShardBrowser, cấu hình Proxy/Direct IP, điền form, và bật 2FA TOTP.
 * - Tự động lưu tài khoản hoàn tất vào output.txt và Web Dashboard API.
 * 
 * ==============================================================================
 * CÁCH DÙNG LINH HOẠT:
 * 
 * 1. Chạy với Proxy có sẵn trong ShardBrowser (Local proxies):
 *    node Testing/git/batch_unlimitmail_runner.js --shard --cooldown=30
 *    node Testing/git/batch_unlimitmail_runner.js 10 30 shard
 * 
 * 2. Chạy với Proxy xoay động từ proxyxoay.shop:
 *    node Testing/git/batch_unlimitmail_runner.js --rotate --cooldown=20
 * 
 * 3. Chạy với IP DIRECT (Mạng thật của máy tính):
 *    node Testing/git/batch_unlimitmail_runner.js --direct --cooldown=60
 * ==============================================================================
 */

import { AiAgentRunner } from "./ai_agent_runner.js";

export class BatchUnlimitMailRunner {
  _totalTarget = Infinity;
  _cooldownSeconds = 30;
  _proxyMode = "shard"; // "shard" | "rotate" | "direct"
  _proxyGroup = "all";
  _profile = null;
  _cloneFrom = null;
  _captchaMode = "audio"; // "audio" (Khuyên dùng - tỉ lệ 99.9%) | "slider" | "auto"
  _successCount = 0;
  _failedCount = 0;
  _currentRunner = null;
  _isStopping = false;
  _headless = false;
  _history = [];

  constructor(totalTarget = 0, cooldownSeconds = 30, proxyMode = "shard", proxyGroup = "all", profile = null, cloneFrom = null, captchaMode = "audio", headless = false) {
    const num = Number(totalTarget);
    this._totalTarget = (!num || num <= 0) ? Infinity : num;
    this._cooldownSeconds = Number(cooldownSeconds) || 30;
    this._proxyMode = proxyMode || "shard";
    this._proxyGroup = proxyGroup || "all";
    this._profile = profile || null;
    this._cloneFrom = cloneFrom || null;
    this._captchaMode = captchaMode || "audio";
    this._headless = Boolean(headless);

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

  _printSummary(startTime) {
    const totalDone = this._successCount + this._failedCount;
    const totalTimeSec = startTime ? (Date.now() - startTime) / 1000 : 0;
    const successRate = totalDone > 0 ? ((this._successCount / totalDone) * 100).toFixed(1) : "0.0";

    console.log("\n==================================================================");
    console.log("            BẢNG TỔNG KẾT TIẾN ĐỘ BATCH UNLIMITMAIL RUNNER        ");
    console.log("==================================================================");
    console.log(`🎯 Mục tiêu đề ra   : ${this._totalTarget === Infinity ? "VÔ HẠN (24/7)" : `${this._totalTarget} tài khoản`}`);
    console.log(`📧 Dịch vụ Email    : UNLIMITMAIL (unlimitmail.com)`);
    console.log(`🌐 Chế độ mạng      : ${this._proxyMode.toUpperCase()}`);
    console.log(`✅ Thành công       : ${this._successCount} tài khoản`);
    console.log(`❌ Thất bại/Lỗi     : ${this._failedCount} tài khoản`);
    console.log(`📊 Tỉ lệ thành công : ${successRate}%`);
    if (startTime) {
      console.log(`⏱️ Tổng thời gian   : ${this._formatTime(totalTimeSec)}`);
    }
    console.log("==================================================================\n");
  }

  async run() {
    const overallStart = Date.now();
    const isInfinite = this._totalTarget === Infinity;

    console.log("==================================================================");
    console.log(`🚀 KHỞI ĐỘNG BATCH UNLIMITMAIL RUNNER: ${isInfinite ? "CHẾ ĐỘ VÔ HẠN (24/7)" : `MỤC TIÊU ${this._totalTarget} TÀI KHOẢN`}`);
    console.log(`📧 Dịch vụ Email: [UNLIMITMAIL] (Tự động sinh mail & lấy OTP)`);
    console.log(`🌐 Chế độ mạng  : [${this._proxyMode.toUpperCase()}] ${this._proxyMode === 'direct' ? '(IP Direct mạng nhà - Chú ý: Dễ bị GitHub Rate-Limit)' : (this._proxyMode === 'shard' ? `(Proxy nhóm [${this._proxyGroup.toUpperCase()}] trong Shard)` : '(Proxy xoay proxyxoay.shop)')}`);
    console.log(`⏱️ Nghỉ giữa    : ${this._cooldownSeconds}s mỗi tài khoản`);
    console.log("==================================================================\n");

    let index = 1;
    while ((isInfinite || index <= this._totalTarget) && !this._isStopping) {
      const accStart = Date.now();
      const targetLabel = isInfinite ? "∞" : this._totalTarget;
      console.log(`\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
      console.log(`   [TIẾN ĐỘ UNLIMITMAIL: ${index}/${targetLabel}] - BẮT ĐẦU TÀI KHOẢN MỚI #${index}`);
      console.log(`<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<`);

      const isInlineProxy = this._proxyMode.includes(":") || this._proxyMode.includes("//");
      const runnerInstance = new AiAgentRunner({
        proxyMode: isInlineProxy ? "shard" : this._proxyMode,
        proxyGroup: this._proxyGroup,
        proxy: isInlineProxy ? this._proxyMode : undefined,
        emailService: "unlimitmail",
        captchaMode: this._captchaMode,
        profile: this._profile,
        cloneFrom: this._cloneFrom,
        headless: this._headless,
      });
      this._currentRunner = runnerInstance;

      let isSuccess = false;
      let accountEmail = "";
      let attempt = 0;
      const maxAttempts = 3;

      while (attempt < maxAttempts && !isSuccess && !this._isStopping) {
        attempt++;
        try {
          await runnerInstance.runFullE2EWorkflow({
            saveSecrets: true,
            proxyMode: isInlineProxy ? "shard" : this._proxyMode,
            proxyGroup: this._proxyGroup,
            proxy: isInlineProxy ? this._proxyMode : undefined,
            headless: this._headless,
          });

          isSuccess = true;
          this._successCount++;
          accountEmail = runnerInstance._accountState?.email || "N/A";

          const accTime = (Date.now() - accStart) / 1000;
          console.log(`\n🎉 [XONG TÀI KHOẢN UNLIMITMAIL #${index}]: ${accountEmail} | Thời gian: ${this._formatTime(accTime)}`);
          index++;
        } catch (err) {
          const accTime = (Date.now() - accStart) / 1000;

          if (err.message && err.message.includes("EMAIL_ALREADY_EXISTS")) {
            console.warn(`\n🔄 [EMAIL ĐÃ TỒN TẠI]: Tự động bỏ qua và tạo tài khoản #${index} mới...`);
            break;
          } else if (err.message && (err.message.includes("PROXY_BLOCKED_CDN") || err.message.includes("PROXY_CAPTCHA_NETWORK_ERROR") || err.message.includes("GITHUB_RATE_LIMITED") || err.message.includes("Rate Limit"))) {
            console.warn(`\n🔄 [TỰ ĐỘNG ĐỔI PROXY] (${err.message}) -> Đang chuyển ngay sang Proxy sạch tiếp theo (Lần thử ${attempt}/${maxAttempts})...`);
            if (attempt >= maxAttempts) {
              this._failedCount++;
              console.error(`\n❌ [LỖI TÀI KHOẢN #${index}]: Đã thử hết ${maxAttempts} proxy nhưng đều bị giới hạn | Thời gian: ${this._formatTime(accTime)}`);
              index++;
            }
          } else {
            this._failedCount++;
            console.error(`\n❌ [LỖI TÀI KHOẢN #${index}]: ${err.message} | Thời gian: ${this._formatTime(accTime)}`);
            index++;
            break;
          }
        } finally {
          this._currentRunner = null;
        }
      }

      if ((isInfinite || index <= this._totalTarget) && !this._isStopping) {
        console.log(`\n⏳ [Cooldown] Chờ ${this._cooldownSeconds}s trước khi chuyển sang tài khoản tiếp theo...`);
        await this._sleep(this._cooldownSeconds * 1000);
      }
    }

    this._printSummary(overallStart);
  }
}

// ==============================================================================
// CLI ENTRYPOINT
// ==============================================================================
function parseArgs() {
  const args = process.argv.slice(2);
  let targetCount = parseInt(process.env.BATCH_COUNT || "0", 10);
  let cooldownSec = parseInt(process.env.COOLDOWN_SEC || "30", 10);
  let proxyMode = process.env.PROXY_MODE || "shard";
  let proxyGroup = process.env.PROXY_GROUP || "all";
  let profile = process.env.SHARD_PROFILE || null;
  let cloneFrom = process.env.SHARD_CLONE_FROM || null;
  let captchaMode = process.env.CAPTCHA_MODE || "audio";
  let headless = process.env.HEADLESS === "1" || false;

  for (const arg of args) {
    if (arg.startsWith("--count=")) {
      targetCount = parseInt(arg.replace(/^--count=/, ""), 10) || 0;
    } else if (arg.startsWith("--cooldown=")) {
      cooldownSec = parseInt(arg.replace(/^--cooldown=/, ""), 10) || 30;
    } else if (arg.startsWith("--proxy=")) {
      const pVal = arg.replace(/^--proxy=/, "").trim();
      if (["direct", "shard", "rotate"].includes(pVal.toLowerCase())) {
        proxyMode = pVal.toLowerCase();
      } else {
        proxyMode = pVal;
      }
    } else if (arg.startsWith("--group=") || arg.startsWith("--proxy-group=")) {
      proxyGroup = arg.replace(/^--(group|proxy-group)=/, "").toLowerCase().trim();
    } else if (arg.startsWith("--profile=")) {
      profile = arg.replace(/^--profile=/, "").trim();
    } else if (arg.startsWith("--clone-from=")) {
      cloneFrom = arg.replace(/^--clone-from=/, "").trim();
    } else if (arg.startsWith("--captcha=")) {
      captchaMode = arg.replace(/^--captcha=/, "").trim();
    } else if (arg === "--slider") {
      captchaMode = "slider";
    } else if (arg === "--audio") {
      captchaMode = "audio";
    } else if (arg === "--headless" || arg === "-h") {
      headless = true;
    } else if (arg === "--no-headless" || arg === "--headful") {
      headless = false;
    } else if (arg === "--direct" || arg === "-d") {
      proxyMode = "direct";
    } else if (arg === "--shard" || arg === "-s") {
      proxyMode = "shard";
    } else if (arg === "--rotate" || arg === "-r") {
      proxyMode = "rotate";
    } else if (/^\d+$/.test(arg)) {
      if (targetCount === 0) targetCount = parseInt(arg, 10);
      else cooldownSec = parseInt(arg, 10);
    } else if (["direct", "shard", "rotate"].includes(arg.toLowerCase())) {
      proxyMode = arg.toLowerCase();
    }
  }

  return { targetCount, cooldownSec, proxyMode, proxyGroup, profile, cloneFrom, captchaMode, headless };
}

async function main() {
  const { targetCount, cooldownSec, proxyMode, proxyGroup, profile, cloneFrom, captchaMode, headless } = parseArgs();
  const batch = new BatchUnlimitMailRunner(targetCount, cooldownSec, proxyMode, proxyGroup, profile, cloneFrom, captchaMode, headless);
  await batch.run();
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("batch_unlimitmail_runner.js"))) {
  main();
}
