# ⚡ DesployGit Account Hub - Centralized Account Management Server

Hệ thống máy chủ trung tâm quản lý tài khoản tự động (GitHub / AI / Service accounts) kết hợp **Web Dashboard** và **RESTful API Ingestion**, được đóng gói sẵn sàng cho **Docker & Docker Compose** trên VPS hoặc máy Local.

---

## 🌟 Tính Năng Nổi Bật
- 📊 **Web Dashboard Trực Quan**: Xem, tìm kiếm theo email/username/proxy, lọc trạng thái, phân trang mượt mà.
- ⚡ **1-Click Copy & Export**: Copy nhanh toàn bộ tài khoản định dạng `email|password|2fa_secret`, xuất file `.txt`, `.csv`, `.json`.
- 🔑 **Bảo Mật Kép**: 
  - API Ingest bảo vệ bằng Header `X-API-Key: {{API_SECRET_KEY}}`.
  - Web Dashboard bảo vệ bởi `Admin Login + JWT Cookie + Rate Limit`.
- 💾 **Lưu Trữ Bền Vững (Persistent Storage)**: Sử dụng SQLite mount qua Docker Volume (`./data:/app/data`), không bao giờ lo mất dữ liệu khi restart hoặc update container.
- 🔄 **Dual-Mode Client Support**: Tích hợp hoàn hảo với Tool Client (hỗ trợ lưu song song file `.txt` local và bắn API lên Server có fallback).

---

## 📁 Cấu Trúc Thư Mục `DesployGit/`

```text
DesployGit/
├── bot/                   # 🤖 Bot Worker Tự Động Reg GitHub
│   ├── ai_agent_runner.js # Engine tự động tạo tài khoản & cấu hình 2FA
│   ├── batch_runner.js    # Quản lý chạy hàng loạt theo mục tiêu
│   ├── account_storage.js # Module lưu trữ Dual-Mode (Local + API)
│   ├── mailtm_client.js   # Client lấy mail & OTP tự động từ Mail.tm
│   ├── gmail_creator_client.js # Client lấy Gmail & OTP từ RapidAPI
│   ├── totp_client.js     # Engine tính mã 2FA TOTP chuẩn offline 0ms
│   ├── proxyxoay_client.js# Quản lý tự động xoay IP Proxy Việt Nam
│   ├── rapidapikey.md     # Danh sách key RapidAPI
│   ├── output.txt         # File lưu kết quả (email|password|2fa)
│   ├── run_bot.sh         # Script chạy bot trên Linux (có Xvfb)
│   ├── run_bot.ps1        # Script chạy bot trên Windows
│   └── package.json       # Dependencies riêng cho Bot Worker
│
├── data/                  # 💾 Thư mục lưu database SQLite (accounts.db)
├── public/                # 🖥️ Giao diện Web Dashboard Quản Trị
│   ├── index.html         # Bảng điều khiển chính (Search, Filter, 1-Click Copy)
│   ├── login.html         # Màn hình đăng nhập bảo mật
│   ├── app.js             # Client logic dashboard
│   └── style.css          # CSS Dark Theme Glassmorphism
├── src/                   # ⚙️ Mã nguồn Backend Server Hub
│   ├── auth.js            # Middleware xác thực API Key & JWT
│   ├── database.js        # SQLite Service & Repositories
│   └── server.js          # Express REST API Server
├── .env.example           # File mẫu biến môi trường Server
├── Dockerfile             # Multi-stage Dockerfile tối ưu cho Server
├── docker-compose.yml     # File cấu hình Docker Compose
├── deploy.sh              # Script 1-click deploy Server lên VPS Linux
├── deploy.ps1             # Script 1-click deploy Server cho Windows
├── package.json           # Node.js dependencies của Server
└── README.md              # Hướng dẫn chi tiết
```

---

## 🚀 Hướng Dẫn Chạy Thử Ngay Tại Máy Local

### Cách 1: Chạy trực tiếp bằng Node.js
```bash
cd DesployGit
npm install
cp .env.example .env     # (hoặc copy .env.example thành .env trên Windows)
npm start
```
Truy cập: **`http://localhost:8080`** (Mặc định tài khoản: `admin` / `AdminSecure@2026!Pass`)

---

### Cách 2: Chạy bằng Docker Compose (Khuyên dùng)
```bash
cd DesployGit
docker compose up -d --build
```
Kiểm tra logs:
```bash
docker compose logs -f
```

---

## 🌐 Danh Sách RESTful API

| Method | Endpoint | Auth | Mô tả |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Public | Kiểm tra trạng thái máy chủ (Healthcheck) |
| `POST` | `/api/v1/auth/login` | Public | Đăng nhập Admin Dashboard |
| `POST` | `/api/v1/accounts` | `X-API-Key` | Đẩy 1 acc hoặc batch nhiều acc từ tool client |
| `GET` | `/api/v1/accounts` | Admin / API Key | Lấy danh sách tài khoản (hỗ trợ phân trang, filter, search) |
| `GET` | `/api/v1/accounts/:id` | Admin / API Key | Lấy chi tiết 1 tài khoản (kèm recovery codes) |
| `DELETE` | `/api/v1/accounts/:id` | Admin | Xóa tài khoản |
| `GET` | `/api/v1/stats` | Admin / API Key | Thống kê số lượng acc tổng / theo ngày |
| `GET` | `/api/v1/export` | Admin / API Key | Xuất dữ liệu (`?format=txt`, `csv`, `json`) |

### Mẫu Body gửi Account đơn (`POST /api/v1/accounts`):
```json
{
  "email": "user.example@gmail.com",
  "username": "userexample123",
  "password": "Password@2026!Strong",
  "twoFactorSecret": "JBSWY3DPEHPK3PXP",
  "recoveryCodes": ["abcd-1234", "efgh-5678"],
  "proxy": "103.123.45.67:8080"
}
```

---

## ☁️ Quy Trình Triển Khai Lên VPS (Phase 4)

Khi bạn đã có VPS (Ubuntu), chỉ cần làm 3 bước:
1. **Copy thư mục `DesployGit/` lên VPS:**
   ```bash
   scp -r DesployGit/ root@<IP_VPS>:/root/
   ```
2. **SSH vào VPS và chạy script:**
   ```bash
   ssh root@<IP_VPS>
   cd DesployGit
   chmod +x deploy.sh && ./deploy.sh
   ```
3. **Mở trình duyệt truy cập:** `http://<IP_VPS>:8080`
