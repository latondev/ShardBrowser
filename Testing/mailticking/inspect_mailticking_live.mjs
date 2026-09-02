import axios from "axios";
import puppeteer from "puppeteer-core";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function loadShardConfig() {
  const homeDir = os.homedir();
  const candidateSettings = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "settings.json") : null,
    path.join(homeDir, ".config", "shardx-launcher", "settings.json"),
    path.join(homeDir, "AppData", "Roaming", "shardx-launcher", "settings.json")
  ].filter(Boolean);

  for (const p of candidateSettings) {
    if (fs.existsSync(p)) {
      try {
        const settings = JSON.parse(fs.readFileSync(p, "utf-8"));
        const port = settings.api_port || 40325;
        const secret = settings.api_secret || "";
        let token = "";
        if (secret) {
          const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "HS256" })).toString("base64url");
          const now = Math.floor(Date.now() / 1000);
          const payload = Buffer.from(JSON.stringify({ sub: "shardx-api", iat: now, exp: now + 86400 * 30 })).toString("base64url");
          const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest().toString("base64url");
          token = `${header}.${payload}.${sig}`;
        }
        return { url: `http://127.0.0.1:${port}`, headers: { Authorization: `Bearer ${token}` } };
      } catch {}
    }
  }
  return { url: "http://127.0.0.1:40325", headers: {} };
}

async function inspectLive() {
  const config = loadShardConfig();
  console.log("Connecting to ShardBrowser at:", config.url);

  // 1. Get new Windows fingerprint
  const { data: fpRes } = await axios.get(`${config.url}/fingerprint/new/windows`, { headers: config.headers });

  // 2. Create temp profile
  const { data: profile } = await axios.post(`${config.url}/profiles`, {
    name: "INSPECT-MAILTICKING",
    folder: "Testing",
    fingerprint: fpRes.fingerprint,
  }, { headers: config.headers });

  console.log("Created Profile:", profile.id);

  try {
    // 3. Start profile (non-headless)
    const { data: startRes } = await axios.post(`${config.url}/profiles/${profile.id}/start`, { headless: false }, { headers: config.headers });
    const wsUrl = startRes.cdp?.web_socket_debugger_url;
    console.log("CDP WS URL:", wsUrl);

    const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
    const page = (await browser.pages())[0] || (await browser.newPage());

    const apiRequests = [];
    const allRequests = [];

    page.on("request", (req) => {
      allRequests.push({ url: req.url(), method: req.method() });
      if (req.url().includes("/api") || req.url().includes("mail") || req.url().includes("inbox") || req.url().includes("message") || req.url().includes("v1") || req.url().includes("v2")) {
        apiRequests.push({
          type: "REQ",
          url: req.url(),
          method: req.method(),
          headers: req.headers(),
          postData: req.postData(),
        });
      }
    });

    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("/api") || url.includes("mail") || url.includes("inbox") || url.includes("message") || url.includes("v1") || url.includes("v2") || res.request().resourceType() === "xhr" || res.request().resourceType() === "fetch") {
        try {
          const body = await res.text();
          apiRequests.push({
            type: "RES",
            status: res.status(),
            url: res.url(),
            headers: res.headers(),
            body: body.slice(0, 2000),
          });
        } catch {}
      }
    });

    console.log("Navigating to https://www.mailticking.com/...");
    await page.goto("https://www.mailticking.com/", { waitUntil: "domcontentloaded", timeout: 60000 });

    console.log("Waiting for Cloudflare verification or page load (up to 30s)...");
    
    // Polling until cloudflare is passed or timeout
    const startTime = Date.now();
    let passed = false;

    while (Date.now() - startTime < 35000) {
      const isCf = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : "";
        return text.includes("Cloudflare") || text.includes("xác minh bạn không phải là bot") || text.includes("Verifying you are human");
      }).catch(() => true);

      if (!isCf) {
        passed = true;
        console.log("✅ Cloudflare passed!");
        break;
      }

      // Try to click Turnstile iframe / checkbox if visible
      try {
        const frames = page.frames();
        for (const frame of frames) {
          const box = await frame.$("input[type='checkbox'], .cb-c, #challenge-stage, .ctp-checkbox-label");
          if (box) {
            console.log("Clicking Cloudflare checkbox...");
            await box.click();
            break;
          }
        }
      } catch {}

      await new Promise((r) => setTimeout(r, 2000));
    }

    // Wait another 5 seconds for mailticking frontend to generate email
    await new Promise((r) => setTimeout(r, 6000));

    // Try interacting with MailTicking buttons (Change email, Copy, Refresh)
    const pageData = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button, a, input")).map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className,
        text: (el.innerText || el.value || "").trim(),
        href: el.getAttribute("href"),
        onclick: el.getAttribute("onclick"),
      }));

      const emailInputs = Array.from(document.querySelectorAll("input[type='text'], input[readonly], #email, .email-input")).map(i => i.value);
      const scripts = Array.from(document.querySelectorAll("script[src]")).map(s => s.src);

      return {
        url: window.location.href,
        title: document.title,
        bodySnippet: document.body.innerText.slice(0, 1500),
        buttons,
        emailInputs,
        scripts,
      };
    });

    console.log("Page Title:", pageData.title);
    console.log("Body Snippet:\n", pageData.bodySnippet);
    console.log("Email Inputs:", pageData.emailInputs);
    console.log("API Requests Captured:", apiRequests.length);

    fs.mkdirSync(path.join(process.cwd(), "Testing", "mailticking"), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), "Testing", "mailticking", "full_inspection.json"), JSON.stringify({ pageData, apiRequests, allRequests }, null, 2));

    await browser.disconnect();
  } finally {
    await axios.post(`${config.url}/profiles/${profile.id}/stop`, {}, { headers: config.headers }).catch(() => {});
    await axios.delete(`${config.url}/profiles/${profile.id}`, { headers: config.headers }).catch(() => {});
  }
}

inspectLive().catch(console.error);
