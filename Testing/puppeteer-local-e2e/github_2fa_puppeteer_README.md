# Puppeteer E2E: GitHub 2FA

Script: `github_2fa_puppeteer.mjs`

Script này dùng Puppeteer để:

1. Mở hoặc kết nối tới Chrome local.
2. Đăng nhập GitHub nếu chưa có phiên đăng nhập.
3. Dừng để bạn nhập thủ công mã xác minh thiết bị nếu GitHub yêu cầu.
4. Mở `https://github.com/settings/security`.
5. Bật Authenticator app.
6. Lấy setup key từ GitHub.
7. Mở `https://2fa.page/`, nhập setup key và lấy mã TOTP.
8. Nhập mã TOTP vào GitHub.
9. Lấy recovery codes, nhấn xác nhận đã lưu và kiểm tra trạng thái `Configured`.

Tài khoản hiện tại của bạn đã bật 2FA. Khi chạy lại, script sẽ phát hiện `Authenticator app: Configured` và thoát an toàn, không tắt hoặc thay đổi 2FA.

## Cài đặt

Yêu cầu Node.js 20+:

```bash
mkdir github-2fa-test
cd github-2fa-test
npm init -y
npm install puppeteer
```

Đặt `github_2fa_puppeteer.mjs` vào thư mục này, hoặc chạy file bằng đường dẫn đầy đủ.

## Cách 1: Puppeteer tự mở Chromium

Linux/macOS:

```bash
export GITHUB_USERNAME='your-github-username'
export GITHUB_PASSWORD='your-github-password'
export SAVE_2FA_SECRETS=1
node github_2fa_puppeteer.mjs
```

Windows PowerShell:

```powershell
$env:GITHUB_USERNAME = 'your-github-username'
$env:GITHUB_PASSWORD = 'your-github-password'
$env:SAVE_2FA_SECRETS = '1'
node .\github_2fa_puppeteer.mjs
```

Profile trình duyệt được lưu trong `.puppeteer-profile` để các lần chạy sau có thể giữ phiên đăng nhập.

## Cách 2: Kết nối Chrome đang chạy qua CDP

Khởi động Chrome với một profile riêng và cổng debug. Không dùng profile Chrome chính đang mở:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$PWD/chrome-profile"
```

Trong terminal khác:

```bash
export CDP_URL='http://127.0.0.1:9222'
export GITHUB_USERNAME='your-github-username'
export GITHUB_PASSWORD='your-github-password'
node github_2fa_puppeteer.mjs
```

Nếu Chrome đã đăng nhập GitHub, script sẽ dùng phiên đó và không cần hai biến username/password.

## Đăng nhập sau khi đã bật 2FA

Nếu GitHub yêu cầu TOTP trong lúc đăng nhập, đặt secret hiện tại:

```bash
export GITHUB_TOTP_SECRET='your-totp-secret'
node github_2fa_puppeteer.mjs
```

Script sẽ mở `2fa.page` để lấy mã, không ghi secret vào mã nguồn.

## Lưu ý bảo mật

- Không commit file chứa mật khẩu, TOTP secret hoặc recovery codes.
- `SAVE_2FA_SECRETS=1` tạo file local `github-2fa-secrets.txt`; hãy giữ file này riêng tư.
- `2fa.page` nhận TOTP secret để tạo mã; chỉ dùng cách này với tài khoản test/throwaway. Với tài khoản quan trọng, nên dùng ứng dụng authenticator cục bộ.
- Script không tự động đọc email tạm. Nếu GitHub yêu cầu device verification, bạn nhập mã trên cửa sổ trình duyệt rồi nhấn Enter trong terminal.
- Để test quy trình bật 2FA từ đầu, dùng một tài khoản test khác đang tắt 2FA. Không nên tắt 2FA trên tài khoản chính chỉ để chạy lại test.
