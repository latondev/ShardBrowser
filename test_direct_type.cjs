const puppeteer = require('puppeteer-core');

async function testDirect() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:64818', defaultViewport: null });
  const pages = await browser.pages();
  const flowPage = pages.find(p => p.url().includes('labs.google'));
  if (!flowPage) {
    console.log('No flow page');
    return;
  }

  await flowPage.bringToFront();
  await new Promise(r => setTimeout(r, 500));

  const slateCoords = await flowPage.evaluate(() => {
    const editor = document.querySelector('div[data-slate-editor="true"]');
    if (editor) {
      const r = editor.getBoundingClientRect();
      return { x: r.x + 30, y: r.y + 10 };
    }
    return { x: 300, y: 645 };
  });

  console.log('Clicking Slate at:', slateCoords);
  await flowPage.mouse.click(slateCoords.x, slateCoords.y);
  await new Promise(r => setTimeout(r, 300));

  await flowPage.keyboard.down('Control');
  await flowPage.keyboard.press('KeyA');
  await flowPage.keyboard.up('Control');
  await flowPage.keyboard.press('Backspace');
  await new Promise(r => setTimeout(r, 200));

  console.log('Typing prompt...');
  const prompt = 'A cute little corgi dog wearing sunglasses on a sunny beach, 8k masterpiece';
  await flowPage.keyboard.type(prompt, { delay: 20 });
  await new Promise(r => setTimeout(r, 800));

  console.log('Pressing Enter...');
  await flowPage.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 1500));

  const textNow = await flowPage.evaluate(() => {
    return document.querySelector('div[data-slate-editor="true"]')?.textContent;
  });
  console.log('Editor text after Enter:', textNow);
}

testDirect().catch(console.error);
