import { TimeoutError } from './error-handler';
import { logger } from './logger';

export class PageNavigator {
  private page: any;

  constructor(page: any) {
    this.page = page;
  }

  async navigateTo(url: string, timeout: number = 30000): Promise<void> {
    try {
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
      const clicked = await this.page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('button, [role="button"], a, div'));
        for (const el of els) {
          const text = (el.textContent || '').trim();
          if (text.includes('Dự án mới') || text.includes('New project') || text.includes('Create with Google Flow')) {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (clicked) {
        logger.info('Automatically entered Google Flow project ("+ Dự án mới")');
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e: any) {
      logger.debug(`ensureFlowProjectOpened: ${e.message}`);
    }
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }
}