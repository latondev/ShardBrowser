# 🌐 Proxy Management, Rotating IPs & Check & Clean

Tài liệu này hướng dẫn chi tiết về cấu hình Proxy, quản lý nhóm Proxy trong ShardBrowser, tích hợp mạng Proxy xoay (Rotating IPs) và cơ chế tự động lọc/xóa proxy die (Check & Clean).

---

## 1. Định Dạng Proxy Được Hỗ Trợ

ShardBrowser hỗ trợ đầy đủ các giao thức proxy thông dụng:
- **HTTP**: `http://host:port` hoặc `http://username:password@host:port`
- **HTTPS**: `https://host:port` hoặc `https://username:password@host:port`
- **SOCKS5**: `socks5://host:port` hoặc `socks5://username:password@host:port`

### Định dạng ghi chú khi Import hàng loạt:
```text
socks5://user:pass@103.237.102.191:1080 # country=VN folder=VN-Elite
http://194.87.35.27:8080               # country=RU folder=Testing
host:port:user:pass                    # country=US folder=US-Res
```

---

## 2. Quản Lý Nhóm Proxy (Proxy Groups / Folders)

Proxy trong ShardBrowser được phân nhóm (`folder`) tương tự như Profiles:
- **Tab `All`**: Hiển thị toàn bộ proxy.
- **Tab Nhóm (ví dụ: `VN-Free`, `US-Elite`)**: Lọc nhanh danh sách proxy theo nhóm mục đích.
- **Thao tác nhanh**:
  - Chuột phải vào tab nhóm để: **Check & clean dead…**, **Rename group…**, **Delete group…**.
  - Chọn nhiều proxy (Bulk Selection) để **Move to group…** hoặc **Remove from group**.

---

## 3. Tự Động Xác Thực Proxy Trong Puppeteer (`page.authenticate`)

Khi kết nối qua CDP vào phiên trình duyệt có cấu hình Proxy xác thực (Username / Password), bạn cần thiết lập `page.authenticate` để tránh bị popup Basic Auth chặn:

```javascript
export async function setupPageProxyAuth(page, proxyConfig) {
  if (!page || !proxyConfig) return;

  if (proxyConfig.username && proxyConfig.password) {
    await page.authenticate({
      username: proxyConfig.username,
      password: proxyConfig.password,
    });
    console.log(`🔐 Đã nạp xác thực Proxy: ${proxyConfig.username}@${proxyConfig.host}`);
  }
}
```

---

## 4. Tích Hợp Proxy Xoay Dân Cư (Rotating Proxy Client)

Dưới đây là mẫu Client xoay IP tự động qua API (ví dụ: `proxyxoay.shop` hoặc các nhà cung cấp Proxy xoay khác):

```javascript
import axios from "axios";

export class RotatingProxyClient {
  constructor(apiKey) {
    this.apiKey = apiKey || "YOUR_ROTATING_API_KEY";
    this.apiUrl = "https://proxyxoay.shop/api/get.php";
    this.lastProxy = null;
  }

  async getFreshProxy(protocol = "http") {
    const url = `${this.apiUrl}?key=${this.apiKey}&nhamang=random&tinhthanh=0&whitelist=`;
    
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const { data } = await axios.get(url, { timeout: 15000 });

        // Status 100: Cấp IP mới thành công
        if (data.status === 100) {
          const raw = data.proxyhttp || data.proxysocks5;
          const [host, port, user, pass] = raw.trim().split(":");
          const auth = (user && pass) ? `${user}:${pass}@` : "";
          
          this.lastProxy = {
            proxyString: `${protocol}://${auth}${host}:${port}`,
            host,
            port: Number(port),
            username: user || "",
            password: pass || "",
            ip: data.ip || host,
            isp: data["Network Provider"] || "Residential",
          };
          console.log(`✅ [Proxy Xoay] Cấp IP mới: ${this.lastProxy.ip} (${this.lastProxy.isp})`);
          return this.lastProxy;
        }

        // Status 101: Đang chờ cooldown đổi IP
        if (data.status === 101) {
          console.log(`⏳ Đang chờ cooldown đổi IP (${data.message}), tái sử dụng IP gần nhất...`);
          if (this.lastProxy) return this.lastProxy;
          await new Promise((r) => setTimeout(r, 10000));
        }
      } catch (err) {
        console.warn(`Lỗi lấy proxy xoay (lần ${attempt}): ${err.message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    throw new Error("Không thể lấy proxy xoay sau 5 lần thử!");
  }
}
```

---

## 5. Cơ Chế Check & Clean (Tự Động Quét & Xóa Proxy Die)

Quy trình tự động kiểm tra hàng loạt và loại bỏ proxy lỗi:

```javascript
import axios from "axios";

export async function checkAndCleanProxyList(launcherApiUrl, headers, folderName = "all") {
  // 1. Lấy danh sách proxy
  const { data: proxies } = await axios.get(`${launcherApiUrl}/proxies`, { headers });
  const targets = folderName === "all"
    ? proxies
    : proxies.filter(p => (p.folder || "").toLowerCase() === folderName.toLowerCase());

  console.log(`🔍 Bắt đầu kiểm tra ${targets.length} proxies...`);

  const CONCURRENCY = 6;
  let cursor = 0;
  let deadCount = 0;
  let activeCount = 0;

  // 2. Chạy test song song có kiểm soát luồng
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (cursor < targets.length) {
        const p = targets[cursor++];
        if (!p) break;

        try {
          // Gọi endpoint kiểm tra kết nối TCP/UDP/Geo
          const { data: snap } = await axios.post(`${launcherApiUrl}/proxy/test`, { entry: p }, { headers });
          if (snap && snap.tcp_ms != null) {
            activeCount++;
          } else {
            await axios.delete(`${launcherApiUrl}/proxies/${p.id}`, { headers });
            deadCount++;
          }
        } catch {
          await axios.delete(`${launcherApiUrl}/proxies/${p.id}`, { headers });
          deadCount++;
        }
      }
    })
  );

  console.log(`✨ Hoàn tất: Đã xóa ${deadCount} proxy die, giữ lại ${activeCount} proxy active.`);
}
```
