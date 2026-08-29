import { test, expect } from "@playwright/test"
import { getTotpCode } from "../src/totp.mjs"

const SIGNUP_URL = "https://seekai.cc/sign-up?aff=wChP"
const KEYS_URL = "https://seekai.cc/keys"
const TOTP_URL = "https://2fa.co.com/"

function env(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

async function visible(locator) {
  return locator.isVisible().catch(() => false)
}

async function waitForGithubState(page) {
  const selectors = [
    page.locator("#login_field"),
    page.locator("#app_totp"),
    page.locator('form[action="/sessions/trusted-device/decline"]'),
  ]

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const url = page.url()
    const states = await Promise.all(selectors.map((selector) => visible(selector)))
    if (
      url.includes("seekai.cc") ||
      url.includes("github.com/login/oauth/authorize") ||
      states.some(Boolean)
    ) {
      return
    }
    await page.waitForTimeout(250)
  }

  throw new Error(`Timed out waiting for GitHub state: ${page.url()}`)
}

async function readOtpFromWebsite(context, secret) {
  const otpPage = await context.newPage()
  try {
    await otpPage.goto(TOTP_URL, { waitUntil: "domcontentloaded" })
    const secretField = otpPage.locator("#secretKey")
    await secretField.waitFor({ state: "visible", timeout: 30000 })
    await secretField.fill(secret)

    const output = otpPage.locator("#totp-output")
    await output.waitFor({ state: "visible", timeout: 10000 })
    const code = (await output.textContent()).replace(/[^0-9]/g, "")
    if (code.length !== 6) throw new Error("2FA website did not produce a 6-digit code")
    return code
  } finally {
    await otpPage.close()
  }
}

async function getOtp(context, secret) {
  if ((process.env.TOTP_SOURCE || "local").trim().toLowerCase() === "site") {
    return readOtpFromWebsite(context, secret)
  }
  return getTotpCode(secret)
}

async function loginGithub(page, context, login, password, totpSecret) {
  const loginField = page.locator("#login_field")
  if (await visible(loginField)) {
    await loginField.fill(login)
    await page.locator("#password").fill(password)
    await page.locator('button:has-text("Sign in"), input[type="submit"][value="Sign in"]').first().click()
    await waitForGithubState(page)
  }

  const otpField = page.locator("#app_totp")
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await visible(otpField))) return

    await otpField.fill(await getOtp(context, totpSecret))
    await page.locator('button:has-text("Verify"), input[type="submit"][value="Verify"]').first().click()
    await page.waitForTimeout(1500)

    if (!(await visible(otpField))) return
    await page.waitForTimeout((30 - (Math.floor(Date.now() / 1000) % 30)) * 1000 + 300)
  }

  throw new Error("GitHub TOTP was not accepted after three attempts")
}

async function declinePasskey(page) {
  const askLater = page.locator(
    'form[action="/sessions/trusted-device/decline"] input[type="submit"][value="Ask me later"]',
  )
  if (await visible(askLater)) await askLater.click()
}

async function authorizeGithub(page, expectedUsername) {
  if (!page.url().includes("github.com/login/oauth/authorize")) return

  const authorize = page.locator('button[name="authorize"][value="1"]')
  await authorize.waitFor({ state: "visible", timeout: 30000 })
  const body = (await page.locator("body").innerText()).toLowerCase()
  expect(body).toContain(expectedUsername.toLowerCase())

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await authorize.isEnabled()) {
      await authorize.click()
      return
    }
    await page.waitForTimeout(500)
  }

  throw new Error("GitHub authorization button stayed disabled")
}

test("SeekAI: GitHub OAuth, 2FA, and API key creation", async ({ browser }) => {
  const login = env("GITHUB_LOGIN")
  const password = env("GITHUB_PASSWORD")
  const totpSecret = env("GITHUB_TOTP_SECRET")
  const expectedUsername = env("GITHUB_EXPECTED_USERNAME")
  const keyName = process.env.SEEKAI_API_KEY_NAME?.trim() || "Auto_API_Key_01"
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await test.step("1. Open SeekAI signup", async () => {
      await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded" })
      await page.getByRole("button", { name: /Continue with GitHub/i }).waitFor({ state: "visible" })
    })

    await test.step("2. Start GitHub OAuth", async () => {
      const agreement = page.locator('input[type="checkbox"]').first()
      if ((await visible(agreement)) && !(await agreement.isChecked())) await agreement.check()
      await page.getByRole("button", { name: /Continue with GitHub/i }).click()
      await waitForGithubState(page)
    })

    await test.step("3. Sign in to GitHub", async () => {
      await loginGithub(page, context, login, password, totpSecret)
      await waitForGithubState(page)
      await declinePasskey(page)
      await authorizeGithub(page, expectedUsername)
    })

    await test.step("4. Open API Keys", async () => {
      await page.waitForURL((url) => url.toString().includes("seekai.cc"), { timeout: 30000 })
      await page.goto(KEYS_URL, { waitUntil: "domcontentloaded" })
    })

    let apiKey
    let copied = false
    await test.step("5. Create and copy API key", async () => {
      await page.getByRole("button", { name: "Create API Key", exact: true }).click()
      await page.locator('input[name="name"]').fill(keyName)
      await page.getByRole("button", { name: "Save changes", exact: true }).click()

      const row = page.locator("tr").filter({ hasText: keyName }).first()
      await row.waitFor({ state: "visible", timeout: 15000 })
      await row.locator('td[data-column-id="key"] button[data-slot="popover-trigger"]').click()

      const keyInput = page.locator('[role="dialog"] input[readonly]').first()
      await keyInput.waitFor({ state: "visible", timeout: 5000 })
      apiKey = await keyInput.inputValue()
      expect(apiKey).toMatch(/^sk-[A-Za-z0-9]+$/)

      try {
        await context.grantPermissions(["clipboard-read", "clipboard-write"], {
          origin: "https://seekai.cc",
        })
        copied = await page.evaluate(async (value) => {
          await navigator.clipboard.writeText(value)
          return (await navigator.clipboard.readText()) === value
        }, apiKey)
      } catch {
        copied = false
      }
    })

    console.log(JSON.stringify({
      status: "success",
      github_account: expectedUsername,
      api_key: apiKey,
      copied,
    }))
  } finally {
    await context.close()
  }
})
