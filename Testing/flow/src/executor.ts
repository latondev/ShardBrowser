import * as fs from 'fs';
import * as path from 'path';
import { SelectorNotFoundError } from './error-handler';
import { logger } from './logger';
import { SELECTORS } from './selectors';

export class Executor {
  private page: any;
  private selectors: any;

  constructor(page: any, customSelectors?: any) {
    this.page = page;
    this.selectors = { ...SELECTORS, ...customSelectors };
  }

  async clickStart(timeout: number = 3000): Promise<boolean> {
    try {
      // 1. Nhấn Enter trực tiếp từ bàn phím
      await this.page.keyboard.press('Enter').catch(() => {});
      logger.info('Triggered Google Flow generation via Enter key');
      await new Promise((r) => setTimeout(r, 400));

      // 2. Thử click thêm nút mũi tên gửi (submit button) trên thanh prompt
      await this.page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const sendBtn = btns.find(b => {
          const t = (b.textContent || '').toLowerCase();
          const hasSendIcon = b.querySelector('i, svg')?.textContent?.includes('arrow_forward') || 
                              b.querySelector('i, svg')?.textContent?.includes('send') ||
                              b.querySelector('i, svg')?.textContent?.includes('spark') ||
                              b.querySelector('i, svg')?.textContent?.includes('auto_awesome');
          return hasSendIcon || t === 'tạo' || t === 'create' || t === 'generate' || t === 'chạy';
        });
        if (sendBtn) (sendBtn as HTMLElement).click();
      }).catch(() => {});

      return true;
    } catch {
      return false;
    }
  }

  async waitForExecution(timeout: number = 90000): Promise<void> {
    logger.info(`Đang theo dõi tiến độ render Google Flow (timeout: ${timeout / 1000}s)...`);
    const startTime = Date.now();
    let pollCount = 0;
    while (Date.now() - startTime < timeout) {
      const status = await this.page.evaluate(() => {
        const texts = Array.from(document.querySelectorAll('div, span, p')).map((e: any) => e.innerText || '');
        const hasPercent = texts.some((t: string) => /^\d{1,2}%$/.test(t.trim()));
        const hasSpinners = document.querySelectorAll('svg.animate-spin, .animate-spin, div[style*="brightness(1)"]').length > 0;
        const mediaCount = document.querySelectorAll('img[src*="googleusercontent"], img[src*="blob:"], video').length;
        return { isGenerating: hasPercent || hasSpinners, mediaCount };
      }).catch(() => ({ isGenerating: false, mediaCount: 0 }));

      pollCount++;
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      if (pollCount % 3 === 0) {
        logger.info(`⏳ [${elapsedSec}s / ${timeout / 1000}s] Tiến độ render trên Google Flow: ${status.isGenerating ? 'Đang tạo video/ảnh...' : 'Đang xử lý...'}`);
      }

      // Chờ ít nhất 25 giây và không còn spinner
      if (!status.isGenerating && Date.now() - startTime > 25000) {
        logger.info(`✅ Quá trình render đã hoàn tất! (Tìm thấy ${status.mediaCount} media trên canvas)`);
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    logger.info('Execution step finished');
  }

  async downloadCompletedMedia(quality: string = '1080p', targetDir: string = './downloads/veo-folder-1'): Promise<number> {
    logger.info(`Kiểm tra và tự động tải ảnh/video đã render (Thư mục: ${targetDir})...`);
    try {
      if (!fs.existsSync(targetDir)) {
        try {
          fs.mkdirSync(targetDir, { recursive: true });
        } catch {}
      }

      // 1. Quét tìm tất cả ảnh và video trên Google Flow Canvas
      const mediaList = await this.page.evaluate(async () => {
        const results: { type: string; src: string; base64?: string; width?: number; height?: number }[] = [];
        const seenUrls = new Set<string>();

        // Quét tất cả thẻ img trên trang
        const images = Array.from(document.querySelectorAll('img'));
        for (const img of images) {
          const src = img.src || img.getAttribute('src') || '';
          if (src && !seenUrls.has(src)) {
            // Bỏ qua icon nhỏ / avatar
            if (src.includes('avatar') || src.includes('google_logo') || src.includes('icon') || img.naturalWidth < 100) {
              continue;
            }

            seenUrls.add(src);
            if (src.startsWith('data:image')) {
              results.push({ type: 'image/png', src, base64: src, width: img.naturalWidth, height: img.naturalHeight });
            } else {
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
          }
        }

        // Quét tất cả thẻ div có background-image
        const divs = Array.from(document.querySelectorAll('div[style*="background-image"], div[style*="url("]'));
        for (const div of divs) {
          const bg = (div as HTMLElement).style.backgroundImage || '';
          const match = bg.match(/url\(["']?(https?:\/\/[^"')]+|data:image\/[^"')]+|blob:[^"')]+)["']?\)/);
          if (match && match[1] && !seenUrls.has(match[1])) {
            const url = match[1];
            seenUrls.add(url);
            try {
              const res = await fetch(url);
              const blob = await res.blob();
              const reader = new FileReader();
              const b64 = await new Promise<string>((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
              results.push({ type: 'image/png', src: url, base64: b64 });
            } catch {
              results.push({ type: 'image/png', src: url });
            }
          }
        }

        // Quét tất cả thẻ video
        const videos = Array.from(document.querySelectorAll('video'));
        for (const vid of videos) {
          const src = vid.src || vid.querySelector('source')?.src || '';
          if (src && !seenUrls.has(src)) {
            seenUrls.add(src);
            results.push({ type: 'video/mp4', src });
          }
        }

        return results;
      });

      logger.info(`Tìm thấy ${mediaList.length} tệp ảnh/video chất lượng cao trên Google Flow Canvas!`);

      let savedCount = 0;
      for (const [idx, item] of mediaList.entries()) {
        const timestamp = Date.now();
        const ext = item.type.includes('video') ? 'mp4' : 'png';
        const fileName = `flow_output_${timestamp}_${idx + 1}.${ext}`;
        const filePath = path.join(targetDir, fileName);

        if (item.base64 && item.base64.includes('base64,')) {
          const base64Data = item.base64.split('base64,')[1];
          fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
          const sizeKb = Math.round(fs.statSync(filePath).size / 1024);
          logger.info(`💾 [ĐÃ TẢI THÀNH CÔNG VỀ MÁY]: ${filePath} (${sizeKb} KB)`);
          savedCount++;
        }
      }

      // 2. Kích hoạt nút Tải xuống trên UI Google Flow
      const uiDownloads = await this.page.evaluate(() => {
        let clicked = 0;
        const allButtons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
        for (const btn of allButtons) {
          const txt = (btn.textContent || '').toLowerCase();
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          const hasDownloadIcon = btn.querySelector('i, svg')?.textContent?.includes('download') || 
                                  btn.querySelector('i, svg')?.classList?.value?.includes('download');
          if (hasDownloadIcon || txt.includes('tải') || txt.includes('download') || aria.includes('download')) {
            (btn as HTMLElement).click();
            clicked++;
          }
        }
        return clicked;
      }).catch(() => 0);

      if (uiDownloads > 0) {
        logger.info(`Đã kích hoạt ${uiDownloads} nút tải xuống trực tiếp trên giao diện Google Flow.`);
      }

      logger.info(`✅ Hoàn tất lưu trữ ${savedCount || uiDownloads} tệp ảnh/video về thư mục ${targetDir}!`);
      return savedCount || uiDownloads;
    } catch (e: any) {
      logger.warn(`Download trigger: ${e.message}`);
      return 0;
    }
  }
}