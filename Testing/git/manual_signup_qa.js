/**
 * Manual QA: create one ShardBrowser profile, attach CDP, open GitHub signup.
 * No form filling, CAPTCHA solving, retries, proxy rotation or batch runner.
 * The browser/profile remain available after CDP disconnects.
 *
 * PowerShell (from repository root):
 *   node Testing/git/manual_signup_qa.js
 *
 * Token: LAUNCHER_API_TOKEN overrides manual_signup_qa.token.local beside this file.
 * Optional: LAUNCHER_API_URL (default http://127.0.0.1:40325).
 * Each invocation creates ONE persistent profile in QA-Manual with a saved proxy.
 * To resume an earlier session, open that profile in ShardBrowser's UI.
 */
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import os from 'node:os';

const HELP = `Manual GitHub signup QA

Usage: node Testing/git/manual_signup_qa.js [--proxy-id=ID | --list-proxies | --help]

1. Open ShardBrowser > Settings, enable Local API and copy the Bearer token.
   Restart ShardBrowser if you changed the API enable/port setting.
2. Save the token in manual_signup_qa.token.local beside this script (Git-ignored),
   or set $env:LAUNCHER_API_TOKEN = '<your Bearer token>' to override it.
3. In PowerShell:
   node Testing/git/manual_signup_qa.js

Optional: $env:LAUNCHER_API_URL = 'http://127.0.0.1:40325'

If ShardBrowser has one saved proxy, it is selected automatically.
With multiple proxies, select by number when prompted or pass --proxy-id=ID.
--list-proxies only lists saved proxies; it does not create a profile.
Creates one profile in QA-Manual using Launcher defaults and the selected proxy.
No automatic switch to Direct IP or another proxy is performed.
Opens https://github.com/signup, then disconnects CDP, leaving the browser open.
Complete signup and any verification manually. A challenge may still appear.
No success claim is made about signup or anti-bot verification.
Profiles persist, including on errors; reopen or delete them manually in the UI.
`;

async function askProxyNumber() {
  if (!process.stdin.isTTY) {
    throw new Error('Proxy selection needs an interactive terminal or --proxy-id=ID.');
  }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return await input.question('Chon so proxy (Enter de huy): '); }
  finally { input.close(); }
}

function requireLoopback(raw, protocols) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid local API/CDP URL.'); }
  if (!protocols.includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password) {
    throw new Error('API/CDP must use a loopback URL without embedded credentials.');
  }
  return url;
}

function resolveLauncherApiUrl(env) {
  if (env.LAUNCHER_API_URL) return env.LAUNCHER_API_URL;
  const settingsPaths = [
    env.APPDATA && path.join(env.APPDATA, 'shardx-launcher', 'settings.json'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'shardx-launcher', 'settings.json'),
    path.join(os.homedir(), '.config', 'shardx-launcher', 'settings.json'),
  ].filter(Boolean);
  for (const settingsPath of settingsPaths) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const port = Number(settings.api_port);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) {
        return `http://127.0.0.1:${port}`;
      }
    } catch {}
  }
  return 'http://127.0.0.1:40325';
}

