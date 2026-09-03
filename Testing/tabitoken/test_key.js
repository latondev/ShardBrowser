const fs = require("node:fs");
const path = require("node:path");

const RESULTS_FILE = path.resolve(__dirname, "results_tabitoken.txt");
const BASE_URL = "https://tabitoken.com/v1";

async function testApiKey() {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error("❌ Không tìm thấy file results_tabitoken.txt");
    return;
  }

  const lines = fs.readFileSync(RESULTS_FILE, "utf-8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("FAILED"));
  if (lines.length === 0) {
    console.error("❌ Không có API key nào trong results_tabitoken.txt");
    return;
  }

  const firstEntry = lines[lines.length - 1]; // Lấy key mới nhất
  const [email, apiKey] = firstEntry.split("|");

  console.log("===========================================================");
  console.log("🧪 KIỂM TRA API KEY TABITOKEN");
  console.log(`👤 Tài khoản: ${email}`);
  console.log(`🔑 Key: ${apiKey}`);
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log("===========================================================\n");

  // 1. Kiểm tra danh sách Models khả dụng
  console.log("1️⃣ Đang gọi GET /v1/models...");
  try {
    const modelsRes = await fetch(`${BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const modelsData = await modelsRes.json();
    if (modelsRes.ok && modelsData.data) {
      console.log(`✅ Lấy danh sách models thành công! Tổng số models: ${modelsData.data.length}`);
      const modelNames = modelsData.data.map((m) => m.id);
      console.log(`📋 Một số models tiêu biểu:`, modelNames.slice(0, 8).join(", "));

      // Chọn model để test (ưu tiên gpt-4o-mini, gpt-3.5-turbo, claude-3-haiku hoặc model đầu tiên)
      const targetModel =
        modelNames.find((m) => m.includes("gpt-4o-mini")) ||
        modelNames.find((m) => m.includes("gpt-3.5-turbo")) ||
        modelNames.find((m) => m.includes("claude-3-5-haiku")) ||
        modelNames.find((m) => m.includes("gemini")) ||
        modelNames[0] ||
        "gpt-3.5-turbo";

      // 2. Kiểm tra Chat Completion
      console.log(`\n2️⃣ Đang test Chat Completion với model: [${targetModel}]...`);
      const chatRes = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Xin chào! Bạn là mô hình AI nào? Hãy trả lời ngắn gọn trong 1 câu." },
          ],
          max_tokens: 100,
          temperature: 0.7,
        }),
      });

      const chatData = await chatRes.json();
      if (chatRes.ok && chatData.choices && chatData.choices.length > 0) {
        console.log(`\x1b[32m🎉 CHAT COMPLETION THÀNH CÔNG!\x1b[0m`);
        console.log(`💬 Phản hồi từ AI:\n"${chatData.choices[0].message?.content?.trim()}"`);
        console.log(`📊 Usage:`, chatData.usage);
      } else {
        console.error(`❌ Chat Completion lỗi:`, JSON.stringify(chatData, null, 2));
      }
    } else {
      console.error(`❌ Lỗi khi lấy models:`, JSON.stringify(modelsData, null, 2));
    }
  } catch (err) {
    console.error(`❌ Lỗi kết nối API:`, err.message);
  }
}

testApiKey();
