import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ShardProfileManager } from "./shard_helper.mjs";
import { EmailnatorClient } from "./emailnator_client.mjs";
import { HotmailGraphClient } from "./hotmail_graph_client.mjs";
import { MailTmClient } from "./mailtm_client.mjs";
import { GmailCreatorClient } from "./gmail_client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_FILE = path.resolve(__dirname, "..", "output.txt");

export const FIXED_PASSWORD = "01652530159Aa@";
const SIGNUP_URL = "https://seekai.cc/sign-up?aff=wChP";
const KEYS_URL = "https://seekai.cc/keys";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function humanType(page, selector, textToType) {
  await page.waitForSelector(selector, { visible: true, timeout: 20000 });
  const el = await page.$(selector);
  if (!el) throw new Error(`Không tìm thấy ô nhập: ${selector}`);

  await el.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await sleep(100);

  for (const char of textToType) {
    const delay = Math.floor(Math.random() * 30) + 20;
    await page.keyboard.type(char, { delay });
  }

  await page.evaluate((element, val) => {
    if (element) {
      element.value = val;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));
    }
  }, el, textToType);
  await sleep(300);
}

async function safeClick(page, selectorOrText) {
  return page.evaluate((target) => {
    const normalize = (s) => (s || "").trim().toLowerCase();
    const tClean = normalize(target);

    if (target.startsWith("#") || target.startsWith(".") || target.startsWith("[") || target.startsWith("button")) {
      const el = document.querySelector(target);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.click();
        return true;
      }
    }

    const elements = Array.from(document.querySelectorAll("button, a, input[type='submit'], [role='button'], summary"));
    for (const el of elements) {
      const txt = normalize(el.innerText || el.textContent || el.value || "");
      if (txt === tClean || txt.includes(tClean)) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.click();
        return true;
      }
    }
    return false;
  }, selectorOrText);
}

/**
 * Đăng ký tài khoản trực tiếp trên SeekAI bằng Form
 */
async function registerSeekAiAccount(page, email, password, rawUsername, emailClient) {
  console.log(`\n🌐 [SeekAI SignUp] Mở trang đăng ký SeekAI: ${SIGNUP_URL}...`);
  await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);

  // Đảm bảo username chỉ gồm chữ cái và số (4-16 ký tự)
  const username = `u${rawUsername.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}${Math.random().toString(36).substring(2, 6)}`;

  // 1. Điền Tên người dùng
  console.log(`-> Điền Username: ${username}`);
  await humanType(page, "input[name='username'], input[placeholder*='tên đăng nhập' i], input[placeholder*='username' i]", username);
  await sleep(600);

  // 2. Điền Mật khẩu & Xác nhận mật khẩu
  console.log(`-> Điền Mật khẩu: ${password}`);
  await humanType(page, "input[name='password'], input[placeholder*='mật khẩu' i]", password);
  await sleep(600);

  console.log(`-> Điền Xác nhận mật khẩu...`);
  await humanType(page, "input[name='confirmPassword'], input[name='confirm_password'], input[placeholder*='xác nhận' i]", password);
  await sleep(600);

  // 3. Điền Email
  console.log(`-> Điền Email: ${email}`);
  await humanType(page, "input[name='email'], input[type='email']", email);
  await sleep(800);

  // 4. Bấm nút "Gửi mã" (Send Code)
  console.log("-> Bấm nút 'Gửi mã' xác thực Email...");
  const clickedSend = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    for (const b of buttons) {
      const txt = (b.innerText || b.textContent || "").trim().toLowerCase();
      if (txt.includes("gửi mã") || txt.includes("send code") || txt.includes("get code") || txt.includes("send")) {
        b.scrollIntoView({ behavior: "smooth", block: "center" });
        b.click();
        return true;
      }
    }
    return false;
  });

  if (!clickedSend) {
    throw new Error("Không tìm thấy nút 'Gửi mã' trên form SeekAI!");
  }

  await sleep(1500);

  // 5. Đợi mã OTP từ Mail.tm
  console.log("-> Đang chờ mã xác minh từ hộp thư Mail.tm...");
  const otpCode = await emailClient.waitForOtpCode(email, 90000);

  // 6. Điền mã OTP vào ô Mã xác minh
  console.log(`-> Nhập mã OTP [${otpCode}] vào form SeekAI...`);
  await page.evaluate((code) => {
    const inputs = Array.from(document.querySelectorAll("input[type='text'], input"));
    const otpInput = inputs.find(i => {
      const ph = (i.placeholder || "").toLowerCase();
      const id = (i.id || "").toLowerCase();
      return ph.includes("mã xác minh") || ph.includes("verification") || ph.includes("code") || id.includes("base-ui");
    }) || inputs[inputs.length - 1];

    if (otpInput) {
      otpInput.focus();
      otpInput.value = code;
      otpInput.dispatchEvent(new Event("input", { bubbles: true }));
      otpInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, otpCode);

  await sleep(800);

  // 7. Đồng ý Điều khoản (Checkbox)
  console.log("-> Tích chọn đồng ý Thỏa thuận người dùng...");
  await page.evaluate(() => {
    const chk = document.querySelector("#legal-consent, input[type='checkbox']");
    if (chk && !chk.checked) {
      chk.click();
    }
  }).catch(() => {});

  await sleep(800);

  // 8. Bấm nút "Tạo tài khoản" (Submit)
  console.log("-> Bấm nút 'Tạo tài khoản'...");
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button[type='submit'], button"));
    for (const b of buttons) {
      const txt = (b.innerText || b.textContent || "").trim().toLowerCase();
      if (txt.includes("tạo tài khoản") || txt.includes("sign up") || txt.includes("register")) {
        b.click();
        return true;
      }
    }
    const submitBtn = document.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.click();
  });

  // 9. Chờ hoàn tất đăng ký và chuyển trang
  console.log("⏳ Chờ SeekAI xử lý đăng ký...");
  await sleep(4000);

  console.log("✅ Đăng ký tài khoản SeekAI thành công!");
  return username;
}

