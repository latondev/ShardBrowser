import { VpsManager } from "./vps_manager.mjs";

async function checkBin() {
  const vps = new VpsManager({ host: "180.93.115.138", username: "root", password: "uN0%lfIHjilk" });
  await vps.connect();
  console.log("--- CHECKING SHARDX RUNTIME DIRECTORY ---");
  await vps.execCommand("find /root/.config/shardx-launcher/runtime -type f -executable");
  await vps.execCommand("ls -la /root/.config/shardx-launcher/runtime");
  vps.close();
}

checkBin();
