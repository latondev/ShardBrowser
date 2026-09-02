import axios from "axios";
import puppeteer from "puppeteer-core";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadShardConfig() {
  const homeDir = os.homedir();
  const candidateSettings = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "settings.json") : null,
    path.join(homeDir, ".config", "shardx-launcher", "settings.json"),
    path.join(homeDir, "AppData", "Roaming", "shardx-launcher", "settings.json")
  ].filter(Boolean);

  for (const p of candidateSettings) {
    if (fs.existsSync(p)) {
      try {
        const settings = JSON.parse(fs.readFileSync(p, "utf-8"));
        const port = settings.api_port || 40326;
        const secret = settings.api_secret || "";
        let token = "";
        if (secret) {
          const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "HS256" })).toString("base64url");
          const now = Math.floor(Date.now() / 1000);
          const payload = Buffer.from(JSON.stringify({ sub: "shardx-api", iat: now, exp: now + 86400 * 30 })).toString("base64url");
          const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest().toString("base64url");
          token = `${header}.${payload}.${sig}`;
        }
        return { url: `http://127.0.0.1:${port}`, headers: { Authorization: `Bearer ${token}` } };
      } catch {}
    }
  }
  return { url: "http://127.0.0.1:40326", headers: {} };
}

function extractOtp(text) {
  if (!text) return null;
  const otpPatterns = [
    /(?:code|mã|verification|otp|is)[:\s]+([a-zA-Z0-9]{4,8})/i,
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
    /\b(\d{8})\b/
  ];
  for (const p of otpPatterns) {
    const match = text.match(p);
    if (match) return match[1];
  }
  return null;
}