async function executeSeekAiFlow(page, keyName = "Auto_API_Key_01") {
  console.log(`🔑 [API Key] Chuyển đến ${KEYS_URL}...`);
  await page.goto(KEYS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);

  // 1. Tìm và bấm nút "Create API Key"
  console.log("-> Tìm và bấm nút 'Create API Key'...");
  let clickedCreate = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    clickedCreate = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("button, [role='button'], a"));
      for (const el of elements) {
        const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (txt.includes("create api key") || txt.includes("create key") || txt.includes("new key") || txt.includes("tạo key")) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.click();
          return true;
        }
      }
      return false;
    });
    if (clickedCreate) break;
    await sleep(1500);
  }

  await sleep(2000);

  // 2. Điền tên khóa vào Modal
  console.log(`-> Đặt tên khóa: ${keyName}...`);
  await page.evaluate((kVal) => {
    const inputs = Array.from(document.querySelectorAll("input[type='text'], input[name='name'], [role='dialog'] input"));
    const targetInput = inputs.find(i => !i.readOnly && !i.disabled) || inputs[inputs.length - 1];
    if (targetInput) {
      targetInput.focus();
      targetInput.value = kVal;
      targetInput.dispatchEvent(new Event("input", { bubbles: true }));
      targetInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, keyName);

  await sleep(1000);

  // 3. Bấm Save changes
  console.log("-> Bấm 'Save changes'...");
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']"));
    for (const b of buttons) {
      const txt = (b.innerText || b.value || "").trim().toLowerCase();
      if (txt.includes("save changes") || txt.includes("save") || txt.includes("create") || txt.includes("confirm")) {
        b.click();
        return true;
      }
    }
  }).catch(() => {});

  // 4. Cấp quyền Clipboard & Cài đặt Hook bắt mã API Key khi nút Copy được bấm
  console.log("-> Chuẩn bị Clipboard hook...");
  try {
    const client = await page.target().createCDPSession();
    await client.send("Browser.grantPermissions", {
      origin: "https://seekai.cc",
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    });
  } catch {}

  await page.evaluate(() => {
    window.__capturedSeekApiKey = null;
    if (navigator.clipboard) {
      const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text) => {
        if (typeof text === "string" && text.trim().startsWith("sk-")) {
          window.__capturedSeekApiKey = text.trim();
        }
        return origWrite(text).catch(() => {});
      };
    }
    document.addEventListener("copy", (e) => {
      try {
        if (e.clipboardData) {
          const text = e.clipboardData.getData("text/plain");
          if (text && text.trim().startsWith("sk-")) {
            window.__capturedSeekApiKey = text.trim();
          }
        }
        const sel = window.getSelection()?.toString();
        if (sel && sel.trim().startsWith("sk-")) {
          window.__capturedSeekApiKey = sel.trim();
        }
      } catch {}
    }, true);
  }).catch(() => {});

  function isRealApiKey(str) {
    if (!str || typeof str !== "string") return false;
    const cleaned = str.trim();
    if (!cleaned.startsWith("sk-")) return false;
    if (
      cleaned.includes("...") ||
      cleaned.includes("…") ||
      cleaned.includes("xxxx") ||
      cleaned.includes("****") ||
      cleaned.includes("••••")
    ) {
      return false;
    }
    if (cleaned.length < 25 || /\s/.test(cleaned)) return false;
    return true;
  }

  // 5. Chờ hàng chứa keyName xuất hiện trong bảng API Keys
  console.log(`⏳ Đang chờ danh sách API Key cập nhật khóa [${keyName}]...`);
  let targetRowFound = false;
  for (let waitRow = 0; waitRow < 20; waitRow++) {
    targetRowFound = await page.evaluate((kVal) => {
      const rows = Array.from(document.querySelectorAll("tbody tr, tr, div.grid, .key-row"));
      return rows.some((r) => (r.innerText || "").includes(kVal));
    }, keyName).catch(() => false);

    if (targetRowFound) {
      console.log(`-> ✅ Đã tìm thấy khóa [${keyName}] trên bảng danh sách!`);
      break;
    }
    await sleep(1000);
  }

  // 6. Mở Popover & BẤM NÚT COPY ĐỂ LẤY FULL KEY THỰC SỰ
  console.log("-> Mở Popover & Bấm nút 'Copy Key'...");
  let apiKey = null;

  for (let attempt = 0; attempt < 12; attempt++) {
    // 6.1. Mở Popover trên dòng chứa keyName
    await page.evaluate((kVal) => {
      const rows = Array.from(document.querySelectorAll("tbody tr, tr, div.grid, .key-row"));
      const targetRow = rows.find((r) => (r.innerText || "").includes(kVal)) || rows[0];
      if (targetRow) {
        const trigger = targetRow.querySelector(
          'td[data-column-id="key"] button[data-slot="popover-trigger"], td[data-column-id="key"] button, button[data-slot="popover-trigger"], button[aria-haspopup="dialog"]'
        );
        if (trigger) {
          trigger.scrollIntoView({ behavior: "smooth", block: "center" });
          trigger.click();
        }
      }
    }, keyName).catch(() => {});

    await sleep(1000);

    // 6.2. Tìm và BẤM NÚT COPY thật sự trong Popover / Modal
    await page.evaluate(() => {
      const dialogs = Array.from(
        document.querySelectorAll(
          "[role='dialog'], [data-slot='popover-content'], [data-radix-popper-content-wrapper], div[data-state='open'], [data-state='visible']"
        )
      );
      const scopes = dialogs.length > 0 ? dialogs : [document.body];

      for (const scope of scopes) {
        const buttons = Array.from(scope.querySelectorAll("button, [role='button']"));
        for (const btn of buttons) {
          const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
          const title = (btn.getAttribute("title") || "").toLowerCase();
          const txt = (btn.innerText || btn.textContent || "").trim().toLowerCase();
          const hasSvg = !!btn.querySelector("svg, path");
          const isCopyBtn =
            aria.includes("copy") ||
            title.includes("copy") ||
            txt.includes("copy") ||
            txt.includes("sao chép") ||
            btn.getAttribute("data-slot") === "copy" ||
            btn.className.toString().includes("copy") ||
            hasSvg;

          if (isCopyBtn) {
            btn.scrollIntoView({ behavior: "smooth", block: "center" });
            btn.click();
            btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          }
        }

        // Thử click vào ô input[readonly]
        const inputs = Array.from(scope.querySelectorAll("input[readonly], input"));
        for (const inp of inputs) {
          inp.focus();
          inp.select?.();
          inp.click();
          try {
            document.execCommand("copy");
          } catch {}
        }
      }
    }).catch(() => {});

    await sleep(1000);

    // 6.3. Kiểm tra các nguồn lấy Key theo thứ tự ưu tiên:
    // (a) Bắt từ hook clipboard writeText
    const captured = await page.evaluate(() => window.__capturedSeekApiKey).catch(() => null);
    if (isRealApiKey(captured)) {
      apiKey = captured;
      console.log("-> [Thành Công] Bắt được Full API Key từ Clipboard Event sau khi bấm nút Copy!");
      break;
    }

    // (b) Đọc trực tiếp từ Clipboard của trình duyệt
    const clipText = await page.evaluate(() => {
      return navigator.clipboard ? navigator.clipboard.readText().catch(() => null) : null;
    }).catch(() => null);
    if (isRealApiKey(clipText)) {
      apiKey = clipText;
      console.log("-> [Thành Công] Đọc được Full API Key từ Clipboard của browser!");
      break;
    }

    // (c) Đọc từ thuộc tính input.value trong Popover
    const inputValue = await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll(
          "[role='dialog'] input[readonly], [role='dialog'] input, [data-slot='popover-content'] input, input[readonly]"
        )
      );
      for (const inp of inputs) {
        const val = (inp.value || inp.getAttribute("value") || "").trim();
        if (val.startsWith("sk-")) return val;
      }
      return null;
    }).catch(() => null);

    if (isRealApiKey(inputValue)) {
      apiKey = inputValue;
      console.log("-> [Thành Công] Trích xuất được Full API Key từ input.value trong Popover!");
      break;
    }

    // (d) Đọc từ data-clipboard-text hoặc data-value attribute
    const attrValue = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("[data-clipboard-text], [data-value], [data-key]"));
      for (const el of elements) {
        const val = (
          el.getAttribute("data-clipboard-text") ||
          el.getAttribute("data-value") ||
          el.getAttribute("data-key") ||
          ""
        ).trim();
        if (val.startsWith("sk-")) return val;
      }
      return null;
    }).catch(() => null);

    if (isRealApiKey(attrValue)) {
      apiKey = attrValue;
      console.log("-> [Thành Công] Trích xuất được Full API Key từ Data Attribute của nút Copy!");
      break;
    }

    await sleep(1500);
  }

  if (!isRealApiKey(apiKey)) {
    throw new Error("Không thể lấy được Full API Key thực sự từ SeekAI (vẫn bị masked hoặc không ấn được nút copy)!");
  }

  console.log(`✨ [SeekAI API Key]: ${apiKey}`);

  // 7. Kiểm tra trạng thái Status: Nếu 'Disabled' -> Bấm nút 'Enable' (icon power) và chờ 3s
  console.log(`🔍 [Status Check] Đang kiểm tra trạng thái kích hoạt của khóa [${keyName}]...`);
  for (let checkAttempt = 1; checkAttempt <= 5; checkAttempt++) {
    const statusResult = await page.evaluate((kVal) => {
      const rows = Array.from(document.querySelectorAll("tbody tr, tr, div.grid, .key-row"));
      const targetRow = rows.find((r) => (r.innerText || "").includes(kVal)) || rows[0];
      if (!targetRow) return { found: false };

      const badge = targetRow.querySelector(
        '[data-slot="status-badge"], span[title="Disabled"], span[title="Enabled"], td[data-column-id="status"]'
      );
      const title = (badge ? badge.getAttribute("title") : "") || "";
      const text = (badge ? badge.innerText || badge.textContent : "") || (targetRow.innerText || "");
      const combined = `${title} ${text}`.toLowerCase();

      const isDisabled = combined.includes("disabled") || combined.includes("vô hiệu") || combined.includes("tắt");
      const isEnabled = combined.includes("enabled") || combined.includes("hoạt động") || combined.includes("kích hoạt") || combined.includes("active");

      if (isDisabled) {
        const enableBtn = targetRow.querySelector(
          'button[aria-label="Enable" i], button[aria-label*="Enable" i], button[aria-label*="Bật" i], button[title*="Enable" i], button:has(svg.lucide-power), button svg.lucide-power'
        );
        if (enableBtn) {
          const btn = enableBtn.tagName.toLowerCase() === "svg" ? enableBtn.closest("button") : enableBtn;
          if (btn) {
            btn.scrollIntoView({ behavior: "smooth", block: "center" });
            btn.click();
            return { found: true, clicked: true, isDisabled: true };
          }
        }

        const buttons = Array.from(targetRow.querySelectorAll("button"));
        for (const b of buttons) {
          const aria = (b.getAttribute("aria-label") || "").toLowerCase();
          const hasPower = !!b.querySelector(".lucide-power, svg path[d*='M12 2v10']");
          if (aria.includes("enable") || aria.includes("bật") || hasPower) {
            b.scrollIntoView({ behavior: "smooth", block: "center" });
            b.click();
            return { found: true, clicked: true, isDisabled: true };
          }
        }
      }

      return { found: true, clicked: false, isEnabled, isDisabled };
    }, keyName).catch(() => ({ found: false }));

    if (statusResult.clicked) {
      console.log(`⚡ Phát hiện trạng thái 'Disabled' -> Đã bấm nút Bật ('Enable')! Chờ 3s xác nhận lại...`);
      await sleep(3000);
      continue;
    }

    if (statusResult.isEnabled) {
      console.log(`✅ [Status Verified] Khóa API [${keyName}] đã kích hoạt thành công (Enabled)!`);
      break;
    }

    await sleep(1000);
  }

  return apiKey;
}

