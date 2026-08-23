import puppeteer, { Browser, Page, Target } from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';
import { ShardBrowserApiClient, ProfileMeta } from './shard-api';
import { logger } from './logger';

export interface FullAutoOptions {
  profileIds?: string[];
  mode?: 'Văn bản thành video' | 'Văn bản thành hình ảnh' | 'Khung hình thành video' | 'Tự động hóa Agent';
  prompts?: string[];
  autoCloseProfileAfterRun?: boolean;
  waitBetweenProfilesMs?: number;
}

export class FullAutoRunner {
  private apiClient = new ShardBrowserApiClient();

  /**
   * Lấy danh sách toàn bộ profile từ ShardBrowser Launcher
   */
  async getAllProfiles(): Promise<ProfileMeta[]> {
    const isHealthy = await this.apiClient.isHealthy();
    if (!isHealthy) {
      throw new Error('ShardBrowser Launcher API chưa bật hoặc không phản hồi.');
    }
    return await this.apiClient.listProfiles();
  }

  /**
   * Tự động chạy 1 profile hoàn chỉnh từ A-Z
   */
  async runSingleProfile(profile: ProfileMeta, options: FullAutoOptions): Promise<boolean> {
    console.log('\n============================================================');
    console.log(`🚀 [FULL AUTO] ĐANG BẬT PROFILE: "${profile.name}" (${profile.id})`);
    console.log('============================================================');

    let browser: Browser | null = null;
    try {
      const appData = process.env.APPDATA || '';
      const portFile = path.join(appData, 'shardx-launcher', 'user-data', profile.id, 'DevToolsActivePort');

      let cdpTarget: string | null = null;

      // 1. Nếu profile đang chạy sẵn, lấy port từ DevToolsActivePort
      if (fs.existsSync(portFile)) {
        try {
          const lines = fs.readFileSync(portFile, 'utf-8').trim().split(/\r?\n/);
          const port = parseInt(lines[0], 10);
          if (!isNaN(port) && port > 0) {
            cdpTarget = `http://127.0.0.1:${port}`;
            console.log(`⚡ Profile [${profile.name}] đang chạy sẵn ở cổng CDP ${port}.`);
          }
        } catch {}
      }

      // 2. Nếu chưa chạy, bật Profile qua ShardBrowser Launcher API
      if (!cdpTarget) {
        console.log(`⚡ 1. Khởi chạy Profile qua Launcher API...`);
        const startRes = await this.apiClient.startProfile(profile.id, false).catch(() => null);
        if (startRes && startRes.cdp?.port) {
          cdpTarget = startRes.cdp.ws || `http://127.0.0.1:${startRes.cdp.port}`;
        }
        
        // Đợi tạo file DevToolsActivePort
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 600));
          if (fs.existsSync(portFile)) {
            const lines = fs.readFileSync(portFile, 'utf-8').trim().split(/\r?\n/);
            const port = parseInt(lines[0], 10);
            if (!isNaN(port) && port > 0) {
              cdpTarget = `http://127.0.0.1:${port}`;
              break;
            }
          }
        }
      }

      if (!cdpTarget) {
        throw new Error(`Không tìm thấy cổng CDP khả dụng cho profile ${profile.id}`);
      }

      console.log(`🔌 2. Đang kết nối CDP: ${cdpTarget}...`);
      browser = await puppeteer.connect(
        cdpTarget.startsWith('http') ? { browserURL: cdpTarget } : { browserWSEndpoint: cdpTarget }
      );

      // 2. Mở tab Google Flow
      console.log(`🌐 3. Mở tab Google Flow: https://labs.google/fx/vi/tools/flow...`);
      const pages = await browser.pages();
      let flowPage = pages.find(p => p.url().includes('labs.google/fx'));
      if (!flowPage) {
        flowPage = pages[0] || await browser.newPage();
        await flowPage.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded' });
      } else {
        await flowPage.bringToFront().catch(() => {});
      }
      await new Promise(r => setTimeout(r, 2000));

      // 3. Tự động kích hoạt phím tắt bung Side Panel (Ctrl + Shift + Y)
      console.log(`⚡ 4. Tự động gửi phím tắt Ctrl+Shift+Y để bung Side Panel 100% tự động...`);
      try {
        await flowPage.keyboard.press('KeyY', { modifiers: ['Control', 'Shift'] });
      } catch (e: any) {
        logger.debug(`Shortcut press note: ${e.message}`);
      }

      // 4. Bắt Target của Side Panel
      console.log(`🔍 5. Đang bắt Target Side Panel của Extension...`);
      let sidePanelPage: Page | null = null;
      const startTime = Date.now();
      
      while (Date.now() - startTime < 12000) {
        const targets = await browser.targets();
        const spTarget = targets.find(t => t.url().includes('src/ui/side-panel/index.html'));
        if (spTarget) {
          sidePanelPage = await spTarget.page();
          if (sidePanelPage) break;
        }
        await new Promise(r => setTimeout(r, 600));
      }

      if (!sidePanelPage) {
        // Fallback: Thử mở trực tiếp URL Side Panel nếu chưa bắt được
        console.log(`⚠️ Side Panel chưa xuất hiện qua phím tắt, mở trực tiếp URL Extension...`);
        const extId = 'kelchbegmnecahfndfgncgenioagjfom';
        sidePanelPage = await browser.newPage();
        await sidePanelPage.goto(`chrome-extension://${extId}/src/ui/side-panel/index.html`, { waitUntil: 'domcontentloaded' });
      }

      console.log(`🎉 6. Đã kết nối vào giao diện Extension!`);
      await new Promise(r => setTimeout(r, 1500));

      // 5. Tự động đóng modal cảnh báo / hướng dẫn nếu có
      try {
        await sidePanelPage.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const dismissBtn = buttons.find(b => 
            b.innerText.includes('Tôi hiểu rồi') || 
            b.innerText.includes('Tôi đã hiểu') ||
            b.innerText.includes('Đóng')
          );
          if (dismissBtn) dismissBtn.click();
        });
      } catch {}

      await new Promise(r => setTimeout(r, 600));

      // 6. Tự động chọn chế độ render
      const targetMode = options.mode || 'Văn bản thành video';
      console.log(`👉 7. Đang chọn chế độ: "${targetMode}"...`);
      await sidePanelPage.evaluate((mText) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.innerText.trim() === mText);
        if (btn) btn.click();
      }, targetMode);

      await new Promise(r => setTimeout(r, 600));

      // 7. Tự động điền Prompts vào Textarea
      const prompts = options.prompts && options.prompts.length > 0
        ? options.prompts
        : ['Một chú mèo phi hành gia bay lơ lửng trong vũ trụ, ánh sáng neon tím và xanh lam, 8k cinematic, siêu chi tiết'];
      
      console.log(`📝 8. Đang tự động điền ${prompts.length} prompt...`);
      await sidePanelPage.evaluate((text) => {
        const textarea = document.querySelector('textarea');
        if (textarea) {
          textarea.value = text;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, prompts.join('\n\n'));

      prompts.forEach((p, i) => console.log(`   [${i + 1}] "${p}"`));
      await new Promise(r => setTimeout(r, 800));

      // 8. Tự động bấm nút "Chạy" (Run)
      console.log(`🚀 9. Đang tự động bấm nút "Chạy"...`);
      const ran = await sidePanelPage.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const runBtn = buttons.find(b => b.innerText.trim() === 'Chạy');
        if (runBtn) {
          runBtn.click();
          return true;
        }
        return false;
      });

      if (ran) {
        console.log(`✅ [THÀNH CÔNG] ĐÃ KÍCH HOẠT QUÁ TRÌNH TẠO VIDEO CHO PROFILE: "${profile.name}"!`);
      } else {
        console.log(`⚠️ Không tìm thấy nút Chạy, vui lòng kiểm tra giao diện.`);
      }

      // 9. Đóng profile nếu được yêu cầu (để chuyển sang profile tiếp theo)
      if (options.autoCloseProfileAfterRun) {
        console.log(`⏳ Đợi 5 giây để luồng render bắt đầu trước khi đóng profile...`);
        await new Promise(r => setTimeout(r, 5000));
        await browser.disconnect().catch(() => {});
        await this.apiClient.stopProfile(profile.id).catch(() => {});
        console.log(`🛑 Đã đóng profile [${profile.name}] thành công.`);
      }

      return true;
    } catch (err: any) {
      console.error(`❌ Lỗi khi xử lý profile [${profile.name}]:`, err.message);
      if (browser) await browser.disconnect().catch(() => {});
      return false;
    }
  }

  /**
   * Chạy Full Auto tuần tự qua danh sách toàn bộ Profile
   */
  async runAll(options: FullAutoOptions): Promise<void> {
    const allProfiles = await this.getAllProfiles();
    if (allProfiles.length === 0) {
      console.log('⚠️ Không tìm thấy Profile nào trong ShardBrowser.');
      return;
    }

    let targetProfiles = allProfiles;
    if (options.profileIds && options.profileIds.length > 0) {
      targetProfiles = allProfiles.filter(p => options.profileIds!.includes(p.id));
    }

    console.log(`\n============================================================`);
    console.log(`🎯 BẮT ĐẦU CHẠY FULL AUTO CHO TỔNG CỘNG: ${targetProfiles.length} PROFILES`);
    console.log(`============================================================`);

    let successCount = 0;
    for (const [index, profile] of targetProfiles.entries()) {
      console.log(`\n[TIẾN ĐỘ: ${index + 1} / ${targetProfiles.length}]`);
      const ok = await this.runSingleProfile(profile, options);
      if (ok) successCount++;

      if (index < targetProfiles.length - 1 && options.waitBetweenProfilesMs) {
        console.log(`⏳ Chờ ${options.waitBetweenProfilesMs / 1000}s trước khi mở Profile tiếp theo...`);
        await new Promise(r => setTimeout(r, options.waitBetweenProfilesMs));
      }
    }

    console.log('\n============================================================');
    console.log(`🏁 HOÀN TẤT TẤT CẢ! THÀNH CÔNG: ${successCount} / ${targetProfiles.length} PROFILES`);
    console.log('============================================================\n');
  }
}

async function main() {
  const runner = new FullAutoRunner();
  try {
    const args = process.argv.slice(2);
    const isAll = args.includes('--all');
    const autoClose = args.includes('--auto-close');
    const specificProfileId = args.find(a => !a.startsWith('--'));

    const options: FullAutoOptions = {
      mode: 'Văn bản thành video',
      prompts: [
        'Một chú mèo phi hành gia bay lơ lửng trong vũ trụ, ánh sáng neon tím và xanh lam, 8k cinematic, siêu chi tiết'
      ],
      autoCloseProfileAfterRun: autoClose,
      waitBetweenProfilesMs: 3000
    };

    if (specificProfileId) {
      options.profileIds = [specificProfileId];
    } else if (!isAll) {
      // Mặc định chạy 1 profile đầu tiên nếu không có cờ --all
      const profiles = await runner.getAllProfiles();
      if (profiles.length > 0) {
        options.profileIds = [profiles[0].id];
      }
    }

    await runner.runAll(options);
  } catch (err: any) {
    console.error('❌ Lỗi:', err.message);
  }
}

if (require.main === module) {
  main();
}
