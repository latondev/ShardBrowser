import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ShardProfileManager } from "./shard_helper.mjs";
import { getTotpCode } from "./totp.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_FILE = path.resolve(__dirname, "..", "output.txt");

export const FIXED_PASSWORD = "01652530159";
const SIGNUP_URL = "https://seekai.cc/sign-up?aff=wChP";
const KEYS_URL = "https://seekai.cc/keys";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeQuery(page, selector) {
  try {
    return await page.$(selector);
  } catch {
    return null;
  }
}

async function humanType(page, selector, textToType) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  } catch {}

  const el = await safeQuery(page, selector);
  if (!el) throw new Error(`Không tìm thấy ô nhập: ${selector}`);

  try {
    await el.click({ clickCount: 3 }).catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await sleep(100);

    for (const char of textToType) {
      const delay = Math.floor(Math.random() * 30) + 20;
      await page.keyboard.type(char, { delay }).catch(() => {});
    }

    await page.evaluate((element, val) => {
      if (element) {
        element.value = val;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    }, el, textToType).catch(() => {});
  } catch {}
  await sleep(300);
}

async function safeClick(page, selectorOrText) {
  try {
    return await page.evaluate((target) => {
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
  } catch {
    return false;
  }
}

// Xử lý luồng xác thực GitHub (Login -> 2FA -> Passkey -> OAuth Authorize)
async function handleGithubAuthFlow(page, account) {
  const password = account.password || FIXED_PASSWORD;

  for (let step = 0; step < 90; step++) {
    let currentUrl = "";
    try {
      currentUrl = page.url();
    } catch {
      await sleep(1000);
      continue;
    }

    // 1. Đã chuyển về SeekAI -> Đăng nhập thành công!
    if (currentUrl.includes("seekai.cc") && !currentUrl.includes("sign-up") && !currentUrl.includes("sign-in")) {
      console.log("🎉 Đã chuyển về SeekAI Dashboard!");
      return;
    }

    // 2. Điền form đăng nhập GitHub
    const loginField = await safeQuery(page, "#login_field");
    if (loginField && currentUrl.includes("github.com")) {
      console.log(`🔑 [GitHub Login] Điền tài khoản [${account.username}]...`);
      await humanType(page, "#login_field", account.username);
      await sleep(300);
      await humanType(page, "#password", password);
      await sleep(500);
      await safeClick(page, "Sign in");
      await sleep(2500);
      continue;
    }

    // 3. Nếu GitHub ở màn hình chọn phương thức 2FA khác -> Chuyển sang Authenticator App
    if (currentUrl.includes("github.com/sessions/two-factor")) {
      const switched = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("button, a, [data-hydro-click*='authenticator']"));
        for (const el of links) {
          const txt = (el.innerText || el.textContent || "").toLowerCase();
          if (txt.includes("use an authenticator app") || txt.includes("authenticator app")) {
            el.click();
            return true;
          }
        }
        return false;
      });
      if (switched) {
        console.log("🔄 Chuyển sang phương thức Authenticator App TOTP...");
        await sleep(1500);
      }
    }

    // 4. Xử lý 2FA TOTP (6 số)
    const totpField = await safeQuery(page, "#app_totp, input[name='otp'], input[name='app_totp'], input[autocomplete='one-time-code'], input[placeholder*='6-digit']");
    if (totpField && currentUrl.includes("github.com")) {
      if (account.totpSecret) {
        const code = getTotpCode(account.totpSecret);
        console.log(`🔐 [2FA TOTP] Nhập mã 6 số: ${code}`);
        await humanType(page, "#app_totp, input[name='otp'], input[name='app_totp'], input[autocomplete='one-time-code']", code);
        await sleep(300);
        await safeClick(page, "Verify");
        await sleep(2500);
        continue;
      }
    }

    // 5. Màn hình cấu hình Passkey / Trusted Device (https://github.com/sessions/trusted-device)
    if (currentUrl.includes("github.com/sessions/trusted-device") || currentUrl.includes("/trusted-device")) {
      console.log("⏩ [Passkey / Trusted Device] Phát hiện URL https://github.com/sessions/trusted-device -> Bấm 'Ask me later'...");
      const clicked = await page.evaluate(() => {
        // Tìm element chứa text "Ask me later" hoặc "Not now" hoặc "Don't ask again"
        const candidates = Array.from(document.querySelectorAll("button, a, input[type='submit'], input[type='button'], [role='button']"));
        for (const el of candidates) {
          const txt = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
          if (txt.includes("ask me later") || txt.includes("not now") || txt.includes("don't ask again")) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.click();
            return true;
          }
        }
        // Thử tìm form decline của GitHub
        const declineForm = document.querySelector("form[action*='/sessions/trusted-device/decline'], form[action*='decline']");
        if (declineForm) {
          const submitBtn = declineForm.querySelector("button, input[type='submit']");
          if (submitBtn) {
            submitBtn.click();
            return true;
          }
          declineForm.submit();
          return true;
        }
        return false;
      }).catch(() => false);

      if (clicked) {
        console.log("✅ Đã bấm 'Ask me later' thành công!");
      } else {
        await safeClick(page, "Ask me later");
      }
      await sleep(2000);
      continue;
    }

    // 5b. Bỏ qua Passkey thông thường nếu xuất hiện nút "Ask me later" trên màn hình khác
    const generalAskLater = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("button, a, input[type='submit'], input[type='button'], [role='button']"));
      for (const el of candidates) {
        const txt = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
        if (txt === "ask me later" || txt === "not now") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (generalAskLater) {
      console.log("⏩ Bỏ qua thông báo Passkey ('Ask me later')...");
      await sleep(2000);
      continue;
    }

    // 6. Xử lý Sudo Mode (nếu GitHub hỏi lại password trước khi authorize)
    const sudoField = await safeQuery(page, "#sudo_password, input[name='sudo_password']");
    if (sudoField) {
      console.log("🔑 [Sudo Mode] Xác nhận lại mật khẩu GitHub...");
      await humanType(page, "#sudo_password, input[name='sudo_password']", password);
      await sleep(500);
      await safeClick(page, "Confirm password");
      await sleep(1800);
      continue;
    }

    // 7. Trang ủy quyền OAuth ("Authorize SeekAI")
    if (currentUrl.includes("github.com/login/oauth/authorize")) {
      console.log("⚡ [OAuth] Xử lý trang ủy quyền GitHub ('Authorize SeekAI')...");
      
      // 1. Cuộn trang xuống và hover vào vùng form
      try {
        await page.evaluate(() => {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        });
        await sleep(600);
      } catch {}

      // 2. Kích hoạt trạng thái nút và gửi form
      await page.evaluate(() => {
        const selectors = [
          "#js-oauth-authorize-btn",
          "button[name='authorize'][value='1']",
          "button[name='authorize']",
          "button[type='submit'].btn-primary",
          "input[name='authorize']"
        ];

        let btn = null;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            btn = el;
            break;
          }
        }

        if (!btn) {
          const buttons = Array.from(document.querySelectorAll("button, input[type='submit']"));
          btn = buttons.find(b => {
            const txt = (b.innerText || b.value || b.textContent || "").toLowerCase().trim();
            return txt.includes("authorize") || txt.includes("ủy quyền");
          });
        }

        if (btn) {
          btn.scrollIntoView({ behavior: "smooth", block: "center" });

          // Bỏ thuộc tính disabled nếu GitHub chưa kịp enable
          if (btn.disabled || btn.hasAttribute("disabled")) {
            btn.disabled = false;
            btn.removeAttribute("disabled");
            btn.classList.remove("disabled");
          }

          btn.focus();
          btn.click();

          const form = btn.closest("form") || document.querySelector("form.js-oauth-form, form[action*='/login/oauth/authorize']");
          if (form) {
            if (typeof form.requestSubmit === "function") {
              try { form.requestSubmit(btn); } catch { form.submit(); }
            } else {
              form.submit();
            }
          }
        }
      }).catch(() => {});

      // 3. Sử dụng chuột vật lý Puppeteer click vào tọa độ thực của nút
      try {
        const btnHandle = await page.$("#js-oauth-authorize-btn, button[name='authorize'][value='1'], button.btn-primary");
        if (btnHandle) {
          const box = await btnHandle.boundingBox();
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await sleep(300);
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          }
        }
      } catch {}

      await sleep(2500);
      continue;
    }

    await sleep(1800);
  }
}