export function saveSuccessResult(username, password, apiKey) {
  const cleanUser = username.trim();
  const cleanPass = password.trim();
  const cleanKey = apiKey.trim();

  let content = "";
  if (fs.existsSync(OUTPUT_FILE)) {
    content = fs.readFileSync(OUTPUT_FILE, "utf8");
  }

  const prefix = (content.length > 0 && !content.endsWith("\n")) ? "\n" : "";
  const line = `${prefix}${cleanUser}|${cleanPass}|${cleanKey}\n`;
  fs.appendFileSync(OUTPUT_FILE, line, "utf8");
  console.log(`💾 [ĐÃ LƯU OUTPUT]: ${cleanUser}|${cleanPass}|${cleanKey} -> ${OUTPUT_FILE}`);
}

export function loadAllHotmailAccounts() {
  const candidatePaths = [
    path.resolve(__dirname, "..", "..", "git", "hotmail", "Hotmail_1.txt"),
    path.resolve(__dirname, "..", "..", "git", "hotmail", "Hotmail_2.txt"),
    path.resolve(__dirname, "..", "Hotmail_1.txt"),
    path.resolve(__dirname, "..", "Hotmail_2.txt"),
    "F:/ToolAllvideo/ShardBrowser/Testing/git/hotmail/Hotmail_1.txt",
    "F:/ToolAllvideo/ShardBrowser/Testing/git/hotmail/Hotmail_2.txt",
  ];

  const accounts = [];
  const seen = new Set();

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf8");
        const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const email = line.split("|")[0]?.split("\t")?.pop()?.trim()?.toLowerCase();
          if (email && email.includes("@") && !seen.has(email)) {
            seen.add(email);
            accounts.push(line);
          }
        }
      } catch {}
    }
  }

  return accounts;
}

