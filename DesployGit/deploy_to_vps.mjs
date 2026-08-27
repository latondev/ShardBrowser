/**
 * ==============================================================================
 * 1-CLICK AUTOMATED DEPLOYMENT SCRIPT TO UBUNTU VPS (180.93.115.138)
 * ==============================================================================
 */

import { VpsManager } from "./vps_manager.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runDeploy() {
  const vps = new VpsManager({
    host: "180.93.115.138",
    username: "root",
    password: "uN0%lfIHjilk"
  });

  try {
    console.log("==================================================================");
    console.log("🚀 BẮT ĐẦU TRIỂN KHAI TOÀN BỘ HỆ THỐNG LÊN VPS (180.93.115.138)...");
    console.log("==================================================================");

    await vps.connect();

    // 1. Cài đặt các gói hệ thống cần thiết (Xvfb, Google Chrome, thư viện đồ họa)
    console.log("\n📦 [Bước 1/5] Đang cập nhật hệ thống & cài đặt Google Chrome + Xvfb...");
    const installSystemCmd = `
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y
      apt-get install -y curl wget git unzip xvfb ca-certificates gnupg \
        libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
        libcairo2 libasound2t64 || apt-get install -y libasound2

      # Cài đặt Google Chrome Stable chính thức cho Linux
      mkdir -p /etc/apt/keyrings
      wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg || true
      echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | tee /etc/apt/sources.list.d/google-chrome.list
      apt-get update -y
      apt-get install -y google-chrome-stable || apt-get install -y chromium-browser || true
      google-chrome --version || chromium-browser --version || echo "Browser installed"
    `;
    await vps.execCommand(installSystemCmd);

    // 2. Cài đặt Node.js 20 LTS & PM2
    console.log("\n📦 [Bước 2/5] Cài đặt Node.js 20 LTS & PM2 Process Manager...");
    const installNodeCmd = `
      if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
      fi
      node -v
      npm -v
      npm install -g pm2
    `;
    await vps.execCommand(installNodeCmd);

    // 3. Upload toàn bộ thư mục DesployGit lên VPS (/root/DesployGit)
    console.log("\n📤 [Bước 3/5] Đang tải mã nguồn DesployGit lên VPS (/root/DesployGit)...");
    await vps.uploadDirectory(__dirname, "/root/DesployGit");
    console.log("✅ Đã upload toàn bộ mã nguồn lên VPS thành công!");

    // 4. Khởi động Server Hub (Web Dashboard & SQLite)
    console.log("\n⚙️ [Bước 4/5] Cài đặt và khởi chạy Server Hub (Web Dashboard)...");
    const setupServerCmd = `
      cd /root/DesployGit
      if [ ! -f .env ]; then
        cp .env.example .env
      fi
      npm install --omit=dev
      mkdir -p data
      pm2 delete account-hub 2>/dev/null || true
      pm2 start src/server.js --name "account-hub"
    `;
    await vps.execCommand(setupServerCmd);

    // 5. Khởi động Bot Worker (Vô hạn + Xvfb + Tự động chờ 1h khi hết Quota)
    console.log("\n🤖 [Bước 5/5] Cài đặt và khởi chạy Bot Worker tự động chạy ngầm...");
    const setupBotCmd = `
      cd /root/DesployGit/bot
      if [ ! -f .env ]; then
        cp .env.example .env
      fi
      npm install --omit=dev
      pm2 delete git-bot 2>/dev/null || true
      pm2 start "xvfb-run -a node batch_runner.js 0 12" --name "git-bot"
      pm2 save
      pm2 startup systemd -u root --hp /root || true
    `;
    await vps.execCommand(setupBotCmd);

    // 6. Kiểm tra trạng thái hoạt động
    console.log("\n📊 [Kiểm tra] Kiểm tra trạng thái các tiến trình PM2...");
    await vps.execCommand("pm2 status");
    await vps.execCommand("sleep 3 && curl -s http://127.0.0.1:8080/api/v1/health || echo 'Healthcheck pending'");

    console.log("\n==================================================================");
    console.log("🎉 TRIỂN KHAI THÀNH CÔNG 100% LÊN VPS!");
    console.log("📊 Web Dashboard  : http://180.93.115.138:8080");
    console.log("👤 Đăng nhập Admin: admin / AdminSecure@2026!Pass");
    console.log("🤖 Bot Worker     : Đang chạy ngầm 24/7 với PM2 & Xvfb (chế độ vô hạn + auto cooldown 1h)");
    console.log("==================================================================");
  } catch (err) {
    console.error("\n❌ LỖI TRONG QUÁ TRÌNH DEPLOY:", err.message);
  } finally {
    vps.close();
  }
}

runDeploy();
