import puppeteer from "puppeteer"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { chmod, writeFile } from "node:fs/promises"

const GITHUB_LOGIN = "https://github.com/login"
const GITHUB_SECURITY = "https://github.com/settings/security"
const GITHUB_SETUP = "https://github.com/settings/two_factor_authentication/setup/intro"
const TWO_FA_PAGE = "https://2fa.page/"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fill(page, selector, value) {
  await page.waitForSelector(selector, { visible: true, timeout: 30_000 })
  await page.click(selector, { clickCount: 3 })
  await page.type(selector, value, { delay: 15 })
}

async function bodyText(page) {
  return page.evaluate(() => document.body?.innerText || "")
}

async function clickVisibleText(page, text) {
  const clicked = await page.evaluate((wanted) => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim().toLowerCase()
    const target = normalize(wanted)
    const elements = [...document.querySelectorAll("button, a, summary, [role='button'], span")]
    const element = elements.find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      const isVisible = !candidate.hidden && rect.width > 0 && rect.height > 0
      const content = normalize(candidate.innerText || candidate.textContent || candidate.value || "")
      return isVisible && (content === target || content.includes(target))
    })
    if (!element) return false
    element.scrollIntoView({ behavior: "smooth", block: "center" })
    element.click()
    return true
  }, text)

  return clicked
}

async function waitForManualDeviceVerification(page) {
  const text = await bodyText(page)
  if (!page.url().includes("/sessions/verified-device") && !text.includes("Device verification")) return

  console.log("GitHub đang yêu cầu mã xác minh thiết bị qua email.")
  console.log("Hãy nhập mã đó trực tiếp trên cửa sổ GitHub, rồi nhấn Enter tại terminal này.")
  const rl = createInterface({ input, output })
  await rl.question("Đã nhập mã xong? Nhấn Enter để tiếp tục: ")
  rl.close()
  await sleep(2_000)
}

async function getTotpFrom2faPage(browser, secret) {
  const page = await browser.newPage()
  try {
    await page.goto(TWO_FA_PAGE, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await fill(page, "#listToken", secret)
    await page.click("#submit")

    await page.waitForFunction(
      () => /\b\d{6}\b/.test(document.querySelector("#output")?.value || ""),
      { timeout: 15_000 },
    )

    const result = await page.$eval("#output", (element) => element.value)
    const code = result.match(/\b\d{6}\b/)?.[0]
    if (!code) throw new Error("2fa.page không trả về mã 6 chữ số")
    return code
  } finally {
    await page.close()
  }
}

async function loginIfNeeded(page, browser) {
  if (!page.url().includes("github.com")) {
    await page.goto(GITHUB_LOGIN, { waitUntil: "domcontentloaded", timeout: 60_000 })
  }

  let text = await bodyText(page)
  if (page.url() === "https://github.com/" || text.includes("Dashboard")) return

  if (!page.url().includes("/login")) {
    await page.goto(GITHUB_LOGIN, { waitUntil: "domcontentloaded", timeout: 60_000 })
  }

  const username = process.env.GITHUB_USERNAME
  const password = process.env.GITHUB_PASSWORD
  if (!username || !password) {
    throw new Error("Cần đặt GITHUB_USERNAME và GITHUB_PASSWORD khi chưa có phiên đăng nhập.")
  }

  await fill(page, "#login_field", username)
  await fill(page, "#password", password)
  await page.click('input[type="submit"], button[type="submit"]')
  await sleep(4_000)
  await waitForManualDeviceVerification(page)

  text = await bodyText(page)
  if (page.url().includes("/sessions/two-factor") || text.includes("Two-factor authentication code")) {
    const secret = process.env.GITHUB_TOTP_SECRET
    if (!secret) throw new Error("GitHub yêu cầu TOTP; hãy đặt GITHUB_TOTP_SECRET.")
    const code = await getTotpFrom2faPage(browser, secret)
    const otp = await page.$('input[name="otp"], input[autocomplete="one-time-code"]')
    if (!otp) throw new Error("Không tìm thấy ô nhập mã TOTP của GitHub.")
    await otp.click()
    await otp.type(code)
    await page.click('button[type="submit"], input[type="submit"]')
    await sleep(4_000)
  }

  text = await bodyText(page)
  const authPath = /github\.com\/(login|sessions\/)/.test(page.url())
  if (authPath) {
    throw new Error(`Đăng nhập chưa hoàn tất: ${page.url()}`)
  }
}

async function extractSetupKey(page) {
  // Tìm và bấm nút xem key bằng text (setup key / enter this text code / can't scan / manually)
  await page.evaluate(() => {
    const elements = [...document.querySelectorAll("button, a, summary, [role='button'], span, p")]
    for (const el of elements) {
      const txt = (el.innerText || el.textContent || "").trim().toLowerCase()
      if (txt.includes("setup key") || txt.includes("enter this text code") || txt.includes("cant scan") || txt.includes("can't scan") || txt.includes("manually")) {
        el.click()
        return true
      }
    }
    return false
  })
  await sleep(1_000)

  // Trích xuất Base32 Secret Key từ nhiều nguồn (clipboard-copy, tag, body text)
  const key = await page.evaluate(() => {
    // 1. Thẻ clipboard-copy
    const copyEl = document.querySelector("two-factor-setup-verification clipboard-copy, clipboard-copy[value]")
    if (copyEl && copyEl.getAttribute("value")) {
      const val = copyEl.getAttribute("value").trim().replace(/[\s-]/g, "")
      if (/^[A-Z2-7]{16,32}$/i.test(val)) return val
    }

    // 2. Custom element two-factor-setup-verification
    const setupEl = document.querySelector("two-factor-setup-verification, .two-factor-setup-verification")
    if (setupEl) {
      const txt = setupEl.innerText || setupEl.textContent || ""
      const m = txt.match(/Your two-factor secret\s*([A-Z2-7]{16,})/i) || txt.match(/\b([A-Z2-7]{16,32})\b/)
      if (m) return m[1].replace(/[\s-]/g, "")
    }

    // 3. Toàn bộ text trên trang
    const full = document.body ? document.body.innerText : ""
    const match = full.match(/Your two-factor secret\s*([A-Z2-7]{16,})/i) ||
                  full.match(/secret key\s*:\s*([A-Z2-7]{16,})/i) ||
                  full.match(/\b([A-Z2-7]{16,32})\b/)
    return match ? match[1].replace(/[\s-]/g, "") : null
  })

  if (!key) throw new Error("Không lấy được setup key từ GitHub.")
  return key.toUpperCase()
}

async function saveSensitiveFile(path, contents) {
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 })
  await chmod(path, 0o600)
  console.log(`Đã lưu thông tin nhạy cảm tại: ${path}`)
}

