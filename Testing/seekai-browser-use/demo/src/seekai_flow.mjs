import { getTotpCode } from "./totp.mjs"

const SIGNUP_URL = "https://seekai.cc/sign-up?aff=wChP"
const KEYS_URL = "https://seekai.cc/keys"

async function visible(locator) {
  return locator.isVisible().catch(() => false)
}

async function waitForGithubState(page) {
  const loginField = page.locator("#login_field")
  const totpField = page.locator("#app_totp")
  const passkeyPrompt = page.locator('form[action="/sessions/trusted-device/decline"]')

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const url = page.url()
    if (
      url.includes("seekai.cc") ||
      url.includes("github.com/login/oauth/authorize") ||
      (await visible(loginField)) ||
      (await visible(totpField)) ||
      (await visible(passkeyPrompt))
    ) {
      return
    }
    await page.waitForTimeout(250)
  }

  throw new Error(`Timed out waiting for GitHub authentication state: ${page.url()}`)
}

async function handleGithubLogin(page, config) {
  const loginField = page.locator("#login_field")
  if (!(await visible(loginField))) return

  await loginField.fill(config.githubLogin)
  await page.locator("#password").fill(config.githubPassword)
  await page.locator('button:has-text("Sign in"), input[type="submit"][value="Sign in"]').first().click()
  await page.waitForTimeout(1200)
}

async function handleGithubTotp(page, config) {
  const field = page.locator("#app_totp")

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await visible(field))) return

    await field.fill(getTotpCode(config.githubTotpSecret))
    await page.locator('button:has-text("Verify"), input[type="submit"][value="Verify"]').first().click()
    await page.waitForTimeout(1500)

    if (!(await visible(field))) return

    // Wait for the next 30-second window if GitHub rejected an expired code.
    await page.waitForTimeout((30 - (Math.floor(Date.now() / 1000) % 30)) * 1000 + 300)
  }

  throw new Error("GitHub TOTP was not accepted after three attempts")
}

async function declinePasskeyPrompt(page) {
  const askLater = page.locator(
    'form[action="/sessions/trusted-device/decline"] input[type="submit"][value="Ask me later"]',
  )
  if (await visible(askLater)) {
    await askLater.click()
    await page.waitForTimeout(1000)
  }
}

async function approveOauth(page, config) {
  const authorize = page.locator('button[name="authorize"][value="1"]')
  if (!page.url().includes("github.com/login/oauth/authorize")) return
  await authorize.waitFor({ state: "visible", timeout: 30000 })

  const body = await page.locator("body").innerText()
  if (
    config.githubExpectedUsername &&
    !body.toLowerCase().includes(config.githubExpectedUsername.toLowerCase())
  ) {
    throw new Error(
      `OAuth page does not show the expected GitHub account: ${config.githubExpectedUsername}`,
    )
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await authorize.isEnabled()) {
      await authorize.click()
      return
    }
    await page.waitForTimeout(500)
  }

  throw new Error("GitHub authorization button stayed disabled")
}

async function signInWithGithub(page, config) {
  await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded" })

  const githubButton = page.getByRole("button", { name: /Continue with GitHub/i })
  await githubButton.waitFor({ state: "visible", timeout: 30000 })

  const agreement = page.locator('input[type="checkbox"]').first()
  if ((await visible(agreement)) && !(await agreement.isChecked())) await agreement.check()

  await githubButton.click()
  await waitForGithubState(page)
  await handleGithubLogin(page, config)
  await waitForGithubState(page)
  await handleGithubTotp(page, config)
  await waitForGithubState(page)
  await declinePasskeyPrompt(page)
  await approveOauth(page, config)

  if (!page.url().includes("seekai.cc")) {
    await page.waitForURL((url) => url.toString().includes("seekai.cc"), { timeout: 30000 })
  }
}

async function createApiKey(page, context, config) {
  await page.goto(KEYS_URL, { waitUntil: "domcontentloaded" })

  await page.getByRole("button", { name: "Create API Key", exact: true }).click()
  const name = page.locator('input[name="name"]')
  await name.waitFor({ state: "visible", timeout: 10000 })
  await name.fill(config.keyName)
  await page.getByRole("button", { name: "Save changes", exact: true }).click()

  const row = page.locator("tr").filter({ hasText: config.keyName }).first()
  await row.waitFor({ state: "visible", timeout: 15000 })

  const reveal = row.locator('td[data-column-id="key"] button[data-slot="popover-trigger"]')
  await reveal.click()

  const keyInput = page.locator('[role="dialog"] input[readonly]').first()
  await keyInput.waitFor({ state: "visible", timeout: 5000 })
  const apiKey = await keyInput.inputValue()
  if (!/^sk-[A-Za-z0-9]+$/.test(apiKey)) throw new Error("Unexpected API key format")

  let copied = false
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "https://seekai.cc",
    })
    copied = await page.evaluate(async (value) => {
      await navigator.clipboard.writeText(value)
      return (await navigator.clipboard.readText()) === value
    }, apiKey)
  } catch {
    // Printing the key below remains the fallback if clipboard permissions are unavailable.
  }

  return {
    status: "success",
    github_account: config.githubExpectedUsername,
    api_key: apiKey,
    copied,
  }
}

export async function runSeekAiFlow(page, context, config) {
  await signInWithGithub(page, config)
  return createApiKey(page, context, config)
}
