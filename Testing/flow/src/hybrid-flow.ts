import puppeteer, { Browser, Page, Target } from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';
import { ShardBrowserApiClient } from './shard-api';

export interface HybridFlowOptions {
  profileId?: string;
  group?: string;
  mode?: 'Văn bản thành video' | 'Văn bản thành hình ảnh' | 'Khung hình thành video' | 'Tự động hóa Agent';
  prompts?: string[];
  autoRun?: boolean;
}

export class HybridFlowController {
  private _apiClient = new ShardBrowserApiClient();
  private _browser: Browser | null = null;
  private _flowPage: Page | null = null;
  private _sidePanelPage: Page | null = null;

  async connectOrLaunch(rawProfileId?: string, group?: string): Promise<{ browser: Browser; profileId: string }> {
    const isApiHealthy = await this._apiClient.isHealthy();
    const appData = process.env.APPDATA || '';
    const profileId = (rawProfileId && !rawProfileId.startsWith('--')) ? rawProfileId.trim() : undefined;

    // 1. Kiểm tra instance profile đang chạy sẵn
    const userDataDir = path.join(appData, 'shardx-launcher', 'user-data');
    if (fs.existsSync(userDataDir)) {
      const dirs = fs.readdirSync(userDataDir);
      for (const pId of dirs) {
        if (profileId && pId !== profileId) continue;
        const portFile = path.join(userDataDir, pId, 'DevToolsActivePort');
        if (fs.existsSync(portFile)) {
          try {
            const lines = fs.readFileSync(portFile, 'utf-8').trim().split(/\r?\n/);
            const port = parseInt(lines[0], 10);
            if (!isNaN(port) && port > 0) {
              console.log(`🔌 Kết nối tới ShardBrowser Profile [${pId}] tại cổng CDP ${port}...`);
              this._browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
              return { browser: this._browser, profileId: pId };
            }
          } catch {}
        }
      }
    }

    // 2. Khởi chạy qua API nếu chưa có instance
    if (isApiHealthy) {
      let profiles = await this._apiClient.listProfiles().catch(() => []);
      
      // Lọc theo group nếu có
      if (group && !profileId) {
        const normalizedGroup = group.trim().toLowerCase();
        const filtered = profiles.filter(p => (p.folder || '').trim().toLowerCase() === normalizedGroup);
        if (filtered.length > 0) {
          profiles = filtered;
          console.log(`📁 Đã lọc profile theo Group "${group}" (tìm thấy ${filtered.length} profile)`);
        }
      }

      const targetProf = (profileId ? profiles.find(p => p.id === profileId) : null) || profiles.find(p => p.running) || profiles[0];
      if (targetProf) {
        console.log(`🚀 Khởi chạy profile: "${targetProf.name}" (${targetProf.id}) [Group: ${targetProf.folder || 'None'}]...`);
        const startRes = await this._apiClient.startProfile(targetProf.id, false);
        const cdpTarget = startRes.cdp?.ws || (startRes.cdp?.port ? `http://127.0.0.1:${startRes.cdp.port}` : 'http://127.0.0.1:9222');
        await new Promise(r => setTimeout(r, 2500));
        this._browser = await puppeteer.connect(
          cdpTarget.startsWith('http') ? { browserURL: cdpTarget } : { browserWSEndpoint: cdpTarget }
        );
        return { browser: this._browser, profileId: targetProf.id };
      }
    }

    // Fallback
    console.log('🔌 Kết nối tới cổng CDP mặc định 9222...');
    this._browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
    return { browser: this._browser, profileId: 'default' };
  }

  /**
   * Mở hoặc chuyển tab Google Flow
   */
  async ensureGoogleFlowTab(): Promise<Page> {
    if (!this._browser) throw new Error('Browser chưa kết nối');

    const pages = await this._browser.pages();
    let flowTab = pages.find(p => p.url().includes('labs.google/fx'));

    if (!flowTab) {
      console.log('🌐 Đang mở trang Google Flow: https://labs.google/fx/vi/tools/flow');
      flowTab = await this._browser.newPage();
      await flowTab.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded' });
    } else {
      console.log(`🌐 Tìm thấy tab Google Flow sẵn có: ${flowTab.url()}`);
      await flowTab.bringToFront().catch(() => {});
    }

    this._flowPage = flowTab;
    return flowTab;
  }

  /**
   * Lắng nghe và bắt lấy Target Side Panel của Extension
   */
  async waitForSidePanel(timeoutSeconds: number = 60): Promise<Page> {
    if (!this._browser) throw new Error('Browser chưa kết nối');

    // Kiểm tra xem Side Panel đã mở sẵn chưa
    const checkTargets = async () => {
      const targets = await this._browser!.targets();
      return targets.find(t => t.url().includes('src/ui/side-panel/index.html'));
    };

    let existingTarget = await checkTargets();
    if (existingTarget) {
      const page = await existingTarget.page();
      if (page) {
        this._sidePanelPage = page;
        return page;
      }
    }

    console.log('\n============================================================');
    console.log('👉 [BƯỚC BÁN TỰ ĐỘNG]: Vui lòng click vào ICON EXTENSION');
    console.log('   ở góc phải trên thanh công cụ trình duyệt để mở Side Panel!');
    console.log(`   (Hệ thống đang tự động chờ Side Panel xuất hiện...)`);
    console.log('============================================================\n');

    const startTime = Date.now();
    while ((Date.now() - startTime) < timeoutSeconds * 1000) {
      const target = await checkTargets();
      if (target) {
        const page = await target.page();
        if (page) {
          console.log('🎉 ĐÃ PHÁT HIỆN KHUNG SIDE PANEL CỦA EXTENSION!');
          this._sidePanelPage = page;
          return page;
        }
      }
      await new Promise(r => setTimeout(r, 600));
    }

    throw new Error(`Quá thời gian chờ ${timeoutSeconds}s mà chưa thấy Side Panel mở.`);
  }

