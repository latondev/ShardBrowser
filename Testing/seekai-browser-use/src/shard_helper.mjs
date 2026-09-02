import axios from "axios";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Tự động đọc cấu hình ShardBrowser và ký JWT Token
 */
export function loadShardConfig() {
  const homeDir = os.homedir();
  const candidateSettings = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "settings.json") : null,
    path.join(homeDir, ".config", "shardx-launcher", "settings.json"),
    path.join(homeDir, "AppData", "Roaming", "shardx-launcher", "settings.json")
  ].filter(Boolean);

  for (const p of candidateSettings) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const settings = JSON.parse(raw);
        const port = settings.api_port || 40325;
        const secret = settings.api_secret || "";
        let token = "";
        if (secret) {
          const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "HS256" })).toString("base64url");
          const now = Math.floor(Date.now() / 1000);
          const payload = Buffer.from(JSON.stringify({ sub: "shardx-api", iat: now, exp: now + 86400 * 30 })).toString("base64url");
          const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest().toString("base64url");
          token = `${header}.${payload}.${sig}`;
        }
        return {
          url: `http://127.0.0.1:${port}`,
          token,
          headers: { Authorization: `Bearer ${token}` }
        };
      } catch {}
    }
  }
  return { url: "http://127.0.0.1:40325", token: "", headers: {} };
}

/**
 * Đọc lịch sử test snapshot của các Proxies từ proxies-history.json
 */
export function loadProxyHistory() {
  const homeDir = os.homedir();
  const candidateHistoryFiles = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "proxies-history.json") : null,
    path.join(homeDir, ".config", "shardx-launcher", "proxies-history.json"),
    path.join(homeDir, "AppData", "Roaming", "shardx-launcher", "proxies-history.json"),
  ].filter(Boolean);

  for (const p of candidateHistoryFiles) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const data = JSON.parse(raw);
        if (data && typeof data.by_proxy === "object") {
          return data.by_proxy;
        }
      } catch {}
    }
  }
  return {};
}

/**
 * Đọc danh sách Proxies từ ShardBrowser (từ file proxies.json hoặc qua API /proxies)
 * Mặc định chỉ lấy những proxy đã test thành công và có địa chỉ IP / vị trí (tested IP / address)
 */
export async function getProxies(group = null, requireAddress = true) {
  let proxies = [];

  // 1. Thử đọc trực tiếp từ proxies.json trong AppData/Roaming/shardx-launcher/proxies.json
  const homeDir = os.homedir();
  const candidateProxyFiles = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "shardx-launcher", "proxies.json") : null,
    path.join(homeDir, ".config", "shardx-launcher", "proxies.json"),
    path.join(homeDir, "AppData", "Roaming", "shardx-launcher", "proxies.json"),
  ].filter(Boolean);

  for (const p of candidateProxyFiles) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.proxies) && data.proxies.length > 0) {
          proxies = data.proxies;
          break;
        }
      } catch {}
    }
  }

  // 2. Nếu chưa lấy được từ file, gọi qua launcher API /proxies
  if (proxies.length === 0) {
    try {
      const cfg = loadShardConfig();
      const { data } = await axios.get(`${cfg.url}/proxies`, {
        headers: cfg.headers,
        timeout: 3000,
      });
      if (Array.isArray(data)) {
        proxies = data;
      }
    } catch {}
  }

  // Lọc theo group/folder (hỗ trợ cả p.folder, p.group, p.tag, p.name)
  if (group) {
    const gClean = group.trim().toLowerCase();
    const filtered = proxies.filter((p) => {
      const folderVal = (p.folder || p.group || p.tag || "").trim().toLowerCase();
      const nameVal = (p.name || "").trim().toLowerCase();
      return folderVal === gClean || folderVal.includes(gClean) || nameVal === gClean || nameVal.includes(gClean);
    });
    if (filtered.length > 0) {
      proxies = filtered;
    }
  }

  // 3. Lọc chỉ lấy những proxy đã test CÓ ĐỊA CHỈ & IP THỰC TẾ (nếu có)
  if (requireAddress) {
    const history = loadProxyHistory();
    const verified = proxies.filter((p) => {
      const hList = history[p.id];
      if (hList && Array.isArray(hList) && hList.length > 0) {
        const latest = hList[hList.length - 1];
        if (latest && latest.ip && latest.ip.trim().length > 0) {
          p._testedIp = latest.ip;
          p._testedLocation = [latest.city, latest.country_code || latest.country].filter(Boolean).join(", ");
          return true;
        }
      }
      return false;
    });

    if (verified.length > 0) {
      return verified;
    }
  }

  return proxies;
}

