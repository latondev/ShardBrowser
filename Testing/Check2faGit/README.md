# GITHUB 2FA ENABLER & AUTOMATION SUITE (MICROSOFT GRAPH API + CDP)

Bộ công cụ tự động hóa chuyên sâu: Đăng nhập GitHub, tự động lấy mã Device Verification từ hòm thư Hotmail/Outlook qua **Microsoft Graph API**, trích xuất Secret Key, sinh mã TOTP nội bộ và kích hoạt 2FA (Two-Factor Authentication) trên GitHub hoàn toàn tự động.

---

## 📁 Cấu trúc thư mục

```text
D:\YTB\Resgiter_AI\ShardBrowser\Testing\Check2faGit\
│
├── FileHotmail/
│   └── hotmail.txt                 # Danh bạ Hotmail/Outlook (Email|Pass|RefreshToken|ClientId|Recovery)
│
├── Results_GitHub/
│   ├── github_email_code_required.txt  # Danh sách tài khoản GitHub chưa bật 2FA (cần xử lý)
│   ├── github_2fa_enabled.txt          # Danh sách tài khoản đã có 2FA
│   └── github_report_summary.json      # Báo cáo JSON
│
├── Results_2FA_Completed/          # Thư mục lưu kết quả sau khi bật 2FA thành công
│   └── completed_2fa_<timestamp>.txt   # Định dạng: email|password|2fa_secret|recovery_codes
│
├── totp_engine.js                  # Module sinh mã TOTP 6 số (0ms Offline, RFC 6238)
├── hotmail_graph_helper.js         # Module đọc hòm thư & lấy OTP GitHub qua Microsoft Graph API
├── github_2fa_enabler.js           # Core Automation Class xử lý luồng trình duyệt (CDP/Puppeteer)
├── check_github_2fa_status.ps1     # Script PowerShell quét & phân loại trạng thái 2FA GitHub
├── run_batch_2fa.js                # CLI Runner chạy hàng loạt tự động bật 2FA
└── README.md                       # Tài liệu hướng dẫn sử dụng chi tiết
```

---

## 🚀 Tính năng nổi bật

1. **Kết nối đa chế độ:**
   * **CDP Connection:** Kết nối tới profile trình duyệt ShardBrowser đang chạy qua cổng Debugging (`--cdp http://127.0.0.1:9222`).
   * **Standalone Puppeteer:** Tự động mở Google Chrome / Edge độc lập (Hỗ trợ cả giao diện trực quan lẫn chế độ ẩn `--headless`).
2. **Lấy OTP Email tức thì (Graph API):**
   * Sử dụng trực tiếp Microsoft Graph API (`/v1.0/me/mailFolders/inbox/messages`) với `scope: https://graph.microsoft.com/Mail.ReadWrite`.
   * Tốc độ nhận mã xác minh chỉ từ **1 - 3 giây**, chính xác 100%, không cần mở tab Webmail.
3. **Kích hoạt 2FA trơn tru:**
   * Tự động xử lý các màn hình: Sudo Password, Onboarding, Cookie Banners.
   * Trích xuất Base32 Secret Key từ DOM GitHub.
   * Tính toán mã xác nhận TOTP 6 số nội bộ bằng `node:crypto` (Chuẩn RFC 6238).
   * Tự động thu thập và lưu trữ đầy đủ **Recovery Backup Codes**.

---

## 📝 Định dạng dữ liệu đầu vào

### 1. File tài khoản GitHub (`github_email_code_required.txt` hoặc `github_accounts.txt`):
```text
email_or_username|password|optional_old_secret
jeleniewskimayeda563@outlook.com|01652530159Aa@|CRD4ZDGQYH55JLIY
lindloffettie390@outlook.com|01652530159Aa@|553QIIOYMBNSTUKH
```

### 2. File cấu hình Hotmail (`FileHotmail/hotmail.txt`):
```text
email|password|refresh_token|client_id|recovery_email
jeleniewskimayeda563@outlook.com|Z3hS1c3cj8y|M.C534_SN1.0.U.MsaArtifacts.-CqAjf...|9e5f94bc-e8a4-4e73-b8be-63364c29d753
```

---

## ⚙️ Hướng dẫn cài đặt & Thực thi

### Bước 1: Cài đặt thư viện phụ thuộc (Node.js)
```bash
npm install puppeteer-core axios
```

### Bước 2: Chạy kiểm tra & kích hoạt 2FA

#### 1. Chạy mặc định (Tự động nạp file 7 tài khoản cần bật 2FA):
```bash
node run_batch_2fa.js
```

#### 2. Chạy ở chế độ ẩn (Headless):
```bash
node run_batch_2fa.js --headless
```

#### 3. Chạy với file đầu vào tùy chỉnh:
```bash
node run_batch_2fa.js --input github_accounts.txt --hotmail FileHotmail/hotmail.txt
```

#### 4. Kết nối qua cổng CDP ShardBrowser:
```bash
node run_batch_2fa.js --cdp http://127.0.0.1:9222
```

---

## 📤 Định dạng file kết quả đầu ra (`completed_2fa_<timestamp>.txt`)

Mỗi tài khoản sau khi kích hoạt thành công sẽ được lưu thành 1 dòng theo cấu trúc:
```text
email|password|new_2fa_secret|recovery_code_1,recovery_code_2,recovery_code_3,...
```
* **`new_2fa_secret`**: Khóa bí mật Base32 mới kích hoạt trên GitHub (dùng để nạp vào Google Authenticator / Authy / Bot).
* **`recovery_codes`**: Danh sách toàn bộ mã dự phòng khôi phục tài khoản khi mất 2FA.
