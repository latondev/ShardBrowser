import fs from "fs";
import path from "path";
import axios from "axios";
import puppeteer from "puppeteer-core";

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    // Bỏ qua các file lock và port tạm thời
    if (entry.name === "lockfile" || 
        entry.name === "DevToolsActivePort" || 
        entry.name.endsWith(".pma") ||
        entry.name.startsWith("Singleton")) {
      continue;
    }
    
    try {
      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    } catch (e) {
      // Bỏ qua các file đang bị lock hoặc quyền truy cập
    }
  }
}

async function testClone() {
  const launcherApi = "http://127.0.0.1:40327";
  const sourceId = "c98fbd4e-c366-4754-a61d-b48c479a9cf5"; // Profile 32231
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE, "AppData", "Roaming");
  const sourceUserData = path.join(appData, "shardx-launcher", "user-data", sourceId);

  console.log("1. Đang clone profile từ Launcher API...");
  const { data: clonedMeta } = await axios.post(`${launcherApi}/profiles/${sourceId}/clone`, {});
  const clonedId = clonedMeta.id;
  console.log(`-> Tạo profile clone ID: ${clonedId}`);

  const destUserData = path.join(appData, "shardx-launcher", "user-data", clonedId);
  console.log(`2. Đang sao chép user-data từ '${sourceUserData}' sang '${destUserData}'...`);
  copyDirRecursive(sourceUserData, destUserData);
  console.log("-> Đã sao chép xong user-data!");

  console.log("3. Đang khởi chạy profile clone qua Launcher API...");
  const { data: startRes } = await axios.post(`${launcherApi}/profiles/${clonedId}/start`, { headless: false });
  const wsUrl = startRes.cdp?.web_socket_debugger_url;
  console.log(`-> CDP URL: ${wsUrl}`);

  const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  console.log("4. Điều hướng tới https://github.com/...");
  await page.goto("https://github.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  console.log("5. Click nút 'Sign up' trên Header...");
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('header a[href*="/signup"]');
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  console.log(`-> Click Sign up: ${clicked}`);

  await new Promise(r => setTimeout(r, 4000));
  const currentUrl = page.url();
  const state = await page.evaluate(() => {
    const html = document.documentElement.innerHTML.toLowerCase();
    return {
      url: window.location.href,
      hasEmail: !!document.querySelector("#email, input[name='user[email]'], input[type='email']"),
      isRestricted: html.includes("temporarily restricted") || html.includes("datadome"),
      isCaptcha: html.includes("datadome") || html.includes("captcha-container") || !!document.querySelector("iframe[src*='datadome']")
    };
  });

  console.log("6. Kết quả trạng thái trang:", JSON.stringify(state, null, 2));

  // Chụp ảnh lại màn hình để kiểm chứng
  await page.screenshot({ path: path.join("Testing", "git", "test_clone_result.png") });
  console.log("-> Đã chụp ảnh lưu vào Testing/git/test_clone_result.png");

  await browser.disconnect();
  // Dọn dẹp profile clone sau khi test
  await axios.post(`${launcherApi}/profiles/${clonedId}/stop`).catch(() => {});
  await axios.delete(`${launcherApi}/profiles/${clonedId}`).catch(() => {});
  console.log("-> Đã dọn dẹp profile clone test.");
}

testClone().catch(console.error);
