import { BrowserManager } from './browser-manager';
import { PageNavigator } from './navigator';
import { ExtensionUI } from './extension-ui';
import { FormFiller } from './form-filler';
import { Executor } from './executor';
import { loadConfig } from './config-loader';
import { logger, setLogLevel } from './logger';
import { withRetry } from './error-handler';

export async function runFlow(configPath: string): Promise<void> {
  const config = loadConfig(configPath);
  if (config.logLevel) {
    setLogLevel(config.logLevel);
  }

  const browserManager = new BrowserManager();
  let session: any = null;

  try {
    logger.info('Starting automation flow...');

    // Launch browser with extension or connect to existing profile
    session = await browserManager.launch(
      config.extensionPath,
      config.shardBrowserPath,
      config.debugPort || 9222,
      config.profileId,
      config.userDataDir,
      config.group || config.folder
    );

    const page = session.page;

    // Capture console logs from extension
    page.on('console', (msg: any) => {
      logger.debug(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    // Navigate to target URL
    const navigator = new PageNavigator(page);
    await navigator.navigateTo(config.url, config.timeout * 1000);

    // Auto-enter project if on landing page
    await navigator.ensureFlowProjectOpened();

    // Close any unrelated tabs (e.g. extension welcome pages, blank tabs)
    await navigator.closeUnrelatedTabs(session.browser);

    // Ensure extension is ready and get active interaction page
    const extensionUI = new ExtensionUI(page, session.browser);
    const targetPage = (await extensionUI.ensureExtensionReady()) || page;

    // Fill form and apply settings
    const formFiller = new FormFiller(targetPage);
    
    // 1. Set mode if configured
    if (config.mode) {
      await formFiller.setGenerationMode(config.mode);
    }

    // 2. Set aspect ratio if configured
    if (config.aspectRatio) {
      await formFiller.setAspectRatio(config.aspectRatio);
    }

    // 3. Set output count if configured
    if (config.outputCount) {
      await formFiller.setOutputCount(config.outputCount);
    }

    // 4. Fill custom dropdowns/checkboxes if present
    if (config.options?.dropdown) {
      await formFiller.selectDropdown(config.options.dropdown);
    }
    if (config.options?.checkbox !== undefined) {
      await formFiller.toggleCheckbox(config.options.checkbox);
    }

    // 5. Process prompt queue
    const promptList = config.prompts && config.prompts.length > 0 ? config.prompts : [config.prompt];
    const executor = new Executor(targetPage);

    for (let i = 0; i < promptList.length; i++) {
      const currentPrompt = promptList[i];
      logger.info(`[Prompt ${i + 1}/${promptList.length}] Processing: "${currentPrompt.substring(0, 40)}..."`);
      
      await formFiller.fillStartIndex(config.startIndex + i);
      await formFiller.fillPrompt(currentPrompt);
      await executor.clickStart();

      if (i < promptList.length - 1) {
        const [minDelay, maxDelay] = config.delayRange || [5, 10];
        const delaySeconds = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        logger.info(`Waiting ${delaySeconds}s before next prompt...`);
        await new Promise((r) => setTimeout(r, delaySeconds * 1000));
      }
    }

    await executor.waitForExecution(config.timeout * 1000);

    // 6. Download media if enabled
    if (config.download?.enabled) {
      const downloadFolder = config.download.folder || './downloads';
      const quality = config.download.quality || '1080p';
      await executor.downloadCompletedMedia(quality);
    }

    logger.info('Flow completed successfully!');
  } catch (error: any) {
    logger.error(`Flow failed: ${error.message}`);
    throw error;
  } finally {
    if (session && !config.keepOpen) {
      await browserManager.close();
    } else if (session && config.keepOpen) {
      logger.info('Browser kept open as configured (keepOpen: true)');
    }
  }
}