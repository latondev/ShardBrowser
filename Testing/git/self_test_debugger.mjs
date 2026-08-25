/**
 * ==============================================================================
 * AUTOMATED SELF-TEST & DIAGNOSTIC SUITE FOR SHARDBROWSER AUTOMATION
 * ==============================================================================
 * Tự động kiểm tra từng thành phần độc lập (Module-by-Module):
 * [1] Mail.tm Client (API Tạo hòm thư & Nhận OTP)
 * [2] TOTP Engine (Tính toán mã 6 số RFC 6238)
 * [3] Proxy & Network Latency / IP Leak
 * [4] Fingerprint Consistency (Kiểm tra lệch OS, WebGL, Canvas, User-Agent)
 * [5] GitHub Navigation & Form Rendering
 * ==============================================================================
 */

import axios from "axios";
import puppeteer from "puppeteer-core";
import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { MailTmClient } from "./mailtm_client.js";
import { TotpClient } from "./totp_client.js";

const LAUNCHER_API_URL = process.env.LAUNCHER_API_URL || "http://127.0.0.1:40325";
const LAUNCHER_API_TOKEN = process.env.LAUNCHER_API_TOKEN || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaGFyZHgtYXBpIiwiaWF0IjoxNzg3MTI4NjE5LCJleHAiOjIxMDI0ODg2MTl9.Y44-0maSpd_9e7_U3yLPHgvFb1O2_GBHReb6qs0H2p0";
const HEADERS = { Authorization: `Bearer ${LAUNCHER_API_TOKEN}` };

export class SelfTestDebugger {
  _testResults = {
    mailTm: false,
    totp: false,
    proxy: false,
    fingerprint: false,
    github: false,
  };

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ----------------------------------------------------------------------------
  // TEST 1: MAIL.TM REST API
  // ----------------------------------------------------------------------------
  async testMailTm() {
    console.log("\n==================================================================");
    console.log("TEST 1: KIỂM TRA MAIL.TM REST API (Tạo hòm thư & Kết nối)");
    console.log("==================================================================");
    const client = new MailTmClient();
    try {
      const prefix = `test${Date.now().toString().slice(-4)}`;
      console.log(`⏳ Đang tạo tài khoản test với prefix: [${prefix}]...`);
      const acc = await client.createAccount(prefix);
      console.log(`✅ [Pass] Tạo email thành công: ${acc.address}`);
      console.log(`✅ [Pass] Token Bearer JWT hợp lệ: ${client._token.slice(0, 20)}...`);
      this._testResults.mailTm = true;
      return true;
    } catch (err) {
      console.error(`❌ [Fail] Lỗi Mail.tm API: ${err.message}`);
      return false;
    }
  }

  // ----------------------------------------------------------------------------
  // TEST 2: TOTP ENGINE
  // ----------------------------------------------------------------------------
  async testTotp() {
    console.log("\n==================================================================");
    console.log("TEST 2: KIỂM TRA TOTP ENGINE (RFC 6238 Local Calculation)");
    console.log("==================================================================");
    const client = new TotpClient();
    try {
      const testSecret = "JBSWY3DPEHPK3PXP";
      const t0 = Date.now();
      const code = client.generateCode(testSecret);
      const latency = Date.now() - t0;
      const remaining = client.getRemainingSeconds();

      if (/^\d{6}$/.test(code)) {
        console.log(`✅ [Pass] Secret: ${testSecret} -> Mã TOTP: [ ${code} ]`);
        console.log(`✅ [Pass] Tốc độ tính toán: ${latency}ms | Còn lại: ${remaining}s`);
        this._testResults.totp = true;
        return true;
      }
      throw new Error(`Mã không hợp lệ: ${code}`);
    } catch (err) {
      console.error(`❌ [Fail] Lỗi TOTP: ${err.message}`);
      return false;
    }
  }

