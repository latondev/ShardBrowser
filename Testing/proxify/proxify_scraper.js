/**
 * Proxify.vn Free Proxy Scraper (ES Module / Node.js & Browser)
 * Fetch and filter free proxies from Proxify.vn
 */

const API_URL = "https://api.proxify.vn/api/proxy-free";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Fetch all raw proxies from Proxify API
 * @returns {Promise<Array<Object>>}
 */
export async function fetchProxies() {
  const response = await fetch(API_URL, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://proxify.vn',
      'Referer': 'https://proxify.vn/'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch proxies: HTTP ${response.status}`);
  }
  const json = await response.json();
  return json?.data?.proxies || (Array.isArray(json) ? json : []);
}

/**
 * Filter and sort proxy list
 * @param {Array<Object>} proxies 
 * @param {Object} options 
 * @returns {Array<Object>}
 */
export function filterProxies(proxies, options = {}) {
  const {
    scope = "all",          // 'all' or 'vn'
    country = null,         // 'VN', 'US', 'Germany', etc.
    protocol = "all",       // 'http', 'https', 'socks4', 'socks5', 'all'
    anonymity = "all",      // 'elite', 'anonymous', 'transparent', 'all'
    maxLatency = null,      // e.g. 500 (ms)
    minUptime = null,       // e.g. 90 (%)
    search = null,          // keyword
    aliveOnly = false,
    sslOnly = false,
    sortBy = "latency",     // 'latency', 'uptime', 'country', 'last_seen'
    limit = null
  } = options;

  let result = proxies.filter(p => {
    const ip = String(p.ip || "");
    const port = String(p.port || "");
    const proto = String(p.protocol || "").toLowerCase();
    const ssl = Boolean(p.ssl);
    const anon = String(p.anonymity || "").toLowerCase();
    const latency = Number(p.timeout || p.average_timeout || 99999);
    const uptime = Number(p.uptime || 0);
    const alive = Boolean(p.alive);

    const ipData = p.ip_data || {};
    const countryName = String(ipData.country || p.country || "");
    const countryCode = String(ipData.countryCode || p.countryCode || "").toUpperCase();
    const city = String(ipData.city || "");
    const isp = String(ipData.isp || "");
    const asn = String(ipData.as || "");
    const org = String(ipData.org || "");

    // 1. Alive
    if (aliveOnly && !alive) return false;

    // 2. Scope
    if (scope && scope.toLowerCase() === "vn") {
      if (countryCode !== "VN" && !countryName.toLowerCase().includes("vietnam")) return false;
    }

    // 3. Country
    if (country && country.toUpperCase() !== "ALL") {
      const target = country.toLowerCase().trim();
      if (countryCode.toLowerCase() !== target && !countryName.toLowerCase().includes(target)) {
        return false;
      }
    }

    // 4. Protocol
    if (protocol && protocol.toUpperCase() !== "ALL") {
      const targetProto = protocol.toLowerCase().trim();
      if (targetProto === "https") {
        if (!(proto === "https" || (proto === "http" && ssl))) return false;
      } else if (targetProto === "http") {
        if (proto !== "http") return false;
      } else if (["socks4", "socks5"].includes(targetProto)) {
        if (proto !== targetProto) return false;
      }
    }

    // 5. SSL
    if (sslOnly && !ssl) return false;

    // 6. Anonymity
    if (anonymity && anonymity.toUpperCase() !== "ALL") {
      if (anon !== anonymity.toLowerCase().trim()) return false;
    }

    // 7. Max latency
    if (maxLatency !== null && latency > maxLatency) return false;

    // 8. Min uptime
    if (minUptime !== null && uptime < minUptime) return false;

    // 9. Free-text search
    if (search) {
      const q = search.toLowerCase().trim();
      const blob = `${ip}:${port} ${countryName} ${countryCode} ${city} ${isp} ${asn} ${org}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }

    return true;
  });

  // Sorting
  if (sortBy === "latency") {
    result.sort((a, b) => Number(a.timeout || 99999) - Number(b.timeout || 99999));
  } else if (sortBy === "uptime") {
    result.sort((a, b) => Number(b.uptime || 0) - Number(a.uptime || 0));
  } else if (sortBy === "country") {
    result.sort((a, b) => (a.ip_data?.country || "").localeCompare(b.ip_data?.country || ""));
  }

  if (limit && limit > 0) {
    result = result.slice(0, limit);
  }

  return result;
}

/**
 * Format proxy list to string format
 * @param {Array<Object>} proxies 
 * @param {'ip:port' | 'protocol' | 'json' | 'csv'} format 
 * @returns {string}
 */
export function formatProxies(proxies, format = "ip:port") {
  if (format === "json") {
    return JSON.stringify(proxies, null, 2);
  }
  if (format === "protocol") {
    return proxies.map(p => `${p.protocol || 'http'}://${p.ip}:${p.port}`).join("\n");
  }
  if (format === "csv") {
    const header = '"ip","port","protocol","countryCode","country","anonymity","latency_ms","uptime_percent"';
    const rows = proxies.map(p => {
      const c = p.ip_data || {};
      return `"${p.ip}","${p.port}","${p.protocol}","${c.countryCode || ''}","${c.country || ''}","${p.anonymity || ''}","${p.timeout || 0}","${p.uptime || 0}"`;
    });
    return [header, ...rows].join("\n");
  }
  return proxies.map(p => `${p.ip}:${p.port}`).join("\n");
}

// Direct CLI execution check
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  (async () => {
    console.log("[*] Đang tải proxy từ Proxify.vn...");
    const proxies = await fetchProxies();
    console.log(`[✓] Đã tải ${proxies.length} proxy thành công.`);
    
    // Sample filter: VN proxies or fast SOCKS5
    const fast = filterProxies(proxies, { protocol: "socks5", maxLatency: 500, limit: 5 });
    console.log("\nTop 5 SOCKS5 nhanh nhất (<500ms):");
    console.log(formatProxies(fast, "protocol"));
  })();
}
