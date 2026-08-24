import axios from "axios";

async function testAI() {
  console.log("Đang kiểm tra kết nối API Xkiro (stealth/ox-alpha-free)...");
  try {
    const res = await axios.post(
      "https://api.xkiro.com/v1/chat/completions",
      {
        model: "stealth/ox-alpha-free",
        messages: [{ role: "user", content: "Xin chào! Hãy trả lời ngắn gọn 'API Xkiro hoạt động hoàn hảo'." }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer sk-xt-dfa9623373697bc9c6d720f7b974e459b54189998b56de42",
        },
      }
    );
    console.log("-> Kết quả từ AI:", res.data.choices[0].message.content);
  } catch (err) {
    console.error("(!) Lỗi kết nối:", err.response?.data || err.message);
  }
}

testAI();
