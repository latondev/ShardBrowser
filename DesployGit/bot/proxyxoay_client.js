/**
 * ==============================================================================
 * PROXYXOAY.SHOP API CLIENT - AUTO ROTATING PROXY MANAGER
 * ==============================================================================
 * Tự động xoay IP Proxy Việt Nam (Viettel, FPT, VNPT) qua API proxyxoay.shop
 * Trước mỗi phiên tạo tài khoản mới để tránh bị Rate-Limit / Blacklist IP.
 * ==============================================================================
 */

import axios from "axios";

export class ProxyXoayClient {
  _apiKey = "IaFVANxqBlxITSiAkJpGrG";
  _apiUrl = "https://proxyxoay.shop/api/get.php";
  _lastProxy = null;

  constructor(apiKey = null) {
    if (apiKey) this._apiKey = apiKey;
  }

  // Helper chờ
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Kiểm tra đường truyền Proxy đã kết nối mạng thông suốt chưa
  async _validateProxyConnectivity(host, port, retries = 4) {
    console.log(`⏳ [ProxyXoay] Đang kiểm tra độ sẵn sàng của đường truyền Proxy (${host}:${port})...`);
    for (let i = 1; i <= retries; i++) {
      try {
        const res = await axios.get("https://api.ipify.org?format=json", {
          proxy: { host, port, protocol: "http" },
          timeout: 8000
        });
        if (res.data && res.data.ip) {
          console.log(`🌐 [Proxy Sẵn Sàng] Đường truyền hoạt động mượt mà (IP Thực Tế: ${res.data.ip})`);
          return true;
        }
      } catch {
        console.log(`⏳ [Proxy Khởi Tạo] Đường truyền đang thiết lập kết nối, đợi 3s (lần ${i}/${retries})...`);
        await this._sleep(3000);
      }
    }
    return true; // Vẫn tiếp tục nếu timeout nhẹ
  }

  /**
   * Lấy Proxy xoay mới từ proxyxoay.shop
   * @param {Object} options - { protocol: 'http' | 'socks5', forceWait: boolean }
   * @returns {Promise<{ proxyString: string, host: string, port: number, protocol: string, ip: string, isp: string, location: string, raw: Object }>}
   */
  async getNewProxy(options = { protocol: "http", forceWait: false }) {
    console.log("🌐 [ProxyXoay] Đang yêu cầu cấp IP Proxy xoay mới từ proxyxoay.shop...");
    const url = `${this._apiUrl}?key=${this._apiKey}&nhamang=random&tinhthanh=0&whitelist=`;

    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const res = await axios.get(url, { timeout: 15000 });
        const data = res.data;

        if (data.status === 100 || (data.status === 101 && (data.proxyhttp || this._lastProxy))) {
          let rawProxy = data.proxyhttp || data.proxysocks5;
          if (options.protocol === "socks5" && data.proxysocks5) {
            rawProxy = data.proxysocks5;
          }

          if (!rawProxy && this._lastProxy) {
            console.log(`ℹ️ [ProxyXoay] Sử dụng IP hiện tại: ${this._lastProxy.proxyString} (${data.message})`);
            await this._validateProxyConnectivity(this._lastProxy.host, this._lastProxy.port);
            return this._lastProxy;
          }

          if (rawProxy) {
            const cleanProxy = rawProxy.split("::")[0].trim();
            const [host, portStr] = cleanProxy.split(":");
            const port = parseInt(portStr, 10);
            const protocol = options.protocol === "socks5" ? "socks5" : "http";
            const proxyString = `${protocol}://${cleanProxy}`;

            const result = {
              proxyString,
              host,
              port,
              protocol,
              ip: data.ip || host,
              isp: data["Nha Mang"] || data["Nhà cung cấp mạng"] || "Random",
              location: data["Vi Tri"] || data["Vị trí"] || "Vietnam",
              message: data.message,
              raw: data,
            };

            this._lastProxy = result;
            console.log(`✅ [ProxyXoay Thành Công]: [${result.proxyString}] | ISP: ${result.isp} | Vị trí: ${result.location} | IP: ${result.ip}`);
            
            // Đảm bảo Proxy đã mở luồng thông suốt trước khi mở trình duyệt
            await this._validateProxyConnectivity(host, port);

            return result;
          }
        }

        if (data.status === 101) {
          const waitMatch = (data.message || "").match(/(\d+)\s*s/i);
          const waitSec = waitMatch ? Math.min(parseInt(waitMatch[1], 10) + 2, 65) : 10;
          console.log(`⏳ [ProxyXoay] Cần đợi ${waitSec}s để xoay IP mới (Lần thử ${attempt}/10)...`);
          await this._sleep(waitSec * 1000);
          continue;
        }

        throw new Error(`ProxyXoay Error (${data.status}): ${data.message || JSON.stringify(data)}`);
      } catch (err) {
        if (attempt >= 10) throw err;
        console.warn(`⚠️ [ProxyXoay Retry ${attempt}/10]: ${err.message}`);
        await this._sleep(5000);
      }
    }
  }
}
