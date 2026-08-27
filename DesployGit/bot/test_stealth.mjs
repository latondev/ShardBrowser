import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { ProxyXoayClient } from "./proxyxoay_client.js";

puppeteer.use(StealthPlugin());

async function testStealth() {
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
    "--window-size=1280,800"
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

    console.log("Navigating to https://github.com/signup?source=login with Stealth...");
    const res = await page.goto("https://github.com/signup?source=login", {
      waitUntil: "networkidle2",
      timeout: 45000
    });

    console.log("Status Code:", res ? res.status() : "N/A");
    console.log("Current URL:", page.url());
    console.log("Title:", await page.title());

    const emailInput = await page.$("#email, input[type='email'], input[name='user[email]']");
    console.log("Email Input Found:", !!emailInput);

    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : "");
    console.log("Body text preview:", bodyText);
  } catch (err) {
    console.error("Lỗi:", err.message);
  } finally {
    await browser.close();
  }
}

testStealth();
