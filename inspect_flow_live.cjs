const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const http = require('http');

async function inspect() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:64818', defaultViewport: null });
  const pages = await browser.pages();
  for (const p of pages) {
    const url = p.url();
    console.log('PAGE:', url);
    if (url.includes('labs.google')) {
      const state = await p.evaluate(() => {
        const text = Array.from(document.querySelectorAll('*')).map(e => e.innerText || '').filter(Boolean);
        const percent = text.find(t => /^\d{1,2}%$/.test(t.trim()));
        const imgs = Array.from(document.querySelectorAll('img')).map(i => ({ src: i.src.slice(0, 50), w: i.naturalWidth, h: i.naturalHeight }));
        const editorText = document.querySelector('div[data-slate-editor="true"]')?.textContent || '';
        return { percent, imgCount: imgs.length, imgs: imgs.slice(0, 5), editorText: editorText.slice(0, 100) };
      });
      console.log('FLOW STATE:', JSON.stringify(state, null, 2));
    }
  }
}

inspect().catch(console.error);
