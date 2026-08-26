import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'crypto';
import { logger } from './logger';

export interface ShardSettings {
  api_port?: number;
  api_secret?: string;
  api_enabled?: boolean;
}

export interface ProfileMeta {
  id: string;
  name: string;
  folder?: string;
  notes?: string;
  running?: boolean;
  cdp?: {
    port?: number;
    ws?: string;
    http?: string;
    http_url?: string;
    web_socket_debugger_url?: string;
  };
}

export interface StartProfileResult {
  profile_id: string;
  pid: number;
  headless: boolean;
  cdp?: {
    port?: number;
    ws?: string;
    http?: string;
    http_url?: string;
    web_socket_debugger_url?: string;
  };
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function generateJwt(secret: string, ttlSeconds: number = 3600): string {
  const header = { typ: 'JWT', alg: 'HS256' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: 'shardx-api',
    iat: now,
    exp: now + ttlSeconds
  };

  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const signatureB64 = base64url(signature);

  return `${signingInput}.${signatureB64}`;
}

export class ShardBrowserApiClient {
  private _port: number = 40325;
  private _secret: string = '';

  constructor() {
    this._loadSettings();
  }

  private _loadSettings(): void {
    const appData = process.env.APPDATA || '';
    if (!appData) return;

    const settingsPath = path.join(appData, 'shardx-launcher', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const settings: ShardSettings = JSON.parse(raw);
        if (settings.api_port) this._port = settings.api_port;
        if (settings.api_secret) this._secret = settings.api_secret;
      } catch (e: any) {
        logger.debug(`Failed to read shardx settings: ${e.message}`);
      }
    }
  }

  private async _request<T = any>(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    endpoint: string,
    body?: any
  ): Promise<T> {
    const token = this._secret ? generateJwt(this._secret) : '';

    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (payload) {
        headers['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this._port,
          path: endpoint,
          method,
          headers,
          timeout: 15000
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(data ? JSON.parse(data) : ({} as T));
              } catch {
                resolve(data as any);
              }
            } else {
              reject(new Error(`API ${method} ${endpoint} failed (${res.statusCode}): ${data}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`API request timed out: ${endpoint}`));
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await this._request<{ ok: boolean }>('GET', '/health');
      return res && res.ok === true;
    } catch {
      return false;
    }
  }

  async listProfiles(): Promise<ProfileMeta[]> {
    return await this._request<ProfileMeta[]>('GET', '/profiles');
  }

  async listProfilesByGroup(groupNameValue: string): Promise<ProfileMeta[]> {
    const profiles = await this.listProfiles();
    const normalized = groupNameValue.trim().toLowerCase();
    return profiles.filter((p) => (p.folder || '').trim().toLowerCase() === normalized);
  }

  async getNewFingerprint(): Promise<any> {
    const res = await this._request<{ fingerprint: any }>('GET', '/fingerprint/new');
    return res.fingerprint;
  }

  async createProfile(nameValue: string = 'AutoFlow Profile', folderValue: string = 'Veo3'): Promise<ProfileMeta> {
    const fingerprint = await this.getNewFingerprint();
    return await this._request<ProfileMeta>('POST', '/profiles', {
      name: nameValue,
      folder: folderValue,
      fingerprint
    });
  }

  async createTemporaryProfile(nameValue: string = 'AutoFlow Temp Profile'): Promise<ProfileMeta> {
    return await this._request<ProfileMeta>('POST', '/profiles/temporary', { name: nameValue });
  }

  async startProfile(profileIdValue: string, headlessValue: boolean = false): Promise<StartProfileResult> {
    return await this._request<StartProfileResult>('POST', `/profiles/${profileIdValue}/start`, { headless: headlessValue });
  }

  async stopProfile(profileIdValue: string): Promise<void> {
    try {
      await this._request('POST', `/profiles/${profileIdValue}/stop`);
    } catch (e: any) {
      logger.warn(`Failed to stop profile ${profileIdValue}: ${e.message}`);
    }
  }
}
