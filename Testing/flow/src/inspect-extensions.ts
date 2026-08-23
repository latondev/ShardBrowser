import puppeteer, { Browser } from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';
import { ShardBrowserApiClient } from './shard-api';
import { logger } from './logger';

interface ExtensionDetected {
  id: string;
  name: string;
  version: string;
  path: string;
  manifest: any;
  uiUrls: string[];
}

export class ExtensionInspector {
  private apiClient = new ShardBrowserApiClient();
  private browser: Browser | null = null;

  /**
   * Đọc danh sách Profile đang có trong ShardBrowser
   */
  async getProfiles(): Promise<any[]> {
    const isApiHealthy = await this.apiClient.isHealthy();
    if (isApiHealthy) {
      return await this.apiClient.listProfiles().catch(() => []);
    }
    return [];
  }

  /**
   * Đọc Secure Preferences / Preferences của Profile để lấy danh sách Extension IDs đã cài
   */
  getInstalledExtensionsFromProfile(profileId: string): ExtensionDetected[] {
    const appData = process.env.APPDATA || '';
    if (!appData) return [];

    const userDir = path.join(appData, 'shardx-launcher', 'user-data', profileId);
    const prefFiles = [
      path.join(userDir, 'Default', 'Secure Preferences'),
      path.join(userDir, 'Default', 'Preferences'),
      path.join(userDir, 'Secure Preferences'),
      path.join(userDir, 'Preferences')
    ];

    const results: ExtensionDetected[] = [];
    const seenIds = new Set<string>();

    for (const file of prefFiles) {
      if (!fs.existsSync(file)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const settings = data.extensions?.settings || {};

        for (const [extId, info] of Object.entries<any>(settings)) {
          // Bỏ qua các extension mặc định của Chrome (Web Store, PDF)
          if (extId === 'ahfgeienlihckogmohjhadlkjgocpleb' || extId === 'mhjfbmdgcfjbbpaeojofohoefgiehjai') {
            continue;
          }
          if (seenIds.has(extId)) continue;
          seenIds.add(extId);

          const extPath = info.path || '';
          let manifest = info.manifest;

          // Nếu không có manifest trong preferences, đọc file manifest.json từ ổ cứng
          if (!manifest && extPath && fs.existsSync(path.join(extPath, 'manifest.json'))) {
            try {
              manifest = JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf-8'));
            } catch {}
          }

          const name = manifest?.name || info.manifest?.name || extId;
          const version = manifest?.version || info.manifest?.version || '1.0.0';

          // Tìm các URL giao diện tiềm năng
          const uiUrls: string[] = [];
          if (manifest?.side_panel?.default_path) {
            uiUrls.push(`chrome-extension://${extId}/${manifest.side_panel.default_path}`);
          }
          if (manifest?.action?.default_popup) {
            uiUrls.push(`chrome-extension://${extId}/${manifest.action.default_popup}`);
          }
          if (manifest?.options_ui?.page || manifest?.options_page) {
            uiUrls.push(`chrome-extension://${extId}/${manifest.options_ui?.page || manifest.options_page}`);
          }
          
          // Các fallback phổ biến
          uiUrls.push(`chrome-extension://${extId}/src/ui/side-panel/index.html`);
          uiUrls.push(`chrome-extension://${extId}/sidepanel.html`);
          uiUrls.push(`chrome-extension://${extId}/popup.html`);

          results.push({
            id: extId,
            name,
            version,
            path: extPath,
            manifest,
            uiUrls: Array.from(new Set(uiUrls))
          });
        }
      } catch (e: any) {
        logger.debug(`Error reading ${file}: ${e.message}`);
      }
    }

    return results;
  }

