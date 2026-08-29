/**
 * BATCH RUNNER - GITHUB 2FA ENABLER (CLI SUITE)
 * ==============================================================================
 * Công cụ dòng lệnh chạy hàng loạt tự động kích hoạt 2FA cho danh sách tài khoản:
 * 1. Nạp danh sách tài khoản GitHub cần bật 2FA (từ github_email_code_required.txt).
 * 2. Nạp cấu hình Hotmail Graph API (từ FileHotmail/hotmail.txt).
 * 3. Tự động mở trình duyệt (Incognito context cách ly), đăng nhập, nhận OTP Hotmail, lấy Setup Key và bật 2FA.
 * 4. Tự động thêm tài khoản hoàn thành vào Results_GitHub/github_2fa_enabled.txt.
 * 5. Tự động xóa tài khoản đã xong khỏi Results_GitHub/github_email_code_required.txt.
 * 6. Lưu đầy đủ Recovery Codes vào Results_2FA_Completed/completed_2fa_{timestamp}.txt.
 * ==============================================================================
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { HotmailGraphHelper } from "./hotmail_graph_helper.js";
import { Github2faEnabler } from "./github_2fa_enabler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==============================================================================
// 1. PHÂN TÍCH THAM SỐ DÒNG LỆNH (CLI ARGS)
// ==============================================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    inputFile: path.join(__dirname, "Results_GitHub", "github_email_code_required.txt"),
    hotmailFile: path.join(__dirname, "FileHotmail", "hotmail.txt"),
    enabledFile: path.join(__dirname, "Results_GitHub", "github_2fa_enabled.txt"),
    cdpEndpoint: "",
    headless: false,
    delaySec: 4,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input" && args[i + 1]) {
      options.inputFile = path.resolve(process.cwd(), args[++i]);
    } else if (arg === "--hotmail" && args[i + 1]) {
      options.hotmailFile = path.resolve(process.cwd(), args[++i]);
    } else if (arg === "--cdp" && args[i + 1]) {
      options.cdpEndpoint = args[++i];
    } else if (arg === "--headless") {
      options.headless = true;
    } else if (arg === "--delay" && args[i + 1]) {
      options.delaySec = parseInt(args[++i], 10) || 4;
    }
  }

  // Fallback nếu file mặc định không tìm thấy
  if (!existsSync(options.inputFile)) {
    const altInput = path.join(__dirname, "github_accounts.txt");
    if (existsSync(altInput)) {
      options.inputFile = altInput;
    }
  }

  return options;
}

// ==============================================================================
// 2. HÀM MAIN THỰC THI CHÍNH
// ==============================================================================
async function main() {
  const options = parseArgs();

  console.log("================================================================================");
  console.log("             HỆ THỐNG TỰ ĐỘNG KÍCH HOẠT 2FA GITHUB (HOTMAIL GRAPH API)          ");
  console.log("================================================================================");
  console.log(`📁 File cần bật 2FA       : ${options.inputFile}`);
  console.log(`📁 File Hotmail Graph     : ${options.hotmailFile}`);
  console.log(`📁 File đích (Đã có 2FA)  : ${options.enabledFile}`);
  console.log(`🖥️ Chế độ hiển thị        : ${options.headless ? "Headless (Ẩn)" : "Trực quan (Hiện cửa sổ)"}`);
  if (options.cdpEndpoint) {
    console.log(`🔌 Kết nối CDP            : ${options.cdpEndpoint}`);
  }
  console.log("================================================================================\n");

  if (!existsSync(options.inputFile)) {
    console.error(`❌ [Lỗi] Không tìm thấy file tài khoản GitHub: ${options.inputFile}`);
    process.exit(1);
  }

  if (!existsSync(options.hotmailFile)) {
    console.error(`❌ [Lỗi] Không tìm thấy file cấu hình Hotmail: ${options.hotmailFile}`);
    process.exit(1);
  }

  // Khởi tạo thư mục kết quả
  const resultsDir = path.join(__dirname, "Results_2FA_Completed");
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const completedFile = path.join(resultsDir, `completed_2fa_${timestamp}.txt`);
  const failedFile = path.join(resultsDir, `failed_2fa_${timestamp}.txt`);

  // 1. Nạp danh sách Hotmail
  const hotmailHelper = new HotmailGraphHelper(options.hotmailFile);

  // 2. Nạp danh sách GitHub accounts cần bật 2FA
  const rawContent = readFileSync(options.inputFile, "utf-8");
  let pendingLines = rawContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const accountsToProcess = [];
  for (const line of pendingLines) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts[0] && parts[1]) {
      accountsToProcess.push({
        email: parts[0],
        password: parts[1],
        oldSecret: parts[2] || "",
        rawLine: line,
      });
    }
  }

  const total = accountsToProcess.length;
  console.log(`🎯 Tìm thấy tổng cộng ${total} tài khoản cần xử lý kích hoạt 2FA.\n`);

  if (total === 0) {
    console.log("Tất cả tài khoản trong danh sách đã được xử lý xong!");
    process.exit(0);
  }

  // 3. Khởi tạo Enabler
  const enabler = new Github2faEnabler(hotmailHelper, {
    headless: options.headless,
    cdpEndpoint: options.cdpEndpoint,
  });

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  try {
    await enabler.initBrowser();

    for (let i = 0; i < total; i++) {
      const acc = accountsToProcess[i];
      const indexStr = `[${i + 1}/${total}]`;

      console.log(`\n----------------------------------------------------------------`);
      console.log(`▶️ ${indexStr} Bắt đầu xử lý: ${acc.email}`);
      console.log(`----------------------------------------------------------------`);

      // Kiểm tra Hotmail
      if (!hotmailHelper.hasAccount(acc.email)) {
        console.warn(`⚠️ ${indexStr} ${acc.email} không có trong file hotmail.txt -> Có thể không nhận được OTP tự động.`);
      }

      const result = await enabler.processAccount(acc.email, acc.password);

      if (result.success) {
        const finalSecret = result.twoFactorSecret || acc.oldSecret || "ENABLED";

        if (result.status === "ALREADY_ENABLED") {
          skippedCount++;
          console.log(`ℹ️ ${indexStr} ${acc.email} -> [ĐÃ CÓ SẴN 2FA]`);
        } else {
          successCount++;
          const recoveryJoin = (result.recoveryCodes || []).join(",");
          const detailedLog = `${acc.email}|${acc.password}|${finalSecret}|${recoveryJoin}\n`;
          appendFileSync(completedFile, detailedLog, "utf-8");

          console.log(`\n🎉 ${indexStr} ${acc.email} -> [KÍCH HOẠT 2FA THÀNH CÔNG] ✅`);
          console.log(`   - 2FA Secret Key : ${finalSecret}`);
          console.log(`   - Recovery Codes : ${(result.recoveryCodes || []).length} mã đã lưu`);
        }

        // TỰ ĐỘNG THÊM VÀO FILE github_2fa_enabled.txt
        const enabledLine = `${acc.email}|${acc.password}|${finalSecret}\n`;
        appendFileSync(options.enabledFile, enabledLine, "utf-8");
        console.log(`📝 Đã ghi tài khoản vào file: ${options.enabledFile}`);

        // TỰ ĐỘNG XÓA KHỎI FILE github_email_code_required.txt
        pendingLines = pendingLines.filter((l) => !l.toLowerCase().includes(acc.email.toLowerCase()));
        writeFileSync(options.inputFile, pendingLines.join("\n") + (pendingLines.length ? "\n" : ""), "utf-8");
        console.log(`🗑️ Đã xóa ${acc.email} khỏi hàng đợi ${options.inputFile}`);

      } else {
        failedCount++;
        const errLine = `${acc.email}|${acc.password}|ERROR: ${result.error}\n`;
        appendFileSync(failedFile, errLine, "utf-8");
        console.log(`\n❌ ${indexStr} ${acc.email} -> [THẤT BẠI]: ${result.error}`);
      }

      // Nghỉ giữa các tài khoản
      if (i < total - 1) {
        console.log(`\n⏳ Tạm nghỉ ${options.delaySec}s trước khi chuyển sang tài khoản tiếp theo...`);
        await new Promise((resolve) => setTimeout(resolve, options.delaySec * 1000));
      }
    }
  } finally {
    await enabler.closeBrowser();
  }

  // ============================================================================
  // 4. BÁO CÁO TỔNG KẾT
  // ============================================================================
  console.log("\n================================================================================");
  console.log("                     TỔNG KẾT HOÀN TẤT KÍCH HOẠT 2FA GITHUB                     ");
  console.log("================================================================================");
  console.log(`Tổng số tài khoản đã xử lý    : ${total}`);
  console.log(`✅ Thành công (Bật mới 2FA)     : ${successCount} tài khoản`);
  console.log(`ℹ️ Đã có sẵn 2FA trước đó      : ${skippedCount} tài khoản`);
  console.log(`❌ Thất bại / Lỗi              : ${failedCount} tài khoản`);
  console.log("--------------------------------------------------------------------------------");
  console.log(`📁 File danh sách 2FA ENABLED   : ${options.enabledFile}`);
  console.log(`📁 File chi tiết Backup Codes   : ${completedFile}`);
  if (failedCount > 0) {
    console.log(`📁 File danh sách THẤT BẠI      : ${failedFile}`);
  }
  console.log("================================================================================\n");
}

main().catch((err) => {
  console.error(`Lỗi nghiêm trọng: ${err.message}`);
  process.exit(1);
});
