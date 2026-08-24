import axios from "axios";

async function test() {
  try {
    const res = await axios.post("https://api.xkiro.com/v1/chat/completions", {
      model: "stealth/ox-alpha-free",
      messages: [
        {
          role: "system",
          content: "Bạn là AI. Bắt buộc trả về đúng 1 đối tượng JSON duy nhất có cấu trúc: {\"thought\": string, \"action\": string, \"selector\": string}. Không thêm bất kỳ text nào ngoài JSON."
        },
        {
          role: "user",
          content: "Tôi đang ở trang GitHub signup. Hãy cho tôi action tiếp theo."
        }
      ],
      max_tokens: 1500,
      temperature: 0.1,
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-xt-dfa9623373697bc9c6d720f7b974e459b54189998b56de42"
      },
      timeout: 25000,
    });

    console.log("Status:", res.status);
    console.log("Raw content:\n", JSON.stringify(res.data.choices[0].message.content));
  } catch (e) {
    console.log("Error:", e.response?.data || e.message);
  }
}

test();