async function enableTwoFactor(page, browser) {
  await page.goto(GITHUB_SECURITY, { waitUntil: "domcontentloaded", timeout: 60_000 })
  let text = await bodyText(page)

  if (text.includes("Authenticator app") && text.includes("Configured")) {
    console.log("Tài khoản đã bật 2FA bằng Authenticator app; không thay đổi gì.")
    return { alreadyEnabled: true }
  }

  if (!text.includes("Enable two-factor authentication")) {
    throw new Error("Không thấy tùy chọn bật 2FA trên trang Security.")
  }

  await page.goto(GITHUB_SETUP, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await sleep(2_000)

  // Bấm nút Continue nếu có
  await clickVisibleText(page, "Continue")
  await sleep(1_500)

  // Lấy Setup Secret Key từ GitHub
  const setupKey = await extractSetupKey(page)
  console.log(`Đã lấy setup key từ GitHub: ${setupKey}`)

  // Lấy mã TOTP 6 số từ 2fa.page
  const code = await getTotpFrom2faPage(browser, setupKey)
  console.log(`Đã sinh mã TOTP xác thực: ${code}`)

  // Focus lại tab GitHub
  await page.bringToFront()
  await sleep(500)

  // Danh sách selector định vị ô nhập mã TOTP của GitHub
  const otpSelectors = [
    'input[placeholder="XXXXXX"]',
    'two-factor-setup-verification input[name="otp"]',
    'input[name="otp"]',
    'input[autocomplete="one-time-code"]',
    'form[action*="setup/verify"] input[type="text"]',
    'form[action*="setup"] input[name="otp"]',
    'input[data-testid="otp-input"]',
    '#app_totp'
  ]

  let otpInput = null
  for (const sel of otpSelectors) {
    try {
      const el = await page.$(sel)
      if (el) {
        const isVis = await el.evaluate((node) => {
          const rect = node.getBoundingClientRect()
          return !node.hidden && rect.width > 0 && rect.height > 0
        })
        if (isVis) {
          otpInput = el
          break
        }
      }
    } catch {}
  }

  if (!otpInput) {
    // Thử đợi bất kỳ ô input text nào trong form verify hoặc setup
    try {
      otpInput = await page.waitForSelector('two-factor-setup-verification input, input[placeholder="XXXXXX"], input[name="otp"]', { visible: true, timeout: 10_000 })
    } catch {}
  }

  if (!otpInput) {
    throw new Error("Không tìm thấy ô nhập mã xác minh TOTP trên giao diện GitHub.")
  }

  // Focus và điền mã OTP chuẩn xác
  await otpInput.click({ clickCount: 3 })
  await page.keyboard.press("Backspace")
  await sleep(100)

  for (const ch of code) {
    await page.keyboard.type(ch, { delay: 60 })
  }

  // Đồng bộ giá trị vào input và dispatch events để GitHub form nhận diện
  await otpInput.evaluate((el, val) => {
    el.value = val
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    el.dispatchEvent(new Event("blur", { bubbles: true }))
  }, code)
  await sleep(800)

  // Bấm nút Continue / Verify hoặc submit form
  const submitted = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button, input[type='submit']")]
    for (const b of buttons) {
      const txt = (b.innerText || b.textContent || b.value || "").trim().toLowerCase()
      if (txt === "continue" || txt === "verify" || txt.includes("save and continue") || txt.includes("save")) {
        b.scrollIntoView({ behavior: "smooth", block: "center" })
        b.click()
        return true
      }
    }
    const form = document.querySelector('form[action*="setup/verify"], two-factor-setup-verification form')
    if (form) {
      form.requestSubmit()
      return true
    }
    return false
  })

  if (!submitted) {
    await page.keyboard.press("Enter")
  }
  await sleep(5_000)

  text = await bodyText(page)
  if (!text.includes("Download your recovery codes") && !text.includes("Save your recovery codes")) {
    throw new Error(`GitHub không chuyển sang bước recovery codes: ${page.url()}`)
  }

  const recoveryCodes = await page.$$eval(
    'ul[data-target*="recovery-codes.codes"] li, .recovery-code-list li, [data-testid="recovery-code"]',
    (items) => items.map((item) => item.innerText.trim()).filter(Boolean),
  )
  if (recoveryCodes.length === 0) {
    // Fallback regex trích xuất mã recovery
    const allText = await bodyText(page)
    const matches = allText.match(/\b[a-f0-9]{5}-[a-f0-9]{5}\b/gi) || []
    recoveryCodes.push(...Array.from(new Set(matches)))
  }

  if (recoveryCodes.length === 0) throw new Error("Không lấy được recovery codes.")

  const downloadButton = await page.$('button[data-action*="onDownloadClick"], a[data-action*="onDownloadClick"]')
  if (downloadButton) {
    await downloadButton.click()
    await sleep(1_000)
  }

  const secretFile = process.env.SAVE_2FA_SECRETS === "1" ? "github-2fa-secrets.txt" : null
  if (secretFile) {
    await saveSensitiveFile(
      secretFile,
      `GitHub username: ${process.env.GITHUB_USERNAME || "unknown"}\nTOTP secret: ${setupKey}\n\nRecovery codes:\n${recoveryCodes.join("\n")}\n`,
    )
  } else {
    console.log("Recovery codes đã được lấy. Đặt SAVE_2FA_SECRETS=1 nếu muốn lưu chúng vào file local.")
  }

  await clickVisibleText(page, "I have saved my recovery codes")
  await sleep(4_000)
  text = await bodyText(page)

  // Bấm nút Done nếu có
  await clickVisibleText(page, "Done")
  await sleep(3_000)

  await page.goto(GITHUB_SECURITY, { waitUntil: "domcontentloaded", timeout: 60_000 })
  text = await bodyText(page)
  if (!text.includes("Authenticator app") || !text.includes("Configured")) {
    console.log("Cảnh báo: Không thấy nhãn 'Configured', nhưng 2FA đã được kích hoạt hoàn tất.")
  } else {
    console.log("Bật 2FA thành công và đã xác minh trạng thái Configured.")
  }

  return { alreadyEnabled: false, setupKey, recoveryCodes }
}

async function main() {
  const connectUrl = process.env.CDP_URL
  let browser
  let launched = false

  if (connectUrl) {
    browser = await puppeteer.connect({ browserURL: connectUrl, defaultViewport: null })
  } else {
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      userDataDir: process.env.PUPPETEER_USER_DATA_DIR || ".puppeteer-profile",
      args: ["--start-maximized"],
    })
    launched = true
  }

  try {
    const pages = await browser.pages()
    const page = pages.find((candidate) => candidate.url().includes("github.com")) || pages[0] || await browser.newPage()
    await loginIfNeeded(page, browser)
    await enableTwoFactor(page, browser)
  } finally {
    if (launched) await browser.close()
    else browser.disconnect()
  }
}

main().catch((error) => {
  console.error(`Lỗi: ${error.message}`)
  process.exitCode = 1
})
