import { VpsManager } from "./vps_manager.mjs";

async function main() {
  const vps = new VpsManager({
    host: "180.93.115.138",
    username: "root",
    password: "uN0%lfIHjilk"
  });

  try {
    await vps.connect();
    console.log("\n📊 Đang kiểm tra thông tin cấu hình VPS...");
    await vps.execCommand("uname -a && lsb_release -a 2>/dev/null || cat /etc/os-release");
    await vps.execCommand("free -h");
    await vps.execCommand("df -h /");
    await vps.execCommand("nproc");
    await vps.execCommand("which docker docker-compose node 2>/dev/null || true");
  } catch (err) {
    console.error("Lỗi:", err.message);
  } finally {
    vps.close();
  }
}

main();
