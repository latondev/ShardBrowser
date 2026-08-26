import puppeteer, { Browser, Page, Target } from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { ShardBrowserApiClient, ProfileMeta } from './shard-api';
import { FormFiller } from './form-filler';
import { Executor } from './executor';
import { PageNavigator } from './navigator';
import { loadConfig } from './config-loader';
import { TestConfig, GenerationMode } from './types';
import { logger } from './logger';

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export interface FullAutoOptions {
  configPath?: string;
  profileIds?: string[];
  group?: string;
  mode?: GenerationMode | string;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  outputCount?: number;
  startIndex?: number;
  prompts?: string[];
  delayRange?: [number, number];
  download?: {
    enabled?: boolean;
    folder?: string;
    quality?: '1080p' | '2K' | '4K';
    autoRename?: boolean;
  };
  timeout?: number;
  autoCloseProfileAfterRun?: boolean;
  waitBetweenProfilesMs?: number;
}

export class FullAutoRunner {
  private _apiClient = new ShardBrowserApiClient();

  /**
   * Lấy danh sách toàn bộ profile từ ShardBrowser Launcher
   */
  async getAllProfiles(): Promise<ProfileMeta[]> {
    const isHealthy = await this._apiClient.isHealthy();
    if (!isHealthy) {
      throw new Error('ShardBrowser Launcher API chưa bật hoặc không phản hồi.');
    }
    return await this._apiClient.listProfiles();
  }