async function executeSeekAiFlow(page, account, keyName = "Auto_API_Key_01") {
  console.log(`🌐 [SeekAI] Đang mở ${SIGNUP_URL} (Chờ network idle)...`);

  let onGithubOrDashboard = false;
  const maxReloadAttempts = 6;

  for (let attempt = 1; attempt <= maxReloadAttempts; attempt++) {
    try {
      if (attempt === 1) {
        await page.goto(SIGNUP_URL, { waitUntil: "networkidle2", timeout: 60000 }).catch(async () => {
          await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
        });
      } else {
        console.log(`🔄 [SeekAI Reload #${attempt}/${maxReloadAttempts}] Chưa chuyển sang GitHub -> Tải lại trang...`);
        await sleep(1000);
        await page.reload({ waitUntil: "networkidle2", timeout: 60000 }).catch(async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
        });
      }
    } catch (e) {
      console.warn(`⚠️ Lỗi tải trang SeekAI: ${e.message}`);
    }

    // Đảm bảo network idle trước khi check phần tử
    try {
      if (typeof page.waitForNetworkIdle === "function") {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => {});
      }
    } catch {}

    // Vòng lặp bấm nút GitHub và kiểm tra chuyển hướng trong tối đa 25 giây cho mỗi lượt tải trang
    const pollStart = Date.now();
    while (Date.now() - pollStart < 25000) {
      let curUrl = "";
      try { curUrl = page.url(); } catch {}

      if (curUrl.includes("github.com") || (curUrl.includes("seekai.cc") && !curUrl.includes("sign-up") && !curUrl.includes("sign-in"))) {
        onGithubOrDashboard = true;
        console.log(`-> 🚀 Đã chuyển hướng thành công: ${curUrl}`);
        break;
      }

      console.log(`⏳ [Lần thử #${attempt}] Tích checkbox điều khoản & Tìm nút 'Tiếp tục với GitHub'...`);

      // 1. Tích vào Checkbox đồng ý điều khoản
      await page.evaluate(() => {
        const chks = document.querySelectorAll("input[type='checkbox'], [role='checkbox']");
        for (const chk of chks) {
          if (!chk.checked) chk.click();
        }
        const labels = Array.from(document.querySelectorAll("label, span, div, p"));
        for (const l of labels) {
          const t = (l.innerText || "").toLowerCase();
          if (t.includes("đồng ý") || t.includes("thỏa thuận") || t.includes("agreement") || t.includes("user agreement")) {
            const input = l.querySelector("input[type='checkbox']");
            if (input && !input.checked) input.click();
            else l.click();
            break;
          }
        }
      }).catch(() => {});

      await sleep(600);

      // 2. Tìm và Bấm nút Tiếp tục với GitHub (DOM click)
      const btnInfo = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a, [role='button']"));
        for (const b of btns) {
          const txt = (b.innerText || b.textContent || b.getAttribute("aria-label") || "").toLowerCase().trim();
          const isMatch =
            txt.includes("continue with github") ||
            txt.includes("tiếp tục với github") ||
            (txt.includes("github") && (txt.includes("tiếp tục") || txt.includes("continue") || txt.includes("với")));

          if (isMatch) {
            b.scrollIntoView({ behavior: "smooth", block: "center" });
            b.click();
            return { found: true, text: txt };
          }
        }
        return { found: false };
      }).catch(() => ({ found: false }));

      if (btnInfo && btnInfo.found) {
        console.log(`-> ✅ Đã bấm nút: "${btnInfo.text}". Bấm bổ sung bằng chuột vật lý Puppeteer...`);
      }

      // 3. Click bổ sung bằng chuột vật lý Puppeteer
      try {
        const btnHandles = await page.$$("button, a, [role='button']");
        for (const handle of btnHandles) {
          const txt = await page.evaluate(el => (el.innerText || el.textContent || "").toLowerCase(), handle);
          if (txt.includes("github") && (txt.includes("tiếp tục") || txt.includes("continue") || txt.includes("với"))) {
            const box = await handle.boundingBox();
            if (box) {
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await sleep(200);
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              break;
            }
          }
        }
      } catch {}

      // 4. Chờ 5 giây kiểm tra xem đã chuyển hướng sang GitHub chưa
      console.log("⏳ Chờ 5s để trang chuyển hướng sang GitHub...");
      for (let w = 0; w < 5; w++) {
        await sleep(1000);
        try { curUrl = page.url(); } catch {}
        if (curUrl.includes("github.com") || (curUrl.includes("seekai.cc") && !curUrl.includes("sign-up") && !curUrl.includes("sign-in"))) {
          onGithubOrDashboard = true;
          break;
        }
      }

      if (onGithubOrDashboard) {
        console.log(`-> 🚀 Chuyển hướng thành công sang GitHub: ${curUrl}`);
        break;
      }

      console.log(`⚠️ Sau 5s vẫn chưa chuyển sang GitHub (bị miss click), tiến hành bấm lại...`);
    }

    if (onGithubOrDashboard) break;
  }

  if (!onGithubOrDashboard) {
    let finalUrl = "";
    try { finalUrl = page.url(); } catch {}
    if (!finalUrl.includes("github.com") && !finalUrl.includes("seekai.cc/keys")) {
      throw new Error(`Không thể chuyển hướng sang GitHub sau ${maxReloadAttempts} lần thử bấm nút GitHub!`);
    }
  }

  await sleep(2000);

  // Xử lý đăng nhập GitHub & Authorize
  await handleGithubAuthFlow(page, account);

  // Chờ SeekAI tải xong hoàn toàn
  const waitRedirect = Date.now();
  while (Date.now() - waitRedirect < 30000) {
    let u = "";
    try { u = page.url(); } catch {}
    if (u.includes("seekai.cc") && !u.includes("sign-up") && !u.includes("sign-in")) break;
    await sleep(1000);
  }
  await sleep(2000);

  // Thiết lập ngôn ngữ tiếng Anh mặc định qua HTTP Header & LocalStorage
  try {
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });
  } catch {}

  // Chuyển sang Tab "API Keys" bằng cách bấm vào Tab trên giao diện SeekAI (tránh reload lại URL)
  console.log("🔑 [API Key] Bấm vào Tab 'API Keys' trên giao diện...");
  let onKeysPage = false;

  for (let attempt = 0; attempt < 15; attempt++) {
    let curUrl = "";
    try { curUrl = page.url(); } catch {}
    if (curUrl.includes("/keys") || curUrl.includes("/api-keys")) {
      onKeysPage = true;
      break;
    }

    const clicked = await page.evaluate(() => {
      // 1. Tìm các link / tab có href chứa keys hoặc text liên quan đến API Keys
      const link = document.querySelector("a[href*='/keys'], a[href*='keys'], a[href*='api-key']");
      if (link) {
        link.scrollIntoView({ behavior: "smooth", block: "center" });
        link.click();
        return true;
      }

      // 2. Tìm theo text content
      const elements = Array.from(document.querySelectorAll("a, button, [role='tab'], [role='link'], li, div > span"));
      const matchWords = ["api keys", "api key", "khóa api", "keys", "api-keys"];
      for (const el of elements) {
        const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (matchWords.includes(txt) || txt === "api keys" || txt === "api key" || txt === "keys") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);

    if (clicked) {
      await sleep(1800);
      let nextUrl = "";
      try { nextUrl = page.url(); } catch {}
      if (nextUrl.includes("/keys") || nextUrl.includes("/api-keys")) {
        onKeysPage = true;
        break;
      }
    }
    await sleep(1800);
  }

  // Fallback: Nếu không bấm được Tab thì mới dùng page.goto
  if (!onKeysPage) {
    let curUrl = "";
    try { curUrl = page.url(); } catch {}
    if (!curUrl.includes("/keys")) {
      console.log(`⚠️ Không tìm thấy Tab API Keys để click, fallback điều hướng đến ${KEYS_URL}...`);
      await page.goto(KEYS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(1800);
    }
  }

  // Ép giao diện về Tiếng Anh (English) trong LocalStorage & Cookie nếu có
  await page.evaluate(() => {
    try {
      localStorage.setItem("i18nextLng", "en");
      localStorage.setItem("locale", "en");
      localStorage.setItem("NEXT_LOCALE", "en");
      document.cookie = "locale=en; path=/;";
      document.cookie = "NEXT_LOCALE=en; path=/;";
    } catch {}
  }).catch(() => {});

  // 1. Tìm và bấm nút "Create API Key" / "Tạo khóa API" để mở Drawer
  console.log("-> Bấm 'Create API Key' / 'Tạo khóa API'...");
  let drawerReady = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    // Kiểm tra xem Drawer/Modal đã mở chưa
    drawerReady = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll("[role='dialog'], [data-state='open'], [data-radix-portal] [role='dialog'], .sheet-content, div[data-state='open']"));
      for (const d of dialogs) {
        const txt = (d.innerText || "").toLowerCase();
        if (txt.includes("thông tin") || txt.includes("tên") || txt.includes("khóa") || txt.includes("name") || txt.includes("basic info")) {
          const inp = d.querySelector("input:not([type='hidden']):not([type='checkbox'])");
          if (inp) return true;
        }
      }
      return false;
    }).catch(() => false);

    if (drawerReady) {
      console.log("-> ✅ Drawer 'Thêm khóa API' đã mở thành công!");
      break;
    }

    await page.evaluate(() => {
      const matchKeywords = [
        "create api key", "create key", "tạo khóa api", "tạo mã khóa",
        "tạo api key", "tạo key", "add key", "new key", "thêm khóa",
        "thêm api key", "create", "tạo mới"
      ];

      const elements = Array.from(document.querySelectorAll("button, [role='button'], a"));
      for (const el of elements) {
        const txt = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();

        const isMatch = matchKeywords.some(k => txt.includes(k) || aria.includes(k));
        if (isMatch) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.click();
          return true;
        }
      }

      for (const el of elements) {
        const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (txt.includes("key") || txt.includes("khóa") || txt.includes("api")) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);

    await sleep(1800);
  }

  await sleep(1800);

  // 2. Điền chính xác vào ô "Nhập tên" BÊN TRONG DRAWER (Tuyệt đối không lấy ô lọc ở nền)
  console.log(`-> Điền tên khóa: ${keyName} vào ô Tên trong Drawer...`);
  const filled = await page.evaluate((kVal) => {
    // Tìm Drawer đang mở
    const dialogs = Array.from(document.querySelectorAll("[role='dialog'], [data-state='open'], [data-radix-portal] [role='dialog'], div[data-state='open']"));
    const activeDrawer = dialogs.find(d => {
      const txt = (d.innerText || "").toLowerCase();
      return txt.includes("thông tin") || txt.includes("tên") || txt.includes("khóa") || txt.includes("name") || txt.includes("basic info");
    }) || dialogs[0];

    if (!activeDrawer) return false;

    // Tìm ô input Tên bên trong Drawer
    const inputs = Array.from(activeDrawer.querySelectorAll("input:not([type='hidden']):not([type='checkbox']):not([type='radio'])"));
    const nameInput = inputs.find(i => {
      const ph = (i.placeholder || "").toLowerCase();
      const n = (i.name || "").toLowerCase();
      return ph.includes("nhập tên") || ph.includes("tên") || ph.includes("name") || n.includes("name");
    }) || inputs[0];

    if (nameInput) {
      nameInput.focus();
      nameInput.click();

      // Sử dụng React Native Value Setter để cập nhật state của React Hook Form
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(nameInput, kVal);
      } else {
        nameInput.value = kVal;
      }

      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));
      nameInput.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    }
    return false;
  }, keyName).catch(() => false);

  // Gõ bằng bàn phím ảo Puppeteer để chắc chắn 100% React state cập nhật
  try {
    const dialogHandle = await page.$("[role='dialog'], [data-state='open'], div[data-state='open']");
    if (dialogHandle) {
      const inputHandle = await dialogHandle.$("input:not([type='hidden']):not([type='checkbox']):not([type='radio'])");
      if (inputHandle) {
        await inputHandle.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        await page.keyboard.type(keyName, { delay: 30 });
      }
    }
  } catch {}

  await sleep(1800);

  // 3. Bấm nút Submit / Tạo / Lưu BÊN TRONG DRAWER
  console.log("-> Bấm 'Tạo' / 'Save changes' bên trong Drawer...");
  await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll("[role='dialog'], [data-state='open'], [data-radix-portal] [role='dialog'], div[data-state='open']"));
    const activeDrawer = dialogs.find(d => {
      const txt = (d.innerText || "").toLowerCase();
      return txt.includes("thông tin") || txt.includes("tên") || txt.includes("khóa") || txt.includes("name") || txt.includes("basic info");
    }) || dialogs[0];

    if (!activeDrawer) return false;

    const buttons = Array.from(activeDrawer.querySelectorAll("button, input[type='submit']"));
    const submitKeywords = ["tạo", "lưu", "xác nhận", "create", "save changes", "save", "confirm", "submit"];

    for (const b of buttons) {
      const txt = (b.innerText || b.textContent || b.value || "").trim().toLowerCase();
      // Bỏ qua nút Hủy / Đóng
      if (txt.includes("hủy") || txt.includes("cancel") || txt.includes("đóng") || txt.includes("close")) continue;

      if (submitKeywords.some(k => txt === k || txt.includes(k))) {
        b.scrollIntoView({ behavior: "smooth", block: "center" });
        b.click();
        return true;
      }
    }

    const submitBtn = activeDrawer.querySelector("button[type='submit'], button.bg-primary");
    if (submitBtn) {
      submitBtn.click();
      return true;
    }
    return false;
  }).catch(() => {});

  // Chờ Drawer gửi request và đóng lại
  console.log("⏳ Chờ Drawer hoàn tất xử lý...");
  await sleep(1800);

  // 4. Cấp quyền Clipboard & Cài đặt Hook bắt mã API Key
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
      const rows = Array.from(document.querySelectorAll("tbody tr, tr, .key-row"));
      return rows.some((r) => (r.innerText || "").includes(kVal));
    }, keyName).catch(() => false);

    if (targetRowFound) {
      console.log(`-> ✅ Đã tìm thấy khóa [${keyName}] trên bảng danh sách!`);
      break;
    }
    await sleep(1800);
  }

  // 6. Mở Popover & BẤM NÚT COPY ĐỂ LẤY FULL KEY THỰC SỰ
  console.log("-> Mở Popover & Bấm nút 'Copy Key'...");
  let apiKey = null;

  for (let attempt = 0; attempt < 12; attempt++) {
    // 6.1. Mở Popover trên dòng chứa keyName
    await page.evaluate((kVal) => {
      const rows = Array.from(document.querySelectorAll("tbody tr, tr, .key-row"));
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

    // Chờ Popover render hoàn tất
    await sleep(1800);

    // 6.2. Tìm và BẤM NÚT COPY trong Popover / Dialog
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

    await sleep(1800);

    // 6.3. Kiểm tra các nguồn lấy Key:
    // (a) Bắt từ hook clipboard writeText
    const captured = await page.evaluate(() => window.__capturedSeekApiKey).catch(() => null);
    if (isRealApiKey(captured)) {
      apiKey = captured;
      console.log("-> [Thành Công] Bắt được Full API Key từ Clipboard Event!");
      break;
    }

    // (b) Đọc trực tiếp từ Clipboard của trình duyệt
    const clipText = await page.evaluate(() => {
      return navigator.clipboard ? navigator.clipboard.readText().catch(() => null) : null;
    }).catch(() => null);
    if (isRealApiKey(clipText)) {
      apiKey = clipText;
      console.log("-> [Thành Công] Đọc được Full API Key từ Clipboard browser!");
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
      console.log("-> [Thành Công] Trích xuất được Full API Key từ input.value!");
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
      console.log("-> [Thành Công] Trích xuất được Full API Key từ Data Attribute!");
      break;
    }

    await sleep(1800);
  }

  if (!isRealApiKey(apiKey)) {
    throw new Error("Không thể lấy được Full API Key thực sự từ SeekAI (vẫn bị masked hoặc không ấn được nút copy)!");
  }

  console.log(`✨ [SeekAI API Key Thành Công]: ${apiKey}`);

  // 7. Kiểm tra trạng thái Status: Nếu 'Disabled' -> Bấm nút 'Enable' (icon power) và chờ 3s
  console.log(`🔍 [Status Check] Đang kiểm tra trạng thái kích hoạt của khóa [${keyName}]...`);
  for (let checkAttempt = 1; checkAttempt <= 5; checkAttempt++) {
    const statusResult = await page.evaluate((kVal) => {
      const rows = Array.from(document.querySelectorAll("tbody tr, tr, .key-row"));
      const targetRow = rows.find((r) => (r.innerText || "").includes(kVal)) || rows[0];
      if (!targetRow) return { found: false };

      // Tìm status badge trong dòng
      const badge = targetRow.querySelector(
        '[data-slot="status-badge"], span[title="Disabled"], span[title="Enabled"], td[data-column-id="status"]'
      );
      const title = (badge ? badge.getAttribute("title") : "") || "";
      const text = (badge ? badge.innerText || badge.textContent : "") || (targetRow.innerText || "");
      const combined = `${title} ${text}`.toLowerCase();

      const isDisabled = combined.includes("disabled") || combined.includes("vô hiệu") || combined.includes("tắt");
      const isEnabled = combined.includes("enabled") || combined.includes("hoạt động") || combined.includes("kích hoạt") || combined.includes("active");

      if (isDisabled) {
        // Tìm nút Enable (icon lucide-power hoặc aria-label="Enable")
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

        // Fallback: Tìm trong tất cả button của row có svg lucide-power
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

    await sleep(1800);
  }

  return apiKey;
}

export function saveAccountSuccess(username, password, apiKey) {
  const cleanUser = username.trim();
  const cleanPass = password.trim();
  const cleanKey = apiKey.trim();

  let content = "";
  if (fs.existsSync(OUTPUT_FILE)) {
    content = fs.readFileSync(OUTPUT_FILE, "utf8");
  }

  // Đảm bảo xuống dòng nếu cuối file chưa có \n
  const prefix = (content.length > 0 && !content.endsWith("\n")) ? "\n" : "";
  const line = `${prefix}${cleanUser}|${cleanPass}|${cleanKey}\n`;
  fs.appendFileSync(OUTPUT_FILE, line, "utf8");
  console.log(`💾 [ĐÃ LƯU OUTPUT]: ${cleanUser}|${cleanPass}|${cleanKey} -> ${OUTPUT_FILE}`);
}

export async function runAccountWithShard(account, options = {}) {
  const password = account.password || FIXED_PASSWORD;
  const {
    keyName = `Key_${Date.now().toString().slice(-4)}`,
    headless = false,
    folder = "SeekAI-Auto",
    proxyGroup = null,
  } = options;

  console.log(`\n==================================================================`);
  console.log(`🚀 [BẮT ĐẦU ACCOUNT]: ${account.username}`);
  console.log(`==================================================================`);

  const profileMgr = new ShardProfileManager(folder);
  let browser = null;

  try {
    await profileMgr.createProfile(`SEEK-${account.username.slice(0, 10)}`, proxyGroup);
    const wsUrl = await profileMgr.startBrowser(headless);

    browser = await puppeteer.connect({
      browserWSEndpoint: wsUrl,
      defaultViewport: null,
      protocolTimeout: 240000,
    });
    const page = (await browser.pages())[0] || (await browser.newPage());

    const apiKey = await executeSeekAiFlow(page, { ...account, password }, keyName);
    saveAccountSuccess(account.username, password, apiKey);

    return {
      status: "success",
      username: account.username,
      password,
      apiKey,
    };
  } finally {
    if (browser) await browser.disconnect().catch(() => {});
    await profileMgr.destroyProfile();
  }
}
