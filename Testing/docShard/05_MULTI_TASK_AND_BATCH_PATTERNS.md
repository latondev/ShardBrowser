# 🔁 Multi-Tasking, Concurrency & Batch Runner Patterns

Tài liệu này hướng dẫn các mẫu kiến trúc để chạy **song song nhiều tác vụ tự động hóa** cùng lúc trên ShardBrowser và kỹ thuật chạy **hàng loạt 24/7 (Batch Runner)**.

---

## 1. Cơ Chế Chạy Song Song Đa Nhiệm (Multi-Profile Concurrency)

ShardBrowser tự động cấp phát một cổng CDP ngẫu nhiên và thư mục User Data riêng biệt cho từng profile khi khởi chạy:

```text
┌─────────────────────────────────────────────────────────────┐
│                 ShardBrowser Launcher API                   │
└──────────────┬───────────────────────────────┬──────────────┘
               │ (Start Profile A)             │ (Start Profile B)
┌──────────────▼──────────────┐ ┌──────────────▼──────────────┐
│ Profile: 'GitHub-Auto'      │ │ Profile: 'Veo3'             │
│ CDP Port: 58312             │ │ CDP Port: 58313             │
│ Proxy: VN Viettel           │ │ Proxy: US Residential       │
│ Task: GitHub Registration   │ │ Task: Google Flow Render    │
└─────────────────────────────┘ └─────────────────────────────┘
```

### Cách chạy đồng thời trong thực tế:
Bạn có thể mở nhiều cửa sổ terminal và chạy các bot khác nhau hoàn toàn độc lập:
- **Terminal 1 (GitHub Bot)**: `node Testing/git/batch_runner.js 500 20`
- **Terminal 2 (Google Flow Video Bot)**: `cd Testing/flow && npm run ext:run`

Hai tác vụ hoạt động hoàn toàn độc lập, không chiếm quyền điều khiển và không xung đột kết nối CDP của nhau.

---

## 2. Mẫu Thiết Kế Batch Runner Chạy 24/7 (Infinite Batch Pattern)

Dưới đây là cấu trúc hoàn chỉnh của một Batch Runner chuyên nghiệp:

```javascript
import { ProfileManager } from "./02_PROFILE_AND_FINGERPRINT.md";
import { connectToShardBrowser, humanType } from "./04_CDP_AND_PUPPETEER_AUTOMATION.md";

export class BatchAutomationRunner {
  constructor({ targetCount = Infinity, cooldownSeconds = 30, groupName = "Batch-Task" }) {
    this.targetCount = targetCount;
    this.cooldownSeconds = cooldownSeconds;
    this.groupName = groupName;
    this.successCount = 0;
    this.failCount = 0;
    this.isStopping = false;
    this.profileMgr = new ProfileManager(this.groupName);

    // Bắt sự kiện tắt an toàn
    process.on("SIGINT", async () => {
      console.log("\n⚠️ [Dừng Hệ Thống] Đang dọn dẹp trước khi thoát...");
      this.isStopping = true;
      await this.profileMgr.destroyCurrentProfile();
      this.printReport();
      process.exit(0);
    });
  }

  async runSingleTask(index) {
    console.log(`\n==================================================`);
    console.log(`🚀 [Bắt đầu Task #${index + 1}] Nhóm: [${this.groupName}]`);
    console.log(`==================================================`);

    try {
      // 1. Tạo profile mới & lấy WebSocket CDP
      await this.profileMgr.createIsolatedProfile();
      const wsUrl = await this.profileMgr.launchProfile(false);

      // 2. Kết nối Puppeteer
      const browser = await connectToShardBrowser(wsUrl);
      const page = (await browser.pages())[0] || (await browser.newPage());

      // 3. Thực hiện kịch bản tự động
      await page.goto("https://github.com/signup", { waitUntil: "domcontentloaded", timeout: 60000 });
      // ... Thao tác đăng ký, OTP, 2FA ...

      this.successCount++;
      console.log(`✅ [Task #${index + 1}] Thành công!`);
    } catch (err) {
      this.failCount++;
      console.error(`❌ [Task #${index + 1}] Thất bại: ${err.message}`);
    } finally {
      // 4. Giải phóng tài nguyên ngay lập tức
      await this.profileMgr.destroyCurrentProfile();
    }
  }

  async start() {
    let index = 0;
    while (index < this.targetCount && !this.isStopping) {
      await this.runSingleTask(index);
      index++;

      if (index < this.targetCount && !this.isStopping) {
        console.log(`⏳ Nghỉ ${this.cooldownSeconds}s trước khi chạy lượt tiếp theo...`);
        await new Promise((r) => setTimeout(r, this.cooldownSeconds * 1000));
      }
    }

    this.printReport();
  }

  printReport() {
    console.log("\n==================================================");
    console.log("                BÁO CÁO TỔNG KẾT                  ");
    console.log("==================================================");
    console.log(`Tổng lượt chạy: ${this.successCount + this.failCount}`);
    console.log(`✅ Thành công : ${this.successCount}`);
    console.log(`❌ Thất bại   : ${this.failCount}`);
    console.log("==================================================\n");
  }
}

// Khởi chạy: node batch.js
if (process.argv[1]?.endsWith("batch.js")) {
  const runner = new BatchAutomationRunner({ targetCount: 100, cooldownSeconds: 20 });
  runner.start();
}
```

---

## 3. Checklist Tối Ưu Hiệu Năng & Ổn Định

1. **Bộ nhớ RAM**: Luôn đóng profile cũ trước khi tạo profile mới để duy trì mức RAM dưới 500MB.
2. **Timeout an toàn**: Thiết lập `protocolTimeout: 240000` (4 phút) trên Puppeteer để tránh mất kết nối WebSocket khi tải trang nặng.
3. **Giám sát Quota API**: Nếu tích hợp các dịch vụ bên thứ 3 (như Email API / Captcha solver), xây dựng hàm tự động tạm dừng 1 giờ khi hết Quota và tự động chạy tiếp khi được cấp mới.