  /**
   * Tự động điều khiển Side Panel: tắt popup, chọn mode, điền prompt, bấm chạy
   */
  async configureAndRunExtension(options: HybridFlowOptions): Promise<void> {
    if (!this._sidePanelPage) throw new Error('Side Panel page chưa sẵn sàng.');

    const page = this._sidePanelPage;
    console.log('\n⚙️ [TIẾN HÀNH TỰ ĐỘNG ĐIỀU KHIỂN EXTENSION]...');

    // 1. Tự động đóng modal cảnh báo / hướng dẫn nếu có (Ví dụ "Tôi hiểu rồi", "Đóng")
    try {
      const closedModal = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const dismissBtn = buttons.find(b => 
          b.innerText.includes('Tôi hiểu rồi') || 
          b.innerText.includes('Tôi đã hiểu') ||
          b.innerText.includes('Đóng')
        );
        if (dismissBtn) {
          dismissBtn.click();
          return dismissBtn.innerText.trim();
        }
        return null;
      });

      if (closedModal) {
        console.log(`  ✅ Đã tự động đóng thông báo: "${closedModal}"`);
        await new Promise(r => setTimeout(r, 800));
      }
    } catch {}

    // 2. Chọn chế độ Render (Văn bản thành video / Văn bản thành hình ảnh / ...)
    const targetMode = options.mode || 'Văn bản thành video';
    console.log(`  👉 Đang chọn chế độ: "${targetMode}"...`);

    const modeSelected = await page.evaluate((modeText) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => b.innerText.trim() === modeText);
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, targetMode);

    if (modeSelected) {
      console.log(`  ✅ Đã kích hoạt chế độ: [${targetMode}]`);
    } else {
      console.log(`  ⚠️ Không tìm thấy nút chế độ: ${targetMode} (giữ nguyên chế độ hiện tại)`);
    }

    await new Promise(r => setTimeout(r, 600));

    // 3. Tự động điền Prompts vào Textarea
    const promptList = options.prompts && options.prompts.length > 0 
      ? options.prompts 
      : [
          'Một chú mèo phi hành gia bay lơ lửng trong vũ trụ, ánh sáng neon tím và xanh lam, 8k cinematic, siêu chi tiết'
        ];
    
    const combinedPrompts = promptList.join('\n\n');
    console.log(`  📝 Đang tự động điền ${promptList.length} prompt vào Extension...`);

    const filled = await page.evaluate((text) => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, combinedPrompts);

    if (filled) {
      console.log(`  ✅ Đã điền thành công Prompts:`);
      promptList.forEach((p, i) => console.log(`     [${i + 1}] "${p}"`));
    } else {
      console.log(`  ❌ Không tìm thấy ô Textarea để điền prompt.`);
    }

    await new Promise(r => setTimeout(r, 800));

    // 4. Bấm nút "Chạy" nếu bật autoRun
    if (options.autoRun) {
      console.log('  🚀 Đang tự động bấm nút "Chạy"...');
      const clickedRun = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const runBtn = buttons.find(b => b.innerText.trim() === 'Chạy');
        if (runBtn) {
          runBtn.click();
          return true;
        }
        return false;
      });

      if (clickedRun) {
        console.log('  🎉 ĐÃ BẤM NÚT "CHẠY" THÀNH CÔNG! Quá trình tạo video/ảnh đang chạy tự động.');
      } else {
        console.log('  ⚠️ Không tìm thấy nút "Chạy"');
      }
    } else {
      console.log('\n💡 [Chế độ xem trước]: Script đã điền đầy đủ thông số.');
      console.log('   Bạn có thể xem trên màn hình và bấm nút "Chạy" bất cứ khi nào bạn muốn!');
    }
  }
}

async function main() {
  const controller = new HybridFlowController();
  try {
    const args = process.argv.slice(2);
    const shouldRun = args.includes('--run');
    
    // Parse --group <name>
    const groupArgIdx = args.indexOf('--group');
    const groupName = groupArgIdx !== -1 && args[groupArgIdx + 1] ? args[groupArgIdx + 1] : 'Veo3';

    const profileArg = args.find((a, i) => !a.startsWith('--') && (i === 0 || args[i - 1] !== '--group'));

    console.log('\n🌟 KHỞI CHẠY QUY TRÌNH BÁN TỰ ĐỘNG FLOW AUTOMATION 🌟\n');
    await controller.connectOrLaunch(profileArg, groupName);
    await controller.ensureGoogleFlowTab();
    await controller.waitForSidePanel(60);

    await controller.configureAndRunExtension({
      group: groupName,
      mode: 'Văn bản thành video',
      prompts: [
        'Một chú mèo phi hành gia bay lơ lửng trong vũ trụ, ánh sáng neon tím và xanh lam, 8k cinematic, siêu chi tiết'
      ],
      autoRun: shouldRun
    });

    console.log('\n✅ HOÀN TẤT ĐIỀU KHIỂN EXTENSION!\n');
  } catch (err: any) {
    console.error('❌ Lỗi:', err.message);
  }
}

if (require.main === module) {
  main();
}