/**
 * Lấy ngẫu nhiên 1 Proxy từ group chỉ định (mặc định "vn")
 */
export async function getRandomProxy(group = "vn", requireAddress = false) {
  let list = await getProxies(group, requireAddress);
  if (!list || list.length === 0) {
    list = await getProxies(group, false);
  }
  if (!list || list.length === 0) {
    // Thử lấy toàn bộ proxy nếu group không khớp
    list = await getProxies(null, false);
  }
  if (!list || list.length === 0) {
    return null;
  }
  const randomIndex = Math.floor(Math.random() * list.length);
  return list[randomIndex];
}

/**
 * Tự động dọn dẹp các profile trong group chỉ định nếu số lượng > maxAllowed
 * (Chỉ xóa profile trong đúng group đó, tuyệt đối không chạm vào các group khác như Veo3, v.v.)
 */
export async function cleanupFolderProfiles(folderName = "SeekAI-Auto", maxAllowed = 10) {
  const mgr = new ShardProfileManager(folderName);
  await mgr.cleanupFolderProfiles(maxAllowed);
}

/**
 * Quản lý vòng đời Profile ShardBrowser (Tạo Fingerprint độc bản, Start CDP, Dọn dẹp)
 */
export class ShardProfileManager {
  constructor(folder = "SeekAI-Auto") {
    this.config = loadShardConfig();
    this.folder = folder;
    this.profileId = null;
  }

  /**
   * Tự động kiểm tra số lượng profile trong folder/group chỉ định (mặc định "SeekAI-Auto").
   * Nếu tổng số profile trong group > maxAllowed (mặc định 10):
   * -> Tự động xóa các profile thuộc group đó (tuyệt đối không đụng đến group khác).
   */
  async cleanupFolderProfiles(maxAllowed = 10) {
    try {
      const { data: profiles } = await axios.get(`${this.config.url}/profiles`, {
        headers: this.config.headers,
        timeout: 5000,
      });

      if (!Array.isArray(profiles)) return;

      const targetFolder = (this.folder || "SeekAI-Auto").trim().toLowerCase();

      // Chỉ lọc profile thuộc ĐÚNG group này (tuyệt đối không chạm vào group khác như Veo3, v.v.)
      const folderProfiles = profiles.filter((p) => {
        const pFolder = (p.folder || "").trim().toLowerCase();
        return pFolder === targetFolder;
      });

      if (folderProfiles.length > maxAllowed) {
        console.log(`🧹 [ShardBrowser Cleanup] Group [${this.folder}] hiện có ${folderProfiles.length} profile (> ${maxAllowed}). Đang dọn dẹp các profile cũ trong group này...`);

        for (const p of folderProfiles) {
          // Bỏ qua profile hiện tại đang chạy nếu trùng ID
          if (this.profileId && p.id === this.profileId) continue;

          // Nếu đang running thì stop trước khi xóa
          if (p.running) {
            await axios.post(`${this.config.url}/profiles/${p.id}/stop`, {}, { headers: this.config.headers, timeout: 3000 }).catch(() => {});
          }

          // Xóa profile
          await axios.delete(`${this.config.url}/profiles/${p.id}`, { headers: this.config.headers, timeout: 3000 }).catch(() => {});
        }

        console.log(`✨ [ShardBrowser Cleanup] Đã dọn dẹp xong các profile trong group [${this.folder}].`);
      }
    } catch (err) {
      console.warn(`⚠️ Lỗi khi dọn dẹp profile trong group [${this.folder}]: ${err.message}`);
    }
  }

