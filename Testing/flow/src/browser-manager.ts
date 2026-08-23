import puppeteer from 'puppeteer';
import { BrowserSession } from './types';
import { ConnectionError } from './error-handler';
import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

function findShardBrowserBinary(): string | undefined {
  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';

  const candidates = [
    // 1. ShardBrowser / ShardX core runtime in AppData
    appData ? path.join(appData, 'shardx-launcher', 'runtime', 'ShardX-Windows', 'chrome.exe') : '',
    // 2. Installed ShardX / ShardBrowser locations
    'C:\\Program Files\\ShardX\\ShardX.exe',
    'C:\\Program Files\\ShardBrowser\\ShardBrowser.exe',
    // 3. Fallback to Google Chrome / Edge
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function findShardBrowserProfilesDir(): string {
  const appData = process.env.APPDATA || '';
  return appData ? path.join(appData, 'shardx-launcher', 'profiles') : '';
}

function findActiveShardBrowserInstance(profileId?: string): { port: number; wsPath?: string; profileId?: string } | null {
  const profilesDir = findShardBrowserProfilesDir();
  if (!profilesDir || !fs.existsSync(profilesDir)) return null;

  try {
    const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (profileId && entry.name !== profileId) continue;

      const portFile = path.join(profilesDir, entry.name, 'DevToolsActivePort');
      if (fs.existsSync(portFile)) {
        const content = fs.readFileSync(portFile, 'utf-8').trim();
        const lines = content.split(/\r?\n/);
        const port = parseInt(lines[0], 10);
        const wsPath = lines[1] ? lines[1].trim() : undefined;
        if (!isNaN(port) && port > 0) {
          return { port, wsPath, profileId: entry.name };
        }
      }
    }
  } catch (err) {
    // Ignore read errors
  }
  return null;
}

import { ShardBrowserApiClient } from './shard-api';

export class BrowserManager {
  private browser: any;
  private page: any;
  private cdpUrl: string = '';
  private apiClient: ShardBrowserApiClient = new ShardBrowserApiClient();
  private startedProfileId?: string;

  async launch(
    extensionPath: string,
    shardBrowserPath?: string,
    debugPort: number = 9222,
    profileId?: string,
    customUserDataDir?: string
  ): Promise<BrowserSession> {
    if (extensionPath && !fs.existsSync(extensionPath)) {
      logger.warn(`Extension path not found: ${extensionPath}`);
    }

    // 1. Check if ShardBrowser Launcher API is running (Tauri app)
    const isApiHealthy = await this.apiClient.isHealthy();
    if (isApiHealthy) {
      logger.info('Detected ShardBrowser Launcher Automation API.');
      try {
        let targetProfileId = profileId?.trim();
        
        const existingProfiles = await this.apiClient.listProfiles().catch(() => []);
        
        // If no profileId specified, check if there's any existing profile or create a permanent one
        if (!targetProfileId) {
          const running = existingProfiles.find((p) => p.running && p.cdp?.port);
          if (running && running.cdp && (await isPortOpen(running.cdp.port))) {
            targetProfileId = running.id;
            logger.info(`Using active running ShardBrowser profile: "${running.name}" (${running.id})`);
            const cdpTarget = running.cdp.ws || `http://127.0.0.1:${running.cdp.port}`;
            return await this.connect(cdpTarget);
          } else if (existingProfiles.length > 0) {
            targetProfileId = existingProfiles[0].id;
            logger.info(`Using ShardBrowser profile: "${existingProfiles[0].name}" (${targetProfileId})`);
          } else {
            logger.info('Creating a new persistent profile in ShardBrowser...');
            const newProf = await this.apiClient.createProfile(`AutoFlow Profile`);
            targetProfileId = newProf.id;
            logger.info(`Created ShardBrowser profile: "${newProf.name}" (${targetProfileId})`);
          }
        }

        this.startedProfileId = targetProfileId;
        logger.info(`Starting ShardBrowser profile [${targetProfileId}] via Launcher API...`);
        // If it was in a stale running state, stop first
        await this.apiClient.stopProfile(targetProfileId).catch(() => {});
        await new Promise((r) => setTimeout(r, 600));

        const startResult = await this.apiClient.startProfile(targetProfileId, false);
        
        const cdpTarget = startResult.cdp?.ws
          ? startResult.cdp.ws
          : startResult.cdp?.port
          ? `http://127.0.0.1:${startResult.cdp.port}`
          : `http://127.0.0.1:${debugPort}`;

        logger.info(`Profile launched, connecting via CDP: ${cdpTarget}`);
        // Wait for Chrome pages to initialize
        await new Promise((r) => setTimeout(r, 1500));
        return await this.connect(cdpTarget);
      } catch (err: any) {
        logger.warn(`Failed to launch via ShardBrowser API: ${err.message}. Falling back to direct launch.`);
      }
    }

    // 2. Check if an active ShardBrowser profile is currently running (via DevToolsActivePort)
    const activeProfile = findActiveShardBrowserInstance(profileId);
    if (activeProfile) {
      const targetUrl = activeProfile.wsPath
        ? `ws://127.0.0.1:${activeProfile.port}${activeProfile.wsPath}`
        : `http://127.0.0.1:${activeProfile.port}`;
      logger.info(`Detected running ShardBrowser profile [${activeProfile.profileId}] at port ${activeProfile.port}. Connecting...`);
      return await this.connect(targetUrl);
    }

    // 3. If debugPort is already active, connect directly
    const isRunning = await isPortOpen(debugPort);
    if (isRunning) {
      logger.info(`Detected running browser instance at port ${debugPort}. Connecting via CDP...`);
      return await this.connect(`http://127.0.0.1:${debugPort}`);
    }

    // 4. Resolve ShardBrowser executable path
    let executablePath: string | undefined = shardBrowserPath?.trim() || undefined;
    if (executablePath && !fs.existsSync(executablePath)) {
      logger.warn(`Configured browser path not found: "${executablePath}". Searching for ShardBrowser runtime...`);
      executablePath = findShardBrowserBinary();
    } else if (!executablePath) {
      executablePath = findShardBrowserBinary();
    }

    // 5. Resolve Profile User Data Directory if profileId is specified
    let userDataDir = customUserDataDir?.trim();
    if (!userDataDir && profileId) {
      const profilesDir = findShardBrowserProfilesDir();
      if (profilesDir) {
        userDataDir = path.join(profilesDir, profileId);
      }
    }

    const args = [
      `--remote-debugging-port=${debugPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-popup-blocking'
    ];

    if (userDataDir) {
      args.push(`--user-data-dir=${userDataDir}`);
      logger.info(`Using ShardBrowser Profile User Data Directory: ${userDataDir}`);
    }

    if (extensionPath && fs.existsSync(extensionPath)) {
      args.push(`--disable-extensions-except=${extensionPath}`);
      args.push(`--load-extension=${extensionPath}`);
    }

    if (executablePath) {
      logger.info(`Launching ShardBrowser engine from: ${executablePath}`);
    } else {
      logger.info('Launching Puppeteer bundled browser');
    }

    this.browser = await puppeteer.launch({
      executablePath,
      args,
      headless: false,
      timeout: 30000
    });

    const pages = await this.browser.pages();
    this.page = pages[0] || await this.browser.newPage();
    this.cdpUrl = this.browser.wsEndpoint();

    logger.info(`ShardBrowser launched successfully, CDP: ${this.cdpUrl}`);
    return {
      browser: this.browser,
      page: this.page,
      cdpUrl: this.cdpUrl
    };
  }

  async connect(cdpUrl: string): Promise<BrowserSession> {
    try {
      const connectOptions = cdpUrl.startsWith('http')
        ? { browserURL: cdpUrl }
        : { browserWSEndpoint: cdpUrl };

      this.browser = await puppeteer.connect(connectOptions);
      const pages = await this.browser.pages();
      this.page = pages[0] || await this.browser.newPage();
      this.cdpUrl = this.browser.wsEndpoint ? this.browser.wsEndpoint() : cdpUrl;
      logger.info(`Connected to existing ShardBrowser instance at ${cdpUrl}`);
      return {
        browser: this.browser,
        page: this.page,
        cdpUrl: this.cdpUrl
      };
    } catch (error: any) {
      throw new ConnectionError(`Failed to connect to browser: ${error.message}`);
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      logger.info('Browser connection closed');
    }
    if (this.startedProfileId) {
      await this.apiClient.stopProfile(this.startedProfileId);
      logger.info(`Stopped profile [${this.startedProfileId}] via Launcher API`);
    }
  }

  getPage(): any {
    return this.page;
  }
}