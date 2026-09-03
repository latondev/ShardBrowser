const { chromium } = require("playwright");
const crypto = require("node:crypto");

const SIGNUP_URL = "https://tabitoken.com/sign-up?aff=rm5l";
const API_KEY_NAME = process.env.TABITOKEN_API_KEY_NAME || "Auto_API_Key_01";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function base32ToBuffer(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.replace(/[ =-]/g, "").toUpperCase();
  let bits = "";

  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

function totp(secret, time = Date.now()) {
  const counter = Math.floor(time / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = crypto
    .createHmac("sha1", base32ToBuffer(secret))
    .update(counterBuffer)
    .digest();

  const offset = digest[digest.length - 1] & 0x0f;

  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return String(code % 1000000).padStart(6, "0");
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return null;
}

async function completeGitHubLogin(page) {
  const email = required("TABITOKEN_GITHUB_EMAIL");
  const password = required("TABITOKEN_GITHUB_PASSWORD");
  const secret = required("TABITOKEN_GITHUB_TOTP_SECRET");

  const loginField = await firstVisible(page, [
    "#login_field",
    "input[name=login]",
  ]);

  if (loginField) {
    await loginField.fill(email);
    await page.locator("#password, input[name=password]").first().fill(password);
    await page.locator("input[type=submit], button[type=submit]").first().click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  const otpField = await firstVisible(page, [
    "input[name=app_otp]",
    "input[name=otp]",
    "input[autocomplete=one-time-code]",
    "input[inputmode=numeric]",
  ]);

  if (otpField) {
    await otpField.fill(totp(secret));
    await otpField.press("Enter");
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  const authorize = await firstVisible(page, [
    "button:has-text('Authorize')",
    "input[value*='Authorize']",
  ]);

  if (authorize) {
    await authorize.click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }
}

async function createApiKey(page) {
  await page.goto("https://tabitoken.com/keys", {
    waitUntil: "domcontentloaded",
  });

  await page
    .getByRole("button", { name: "Create API Key", exact: true })
    .click();

  await page
    .locator("[role=dialog] input[name=name]")
    .fill(API_KEY_NAME);

  await page
    .locator("[role=dialog]")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();

  await page
    .getByText(API_KEY_NAME, { exact: true })
    .first()
    .waitFor({ state: "visible" });

  return page.evaluate(async (name) => {
    const refreshResponse = await fetch("/api/user/auth/refresh", {
      method: "POST",
      credentials: "include",
    });

    const refresh = await refreshResponse.json();
    const accessToken = refresh.data?.access_token;

    if (!accessToken) {
      throw new Error("Could not refresh the Tabi Token session");
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };

    const listResponse = await fetch("/api/token/?p=1&size=100", {
      headers,
      credentials: "include",
    });

    const list = await listResponse.json();

    const item = (list.data?.items || [])
      .filter((entry) => entry.name === name)
      .sort(
        (a, b) =>
          (b.created_time || b.id || 0) -
          (a.created_time || a.id || 0)
      )[0];

    if (!item) {
      throw new Error("The newly created API key was not found");
    }

    const keyResponse = await fetch(`/api/token/${item.id}/key`, {
      method: "POST",
      headers,
      credentials: "include",
    });

    const key = await keyResponse.json();

    if (!key.success || !key.data?.key) {
      throw new Error("Could not retrieve the full API key");
    }

    return {
      account:
        refresh.data.user?.username ||
        refresh.data.user?.email ||
        "unknown",
      apiKey: `sk-${key.data.key}`,
    };
  }, API_KEY_NAME);
}

(async () => {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false",
  });

  try {
    const context = await browser.newContext({
      locale: "en-US",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const page = await context.newPage();

    await page.goto(SIGNUP_URL, {
      waitUntil: "domcontentloaded",
    });

    const popupPromise = context
      .waitForEvent("page", { timeout: 5000 })
      .catch(() => null);

    await page
      .getByRole("button", {
        name: /Continue with GitHub|Sign in with GitHub/i,
      })
      .click();

    const popup = await popupPromise;
    const authPage = popup || page;

    await authPage.waitForLoadState("domcontentloaded").catch(() => {});
    await completeGitHubLogin(authPage);

    await Promise.race([
      authPage.waitForURL(/tabitoken\.com/, { timeout: 60000 }),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);

    const appPage =
      context.pages().find((candidate) =>
        candidate.url().includes("tabitoken.com")
      ) || page;

    const result = await createApiKey(appPage);

    console.log(`success|${result.account}|${result.apiKey}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(`failed||${error.message}`);
  process.exitCode = 1;
});