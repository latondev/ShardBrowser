import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { ProxyXoayClient } from "./proxyxoay_client.js";

puppeteer.use(StealthPlugin());

async function testFlow() {
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

    console.log("1. Navigating to https://github.com/login...");
    await page.goto("https://github.com/login", { waitUntil: "networkidle2", timeout: 45000 });
    console.log("Login Page Title:", await page.title());

    console.log("2. Clicking 'Create an account' link...");
    const createAccountLink = await page.$("a[href*='/signup'], a[href*='join']");
    if (createAccountLink) {
      console.log("Found create account link! Clicking...");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
        createAccountLink.click()
      ]);
    } else {
      console.log("Direct goto /signup with referer...");
      await page.goto("https://github.com/signup?source=login", {
        referer: "https://github.com/login",
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
    }

    console.log("Current URL:", page.url());
    console.log("Title after navigation:", await page.title());

    await new Promise(r => setTimeout(r, 4000));

    const emailInput = await page.$("#email, input[type='email'], input[name='user[email]'], input[autocomplete='email']");
    console.log("Email Input Found:", !!emailInput);

    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 400) : "");
    console.log("Body text preview:", bodyText);
  } catch (err) {
    console.error("Lỗi:", err.message);
  } finally {
    await browser.close();
  }
}

testFlow();
