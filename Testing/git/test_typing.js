import { AiAgentRunner } from './ai_agent_runner.js';

(async () => {
  const runner = new AiAgentRunner({ proxyMode: 'shard', cloneFrom: '32231' });
  const browser = await runner._connectOrLaunchBrowser({ cloneFrom: '32231' });
  const pages = await browser.pages();
  const page = pages[0];

  await page.goto('https://github.com/signup', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await runner._safeSleep(3000);

  // Tìm iframe captcha
  const frame = page.frames().find(f => f.url().includes('captcha-delivery.com'));
  if (!frame) {
    console.log('Không có captcha iframe');
    await runner._cleanup();
    return;
  }
  console.log('Tìm thấy captcha iframe:', frame.url());

  // Đợi nút audio xuất hiện trong frame
  console.log('Đang chờ nút Audio xuất hiện trong iframe...');
  await frame.waitForSelector('#captcha__audio__button, [aria-label*="audio"], .captcha-buttons', { timeout: 15000 }).catch(() => null);

  const audioBtn = await frame.$('#captcha__audio__button, [aria-label*="audio"]');
  if (audioBtn) {
    const box = await audioBtn.boundingBox();
    console.log('Audio btn box:', box);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    console.log('Đã click nút Audio. Chờ giao diện Audio load...');
    await runner._safeSleep(3000);
  } else {
    console.log('Không tìm thấy nút Audio!');
  }

  // Chờ các ô input xuất hiện
  await frame.waitForSelector('input[type="text"]', { timeout: 10000 }).catch(() => null);
  const inputs = await frame.$$('input[type="text"]');
  console.log('Inputs count:', inputs.length);

  if (inputs.length > 0) {
    const box0 = await inputs[0].boundingBox();
    console.log('Input 0 box:', box0);
    // Click bằng page.mouse thật
    await page.mouse.click(box0.x + box0.width / 2, box0.y + box0.height / 2);
    await runner._safeSleep(300);

    // Thử gõ '1' bằng page.keyboard
    await page.keyboard.type('1');
    await runner._safeSleep(500);

    // Kiểm tra xem sau khi gõ '1', ô nào có giá trị và ô nào đang active
    const state1 = await frame.evaluate(() => {
      const inps = Array.from(document.querySelectorAll('input[type="text"]'));
      return {
        values: inps.map(i => i.value),
        activeIdx: inps.indexOf(document.activeElement)
      };
    });
    console.log('State after typing 1:', state1);

    // Thử gõ tiếp '2'
    await page.keyboard.type('2');
    await runner._safeSleep(500);

    const state2 = await frame.evaluate(() => {
      const inps = Array.from(document.querySelectorAll('input[type="text"]'));
      return {
        values: inps.map(i => i.value),
        activeIdx: inps.indexOf(document.activeElement)
      };
    });
    console.log('State after typing 2:', state2);
  }

  await runner._cleanup();
})();
