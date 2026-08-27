import puppeteer from "puppeteer-core";
import { ProxyXoayClient } from "./proxyxoay_client.js";

async function capture() {
  const px = new ProxyXoayClient();
  let proxy = null;
  try {
    proxy = await px.getNewProxy({ protocol: "http", forceWait: false });
  } catch (e) {
    console.log("Proxy error:", e.message);
  }

  const chromePath = "/root/.config/shardx-launcher/runtime/ShardX-Linux/chrome";
  const chromeArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1280,800",
    "--disable-blink-features=AutomationControlled"
  ];
  if (proxy) {
    chromeArgs.push(`--proxy-server=${proxy.proxyString}`);
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    args: chromeArgs,
    defaultViewport: { width: 1280, height: 800 }
  });

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36");

    console.log("Navigating to https://github.com/signup?source=login...");
    await page.goto("https://github.com/signup?source=login", {
      waitUntil: "networkidle2",
      timeout: 45000
    });

    console.log("URL:", page.url());
    console.log("Title:", await page.title());

    const html = await page.content();
    console.log("HTML length:", html.length);
    console.log("HTML snippet:", html.slice(0, 500));

    const bodyText = await page.evaluate(() => document.body ? document.body.innerText : "");
    console.log("\n--- BODY TEXT ---\n", bodyText);

    await page.screenshot({ path: "/root/DesployGit/bot/page_capture.png" });
    console.log("📸 Saved /root/DesployGit/bot/page_capture.png");
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    await browser.close();
  }
}

capture();
