# HƯỚNG DẪN VẬN HÀNH & BẢO TRÌ HỆ THỐNG GITHUB REGISTRATION SUITE (ANTI-DATADOME & SHARDBROWSER)

Tài liệu này ghi lại toàn bộ kinh nghiệm thực chiến, phân tích nguyên nhân gốc rễ (Root Cause Analysis), cách fix lỗi và quy trình chạy batch đăng ký tài khoản GitHub tự động kèm xác thực 2FA.

---

## 1. PHÂN TÍCH NGUYÊN NHÂN GỐC RỄ (TẠI SAO LÀM TAY ĐƯỢC MÀ AUTO LẠI BỊ CHẶN?)

Khi thao tác bằng tay trên cùng một IP/Proxy thì bình thường, nhưng chạy script tự động lại xuất hiện thông báo:
> *"Access is temporarily restricted: Use of developer or inspection tools, automated bot activity (IP ...)"*

### Nguyên nhân 1: Sự kiện giả lập DOM (`isTrusted: false`)
- **Triệu chứng**: Khi script tự động điền các ô input (6 ô số Captcha, Email, Password, Username), nếu dùng JavaScript DOM:
  ```js
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  ```
  DataDome theo dõi mọi event phát sinh trên DOM. Nếu thuộc tính `event.isTrusted === false`, DataDome ngay lập tức phát hiện đây là Bot hoặc Extension can thiệp ngầm -> Kích hoạt **Hard Block**.
- **Giải pháp triệt để**:
  - Loại bỏ hoàn toàn `dispatchEvent`.
  - Sử dụng 100% lệnh bàn phím và chuột cấp thấp của trình duyệt qua Chrome DevTools Protocol (CDP):
    - `page.keyboard.press(digit)` hoặc `page.keyboard.type(text, { delay })`.
    - Di chuyển chuột theo đường cong Bézier tự nhiên (`_humanMouseMove`) và bấm `element.click({ delay })`.

### Nguyên nhân 2: Thao tác can thiệp DOM sửa thuộc tính nút bấm
- **Triệu chứng**: Script gọi `btn.removeAttribute("disabled")` hoặc can thiệp thuộc tính của nút *Verify* / *Create account*.
- **Cơ chế**: DataDome cài đặt `MutationObserver` để giám sát các thay đổi cấu trúc DOM. Việc gỡ bỏ thuộc tính `disabled` bằng script khiến hệ thống phòng vệ đánh dấu bot lập tức.
- **Giải pháp**: Để form tự động kích hoạt trạng thái enable theo phản ứng tự nhiên sau khi người dùng gõ phím thật và dừng lại 1.5s – 2.0s như người thật.

### Nguyên nhân 3: Dính Cookie phiên của tài khoản trước đó (Session Leaks)
- **Triệu chứng**: Tài khoản #1 hoặc #2 tạo xong và đăng nhập vào GitHub, đến tài khoản tiếp theo mở trang chủ `https://github.com/` thì trình duyệt vẫn còn Cookie đăng nhập cũ, khiến nút *Sign up* không xuất hiện hoặc bị chuyển hướng sai.
- **Giải pháp**:
  - Khi bắt đầu lượt đăng ký mới cho mỗi tài khoản, tự động dọn dẹp Cookie qua CDP session:
    ```js
    const cdpSession = await page.target().createCDPSession();
    await cdpSession.send("Network.clearBrowserCookies");
    ```

### Nguyên nhân 4: Cấu hình Profile ShardBrowser (Clone vs Existing Profile)
- Profile chuẩn `32231` đã được cấu hình tối ưu:
  - User-Agent: Mac Intel (`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/152.0.0.0 Safari/537.36`).
  - Noise: Tắt các noise can thiệp canvas/webgl (`noise.*.enabled: false`) để tránh bị nhận diện sai lệch phần cứng.
- Chạy trực tiếp trên profile chuẩn hoặc clone kế thừa cấu hình phần cứng giúp duy trì Trust Score cao nhất.

### Nguyên nhân 5: Điều hướng quá dồn dập & Rê chuột nhân tạo trong vòng lặp Polling
- **Triệu chứng**: Thông báo lỗi chỉ rõ *"Rapid taps or clicks"*.
  - Sau khi bấm nút *Sign up* trên Header, script không chờ trình duyệt chuyển trang tự nhiên mà sau vài giây lại gọi tiếp `page.goto(signupUrl)` chồng lên.
  - Trong vòng lặp chờ tải trang, script gọi `mouse.move()` ngẫu nhiên liên tục mỗi 1.5s làm DataDome phát hiện hành vi chuột máy (Jitter / Micro-movements không có gia tốc tự nhiên).
- **Giải pháp**:
  - Dùng `Promise.all([page.waitForNavigation(), signUpBtn.click()])` để trình duyệt tự tải trang tự nhiên như người dùng bấm link.
  - Loại bỏ hoàn toàn các lệnh `mouse.move` trong vòng lặp chờ (Polling loop).
  - Tăng khoảng thời gian cooldown `--cooldown=120` giữa các tài khoản để IP không bị coi là gửi request quá nhanh.