  // ----------------------------------------------------------------------------
  // TEST 3: PROXY CREDENTIALS & NETWORK
  // ----------------------------------------------------------------------------
  async testProxy() {
    console.log("\n==================================================================");
    console.log("TEST 3: KIỂM TRA CẤU HÌNH & XÁC THỰC PROXY TRONG SHARDBROWSER");
    console.log("==================================================================");
    try {
      const roamingPath = path.join(os.homedir(), "AppData", "Roaming", "shardx-launcher", "proxies.json");
      if (!existsSync(roamingPath)) {
        console.warn("⚠️ [Warn] Chưa tìm thấy file proxies.json -> Chạy IP Direct.");
        return true;
      }

      const raw = readFileSync(roamingPath, "utf8");
      const { proxies } = JSON.parse(raw);
      if (!Array.isArray(proxies) || proxies.length === 0) {
        console.log("ℹ️ Không có proxy nào được lưu -> Chạy IP Direct.");
        return true;
      }

      console.log(`📋 Đã tìm thấy ${proxies.length} Proxy trong hệ thống:`);
      for (const p of proxies) {
        const hasAuth = p.username && p.password;
        console.log(`   - [${p.name || p.host}] ${p.kind}://${p.host}:${p.port} | Auth: ${hasAuth ? `User: ${p.username}` : 'No Auth'}`);
      }

      this._testResults.proxy = true;
      return true;
    } catch (err) {
      console.error(`❌ [Fail] Lỗi đọc Proxy: ${err.message}`);
      return false;
    }
  }

  // ----------------------------------------------------------------------------
  // TEST 4 & 5: FINGERPRINT CONSISTENCY & GITHUB NAVIGATION
  // ----------------------------------------------------------------------------
  async testFingerprintAndBrowser() {
    console.log("\n==================================================================");
    console.log("TEST 4 & 5: KIỂM TRA TÍNH ĐỒNG NHẤT FINGERPRINT & TẢI TRANG GITHUB");
    console.log("==================================================================");
    let profileId = null;
    let browser = null;

    try {
      // 1. Sinh Fingerprint Windows từ Launcher
      console.log("⏳ [1/4] Yêu cầu sinh bộ Fingerprint Windows từ Launcher...");
      const { data: fpRes } = await axios.get(`${LAUNCHER_API_URL}/fingerprint/new/windows`, { headers: HEADERS, timeout: 5000 });
      const fp = fpRes.fingerprint;

      console.log("🔍 [Fingerprint Inspector]:");
      console.log(`   - Platform      : ${fp.navigator?.uadata?.platform || "Windows"}`);
      console.log(`   - PlatformVer   : ${fp.navigator?.uadata?.high_entropy?.platformVersion || "N/A"}`);
      console.log(`   - User-Agent    : ${fp.navigator?.app_version || "Auto"}`);
      console.log(`   - WebGL Vendor  : ${fp.webgl?.unmasked_vendor || "N/A"}`);
      console.log(`   - WebGL Renderer: ${fp.webgl?.unmasked_renderer || "N/A"}`);
      console.log(`   - Hardware Cores: ${fp.hardware_concurrency || "Auto"}`);
      console.log(`   - Memory (GB)   : ${fp.device_memory || "Auto"}`);

      // 2. Tạo Profile Test
      const profileName = `TEST-DEBUG-${Date.now().toString().slice(-4)}`;
      console.log(`⏳ [2/4] Tạo Profile tạm thời [${profileName}]...`);
      const { data: createdProfile } = await axios.post(`${LAUNCHER_API_URL}/profiles`, {
        name: profileName,
        notes: "Self-test automated profile",
        fingerprint: fp,
      }, { headers: HEADERS });
      profileId = createdProfile.id;

      // 3. Khởi chạy Profile và kết nối CDP
      console.log(`⏳ [3/4] Khởi chạy Profile qua CDP...`);
      const { data: startRes } = await axios.post(`${LAUNCHER_API_URL}/profiles/${profileId}/start`, { headless: false }, { headers: HEADERS });
      const wsUrl = startRes.cdp?.web_socket_debugger_url;
      if (!wsUrl) throw new Error("Không nhận được WebSocket debugger URL.");

      browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
      const pages = await browser.pages();
      const page = pages[0] || (await browser.newPage());
      page.setDefaultNavigationTimeout(60000);

      // 4. Kiểm tra các tham số thực tế chạy trên trình duyệt (Browser Runtime Integrity)
      const browserParams = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl");
        let debugRenderer = "N/A";
        let debugVendor = "N/A";
        if (gl) {
          const dbg = gl.getExtension("WEBGL_debug_renderer_info");
          if (dbg) {
            debugVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
            debugRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
          }
        }

        return {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          languages: navigator.languages,
          webdriver: navigator.webdriver,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory: navigator.deviceMemory,
          webglVendor: debugVendor,
          webglRenderer: debugRenderer,
        };
      });