export async function runManualQa({
  args = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  connectBrowser,
  log = console.log,
  chooseProxy = askProxyNumber,
} = {}) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    log(HELP);
    return;
  }
  const listOnly = args.length === 1 && args[0] === '--list-proxies';
  const proxyArg = args.length === 1 && args[0].startsWith('--proxy-id=')
    ? args[0].slice('--proxy-id='.length).trim() : null;
  if (args.length && !listOnly && !proxyArg) throw new Error('Unknown arguments. Use --help.');
  let rawToken = env.LAUNCHER_API_TOKEN;
  if (rawToken === undefined) {
    try {
      rawToken = readFileSync(new URL('./manual_signup_qa.token.local', import.meta.url), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error('Launcher token file could not be read. Check manual_signup_qa.token.local.');
      }
    }
  }
  const token = (rawToken || '').trim().replace(/^Bearer\s+/i, '');
  if (!token || /[\r\n]/.test(token)) {
    throw new Error('Set LAUNCHER_API_TOKEN or save your token in manual_signup_qa.token.local. Use --help.');
  }
  const base = requireLoopback(resolveLauncherApiUrl(env), ['http:', 'https:']);
  if (base.pathname !== '/' || base.search || base.hash) {
    throw new Error('LAUNCHER_API_URL must contain only the local origin and port.');
  }
  async function api(route, body) {
    let response;
    try {
      response = await fetchImpl(`${base.origin}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(route.endsWith('/start') ? 120000 : 15000),
        redirect: 'error',
      });
    } catch {
      throw new Error(`Launcher ${route}: connection failed or timed out. Check the API in Settings. No automatic retry was made.`);
    }
    if (!response.ok) {
      throw new Error(`Launcher ${route}: HTTP ${response.status}. Check the API token and Launcher UI.`);
    }
    try { return await response.json(); }
    catch { throw new Error(`Launcher ${route}: invalid JSON response.`); }
  }

  const proxies = await api('/proxies');
  if (!Array.isArray(proxies) || proxies.some(p => !p || typeof p.id !== 'string' || !p.id)) {
    throw new Error('Proxy list from Launcher is invalid. No profile created.');
  }
  if (!proxies.length) throw new Error('Proxy list is empty. Add a proxy in ShardBrowser first.');
  // Do not print usernames, passwords, raw API objects or user-supplied notes.
  const safeLabel = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  if (listOnly || (!proxyArg && proxies.length > 1)) {
    proxies.forEach((p, index) => log(`${index + 1}. ID=${safeLabel(p.id)} | ${safeLabel(p.kind)} | ${safeLabel(p.host)}:${safeLabel(p.port)}`));
  }
  if (listOnly) return;
  let selected;
  if (proxyArg) {
    selected = proxies.find(p => p.id === proxyArg);
  } else if (proxies.length === 1) {
    selected = proxies[0];
    log(`Using the only saved proxy: ID=${safeLabel(selected.id)} | ${safeLabel(selected.kind)} | ${safeLabel(selected.host)}:${safeLabel(selected.port)}`);
  } else {
    const answer = String(await chooseProxy()).trim();
    if (/^[1-9]\d*$/.test(answer)) selected = proxies[Number(answer) - 1];
  }
  if (!selected) throw new Error('Proxy selection cancelled or invalid. No profile created.');
  // Load dependencies before creating a persistent profile.
  const connect = connectBrowser || (await import('puppeteer-core')).default.connect;
  const { fingerprint } = await api('/fingerprint/new');
  if (!fingerprint || typeof fingerprint !== 'object' || Array.isArray(fingerprint)) {
    throw new Error('Launcher did not return a profile configuration.');
  }
  const profile = await api('/profiles', {
    name: `Manual-QA-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    folder: 'QA-Manual',
    notes: 'Manual signup QA. Saved proxy selected by tester. Registration and challenges handled manually.',
    proxy_id: selected.id,
    fingerprint,
  });
  if (typeof profile.id !== 'string' || !profile.id) {
    throw new Error('Missing profile ID. Inspect QA-Manual in the UI before running again.');
  }
  log(`Created profile: ${profile.id} (QA-Manual). Keep this ID to resume manually.`);
  if (profile.proxy_id !== selected.id) {
    throw new Error('Proxy binding was not confirmed. Profile retained in QA-Manual, browser not started.');
  }
  log(`Saved proxy ID: ${safeLabel(selected.id)}. Connectivity and website acceptance have not been verified.`);
  const started = await api(`/profiles/${encodeURIComponent(profile.id)}/start`, { headless: false });
  const endpoint = started.cdp?.web_socket_debugger_url;
  if (!endpoint) throw new Error('Missing CDP endpoint. The profile is retained in QA-Manual.');
  requireLoopback(endpoint, ['ws:', 'wss:']);

  let browser;
  try {
    browser = await connect({ browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 60000 });
    const pages = await browser.pages();
    const page = pages.find(p => p.url() === 'about:blank') || await browser.newPage();
    await page.bringToFront();
    const response = await page.goto('https://github.com/signup', {
      waitUntil: 'domcontentloaded', timeout: 45000,
    });
    log(`Navigation completed (HTTP ${response?.status() ?? 'unknown'}). This does not confirm signup or verification passed.`);
    log('Continue signup and any challenge manually in the browser.');
  } finally {
    if (browser) await browser.disconnect();
    log('Profile retained. CDP disconnected if connected; the browser is not closed by this script.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runManualQa().catch(error => {
    // Do not print raw exceptions: they may include CDP URLs or request details.
    const known = /^(Set LAUNCHER_|Unknown arguments|Invalid local|API\/CDP|LAUNCHER_API_URL|Launcher |Missing |Created |Proxy )/;
    console.error(known.test(error.message) ? error.message :
      'QA setup/navigation failed. Inspect the retained profile in QA-Manual and the Launcher UI.');
    process.exitCode = 1;
  });
}