async function runTestFlow() {
  console.log("\n==================================================");
  console.log("🚀 BẮT ĐẦU TEST FLOW THẬT: LẤY EMAIL & CHỜ THƯ ĐẾN");
  console.log("==================================================\n");

  const config = loadShardConfig();
  console.log(`[1] Đang kết nối ShardBrowser tại: ${config.url}`);

  const { data: fpRes } = await axios.get(`${config.url}/fingerprint/new/windows`, { headers: config.headers });
  const { data: profile } = await axios.post(`${config.url}/profiles`, {
    name: "TEST-MAILTICKING-REAL",
    folder: "Testing",
    fingerprint: fpRes.fingerprint,
  }, { headers: config.headers });

  console.log(`[2] Đã tạo Profile ShardBrowser: ID = ${profile.id}`);

  let browser = null;
  const outputResult = {
    email: null,
    generatedAt: null,
    mailReceived: null,
    status: "PENDING"
  };

  try {
    const { data: startRes } = await axios.post(`${config.url}/profiles/${profile.id}/start`, { headless: false }, { headers: config.headers });
    const wsUrl = startRes.cdp?.web_socket_debugger_url;
    browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
    const page = (await browser.pages())[0] || (await browser.newPage());

    console.log(`[3] Đang mở trình duyệt vào trang: https://www.mailticking.com/`);
    await page.goto("https://www.mailticking.com/", { waitUntil: "domcontentloaded", timeout: 60000 });

    console.log(`[4] Đang chờ vượt Cloudflare & trang hiển thị hộp thư...`);
    console.log(`    (💡 Mẹo: Nếu trên màn hình trình duyệt có checkbox 'Verify you are human', bạn có thể click xác minh trên cửa sổ trình duyệt).`);

    let extractedEmail = null;
    const maxWaitTime = 60000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      // Tự động thử click Turnstile nếu có iframe
      try {
        for (const frame of page.frames()) {
          const cb = await frame.$("input[type='checkbox'], #challenge-stage, .ctp-checkbox-label");
          if (cb) {
            await cb.click().catch(() => {});
          }
        }
      } catch {}

      // Kiểm tra xem đã qua Cloudflare và vào trang chính chưa
      const pageInfo = await page.evaluate(() => {
        const title = document.title || "";
        const isCf = title.includes("Just a moment") || title.includes("Chờ một chút") || document.body.innerText.includes("Ray ID");
        if (isCf) return null;

        // Tìm ô input chứa email của MailTicking
        // Thường MailTicking đặt email ở ô input readonly, hoặc element id/class chứa 'mail', 'email', 'address'
        const inputs = Array.from(document.querySelectorAll("input, .email-text, #email, .current-email, .mail-address, h1, h2, h3, div, span"));
        
        for (const el of inputs) {
          const val = (el.value || el.innerText || "").trim();
          // Regex tìm email đuôi @gmail.com hoặc domain hợp lệ
          const m = val.match(/([a-zA-Z0-9._%+-]+@(?:gmail\.com|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))/i);
          if (m && !m[1].includes("cloudflare") && !m[1].includes("example") && !m[1].includes("support@") && !m[1].includes("contact@")) {
            return {
              email: m[1],
              title,
              bodySnippet: document.body.innerText.slice(0, 500)
            };
          }
        }

        return { email: null, title, bodySnippet: document.body.innerText.slice(0, 500) };
      }).catch(() => null);

      if (pageInfo && pageInfo.email) {
        extractedEmail = pageInfo.email;
        break;
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    if (!extractedEmail) {
      throw new Error("Không lấy được email thực tế từ MailTicking (Vẫn bị kẹt ở Cloudflare xác minh hoặc trang không tạo email).");
    }

    outputResult.email = extractedEmail;
    outputResult.generatedAt = new Date().toISOString();

    console.log(`\n===============================================================`);
    console.log(`✅ ĐÃ LẤY ĐƯỢC EMAIL THỰC TẾ: [ ${extractedEmail} ]`);
    console.log(`===============================================================\n`);

    // ==========================================
    // BƯỚC 2: SAU 2 GIÂY BẮT ĐẦU CHỜ GỬI THƯ THẬT
    // ==========================================
    console.log(`[5] Đang đợi 2 giây theo yêu cầu flow...`);
    await new Promise(r => setTimeout(r, 2000));

    console.log(`\n---------------------------------------------------------------`);
    console.log(`👉 BÂY GIỜ BẠN HÃY GỬI 1 EMAIL THỬ NGHIỆM VÀO: [ ${extractedEmail} ]`);
    console.log(`   (Ví dụ: Dùng tài khoản Gmail của bạn gửi 1 thư có mã OTP hoặc test message vào địa chỉ trên)`);
    console.log(`---------------------------------------------------------------\n`);
    console.log(`[6] Đang liên tục lắng nghe và làm mới Hộp thư đến (Inbox) trong 90 giây...`);

    let receivedMessage = null;
    const inboxWaitStart = Date.now();
    const inboxTimeout = 90000; // 90s để người dùng có thời gian gửi mail thật

    while (Date.now() - inboxWaitStart < inboxTimeout) {
      // 1. Nhấn nút "Check emails" hoặc "Refresh" trên MailTicking để làm mới hộp thư
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, a, .btn, [role='button']"));
        const checkBtn = buttons.find(b => {
          const t = (b.innerText || "").toLowerCase();
          return t.includes("check emails") || t.includes("check email") || t.includes("làm mới") || t.includes("refresh");
        });
        if (checkBtn) {
          checkBtn.click();
        }
      }).catch(() => {});

      await new Promise(r => setTimeout(r, 2000));

      // 2. Kiểm tra danh sách thư THỰC SỰ trong bảng (Loại trừ các dòng thông báo rỗng)
      const scanResult = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("table tbody tr, .mail-item, .mailbox-row, .message-card"));
        
        const validEmails = [];
        for (const row of rows) {
          const text = (row.innerText || "").trim();
          // BỎ QUA nếu chỉ là thông báo chưa có thư
          if (
            !text ||
            text.includes("No emails received yet") ||
            text.includes("Chưa có thư") ||
            text.includes("No messages") ||
            text.includes("Empty") ||
            text.includes("Loading")
          ) {
            continue;
          }

          // Phân tích các cột td trong row
          const cols = Array.from(row.querySelectorAll("td, th, div, span")).map(c => (c.innerText || "").trim()).filter(Boolean);
          
          validEmails.push({
            rawText: text,
            cols,
            hasClickable: !!row
          });
        }

        return {
          validEmails,
          rowCount: rows.length
        };
      }).catch(() => ({ validEmails: [], rowCount: 0 }));

      if (scanResult && scanResult.validEmails.length > 0) {
        console.log(`\n📨 PHÁT HIỆN CÓ THƯ MỚI TRONG HỘP THƯ! Đang mở xem nội dung...`);
        
        // Click vào thư đầu tiên để đọc nội dung chi tiết
        await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll("table tbody tr, .mail-item, .mailbox-row, .message-card"));
          for (const row of rows) {
            const text = (row.innerText || "").trim();
            if (
              text &&
              !text.includes("No emails received yet") &&
              !text.includes("Chưa có thư") &&
              !text.includes("No messages")
            ) {
              row.click();
              break;
            }
          }
        }).catch(() => {});

        await new Promise(r => setTimeout(r, 2000));

        // Đọc chi tiết thư sau khi mở modal/popup/view
        const detail = await page.evaluate(() => {
          // Tìm các vùng chứa nội dung thư
          const modalOrView = document.querySelector(".modal, .mail-view, .email-content, .message-content, .card-body, #mail-body, article");
          const subjectEl = document.querySelector(".mail-subject, .subject, h2, h3, h4, .title");
          const fromEl = document.querySelector(".mail-from, .from, .sender, strong");
          
          const fullText = modalOrView ? modalOrView.innerText : document.body.innerText;
          return {
            from: fromEl ? fromEl.innerText.trim() : "",
            subject: subjectEl ? subjectEl.innerText.trim() : "",
            content: fullText.slice(0, 3000)
          };
        }).catch(() => ({ from: "", subject: "", content: "" }));

        const firstMail = scanResult.validEmails[0];
        const combinedContent = detail.content || firstMail.rawText;
        const otp = extractOtp(combinedContent);

        receivedMessage = {
          from: detail.from || firstMail.cols[0] || "Unknown Sender",
          subject: detail.subject || firstMail.cols[1] || "No Subject",
          time: firstMail.cols[2] || new Date().toLocaleTimeString(),
          content: combinedContent,
          extractedOtp: otp,
          receivedAt: new Date().toISOString()
        };

        break;
      }

      process.stdout.write(".");
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log("\n");

    if (receivedMessage) {
      outputResult.mailReceived = receivedMessage;
      outputResult.status = "SUCCESS";

      console.log(`===============================================================`);
      console.log(`🎉 KẾT QUẢ: ĐÃ NHẬN VÀ BÓC TÁCH THƯ THẬT THÀNH CÔNG!`);
      console.log(`===============================================================`);
      console.log(`📧 Người gửi (From):    ${receivedMessage.from}`);
      console.log(`📌 Tiêu đề (Subject):   ${receivedMessage.subject}`);
      console.log(`⏰ Thời gian nhận:      ${receivedMessage.time}`);
      if (receivedMessage.extractedOtp) {
        console.log(`🔑 Mã OTP / Code:       [ ${receivedMessage.extractedOtp} ]`);
      }
      console.log(`---------------------------------------------------------------`);
      console.log(`📝 Nội dung chi tiết:\n${receivedMessage.content.slice(0, 500)}`);
      console.log(`===============================================================\n`);
    } else {
      outputResult.status = "TIMEOUT_NO_MAIL";
      console.log(`⚠️ Hết thời gian chờ 90s nhưng chưa nhận được thư thật nào gửi vào [ ${extractedEmail} ].`);
    }

    const logPath = path.join(__dirname, "flow_result.json");
    fs.writeFileSync(logPath, JSON.stringify(outputResult, null, 2));
    console.log(`📁 Đã lưu log kết quả chi tiết vào: ${logPath}`);

    console.log(`\n⏳ Giữ trình duyệt thêm 10 giây để bạn quan sát giao diện...`);
    await new Promise(r => setTimeout(r, 10000));

    await browser.disconnect();
  } catch (error) {
    outputResult.status = "ERROR";
    outputResult.error = error.message;
    console.error(`❌ LỖI TRONG FLOW:`, error.message);
  } finally {
    console.log(`[7] Đang dọn dẹp profile ShardBrowser...`);
    await axios.post(`${config.url}/profiles/${profile.id}/stop`, {}, { headers: config.headers }).catch(() => {});
    await axios.delete(`${config.url}/profiles/${profile.id}`, { headers: config.headers }).catch(() => {});
    console.log(`🏁 Hoàn tất.`);
  }
}

runTestFlow();