### Nguyên nhân 6: Nhầm lẫn Form Trang chủ (github.com) với Form Đăng ký (/signup)
- **Triệu chứng**: Kích thước cửa sổ nhỏ làm thanh Header co lại thành nút hamburger (3 gạch) ẩn nút *Sign up*. Script tìm thấy ô email ở giữa trang chủ ("Enter your email") liền nhầm là form đăng ký đã sẵn sàng và cố điền password ngay tại trang chủ.
- **Giải pháp triệt để**:
  - Tự động phóng to cực đại (Maximized) cửa sổ trình duyệt ngay khi khởi chạy qua CDP `Browser.setWindowBounds { windowState: "maximized" }`.
  - Tự động xử lý cả 2 trường hợp: Click nút `Sign up` trên Header hoặc click mở Menu Hamburger nếu kích thước nhỏ.
  - Bắt buộc kiểm tra điều kiện URL: Chỉ khi URL thực sự chứa `/signup` VÀ có ô input form đăng ký thì mới kích hoạt trạng thái sẵn sàng. Nếu chưa ở `/signup`, script sẽ tiếp tục điều hướng mà không bao giờ gõ thông tin nhầm vào trang chủ.

---

## 2. QUY TRÌNH CHẠY BATCH TỰ ĐỘNG

### Cách 1: TẠO PROFILE MỚI HOÀN TOÀN CHO MỖI TÀI KHOẢN (Khuyên dùng - Không dùng 32231)
Khi không truyền cờ `--clone` hay `--profile`, hệ thống tự động:
1. Sinh Profile mới độc lập thuộc nhóm `[GitHub-Auto]` qua ShardX Launcher API.
2. Tắt toàn bộ Noise can thiệp (`audio`, `canvas`, `webgl`, `client_rects`, `fonts`) để giữ fingerprint 100% native tự nhiên như người dùng thật.
3. Dùng IP máy thật (Direct) hoặc Proxy tùy chọn.
4. Cooldown 120s giữa mỗi tài khoản để giữ an toàn tuyệt đối cho IP.

```bash
# Lệnh chạy chuẩn tạo Profile MỚI hoàn toàn:
node Testing/git/batch_hotmail_runner.js --file=Testing/git/hotmail/Hotmail_2.txt --cooldown=120
```

### Cách 2: Chạy với Proxy nhóm ShardBrowser
```bash
node Testing/git/batch_hotmail_runner.js --file=Testing/git/hotmail/Hotmail_2.txt --shard --group=all --cooldown=120
```

---

## 2. QUY TẮC GIẢI AUDIO CAPTCHA (DATADOME SPEECH RECOGNITION)

1. **Không giải Slider kéo ghép hình**: DataDome phân tích gia tốc, độ lệch chuẩn và quán tính rê chuột. Giải Slider bằng auto có tỉ lệ rớt cao.
2. **Ưu tiên 100% Audio Captcha**:
   - Di chuột Bézier Curve và click nút chế độ Âm thanh (Audio Voice).
   - Di chuột bấm nút Play.
   - Bắt gói tin âm thanh trực tiếp từ Chromium Network Response (không dùng `fetch()` trong evaluate).
   - Sử dụng **Deepgram Nova-2** (Speech-to-Text độ trễ cực thấp < 300ms, độ chính xác số học 99.9%).
   - **BẮT BUỘC CHỜ PHÁT HẾT ÂM THANH**: Chờ từ 3.8s - 4.5s để âm thanh đọc hết trên loa trình duyệt trước khi chạm phím (DataDome kiểm tra thời gian giữa lúc ấn Play và lúc nhập số).
   - Click ô đầu tiên và gõ từng số bằng phím thật (`page.keyboard.press`).

---

## 3. CÁC LỆNH CHẠY BATCH CHUẨN XÁC

### 1. Chạy với Profile chuẩn `32231` (Khuyên dùng - Độ tin cậy cao nhất)
```bash
node Testing/git/batch_hotmail_runner.js --file=Testing/git/hotmail/Hotmail_2.txt --profile=32231
```

### 2. Chạy với chế độ Clone từ Profile mẫu `32231`
```bash
node Testing/git/batch_hotmail_runner.js --file=Testing/git/hotmail/Hotmail_2.txt --clone=32231
```

### 3. Tùy chỉnh thời gian nghỉ (Cooldown) giữa các tài khoản (Ví dụ 20s)
```bash
node Testing/git/batch_hotmail_runner.js --file=Testing/git/hotmail/Hotmail_2.txt --profile=32231 --cooldown=20
```

---

## 4. CƠ CHẾ BẢO TOÀN DỮ LIỆU & TỰ ĐỘNG BỎ QUA

- **File lưu kết quả**:
  - [Testing/git/output.txt](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/git/output.txt)
  - [Testing/git/hotmail/github_accounts.txt](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/git/hotmail/github_accounts.txt)
- **Cấu trúc lưu**:
  ```text
  email@hotmail.com|Password|2FA_Secret_Key
  ```
- **Tự động khôi phục (Resume)**:
  - Khi chạy lại lệnh, hệ thống tự động quét file `github_accounts.txt`.
  - Bất kỳ tài khoản nào đã đăng ký thành công trước đó sẽ tự động hiển thị:
    `⏭️ [BỎ QUA #X] Email [...] đã được đăng ký thành công trước đó!`
  - Script sẽ bắt đầu ngay từ tài khoản chưa đăng ký kế tiếp, tuyệt đối không tạo lại gây trùng lặp.
