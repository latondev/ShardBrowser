# 🤖 CDP & Puppeteer-Core Human-Like Automation Guide

Tài liệu này hướng dẫn chi tiết các kỹ thuật điều khiển trình duyệt qua **Chrome DevTools Protocol (CDP)**, mô phỏng tương tác người dùng thật (Human-like) và xử lý xác thực bảo mật tự động (2FA/OTP).

---

## 1. Kết Nối Puppeteer-Core Vào ShardBrowser

Sử dụng thư viện `puppeteer-core` để kết nối vào phiên ShardBrowser đang chạy qua WebSocket URL nhận từ API:

```javascript
import puppeteer from "puppeteer-core";

export async function connectToShardBrowser(wsUrl) {
  const browser = await puppeteer.connect({
    browserWSEndpoint: wsUrl,
    defaultViewport: null, // Giữ nguyên kích thước màn hình của Fingerprint
    protocolTimeout: 240000 // 4 phút timeout tránh đứt kết nối khi mạng chậm
  });
  return browser;
}
```

---

## 2. Các Kỹ Thuật Mô Phỏng Người Thật (Human-Like Interactions)

### 2.1. Gõ Phím Tuần Tự & Kích Hoạt Sự Kiện (`_humanType`)
Tránh bị phát hiện bot bởi các hệ thống Cloudflare / Arkose / Google Bot:

```javascript
export async function humanType(page, selector, textToType, shouldPressEnter = false) {
  if (!page || !textToType) return false;

  await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  const el = await page.$(selector);
  if (!el) return false;

  // 1. Cuộn vào tầm nhìn và di chuột đến phần tử
  await el.evaluate((e) => e.scrollIntoView({ behavior: "smooth", block: "center" }));
  const box = await el.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  }

  // 2. Focus & Xóa sạch nội dung cũ
  await el.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 100));

  // 3. Gõ từng ký tự với độ trễ jitter ngẫu nhiên
  for (const char of textToType) {
    const delay = Math.floor(Math.random() * (80 - 40 + 1)) + 40; // 40ms - 80ms
    await page.keyboard.type(char, { delay });
  }

  // 4. Bắn đầy đủ các sự kiện input, change, blur cho React/Vue/Angular nhận diện
  await page.evaluate((element, val) => {
    element.value = val;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }, el, textToType);

  if (shouldPressEnter) {
    await page.keyboard.press("Enter");
  }
  return true;
}
```

---

### 2.2. Tự Động Xóa / Đóng Cookie Banners & Overlays

Tránh tình trạng các modal cookie che mất nút bấm:

```javascript
export async function dismissCookieBanners(page) {
  if (!page || page.isClosed()) return;
  await page.evaluate(() => {
    const selectors = [
      "button.js-cookie-consent-reject",
      "button[data-cookie-banner-action='reject']",
      "button[data-cookie-banner-action='accept']",
      "#accept-cookie-banner",
      ".Overlay-closeButton",
      "[aria-label='Close']"
    ];
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        try { el.click(); } catch {}
      });
    });

    // Ẩn các banner chứa chữ cookie
    const banners = Array.from(document.querySelectorAll("div, section, aside")).filter((el) => {
      const txt = (el.innerText || "").toLowerCase();
      return txt.includes("we use optional cookies") || txt.includes("cookie-consent");
    });
    banners.forEach((b) => b.remove());
  }).catch(() => {});
}
```

---

## 3. Xác Thực 2FA TOTP Offline 0ms (RFC 6238)

Tự động trích xuất Base32 Setup Key và tính toán mã TOTP 6 số bằng `node:crypto` ngay trên bộ nhớ:

```javascript
import crypto from "node:crypto";

export class TotpService {
  // Giải mã Base32 thành Buffer (Chuẩn RFC 4648)
  static base32Decode(base32) {
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

  // Sinh mã TOTP 6 số theo thời gian thực (0ms, Không cần mạng)
  static generateCode(secret, timeStepSec = 30) {
    const key = this.base32Decode(secret);
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
```

---

## 4. Tự Động Điền Dãy Ô OTP Rời Rạc (`_fillOtpDigits`)

Nhiều trang web (GitHub, Google, Facebook) chia mã OTP thành 6 hoặc 8 ô input riêng lẻ:

```javascript
export async function fillOtpInputs(page, otpCode) {
  const code = String(otpCode).trim();
  await page.evaluate((c) => {
    // 1. Trường hợp dãy ô input rời rạc (input[data-index='0'], #launch-code-0...)
    for (let i = 0; i < c.length; i++) {
      const el = document.querySelector(`#launch-code-${i}`) ||
                 document.querySelector(`input[data-index='${i}']`) ||
                 document.querySelectorAll('[data-testid="otp-digit"]')[i];
      if (el) {
        el.value = c[i];
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // 2. Trường hợp ô input OTP đơn
    const single = document.querySelector("#app_totp, #otp, input[name='otp'], input[autocomplete='one-time-code']");
    if (single) {
      single.value = c;
      single.dispatchEvent(new Event("input", { bubbles: true }));
      single.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, code);
}
```
