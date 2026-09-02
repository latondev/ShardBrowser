/**
 * ==============================================================================
 * AUTO RUNNER: TỰ ĐỘNG 100% (GITHUB OAUTH + 2FA TOTP + SHARDBROWSER + SEEKAI)
 * ==============================================================================
 * - Đọc danh sách tài khoản GitHub từ accounts.txt (hoặc file được chỉ định).
 * - Mỗi tài khoản tự động tạo 1 Profile ShardBrowser riêng biệt (Unique Fingerprint).
 * - Đăng nhập GitHub -> Tự động giải mã 2FA TOTP -> Bỏ qua Passkey -> Authorize SeekAI.
 * - Vào SeekAI Keys -> Tạo API Key -> Bấm nút Copy thật -> Trích xuất Full Key.
 * - Lưu kết quả chuẩn định dạng: username|password|apikey vào output.txt.
 * 
 * Cách dùng:
 *   node auto_runner.mjs                  # Chạy tất cả tài khoản trong accounts.txt
 *   node auto_runner.mjs 5 15             # Chạy 5 tài khoản đầu tiên, nghỉ 15s giữa các acc
 *   node auto_runner.mjs accounts.txt 10  # Chỉ định file tài khoản
 * ==============================================================================
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAccountWithShard } from "./src/seekai_shard_runner.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_FILE = path.resolve(__dirname, "output.txt");
const DEFAULT_ACCOUNTS_FILE = path.resolve(__dirname, "accounts.txt");

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

function parseAccountLine(line) {
  if (!line || !line.trim() || line.startsWith("#")) return null;
  let clean = line.trim();
  if (clean.includes("\t")) {
    const tabParts = clean.split("\t");
    clean = tabParts[tabParts.length - 1].trim();
  }
  const parts = clean.split("|").map((p) => p.trim());
  if (parts.length >= 2) {
    return {
      username: parts[0],
      password: parts[1] || "01652530159Aa@",
      totpSecret: parts[2] || "",
    };
  } else if (parts.length === 1 && parts[0]) {
    return {
      username: parts[0],
      password: "01652530159Aa@",
      totpSecret: "",
    };
  }
  return null;
}

function loadAccounts(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Không tìm thấy file tài khoản: ${filePath}`);
    return [];
  }
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split("\n")
    .map(parseAccountLine)
    .filter(Boolean);
}

async function main() {
  let accountsFile = DEFAULT_ACCOUNTS_FILE;
  let maxRuns = null;
  let cooldownSec = null; // Mặc định: ngẫu nhiên 30s - 80s

  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  if (arg1 && isNaN(Number(arg1))) {
    accountsFile = path.resolve(process.cwd(), arg1);
    if (arg2 && !isNaN(Number(arg2))) {
      cooldownSec = Number(arg2);
    }
  } else if (arg1 && !isNaN(Number(arg1))) {
    maxRuns = Number(arg1);
    if (arg2 && !isNaN(Number(arg2))) {
      cooldownSec = Number(arg2);
    }
  }

  const allAccounts = loadAccounts(accountsFile);
  const processed = loadProcessedUsernames();

  const pendingAccounts = allAccounts.filter(
    (acc) => !processed.has(acc.username.toLowerCase())
  );

  const runList = maxRuns ? pendingAccounts.slice(0, maxRuns) : pendingAccounts;

  console.log(`==================================================================`);
  console.log(`🤖 SEEKAI GITHUB OAUTH AUTONOMOUS GENERATOR (SHARDBROWSER)`);
  console.log(`==================================================================`);
  console.log(`📂 Nguồn tài khoản            : ${accountsFile}`);
  console.log(`👥 Tổng số tài khoản          : ${allAccounts.length}`);
  console.log(`✅ Đã có API Key trước đó     : ${processed.size}`);
  console.log(`🎯 Số tài khoản sẽ chạy lượt này: ${runList.length}`);
  console.log(`⏳ Thời gian nghỉ giữa các acc : ${cooldownSec ? cooldownSec + "s" : "Ngẫu nhiên từ 30s - 80s"}`);
  console.log(`💾 File lưu kết quả            : ${OUTPUT_FILE}`);
  console.log(`==================================================================\n`);

  if (runList.length === 0) {
    console.log("🎉 Toàn bộ tài khoản trong danh sách đã được tạo API Key thành công trước đó!");
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < runList.length; i++) {
    const acc = runList[i];
    console.log(`\n▶️ [Tiến độ: ${i + 1}/${runList.length}] Đang xử lý GitHub: [${acc.username}]...`);

    try {
      const result = await runAccountWithShard(acc, {
        password: acc.password,
        headless: process.env.HEADLESS === "1",
        keyName: `Key_${Date.now().toString().slice(-4)}`,
      });
      successCount++;
      console.log(`✅ [Thành Công #${i + 1}]: ${result.username} | Key: ${result.apiKey}`);
    } catch (err) {
      failCount++;
      console.error(`❌ [Thất Bại #${i + 1}] ${acc.username}: ${err.message}`);
    }

    if (i < runList.length - 1) {
      const sleepSec = cooldownSec ? cooldownSec : (Math.floor(Math.random() * (80 - 30 + 1)) + 30);
      console.log(`⏳ Nghỉ ngẫu nhiên ${sleepSec}s trước khi chuyển sang tài khoản tiếp theo...`);
      await new Promise((r) => setTimeout(r, sleepSec * 1000));
    }
  }

  console.log(`\n==================================================================`);
  console.log(`🎉 TỔNG KẾT: Hoàn tất ${successCount}/${runList.length} tài khoản thành công!`);
  console.log(`💾 Kết quả đã lưu vào: ${OUTPUT_FILE} (username|password|apikey)`);
  console.log(`==================================================================\n`);
}

main().catch(console.error);
