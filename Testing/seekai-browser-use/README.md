# SeekAI + Browser Use JavaScript test

- `npm run start:shard`: Chạy 1 tài khoản với **ShardBrowser Sandbox** (mỗi tài khoản tự động sinh 1 bộ Fingerprint độc bản, không phát hiện bot).
- `npm run batch`: Chạy hàng loạt tài khoản từ `accounts.txt` với ShardBrowser Sandbox, tự động dọn dẹp profile và lưu kết quả vào `output.txt` theo định dạng `username|pass|apikey`.
- `npm run start:local`: Chạy Chrome local bằng Playwright thông thường.
- `npm start`: Chạy qua Browser Use Cloud SDK.

Open-source Browser Use agent hiện chủ yếu có API Python. Với JavaScript, cách được tài liệu Browser Use hỗ trợ là `browser-use-sdk` hoặc điều khiển browser qua Playwright/Puppeteer.

## Cài đặt

```bash
cd seekai-browser-use
npm install
cp .env.example .env
```

Mở `.env` và điền:

- `BROWSER_USE_API_KEY`: bắt buộc khi dùng `npm start`, lấy tại https://cloud.browser-use.com/settings?tab=api-keys
- `GITHUB_LOGIN`: email hoặc username GitHub
- `GITHUB_PASSWORD`: mật khẩu GitHub
- `GITHUB_TOTP_SECRET`: secret Base32 của ứng dụng 2FA
- `GITHUB_EXPECTED_USERNAME`: username GitHub để script không vô tình authorize nhầm tài khoản

Không commit `.env`. Secret 2FA và API key là thông tin nhạy cảm.

## Chạy Browser Use Cloud từ local

```bash
npm start
```

Script sẽ:

1. Tạo một Browser Use browser tạm thời.
2. Mở trang đăng ký SeekAI và bật đồng ý điều khoản để nút GitHub hoạt động.
3. Đăng nhập GitHub.
4. Tạo mã TOTP cục bộ bằng `otpauth` và nhập mã khi GitHub yêu cầu.
5. Bỏ qua lời mời tạo passkey tùy chọn.
6. Kiểm tra đúng GitHub username trên trang OAuth rồi authorize SeekAI.
7. Mở API Keys, tạo `Auto_API_Key_01`, lấy full key và thử copy vào clipboard.
8. In JSON kết quả, sau đó dừng Browser Use browser để tránh phát sinh thời gian chạy.

Kết quả thành công có dạng:

```json
{"status":"success","github_account":"...","api_key":"sk-...","copied":true}
```

## Chạy Chrome local

Nếu máy chưa có browser binary của Playwright:

```bash
npx playwright install chromium
```

Sau đó chạy:

```bash
npm run playwright
# hoặc: node playwright_seekai.js
```

Để chạy test spec đầy đủ:

```bash
npx playwright test tests/seekai.full.spec.js
```

Đặt `TOTP_SOURCE=site` trong `.env` nếu muốn test mở `https://2fa.co.com/` đúng như quy trình ban đầu. Mặc định `TOTP_SOURCE=local` tạo mã ngay trong tiến trình bằng `otpauth`.

Đặt `HEADLESS=1` nếu muốn chạy ẩn. Đặt `KEEP_BROWSER=1` để giữ cửa sổ mở sau khi script hoàn tất phục vụ việc kiểm tra.

## Lưu ý an toàn

- Script không dùng `https://2fa.co.com/`; mã TOTP được tạo cục bộ để secret không phải gửi sang website khác.
- Nếu profile local đã đăng nhập GitHub bằng tài khoản khác, hãy xóa thư mục `.local-browser-profile/` hoặc dùng `GITHUB_EXPECTED_USERNAME` để script dừng trước khi authorize nhầm.
- Mỗi lần chạy tạo một API key mới. Hãy revoke các key thử nghiệm không còn dùng trong trang API Keys của SeekAI.
- API key chỉ được hiển thị một lần trong output. Không đưa output vào log công khai hoặc commit vào Git.
