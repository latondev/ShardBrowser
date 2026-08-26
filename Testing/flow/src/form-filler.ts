import { logger } from './logger';
import { SELECTORS } from './selectors';

export class FormFiller {
  private page: any;
  private selectors: any;

  constructor(page: any, customSelectors?: any) {
    this.page = page;
    this.selectors = { ...SELECTORS, ...customSelectors };
  }

  async setGenerationMode(mode: string): Promise<boolean> {
    try {
      logger.info(`Setting generation mode: ${mode}`);
      // 1. Click config/model button on Google Flow to open mode dialog if not opened
      await this.page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const configBtn = btns.find((b) => {
          const t = (b.textContent || '').toLowerCase();
          return t.includes('banana') || t.includes('veo') || t.includes('imagen') || b.querySelector('i')?.textContent?.includes('tune') || b.querySelector('i')?.textContent?.includes('crop');
        });
        if (configBtn) (configBtn as HTMLElement).click();
      }).catch(() => {});

      await new Promise((r) => setTimeout(r, 600));

      const isSet = await this.page.evaluate((targetMode: string) => {
        const buttons = Array.from(document.querySelectorAll('button, [role="tab"], div[type="button"]'));
        const modeKeywords: Record<string, string[]> = {
          'text-to-video': ['văn bản thành video', 'text to video', 'video', 'veo 3', 'veo 2', 'veo'],
          'image-to-video': ['khung hình thành video', 'hình ảnh thành video', 'image to video'],
          'component-to-video': ['thành phần thành video', 'component to video'],
          'text-to-image': ['văn bản thành hình ảnh', 'text to image', 'hình ảnh', 'image', 'imagen 3', 'imagen'],
          'image-to-image': ['hình ảnh thành hình ảnh', 'image to image'],
          'agent': ['tự động hóa agent', 'agent mode', 'agent']
        };

        const keywords = modeKeywords[targetMode] || [targetMode.toLowerCase()];
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          for (const kw of keywords) {
            if (text.includes(kw)) {
              (btn as HTMLElement).click();
              return true;
            }
          }
        }
        return false;
      }, mode);

      if (isSet) {
        logger.info(`Successfully switched mode to: ${mode}`);
        return true;
      }
    } catch (e: any) {
      logger.debug(`setGenerationMode: ${e.message}`);
    }
    return false;
  }

  async setAspectRatio(ratio: string): Promise<boolean> {
    try {
      const clicked = await this.page.evaluate((r: string) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const b of buttons) {
          if ((b.textContent || '').includes(r)) {
            (b as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, ratio);
      if (clicked) logger.info(`Selected aspect ratio: ${ratio}`);
      return clicked;
    } catch {
      return false;
    }
  }

  async setOutputCount(count: number): Promise<boolean> {
    try {
      const targetLabel = `x${count}`;
      const clicked = await this.page.evaluate((label: string, n: number) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const b of buttons) {
          const txt = (b.textContent || '').trim();
          if (txt === label || txt === String(n)) {
            (b as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, targetLabel, count);
      if (clicked) logger.info(`Selected output count: ${count}`);
      return clicked;
    } catch {
      return false;
    }
  }

  async fillStartIndex(value: number, timeout: number = 2000): Promise<boolean> {
    try {
      const el = await this.page.waitForSelector(this.selectors.startIndexInput, { timeout }).catch(() => null);
      if (el) {
        await el.click({ clickCount: 3 }).catch(() => {});
        await el.type(String(value)).catch(() => {});
        logger.info(`Filled startIndex: ${value}`);
        return true;
      }
    } catch {
      logger.info(`startIndex input not found on current page/frame (selector: ${this.selectors.startIndexInput})`);
    }
    return false;
  }

  async fillPrompt(text: string, timeout: number = 3000): Promise<boolean> {
    try {
      // 1. Tìm ô Prompt bằng selectors hoặc text placeholder 'Bạn muốn tạo gì?'
      const coords = await this.page.evaluate((sel: string) => {
        // Ưu tiên 1: Tìm phần tử có chữ "Bạn muốn tạo gì?"
        const all = Array.from(document.querySelectorAll('*'));
        const promptDiv = all.find((el: any) => {
          const t = (el.textContent || '').trim();
          const rect = el.getBoundingClientRect();
          return (t === 'Bạn muốn tạo gì?' || t.includes('Bạn muốn tạo')) && rect.width > 150 && rect.height > 15;
        });

        if (promptDiv) {
          const rect = (promptDiv as HTMLElement).getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }

        // Ưu tiên 2: Selector chuẩn
        const el = document.querySelector(sel);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
        return null;
      }, this.selectors.promptTextarea);

      if (coords) {
        await this.page.mouse.click(coords.x, coords.y);
        await new Promise((r) => setTimeout(r, 300));

        // Xóa nội dung cũ
        await this.page.keyboard.down('Control').catch(() => {});
        await this.page.keyboard.press('KeyA').catch(() => {});
        await this.page.keyboard.up('Control').catch(() => {});
        await this.page.keyboard.press('Backspace').catch(() => {});
        await new Promise((r) => setTimeout(r, 200));

        // Gõ nội dung prompt
        await this.page.keyboard.type(text, { delay: 12 });
        logger.info(`Filled prompt via keyboard: "${text.substring(0, 40)}..."`);
        return true;
      }

      // Fallback
      const el = await this.page.waitForSelector(this.selectors.promptTextarea, { timeout }).catch(() => null);
      if (el) {
        await el.click().catch(() => {});
        await el.focus().catch(() => {});
        await this.page.keyboard.type(text, { delay: 10 }).catch(() => {});
        logger.info(`Filled prompt: ${text.substring(0, 35)}...`);
        return true;
      }
    } catch (e: any) {
      logger.debug(`fillPrompt error: ${e.message}`);
    }
    return false;
  }

  async selectDropdown(option: string, timeout: number = 3000): Promise<boolean> {
    if (!this.selectors.dropdown) return false;
    try {
      const el = await this.page.waitForSelector(this.selectors.dropdown, { timeout });
      if (el) {
        await el.click().catch(() => {});
        const optionEl = await this.page.waitForSelector('.p-select-option, .p-dropdown-item, li[role="option"], option', { timeout: 1500 }).catch(() => null);
        if (optionEl) {
          await optionEl.click().catch(() => {});
        }
        logger.info(`Selected dropdown option: ${option}`);
        return true;
      }
    } catch {
      logger.debug(`dropdown not found on current page/frame`);
    }
    return false;
  }

  async toggleCheckbox(checked: boolean, timeout: number = 3000): Promise<boolean> {
    if (!this.selectors.checkbox) return false;
    try {
      const el = await this.page.waitForSelector(this.selectors.checkbox, { timeout });
      if (el) {
        await el.click().catch(() => {});
        logger.info(`Checkbox set to: ${checked}`);
        return true;
      }
    } catch {
      logger.debug(`checkbox not found on current page/frame`);
    }
    return false;
  }

  async validateRequiredFields(): Promise<boolean> {
    try {
      const startEl = await this.page.$(this.selectors.startIndexInput);
      const promptEl = await this.page.$(this.selectors.promptTextarea);
      if (startEl && promptEl) {
        const startIndexValue = await this.page.$eval(this.selectors.startIndexInput, (el: any) => el.value);
        const promptValue = await this.page.$eval(this.selectors.promptTextarea, (el: any) => el.value);
        return Boolean(startIndexValue && promptValue);
      }
    } catch {
      // Ignored if elements are not on page
    }
    return true;
  }
}