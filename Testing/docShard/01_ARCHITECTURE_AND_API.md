# 🌐 ShardBrowser Architecture & REST API Reference

Tài liệu này giải thích chi tiết kiến trúc tầng mạng và toàn bộ đặc tả HTTP REST API của **ShardBrowser Automation Server**.

---

## 1. Kiến Trúc Hệ Thống (System Architecture)

ShardBrowser gồm 3 tầng chính:

```text
┌────────────────────────────────────────────────────────┐
│               Frontend (React / Vite)                  │
└──────────────────────────┬─────────────────────────────┘
                           │ (Tauri IPC Commands)
┌──────────────────────────▼─────────────────────────────┐
│             Backend (Rust + Tauri + Axum)              │
│  - REST API Server (Binds 127.0.0.1:40325, JWT Auth)   │
│  - Chromium Process Spawner (CDP Pipe/Port Allocation) │
│  - Fingerprint & Memory Patching Engine                │
└──────────────────────────┬─────────────────────────────┘
                           │ (CDP WebSocket)
┌──────────────────────────▼─────────────────────────────┐
│       Isolated Chromium Instance (Sandbox Profile)     │
└────────────────────────────────────────────────────────┘
```

- **Axum Local HTTP API**: Chạy nền trên `127.0.0.1` tại cổng mặc định `40325` (hoặc cấu hình trong settings).
- **Xác thực**: Sử dụng chuẩn JWT Bearer Token được ký bằng thuật toán `HS256` với `api_secret` trong file cấu hình.

---

## 2. Vị Trí Lưu Trữ Cấu Hình (Settings Location)

File `settings.json` được tự động tạo và lưu trữ tại:
- **Windows**: `%APPDATA%\shardx-launcher\settings.json` hoặc `C:\Users\<User>\AppData\Roaming\shardx-launcher\settings.json`
- **Linux / macOS**: `~/.config/shardx-launcher/settings.json`

Cấu trúc file `settings.json`:
```json
{
  "api_enabled": true,
  "api_port": 40325,
  "api_secret": "shardx_secret_string_here...",
  "browser_path": null,
  "theme": "dark"
}
```

---

## 3. Cơ Chế Tự Động Ký JWT Token Trong Code

Không cần hardcode token, bạn có thể tự sinh JWT Token hợp lệ khi khởi động script:

### NodeJS / JavaScript:
```javascript
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function loadShardLauncherConfig() {
  const homeDir = os.homedir();
  const candidateSettings = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "settings.json") : null,
    path.join(homeDir, ".config", "shardx-launcher", "settings.json"),
    path.join(homeDir, "AppData", "Roaming", "shardx-launcher", "settings.json")
  ].filter(Boolean);

  for (const p of candidateSettings) {
    if (fs.existsSync(p)) {
      try {
        const settings = JSON.parse(fs.readFileSync(p, "utf-8"));
        const port = settings.api_port || 40325;
        const secret = settings.api_secret || "";
        let token = "";
        if (secret) {
          const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "HS256" })).toString("base64url");
          const now = Math.floor(Date.now() / 1000);
          const payload = Buffer.from(JSON.stringify({ sub: "shardx-api", iat: now, exp: now + 86400 * 30 })).toString("base64url");
          const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest().toString("base64url");
          token = `${header}.${payload}.${sig}`;
        }
        return { url: `http://127.0.0.1:${port}`, token, headers: { Authorization: `Bearer ${token}` } };
      } catch {}
    }
  }
  return { url: "http://127.0.0.1:40325", token: "", headers: {} };
}
```

---

## 4. Danh Sách REST API Endpoints

Tất cả các endpoint dưới đây đều yêu cầu header:
`Authorization: Bearer <JWT_TOKEN>`

### 4.1. Fingerprint API

#### `GET /fingerprint/new/:os`
Sinh cấu hình fingerprint mới ngẫu nhiên và đồng nhất.
- **Tham số `:os`**: `windows`, `macos`, hoặc `linux`.
- **Response**:
```json
{
  "fingerprint": {
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
    "screen": { "width": 1920, "height": 1080, "color_depth": 24 },
    "webgl": { "vendor": "Google Inc. (NVIDIA)", "renderer": "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)..." },
    "canvas_noise": true,
    "audio_noise": true,
    "languages": ["en-US", "en"]
  }
}
```

---

### 4.2. Profile Management API

#### `GET /profiles`
Lấy danh sách tất cả các profile hiện có.
- **Response**: Mảng các đối tượng profile (`id`, `name`, `folder`, `proxy_id`, `running`,...).

#### `POST /profiles`
Tạo một Profile mới.
- **Request Body**:
```json
{
  "name": "SHARDX-AUTO-1001",
  "folder": "GitHub-Auto",
  "notes": "Profile tự động tạo cho bot",
  "proxy": "http://user:pass@123.45.67.89:8080",
  "proxy_id": null,
  "fingerprint": { ... }
}
```
- **Response**: Trả về `ProfileMeta` kèm trường `id` vừa tạo.

#### `GET /profiles/:id`
Lấy thông tin chi tiết của profile theo ID.

#### `DELETE /profiles/:id`
Xóa vĩnh viễn một profile và toàn bộ User Data Directory tương ứng.

---

### 4.3. Profile Lifecycle & CDP Launch API

#### `POST /profiles/:id/start`
Khởi chạy phiên trình duyệt của profile và cấp phát cổng CDP.
- **Request Body**:
```json
{
  "headless": false
}
```
- **Response**:
```json
{
  "status": "running",
  "pid": 14280,
  "cdp": {
    "port": 58312,
    "web_socket_debugger_url": "ws://127.0.0.1:58312/devtools/browser/78d91a67-...",
    "http_url": "http://127.0.0.1:58312"
  }
}
```

> [!IMPORTANT]
> Giá trị `web_socket_debugger_url` được dùng trực tiếp cho `puppeteer.connect({ browserWSEndpoint })`.

#### `POST /profiles/:id/stop`
Đóng phiên trình duyệt đang chạy của profile.

---

### 4.4. Proxy Management API

#### `GET /proxies`
Lấy danh sách proxy được cấu hình trong ShardBrowser.

#### `POST /proxies`
Thêm mới một proxy vào hệ thống.
- **Request Body**:
```json
{
  "name": "VN Residential Viettel",
  "kind": "socks5",
  "host": "103.237.102.191",
  "port": 1080,
  "username": "user",
  "password": "pwd",
  "country": "VN",
  "folder": "VN-Free"
}
```

#### `DELETE /proxies/:id`
Xóa một proxy theo ID.