  // Tạo Profile mới với Fingerprint Windows mới (mặc định không dùng proxy -> dùng IP trực tiếp của máy)
  async createProfile(customName = null, proxyOption = null) {
    // Tự động kiểm tra và dọn dẹp nếu group hiện tại có > 10 profile
    await this.cleanupFolderProfiles(10);

    const sessionSuffix = Date.now().toString().slice(-4);
    const name = customName || `SEEKAI-${sessionSuffix}`;

    // 1. Lấy Fingerprint Windows mới
    const { data: fpRes } = await axios.get(`${this.config.url}/fingerprint/new/windows`, {
      headers: this.config.headers,
      timeout: 5000,
    });

    // 2. Chọn Proxy: nếu proxyOption là tên group (ví dụ "vn", "free") hoặc true -> gán proxy trong group
    let proxyId = null;
    let proxyStr = null;
    let selectedProxyInfo = null;

    if (proxyOption) {
      if (typeof proxyOption === "string" && !proxyOption.includes("://") && !proxyOption.includes(":")) {
        // Là tên group (vd: "vn", "free")
        const picked = await getRandomProxy(proxyOption, false);
        if (picked) {
          proxyId = picked.id;
          selectedProxyInfo = picked;
        } else {
          console.warn(`⚠️ Không tìm thấy proxy trong group '${proxyOption}', sẽ chạy IP trực tiếp.`);
        }
      } else if (typeof proxyOption === "object" && proxyOption.id) {
        proxyId = proxyOption.id;
        selectedProxyInfo = proxyOption;
      } else if (typeof proxyOption === "string") {
        proxyStr = proxyOption;
      }
    }

    // 3. Tạo Profile thuộc folder
    const payload = {
      name,
      folder: this.folder,
      notes: `SeekAI Auto Flow | Time: ${new Date().toLocaleTimeString()}`,
      proxy_id: proxyId || undefined,
      proxy: proxyStr || undefined,
      fingerprint: fpRes.fingerprint,
    };

    const { data: profile } = await axios.post(`${this.config.url}/profiles`, payload, {
      headers: this.config.headers,
      timeout: 5000,
    });

    this.profileId = profile.id;
    const locInfo = selectedProxyInfo?._testedLocation ? ` [${selectedProxyInfo._testedLocation}]` : ` (${selectedProxyInfo?.country || "N/A"})`;
    const ipInfo = selectedProxyInfo?._testedIp ? ` -> IP: ${selectedProxyInfo._testedIp}` : "";
    const proxyDesc = selectedProxyInfo 
      ? ` | 🌐 Proxy [Group: ${selectedProxyInfo.folder || "free"}]: ${selectedProxyInfo.name || selectedProxyInfo.host + ':' + selectedProxyInfo.port}${locInfo}${ipInfo}`
      : proxyStr ? ` | 🌐 Proxy: ${proxyStr}` : "";

    console.log(`🛡️ [ShardBrowser] Đã tạo Profile mới: [${name}] ID [${this.profileId}]${proxyDesc}`);
    return profile;
  }

  // Khởi chạy Profile và lấy WebSocket CDP URL
  async startBrowser(headless = false) {
    if (!this.profileId) throw new Error("Chưa khởi tạo Profile trong ShardBrowser!");

    const { data: startRes } = await axios.post(
      `${this.config.url}/profiles/${this.profileId}/start`,
      { headless },
      { headers: this.config.headers, timeout: 10000 }
    );

    const wsUrl = startRes.cdp?.web_socket_debugger_url;
    if (!wsUrl) {
      throw new Error(`Không nhận được WebSocket CDP từ ShardBrowser: ${JSON.stringify(startRes)}`);
    }

    console.log(`🚀 [ShardBrowser] Khởi chạy thành công qua CDP: ${wsUrl}`);
    return wsUrl;
  }

  // Dừng và xóa sạch Profile sau khi hoàn tất
  async destroyProfile() {
    if (!this.profileId) return;
    try {
      await axios.post(`${this.config.url}/profiles/${this.profileId}/stop`, {}, { headers: this.config.headers, timeout: 5000 }).catch(() => {});
      await axios.delete(`${this.config.url}/profiles/${this.profileId}`, { headers: this.config.headers, timeout: 5000 }).catch(() => {});
      console.log(`🧹 [ShardBrowser] Đã giải phóng Profile ID [${this.profileId}]`);
      this.profileId = null;
    } catch (err) {
      console.warn(`⚠️ Lỗi khi xóa Profile: ${err.message}`);
    }
  }
}
