import axios from "axios";
import puppeteer from "puppeteer-core";

const LAUNCHER_API_URL = "http://127.0.0.1:40325";
const LAUNCHER_API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaGFyZHgtYXBpIiwiaWF0IjoxNzg3MTI4NjE5LCJleHAiOjIxMDI0ODg2MTl9.Y44-0maSpd_9e7_U3yLPHgvFb1O2_GBHReb6qs0H2p0";
const headers = { Authorization: `Bearer ${LAUNCHER_API_TOKEN}` };

async function debugSlider() {
  console.log("1. Kết nối tới ShardX Launcher...");
  const { data: fpRes } = await axios.get(`${LAUNCHER_API_URL}/fingerprint/new`, { headers, timeout: 4000 });
  const { data: createdProfile } = await axios.post(`${LAUNCHER_API_URL}/profiles`, {
    name: `Debug-Slider-${Date.now().toString().slice(-4)}`,
    notes: "Debug Slider Profile",
    fingerprint: fpRes.fingerprint,
  }, { headers });

  const profileId = createdProfile.id;
  const { data: startRes } = await axios.post(`${LAUNCHER_API_URL}/profiles/${profileId}/start`, { headless: false }, { headers });
  const wsUrl = startRes.cdp?.web_socket_debugger_url;

  const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
  
  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    console.log("2. Điều hướng tới https://github.com/...");
    await page.goto("https://github.com/", { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 2000));

    console.log("3. Bấm Sign up...");
    await page.evaluate(() => {
      const btn = document.querySelector("a[href*='/signup'], .HeaderMenu-link--sign-up");
      if (btn) btn.click();
    });

    await new Promise(r => setTimeout(r, 3000));
    console.log("Current URL:", page.url());

    // Dump all frames
    const frames = page.frames();
    console.log(`Tìm thấy ${frames.length} frames.`);

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      try {
        const frameInfo = await f.evaluate(() => {
          const bodyText = document.body ? document.body.innerText.slice(0, 300) : "";
          const htmlSnippet = document.body ? document.body.innerHTML.slice(0, 500) : "";
          const buttons = Array.from(document.querySelectorAll("button, [role='slider'], div")).map(el => {
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              cls: el.className,
              id: el.id,
              text: (el.innerText || "").trim().slice(0, 40),
              rect: { x: r.x, y: r.y, w: r.width, h: r.height },
            };
          }).filter(b => b.rect.w > 20 && b.rect.h > 20 && b.rect.w < 350);
          return { bodyText, buttons: buttons.slice(0, 15), url: location.href };
        });
        console.log(`\n--- FRAME #${i} (${frameInfo.url}) ---`);
        console.log("Text:", frameInfo.bodyText.replace(/\n+/g, " "));
        console.log("Buttons/Elements:", JSON.stringify(frameInfo.buttons, null, 2));
      } catch (e) {
        console.log(`Frame #${i} error:`, e.message);
      }
    }
  } finally {
    console.log("4. Dọn dẹp...");
    await axios.post(`${LAUNCHER_API_URL}/profiles/${profileId}/stop`, {}, { headers }).catch(() => {});
    await browser.disconnect().catch(() => {});
  }
}

debugSlider().catch(console.error);
