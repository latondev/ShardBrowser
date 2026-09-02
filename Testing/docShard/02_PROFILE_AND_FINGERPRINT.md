# 🛡️ Profile & Anti-Detect Fingerprint Isolation Guide

Tài liệu này hướng dẫn chi tiết quy trình quản lý Profile, cấu hình Fingerprint chống phát hiện (Anti-detect) và chiến lược cách ly tài nguyên trong ShardBrowser.

---

## 1. Cơ Chế Chống Phát Hiện (Anti-Detect Engine)

ShardBrowser can thiệp vào tầng lõi Chromium để thay đổi các thông số nhận dạng phần cứng mà không làm gãy vỡ các chuẩn API Web:

1. **Canvas Noise Injection**: Thêm nhiễu ngẫu nhiên tinh vi vào `CanvasRenderingContext2D.getImageData()` và `toDataURL()`, đảm bảo giá trị hash Canvas đổi mới hoàn toàn trên mỗi profile nhưng mắt người không thể nhận ra sự khác biệt.
2. **WebGL Vendor & Renderer**: Giả lập thông số card đồ họa (GPU) chuẩn xác theo OS (ví dụ: NVIDIA GeForce RTX 3060 Direct3D11 trên Windows, Apple M2 Metal trên macOS).
3. **AudioContext Noise**: Thêm nhiễu vào đồ thị sóng âm AudioBuffer để vô hiệu hóa Audio Fingerprint.
4. **WebRTC Spoofing & UDP Handling**: Bảo vệ IP gốc khỏi rò rỉ WebRTC (`mDNS` / `Public IP candidate isolation`).
5. **Client Hints & User-Agent**: Đồng bộ phiên bản Chrome, Sec-CH-UA, Platform và Architecture.

---

## 2. Chiến Lược Phân Nhóm Profile (Folder / Group Strategy)

Khi chạy các kịch bản tự động hóa hoặc bot đa luồng, **BẮT BUỘC** phải đặt tên nhóm (`folder`) riêng biệt cho từng loại tác vụ:

- Ví dụ:
  - Bot đăng ký GitHub: `folder: "GitHub-Auto"`
  - Bot tạo video Google Flow: `folder: "Veo3"`
  - Bot cào dữ liệu: `folder: "Scraper-Task"`

### Lợi ích:
- **Không xung đột**: Các profile thuộc các nhóm khác nhau chạy trên các cổng CDP độc lập.
- **Dọn dẹp an toàn**: Script dọn dẹp có thể xóa sạch toàn bộ profile của nhóm bot mà **không làm mất** các profile quan trọng của người dùng ở nhóm `All` hay các nhóm khác.

---

## 3. Mẫu Code Tạo Profile & Dọn Dẹp An Toàn (Clean Pattern)

Dưới đây là module hoàn chỉnh chuẩn mực để khởi tạo và dọn dẹp profile trong Node.js:

```javascript
import axios from "axios";
import { loadShardLauncherConfig } from "./01_ARCHITECTURE_AND_API.md";

export class ProfileManager {
  constructor(groupName = "Bot-Auto") {
    const config = loadShardLauncherConfig();
    this.apiUrl = config.url;
    this.headers = config.headers;
    this.groupName = groupName;
    this.currentProfileId = null;
  }

  // 1. Dọn dẹp tất cả profile cũ thuộc nhóm này trước khi chạy phiên mới
  async cleanOldProfiles() {
    try {
      const { data: profiles } = await axios.get(`${this.apiUrl}/profiles`, { headers: this.headers });
      if (Array.isArray(profiles)) {
        const targetProfiles = profiles.filter(p => p.folder === this.groupName || p.name?.startsWith(`SHARDX-${this.groupName}-`));
        for (const prof of targetProfiles) {
          try {
            await axios.post(`${this.apiUrl}/profiles/${prof.id}/stop`, {}, { headers: this.headers });
            await axios.delete(`${this.apiUrl}/profiles/${prof.id}`, { headers: this.headers });
          } catch {}
        }
        console.log(`🧹 Đã dọn dẹp ${targetProfiles.length} profiles cũ thuộc nhóm [${this.groupName}].`);
      }
    } catch (err) {
      console.warn(`Lỗi khi dọn dẹp profile cũ: ${err.message}`);
    }
  }

  // 2. Tạo một profile độc bản mới
  async createIsolatedProfile(proxyString = null) {
    // Lấy Fingerprint Windows mới
    const { data: fpRes } = await axios.get(`${this.apiUrl}/fingerprint/new/windows`, { headers: this.headers });

    const sessionSuffix = Date.now().toString().slice(-4);
    const payload = {
      name: `SHARDX-${this.groupName}-${sessionSuffix}`,
      folder: this.groupName,
      notes: `Tự động tạo | Time: ${new Date().toLocaleTimeString()}`,
      proxy: proxyString || null,
      fingerprint: fpRes.fingerprint,
    };

    const { data: profile } = await axios.post(`${this.apiUrl}/profiles`, payload, { headers: this.headers });
    this.currentProfileId = profile.id;
    console.log(`✨ Tạo Profile thành công: ID [${profile.id}] - Tên [${payload.name}]`);
    return profile;
  }

  // 3. Khởi chạy profile và lấy CDP WebSocket URL
  async launchProfile(headless = false) {
    if (!this.currentProfileId) throw new Error("Chưa khởi tạo profile!");
    const { data: startRes } = await axios.post(
      `${this.apiUrl}/profiles/${this.currentProfileId}/start`,
      { headless },
      { headers: this.headers }
    );
    return startRes.cdp.web_socket_debugger_url;
  }

  // 4. Dừng và xóa Profile hiện tại sau khi chạy xong
  async destroyCurrentProfile() {
    if (!this.currentProfileId) return;
    try {
      await axios.post(`${this.apiUrl}/profiles/${this.currentProfileId}/stop`, {}, { headers: this.headers }).catch(() => {});
      await axios.delete(`${this.apiUrl}/profiles/${this.currentProfileId}`, { headers: this.headers }).catch(() => {});
      console.log(`🗑️ Đã giải phóng Profile ID [${this.currentProfileId}].`);
      this.currentProfileId = null;
    } catch (err) {
      console.warn(`Lỗi khi xóa profile: ${err.message}`);
    }
  }
}
```

---

## 4. Xử Lý Tín Hiệu Thoát Đột Ngột (Graceful Shutdown)

Khi người dùng nhấn `Ctrl + C` (SIGINT) hoặc script bị terminate, luôn bắt sự kiện để dọn dẹp profile tránh để lại các tiến trình mồ côi (zombie Chromium):

```javascript
const profileMgr = new ProfileManager("GitHub-Auto");

process.on("SIGINT", async () => {
  console.log("\n⚠️ Phát hiện tín hiệu dừng (Ctrl+C), đang dọn dẹp Profile...");
  await profileMgr.destroyCurrentProfile();
  process.exit(0);
});
```
