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
      // 1. Try standard / PrimeVue selector
      const el = await this.page.waitForSelector(this.selectors.startButton, { timeout }).catch(() => null);
      if (el) {
        await el.click().catch(() => {});
        logger.info('Clicked Start button');
        return true;
      }

      // 2. Try text matching for Vietnamese/English start action buttons
      const clicked = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, .p-button, [role="button"]'));
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          if (text.includes('bắt đầu') || text.includes('tạo') || text.includes('start') || text.includes('chạy')) {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (clicked) {
        logger.info('Clicked Start button by text matching');
        return true;
      }

      // 3. Trigger Google Flow generation by pressing Enter in the prompt input
      const promptInput = await this.page.$('div[contenteditable="true"], textarea, #prompt').catch(() => null);
      if (promptInput) {
        await promptInput.focus().catch(() => {});
        await this.page.keyboard.press('Enter').catch(() => {});
        logger.info('Triggered Google Flow generation via Enter key');
        return true;
      }
    } catch {
      logger.info(`Start button not found on current page/frame (selector: ${this.selectors.startButton})`);
    }
    return false;
  }

  async waitForExecution(timeout: number = 60000): Promise<void> {
    logger.info(`Waiting for Google Flow generation to complete (timeout: ${timeout / 1000}s)...`);
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const isGenerating = await this.page.evaluate(() => {
        // Look for progress indicators, e.g. "10%", "50%", progress bars, or spinner icons
        const texts = Array.from(document.querySelectorAll('div, span, p')).map((e: any) => e.innerText || '');
        const hasPercent = texts.some((t: string) => /^\d{1,2}%$/.test(t.trim()));
        const hasGeneratingSpinners = document.querySelectorAll('div[data-tile-id] [style*="brightness(1)"], svg.animate-spin').length > 0;
        return hasPercent || hasGeneratingSpinners;
      }).catch(() => false);

      if (!isGenerating && Date.now() - startTime > 8000) {
        logger.info('Generation completed successfully on Google Flow!');
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    logger.info('Execution step finished');
  }

  async downloadCompletedMedia(quality: string = '1080p'): Promise<number> {
    logger.info(`Checking and triggering download for completed media items (Quality: ${quality})...`);
    try {
      const downloadCount = await this.page.evaluate(async (targetQuality: string) => {
        let count = 0;
        const tiles = Array.from(document.querySelectorAll('div[data-tile-id]'));
        for (const tile of tiles) {
          const media = tile.querySelector('video, img');
          if (!media) continue;

          tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

          const moreBtn = tile.querySelector('button') as HTMLElement;
          if (moreBtn) {
            moreBtn.click();
            await new Promise((r) => setTimeout(r, 400));

            const downloadItem = Array.from(document.querySelectorAll('button, div[role="menuitem"]')).find(
              (b) => (b.textContent || '').toLowerCase().includes('tải') || (b.textContent || '').toLowerCase().includes('download')
            ) as HTMLElement;

            if (downloadItem) {
              downloadItem.click();
              count++;
              await new Promise((r) => setTimeout(r, 500));

              const qualityBtn = Array.from(document.querySelectorAll('button')).find((b) =>
                (b.textContent || '').includes(targetQuality)
              ) as HTMLElement;
              if (qualityBtn) qualityBtn.click();
            }
          }
        }
        return count;
      }, quality);

      logger.info(`Successfully triggered download for ${downloadCount} media items.`);
      return downloadCount;
    } catch (e: any) {
      logger.warn(`Download trigger: ${e.message}`);
      return 0;
    }
  }
}