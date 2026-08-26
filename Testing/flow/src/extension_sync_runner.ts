import puppeteer, { Browser } from 'puppeteer-core';
import * as fs from 'fs';
import * as path from 'path';
import { ShardBrowserApiClient } from './shard-api';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runExtensionWithConfig(configPath = 'config.json') {
  console.log('\n============================================================');
  console.log('🚀 [FLOW RUNNER] TỰ ĐỘNG KẾT NỐI SHARDX LAUNCHER & RENDER FLOW');
  console.log('============================================================\n');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Không tìm thấy file cấu hình: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`📖 Cấu hình nạp từ [${configPath}]:`);
  console.log(`   • Chế độ (Mode)          : ${config.mode}`);
  console.log(`   • Tỉ lệ (Aspect Ratio)   : ${config.aspectRatio}`);
  console.log(`   • Số đầu ra (OutputCount): ${config.outputCount || 2}`);
  console.log(`   • Thư mục lưu (Folder)   : ${config.download?.folder || './downloads/farm-project'}`);

  const promptList = config.prompts && config.prompts.length > 0 ? config.prompts : [config.prompt];
  const targetPrompt = promptList[0];
  console.log(`   • Prompt: "${targetPrompt}"`);

  // 1. Kết nối qua ShardBrowser Launcher API (Độc lập 100% như tool Git)
  const client = new ShardBrowserApiClient();
  let browser: Browser;
  let targetProfileId: string | null = null;
  const isHealthy = await client.isHealthy();

  if (isHealthy) {
    console.log('\n🔗 1. [ShardX Launcher] Đã phát hiện ShardBrowser Launcher đang chạy...');
    const profiles = await client.listProfiles();
    let profile = profiles.find(p => (p.folder || '').toLowerCase() === 'veo3' || p.name.includes('tuanvu1568'));

    if (!profile) {
      console.log('✨ [ShardX] Đang tạo Profile mới nhóm [Veo3]...');
      profile = await client.createProfile('Veo3-Flow-Runner', 'Veo3');
    }

    targetProfileId = profile.id;
    let cdpPort = profile.cdp?.port;
    let cdpWs = (profile.cdp as any)?.web_socket_debugger_url || profile.cdp?.ws;

    if (!profile.running || !cdpPort) {
      console.log(`🚀 [ShardX] Khởi chạy Profile [${profile.name}] (ID: ${profile.id}) qua Launcher...`);
      try {
        const startRes: any = await client.startProfile(profile.id, false);
        const cdpObj = startRes?.cdp;
        cdpPort = cdpObj?.port || profile.cdp?.port || 59664;
        cdpWs = cdpObj?.web_socket_debugger_url || cdpObj?.ws || profile.cdp?.ws;
        console.log(`✅ [ShardX] Profile đã bật thành công! Cổng CDP: ${cdpPort}`);
      } catch (startErr: any) {
        console.warn(`⚠️ [ShardX] Lỗi gọi startProfile (${startErr.message}) -> Dùng cổng mặc định`);
        cdpPort = 59664;
      }
    } else {
      console.log(`⚡ [ShardX] Profile [${profile.name}] đang chạy sẵn tại cổng CDP: ${cdpPort}`);
    }

    try {
      if (cdpWs) {
        browser = await puppeteer.connect({ browserWSEndpoint: cdpWs });
      } else {
        browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort || 59664}` });
      }
    } catch (connErr) {
      console.warn(`⚠️ [ShardX] Không kết nối được cổng ${cdpPort} (${(connErr as Error).message}) -> Thử fallback 59664...`);
      browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:59664' });
    }
  } else {
    console.log('\n⚠️ [ShardX Launcher] Launcher chưa bật, fallback kết nối trực tiếp CDP cổng 59664...');
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:59664' });
  }

  const extId = 'efkiebdjefdlcplbhbiipaeefpblijfl';

  // 2. Mở Google Flow và TẠO MỘT DỰ ÁN MỚI
  console.log('\n🌐 2. Mở Google Flow và khởi tạo Canvas Dự Án Mới...');
  const pages = await browser.pages();
  let flowPage = pages.find(p => p.url().includes('labs.google/fx'));
  if (!flowPage) {
    flowPage = pages[0] || await browser.newPage();
    await flowPage.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'networkidle2' });
  }
  await flowPage.bringToFront();
  await delay(1000);

  // Đóng banner popup quảng cáo nếu có
  for (let i = 0; i < 2; i++) {
    await flowPage.evaluate(() => {
      const closeEls = Array.from(document.querySelectorAll('button, div[role="button"], svg, i'));
      for (const el of closeEls) {
        const txt = (el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if (txt === '✕' || txt === 'x' || txt === 'close' || txt === 'đóng' || aria.includes('close') || aria.includes('đóng')) {
          const btn = (el.closest('button, [role="button"]') || el) as HTMLElement;
          btn.click();
        }
      }
    });
    await delay(300);
  }

  // Tạo dự án mới
  if (!flowPage.url().includes('/project/')) {
    console.log('📂 Bấm nút "+ Dự án mới" trên trang chủ...');
    await flowPage.evaluate(() => {
      const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const target = allBtns.find(b => (b.textContent || '').includes('Dự án mới') || (b.textContent || '').includes('New project') || (b.textContent || '').includes('add_2'));
      if (target) (target as HTMLElement).click();
    });
    for (let i = 0; i < 20; i++) {
      await delay(500);
      if (flowPage.url().includes('/project/')) break;
    }
  } else {
    console.log('📂 Đang ở Canvas project, bấm "+" trên topbar để tạo dự án mới toanh...');
    await flowPage.evaluate(() => {
      const topBtns = Array.from(document.querySelectorAll('button'));
      const addBtn = topBtns.find(b => {
        const r = b.getBoundingClientRect();
        return r.y < 80 && (b.textContent?.includes('add') || b.querySelector('i')?.textContent?.includes('add'));
      });
      if (addBtn) addBtn.click();
    });
    await delay(2000);
  }

  console.log(`🎉 [CANVAS DỰ ÁN MỚI ĐÃ SẴN SÀNG]: ${flowPage.url()}`);
  await delay(1500);

  // Nếu bị chuyển sang /trash, quay lại ngay
  if (flowPage.url().includes('/trash')) {
    await flowPage.goto(flowPage.url().replace('/trash', ''), { waitUntil: 'networkidle2' });
    await delay(1500);
  }

  // 3. Mở tab Extension Context và đồng bộ Storage
  console.log('\n🧩 3. Đồng bộ cấu hình vào Extension Storage...');
  const extUrl = `chrome-extension://${extId}/src/ui/side-panel/index.html`;
  let extPage = pages.find(p => p.url().includes(extId));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(extUrl, { waitUntil: 'networkidle2' });
  }

  const modeMap: Record<string, string> = {
    'text-to-video': 'textToVideo',
    'text-to-image': 'textToImage',
    'image-to-video': 'imageToVideo'
  };
  const modeKey = modeMap[config.mode] || 'textToImage';
  const targetFolder = config.download?.folder || './downloads/farm-project';
  const folderName = path.basename(targetFolder);
  const delayMin = config.delayRange ? config.delayRange[0] : 15;
  const delayMax = config.delayRange ? config.delayRange[1] : 25;

  await extPage.evaluate(async (settings: any) => {
    return new Promise(resolve => {
      const ch = (globalThis as any).chrome;
      if (ch && ch.storage && ch.storage.local) {
        ch.storage.local.get('flow_automation_settings', (data: any) => {
          const current = data?.flow_automation_settings || {};
          const updated = {
            ...current,
            defaultMode: settings.modeKey,
            aspectRatio: settings.aspectRatio || '16:9',
            outputCount: settings.outputCount || 2,
            folderName: settings.folderName,
            promptDelaySecondsMin: settings.delayMin,
            promptDelaySecondsMax: settings.delayMax,
            hideTipBeforeUse: true
          };
          ch.storage.local.set({ flow_automation_settings: updated }, () => {
            resolve(updated);
          });
        });
      } else {
        resolve(null);
      }
    });
  }, { modeKey, aspectRatio: config.aspectRatio, outputCount: config.outputCount, folderName, delayMin, delayMax });

  console.log('✅ Đã cập nhật xong bộ nhớ Extension Storage!');

  // 4. Focus và Nhập Prompt chuẩn Slate.js Editor
  await delay(1200);
  await flowPage.bringToFront();
  console.log('\n🎨 4. Focus chính xác ô Slate Editor và Nhập câu lệnh...');

  if (flowPage.url().includes('/trash')) {
    await flowPage.goto(flowPage.url().replace('/trash', ''), { waitUntil: 'networkidle2' });
    await delay(1500);
  }

  // Đóng toast cũ nếu có
  await flowPage.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, div, span'));
    const closeBtn = btns.find(b => {
      const r = b.getBoundingClientRect();
      return r.y < 200 && (b.textContent || '').trim() === 'Đóng';
    });
    if (closeBtn) (closeBtn as HTMLElement).click();
  });
  await delay(300);

  // Lấy tọa độ chính xác của Slate Editor
  const slateCoords = await flowPage.evaluate(() => {
    const editor = document.querySelector('div[data-slate-editor="true"]');
    if (editor) {
      const r = editor.getBoundingClientRect();
      return { x: r.x + 30, y: r.y + 10 };
    }
    return { x: 300, y: 645 };
  });

  console.log(`👉 Click Slate Editor tại: (${Math.round(slateCoords.x)}, ${Math.round(slateCoords.y)})`);
  await flowPage.mouse.click(slateCoords.x, slateCoords.y);
  await delay(300);

  // Xóa nội dung cũ và gõ prompt bằng bàn phím ảo
  await flowPage.keyboard.down('Control');
  await flowPage.keyboard.press('KeyA');
  await flowPage.keyboard.up('Control');
  await flowPage.keyboard.press('Backspace');
  await delay(200);

  console.log('⌨️ Đang nhập câu prompt...');
  await flowPage.keyboard.type(targetPrompt, { delay: 20 });
  await delay(800);

  // 5. Submit bằng Enter
  console.log('🚀 5. Gửi lệnh Render...');
  await flowPage.keyboard.press('Enter');
  await delay(1500);

  // 6. Theo dõi tiến độ Render từ Google Flow
  console.log('\n⏳ 6. Đang theo dõi tiến độ Render từ Google AI...');
  const startTime = Date.now();
  const maxWaitMs = 120000;
  let hasStarted = false;

  while (Date.now() - startTime < maxWaitMs) {
    await delay(3000);
    const status = await flowPage.evaluate(() => {
      const allText = Array.from(document.querySelectorAll('*')).map(el => (el as HTMLElement).innerText || '');
      const percent = allText.find(t => /^\d{1,2}%$/.test(t.trim()));
      const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.naturalWidth > 500);

      return {
        percent,
        renderedCount: imgs.length
      };
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`   [${elapsed}s] Tiến độ: ${status.percent || (status.renderedCount > 0 ? 'Hoàn tất' : 'Đang xử lý')} | Số ảnh tạo được: ${status.renderedCount}`);

    if (status.percent) hasStarted = true;

    if (hasStarted && !status.percent && status.renderedCount >= (config.outputCount || 1)) {
      console.log('🎉 Render ảnh hoàn tất 100%!');
      break;
    }
    if (elapsed >= 30 && status.renderedCount >= (config.outputCount || 1)) {
      console.log('🎉 Render ảnh hoàn tất!');
      break;
    }
  }

  // 7. Trích xuất và Tải ảnh Render Thành Phẩm (1376x768) về thư mục downloads
  console.log(`\n📥 7. Tải và lưu ảnh về thư mục: "${targetFolder}"...`);
  const resolvedTargetDir = path.resolve(process.cwd(), targetFolder);
  if (!fs.existsSync(resolvedTargetDir)) {
    fs.mkdirSync(resolvedTargetDir, { recursive: true });
  }

  const finalImages = await flowPage.evaluate(async () => {
    const list: { src: string; base64?: string; width: number; height: number }[] = [];
    const seen = new Set<string>();
    const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.naturalWidth > 500);

    for (const img of imgs) {
      const src = img.src || img.getAttribute('src') || '';
      if (!src || seen.has(src)) continue;
      seen.add(src);

      try {
        const res = await fetch(src);
        const blob = await res.blob();
        const reader = new FileReader();
        const b64 = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        list.push({ src, base64: b64, width: img.naturalWidth, height: img.naturalHeight });
      } catch {
        list.push({ src, width: img.naturalWidth, height: img.naturalHeight });
      }
    }
    return list;
  });

  console.log(`🔍 Tìm thấy ${finalImages.length} hình ảnh nông trại nghệ thuật (1376x768).`);
  let savedFiles: string[] = [];
  const baseCleanName = (folderName || 'artwork').replace(/[^a-zA-Z0-9_-]/g, '_');

  for (const [idx, item] of finalImages.entries()) {
    if (item.base64 && item.base64.includes('base64,')) {
      const b64Data = item.base64.split('base64,')[1];
      const imageId = idx + 1;
      const filename = `${imageId}_${baseCleanName}_${Date.now()}.png`;
      const filePath = path.join(resolvedTargetDir, filename);
      fs.writeFileSync(filePath, Buffer.from(b64Data, 'base64'));
      const sizeKb = Math.round(fs.statSync(filePath).size / 1024);
      console.log(`💾 [ĐÃ TẢI ẢNH THÀNH PHẨM VỀ MÁY]: ${filePath} (${sizeKb} KB) [${item.width}x${item.height}]`);
      savedFiles.push(filePath);
    }
  }

  // Dọn dẹp ảnh tạm thời nếu có
  ['current_timeout_state.png', 'farm_final_completed_shot.png'].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });

  console.log('\n============================================================');
  console.log('🏁 TỔNG KẾT TEST TẠO DỰ ÁN MỚI & TẢI ẢNH QUA EXTENSION:');
  console.log(`   • URL Dự án mới            : ${flowPage.url()}`);
  console.log(`   • Prompt                   : "${targetPrompt}"`);
  console.log(`   • Số đầu ra (OutputCount)  : ${config.outputCount || 2}`);
  console.log(`   • Thư mục lưu trữ          : ${resolvedTargetDir}`);
  console.log(`   • Số ảnh tải về máy        : ${savedFiles.length}`);
  console.log(`   • Trạng thái               : ${savedFiles.length > 0 ? '✅ HOÀN TẤT THÀNH CÔNG 100%' : '⚠️ CẦN KIỂM TRA'}`);
  console.log('============================================================\n');

  await browser.disconnect();
}

if (process.argv[1] && process.argv[1].includes('extension_sync_runner')) {
  const configArg = process.argv[2] || 'config.json';
  runExtensionWithConfig(configArg).catch(console.error);
}
