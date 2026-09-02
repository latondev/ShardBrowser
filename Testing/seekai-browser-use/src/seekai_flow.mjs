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
    'button:has-text("Ask me later"), a:has-text("Ask me later"), input[value="Ask me later"], form[action*="decline"] button, form[action*="decline"] input[type="submit"], button:has-text("Not now")',
  )
  if (page.url().includes("github.com/sessions/trusted-device") || (await visible(askLater.first()))) {
    try {
      await askLater.first().click({ timeout: 5000 })
      await page.waitForTimeout(1000)
    } catch {}
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

  const githubButton = page.getByRole("button", { name: /(Continue with GitHub|Tiếp tục với GitHub|GitHub)/i }).first()
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
  const keysTab = page.locator('a[href*="/keys"], a[href*="keys"], button:has-text("API Keys"), [role="tab"]:has-text("API Keys"), a:has-text("API Keys"), button:has-text("API Key"), a:has-text("API Key")').first()
  if (await visible(keysTab)) {
    await keysTab.click()
    await page.waitForTimeout(1500)
  } else {
    await page.goto(KEYS_URL, { waitUntil: "domcontentloaded" })
  }

  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "https://seekai.cc",
    })
  } catch {}

  await page.getByRole("button", { name: /(Create API Key|Tạo khóa API|Tạo API Key|Add Key|Thêm khóa)/i }).first().click()
  const drawer = page.locator('[role="dialog"], [data-state="open"]').first()
  await drawer.waitFor({ state: "visible", timeout: 10000 })
  await drawer.locator('input:not([type="hidden"]):not([type="checkbox"])').first().fill(config.keyName)
  await drawer.getByRole("button", { name: /(Tạo|Lưu thay đổi|Lưu|Save|Create|Confirm|Xác nhận)/i }).first().click()

  const row = page.locator("tr").filter({ hasText: config.keyName }).first()
  await row.waitFor({ state: "visible", timeout: 15000 })

  const reveal = row.locator('td[data-column-id="key"] button[data-slot="popover-trigger"], button[data-slot="popover-trigger"]')
  await reveal.click()

  const dialog = page.locator('[role="dialog"], [data-slot="popover-content"]').first()
  await dialog.waitFor({ state: "visible", timeout: 8000 })

  // Click nút Copy bên trong dialog
  const copyBtn = dialog.locator('button[aria-label*="copy" i], button[title*="copy" i], button:has-text("Copy"), button[data-slot="copy"], button svg').first()
  if (await visible(copyBtn)) {
    await copyBtn.click().catch(() => {})
  }

  const keyInput = dialog.locator('input[readonly], input').first()
  if (await visible(keyInput)) {
    await keyInput.click().catch(() => {})
  }

  let apiKey = null
  if (await visible(keyInput)) {
    apiKey = await keyInput.inputValue().catch(() => null)
  }

  if (!apiKey || apiKey.includes("...") || apiKey.includes("…") || apiKey.includes("xxxx")) {
    try {
      apiKey = await page.evaluate(() => navigator.clipboard.readText())
    } catch {}
  }

  if (!apiKey || !apiKey.startsWith("sk-") || apiKey.length < 25 || apiKey.includes("...") || apiKey.includes("…") || apiKey.includes("xxxx")) {
    throw new Error("Không thể trích xuất Full API Key thực sự từ SeekAI!")
  }

  return {
    status: "success",
    github_account: config.githubExpectedUsername,
    api_key: apiKey,
    copied: true,
  }
}

export async function runSeekAiFlow(page, context, config) {
  await signInWithGithub(page, config)
  return createApiKey(page, context, config)
}
