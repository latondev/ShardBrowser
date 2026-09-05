import { AiAgentRunner } from './ai_agent_runner.js';

(async () => {
  console.log('🧪 [TEST EXISTING PROFILE] Chạy trực tiếp trên Profile 32231 (không clone)...');
  const runner = new AiAgentRunner({
    profile: '32231',
  });

  try {
    const browser = await runner._connectOrLaunchBrowser({ profile: '32231' });
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    console.log('-> Đang kiểm tra URL hiện tại của profile...');
    console.log('Current URL:', page.url());

    console.log('-> Mở https://github.com/ ...');
    await page.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await runner._safeSleep(2000);

    console.log('-> Bấm Sign up trên Header...');
    const signUpBtn = await page.$("header a[href*='/signup'], a[href*='signup']");
    if (signUpBtn) {
      const box = await signUpBtn.boundingBox();
      if (box) {
        await runner._humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
        await runner._safeSleep(300);
      }
      await signUpBtn.click({ delay: 60 });
      console.log('Đã click Sign up trên Header.');
    } else {
      await page.goto('https://github.com/signup', { referer: 'https://github.com/' });
    }

    await runner._safeSleep(5000);

    const check = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      return {
        url: window.location.href,
        hasEmail: !!document.querySelector("#email, input[type='email']"),
        isRestricted: body.includes("temporarily restricted"),
        isCaptcha: body.includes("Why is this step needed") || !!document.querySelector("iframe[src*='captcha-delivery']"),
        bodySnippet: body.slice(0, 300)
      };
    });

    console.log('📊 Kết quả kiểm tra trên Profile 32231:', JSON.stringify(check, null, 2));
    await page.screenshot({ path: 'Testing/git/profile_32231_result.png' });
    console.log('📸 Đã chụp ảnh kết quả: Testing/git/profile_32231_result.png');

  } catch (err) {
    console.error('❌ Lỗi:', err.message);
  } finally {
    await runner._cleanup();
    process.exit(0);
  }
})();
