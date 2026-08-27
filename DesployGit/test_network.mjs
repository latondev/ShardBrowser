import { VpsManager } from "./vps_manager.mjs";

async function testNetwork() {
  const vps = new VpsManager({ host: "180.93.115.138", username: "root", password: "uN0%lfIHjilk" });
  await vps.connect();
  console.log("--- DIRECT IP CURL ---");
  await vps.execCommand("curl -s -o /dev/null -w 'Direct signup status: %{http_code}\\n' https://github.com/signup");
  await vps.execCommand("curl -s -o /dev/null -w 'Direct login status: %{http_code}\\n' https://github.com/login");
  
  console.log("--- PROXY CURL ---");
  await vps.execCommand("curl -s -x http://160.250.166.23:10967 -o /dev/null -w 'Proxy signup status: %{http_code}\\n' https://github.com/signup");
  vps.close();
}

testNetwork();
