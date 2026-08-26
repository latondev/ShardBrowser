# 🚀 GitHub Autonomous Registration & 2FA Suite (ShardBrowser Edition)

Bộ công cụ tự động hóa **Đăng ký tài khoản GitHub 100% tự động** tích hợp xác thực **Email OTP thật (Gmail/Outlook)**, cấu hình bảo mật **2FA TOTP**, mạng **Proxy xoay** và môi trường **ShardBrowser Sandbox cách ly chống phát hiện (Anti-detect)**.

---

## 🌟 Tính Năng Nổi Bật

- 🛡️ **ShardBrowser Sandbox Cách Ly 100%**: Tự động tạo Profile tạm thời thuộc nhóm **`GitHub-Auto`** với Fingerprint Windows mới (Canvas, WebGL, Audio Noise, Fonts), dọn dẹp sạch sẽ sau khi hoàn tất.
- 🔄 **Chạy Song Song Đa Tác Vụ (Multi-Profile Concurrency)**: Sử dụng ShardBrowser Launcher API động, chạy độc lập song song với các tool khác (như `Testing/flow` nhóm `Veo3`) mà không bao giờ bị nghẽn hay chặn cổng CDP.
- 📧 **Gmail & Outlook Temp Tự Động**: Tích hợp client sinh email `@gmail.com` thật qua RapidAPI (kèm pool 44 API keys tự động luân chuyển chống Rate Limit) và fallback sang MailTm / UnlimitMail.
- 🔑 **Xác Thực 2FA TOTP Tự Động (0ms Offline)**: Tự động trích xuất Base32 Setup Key trên GitHub và tính toán mã xác minh TOTP 6 số ngay trên máy bằng `node:crypto` chuẩn RFC 6238.
- 🌐 **Hỗ Trợ Proxy Xoay Động**: Tích hợp `ProxyXoayClient` tự động lấy và nạp Proxy (kèm IP, Port, Username, Password) trực tiếp vào Profile.
- 👤 **Giả Lập Hành Vi Người Dùng (Human-like)**: Gõ phím với độ trễ ngẫu nhiên (`40ms - 80ms`), di chuyển chuột mượt mà (`humanMouseMove`), cuộn trang tự nhiên và tự động đóng các Cookie Banner.

---

## 📁 Cấu Trúc Thư Mục

```text
Testing/git/
├── ai_agent_runner.js       # 🤖 Core Runner: Quy trình tạo profile -> Điền form -> OTP -> 2FA
├── batch_runner.js          # 🔁 Chạy hàng loạt (Batch Mode) với số lượng và cooldown tùy chỉnh
├── gmail_creator_client.js  # 📧 Client tạo Gmail qua RapidAPI (kèm pool keys & retry)
├── mailtm_client.js         # 📬 Client email dự phòng (MailTm / TempMail)
├── totp_client.js           # 🔐 Client giải mã Base32 và sinh mã TOTP 2FA
├── proxyxoay_client.js      # 🌐 Client lấy và xoay Proxy từ proxyxoay.net
├── rapidapikey.md           # 🔑 Danh sách 44 RapidAPI keys cho Gmail API
├── benchmark.js             # ⚡ Đo lường hiệu năng và kiểm thử tốc độ
└── README.md                # 📖 Tài liệu hướng dẫn sử dụng
```

---

## ⚙️ Cấu Hình Hệ Thống

### 1. Cài Đặt Dependencies
Đảm bảo đã cài đặt các thư viện Node.js cần thiết trong thư mục gốc:
```bash
npm install axios puppeteer-core
```

### 2. Tự Động Kết Nối ShardBrowser Launcher
Tool tự động đọc file cấu hình `settings.json` tại `%APPDATA%\shardx-launcher\settings.json`:
- Tự động lấy cổng `api_port` (mặc định: `40325` hoặc `40326`).
- Tự sinh chữ ký JWT Token (`HS256`) từ `api_secret`.

---

## 🚀 Hướng Dẫn Sử Dụng

### Cách 1: Chạy Hàng Loạt Tự Động (Batch Runner - Khuyên Dùng)

Chạy đăng ký nhiều tài khoản với thời gian nghỉ giữa các lần:

```bash
# Cú pháp: node Testing/git/batch_runner.js <tổng_số_tài_khoản> <thời_gian_nghỉ_giây>
node Testing/git/batch_runner.js 5000 18
```

- `5000`: Tổng số tài khoản cần tạo.
- `18`: Thời gian nghỉ (cooldown) 18 giây giữa mỗi lần tạo tài khoản để làm mới IP/Proxy.

---

### Cách 2: Chạy Đơn Lẻ Một Tài Khoản (Single Run)

Chạy kiểm thử trực tiếp 1 tài khoản với log chi tiết từng bước:

```bash
node -e "
import('./Testing/git/ai_agent_runner.js').then(async (m) => {
  const runner = new m.AiAgentRunner();
  const res = await runner.runAutonomousFlow();
  console.log('Kết quả:', res);
});
"
```

---

## 🔀 Chạy Song Song Cùng Lúc Với Google Flow

Nhờ cơ chế cách ly nhóm Profile trong ShardBrowser, bạn có thể mở 2 cửa sổ terminal và chạy song song cả 2 tool:

- **Terminal 1 (Đăng ký tài khoản GitHub - Nhóm `GitHub-Auto`)**:
  ```bash
  node Testing/git/batch_runner.js 5000 18
  ```

- **Terminal 2 (Google Flow Image/Video Render - Nhóm `Veo3`)**:
  ```bash
  cd Testing/flow
  npm run ext:run
  ```

Hai tool sẽ chạy trên 2 cổng CDP độc lập, không bao giờ gây xung đột hay chiếm quyền điều khiển của nhau.

---

## 📊 Dữ Liệu Đầu Ra & Báo Cáo

Sau khi hoàn tất đăng ký thành công mỗi tài khoản, thông tin bao gồm:
- **Email**: Địa chỉ Gmail / Outlook đăng ký.
- **Username**: Tên người dùng GitHub đã tạo.
- **Password**: Mật khẩu bảo mật mạnh.
- **2FA Secret**: Khóa khôi phục 2FA Base32.
- **Recovery Codes**: Danh sách mã khôi phục 2FA dự phòng.
- **Thời gian hoàn thành**: Tốc độ xử lý trung bình ~40s - 60s / tài khoản.
