/**
 * TOTP ENGINE (RFC 6238 / RFC 4226) - 100% OFFLINE & ZERO LATENCY
 * ==============================================================================
 * Module tính toán mã 2FA TOTP 6 chữ số bằng HMAC-SHA1 nội bộ của Node.js.
 * - Không gửi secret key lên server bên thứ ba.
 * - Tốc độ thực thi 0ms.
 * 
 * Quy tắc đặt tên:
 * - Biến/Phương thức private/protected: _{name}
 * - Biến/Phương thức public: {nameValue}
 * ==============================================================================
 */

import crypto from "node:crypto";

export class TotpEngine {
  _alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  /**
   * Giải mã chuỗi Base32 thành Buffer theo chuẩn RFC 4648
   * @param {string} base32Text - Chuỗi Base32 Secret Key
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
   * @param {string} secretKey - Chuỗi Base32 Secret Key (VD: YBXMILOQIN7SQ7EN)
   * @param {number} timeStepSec - Chu kỳ mã (mặc định 30 giây)
   * @returns {string} Mã TOTP 6 chữ số (VD: "123456")
   */
  generateCode(secretKey, timeStepSec = 30) {
    if (!secretKey) throw new Error("Secret Key không được để trống.");

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
}
