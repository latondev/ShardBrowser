import { VpsManager } from "./vps_manager.mjs";

async function checkChrome() {
  const vps = new VpsManager({ host: "180.93.115.138", username: "root", password: "uN0%lfIHjilk" });
  await vps.connect();
  console.log("--- CHMOD AND TEST SHARDX-LINUX CHROME ---");
  await vps.execCommand("chmod -R +x /root/.config/shardx-launcher/runtime/ShardX-Linux");
  await vps.execCommand("ls -la /root/.config/shardx-launcher/runtime/ShardX-Linux");
  await vps.execCommand("/root/.config/shardx-launcher/runtime/ShardX-Linux/chrome --version || /root/.config/shardx-launcher/runtime/ShardX-Linux/shardx --version || echo 'Checking'");
  vps.close();
}

checkChrome();
