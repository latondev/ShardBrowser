import puppeteer from "puppeteer";
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://wavespeed.ai";
const SIGN_IN_URL = `${BASE_URL}/sign-in?redirect=${encodeURIComponent(BASE_URL + "/")}`;
const PROFILE_DIR = process.env.PUPPETEER_PROFILE_DIR || path.resolve(".puppeteer-profile");
const KEY_NAME = process.env.WAVESPEED_KEY_NAME || "local-test-key";
const CREATE_KEY = process.argv.includes("--create-key");
const DETECTOR_TEST = process.argv.includes("--test-flagged-detector");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const restrictionPattern = /(?:this account is flagged[\s\S]{0,500}cannot authorize a third party application|cannot authorize a third party application)/i;

function detectGithubRestriction(text) {
  return restrictionPattern.test(text);
}

async function textOf(page) {
  return page.evaluate(() => document.body?.innerText || "");
}

async function saveScreenshot(page, filename) {
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: path.join("artifacts", filename), fullPage: true });
}

async function clickText(page, pattern) {
  const clicked = await page.evaluate((source) => {
    const re = new RegExp(source, "i");
    const element = [...document.querySelectorAll("button, input[type=submit], a")]
      .find((item) => re.test((item.innerText || item.value || item.textContent || "").trim()));
    if (!element) return false;
    element.click();
    return true;
  }, pattern.source);
  if (!clicked) throw new Error(`Could not find clickable text: ${pattern}`);
}

async function waitForGithubDecision(page, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    const text = await textOf(page);

    if (url.includes("github.com") && detectGithubRestriction(text)) {
      await saveScreenshot(page, "github-account-flagged.png");
      return { status: "BLOCKED_ACCOUNT_FLAGGED", url, reason: "GitHub blocked third-party OAuth authorization." };
    }

    if (/authorize wavespeedai/i.test(text) || url.includes("/login/oauth/authorize")) {
      return { status: "OAUTH_CONSENT", url };
    }

    if (url.includes("wavespeed.ai") && (url.includes("/center/default/github/callback") || /dashboard/i.test(text))) {
      return { status: "WAVESPEED_CALLBACK", url };
    }

    if (url.includes("/dashboard") && url.includes("github.com")) {
      return { status: "GITHUB_DASHBOARD", url, reason: "GitHub dashboard reached without an OAuth consent page." };
    }

    await sleep(1000);
  }
  return { status: "TIMEOUT", url: page.url(), reason: "Manual login or OAuth did not finish before timeout." };
}

async function createKey(page) {
  await page.goto(`${BASE_URL}/accesskey`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button', { timeout: 30000 });
  await clickText(page, /^create key$/);
  await page.waitForSelector('input[placeholder="Enter key name"]', { timeout: 10000 });
  await page.evaluate((name) => {
    const input = document.querySelector('input[placeholder="Enter key name"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, KEY_NAME);
  await clickText(page, /^create key$/);
  await page.waitForFunction(() => /copy and save this api key/i.test(document.body.innerText || ""), { timeout: 15000 });
  const key = await page.$eval("code", (element) => element.textContent.trim());
  console.log(JSON.stringify({ status: "API_KEY_CREATED", name: KEY_NAME, apiKey: key }, null, 2));
  console.warn("Save this key now. WaveSpeed will not show the full value again after confirmation.");
}

async function runDetectorTest() {
  const cases = [
    {
      name: "flagged account",
      text: "This account is flagged, and therefore cannot authorize a third party application.",
      expected: true,
    },
    {
      name: "normal OAuth consent",
      text: "Authorize WaveSpeedAI wants to access your account.",
      expected: false,
    },
  ];
  const results = cases.map((item) => ({ ...item, actual: detectGithubRestriction(item.text), pass: detectGithubRestriction(item.text) === item.expected }));
  console.table(results.map(({ name, expected, actual, pass }) => ({ name, expected, actual, pass })));
  if (results.some((item) => !item.pass)) process.exitCode = 1;
}

async function main() {
  if (DETECTOR_TEST) return runDetectorTest();

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: PROFILE_DIR,
    defaultViewport: null,
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  try {
    await page.goto(SIGN_IN_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('button[aria-label="Sign in with GitHub"]', { timeout: 30000 });
    await page.click('button[aria-label="Sign in with GitHub"]');

    console.log("If GitHub asks for login or 2FA, complete it manually in the browser window.");
    const decision = await waitForGithubDecision(page);
    console.log(JSON.stringify(decision, null, 2));

    if (decision.status === "BLOCKED_ACCOUNT_FLAGGED") {
      console.error("STOP: do not retry or bypass this restriction. Use GitHub's account support flow.");
      process.exitCode = 2;
      return;
    }
    if (!["OAUTH_CONSENT", "WAVESPEED_CALLBACK"].includes(decision.status)) {
      process.exitCode = 3;
      return;
    }

    if (decision.status === "OAUTH_CONSENT") await clickText(page, /^authorize wavespeedai$/);
    await page.waitForFunction(() => location.hostname === "wavespeed.ai" && /dashboard/i.test(document.body.innerText || ""), { timeout: 45000 });
    console.log(JSON.stringify({ status: "WAVESPEED_LOGIN_OK", url: page.url() }, null, 2));

    if (CREATE_KEY) await createKey(page);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
