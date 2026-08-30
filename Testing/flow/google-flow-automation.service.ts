import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import { ShardBrowserApiClient, type ProfileMeta } from './shard-api.service';

const GOOGLE_FLOW_URL = 'https://labs.google/fx/vi/tools/flow';
const DEFAULT_TIMEOUT_MS = 60_000;
const RENDER_TIMEOUT_MS = 180_000;
const DEFAULT_EXTENSION_ID = 'kelchbegmnecahfndfgncgenioagjfom';

export interface FlowMediaInput {
  prompt?: string;
  mode?: 'text-to-image' | 'text-to-video' | 'image-to-video' | 'agent' | string;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | string;
  outputCount?: number;
  quality?: '1080p' | '2K' | '4K' | string;
  projectId?: string;
  sceneId?: string;
  projectName?: string;
  profileId?: string;
  outputDir?: string;
}

export interface FlowGenerationResult {
  jobId?: string;
  files: string[];
  mode?: string;
  prompt: string;
  error?: string;
}

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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class GoogleFlowAutomationService {
  private _apiClient = new ShardBrowserApiClient();
  private _activeBrowsers = new Map<string, Browser>();

  async getProfiles(): Promise<ProfileMeta[]> {
    const healthy = await this._apiClient.isHealthy();
    if (!healthy) return [];
    const list = await this._apiClient.listProfiles().catch(() => []);
    return list.sort((a, b) => {
      if (a.running && !b.running) return -1;
      if (!a.running && b.running) return 1;
      const aFolder = (a.folder || '').toLowerCase();
      const bFolder = (b.folder || '').toLowerCase();
      if (aFolder === 'veo3' && bFolder !== 'veo3') return -1;
      if (aFolder !== 'veo3' && bFolder === 'veo3') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async createMediaFromInput(
    inputJson: string,
    profileId?: string,
    onProgress?: (percent: number, message: string) => void,
  ): Promise<FlowGenerationResult> {
    const input: FlowMediaInput = this.parseInput(inputJson);
    if (!input.prompt?.trim()) {
      throw new Error('Prompt cannot be empty for Google Flow generation');
    }

    const startTime = Date.now();
    const targetProfileId = profileId || input.profileId;
    const { browser, profile } = await this.connectOrLaunchProfile(targetProfileId);

    console.log(`[GoogleFlow] ==========================================`);
    console.log(`[GoogleFlow] Profile: "${profile.name}" (ID: ${profile.id}, Folder: ${profile.folder || 'Veo3'})`);
    console.log(`[GoogleFlow] Mode: ${input.mode || 'text-to-image'} | Aspect: ${input.aspectRatio || '16:9'} | Count: ${input.outputCount || 1}`);
    console.log(`[GoogleFlow] Prompt: "${input.prompt.trim()}"`);
    console.log(`[GoogleFlow] ==========================================`);

    onProgress?.(5, `Connected to profile: ${profile.name}`);

    // 1. Mở hoặc focus Tab Google Flow Canvas
    const pages = await browser.pages();
    let flowPage = pages.find((p) => p.url().includes('labs.google/fx'));
    if (!flowPage) {
      flowPage = pages[0] || (await browser.newPage());
      console.log(`[GoogleFlow] Opening Google Flow: ${GOOGLE_FLOW_URL}`);
      await flowPage.goto(GOOGLE_FLOW_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
    }

    await flowPage.bringToFront().catch(() => {});
    await delay(1500);

    // 2. Dọn banner popup & Đảm bảo ở trong Canvas Dự Án
    onProgress?.(10, 'Preparing Google Flow Canvas...');
    await this.prepareFlowCanvas(flowPage);

    const targetMode = input.mode || 'text-to-image';
    const targetAspect = input.aspectRatio || '16:9';
    const targetCount = input.outputCount || 1;
    const promptText = input.prompt.trim();

    const outputDir = input.outputDir || path.resolve(process.cwd(), 'outputs', 'images');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 3. Quét Extension ID & Nạp Storage
    const extId = this.detectExtensionId(browser, profile.id);
    console.log(`[GoogleFlow] Detected Extension ID: ${extId}`);
    onProgress?.(15, `Connecting to Flow Extension (${extId.slice(0, 8)}...)...`);

    await this.syncExtensionStorage(browser, extId, {
      mode: targetMode,
      aspectRatio: targetAspect,
      outputCount: targetCount,
      outputDir,
      prompt: promptText,
    });

    // 4. Mở Extension UI, điền Prompt vào Textarea & Bấm nút "▷ Chạy" đưa vào HÀNG ĐỢI PROMPT
    onProgress?.(25, 'Loading prompt into Extension Side Panel...');
    const startedViaExtension = await this.triggerExtensionQueue(browser, flowPage, extId, {
      prompt: promptText,
      mode: targetMode,
      aspectRatio: targetAspect,
      outputCount: targetCount,
      outputDir,
    });

    if (startedViaExtension) {
      console.log('🎉 [GoogleFlow] Đã kích hoạt Prompt vào Hàng Đợi Extension thành công!');
      onProgress?.(35, 'Extension is running prompt queue...');
    } else {
      console.log('⚠️ [GoogleFlow] Extension UI chưa nhận lệnh, chuyển sang gõ trực tiếp Canvas...');
      onProgress?.(30, 'Typing prompt directly on Canvas...');
      await this.inputPromptOnCanvas(flowPage, promptText, targetMode, targetAspect, targetCount);
    }

    // Focus lại tab Canvas Google Flow
    await flowPage.bringToFront().catch(() => {});
    await delay(1000);

    // 5. Theo dõi tiến độ Render trên Canvas
    onProgress?.(45, 'Waiting for AI engine to render...');
    console.log('[GoogleFlow] Monitoring render progress on Canvas...');
    await this.monitorRenderProgress(flowPage, targetCount, onProgress);

    // 6. Trích xuất ảnh HD / Video về thư mục VidApp
    onProgress?.(90, 'Extracting rendered media files...');
    console.log('[GoogleFlow] Collecting output files...');
    const files = await this.collectRenderedFiles(flowPage, outputDir, promptText, startTime);

    console.log(`[GoogleFlow] Extracted ${files.length} file(s):`, files);
    onProgress?.(100, `Done! Generated ${files.length} file(s).`);

    return {
      files,
      mode: targetMode,
      prompt: promptText,
    };
  }

  async processMediaQueue(
    profileId: string,
    jobs: Array<{ id: string; input: FlowMediaInput }>,
    onProgress?: (jobId: string, percent: number, message: string) => void,
  ): Promise<FlowGenerationResult[]> {
    if (jobs.length === 0) return [];
    const results: FlowGenerationResult[] = [];

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (!job) continue;
      onProgress?.(job.id, 5, `Starting prompt ${i + 1}/${jobs.length}...`);
      try {
        const res = await this.createMediaFromInput(
          JSON.stringify(job.input),
          profileId,
          (percent, message) => onProgress?.(job.id, percent, message),
        );
        results.push({ ...res, jobId: job.id });
        if (i < jobs.length - 1) {
          await delay(6000);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ jobId: job.id, files: [], prompt: job.input.prompt || '', error: errorMsg });
      }
    }

    return results;
  }

  private detectExtensionId(browser: Browser, profileId?: string): string {
    for (const t of browser.targets()) {
      const url = t.url();
      const m = url.match(/chrome-extension:\/\/([a-z0-9]+)/i);
      if (m && m[1] && !['ahfgeienlihckogmohjhadlkjgocpleb', 'mhjfbmdgcfjbbpaeojofohoefgiehjai'].includes(m[1])) {
        return m[1];
      }
    }

    const appData = process.env.APPDATA || '';
    if (appData && profileId) {
      const userData = path.join(appData, 'shardx-launcher', 'user-data', profileId);
      const prefFiles = [
        path.join(userData, 'Default', 'Secure Preferences'),
        path.join(userData, 'Default', 'Preferences'),
        path.join(userData, 'Secure Preferences'),
      ];

      for (const f of prefFiles) {
        if (fs.existsSync(f)) {
          try {
            const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
            const settings = raw.extensions?.settings || {};
            for (const [id, info] of Object.entries<any>(settings)) {
              const pStr = ((info && info.path) || '').toLowerCase();
              if (pStr.includes('flow') || pStr.includes('extension') || pStr.includes('side-panel') || pStr.includes('auto')) {
                return id;
              }
            }
          } catch { /* ignore */ }
        }
      }
    }

    return DEFAULT_EXTENSION_ID;
  }

  private async syncExtensionStorage(
    browser: Browser,
    extId: string,
    options: { mode: string; aspectRatio: string; outputCount: number; outputDir: string; prompt: string },
  ): Promise<void> {
    const pages = await browser.pages();
    let extPage = pages.find((p) => p.url().includes(extId));

    if (!extPage) {
      extPage = await browser.newPage();
      await extPage.goto(`chrome-extension://${extId}/src/ui/side-panel/index.html`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    const modeMap: Record<string, string> = {
      'text-to-video': 'textToVideo',
      'text-to-image': 'textToImage',
      'image-to-video': 'imageToVideo',
    };
    const modeKey = modeMap[options.mode] || 'textToImage';

    await extPage.evaluate(
      async (settings: any) => {
        return new Promise((resolve) => {
          const ch = (globalThis as any).chrome;
          if (ch && ch.storage && ch.storage.local) {
            ch.storage.local.get('flow_automation_settings', (data: any) => {
              const current = (data && data.flow_automation_settings) || {};
              const updated = {
                ...current,
                defaultMode: settings.modeKey,
                aspectRatio: settings.aspectRatio || '16:9',
                outputCount: settings.outputCount || 1,
                prompts: [settings.prompt],
                folderName: settings.folderName,
                promptDelaySecondsMin: 15,
                promptDelaySecondsMax: 25,
                hideTipBeforeUse: true,
              };
              ch.storage.local.set({ flow_automation_settings: updated }, () => resolve(updated));
            });
          } else {
            resolve(null);
          }
        });
      },
      {
        modeKey,
        aspectRatio: options.aspectRatio,
        outputCount: options.outputCount,
        folderName: path.basename(options.outputDir),
        prompt: options.prompt,
      },
    ).catch(() => {});
  }

  /**
   * Điền prompt vào Textarea của Extension và kích hoạt nút "▷ Chạy" để Extension quản lý Hàng Đợi
   */
  private async triggerExtensionQueue(
    browser: Browser,
    flowPage: Page,
    extId: string,
    options: { prompt: string; mode: string; aspectRatio: string; outputCount: number; outputDir: string },
  ): Promise<boolean> {
    try {
      const pages = await browser.pages();
      let extPage = pages.find((p) => p.url().includes(extId));

      if (!extPage) {
        extPage = await browser.newPage();
        await extPage.goto(`chrome-extension://${extId}/src/ui/side-panel/index.html`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      await extPage.bringToFront().catch(() => {});
      await delay(800);

      // Cuộn lên đầu trang Extension để thấy phần nhập Prompt
      await extPage.evaluate(() => window.scrollTo(0, 0));

      // Đóng modal hướng dẫn nếu có
      await extPage.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const dismissBtn = buttons.find((b) => {
          const t = (b.textContent || '').trim().toLowerCase();
          return t.includes('tôi hiểu') || t.includes('đóng') || t === 'x';
        });
        if (dismissBtn) (dismissBtn as HTMLElement).click();
      }).catch(() => {});

      await delay(400);

      // Chọn Tab Mode tương ứng
      const modeKeywords: Record<string, string[]> = {
        'text-to-video': ['văn bản thành video', 'text to video', 'video'],
        'text-to-image': ['văn bản thành hình ảnh', 'text to image', 'hình ảnh', 'image'],
        'image-to-video': ['khung hình thành video', 'image to video'],
      };
      const kws = modeKeywords[options.mode] || ['hình ảnh', 'image'];

      await extPage.evaluate((keywords) => {
        const buttons = Array.from(document.querySelectorAll('button, [role="tab"], div[role="button"]'));
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          for (const kw of keywords) {
            if (text.includes(kw)) {
              (btn as HTMLElement).click();
              return;
            }
          }
        }
      }, kws).catch(() => {});

      await delay(600);

      // Điền Prompt vào ô Textarea của Extension
      console.log(`[GoogleFlow] Injecting prompt into Extension Textarea: "${options.prompt.slice(0, 40)}..."`);
      const injected = await extPage.evaluate((text) => {
        const textarea = document.querySelector('textarea, input.p-inputtext');
        if (textarea) {
          const proto = textarea instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) {
            setter.call(textarea, text);
          } else {
            (textarea as any).value = text;
          }
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, options.prompt);

      await delay(600);

      // Bấm nút "▷ Chạy" màu xanh ở thanh dưới Extension
      console.log('[GoogleFlow] Clicking Extension "▷ Chạy" button...');
      const ran = await extPage.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, .p-button, [role="button"], input[type="submit"]'));
        const runBtn = buttons.find((b) => {
          const t = (b.textContent || '').trim().toLowerCase();
          return t === 'chạy' || t === 'run' || t === 'bắt đầu' || t.includes('chạy');
        });
        if (runBtn) {
          (runBtn as HTMLElement).click();
          return true;
        }
        return false;
      });

      await delay(1000);
      return Boolean(injected && ran);
    } catch (e: any) {
      console.warn(`[GoogleFlow] triggerExtensionQueue error: ${e.message}`);
      return false;
    }
  }

  private async inputPromptOnCanvas(
    flowPage: Page,
    promptText: string,
    mode: string,
    aspectRatio: string,
    outputCount: number,
  ): Promise<void> {
    await flowPage.bringToFront();
    await delay(800);

    // 1. Switch Mode / Model if buttons are accessible on Canvas
    try {
      await flowPage.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const configBtn = buttons.find((b) => {
          const t = (b.textContent || '').toLowerCase();
          return t.includes('veo') || t.includes('imagen') || t.includes('banana') || (b.querySelector('i') && b.querySelector('i')?.textContent?.includes('tune')) || (b.querySelector('i') && b.querySelector('i')?.textContent?.includes('crop'));
        });
        if (configBtn) (configBtn as HTMLElement).click();
      }).catch(() => {});
      await delay(400);

      const modeKeywords: Record<string, string[]> = {
        'text-to-video': ['văn bản thành video', 'text to video', 'veo 3', 'veo'],
        'text-to-image': ['văn bản thành hình ảnh', 'text to image', 'hình ảnh', 'image', 'imagen 3', 'imagen'],
      };
      const kws = modeKeywords[mode] || [mode.toLowerCase()];
      await flowPage.evaluate((keywords) => {
        const buttons = Array.from(document.querySelectorAll('button, [role="tab"], div[type="button"]'));
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          for (const kw of keywords) {
            if (text.includes(kw)) {
              (btn as HTMLElement).click();
              return;
            }
          }
        }
      }, kws).catch(() => {});
      await delay(300);

      // Set aspect ratio if available
      await flowPage.evaluate((r) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const b = buttons.find((el) => (el.textContent || '').trim() === r);
        if (b) (b as HTMLElement).click();
      }, aspectRatio).catch(() => {});
    } catch { /* ignore */ }

    await delay(500);

    // 2. Dismiss any Toast/Modal
    await flowPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, div, span'));
      const closeBtn = btns.find((b) => {
        const r = b.getBoundingClientRect();
        return r.y < 200 && (b.textContent || '').trim().toLowerCase().includes('đóng');
      });
      if (closeBtn) (closeBtn as HTMLElement).click();
    }).catch(() => {});
    await delay(300);

    // 3. Locate Slate.js ContentEditable Editor on Canvas
    console.log('[GoogleFlow] Locating Slate.js Editor...');
    const slateCoords = await flowPage.evaluate(() => {
      const editor = document.querySelector('div[data-slate-editor="true"], div[role="textbox"], div[contenteditable="true"]');
      if (editor) {
        const r = editor.getBoundingClientRect();
        return { x: r.x + 30, y: r.y + 10 };
      }
      return { x: 300, y: 645 };
    });

    console.log(`[GoogleFlow] Clicking Slate.js Editor at (${Math.round(slateCoords.x)}, ${Math.round(slateCoords.y)})...`);
    await flowPage.mouse.click(slateCoords.x, slateCoords.y);
    await delay(300);

    // 4. Select All, Delete Old Text & Type New Prompt
    await flowPage.keyboard.down('Control').catch(() => {});
    await flowPage.keyboard.press('KeyA').catch(() => {});
    await flowPage.keyboard.up('Control').catch(() => {});
    await flowPage.keyboard.press('Backspace').catch(() => {});
    await delay(200);

    console.log('[GoogleFlow] Typing prompt via Virtual Keyboard...');
    await flowPage.keyboard.type(promptText, { delay: 15 });
    await delay(800);

    // 5. Submit with Enter Key
    console.log('[GoogleFlow] Submitting Render with Enter key...');
    await flowPage.keyboard.press('Enter');
    await delay(1500);
  }

  private async connectOrLaunchProfile(profileId?: string): Promise<{ browser: Browser; profile: ProfileMeta }> {
    const appData = process.env.APPDATA || '';
    const isHealthy = await this._apiClient.isHealthy();
    let profiles: ProfileMeta[] = [];

    if (isHealthy) {
      profiles = await this._apiClient.listProfiles().catch(() => []);
    }

    let targetProfile: ProfileMeta | null = null;

    if (profileId && profileId !== 'default') {
      targetProfile = profiles.find((p) => p.id === profileId || p.name === profileId) || null;
    }

    if (!targetProfile && profiles.length > 0) {
      targetProfile =
        profiles.find((p) => (p.folder || '').toLowerCase() === 'veo3' && p.running) ||
        profiles.find((p) => (p.folder || '').toLowerCase() === 'veo3') ||
        profiles.find((p) => p.name.toLowerCase().includes('tuanvu1568')) ||
        profiles.find((p) => p.running) ||
        profiles[0]!;
    }

    if (!targetProfile) {
      targetProfile = { id: profileId || 'default', name: 'Default Profile' };
    }

    const profId = targetProfile.id;
    const existing = this._activeBrowsers.get(profId);
    if (existing && existing.connected) {
      return { browser: existing, profile: targetProfile };
    }

    const portFile = path.join(appData, 'shardx-launcher', 'user-data', profId, 'DevToolsActivePort');
    let cdpTarget: string | null = null;

    if (fs.existsSync(portFile)) {
      try {
        const lines = fs.readFileSync(portFile, 'utf-8').trim().split(/\r?\n/);
        const port = parseInt(lines[0]!, 10);
        if (!isNaN(port) && port > 0 && (await isPortOpen(port))) {
          cdpTarget = `http://127.0.0.1:${port}`;
        } else {
          try { fs.unlinkSync(portFile); } catch {}
          await this._apiClient.stopProfile(profId).catch(() => {});
          await delay(600);
        }
      } catch { /* ignore */ }
    }

    if (!cdpTarget && isHealthy && targetProfile.id !== 'default') {
      console.log(`[GoogleFlow] Starting ShardBrowser profile: ${targetProfile.name} (${targetProfile.id})...`);
      const startRes = await this._apiClient.startProfile(targetProfile.id, false).catch(() => null);
      if (startRes && startRes.cdp && startRes.cdp.port) {
        cdpTarget = startRes.cdp.ws || `http://127.0.0.1:${startRes.cdp.port}`;
      } else {
        for (let i = 0; i < 20; i++) {
          await delay(600);
          if (fs.existsSync(portFile)) {
            const lines = fs.readFileSync(portFile, 'utf-8').trim().split(/\r?\n/);
            const port = parseInt(lines[0]!, 10);
            if (!isNaN(port) && port > 0 && (await isPortOpen(port))) {
              cdpTarget = `http://127.0.0.1:${port}`;
              break;
            }
          }
        }
      }
    }

    if (!cdpTarget) {
      throw new Error(`Could not connect to CDP port for profile [${targetProfile.name}]. Please ensure ShardBrowser Launcher is running.`);
    }

    console.log(`[GoogleFlow] Connected to CDP endpoint: ${cdpTarget}`);
    const browser = await puppeteer.connect(
      cdpTarget.startsWith('http') ? { browserURL: cdpTarget, defaultViewport: null } : { browserWSEndpoint: cdpTarget, defaultViewport: null },
    );

    browser.on('disconnected', () => {
      this._activeBrowsers.delete(profId);
    });

    this._activeBrowsers.set(profId, browser);
    return { browser, profile: targetProfile };
  }

  private async prepareFlowCanvas(page: Page): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], i, svg, a'));
        for (const el of buttons) {
          const txt = (el.textContent || '').trim().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          if (
            txt === '✕' ||
            txt === 'x' ||
            txt === 'close' ||
            txt === 'đóng' ||
            txt === 'tôi hiểu rồi' ||
            txt === 'tôi đã hiểu' ||
            txt === 'bỏ qua' ||
            aria.includes('close') ||
            aria.includes('đóng')
          ) {
            const btn = (el.closest('button, [role="button"]') || el) as HTMLElement;
            btn.click();
          }
        }
      });
      await delay(400);
    }

    if (!page.url().includes('/project/')) {
      console.log('[GoogleFlow] Clicking "+ Dự án mới" on home page...');
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
        const newProjBtn = buttons.find((b) => {
          const t = (b.textContent || '').trim();
          return t.includes('Dự án mới') || t.includes('New project') || t.includes('add_2');
        });
        if (newProjBtn) (newProjBtn as HTMLElement).click();
      });

      for (let i = 0; i < 25; i++) {
        await delay(500);
        if (page.url().includes('/project/')) break;
      }
    } else {
      console.log('[GoogleFlow] Already on canvas, clicking topbar "+" for new project...');
      await page.evaluate(() => {
        const topBtns = Array.from(document.querySelectorAll('button'));
        const addBtn = topBtns.find((b) => {
          const r = b.getBoundingClientRect();
          return r.y < 80 && (b.textContent?.includes('add') || (b.querySelector('i') && b.querySelector('i')?.textContent?.includes('add')));
        });
        if (addBtn) addBtn.click();
      });
      await delay(1500);
    }

    if (page.url().includes('/trash')) {
      await page.goto(page.url().replace('/trash', ''), { waitUntil: 'domcontentloaded' }).catch(() => {});
      await delay(1000);
    }
  }

  private async monitorRenderProgress(
    page: Page,
    targetCount: number = 1,
    onProgress?: (percent: number, message: string) => void,
    timeoutMs: number = RENDER_TIMEOUT_MS,
  ): Promise<void> {
    const startTime = Date.now();
    let currentPercent = 35;
    let hasStartedGenerating = false;

    while (Date.now() - startTime < timeoutMs) {
      const status = await page.evaluate(() => {
        const texts = Array.from(document.querySelectorAll('div, span, p')).map((e: any) => e.innerText || '');
        const matched = texts.find((t: string) => /^\d{1,2}%$/.test(t.trim()));
        const percentNum = matched ? parseInt(matched.replace('%', ''), 10) : null;
        const hasSpinners = document.querySelectorAll('svg.animate-spin, .animate-spin, div[style*="brightness(1)"]').length > 0;
        const allImgs = Array.from(document.querySelectorAll('img'));
        const mediaNodes = allImgs.filter((i) => i.naturalWidth > 500).length;
        return { isGenerating: !!matched || hasSpinners, percent: percentNum, mediaNodes };
      }).catch(() => ({ isGenerating: false, percent: null, mediaNodes: 0 }));

      if (status.percent !== null) {
        hasStartedGenerating = true;
        currentPercent = Math.max(currentPercent, Math.min(95, 35 + Math.round(status.percent * 0.6)));
        onProgress?.(currentPercent, `Rendering on Google AI... ${status.percent}%`);
      } else if (status.isGenerating) {
        hasStartedGenerating = true;
        onProgress?.(currentPercent, 'AI model is processing media on Canvas...');
      }

      if (hasStartedGenerating && !status.isGenerating && status.mediaNodes >= targetCount) {
        console.log('🎉 [GoogleFlow] Render completed 100% on Canvas.');
        break;
      }

      const elapsedSec = (Date.now() - startTime) / 1000;
      if (elapsedSec >= 30 && status.mediaNodes >= targetCount) {
        console.log('[GoogleFlow] Render media detected on Canvas.');
        break;
      }

      await delay(2500);
    }

    await delay(2000);
  }

  private async collectRenderedFiles(
    page: Page,
    outputDir: string,
    promptText: string,
    startTime: number,
  ): Promise<string[]> {
    const results: string[] = [];

    // Method 1: Extract directly from Canvas DOM (Blob / Base64 - 1376x768 HD)
    const canvasFiles = await this.extractMediaFromCanvasDom(page, outputDir, promptText);
    results.push(...canvasFiles);

    // Method 2: Check Downloads folders for files created after startTime
    const checkFolders = [
      outputDir,
      path.join(os.homedir(), 'Downloads'),
      path.join(os.homedir(), 'Downloads', 'farm-project'),
    ];

    for (const folder of checkFolders) {
      if (fs.existsSync(folder)) {
        try {
          const files = fs.readdirSync(folder);
          for (const f of files) {
            if (f.endsWith('.png') || f.endsWith('.mp4') || f.endsWith('.webp') || f.endsWith('.jpg')) {
              const fullPath = path.join(folder, f);
              const stat = fs.statSync(fullPath);
              if (stat.mtimeMs >= startTime - 5000) {
                const dest = path.join(outputDir, f);
                if (fullPath !== dest) {
                  try {
                    fs.copyFileSync(fullPath, dest);
                    results.push(dest);
                  } catch {
                    results.push(fullPath);
                  }
                } else {
                  results.push(fullPath);
                }
              }
            }
          }
        } catch { /* ignore */ }
      }
    }

    return Array.from(new Set(results));
  }

  private async extractMediaFromCanvasDom(page: Page, targetDir: string, promptText: string): Promise<string[]> {
    const mediaList = await page.evaluate(async () => {
      const results: { type: string; src: string; base64?: string; width?: number; height?: number }[] = [];
      const seenUrls = new Set<string>();

      // Extract high-res Images (1376x768)
      const allImgs = Array.from(document.querySelectorAll('img'));
      const images = allImgs.filter((i) => i.naturalWidth > 500);
      for (const img of images) {
        const src = img.src || img.getAttribute('src') || '';
        if (!src || seenUrls.has(src)) continue;
        seenUrls.add(src);

        try {
          const res = await fetch(src);
          const blob = await res.blob();
          const reader = new FileReader();
          const b64 = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          results.push({ type: 'image/png', src, base64: b64, width: img.naturalWidth, height: img.naturalHeight });
        } catch {
          results.push({ type: 'image/png', src, width: img.naturalWidth, height: img.naturalHeight });
        }
      }

      // Extract MP4 Videos
      const videos = Array.from(document.querySelectorAll('video'));
      for (const vid of videos) {
        const src = vid.src || (vid.querySelector('source') && vid.querySelector('source')?.src) || '';
        if (!src || seenUrls.has(src)) continue;
        seenUrls.add(src);
        try {
          const res = await fetch(src);
          const blob = await res.blob();
          const reader = new FileReader();
          const b64 = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          results.push({ type: 'video/mp4', src, base64: b64 });
        } catch {
          results.push({ type: 'video/mp4', src });
        }
      }

      return results;
    });

    const savedFiles: string[] = [];
    const cleanPrompt = promptText.slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_') || 'flow';

    for (const [idx, item] of mediaList.entries()) {
      const timestamp = Date.now();
      const ext = item.type.includes('video') ? 'mp4' : 'png';
      const fileName = `${cleanPrompt}_${timestamp}_${idx + 1}.${ext}`;
      const filePath = path.join(targetDir, fileName);

      if (item.base64 && item.base64.includes('base64,')) {
        const base64Data = item.base64.split('base64,')[1]!;
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        savedFiles.push(filePath);
      }
    }

    return savedFiles;
  }

  private parseInput(inputJson: string): FlowMediaInput {
    try {
      return JSON.parse(inputJson) as FlowMediaInput;
    } catch {
      return { prompt: inputJson };
    }
  }
}
