import axios from "axios";

async function testModel(model) {
  const t0 = Date.now();
  try {
    const res = await axios.post("https://api.xkiro.com/v1/chat/completions", {
      model,
      messages: [
        { role: "system", content: "Trả về đúng 1 JSON duy nhất: {\"thought\": \"quan sát form\", \"action\": \"type\"}" },
        { role: "user", content: "Tôi đang ở ô email" }
      ],
      max_tokens: 500,
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-xt-dfa9623373697bc9c6d720f7b974e459b54189998b56de42"
      },
      timeout: 15000
    });
    console.log(`✅ [${model}] -> Phản hồi trong ${Date.now() - t0}ms:\n${res.data.choices[0].message.content}\n`);
  } catch (e) {
    console.log(`❌ [${model}] -> Thất bại: ${e.response?.data?.error?.message || e.message}\n`);
  }
}

async function run() {
  await testModel("google/gemini-3.7-flash");
  await testModel("qwen/qwen3.8-max");
  await testModel("mistralai/mistral-large-2512");
  await testModel("stealth/ox-alpha-free");
}

run();
