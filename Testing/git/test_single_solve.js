import { AiAgentRunner } from './ai_agent_runner.js';

(async () => {
  console.log('🧪 [TEST CAPTCHA SOLVER] Khởi chạy test trên Profile clone từ 32231...');
  const runner = new AiAgentRunner({
    proxyMode: 'shard',
    cloneFrom: '32231',
  });

  try {
    const browser = await runner._connectOrLaunchBrowser({ cloneFrom: '32231' });
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    console.log('-> Truy cập trang chủ https://github.com/ ...');
    await page.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await runner._safeSleep(2000);

    console.log('-> Vào trang đăng ký https://github.com/signup ...');
    await page.goto('https://github.com/signup?ref_cta=Sign+up&ref_loc=header+logged+out&ref_page=%2F&source=header-home', {
      referer: 'https://github.com/',
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    await runner._safeSleep(3000);

    // Kiểm tra xem có captcha không
    console.log('-> Kiểm tra trạng thái Captcha...');
    const solved = await runner._handleDataDomeCaptcha(page, 'audio');
    console.log('-> Kết quả giải Captcha:', solved);

    await runner._safeSleep(5000);

    // Kiểm tra xem đã có ô email chưa
    const pageStatus = await page.evaluate(() => {
      const emailInp = document.querySelector("#email, input[type='email'], input[name='user[email]']");
      return {
        url: window.location.href,
        hasEmail: !!emailInp,
        bodyPreview: (document.body ? document.body.innerText : '').slice(0, 300)
      };
    });

    console.log('📊 Trạng thái trang sau giải Captcha:', JSON.stringify(pageStatus, null, 2));
    await page.screenshot({ path: 'Testing/git/test_result.png' });
    console.log('📸 Đã chụp ảnh kết quả: Testing/git/test_result.png');

  } catch (err) {
    console.error('❌ Lỗi kiểm thử:', err.message);
  } finally {
    await runner._cleanup();
    process.exit(0);
  }
})();
