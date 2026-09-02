# 📘 ShardBrowser Developer & AI Automation Master Guide

Chào mừng đến với bộ tài liệu kỹ thuật toàn diện về **ShardBrowser** dành cho AI Agents và Developers. Thư mục này cung cấp đầy đủ thông số kỹ thuật, cấu trúc API, mã mẫu JavaScript/Node.js, và các best practice để lập trình tự động hóa trình duyệt chống phát hiện (Anti-detect Sandbox).

---

## 📑 Mục Lục Tài Liệu

| File | Nội Dung Chi Tiết |
| :--- | :--- |
| **[01_ARCHITECTURE_AND_API.md](./01_ARCHITECTURE_AND_API.md)** | Kiến trúc ShardBrowser, Launcher HTTP REST API, cơ chế tạo JWT Bearer Token, và danh sách toàn bộ Endpoint. |
| **[02_PROFILE_AND_FINGERPRINT.md](./02_PROFILE_AND_FINGERPRINT.md)** | Cơ chế khởi tạo Profile, sinh Fingerprint độc bản (Canvas, WebGL, Audio Noise), phân nhóm (Folder / Group) và dọn dẹp rác. |
| **[03_PROXY_INTEGRATION.md](./03_PROXY_INTEGRATION.md)** | Quản lý Proxy nội bộ, cấu hình SOCKS5/HTTP kèm Auth, tích hợp Proxy xoay (Rotating API) và cơ chế Check & Clean proxy die. |
| **[04_CDP_AND_PUPPETEER_AUTOMATION.md](./04_CDP_AND_PUPPETEER_AUTOMATION.md)** | Hướng dẫn kết nối Puppeteer-core qua WebSocket CDP, giả lập hành vi người thật (Human-like), giải mã 2FA TOTP offline 0ms. |
| **[05_MULTI_TASK_AND_BATCH_PATTERNS.md](./05_MULTI_TASK_AND_BATCH_PATTERNS.md)** | Mẫu thiết kế chạy hàng loạt (Batch Runner), chạy song song đa tác vụ (Multi-profile concurrency) độc lập không xung đột CDP. |

---

## ⚡ Quickstart: Khởi Tạo Trình Duyệt & Kết Nối CDP Trong 10 Dòng Code

```javascript
import axios from "axios";
import puppeteer from "puppeteer-core";
import { getShardAuthHeader, getLauncherUrl } from "./shard_helper.js";

// 1. Lấy URL API và Token xác thực
const apiUrl = getLauncherUrl(); // http://127.0.0.1:40325
const headers = getShardAuthHeader();

// 2. Lấy Fingerprint Windows mới & Tạo Profile thuộc nhóm 'Auto-Bot'
const { data: fp } = await axios.get(`${apiUrl}/fingerprint/new/windows`, { headers });
const { data: profile } = await axios.post(`${apiUrl}/profiles`, {
  name: `BOT-${Date.now().toString().slice(-4)}`,
  folder: "Auto-Bot",
  fingerprint: fp.fingerprint,
  proxy: "http://user:pass@host:port" // hoặc null nếu dùng IP direct
}, { headers });

// 3. Khởi chạy trình duyệt và kết nối Puppeteer qua CDP
const { data: startRes } = await axios.post(`${apiUrl}/profiles/${profile.id}/start`, { headless: false }, { headers });
const browser = await puppeteer.connect({
  browserWSEndpoint: startRes.cdp.web_socket_debugger_url,
  defaultViewport: null
});

// 4. Bắt đầu tự động hóa
const page = (await browser.pages())[0] || await browser.newPage();
await page.goto("https://google.com");
```

---

## 🎯 Nguyên Tắc Vàng Khi Viết Automation Cho ShardBrowser

1. **Luôn gán `folder` khi tạo profile**: Ví dụ `folder: "GitHub-Auto"`, `folder: "Veo3"`. Việc này giúp phân vùng tài nguyên, dọn dẹp sạch sẽ và tránh ảnh hưởng tới profile người dùng thật.
2. **Luôn dọn dẹp sau khi hoàn thành (`_cleanup`)**: Gọi `POST /profiles/:id/stop` rồi `DELETE /profiles/:id` để tránh tràn dung lượng ổ cứng (User Data Dir).
3. **Mô phỏng hành vi người thật (Human-like Typing & Movement)**: Tuyệt đối không dùng `page.evaluate(() => input.value = '...')` làm phương thức chính. Sử dụng gõ phím tuần tự có jitter (`40ms - 80ms`) và dispatch đủ các sự kiện `input`, `change`, `blur`.
4. **Offline TOTP 2FA**: Sử dụng trực tiếp thuật toán HMAC-SHA1 RFC 6238 qua `node:crypto` để sinh mã 6 số ngay trên bộ nhớ (0ms), không gọi API ngoài hay mở tab mới.
