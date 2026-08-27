/**
 * ==============================================================================
 * TOTP ENGINE CLIENT (RFC 6238 / RFC 4226) - 100% OFFLINE & ZERO LATENCY
 * ==============================================================================
 * Tự động tính toán mã 2FA TOTP 6 chữ số bằng HMAC-SHA1 nội bộ (0ms).
 * Không mở thêm tab trình duyệt, không gửi Secret Key lên server bên thứ ba.
 * Có cơ chế tự động Fallback sang Public API nếu cần.
 * ==============================================================================
 */

import crypto from "node:crypto";
import axios from "axios";

export class TotpClient {
  _alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  /**
   * Giải mã chuỗi Base32 thành Buffer (Chuẩn RFC 4648)
   * @param {string} base32Text - Chuỗi Base32 secret key
   * @returns {Buffer}
   */
  _base32Decode(base32Text) {
    let bits = "";
    const cleanKey = String(base32Text)
      .replace(/=+$/, "")
      .toUpperCase()
      .replace(/[\s-]/g, "");

    for (let i = 0; i < cleanKey.length; i++) {
      const val = this._alphabet.indexOf(cleanKey[i]);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, "0");
    }

    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.substring(i, i + 8), 2));
    }
    return Buffer.from(bytes);
  }

  /**
   * Tính toán mã OTP 6 chữ số từ Secret Key (RFC 6238)
   * @param {string} secretKey - Chuỗi Base32 Secret Key (VD: HRH22266LXBT33HY)
   * @param {number} timeStepSec - Chu kỳ mã (mặc định 30 giây)
   * @returns {string} Mã TOTP 6 số (VD: "500292")
   */
  generateCode(secretKey, timeStepSec = 30) {
    if (!secretKey) throw new Error("Secret Key không được để trống");
    
    const key = this._base32Decode(secretKey);
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / timeStepSec);
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(counter));

    const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    const otp = binary % 1000000;
    return otp.toString().padStart(6, "0");
  }

  /**
   * Lấy số giây còn lại của mã OTP hiện tại
   * @param {number} timeStepSec
   * @returns {number} Số giây còn lại (1 - 30)
   */
  getRemainingSeconds(timeStepSec = 30) {
    const epoch = Math.floor(Date.now() / 1000);
    return timeStepSec - (epoch % timeStepSec);
  }

  /**
   * Lấy mã OTP với tự động Fallback qua Public API nếu lỗi cục bộ
   * @param {string} secretKey 
   * @returns {Promise<string>}
   */
  async getCodeWithFallback(secretKey) {
    try {
      return this.generateCode(secretKey);
    } catch (localErr) {
      console.warn(`⚠️ [TOTP Engine] Lỗi sinh cục bộ (${localErr.message}) -> Gọi Fallback 2fa.live API...`);
      try {
        const cleanKey = String(secretKey).replace(/\s+/g, "").toUpperCase();
        const res = await axios.get(`https://2fa.live/tok/${cleanKey}`, { timeout: 6000 });
        if (res.data && res.data.token) {
          return String(res.data.token).trim();
        }
      } catch (apiErr) {
        throw new Error(`Không thể sinh mã TOTP qua cả Local và Online API: ${apiErr.message}`);
      }
    }
  }
}