  /**
   * Tự động chạy 1 profile hoàn chỉnh từ A-Z theo đầy đủ cấu hình config
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

      // 1. Kiểm tra xem profile có cổng CDP đang thực sự mở không
      if (fs.existsSync(portFile)) {
        try {
          const lines = fs.readFileSync(portFile, 'utf-8').trim().split(/\r?\n/);
          const port = parseInt(lines[0], 10);
          if (!isNaN(port) && port > 0 && (await isPortOpen(port))) {
            cdpTarget = `http://127.0.0.1:${port}`;
            console.log(`⚡ Profile [${profile.name}] đang chạy sẵn ở cổng CDP ${port}.`);
          } else {
            console.log(`🧹 Dọn dẹp cổng cũ ${port || ''} và khởi động lại profile mới...`);
            try { fs.unlinkSync(portFile); } catch {}
            await this._apiClient.stopProfile(profile.id).catch(() => {});
            await new Promise(r => setTimeout(r, 600));
          }
        } catch {}
      }

      // 2. Nếu chưa chạy, bật Profile qua ShardBrowser Launcher API
      if (!cdpTarget) {
        console.log(`⚡ 1. Khởi chạy Profile qua Launcher API...`);
        const startRes = await this._apiClient.startProfile(profile.id, false).catch(() => null);
        if (startRes && startRes.cdp?.port) {
          cdpTarget = startRes.cdp.ws || `http://127.0.0.1:${startRes.cdp.port}`;
        }
        
        // Đợi tạo file DevToolsActivePort và kiểm tra port đã sẵn sàng
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 600));
          if (fs.existsSync(portFile)) {
            const lines = fs.readFileSync(portFile, 'utf-8').trim().split(/\r?\n/);
            const port = parseInt(lines[0], 10);
            if (!isNaN(port) && port > 0 && (await isPortOpen(port))) {
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

      // 3. Mở tab Google Flow và đảm bảo đã vào Canvas dự án
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

      const navigator = new PageNavigator(flowPage);
      const formFiller = new FormFiller(flowPage);
      const executor = new Executor(flowPage);

      // TỰ ĐỘNG DỌN DẸP POPUP & MỞ CANVAS DỰ ÁN TRƯỚC TIÊN
      console.log(`📂 4. Đang dọn banner quảng cáo và mở Canvas dự án Google Flow...`);
      await navigator.ensureFlowProjectOpened();
      await new Promise(r => setTimeout(r, 2000));

      const promptList = options.prompts && options.prompts.length > 0
        ? options.prompts
        : ['Một chú mèo phi hành gia bay lơ lửng trong vũ trụ, ánh sáng neon tím và xanh lam, 8k cinematic, siêu chi tiết'];
      const targetMode = options.mode || 'text-to-video';
      const targetAspect = options.aspectRatio || '16:9';
      const targetOutputCount = options.outputCount || 1;
      const startIndex = options.startIndex || 1;
      const timeoutMs = (options.timeout || 60) * 1000;

      // 4. Quét tìm Extension ID đã cài trong Profile
      console.log(`🔍 5. Quét tìm Extension Auto Flow trong Profile...`);
      let detectedExtId: string | null = null;
      const targets = await browser.targets();
      for (const t of targets) {
        const url = t.url ? t.url() : '';
        if (url.startsWith('chrome-extension://')) {
          const match = url.match(/chrome-extension:\/\/([a-z0-9]+)/i);
          if (match && !['ahfgeienlihckogmohjhadlkjgocpleb', 'mhjfbmdgcfjbbpaeojofohoefgiehjai'].includes(match[1])) {
            detectedExtId = match[1];
            console.log(`✨ Phát hiện Extension ID: ${detectedExtId}`);
            break;
          }
        }
      }

      let sidePanelPage: Page | null = null;

      if (detectedExtId) {
        console.log(`⚡ 5. Gửi phím tắt Ctrl+Shift+Y để mở Side Panel Extension...`);
        try {
          await flowPage.keyboard.down('Control');
          await flowPage.keyboard.down('Shift');
          await flowPage.keyboard.press('KeyY');
          await flowPage.keyboard.up('Shift');
          await flowPage.keyboard.up('Control');
        } catch (e: any) {
          logger.debug(`Shortcut note: ${e.message}`);
        }

        const startTime = Date.now();
        while (Date.now() - startTime < 6000) {
          const currentTargets = await browser.targets();
          const spTarget = currentTargets.find(t => t.url().includes('src/ui/side-panel/index.html') || t.url().includes('side-panel'));
          if (spTarget) {
            sidePanelPage = await spTarget.page().catch(() => null);
            if (sidePanelPage) break;
          }
          await new Promise(r => setTimeout(r, 600));
        }

        if (!sidePanelPage) {
          try {
            sidePanelPage = await browser.newPage();
            await sidePanelPage.goto(`chrome-extension://${detectedExtId}/src/ui/side-panel/index.html`, { waitUntil: 'domcontentloaded', timeout: 5000 });
          } catch {
            sidePanelPage = null;
          }
        }
      }

      // ============================================================
      // NHÁNH 1: ĐIỀU KHIỂN QUA EXTENSION SIDE PANEL
      // ============================================================
      if (sidePanelPage) {
        console.log(`🎉 6. Đã kết nối vào giao diện Extension Side Panel!`);
        await new Promise(r => setTimeout(r, 1200));

        // Tự động đóng modal hướng dẫn nếu có
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

        // Chọn chế độ render trên Extension
        const modeLabelMap: Record<string, string> = {
          'text-to-video': 'Văn bản thành video',
          'image-to-video': 'Khung hình thành video',
          'text-to-image': 'Văn bản thành hình ảnh',
          'agent': 'Tự động hóa Agent'
        };
        const extModeText = modeLabelMap[targetMode] || targetMode;
        console.log(`👉 7. Đang chọn chế độ: "${extModeText}" trên Extension...`);
        await sidePanelPage.evaluate((mText) => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const btn = buttons.find(b => b.innerText.trim() === mText);
          if (btn) btn.click();
        }, extModeText);

        await new Promise(r => setTimeout(r, 600));

        // Điền toàn bộ danh sách Prompts vào Extension
        console.log(`📝 8. Đang tự động điền ${promptList.length} prompt vào Extension...`);
        await sidePanelPage.evaluate((text) => {
          const textarea = document.querySelector('textarea');
          if (textarea) {
            textarea.value = text;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, promptList.join('\n\n'));

        promptList.forEach((p, i) => console.log(`   [${i + 1}] "${p}"`));
        await new Promise(r => setTimeout(r, 800));

        // Bấm nút "Chạy" trên Extension
        console.log(`🚀 9. Đang bấm nút "Chạy" trên Extension...`);
        const ran = await sidePanelPage.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, .p-button, [role="button"]'));
          const runBtn = buttons.find(b => {
            const t = (b.textContent || '').trim().toLowerCase();
            return t === 'chạy' || t === 'run' || t === 'bắt đầu' || t === 'start' || t.includes('chạy');
          });
          if (runBtn) {
            (runBtn as HTMLElement).click();
            return true;
          }
          return false;
        });

        if (ran) {
          console.log(`✅ [THÀNH CÔNG] ĐÃ KÍCH HOẠT TẠO VIDEO QUA EXTENSION!`);
        } else {
          console.log(`⚠️ Không tìm thấy nút Chạy trên Side Panel, chuyển sang điều khiển trực tiếp trên web Google Flow...`);
        }
      } else {
        // ============================================================
        // NHÁNH 2: TỰ ĐỘNG THỰC HIỆN TRỰC TIẾP TRÊN WEB GOOGLE FLOW
        // ============================================================
        console.log(`💡 [Chế độ Web Trực Tiếp]: Tự động thực hiện toàn bộ workflow trên Google Flow UI...`);
        await flowPage.bringToFront().catch(() => {});
        await new Promise(r => setTimeout(r, 1500));

        // 1. Tự động bấm vào dự án mới nếu ở trang chủ
        await navigator.ensureFlowProjectOpened();

        // 2. Cài đặt chế độ tạo (Mode: text-to-video / text-to-image)
        console.log(`⚙️ 5. Thiết lập chế độ: ${targetMode}...`);
        await formFiller.setGenerationMode(targetMode);
        await new Promise(r => setTimeout(r, 600));

        // 3. Cài đặt tỉ lệ khung hình (Aspect Ratio: 16:9, 9:16)
        if (targetAspect) {
          console.log(`⚙️ 6. Thiết lập tỉ lệ khung hình: ${targetAspect}...`);
          await formFiller.setAspectRatio(targetAspect);
          await new Promise(r => setTimeout(r, 600));
        }

        // 4. Cài đặt số lượng video (Output Count)
        if (targetOutputCount) {
          console.log(`⚙️ 7. Thiết lập số lượng output: ${targetOutputCount}...`);
          await formFiller.setOutputCount(targetOutputCount);
          await new Promise(r => setTimeout(r, 600));
        }

        // 5. Gửi từng prompt kèm delay
        for (let i = 0; i < promptList.length; i++) {
          const currentPrompt = promptList[i];
          console.log(`📝 [Prompt ${i + 1}/${promptList.length}] Điền: "${currentPrompt.substring(0, 45)}..."`);
          
          await formFiller.fillStartIndex(startIndex + i);
          await formFiller.fillPrompt(currentPrompt);
          await executor.clickStart();
          console.log(`🚀 Đã gửi Prompt [${i + 1}] lên Google Flow!`);

          if (i < promptList.length - 1) {
            const [minD, maxD] = options.delayRange || [10, 20];
            const delaySec = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
            console.log(`⏳ Đang chờ ${delaySec}s trước khi gửi prompt tiếp theo...`);
            await new Promise(r => setTimeout(r, delaySec * 1000));
          }
        }
      }

      // ============================================================
      // 10. CHỜ QUÁ TRÌNH TẠO (RENDER) HOÀN TẤT
      // ============================================================
      console.log(`\n⏳ 10. Đang theo dõi tiến độ render Google Flow (Timeout: ${timeoutMs / 1000}s)...`);
      await executor.waitForExecution(timeoutMs);

      // ============================================================
      // 11. TỰ ĐỘNG TẢI VIDEO / HÌNH ẢNH NẾU ĐƯỢC BẬT
      // ============================================================
      if (options.download?.enabled) {
        const quality = options.download.quality || '1080p';
        console.log(`📥 11. Đang tự động quét và tải media hoàn thành (Chất lượng: ${quality})...`);
        const downloadedCount = await executor.downloadCompletedMedia(quality);
        console.log(`🎉 Đã kích hoạt tải về ${downloadedCount} media!`);
      }

      console.log(`\n✅ [HOÀN THÀNH PROFILE] "${profile.name}" ĐÃ XỬ LÝ TOÀN BỘ WORKFLOW XONG!`);

      // 12. Đóng profile nếu có cờ autoClose
      if (options.autoCloseProfileAfterRun) {
        console.log(`⏳ Đợi 3 giây trước khi đóng profile...`);
        await new Promise(r => setTimeout(r, 3000));
        await browser.disconnect().catch(() => {});
        await this._apiClient.stopProfile(profile.id).catch(() => {});
        console.log(`🛑 Đã đóng profile [${profile.name}].`);
      }

      return true;
    } catch (err: any) {
      console.error(`❌ Lỗi khi xử lý profile [${profile.name}]:`, err.message);
      if (browser) await browser.disconnect().catch(() => {});
      return false;
    }
  }

  /**
   * Chạy Full Auto tuần tự qua danh sách Profile (hỗ trợ lọc Group & nạp Config)
   */
  async runAll(options: FullAutoOptions): Promise<void> {
    const allProfiles = await this.getAllProfiles();
    if (allProfiles.length === 0) {
      console.log('⚠️ Không tìm thấy Profile nào trong ShardBrowser.');
      return;
    }

    let targetProfiles = allProfiles;

    // Lọc theo Group / Folder nếu được chỉ định
    if (options.group) {
      const groupNormalized = options.group.trim().toLowerCase();
      targetProfiles = targetProfiles.filter(p => (p.folder || '').trim().toLowerCase() === groupNormalized);
      console.log(`📁 Đã lọc theo Group: "${options.group}" -> Tìm thấy ${targetProfiles.length} profile.`);
    }

    // Lọc theo danh sách profileIds cụ thể nếu có
    if (options.profileIds && options.profileIds.length > 0) {
      targetProfiles = targetProfiles.filter(p => options.profileIds!.includes(p.id));
    }

    if (targetProfiles.length === 0) {
      console.log(`⚠️ Không có Profile nào thỏa mãn điều kiện lọc.`);
      return;
    }

    console.log(`\n============================================================`);
    console.log(`🎯 BẮT ĐẦU CHẠY FULL AUTO CHO TỔNG CỘNG: ${targetProfiles.length} PROFILES`);
    console.log(`⚙️ Cấu hình: Mode=[${options.mode || 'text-to-video'}] | Ratio=[${options.aspectRatio || '16:9'}] | AutoDownload=[${options.download?.enabled ? 'Bật' : 'Tắt'}]`);
    console.log(`============================================================`);

    let successCount = 0;
    for (const [index, profile] of targetProfiles.entries()) {
      console.log(`\n[TIẾN ĐỘ: ${index + 1} / ${targetProfiles.length}] (Group: ${profile.folder || 'Chưa phân nhóm'})`);
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
    
    // Parse --config <path>
    const configArgIdx = args.indexOf('--config') !== -1 ? args.indexOf('--config') : args.indexOf('-c');
    const customConfigPath = configArgIdx !== -1 && args[configArgIdx + 1] ? args[configArgIdx + 1] : undefined;

    // Nạp file config (ưu tiên config.json -> config.sample.json)
    let configData: Partial<TestConfig> = {};
    const configCandidate = customConfigPath || (fs.existsSync('config.json') ? 'config.json' : 'config.sample.json');
    if (fs.existsSync(configCandidate)) {
      try {
        configData = loadConfig(configCandidate);
        console.log(`📖 Đã nạp cấu hình từ file: "${configCandidate}"`);
      } catch (e: any) {
        console.log(`⚠️ Không thể đọc ${configCandidate}: ${e.message}`);
      }
    }

    // Parse --group <name>
    const groupArgIdx = args.indexOf('--group');
    const groupName = groupArgIdx !== -1 && args[groupArgIdx + 1] ? args[groupArgIdx + 1] : (configData.group || configData.folder || 'Veo3');

    const specificProfileId = args.find((a, i) => !a.startsWith('--') && !a.startsWith('-') && (i === 0 || (!['--group', '--config', '-c'].includes(args[i - 1]))));

    const options: FullAutoOptions = {
      group: groupName,
      mode: configData.mode || 'text-to-video',
      aspectRatio: configData.aspectRatio || '16:9',
      outputCount: configData.outputCount || 1,
      startIndex: configData.startIndex || 1,
      prompts: configData.prompts && configData.prompts.length > 0 ? configData.prompts : (configData.prompt ? [configData.prompt] : undefined),
      delayRange: configData.delayRange || [15, 25],
      download: configData.download || { enabled: true, quality: '1080p' },
      timeout: configData.timeout || 90,
      autoCloseProfileAfterRun: autoClose,
      waitBetweenProfilesMs: 3000
    };

    if (specificProfileId) {
      options.profileIds = [specificProfileId];
    } else if (!isAll && !groupName) {
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
