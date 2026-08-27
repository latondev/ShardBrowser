import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

async function testProfile() {
  const chromeArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--window-size=1366,768",
    "--user-data-dir=/root/chrome-test-profile"
  ];

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: false,
    args: chromeArgs,
    defaultViewport: { width: 1366, height: 768 }
  });

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");

    console.log("1. Goto github homepage...");
    await page.goto("https://github.com", { waitUntil: "networkidle2", timeout: 45000 });
    console.log("Home Title:", await page.title());

    console.log("2. Goto github signup...");
    const res = await page.goto("https://github.com/signup", {
      referer: "https://github.com/",
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    console.log("Signup Status:", res ? res.status() : "N/A");
    console.log("Current URL:", page.url());
    console.log("Signup Title:", await page.title());

    await new Promise(r => setTimeout(r, 4000));
    const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : "");
    console.log("Body preview:", body);

    const emailInput = await page.$("#email, input[type='email'], input[name='user[email]']");
    console.log("Email Input:", !!emailInput);
  } catch (e) {
    console.error("Lỗi:", e.message);
  } finally {
    await browser.close();
  }
}

testProfile();
