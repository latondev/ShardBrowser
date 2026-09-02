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

async function solveAndInspect() {
  const config = loadShardConfig();
  const { data: fpRes } = await axios.get(`${config.url}/fingerprint/new/windows`, { headers: config.headers });
  const { data: profile } = await axios.post(`${config.url}/profiles`, {
    name: "SOLVE-MAILTICKING",
    folder: "Testing",
    fingerprint: fpRes.fingerprint,
  }, { headers: config.headers });

  try {
    const { data: startRes } = await axios.post(`${config.url}/profiles/${profile.id}/start`, { headless: false }, { headers: config.headers });
    const browser = await puppeteer.connect({ browserWSEndpoint: startRes.cdp.web_socket_debugger_url, defaultViewport: null });
    const page = (await browser.pages())[0] || (await browser.newPage());

    const apiLogs = [];
    page.on("request", (r) => {
      const u = r.url();
      if (!u.includes("cloudflare") && !u.includes("google") && !u.endsWith(".png") && !u.endsWith(".css") && !u.endsWith(".ico")) {
        apiLogs.push({ type: "REQ", method: r.method(), url: u, postData: r.postData(), headers: r.headers() });
      }
    });

    page.on("response", async (r) => {
      const u = r.url();
      if (!u.includes("cloudflare") && !u.includes("google") && (r.request().resourceType() === "xhr" || r.request().resourceType() === "fetch" || u.includes("api") || u.includes("mail"))) {
        try {
          const t = await r.text();
          apiLogs.push({ type: "RES", status: r.status(), url: u, body: t.slice(0, 3000) });
        } catch {}
      }
    });

    console.log("Navigating to https://www.mailticking.com/...");
    await page.goto("https://www.mailticking.com/", { waitUntil: "domcontentloaded", timeout: 60000 });

    console.log("Looking for Turnstile widget on screen...");
    await new Promise((r) => setTimeout(r, 4000));

    // Try finding the iframe or checkbox
    for (let attempt = 0; attempt < 10; attempt++) {
      const isStillCf = await page.evaluate(() => {
        return document.title.includes("Just a moment") || document.title.includes("Chờ một chút") || (document.body?.innerText || "").includes("Ray ID");
      }).catch(() => false);

      if (!isStillCf) {
        console.log("✅ Passed Cloudflare! On real MailTicking page!");
        break;
      }

      console.log(`[Attempt ${attempt + 1}] Trying to click Turnstile checkbox...`);
      // Try to click checkbox inside iframe
      for (const frame of page.frames()) {
        try {
          const box = await frame.$("input[type='checkbox'], #challenge-stage, .ctp-checkbox-label");
          if (box) {
            const b = await box.boundingBox();
            if (b) {
              console.log("Clicking box at:", b);
              await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
            }
          }
        } catch {}
      }

      // Also try clicking central coordinates of turnstile container
      try {
        const widget = await page.$("iframe[src*='challenges.cloudflare.com'], #cf-turnstile, .cf-turnstile");
        if (widget) {
          const rect = await widget.boundingBox();
          if (rect) {
            console.log("Clicking Turnstile iframe at:", rect.x + 30, rect.y + rect.height / 2);
            await page.mouse.click(rect.x + 30, rect.y + rect.height / 2);
          }
        }
      } catch {}

      await new Promise((r) => setTimeout(r, 3000));
    }

    console.log("Waiting 10s on page to capture MailTicking mailbox generation...");
    await new Promise((r) => setTimeout(r, 10000));

    const finalHtml = await page.evaluate(() => {
      const emailInputs = Array.from(document.querySelectorAll("input, span, div, h1, h2, h3, p"))
        .map(el => (el.innerText || (el instanceof HTMLInputElement ? el.value : "") || "").trim())
        .filter(t => /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(t));
      
      const elements = Array.from(document.querySelectorAll("button, a, input, select, table, .inbox, .email, [role='button']")).map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className,
        text: (el.innerText || (el instanceof HTMLInputElement ? el.value : "") || "").trim().slice(0, 100),
      }));

      return {
        title: document.title,
        url: window.location.href,
        foundEmails: [...new Set(emailInputs)],
        elements: elements.slice(0, 50),
        bodySnippet: document.body.innerText.slice(0, 2000),
      };
    });

    console.log("Final Page Result:", JSON.stringify(finalHtml, null, 2));
    fs.writeFileSync(path.join(process.cwd(), "Testing", "mailticking", "resolved_api_logs.json"), JSON.stringify({ finalHtml, apiLogs }, null, 2));
    console.log("Saved to Testing/mailticking/resolved_api_logs.json");

    await browser.disconnect();
  } finally {
    await axios.post(`${config.url}/profiles/${profile.id}/stop`, {}, { headers: config.headers }).catch(() => {});
    await axios.delete(`${config.url}/profiles/${profile.id}`, { headers: config.headers }).catch(() => {});
  }
}

solveAndInspect().catch(console.error);
