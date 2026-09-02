/**
 * ==============================================================================
 * SEEKAI BATCH RUNNER - AUTOMATED VIA SHARDBROWSER SANDBOX
 * ==============================================================================
 * - Đọc danh sách tài khoản từ file (accounts.txt / input.txt / Testing/git/output_1.txt).
 * - Mỗi tài khoản tự động tạo 1 Profile ShardBrowser riêng biệt (Unique Fingerprint).
 * - Tự động đăng nhập GitHub, xử lý 2FA TOTP, Authorize SeekAI và lấy API Key.
 * - Lưu kết quả chuẩn định dạng username|pass|apikey (mỗi acc 1 dòng) vào output.txt.
 * - Tự động dọn dẹp profile sau mỗi lượt chạy.
 * 
 * Cách dùng:
 *   node batch_runner.mjs                          # Mặc định đọc accounts.txt
 *   node batch_runner.mjs accounts.txt 10          # Đọc file accounts.txt, cooldown 10s
 *   node batch_runner.mjs ../git/output_1.txt 10   # Đọc danh sách acc từ output_1.txt
 * ==============================================================================
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAccountWithShard } from "./src/seekai_shard_runner.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_FILE = path.resolve(__dirname, "output.txt");

// Lấy danh sách các tài khoản đã có API key trong output.txt để tránh chạy lại trùng lặp
function loadProcessedUsernames() {
  const processed = new Set();
  if (fs.existsSync(OUTPUT_FILE)) {
    const lines = fs.readFileSync(OUTPUT_FILE, "utf8").split("\n");
    for (const line of lines) {
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length >= 3 && parts[2]?.startsWith("sk-")) {
        processed.add(parts[0].toLowerCase());
      }
    }
  }
  return processed;
}

const DEFAULT_PASSWORD = "01652530159";

// Phân tích cú pháp từng dòng tài khoản
function parseAccountLine(line) {
  if (!line || !line.trim() || line.startsWith("#")) return null;
  // Hỗ trợ cả phân cách "|" và " | "
  const parts = line.split("|").map((p) => p.trim());
  if (parts.length >= 2) {
    return {
      username: parts[0],
      password: parts[1] || DEFAULT_PASSWORD,
      totpSecret: parts[2] || "",
    };
  } else if (parts.length === 1 && parts[0]) {
    return {
      username: parts[0],
      password: DEFAULT_PASSWORD,
      totpSecret: "",
    };
  }
  return null;
}

// Đọc danh sách tài khoản từ file
function loadAccounts(filePath) {
  const candidatePaths = [
    filePath,
    path.resolve(__dirname, filePath || "accounts.txt"),
    path.resolve(__dirname, "accounts.txt"),
    path.resolve(__dirname, "input.txt"),
    path.resolve(__dirname, "..", "git", "output_1.txt"),
  ].filter(Boolean);

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      console.log(`📂 [Input] Đang đọc danh sách tài khoản từ: ${p}`);
      const raw = fs.readFileSync(p, "utf8");
      const accounts = raw
        .split("\n")
        .map(parseAccountLine)
        .filter(Boolean);
      return accounts;
    }
  }

  return [];
}

async function main() {
  const targetFile = process.argv[2] || "accounts.txt";
  const cooldownSec = process.argv[3] ? Number(process.argv[3]) : null;
  const accounts = loadAccounts(targetFile);

  if (accounts.length === 0) {
    console.log(`
⚠️ Không tìm thấy danh sách tài khoản!
Vui lòng tạo file 'accounts.txt' trong thư mục này với định dạng:
  username|password|totpSecret (hoặc username|password)
  username | password | totpSecret
`);
    return;
  }

  const processed = loadProcessedUsernames();
  const pendingAccounts = accounts.filter(
    (acc) => !processed.has(acc.username.toLowerCase())
  );

  console.log(`==================================================================`);
  console.log(`🚀 SEEKAI BATCH RUNNER - SHARDBROWSER SANDBOX`);
  console.log(`==================================================================`);
  console.log(`Tổng số tài khoản tìm thấy : ${accounts.length}`);
  console.log(`Đã xử lý trước đó (đã có key): ${processed.size}`);
  console.log(`Cần xử lý lượt này         : ${pendingAccounts.length}`);
  console.log(`Thời gian nghỉ (cooldown)  : ${cooldownSec ? cooldownSec + "s" : "Ngẫu nhiên từ 30s - 80s"}`);
  console.log(`File lưu kết quả           : ${OUTPUT_FILE}`);
  console.log(`==================================================================\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pendingAccounts.length; i++) {
    const acc = pendingAccounts[i];
    console.log(`\n▶️ [Tiến độ: ${i + 1}/${pendingAccounts.length}] Bắt đầu tài khoản: ${acc.username}`);

    try {
      await runAccountWithShard(acc, {
        headless: process.env.HEADLESS === "1",
        keyName: `Key_${Date.now().toString().slice(-4)}`,
        folder: "SeekAI-Auto",
      });
      successCount++;
      console.log(`✅ [Hoàn Tất #${i + 1}]: ${acc.username}`);
    } catch (err) {
      failCount++;
      console.error(`❌ [Thất Bại #${i + 1}] ${acc.username}: ${err.message}`);
    }

    if (i < pendingAccounts.length - 1) {
      const sleepSec = cooldownSec ? cooldownSec : (Math.floor(Math.random() * (80 - 30 + 1)) + 30);
      console.log(`⏳ Nghỉ ngẫu nhiên ${sleepSec}s trước khi chuyển sang tài khoản tiếp theo...`);
      await new Promise((r) => setTimeout(r, sleepSec * 1000));
    }
  }

  console.log(`\n==================================================================`);
  console.log(`🎉 BÁO CÁO TỔNG KẾT BATCH RUNNER`);
  console.log(`==================================================================`);
  console.log(`✅ Thành công : ${successCount} tài khoản`);
  console.log(`❌ Thất bại   : ${failCount} tài khoản`);
  console.log(`💾 Kết quả lưu tại: ${OUTPUT_FILE}`);
  console.log(`==================================================================\n`);
}

main().catch(console.error);
