/**
 * ==============================================================================
 * PROXYXOAY.SHOP API CLIENT - AUTO ROTATING PROXY MANAGER
 * ==============================================================================
 * Tự động xoay IP Proxy Việt Nam (Viettel, FPT, VNPT) qua API proxyxoay.shop
 * Trước mỗi phiên tạo tài khoản mới để tránh bị Rate-Limit / Blacklist IP.
 * 
 * Sample Link: https://proxyxoay.shop/api/get.php?key=[keyxoay]&&nhamang=random&&tinhthanh=0&whitelist=
 * Status 100: Thành công
 * Status 101: Đang chờ thời gian đổi IP
 * Status 102: Lỗi key hoặc IP whitelist
 * ==============================================================================
 */

import axios from "axios";

export class ProxyXoayClient {
  // Private / Protected Properties
  _apiKey = "IaFVANxqBlxITSiAkJpGrG";
  _apiUrl = "https://proxyxoay.shop/api/get.php";
  _lastProxy = null;

  constructor(apiKey = null) {
    if (apiKey) this._apiKey = apiKey;
  }

  // Helper chờ an toàn
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Lấy Proxy xoay mới từ proxyxoay.shop
   * @param {Object} options - { protocol: 'http' | 'socks5', forceWait: boolean }
   * @returns {Promise<{ proxyString: string, host: string, port: number, protocol: string, username?: string, password?: string, ip: string, isp: string, location: string, raw: Object }>}
   */
  async getNewProxy(options = { protocol: "http", forceWait: false }) {
    console.log("🌐 [ProxyXoay] Đang yêu cầu cấp IP Proxy xoay mới từ proxyxoay.shop...");
    const url = `${this._apiUrl}?key=${this._apiKey}&nhamang=random&tinhthanh=0&whitelist=`;

    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const res = await axios.get(url, { timeout: 15000 });
        const data = res.data;

        // Xử lý status = 100 (Thành công)
        if (data.status === 100 || (data.status === 101 && (data.proxyhttp || this._lastProxy) && !options.forceWait)) {
          let rawProxy = data.proxyhttp || data.proxysocks5;
          if (options.protocol === "socks5" && data.proxysocks5) {
            rawProxy = data.proxysocks5;
          }

          if (!rawProxy && this._lastProxy) {
            console.log(`ℹ️ [ProxyXoay] Sử dụng IP hiện tại: ${this._lastProxy.proxyString} (${data.message || 'Chưa đến lượt xoay'})`);
            return this._lastProxy;
          }

          if (rawProxy) {
            const rawClean = String(rawProxy).replace(/[\r\n]/g, "").trim();
            const parts = rawClean.split(":");
            const host = parts[0];
            const port = parseInt(parts[1], 10);
            const username = parts[2] && parts[2] !== "" ? parts[2] : "";
            const password = parts[3] && parts[3] !== "" ? parts[3] : "";
            const protocol = options.protocol === "socks5" ? "socks5" : "http";
            const auth = (username && password) ? `${username}:${password}@` : "";
            const proxyString = `${protocol}://${auth}${host}:${port}`;

            const result = {
              proxyString,
              host,
              port,
              protocol,
              username,
              password,
              user: username,
              pass: password,
              ip: data.ip || host,
              isp: data["Network Provider"] || data["Nha Mang"] || data["nhamang"] || data["Nhà cung cấp mạng"] || "Random",
              location: data["Location"] || data["Vi Tri"] || data["tinhthanh"] || data["Vị trí"] || "Vietnam",
              message: data.message || "OK",
              raw: data,
            };

            this._lastProxy = result;
            console.log(`✅ [ProxyXoay Thành Công]: [${result.proxyString}] | ISP: ${result.isp} | Vị trí: ${result.location} | IP: ${result.ip}`);
            return result;
          }
        }

        // Xử lý status = 101 (Cần chờ thời gian xoay IP)
        if (data.status === 101) {
          const waitMatch = (data.message || "").match(/(\d+)\s*(?:s|giây|second)?/i);
          const waitSec = waitMatch ? Math.min(parseInt(waitMatch[1], 10) + 2, 65) : 10;
          console.log(`⏳ [ProxyXoay Status 101] Cần đợi ${waitSec}s để xoay IP mới (${data.message}) [Lần thử ${attempt}/10]...`);
          await this._sleep(waitSec * 1000);
          continue;
        }

        // Xử lý status = 102 (Lỗi Key hoặc IP whitelist)
        if (data.status === 102) {
          console.warn(`❌ [ProxyXoay Status 102]: ${data.message || 'Key không hợp lệ hoặc IP chưa được whitelist'} (Lần thử ${attempt}/10)`);
          if (attempt >= 10) {
            throw new Error(`ProxyXoay Error 102: ${data.message || 'Key không tồn tại hoặc IP chưa whitelist'}`);
          }
          await this._sleep(5000);
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
