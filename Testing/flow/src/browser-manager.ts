import puppeteer from 'puppeteer-core';
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
  private _browser: any;
  private _page: any;
  private _cdpUrl: string = '';
  private _apiClient: ShardBrowserApiClient = new ShardBrowserApiClient();
  private _startedProfileId?: string;

  async launch(
    extensionPath: string,
    shardBrowserPath?: string,
    debugPort: number = 9222,
    profileId?: string,
    customUserDataDir?: string,
    group?: string
  ): Promise<BrowserSession> {
    if (extensionPath && !fs.existsSync(extensionPath)) {
      logger.warn(`Extension path not found: ${extensionPath}`);
    }

    // 1. Check if ShardBrowser Launcher API is running (Tauri app)
    const isApiHealthy = await this._apiClient.isHealthy();
    if (isApiHealthy) {
      logger.info('Detected ShardBrowser Launcher Automation API.');
      try {
        let targetProfileId = profileId?.trim();
        
        let existingProfiles = await this._apiClient.listProfiles().catch(() => []);
        
        // Always filter by group (default 'Veo3') if no target profileId is provided
        const groupName = group || 'Veo3';
        if (!targetProfileId) {
          const normalizedGroup = groupName.trim().toLowerCase();
          const filtered = existingProfiles.filter((p) => (p.folder || '').trim().toLowerCase() === normalizedGroup);
          if (filtered.length > 0) {
            existingProfiles = filtered;
            logger.info(`Filtered profiles by group "${groupName}": found ${filtered.length} profile(s).`);
          } else {
            logger.info(`No existing profile in group "${groupName}", will create one.`);
            existingProfiles = [];
          }
        }

        // If no profileId specified, check if there's an existing profile or create one in the group
        if (!targetProfileId) {
          const running = existingProfiles.find((p) => p.running && (p.cdp?.web_socket_debugger_url || p.cdp?.ws || p.cdp?.port));
          if (running && running.cdp) {
            targetProfileId = running.id;
            logger.info(`Using active running ShardBrowser profile: "${running.name}" (${running.id}) [Group: ${running.folder || 'None'}]`);
            const cdpTarget = (running.cdp as any).web_socket_debugger_url || running.cdp.ws || `http://127.0.0.1:${running.cdp.port}`;
            return await this.connect(cdpTarget);
          } else if (existingProfiles.length > 0) {
            targetProfileId = existingProfiles[0].id;
            logger.info(`Using ShardBrowser profile: "${existingProfiles[0].name}" (${targetProfileId}) [Group: ${existingProfiles[0].folder || 'None'}]`);
          } else {
            logger.info(`Creating a new persistent profile in group "${groupName}" in ShardBrowser...`);
            const newProf = await this._apiClient.createProfile(`AutoFlow Profile`, groupName);
            targetProfileId = newProf.id;
            logger.info(`Created ShardBrowser profile: "${newProf.name}" (${targetProfileId}) [Group: ${groupName}]`);
          }
        }

        this._startedProfileId = targetProfileId;
        logger.info(`Starting ShardBrowser profile [${targetProfileId}] via Launcher API...`);

        const startResult = await this._apiClient.startProfile(targetProfileId, false);
        
        const cdpTarget = (startResult.cdp as any)?.web_socket_debugger_url ||
          startResult.cdp?.ws ||
          (startResult.cdp?.port ? `http://127.0.0.1:${startResult.cdp.port}` : undefined);

        if (!cdpTarget) {
          throw new Error(`Launcher did not return a valid CDP endpoint for profile ${targetProfileId}`);
        }

        logger.info(`Profile launched, connecting via CDP: ${cdpTarget}`);
        // Wait for Chrome pages to initialize
        await new Promise((r) => setTimeout(r, 1000));
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

    this._browser = await puppeteer.launch({
      executablePath,
      args,
      headless: false,
      timeout: 30000
    });

    const pages = await this._browser.pages();
    this._page = pages[0] || await this._browser.newPage();
    this._cdpUrl = this._browser.wsEndpoint();

    logger.info(`ShardBrowser launched successfully, CDP: ${this._cdpUrl}`);
    return {
      browser: this._browser,
      page: this._page,
      cdpUrl: this._cdpUrl
    };
  }

  async connect(cdpUrl: string): Promise<BrowserSession> {
    try {
      const connectOptions = cdpUrl.startsWith('http')
        ? { browserURL: cdpUrl }
        : { browserWSEndpoint: cdpUrl };

      this._browser = await puppeteer.connect(connectOptions);
      const pages = await this._browser.pages();
      this._page = pages[0] || await this._browser.newPage();
      this._cdpUrl = this._browser.wsEndpoint ? this._browser.wsEndpoint() : cdpUrl;
      logger.info(`Connected to existing ShardBrowser instance at ${cdpUrl}`);
      return {
        browser: this._browser,
        page: this._page,
        cdpUrl: this._cdpUrl
      };
    } catch (error: any) {
      throw new ConnectionError(`Failed to connect to browser: ${error.message}`);
    }
  }

  async close(): Promise<void> {
    if (this._browser) {
      await this._browser.close().catch(() => {});
      logger.info('Browser connection closed');
    }
    if (this._startedProfileId) {
      await this._apiClient.stopProfile(this._startedProfileId);
      logger.info(`Stopped profile [${this._startedProfileId}] via Launcher API`);
    }
  }

  getPage(): any {
    return this._page;
  }
}