import { Client } from "ssh2";
import fs from "node:fs";
import path from "node:path";

function uploadAll() {
  const conn = new Client();

  conn.on("ready", () => {
    console.log("✅ SSH Ready");

    conn.sftp(async (err, sftp) => {
      if (err) throw err;

      const put = (loc, rem) =>
        new Promise((resolve, reject) => {
          sftp.fastPut(loc, rem, (e) => {
            if (e) reject(e);
            else resolve();
          });
        });

      try {
        console.log("📤 Uploading files via fastPut...");

        const botFiles = [
          "package.json",
          "ai_agent_runner.js",
          "batch_runner.js",
          "account_storage.js",
          "mailtm_client.js",
          "gmail_creator_client.js",
          "totp_client.js",
          "proxyxoay_client.js",
          "rapidapikey.md",
          "output.txt",
          "run_bot.sh"
        ];

        for (const f of botFiles) {
          const lPath = path.join("d:\\YTB\\Resgiter_AI\\ShardBrowser\\DesployGit\\bot", f);
          const rPath = `/root/DesployGit/bot/${f}`;
          if (fs.existsSync(lPath)) {
            console.log(`-> bot/${f}`);
            await put(lPath, rPath);
          }
        }

        const srcFiles = ["auth.js", "database.js", "server.js"];
        for (const f of srcFiles) {
          const lPath = path.join("d:\\YTB\\Resgiter_AI\\ShardBrowser\\DesployGit\\src", f);
          const rPath = `/root/DesployGit/src/${f}`;
          console.log(`-> src/${f}`);
          await put(lPath, rPath);
        }

        const pubFiles = ["index.html", "login.html", "style.css", "app.js"];
        for (const f of pubFiles) {
          const lPath = path.join("d:\\YTB\\Resgiter_AI\\ShardBrowser\\DesployGit\\public", f);
          const rPath = `/root/DesployGit/public/${f}`;
          console.log(`-> public/${f}`);
          await put(lPath, rPath);
        }

        await put("d:\\YTB\\Resgiter_AI\\ShardBrowser\\DesployGit\\package.json", "/root/DesployGit/package.json");
        await put("d:\\YTB\\Resgiter_AI\\ShardBrowser\\DesployGit\\.env.example", "/root/DesployGit/.env");

        console.log("✅ Upload hoàn tất 100%!");

        // Khởi động server & bot
        conn.exec(`
          cd /root/DesployGit && npm install --omit=dev
          cd /root/DesployGit/bot && npm install --omit=dev
          pm2 delete all || true
          cd /root/DesployGit && pm2 start src/server.js --name account-hub
          cd /root/DesployGit/bot && pm2 start "xvfb-run -a node batch_runner.js 0 12" --name git-bot
          pm2 save
          sleep 4
          pm2 status
          curl -s http://127.0.0.1:8080/api/v1/health
        `, (execErr, stream) => {
          if (execErr) throw execErr;
          stream.on("close", () => {
            console.log("🎉 Xong!");
            conn.end();
          });
          stream.on("data", (d) => process.stdout.write(d.toString()));
          stream.stderr.on("data", (d) => process.stderr.write(d.toString()));
        });
      } catch (uploadErr) {
        console.error("Lỗi upload:", uploadErr);
        conn.end();
      }
    });
  }).connect({
    host: "180.93.115.138",
    port: 22,
    username: "root",
    password: "uN0%lfIHjilk"
  });
}

uploadAll();
