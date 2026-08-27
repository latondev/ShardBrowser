import puppeteer from "puppeteer-core";
import { ProxyXoayClient } from "./proxyxoay_client.js";
import { existsSync, writeFileSync } from "node:fs";

async function debugSignup() {
  const px = new ProxyXoayClient();
  let proxy = null;
  try {
    proxy = await px.getNewProxy({ protocol: "http", forceWait: false });
    console.log("Proxy:", proxy.proxyString);
  } catch (e) {
    console.log("No proxy:", e.message);
  }

  const chromeArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--window-size=1280,800",
    "--disable-blink-features=AutomationControlled"
  ];
  if (proxy) {
    const proxyArg = proxy.proxyString ? proxy.proxyString.replace(/^https?:\/\//i, "") : `${proxy.host}:${proxy.port}`;
    chromeArgs.push(`--proxy-server=http://${proxyArg}`);
  }

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: false,
    args: chromeArgs,
    defaultViewport: { width: 1280, height: 800 }
  });

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    
    // Set realistic User-Agent
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,vi;q=0.8"
    });

    console.log("Navigating to https://github.com/signup?source=login...");
    const res = await page.goto("https://github.com/signup?source=login", {
      waitUntil: "networkidle2",
      timeout: 45000
    });

    console.log("Status Code:", res ? res.status() : "N/A");
    console.log("Current URL:", page.url());
    console.log("Title:", await page.title());

    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 500) : "");
    console.log("\n--- BODY TEXT ---");
    console.log(bodyText);

    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input, button, iframe, form")).map(el => ({
        tag: el.tagName,
        id: el.id,
        name: el.getAttribute("name"),
        type: el.getAttribute("type"),
        class: el.className,
        text: el.innerText
      }));
    });
    console.log("\n--- INPUTS / BUTTONS FOUND ---");
    console.log(JSON.stringify(inputs, null, 2));

    await page.screenshot({ path: "debug_signup.png" });
    console.log("📸 Saved screenshot: debug_signup.png");
  } catch (err) {
    console.error("Lỗi:", err.message);
  } finally {
    await browser.close();
  }
}

debugSignup();
