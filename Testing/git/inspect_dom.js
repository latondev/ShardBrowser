import puppeteer from 'puppeteer-core';

(async () => {
  try {
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:56174', defaultViewport: null });
    const pages = await browser.pages();
    const targetPage = pages[0];
    if (targetPage) {
      console.log('Page URL:', targetPage.url());
      const frames = targetPage.frames();
      console.log('Total Frames:', frames.length);
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        console.log(`\n=== Frame ${i} URL: ${f.url()} ===`);
        const info = await f.evaluate(() => {
          const inps = Array.from(document.querySelectorAll('input'));
          const btns = Array.from(document.querySelectorAll('button'));
          return {
            inputs: inps.map(inp => ({ type: inp.type, val: inp.value, id: inp.id, name: inp.name, outer: inp.outerHTML })),
            buttons: btns.map(b => ({ text: b.innerText, id: b.id, cls: b.className, disabled: b.disabled })),
            body: (document.body ? document.body.innerText : '').slice(0, 300)
          };
        }).catch(() => null);
        console.log(JSON.stringify(info, null, 2));
      }
    }
    browser.disconnect();
  } catch (e) {
    console.error('Err:', e.message);
  }
})();