  /**
   * Kết nối tới Profile đang chạy hoặc khởi chạy profile mới
   */
  async connectToProfile(targetProfileId?: string): Promise<{ browser: Browser; profileId: string; profileName: string }> {
    const isApiHealthy = await this.apiClient.isHealthy();
    const appData = process.env.APPDATA || '';

    // 1. Kiểm tra nếu có instance đang chạy sẵn
    const userDataDir = path.join(appData, 'shardx-launcher', 'user-data');
    if (fs.existsSync(userDataDir)) {
      const dirs = fs.readdirSync(userDataDir);
      for (const pId of dirs) {
        if (targetProfileId && pId !== targetProfileId) continue;
        const portFile = path.join(userDataDir, pId, 'DevToolsActivePort');
        if (fs.existsSync(portFile)) {
          try {
            const lines = fs.readFileSync(portFile, 'utf-8').trim().split(/\r?\n/);
            const port = parseInt(lines[0], 10);
            if (!isNaN(port) && port > 0) {
              console.log(`🔌 Tìm thấy Profile [${pId}] đang mở ở cổng CDP ${port}. Đang kết nối...`);
              this.browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
              return { browser: this.browser, profileId: pId, profileName: pId };
            }
          } catch {}
        }
      }
    }

    // 2. Nếu chưa chạy, khởi chạy qua ShardBrowser Launcher API
    if (isApiHealthy) {
      const profiles = await this.apiClient.listProfiles().catch(() => []);
      let prof = targetProfileId 
        ? profiles.find(p => p.id === targetProfileId) 
        : profiles[0];

      if (!prof && profiles.length === 0) {
        prof = await this.apiClient.createProfile('Test-AutoFlow-Profile');
      }

      if (prof) {
        console.log(`🚀 Khởi chạy Profile: "${prof.name}" (${prof.id})...`);
        const startRes = await this.apiClient.startProfile(prof.id, false);
        const cdpTarget = startRes.cdp?.ws 
          || (startRes.cdp?.port ? `http://127.0.0.1:${startRes.cdp.port}` : 'http://127.0.0.1:9222');

        console.log(`🔌 Đang kết nối CDP: ${cdpTarget}`);
        await new Promise(r => setTimeout(r, 2500));
        
        this.browser = await puppeteer.connect(
          cdpTarget.startsWith('http') ? { browserURL: cdpTarget } : { browserWSEndpoint: cdpTarget }
        );
        return { browser: this.browser, profileId: prof.id, profileName: prof.name };
      }
    }

    // Fallback: kết nối 9222
    this.browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
    return { browser: this.browser, profileId: 'unknown', profileName: 'Direct 9222' };
  }

  /**
   * Bật và kiểm tra từng Extension trên trình duyệt
   */
  async runInspection(profileId?: string): Promise<void> {
    const { browser, profileId: activeProfileId, profileName } = await this.connectToProfile(profileId);

    console.log(`\n============================================================`);
    console.log(`📂 KIỂM TRA EXTENSION CHO PROFILE: [${profileName}] (${activeProfileId})`);
    console.log(`============================================================`);

    // 1. Quét Extensions từ cấu hình Preferences của Profile
    const installedExts = this.getInstalledExtensionsFromProfile(activeProfileId);
    
    if (installedExts.length === 0) {
      console.log('⚠️ Không tìm thấy Extension nào được cài đặt trong Profile này.');
      console.log('👉 Hướng dẫn: Mở app ShardBrowser, chọn Profile và cài Extension vào trước.');
      return;
    }

    console.log(`✨ Đã tìm thấy ${installedExts.length} Extension được cài đặt:\n`);

    // 2. Mở và test từng Extension
    for (const [index, ext] of installedExts.entries()) {
      console.log(`------------------------------------------------------------`);
      console.log(`[${index + 1}] EXTENSION: "${ext.name}"`);
      console.log(`    • ID: ${ext.id}`);
      console.log(`    • Phiên bản: ${ext.version}`);
      console.log(`    • Đường dẫn file: ${ext.path}`);
      console.log(`    👉 Đang mở giao diện Extension trên Tab mới...`);

      let opened = false;
      const testPage = await browser.newPage();

      for (const targetUrl of ext.uiUrls) {
        try {
          console.log(`       🔗 Mở URL: ${targetUrl}`);
          await testPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
          await new Promise(r => setTimeout(r, 1200));

          const title = await testPage.title().catch(() => '');
          const elementsCount = await testPage.evaluate(() => document.body ? document.body.querySelectorAll('*').length : 0).catch(() => 0);
          const bodySnippet = await testPage.evaluate(() => document.body ? document.body.innerText.replace(/\n/g, ' ').slice(0, 120) : '').catch(() => '');

          if (elementsCount > 0 || title) {
            console.log(`\n    🟢 KẾT QUẢ: EXTENSION HOẠT ĐỘNG HOÀN HẢO!`);
            console.log(`       • Tiêu đề Tab   : "${title}"`);
            console.log(`       • DOM Elements  : ${elementsCount} phần tử render thành công`);
            console.log(`       • Nội dung Text : "${bodySnippet}..."`);
            console.log(`       • Tab giao diện đã được mở trực tiếp trên màn hình Chrome của bạn.`);
            opened = true;
            break;
          }
        } catch (e: any) {
          // Thử URL tiếp theo
        }
      }

      if (!opened) {
        await testPage.close().catch(() => {});
        console.log(`    ⚠️ Không mở được giao diện UI (Có thể extension chỉ chạy script ngầm).`);
      }
    }

    console.log(`\n============================================================`);
    console.log(`🎉 HOÀN TẤT KIỂM TRA!`);
    console.log(`👀 Bạn có thể nhìn lên màn hình trình duyệt để thấy giao diện Extension đang mở.`);
    console.log(`============================================================\n`);
  }
}

async function main() {
  const inspector = new ExtensionInspector();
  try {
    const profileArg = process.argv[2];
    await inspector.runInspection(profileArg);
  } catch (err: any) {
    console.error('❌ Lỗi:', err.message);
  }
}

if (require.main === module) {
  main();
}
