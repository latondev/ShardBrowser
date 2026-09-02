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
    'button:has-text("Ask me later"), a:has-text("Ask me later"), input[value="Ask me later"], form[action*="decline"] button, form[action*="decline"] input[type="submit"], button:has-text("Not now")',
  )
  if (page.url().includes("github.com/sessions/trusted-device") || (await visible(askLater.first()))) {
    try {
      await askLater.first().click({ timeout: 5000 })
      await page.waitForTimeout(1000)
    } catch {}
  }
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
      const keysTab = page.locator('a[href*="/keys"], a[href*="keys"], button:has-text("API Keys"), [role="tab"]:has-text("API Keys"), a:has-text("API Keys"), button:has-text("API Key"), a:has-text("API Key")').first()
      if (await visible(keysTab)) {
        await keysTab.click()
        await page.waitForTimeout(1500)
      } else {
        await page.goto(KEYS_URL, { waitUntil: "domcontentloaded" })
      }
    })

    let apiKey
    let copied = false
    await test.step("5. Create and copy API key", async () => {
      // 1. Cấp quyền Clipboard trước khi thao tác
      await context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: "https://seekai.cc",
      }).catch(() => {})

      // 2. Tạo API Key (Hỗ trợ cả Tiếng Anh & Tiếng Việt)
      const createBtn = page.getByRole("button", { name: /(Create API Key|Tạo khóa API|Tạo API Key|Add Key|Thêm khóa)/i }).first()
      await createBtn.click()
      const drawer = page.locator('[role="dialog"], [data-state="open"]').first()
      await drawer.waitFor({ state: "visible", timeout: 10000 })
      await drawer.locator('input:not([type="hidden"]):not([type="checkbox"])').first().fill(keyName)
      await drawer.getByRole("button", { name: /(Tạo|Lưu thay đổi|Lưu|Save|Create|Confirm|Xác nhận)/i }).first().click()

      // 3. Mở Popover hiển thị key vừa tạo
      const row = page.locator("tr").filter({ hasText: keyName }).first()
      await row.waitFor({ state: "visible", timeout: 15000 })
      await row.locator('td[data-column-id="key"] button[data-slot="popover-trigger"], button[data-slot="popover-trigger"]').first().click()

      const dialog = page.locator('[role="dialog"], [data-slot="popover-content"]').first()
      await dialog.waitFor({ state: "visible", timeout: 8000 })

      // 4. BẤM THỰC SỰ VÀO NÚT COPY TRÊN GIAO DIỆN SEEKAI để trang web tự ghi Full Key vào Clipboard
      const copyBtn = dialog.locator('button[aria-label*="copy" i], button[title*="copy" i], button:has-text("Copy"), button[data-slot="copy"], button:has(svg)').first()
      if (await copyBtn.isVisible().catch(() => false)) {
        await copyBtn.click()
      }

      // Thử click thêm vào ô input[readonly]
      const keyInput = dialog.locator('input[readonly], input').first()
      if (await keyInput.isVisible().catch(() => false)) {
        await keyInput.click().catch(() => {})
      }

      await page.waitForTimeout(600)

      // 5. Đọc Full Key thực sự từ Clipboard sau khi click nút Copy
      try {
        apiKey = await page.evaluate(() => navigator.clipboard ? navigator.clipboard.readText() : null)
      } catch {}

      // Fallback: nếu clipboard chưa có thì đọc thuộc tính value của ô input
      if (!apiKey || apiKey.includes("...") || apiKey.includes("…") || apiKey.includes("xxxx") || !apiKey.startsWith("sk-")) {
        if (await keyInput.isVisible().catch(() => false)) {
          const val = await keyInput.inputValue().catch(() => "")
          if (val && val.startsWith("sk-") && !val.includes("...") && !val.includes("…") && !val.includes("xxxx")) {
            apiKey = val
          }
        }
      }

      // 6. Kiểm tra tính hợp lệ của Full API Key (phải dài >= 25 ký tự và không bị masked)
      expect(apiKey).toBeTruthy()
      expect(apiKey).toMatch(/^sk-[A-Za-z0-9_-]{25,}$/)
      expect(apiKey).not.toContain("...")
      expect(apiKey).not.toContain("…")
      expect(apiKey).not.toContain("xxxx")

      copied = true
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
