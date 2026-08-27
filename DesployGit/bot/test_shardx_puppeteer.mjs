import puppeteer from "puppeteer-core";
import axios from "axios";

async function getWorkingProxy() {
  const key = "IaFVANxqBlxITSiAkJpGrG";
  const url = `https://proxyxoay.shop/api/get.php?key=${key}&nhamang=random&tinhthanh=0&whitelist=`;
  
  for (let attempt = 1; attempt <= 10; attempt++) {
    const res = await axios.get(url, { timeout: 15000 });
    const data = res.data;
    if (data.status === 100 || data.proxyhttp) {
      const raw = data.proxyhttp || data.proxysocks5;
      if (raw) {
        const clean = raw.split("::")[0].trim();
        return `http://${clean}`;
      }
    }
    if (data.status === 101) {
      const waitMatch = (data.message || "").match(/(\d+)\s*s/i);
      const sec = waitMatch ? parseInt(waitMatch[1], 10) + 2 : 10;
      console.log(`⏳ Đợi ${sec}s để xoay IP...`);
      await new Promise(r => setTimeout(r, sec * 1000));
    } else {
      await new Promise(r => setTimeout(r, 4000));
    }
  }
  return null;
}

async function testShardX() {
  const proxy = await getWorkingProxy();
  console.log("Using Proxy:", proxy);

  const chromePath = "/root/.config/shardx-launcher/runtime/ShardX-Linux/chrome";
  const chromeArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1280,800",
    "--user-data-dir=/root/shardx-test-profile",
    "--disable-blink-features=AutomationControlled"
  ];

  if (proxy) {
    chromeArgs.push(`--proxy-server=${proxy}`);
  }

  console.log("Launching ShardX Custom Antidetect Browser...");
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    args: chromeArgs,
    defaultViewport: { width: 1280, height: 800 }
  });

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());

    console.log("Navigating to https://github.com/signup?source=login with ShardX...");
    const res = await page.goto("https://github.com/signup?source=login", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    console.log("Status Code:", res ? res.status() : "N/A");
    console.log("Page URL:", page.url());
    console.log("Page Title:", await page.title());

    await new Promise(r => setTimeout(r, 6000));

    const emailInput = await page.$("#email, input[type='email'], input[name='user[email]'], input[autocomplete='email']");
    console.log("🎯 Email Input Found:", !!emailInput);

    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : "");
    console.log("Body preview:", bodyText);
  } catch (err) {
    console.error("Lỗi:", err.message);
  } finally {
    await browser.close();
  }
}

testShardX();
