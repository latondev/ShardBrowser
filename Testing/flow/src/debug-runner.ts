import puppeteer from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';

async function debugFlow() {
  console.log('🔍 Bắt đầu Debug Live Google Flow...');
  
  const appData = process.env.APPDATA || '';
  const portFile = path.join(appData, 'shardx-launcher', 'user-data', '85223f81-b021-4cd5-a90f-0da20ea8db18', 'DevToolsActivePort');
  
  if (!fs.existsSync(portFile)) {
    console.error('❌ Không tìm thấy file DevToolsActivePort!');
    return;
  }
  
  const lines = fs.readFileSync(portFile, 'utf-8').trim().split(/\r?\n/);
  const port = parseInt(lines[0], 10);
  console.log(`🔌 Kết nối CDP port: ${port}`);
  
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
  const pages = await browser.pages();
  
  let flowPage = pages.find(p => p.url().includes('labs.google'));
  if (!flowPage) {
    flowPage = pages[0];
  }
  
  await flowPage.bringToFront();
  console.log(`🌐 URL hiện tại: ${flowPage.url()}`);
  
  // Chụp ảnh trạng thái ban đầu
  await flowPage.screenshot({ path: path.join(__dirname, '../debug_state_1.png') });
  console.log('📸 Đã chụp debug_state_1.png');
  
  // Kiểm tra danh sách elements trên trang
  const debugInfo = await flowPage.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, a, div, [role="button"]'));
    const items = [];
    for (const el of all) {
      const text = (el.textContent || '').trim();
      const rect = el.getBoundingClientRect();
      if (rect.width > 30 && rect.height > 30 && rect.top >= 0 && rect.top < window.innerHeight) {
        if (text.includes('Dự án') || text.includes('Project') || text.includes('thg 8') || el.querySelector('i')?.textContent?.includes('add')) {
          items.push({
            tag: el.tagName,
            text: text.substring(0, 50),
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            class: (el.getAttribute('class') || '').substring(0, 50)
          });
        }
      }
    }
    return items;
  });
  
  console.log('🎯 Các elements tiềm năng:', JSON.stringify(debugInfo, null, 2));
  
  // Thử click vào nút "+ Dự án mới" hoặc dự án đầu tiên
  const newProjItem = debugInfo.find(i => i.text.includes('Dự án mới') || i.text.includes('New project'));
  if (newProjItem) {
    console.log(`👉 Click tọa độ nút Dự án mới: (${newProjItem.x}, ${newProjItem.y})`);
    await flowPage.mouse.click(newProjItem.x, newProjItem.y);
  } else if (debugInfo.length > 0) {
    // Click vào thẻ đầu tiên
    console.log(`👉 Click thẻ dự án: (${debugInfo[0].x}, ${debugInfo[0].y})`);
    await flowPage.mouse.click(debugInfo[0].x, debugInfo[0].y);
  }
  
  await new Promise(r => setTimeout(r, 4000));
  console.log(`🌐 URL sau khi click: ${flowPage.url()}`);
  
  // Chụp ảnh sau khi mở dự án
  await flowPage.screenshot({ path: path.join(__dirname, '../debug_state_2_canvas.png') });
  console.log('📸 Đã chụp debug_state_2_canvas.png');
  
  // Quét tìm ô Prompt trên Canvas mới
  const promptInputInfo = await flowPage.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('div[contenteditable="true"], div[role="textbox"], textarea, input, [data-placeholder]'));
    return inputs.map(el => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        id: el.id,
        role: el.getAttribute('role'),
        contenteditable: el.getAttribute('contenteditable'),
        placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder'),
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      };
    });
  });
  
  console.log('📝 Các ô nhập Prompt tìm thấy trên Canvas:', JSON.stringify(promptInputInfo, null, 2));
  
  if (promptInputInfo.length > 0) {
    const targetInput = promptInputInfo.find(i => i.w > 100 && i.h > 20) || promptInputInfo[0];
    console.log(`👉 Click vào ô Prompt: (${targetInput.x}, ${targetInput.y})`);
    await flowPage.mouse.click(targetInput.x, targetInput.y);
    await new Promise(r => setTimeout(r, 500));
    
    await flowPage.keyboard.type('A cute little astronaut cat floating in space, neon lights, 8k cinematic');
    await new Promise(r => setTimeout(r, 1000));
    
    await flowPage.screenshot({ path: path.join(__dirname, '../debug_state_3_typed.png') });
    console.log('📸 Đã chụp debug_state_3_typed.png');
    
    // Gửi bằng Enter
    console.log('🚀 Bấm Enter để kích hoạt tạo...');
    await flowPage.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 3000));
    
    await flowPage.screenshot({ path: path.join(__dirname, '../debug_state_4_generating.png') });
    console.log('📸 Đã chụp debug_state_4_generating.png');
  }
  
  await browser.disconnect();
  console.log('✅ Hoàn thành debug live!');
}

debugFlow().catch(err => console.error('❌ Lỗi debug:', err));
