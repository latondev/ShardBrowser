# 🛡️ Hướng Dẫn Kỹ Thuật Chống Phát Hiện & Vượt Bộ Lọc Bot Trên GitHub (Anti-Detect & Stealth Guide)

Tài liệu này tổng hợp toàn bộ nguyên lý hoạt động, các kỹ thuật ẩn danh (**Anti-detect Stealth Toàn Diện**) và quy trình quản lý mạng Proxy nhằm giúp bộ công cụ tự động hóa chạy trơn tru, tránh bị GitHub kích hoạt cảnh báo **"Truy cập tạm thời bị hạn chế"** (Rate-limit) hoặc bị chặn bởi hệ thống bảo vệ bot (Arkose Labs / Octocaptcha / Cloudflare WAF / FingerprintJS).

---

## 📑 Mục Lục
1. [Cơ chế phát hiện tự động hóa của GitHub](#1-cơ-chế-phát-hiện-tự-động-hóa-của-github)
2. [Chi tiết toàn bộ bộ kỹ thuật Stealth Evasions trong `ai_agent_runner.js`](#2-chi-tiết-toàn-bộ-bộ-kỹ-thuật-stealth-evasions-trong-ai_agent_runnerjs)
3. [Cờ khởi chạy trình duyệt chống Automation & rò rỉ WebRTC](#3-cờ-khởi-chạy-trình-duyệt-chống-automation--rò-rỉ-webrtc)
4. [Quản lý Proxy & Chiến lược ngăn chặn Rate-Limit IP](#4-quản-lý-proxy--chiến-lược-ngăn-chặn-rate-limit-ip)
5. [Giả lập hành vi người dùng thật (Human-like Interactions)](#5-giả-lập-hành-vi-người-dùng-thật-human-like-interactions)
6. [Cẩm nang xử lý sự cố (Troubleshooting)](#6-cẩm-nang-xử-lý-sự-cố-troubleshooting)

---

## 1. Cơ Chế Phát Hiện Tự Động Hóa Của GitHub

Hệ thống bảo vệ của GitHub đánh giá độ tin cậy của mỗi lượt đăng ký thông qua 4 lớp kiểm tra độc lập:

```
[Người Dùng / Bot] 
   │
   ├── 1. IP & Network Reputation  ──► Kiểm tra tần suất đăng ký / dải IP DataCenter / Blacklist
   ├── 2. CDP & Automation Flags   ──► Quét cờ navigator.webdriver, biến nội bộ CDP (cdc_...)
   ├── 3. Device & Canvas Fingerprint ─► Kiểm tra WebGL1/2, MimeTypes, Plugins, AudioContext, RAM/CPU
   └── 4. Behavioral Biometrics    ──► Phân tích tốc độ gõ phím, quỹ đạo di chuột, click
```

| Lớp Kiểm Tra | Biểu Hiện Bị Phát Hiện | Nguyên Nhân & Cách Khắc Phục |
| :--- | :--- | :--- |
| **IP Rate-Limit** | *"Truy cập tạm thời bị hạn chế"* / *"Access is temporarily restricted"* | Dùng cùng 1 IP mạng nhà tạo nhiều nick ➔ Đổi sang **Proxy Shard / Proxy Xoay**. |
| **Automation Detection** | *"Tiện ích tự động hóa hoặc chặn JavaScript"* / *"Unable to verify captcha"* | Lộ cờ `navigator.webdriver = true` hoặc biến `cdc_...` ➔ Đã được ẩn tự động. |
| **Fingerprint Anomaly** | Treo ở bước Submit / Captcha lặp vô tận | Dùng WebGL render giả (SwiftShader) hoặc thiếu mimeTypes ➔ Đã mock GPU NVIDIA + MimeTypes. |
| **Bot Biometrics** | Form bị từ chối hoặc yêu cầu xác minh nâng cao | Điền form bằng `element.value = ...` tức thì ➔ Dùng `_humanType` độ trễ 40-80ms. |

---

## 2. Chi Tiết Toàn Bộ Bộ Kỹ Thuật Stealth Evasions Trong `ai_agent_runner.js`

Trong [ai_agent_runner.js](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/git/ai_agent_runner.js), phương thức `_injectStealthEvasions(page)` được tiêm tự động thông qua `page.evaluateOnNewDocument()` vào tất cả các tab trước khi nội dung trang GitHub được tải:

### 2.1. Ẩn triệt để `navigator.webdriver` & Xoá dấu vết biến CDP (`cdc_...`)
Mặc định Puppeteer/CDP sẽ bật `navigator.webdriver = true` và chèn các biến đặc trưng `window.cdc_...` vào DOM. Hệ thống tự động ghi đè getter và xoá sạch các biến này:
```javascript
// Ẩn navigator.webdriver
Object.defineProperty(navigator, 'webdriver', {
  get: () => undefined,
});

// Xoá dấu vết biến nội bộ ChromeDriver/Puppeteer
delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
```

---

### 2.2. Giả lập đầy đủ hệ sinh thái `window.chrome`
Trình duyệt Google Chrome chính thức luôn sở hữu các đối tượng `runtime`, `app`, `csi`, `loadTimes`. Khi chạy dưới dạng tự động hóa, các thuộc tính này thường bị thiếu hụt:
```javascript
if (!window.chrome) window.chrome = {};

// Giả lập chrome.runtime
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    PlatformOs: { WIN: 'win', MAC: 'mac', LINUX: 'linux', ANDROID: 'android', CROS: 'cros', OPENBSD: 'openbsd' },
    PlatformArch: { X86_64: 'x86-64', X86_32: 'x86-32', ARM: 'arm' },
    connect: function () {},
    sendMessage: function () {},
  };
}

// Giả lập chrome.app
if (!window.chrome.app) {
  window.chrome.app = {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
  };
}

// Giả lập chrome.csi & chrome.loadTimes
if (!window.chrome.csi) window.chrome.csi = function () {};
if (!window.chrome.loadTimes) {
  window.chrome.loadTimes = function () {
    return {
      requestTime: Date.now() / 1000,
      startLoadTime: Date.now() / 1000,
      commitLoadTime: Date.now() / 1000,
      finishDocumentLoadTime: Date.now() / 1000,
      finishLoadTime: Date.now() / 1000,
      firstPaintTime: Date.now() / 1000,
      navigationType: 'Other',
      wasFetchedViaSpdy: true,
      protocol: 'h2',
      connectionInfo: 'h2',
    };
  };
}
```

---

### 2.3. Giả lập đồng bộ cặp đôi `navigator.plugins` và `navigator.mimeTypes`
Nhiều hệ thống anti-bot phát hiện sự bất đối xứng khi trang có plugins nhưng danh sách `mimeTypes` rỗng:
```javascript
// 1. Plugins
const pluginsList = [
  { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
];
Object.defineProperty(navigator, 'plugins', { get: () => pluginsList });

// 2. MimeTypes
const mimeTypesList = [
  { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
  { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
];
Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypesList });
```

---

### 2.4. Giả lập thông số phần cứng chuẩn Desktop (`Hardware Concurrency & RAM`)
Ngăn chặn FingerprintJS phát hiện môi trường máy ảo hoặc VPS cấu hình bất thường (CPU 1 core, 0 RAM):
```javascript
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); // CPU 8 Luồng
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });          // 8 GB RAM
Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });        // Chuẩn Desktop không cảm ứng
```

---

### 2.5. Chuẩn hoá Ngôn Ngữ & Permissions API
```javascript
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
Object.defineProperty(navigator, 'language', { get: () => 'en-US' });

// Mock Permissions API chuẩn Chrome
const originalQuery = window.navigator.permissions?.query;
if (originalQuery) {
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission || 'default' })
      : originalQuery(parameters);
}
```

---

### 2.6. Spoofing Toàn Diện Cả `WebGLRenderingContext` và `WebGL2RenderingContext`
Ngăn chặn GitHub nhận diện GPU ảo hóa (SwiftShader / Google Mesa / VMware SVGA):
```javascript
const spoofParam = (ctxProto) => {
  if (!ctxProto) return;
  const getParam = ctxProto.getParameter;
  ctxProto.getParameter = function (parameter) {
    // UNMASKED_VENDOR_WEBGL (37445)
    if (parameter === 37445) return 'Google Inc. (NVIDIA)';
    // UNMASKED_RENDERER_WEBGL (37446)
    if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
    return getParam.apply(this, arguments);
  };
};

if (typeof WebGLRenderingContext !== 'undefined') spoofParam(WebGLRenderingContext.prototype);
if (typeof WebGL2RenderingContext !== 'undefined') spoofParam(WebGL2RenderingContext.prototype);
```

---

### 2.7. Sửa lỗi kích thước cửa sổ (`outerWidth` & `outerHeight`)
Trong CDP headless hoặc môi trường nhúng, `outerWidth` và `outerHeight` có thể bị gán bằng `0`. Đoạn mã tự động bù kích thước khung viền trình duyệt:
```javascript
if (window.outerWidth === 0 || window.outerHeight === 0) {
  window.outerWidth = window.innerWidth + 16;
  window.outerHeight = window.innerHeight + 88;
}
```

---

### 2.8. Giả lập thông tin kết nối mạng (`navigator.connection`)
```javascript
if (!navigator.connection) {
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      effectiveType: '4g',
      rtt: 50,
      downlink: 10,
      saveData: false,
    }),
  });
}
```

---

## 3. Cờ Khởi Chạy Trình Duyệt Chống Automation & Rò Rỉ WebRTC

Khi khởi chạy trình duyệt Chromium độc lập, hệ thống truyền các tham số cốt lõi sau:

```javascript
const chromeArgs = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
  "--window-size=1280,800",
  "--disable-blink-features=AutomationControlled", // Ẩn cờ tự động hóa cấp nhân Chromium
  "--disable-infobars",                           // Tắt thanh thông báo Chrome is being controlled
  "--lang=en-US,en",                              // Chuẩn hoá ngôn ngữ giao diện
  "--enforce-webrtc-ip-permission-check"          // Ngăn chặn rò rỉ IP thật qua giao thức WebRTC
];
```

---

## 4. Quản Lý Proxy & Chiến Lược Ngăn Chặn Rate-Limit IP

### ⚠️ Tại sao không nên dùng Direct IP mạng nhà (`14.232.221.100`)?
- Một IP dân cư chỉ nên tạo **1 tài khoản GitHub mỗi 24 giờ**.
- Nếu tạo liên tiếp từ 2-3 tài khoản trên cùng 1 IP, GitHub sẽ đưa IP đó vào danh sách **Hạn chế tạm thời** trong 15-60 phút.

### 🌐 Các chế độ mạng được hỗ trợ:

#### 1. Chế độ Proxy Pool ShardBrowser (Khuyên Dùng Nhất)
Tool tự động quét và kiểm tra ping các Proxy có sẵn trong [Testing/git/proxies.txt](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/git/proxies.txt) hoặc [Testing/proxify/us_proxies.txt](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/proxify/us_proxies.txt):
```bash
node Testing/git/batch_hotmail_runner.js --shard --cooldown=30
```

#### 2. Chế độ Proxy Xoay Dân Cư (`proxyxoay.shop`)
Tự động gọi API xoay IP mới trước mỗi phiên đăng ký:
```bash
node Testing/git/batch_hotmail_runner.js --rotate --cooldown=30
```

#### 3. Định dạng Proxy trong file `proxies.txt`
Bạn có thể dán danh sách proxy mua bên ngoài vào file [proxies.txt](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/git/proxies.txt) theo các định dạng:
```text
# 1. IP:PORT
103.145.2.10:8080

# 2. IP:PORT:USER:PASS
103.145.2.10:8080:username:password

# 3. PROTOCOL://USER:PASS@IP:PORT
http://username:password@103.145.2.10:8080
socks5://username:password@103.145.2.10:1080
```

---

## 5. Giả Lập Hành Vi Người Dùng Thật (Human-Like Interactions)

Để vượt qua hệ thống phân tích hành vi của GitHub, tool áp dụng các nguyên tắc:

1. **Luồng Điều Hướng Tự Nhiên (Human Navigation Flow)**:
   - Thay vì nhảy thẳng vào `/signup` (dễ bị nghi ngờ là bot tự động), tool mô phỏng hành vi duyệt web tự nhiên:
     ```
     [Trang Chủ GitHub: https://github.com/]
              │
              ▼ (Cuộn trang + Click nút 'Sign in' trên thanh Header)
     [Trang Đăng Nhập: https://github.com/login]
              │
              ▼ (Chờ 1.5s + Click link 'Create an account' ở chân form)
     [Trang Đăng Ký: https://github.com/signup?source=login]
     ```
   - Đi kèm cơ chế fallback tự động nếu DOM thay đổi.

2. **Gõ phím mô phỏng cơ học (`_humanType`)**:
   - Không dùng `element.value = text`.
   - Sử dụng `page.keyboard.type()` với độ trễ ngẫu nhiên **40ms - 80ms** giữa từng ký tự.
   - Thêm thời gian dừng 1.5s giữa các ô (Email -> Password -> Username) để GitHub hoàn tất kiểm tra tính hợp lệ.

3. **Di chuyển chuột mượt mà (`mouse.move`)**:
   - Di chuyển chuột theo đường cong với `steps: 5` để tạo biến thiên tọa độ tự nhiên.

4. **Thời gian Cooldown an toàn giữa các tài khoản**:
   - **Có Proxy xoay / Proxy khác nhau**: Nghỉ **15s - 30s** giữa mỗi tài khoản.
   - **Chạy cùng 1 IP (Direct)**: Cần nghỉ tối thiểu **60s - 120s** (tuy nhiên vẫn khuyến nghị dùng Proxy).

---

## 6. Cẩm Nang Xử Lý Sự Cố (Troubleshooting)

| Lỗi Gặp Phải | Nguyên Nhân | Cách Xử Lý Nhanh |
| :--- | :--- | :--- |
| `GITHUB_RATE_LIMITED` | IP hiện tại bị GitHub hạn chế vì truy cập/đăng ký quá nhanh | Dùng lệnh `start.bat` chọn **Phím 1** (Proxy Shard) hoặc **Phím 2** (Proxy xoay). |
| `EMAIL_ALREADY_EXISTS` | Địa chỉ email đã được đăng ký trước đó | Tool sẽ tự động bỏ qua và chuyển sang tài khoản kế tiếp. |
| `RAPIDAPI_QUOTA_EXHAUSTED` | Hết quota tạo Gmail miễn phí trong giờ hiện tại | Tool tự động kích hoạt chế độ ngủ 1 giờ chờ reset quota, hoặc bổ sung API key mới vào `rapidapikey.md`. |
| Trình duyệt bị kẹt ở Captcha | Proxy bị chấm điểm TrustScore thấp | Thay đổi danh sách Proxy sạch hơn (ưu tiên Proxy dân cư US/EU). |
