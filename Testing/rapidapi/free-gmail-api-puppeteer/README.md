# RapidAPI + Browser Use local test

Bộ file này mô phỏng luồng:

1. Mở RapidAPI.
2. Đăng nhập bằng GitHub và xử lý mã TOTP.
3. Chọn gói **Basic / Free Plan** của `Free Gmail API`.
4. Mở Playground.
5. Trích xuất `X-RapidAPI-Key` và tên người dùng GitHub.
6. In kết quả theo dạng `key|name`.

## Lưu ý bảo mật

- Chỉ dùng với tài khoản bạn sở hữu hoặc được ủy quyền.
- Không ghi mật khẩu, seed TOTP hoặc API key vào source code, Git hoặc log.
- Không cần dùng `twofa.co`: script tạo TOTP cục bộ bằng `pyotp`, tránh gửi seed cho bên thứ ba.
- API key là bí mật. Không đăng kết quả lên issue, chat công khai hoặc repository.
- Sau khi demo xong, hãy thu hồi API key nếu không còn cần dùng.

## Cài đặt

Yêu cầu Python 3.11+ và một API key cho model mà Browser Use sử dụng.

```bash
python -m venv .venv
source .venv/bin/activate          # Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
playwright install chromium
```

Đặt file `rapidapi.env.example` thành `.env` ở cùng thư mục với script, sau đó điền giá trị thật:

```dotenv
OPENAI_API_KEY=your-model-key
GITHUB_EMAIL=your-github-email
GITHUB_PASSWORD=your-github-password
GITHUB_TOTP_SECRET=your-base32-totp-secret
```

Không đưa file `.env` vào Git. Có thể dùng model khác bằng cách đổi `BROWSER_USE_MODEL`.

## Chạy

```bash
python rapidapi_flow.py
```

Trình duyệt sẽ chạy ở chế độ có giao diện để bạn quan sát. Script yêu cầu agent trả về một dòng duy nhất:

```text
key|github_username
```

Nếu GitHub dừng ở captcha, passkey hoặc cảnh báo bảo mật, hãy thao tác thủ công trên cửa sổ trình duyệt rồi cho agent tiếp tục. Không nhập seed TOTP vào trang lạ; nếu cần nhập OTP thủ công, dùng mã do ứng dụng authenticator tạo.

## Các bước kiểm tra thủ công

1. Truy cập `https://rapidapi.com/auth/login`.
2. Chọn **Login with Github**.
3. Nhập thông tin GitHub ở cửa sổ GitHub.
4. Nhập mã TOTP hiện tại nếu GitHub yêu cầu.
5. Chấp thuận quyền truy cập RapidAPI.
6. Mở `https://rapidapi.com/canvabouys/api/free-gmail-api`.
7. Mở phần pricing, chọn **Basic**, rồi bấm **Start Free Plan**.
8. Trong hộp xác nhận, bấm **Subscribe**.
9. Bấm **Get Started** hoặc **Open playground**.
10. Trong khu vực `App`/`Authorizations`, đọc giá trị `X-RapidAPI-Key`.
11. Mở menu hồ sơ để kiểm tra GitHub username.

## Khắc phục sự cố

- **Đã đăng nhập nhầm tài khoản:** đăng xuất RapidAPI và GitHub trong trình duyệt local, sau đó chạy lại.
- **OTP hết hạn:** dừng agent, chờ mã mới trong ứng dụng authenticator rồi chạy lại.
- **Không thấy Basic:** mở trực tiếp URL `/pricing` của API và cuộn đến nút **Start Free Plan**.
- **Không thấy key:** xác nhận hộp thoại subscription đã báo **Subscription Confirmed**, sau đó tải lại Playground.
- **Agent không lấy đúng key:** mở Playground thủ công và kiểm tra tab `App` hoặc `Authorizations`; không copy key từ log model.

## File trong bộ này

- `rapidapi_flow.py`: script Browser Use mẫu.
- `rapidapi.env.example`: danh sách biến môi trường, không chứa bí mật thật.
- `requirements.txt`: dependency tối thiểu.
- `rapidapi_browser_use_guide.html`: hướng dẫn trực quan để mở local.
