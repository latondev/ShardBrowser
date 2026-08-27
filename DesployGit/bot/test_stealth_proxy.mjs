import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import axios from "axios";

puppeteer.use(StealthPlugin());

async function getWorkingProxy() {
  const key = "IaFVANxqBlxITSiAkJpGrG";
  const url = `https://proxyxoay.shop/api/get.php?key=${key}&nhamang=random&tinhthanh=0&whitelist=`;
  
  for (let attempt = 1; attempt <= 15; attempt++) {
    console.log(`[ProxyXoay] Đang lấy proxy (lần thử ${attempt}/15)...`);
    const res = await axios.get(url, { timeout: 15000 });
    const data = res.data;
    console.log("ProxyXoay API response:", data);
    
    if (data.status === 100 || data.proxyhttp) {
      const raw = data.proxyhttp || data.proxysocks5;
      if (raw) {
        const clean = raw.split("::")[0].trim();
        const [host, port] = clean.split(":");
        return { proxyString: `http://${clean}`, host, port };
      }
    }

    if (data.status === 101) {
      const waitMatch = (data.message || "").match(/(\d+)\s*s/i);
      const sec = waitMatch ? parseInt(waitMatch[1], 10) + 2 : 10;
      console.log(`⏳ Đợi ${sec}s để xoay IP mới...`);
      await new Promise(r => setTimeout(r, sec * 1000));
    } else {
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  throw new Error("Không lấy được proxy sau 15 lần thử");
}

async function test() {
  const proxy = await getWorkingProxy();
  console.log("✅ Proxy đã sẵn sàng:", proxy.proxyString);

  const chromeArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--window-size=1280,800",
    `--proxy-server=${proxy.proxyString}`
  ];

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: false,
    args: chromeArgs,
    defaultViewport: { width: 1280, height: 800 }
  });

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,vi;q=0.8"
    });

    console.log("Navigating to https://github.com/signup?source=login with Stealth + Proxy...");
    const res = await page.goto("https://github.com/signup?source=login", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    console.log("Status Code:", res ? res.status() : "N/A");
    console.log("Current URL:", page.url());
    console.log("Title:", await page.title());

    await new Promise(r => setTimeout(r, 5000));

    const emailInput = await page.$("#email, input[type='email'], input[name='user[email]'], input[autocomplete='email']");
    console.log("🎯 Email Input Found:", !!emailInput);

    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 400) : "");
    console.log("Body text preview:", bodyText);
  } catch (err) {
    console.error("Lỗi:", err.message);
  } finally {
    await browser.close();
  }
}

test();
