import { OMOCaptchaClient } from "./omocaptcha_client.js";

async function main() {
  const client = new OMOCaptchaClient();
  console.log("-> Đang kiểm tra số dư tài khoản OMOCaptcha...");
  const balance = await client.getBalance();
  console.log(`✅ Kết nối thành công! Số dư hiện tại: ${balance} USD`);
}

main().catch(console.error);
