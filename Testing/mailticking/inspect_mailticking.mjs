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

async function inspectMailTicking() {
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
    // 3. Start profile
    const { data: startRes } = await axios.post(`${config.url}/profiles/${profile.id}/start`, { headless: false }, { headers: config.headers });
    const wsUrl = startRes.cdp?.web_socket_debugger_url;
    console.log("CDP WS URL:", wsUrl);

    // 4. Connect puppeteer
    const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
    const page = (await browser.pages())[0] || (await browser.newPage());

    const networkLogs = [];

    // Intercept network requests
    page.on("request", (req) => {
      const url = req.url();
      if (!url.endsWith(".png") && !url.endsWith(".jpg") && !url.endsWith(".svg") && !url.endsWith(".css") && !url.includes("google-analytics") && !url.includes("googletagmanager")) {
        networkLogs.push({
          type: "REQUEST",
          method: req.method(),
          url: req.url(),
          headers: req.headers(),
          postData: req.postData(),
        });
      }
    });

    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("/api") || url.includes("mail") || res.request().resourceType() === "xhr" || res.request().resourceType() === "fetch") {
        try {
          const text = await res.text();
          networkLogs.push({
            type: "RESPONSE",
            status: res.status(),
            url: res.url(),
            headers: res.headers(),
            body: text.slice(0, 1000),
          });
        } catch {}
      }
    });

    console.log("Navigating to https://www.mailticking.com/...");
    await page.goto("https://www.mailticking.com/", { waitUntil: "networkidle2", timeout: 60000 });

    console.log("Waiting 10s for page to settle and API requests to fire...");
    await new Promise((r) => setTimeout(r, 10000));

    // Inspect DOM
    const domInfo = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input")).map(i => ({ id: i.id, className: i.className, value: i.value, placeholder: i.placeholder }));
      const buttons = Array.from(document.querySelectorAll("button, a")).map(b => ({ tag: b.tagName, id: b.id, text: b.innerText?.trim(), className: b.className }));
      const allText = document.body.innerText;
      
      // Look for email pattern
      const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);

      return {
        url: window.location.href,
        inputs,
        buttons: buttons.slice(0, 30),
        foundEmails: emailMatch,
        bodyTextSnippet: allText.slice(0, 1000),
      };
    });

    const result = {
      domInfo,
      networkLogs: networkLogs.filter(n => n.url.includes("mailticking") || n.url.includes("api")),
    };

    fs.mkdirSync(path.join(process.cwd(), "Testing", "mailticking"), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), "Testing", "mailticking", "analysis.json"), JSON.stringify(result, null, 2));
    console.log("Analysis saved to Testing/mailticking/analysis.json");
    console.log("DOM Info:", JSON.stringify(domInfo, null, 2));

    await browser.disconnect();
  } finally {
    // Stop & destroy profile
    await axios.post(`${config.url}/profiles/${profile.id}/stop`, {}, { headers: config.headers }).catch(() => {});
    await axios.delete(`${config.url}/profiles/${profile.id}`, { headers: config.headers }).catch(() => {});
    console.log("Cleaned up profile.");
  }
}

inspectMailTicking().catch(console.error);
