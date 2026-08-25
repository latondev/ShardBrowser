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

  /**
   * Lấy Proxy xoay mới từ proxyxoay.shop
   * @param {Object} options - { protocol: 'http' | 'socks5', forceWait: boolean }
   * @returns {Promise<{ proxyString: string, host: string, port: number, protocol: string, ip: string, isp: string, location: string, raw: Object }>}
   */
  async getNewProxy(options = { protocol: "http", forceWait: false }) {
    console.log("🌐 [ProxyXoay] Đang yêu cầu cấp IP Proxy xoay mới từ proxyxoay.shop...");
    const url = `${this._apiUrl}?key=${this._apiKey}&nhamang=random&tinhthanh=0&whitelist=`;

    try {
      let res = await axios.get(url, { timeout: 15000 });
      let data = res.data;

      // Nếu cần chờ đếm ngược (status 101)
      if (data.status === 101) {
        if (this._lastProxy && !options.forceWait) {
          console.log(`ℹ️ [ProxyXoay] Sử dụng IP hiện tại: ${this._lastProxy.proxyString} (${data.message})`);
          return this._lastProxy;
        }

        const waitMatch = (data.message || "").match(/(\d+)\s*s/i);
        const waitSec = waitMatch ? Math.min(parseInt(waitMatch[1], 10) + 1, 60) : 10;
        console.log(`⏳ [ProxyXoay] Cần đợi ${waitSec}s để xoay IP mới...`);
        await this._sleep(waitSec * 1000);

        res = await axios.get(url, { timeout: 15000 });
        data = res.data;
      }

      // Xử lý status 100 (Đổi mới thành công) hoặc status 101 (Proxy cũ vẫn đang sống)
      if (data.status === 100 || (data.status === 101 && this._lastProxy)) {
        let rawProxy = data.proxyhttp || data.proxysocks5;
        if (options.protocol === "socks5" && data.proxysocks5) {
          rawProxy = data.proxysocks5;
        }

        if (!rawProxy && this._lastProxy) {
          console.log(`ℹ️ [ProxyXoay] Sử dụng IP hiện tại: ${this._lastProxy.proxyString} (${data.message})`);
          return this._lastProxy;
        }

        if (!rawProxy) {
          throw new Error(`API không trả về proxy string: ${JSON.stringify(data)}`);
        }

        // Định dạng proxy: "160.250.166.23:10967::" -> Host:Port
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
        return result;
      }

      // Nếu lỗi khác (102, v.v.)
      throw new Error(`ProxyXoay Error (${data.status}): ${data.message || JSON.stringify(data)}`);
    } catch (err) {
      console.warn(`⚠️ [ProxyXoay Warning]: ${err.message}`);
      throw err;
    }
  }
}

// CLI Kiểm thử độc lập
async function main() {
  const client = new ProxyXoayClient();
  try {
    const proxy = await client.getNewProxy({ protocol: "http", forceWait: false });
    console.log("\nKết quả kiểm tra độc lập:");
    console.log(proxy);
  } catch (e) {
    console.error("Lỗi:", e.message);
  }
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("proxyxoay_client.js"))) {
  main();
}
