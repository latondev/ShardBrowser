import { HotmailGraphClient } from '../git/hotmail_graph_client.js';

// Ví dụ 1: Khởi tạo từ chuỗi account
const sampleAccount = "sample@hotmail.com|password123|M.C549_REFRESH_TOKEN_HERE|9e5f94bc-e8a4-4e73-b8be-63364c29d753|recovery@mail.com";

const client = new HotmailGraphClient(sampleAccount);

async function main() {
  console.log("=== KIỂM TRA TRẠNG THÁI TÀI KHOẢN QUA GRAPH API ===");
  const status = await client.checkAccountStatus();
  console.log("Kết quả:", status);

  if (status.isAlive) {
    console.log("\n=== LẤY 5 EMAIL GẦN NHẤT ===");
    const emails = await client.getInboxMessages(5);
    console.log(`Tìm thấy ${emails.length} email.`);

    console.log("\n=== CHỜ MÃ OTP TỰ ĐỘNG TỪ GITHUB ===");
    try {
      const otpResult = await client.waitForOtpCode({
        filterSender: "github.com",
        timeoutMs: 30000,
      });
      console.log("Mã OTP nhận được:", otpResult.otpCode);
    } catch (err) {
      console.log("Không nhận được OTP:", err.message);
    }
  }
}

main();
