import crypto from "node:crypto";

function base32Decode(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  const clean = String(base32).replace(/=+$/, "").toUpperCase().replace(/[\s-]/g, "");
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function getTotpCode(secret, timeStepSec = 30) {
  const clean = String(secret || "").trim();
  if (!clean) throw new Error("TOTP_SECRET_EMPTY");

  const key = base32Decode(clean);
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
