# Puppeteer Local E2E

Bộ test này chạy hoàn toàn trên `127.0.0.1`. Mock server tạo tài khoản, inbox và OTP trong bộ nhớ; Puppeteer đi qua toàn bộ luồng:

1. Mở trang đăng ký.
2. Điền email, mật khẩu và username test.
3. Submit form.
4. Mở inbox giả lập và đọc OTP.
5. Nhập OTP vào từng ô.
6. Xác minh tài khoản.
7. Đăng nhập và kiểm tra dashboard.

## Chạy bằng Chromium do Puppeteer quản lý

```bash
npm install
npm test
```

Kết quả mẫu:

```json
{
  "email": "researcher@example.test",
  "username": "puppeteer-researcher",
  "otp": "42981031",
  "status": "verified-and-signed-in",
  "dashboard": "Welcome, puppeteer-researcher"
}
```

## Dùng browser local đã chạy sẵn

Nếu plugin local cung cấp WebSocket endpoint:

```bash
BROWSER_WS_ENDPOINT='ws://127.0.0.1:9222/devtools/browser/...' npm test
```

Nếu plugin cung cấp CDP HTTP URL:

```bash
BROWSER_CDP_URL='http://127.0.0.1:9222' npm test
```

Khi dùng browser có sẵn, script chỉ mở và đóng các tab do nó tạo; nó không đóng browser của plugin.

## Ghi chú

- OTP `42981031` là mã cố định của mock server để test có thể lặp lại.
- Các selector `data-testid` là selector của ứng dụng local giả lập.
- Không thay các URL local bằng GitHub hoặc dịch vụ email tạm để tự động tạo tài khoản thật.