export async function runHotmailSeekAiAccount(hotmailLine, options = {}) {
  const {
    password = FIXED_PASSWORD,
    keyName = `Key_${Date.now().toString().slice(-4)}`,
    headless = false,
    folder = "SeekAI-Hotmail",
  } = options;

  const emailClient = new HotmailGraphClient(hotmailLine);
  if (!emailClient.email) {
    throw new Error("Dòng tài khoản Hotmail không hợp lệ hoặc thiếu email.");
  }

  console.log(`\n==================================================================`);
  console.log(`🚀 [SEEKAI HOTMAIL AUTO]: ${emailClient.email}`);
  console.log(`==================================================================`);

  const profileMgr = new ShardProfileManager(folder);
  let browser = null;

  try {
    // 1. Kiểm tra trước Access Token Microsoft Graph
    console.log(`-> Kiểm tra xác thực Microsoft Graph OAuth2 cho [${emailClient.email}]...`);
    await emailClient.getAccessToken();

    // 2. Tạo Sandbox Profile ShardBrowser
    await profileMgr.createProfile(`SEEK-${emailClient.username.slice(0, 10)}`);
    const wsUrl = await profileMgr.startBrowser(headless);

    browser = await puppeteer.connect({
      browserWSEndpoint: wsUrl,
      defaultViewport: null,
      protocolTimeout: 240000,
    });
    const page = (await browser.pages())[0] || (await browser.newPage());

    // 3. Đăng ký trực tiếp trên SeekAI bằng Hotmail + Nhận OTP qua Graph API
    const registeredUser = await registerSeekAiAccount(page, emailClient.email, password, emailClient.username, emailClient);

    // 4. Tạo và copy Full API Key
    const apiKey = await executeSeekAiFlow(page, keyName);

    // 5. Lưu output
    saveSuccessResult(registeredUser, password, apiKey);

    return {
      status: "success",
      email: emailClient.email,
      username: registeredUser,
      password,
      apiKey,
    };
  } finally {
    if (browser) await browser.disconnect().catch(() => {});
    await profileMgr.destroyProfile();
  }
}

