import { logger } from './logger';
import { SELECTORS } from './selectors';

export class ExtensionUI {
  private page: any;
  private browser: any;
  private selectors: any;

  constructor(page: any, browser?: any, customSelectors?: any) {
    this.page = page;
    this.browser = browser;
    this.selectors = { ...SELECTORS, ...customSelectors };
  }

  async detectExtensionTargets(): Promise<{ id?: string; targets: string[] }> {
    if (!this.browser) return { targets: [] };
    try {
      const targets = await this.browser.targets();
      const extensionTargets: string[] = [];
      let detectedId: string | undefined;

      for (const t of targets) {
        const url = t.url ? t.url() : '';
        if (url.startsWith('chrome-extension://')) {
          extensionTargets.push(url);
          const match = url.match(/chrome-extension:\/\/([a-z0-9]+)/i);
          if (match && !detectedId) {
            detectedId = match[1];
          }
        }
      }
      if (detectedId) {
        logger.info(`Detected active Chrome extension ID: ${detectedId}`);
      }
      return { id: detectedId, targets: extensionTargets };
    } catch {
      return { targets: [] };
    }
  }

  async openPopup(timeout: number = 3000): Promise<boolean> {
    try {
      await this.detectExtensionTargets();
      const el = await this.page.waitForSelector(this.selectors.popup, { timeout }).catch(() => null);
      if (el) {
        logger.info('Extension popup UI element detected in page');
        return true;
      }
    } catch (err: any) {
      logger.debug(`Popup check: ${err.message}`);
    }
    return false;
  }

  async activateSidePanelOnFlowTab(): Promise<void> {
    const extInfo = await this.detectExtensionTargets();
    if (!extInfo.id || !this.browser) return;

    try {
      // 1. Bring Google Flow tab to active focus
      await this.page.bringToFront().catch(() => {});

      // 2. Instruct extension service worker to trigger action click and open side panel
      const targets = await this.browser.targets();
      for (const t of targets) {
        if (t.type() === 'service_worker' && t.url().includes(extInfo.id)) {
          const worker = await t.worker().catch(() => null);
          if (worker) {
            await worker.evaluate(async () => {
              const ch = (globalThis as any).chrome;
              if (ch) {
                const tabs = await ch.tabs.query({ active: true });
                const currentTab = (tabs && tabs.find((tb: any) => tb.url && tb.url.includes('labs.google'))) || (tabs && tabs[0]);
                if (currentTab) {
                  // Dispatch extension action click
                  if (ch.action && ch.action.onClicked && (ch.action.onClicked as any).dispatch) {
                    try {
                      (ch.action.onClicked as any).dispatch(currentTab);
                    } catch {}
                  }
                  if (ch.sidePanel) {
                    await ch.sidePanel.setOptions({
                      tabId: currentTab.id,
                      path: 'src/ui/side-panel/index.html',
                      enabled: true
                    }).catch(() => {});
                    await ch.sidePanel.open({ tabId: currentTab.id }).catch(() => {});
                    if (currentTab.windowId) {
                      await ch.sidePanel.open({ windowId: currentTab.windowId }).catch(() => {});
                    }
                  }
                }
              }
            }).catch(() => {});
            logger.info('Dispatched Extension Action & requested Side Panel on Google Flow tab');
          }
        }
      }
    } catch (e: any) {
      logger.debug(`Error activating side panel: ${e.message}`);
    }
  }

  async findSidePanelTarget(timeoutMs: number = 3000): Promise<any> {
    if (!this.browser) return null;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const targets = await this.browser.targets();
        for (const t of targets) {
          const url = t.url ? t.url() : '';
          if (url.includes('src/ui/side-panel/index.html') || (url.includes('side-panel') && !url.includes('service_worker'))) {
            const p = await t.page().catch(() => null);
            if (p) {
              return p;
            }
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 400));
    }
    return null;
  }

  async ensureExtensionReady(): Promise<any> {
    await this.activateSidePanelOnFlowTab();
    
    // Poll for active side panel target
    const sidePanelPage = await this.findSidePanelTarget(3000);
    if (sidePanelPage) {
      logger.info('Connected directly to Extension Side Panel Target');
      return sidePanelPage;
    }

    await this.page.bringToFront().catch(() => {});
    return this.page;
  }
}