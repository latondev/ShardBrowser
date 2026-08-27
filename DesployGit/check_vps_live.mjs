import { VpsManager } from "./vps_manager.mjs";

async function check() {
  const vps = new VpsManager({
    host: "180.93.115.138",
    username: "root",
    password: "uN0%lfIHjilk"
  });

  try {
    await vps.connect();
    console.log("\n--- PM2 STATUS ---");
    await vps.execCommand("pm2 status");
    console.log("\n--- HEALTH CHECK 8080 ---");
    await vps.execCommand("curl -s http://127.0.0.1:8080/api/v1/health || echo 'curl error'");
    console.log("\n--- SERVER LOGS ---");
    await vps.execCommand("pm2 logs account-hub --lines 15 --nostream");
    console.log("\n--- BOT LOGS ---");
    await vps.execCommand("pm2 logs git-bot --lines 30 --nostream");
  } catch (e) {
    console.error(e.message);
  } finally {
    vps.close();
  }
}

check();