export async function runFullAutonomousAccount(options = {}) {
  const {
    password = FIXED_PASSWORD,
    keyName = `Key_${Date.now().toString().slice(-4)}`,
    headless = false,
    folder = "SeekAI-Emailnator",
  } = options;

  console.log(`\n==================================================================`);
  console.log(`🚀 [SEEKAI AUTO PIPELINE] BẮT ĐẦU VỚI EMAILNATOR GMAIL`);
  console.log(`==================================================================`);

  const profileMgr = new ShardProfileManager(folder);
  let browser = null;

  try {
    // Ưu tiên Emailnator (cấp @gmail.com thật qua DotGmail / PlusGmail)
    let emailClient = new EmailnatorClient();
    let emailAcc = null;

    try {
      emailAcc = await emailClient.createAccount({ useDotGmail: true });
    } catch (emailnatorErr) {
      console.warn(`⚠️ [Emailnator] Lỗi tạo Gmail (${emailnatorErr.message}), chuyển sang Mail.tm...`);
      emailClient = new MailTmClient();
      emailAcc = await emailClient.createAccount();
    }

    await profileMgr.createProfile(`SEEK-${emailAcc.username.slice(0, 10)}`);
    const wsUrl = await profileMgr.startBrowser(headless);

    browser = await puppeteer.connect({
      browserWSEndpoint: wsUrl,
      defaultViewport: null,
      protocolTimeout: 240000,
    });
    const page = (await browser.pages())[0] || (await browser.newPage());

    const registeredUser = await registerSeekAiAccount(page, emailAcc.address, password, emailAcc.username, emailClient);
    const apiKey = await executeSeekAiFlow(page, keyName);

    saveSuccessResult(registeredUser, password, apiKey);

    return {
      status: "success",
      email: emailAcc.address,
      username: registeredUser,
      password,
      apiKey,
    };
  } finally {
    if (browser) await browser.disconnect().catch(() => {});
    await profileMgr.destroyProfile();
  }
}