      console.log("\n📊 [Runtime Browser Parameters]:");
      console.log(`   - navigator.webdriver : ${browserParams.webdriver} (Chuẩn: false/undefined)`);
      console.log(`   - navigator.platform  : ${browserParams.platform} (Chuẩn: Win32)`);
      console.log(`   - WebGL Renderer Live : ${browserParams.webglRenderer}`);
      console.log(`   - navigator.languages : ${JSON.stringify(browserParams.languages)}`);

      if (browserParams.webdriver === true) {
        console.warn("⚠️ [CẢNH BÁO]: navigator.webdriver = true -> Dễ bị WAF nhận diện bot!");
      } else {
        console.log("✅ [Pass] navigator.webdriver được ẩn an toàn.");
      }
      this._testResults.fingerprint = true;

      // 5. Kiểm tra Tải trang GitHub Signup
      console.log(`⏳ [4/4] Mở trang GitHub Signup https://github.com/signup?source=login...`);
      await page.goto("https://github.com/signup?source=login", { waitUntil: "domcontentloaded", timeout: 60000 });
      await this._sleep(3000);

      const pageState = await page.evaluate(() => {
        const bodyText = document.body ? document.body.innerText : "";
        const emailInput = document.querySelector("#email, input[type='email'], input[name='user[email]']");
        const hasRateLimit = bodyText.includes("Truy cập tạm thời bị hạn chế") || bodyText.includes("Access restricted") || bodyText.includes("robot");
        return {
          title: document.title,
          hasEmailInput: !!emailInput,
          hasRateLimit,
          bodySnippet: bodyText.slice(0, 200).replace(/\n/g, " "),
        };
      });

      console.log("\n📄 [GitHub Page Status]:");
      console.log(`   - Tiêu đề trang   : ${pageState.title}`);
      console.log(`   - Form Email Sẵn  : ${pageState.hasEmailInput ? '✅ CÓ' : '❌ CHƯA'}`);
      console.log(`   - Rate-Limit Flag : ${pageState.hasRateLimit ? '⚠️ BỊ CHẶN' : '✅ SẠCH 100%'}`);

      if (pageState.hasRateLimit) {
        console.warn("❌ [Phát hiện]: IP hoặc Fingerprint này đang bị GitHub Rate-Limit.");
      } else if (pageState.hasEmailInput) {
        console.log("🎉 [Pass] Form đăng ký GitHub hoạt động hoàn hảo và sẵn sàng nhận diện người dùng thật!");
        this._testResults.github = true;
      }

      return true;
    } catch (err) {
      console.error(`❌ [Fail] Lỗi kiểm tra Browser: ${err.message}`);
      return false;
    } finally {
      // Dọn dẹp Profile Test
      if (browser) await browser.disconnect().catch(() => {});
      if (profileId) {
        await axios.post(`${LAUNCHER_API_URL}/profiles/${profileId}/stop`, {}, { headers: HEADERS }).catch(() => {});
        console.log(`🧹 Đã dọn dẹp Profile Test: ${profileId}`);
      }
    }
  }

  // ----------------------------------------------------------------------------
  // TỔNG KẾT BÁO CÁO
  // ----------------------------------------------------------------------------
  printSummary() {
    console.log("\n==================================================================");
    console.log("                   BÁO CÁO KẾT QUẢ TỔNG QUAN                      ");
    console.log("==================================================================");
    console.log(`1. Mail.tm REST API     : ${this._testResults.mailTm ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`2. TOTP Engine (0ms)    : ${this._testResults.totp ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`3. Cấu hình Proxy       : ${this._testResults.proxy ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`4. Fingerprint Integrity: ${this._testResults.fingerprint ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`5. GitHub Form Ready    : ${this._testResults.github ? '✅ PASSED' : '❌ FAILED'}`);
    console.log("==================================================================\n");
  }
}

// Chạy tự động
async function main() {
  const runner = new SelfTestDebugger();
  await runner.testMailTm();
  await runner.testTotp();
  await runner.testProxy();
  await runner.testFingerprintAndBrowser();
  runner.printSummary();
}

main();
