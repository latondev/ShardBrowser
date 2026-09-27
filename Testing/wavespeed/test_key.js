const fs = require("node:fs");
const path = require("node:path");

const RESULTS_FILE = path.resolve(__dirname, "results_wavespeed.txt");
const BASE_URL = process.env.WAVESPEED_API_BASE_URL || "https://api.wavespeed.ai/v1";

async function testApiKey() {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error(`❌ Không tìm thấy file kết quả: ${RESULTS_FILE}`);
    return;
  }

  const lines = fs
    .readFileSync(RESULTS_FILE, "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("FAILED") && !l.startsWith("#"));

  if (lines.length === 0) {
    console.error(`❌ Chưa có API key nào trong ${path.basename(RESULTS_FILE)}`);
    return;
  }

  const lastEntry = lines[lines.length - 1];
  const [email, apiKey] = lastEntry.split("|").map((s) => s.trim());

  console.log("===========================================================");
  console.log("🧪 KIỂM TRA API KEY WAVESPEED");
  console.log(`👤 Tài khoản: ${email}`);
  console.log(`🔑 Key: ${apiKey ? apiKey.slice(0, 8) + "..." + apiKey.slice(-4) : "N/A"}`);
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log("===========================================================\n");

  console.log("1️⃣ Đang kiểm tra GET /models...");
  try {
    const res = await fetch(`${BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(`✅ Kết nối API Key WaveSpeed thành công!`);
      if (Array.isArray(data.data)) {
        console.log(`📋 Tổng số models: ${data.data.length}`);
        const sample = data.data.slice(0, 5).map((m) => m.id || m.name);
        console.log(`🎯 Models mẫu:`, sample.join(", "));
      } else {
        console.log(`📊 Phản hồi:`, JSON.stringify(data, null, 2));
      }
    } else {
      console.warn(`⚠️ Phản hồi từ máy chủ (${res.status}):`, JSON.stringify(data, null, 2));
      console.log(`ℹ️ Lưu ý: Nếu số dư tài khoản $0, bạn cần nạp credit trên dashboard trước khi gọi inference.`);
    }
  } catch (err) {
    console.error(`❌ Lỗi kết nối HTTP: ${err.message}`);
  }
}

testApiKey();
