import { TimeoutError } from './error-handler';
import { logger } from './logger';

export class PageNavigator {
  private page: any;

  constructor(page: any) {
    this.page = page;
  }

  async navigateTo(url: string, timeout: number = 30000): Promise<void> {
    try {
      const cur = await this.page.url();
      if (cur.includes('/project/')) {
        logger.info(`Đã ở sẵn trong Canvas Dự Án: ${cur}`);
        return;
      }
      logger.info(`Navigating to ${url}`);
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout
      });
      logger.info(`Page loaded: ${url}`);
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        throw new TimeoutError(`Navigation timeout after ${timeout}ms: ${url}`);
      }
      throw error;
    }
  }

  async waitForPageLoad(timeout: number = 30000): Promise<void> {
    await this.page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout
    });
  }

  async closeUnrelatedTabs(browser: any): Promise<void> {
    try {
      const pages = await browser.pages();
      for (const p of pages) {
        if (p !== this.page) {
          const url = p.url();
          logger.info(`Closing unrelated tab: ${url || 'about:blank'}`);
          await p.close().catch(() => {});
        }
      }
      await this.page.bringToFront().catch(() => {});
    } catch (e: any) {
      logger.debug(`Error while closing tabs: ${e.message}`);
    }
  }

  async ensureFlowProjectOpened(): Promise<void> {
    try {
      logger.info('Đang kiểm tra và mở Canvas dự án Google Flow...');
      
      // 1. Tự động tìm và bấm tất cả các nút đóng (X, Close) của Banner / Dialog quảng cáo
      for (let i = 0; i < 3; i++) {
        await this.page.evaluate(() => {
          const allEls = Array.from(document.querySelectorAll('button, div, span, [role="button"], a, svg, i'));
          for (const el of allEls) {
            const txt = (el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const isCloseIcon = el.textContent?.includes('close') || 
                                (el.getAttribute('class') || '').includes('close') ||
                                el.querySelector('i, svg')?.textContent?.includes('close');
            
            if (txt === '✕' || txt === 'x' || txt === 'close' || txt === 'đóng' || aria.includes('close') || aria.includes('đóng') || isCloseIcon) {
              const targetClick = (el.closest('button, [role="button"]') || el) as HTMLElement;
              targetClick.click();
            }
          }
        }).catch(() => {});
        await new Promise((r) => setTimeout(r, 600));
      }

      // Kiểm tra xem đã thực sự ở trong canvas dự án (URL phải chứa /project/)
      const isInProjectCanvas = await this.page.evaluate(() => {
        return window.location.href.includes('/project/') || window.location.pathname.includes('/project/');
      });

      if (!isInProjectCanvas) {
        logger.info('Chưa ở trong Canvas dự án, đang thực hiện click chuột thật mở dự án...');

        const coords = await this.page.evaluate(() => {
          const allEls = Array.from(document.querySelectorAll('button, a, div, [role="button"]'));

          // 1. Ưu tiên 1: Thẻ dự án có sẵn đầu tiên (chứa ảnh / video / text ngày tháng)
          for (const el of allEls) {
            const text = (el.textContent || '').trim();
            const rect = el.getBoundingClientRect();
            if (rect.width > 120 && rect.height > 80 && rect.top > 60 && rect.top < window.innerHeight && (el.querySelector('img, video') || text.includes('thg '))) {
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              const newRect = el.getBoundingClientRect();
              return { x: newRect.x + newRect.width / 2, y: newRect.y + newRect.height / 2, label: 'Thẻ dự án có sẵn' };
            }
          }

          // 2. Ưu tiên 2: Thẻ "+ Dự án mới"
          for (const el of allEls) {
            const text = (el.textContent || '').trim();
            const rect = el.getBoundingClientRect();
            if (rect.width > 40 && rect.height > 30 && rect.top >= 0 && (text.includes('Dự án mới') || text.includes('New project') || el.querySelector('i')?.textContent?.includes('add'))) {
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              const newRect = el.getBoundingClientRect();
              return { x: newRect.x + newRect.width / 2, y: newRect.y + newRect.height / 2, label: 'Dự án mới' };
            }
          }

          return null;
        });

        if (coords) {
          logger.info(`👉 Click chuột thật vào [${coords.label}] tại: (${Math.round(coords.x)}, ${Math.round(coords.y)})`);
          await this.page.mouse.click(coords.x, coords.y);
          await new Promise((r) => setTimeout(r, 4000));
        }

        // Chờ chuyển sang URL /project/
        for (let i = 0; i < 15; i++) {
          const cur = await this.page.url();
          if (cur.includes('/project/')) break;
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      const finalUrl = await this.page.url();
      logger.info(`✅ Trạng thái URL Canvas hiện tại: ${finalUrl}`);
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e: any) {
      logger.debug(`ensureFlowProjectOpened: ${e.message}`);
    }
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }
}