#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Proxify.vn Free Proxy Scraper & Filter Tool
Đọc toàn bộ proxy free từ Proxify.vn, lọc theo nhu cầu và xuất file hoặc test kết nối trực tiếp.
"""

import sys
import os
import json
import argparse
import urllib.request
import urllib.error
import concurrent.futures
import time
from typing import List, Dict, Any, Optional

# Đảm bảo terminal Windows không bị lỗi Unicode
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

API_URL = "https://api.proxify.vn/api/proxy-free"
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def fetch_proxies_from_api() -> List[Dict[str, Any]]:
    """Tải toàn bộ proxy trực tiếp từ endpoint API của Proxify."""
    headers = {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://proxify.vn',
        'Referer': 'https://proxify.vn/'
    }
    req = urllib.request.Request(API_URL, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if isinstance(data, dict):
                return data.get('data', {}).get('proxies', [])
            elif isinstance(data, list):
                return data
            return []
    except Exception as e:
        print(f"[!] Lỗi khi tải dữ liệu từ API ({e})", file=sys.stderr)
        return []

def filter_proxies(
    proxies: List[Dict[str, Any]],
    country: Optional[str] = None,
    scope: Optional[str] = None,
    protocol: Optional[str] = None,
    anonymity: Optional[str] = None,
    max_latency: Optional[float] = None,
    min_uptime: Optional[float] = None,
    search: Optional[str] = None,
    alive_only: bool = False,
    ssl_only: bool = False,
    sort_by: Optional[str] = "latency",
    limit: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Lọc và sắp xếp danh sách proxy theo tiêu chí mong muốn."""
    filtered = []

    for p in proxies:
        ip = str(p.get("ip", ""))
        port = str(p.get("port", ""))
        proto = str(p.get("protocol", "")).lower()
        ssl = bool(p.get("ssl", False))
        anon = str(p.get("anonymity", "")).lower()
        latency = float(p.get("timeout") or p.get("average_timeout") or 99999)
        uptime = float(p.get("uptime") or 0.0)
        alive = bool(p.get("alive", False))

        ip_data = p.get("ip_data", {}) or {}
        country_name = str(ip_data.get("country", p.get("country", "")))
        country_code = str(ip_data.get("countryCode", p.get("countryCode", ""))).upper()
        city = str(ip_data.get("city", ""))
        isp = str(ip_data.get("isp", ""))
        asn = str(ip_data.get("as", ""))
        org = str(ip_data.get("org", ""))

        # 1. Lọc theo trạng thái Alive
        if alive_only and not alive:
            continue

        # 2. Lọc theo phạm vi (Proxy Việt Nam vs Quốc tế)
        if scope and scope.lower() == "vn":
            if country_code != "VN" and "vietnam" not in country_name.lower() and "việt nam" not in country_name.lower():
                continue

        # 3. Lọc theo quốc gia cụ thể (VN, US, DE, Vietnam,...)
        if country and country.upper() != "ALL":
            target = country.lower().strip()
            if country_code.lower() != target and target not in country_name.lower():
                continue

        # 4. Lọc theo giao thức (HTTP, HTTPS, SOCKS4, SOCKS5)
        if protocol and protocol.upper() != "ALL":
            target_proto = protocol.lower().strip()
            if target_proto == "https":
                if not (proto == "https" or (proto == "http" and ssl)):
                    continue
            elif target_proto == "http":
                if proto != "http":
                    continue
            elif target_proto in ("socks4", "socks5"):
                if proto != target_proto:
                    continue

        # 5. Lọc SSL
        if ssl_only and not ssl:
            continue

        # 6. Lọc độ ẩn danh (elite, anonymous, transparent)
        if anonymity and anonymity.upper() != "ALL":
            if anon != anonymity.lower().strip():
                continue

        # 7. Lọc độ trễ tối đa (ms)
        if max_latency is not None and latency > max_latency:
            continue

        # 8. Lọc uptime tối thiểu (%)
        if min_uptime is not None and uptime < min_uptime:
            continue

        # 9. Tìm kiếm tự do theo từ khóa
        if search:
            q = search.lower().strip()
            search_blob = f"{ip}:{port} {country_name} {country_code} {city} {isp} {asn} {org}".lower()
            if q not in search_blob:
                continue

        filtered.append(p)

    # Sắp xếp
    if sort_by == "latency":
        filtered.sort(key=lambda x: float(x.get("timeout") or x.get("average_timeout") or 99999))
    elif sort_by == "uptime":
        filtered.sort(key=lambda x: float(x.get("uptime") or 0.0), reverse=True)
    elif sort_by == "country":
        filtered.sort(key=lambda x: str((x.get("ip_data") or {}).get("country", "")))
    elif sort_by == "last_seen":
        filtered.sort(key=lambda x: float(x.get("last_seen") or 0), reverse=True)

    if limit and limit > 0:
        filtered = filtered[:limit]

    return filtered

def test_single_proxy(proxy_dict: Dict[str, Any], test_url: str = "http://httpbin.org/ip", timeout: int = 5) -> Dict[str, Any]:
    """Kiểm tra độ trễ thực tế của proxy."""
    ip = proxy_dict.get("ip")
    port = proxy_dict.get("port")
    proto = proxy_dict.get("protocol", "http").lower()
    proxy_str = f"{proto}://{ip}:{port}"
    
    start_time = time.time()
    try:
        proxy_handler = urllib.request.ProxyHandler({'http': proxy_str, 'https': proxy_str})
        opener = urllib.request.build_opener(proxy_handler)
        req = urllib.request.Request(test_url, headers={'User-Agent': DEFAULT_USER_AGENT})
        with opener.open(req, timeout=timeout) as resp:
            elapsed = (time.time() - start_time) * 1000
            proxy_dict["is_live"] = True
            proxy_dict["real_ping_ms"] = round(elapsed, 1)
            return proxy_dict
    except Exception:
        proxy_dict["is_live"] = False
        proxy_dict["real_ping_ms"] = None
        return proxy_dict

def check_proxies_live(proxies: List[Dict[str, Any]], max_workers: int = 20, timeout: int = 5) -> List[Dict[str, Any]]:
    """Kiểm tra đồng thời nhiều proxy bằng ThreadPool."""
    live_proxies = []
    print(f"[*] Đang test kết nối cho {len(proxies)} proxies (threads={max_workers}, timeout={timeout}s)...", file=sys.stderr)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(test_single_proxy, p, "http://httpbin.org/ip", timeout): p for p in proxies}
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res.get("is_live"):
                live_proxies.append(res)
    print(f"[✓] Đã kiểm tra xong: {len(live_proxies)}/{len(proxies)} proxy đang hoạt động tốt!", file=sys.stderr)
    live_proxies.sort(key=lambda x: x.get("real_ping_ms", 99999))
    return live_proxies

def format_proxy(p: Dict[str, Any], fmt: str) -> str:
    ip = p.get("ip", "")
    port = p.get("port", "")
    proto = p.get("protocol", "http").lower()
    if fmt == "ip:port":
        return f"{ip}:{port}"
    elif fmt == "protocol":
        return f"{proto}://{ip}:{port}"
    elif fmt == "csv":
        ip_data = p.get("ip_data", {}) or {}
        country = ip_data.get("country", "")
        code = ip_data.get("countryCode", "")
        anon = p.get("anonymity", "")
        latency = round(float(p.get("timeout") or 0), 1)
        uptime = round(float(p.get("uptime") or 0), 1)
        return f'"{ip}","{port}","{proto}","{code}","{country}","{anon}","{latency}","{uptime}"'
    return f"{ip}:{port}"

def print_table(proxies: List[Dict[str, Any]], show_live_ping: bool = False):
    header = f"{'#':<4} | {'IP:PORT':<21} | {'COUNTRY':<18} | {'PROTO':<7} | {'ANON':<11} | {'LATENCY':<9} | {'UPTIME':<7}"
    if show_live_ping:
        header = f"{'#':<4} | {'IP:PORT':<21} | {'COUNTRY':<18} | {'PROTO':<7} | {'ANON':<11} | {'REAL PING':<10} | {'UPTIME':<7}"
    
    sep = "-" * len(header)
    print(sep)
    print(header)
    print(sep)
    for idx, p in enumerate(proxies, 1):
        ip = str(p.get("ip", ""))
        port = str(p.get("port", ""))
        ipport = f"{ip}:{port}"
        ip_data = p.get("ip_data", {}) or {}
        country = f"{ip_data.get('countryCode', '')} - {ip_data.get('country', '')}"[:18]
        proto = str(p.get("protocol", "")).upper()[:7]
        anon = str(p.get("anonymity", "")).capitalize()[:11]
        uptime = f"{float(p.get('uptime') or 0):.1f}%"
        if show_live_ping:
            ping_val = f"{p.get('real_ping_ms', 0):.0f} ms" if p.get('real_ping_ms') else "N/A"
            print(f"{idx:<4} | {ipport:<21} | {country:<18} | {proto:<7} | {anon:<11} | {ping_val:<10} | {uptime:<7}")
        else:
            lat = f"{float(p.get('timeout') or 0):.0f} ms"
            print(f"{idx:<4} | {ipport:<21} | {country:<18} | {proto:<7} | {anon:<11} | {lat:<9} | {uptime:<7}")
    print(sep)
    print(f"Total: {len(proxies)} proxies shown\n")

def main():
    parser = argparse.ArgumentParser(description="Proxify.vn Free Proxy Scraper & Filter Tool")
    parser.add_argument("--scope", choices=["all", "vn"], default="all", help="Phạm vi: 'all' hoặc 'vn'")
    parser.add_argument("-c", "--country", type=str, help="Mã hoặc tên quốc gia (VN, US, DE,...)")
    parser.add_argument("-p", "--protocol", choices=["http", "https", "socks4", "socks5", "all"], default="all", help="Giao thức")
    parser.add_argument("-a", "--anonymity", choices=["elite", "anonymous", "transparent", "all"], default="all", help="Độ ẩn danh")
    parser.add_argument("-l", "--max-latency", type=float, help="Độ trễ tối đa (ms)")
    parser.add_argument("-u", "--min-uptime", type=float, help="Uptime tối thiểu (%)")
    parser.add_argument("-q", "--search", type=str, help="Tìm kiếm IP, Port, City, ISP...")
    parser.add_argument("--alive-only", action="store_true", help="Chỉ lấy proxy alive")
    parser.add_argument("--ssl", action="store_true", help="Chỉ lấy proxy có SSL")
    parser.add_argument("-n", "--limit", type=int, help="Giới hạn số lượng proxy")
    parser.add_argument("--sort", choices=["latency", "uptime", "country", "last_seen"], default="latency", help="Sắp xếp")
    parser.add_argument("-f", "--format", choices=["ip:port", "protocol", "json", "table", "csv"], default="table", help="Định dạng xuất")
    parser.add_argument("-o", "--output", type=str, help="Lưu kết quả ra file")
    parser.add_argument("--check", action="store_true", help="Kiểm tra kết nối thực tế (live check)")
    parser.add_argument("--threads", type=int, default=20, help="Số luồng test proxy")
    parser.add_argument("--timeout", type=int, default=5, help="Timeout kết nối khi test (giây)")

    args = parser.parse_args()

    # 1. Lấy dữ liệu từ API
    raw_proxies = fetch_proxies_from_api()
    if not raw_proxies:
        print("[!] Không tìm thấy dữ liệu proxy.", file=sys.stderr)
        sys.exit(1)

    # 2. Lọc danh sách
    results = filter_proxies(
        proxies=raw_proxies,
        country=args.country,
        scope=args.scope,
        protocol=args.protocol,
        anonymity=args.anonymity,
        max_latency=args.max_latency,
        min_uptime=args.min_uptime,
        search=args.search,
        alive_only=args.alive_only,
        ssl_only=args.ssl,
        sort_by=args.sort,
        limit=args.limit
    )

    # 3. Test sống/chết nếu có --check
    if args.check:
        results = check_proxies_live(results, max_workers=args.threads, timeout=args.timeout)

    # 4. Xuất kết quả
    if args.format == "json":
        output_str = json.dumps(results, ensure_ascii=False, indent=2)
    elif args.format == "table":
        if args.output:
            import io
            buffer = io.StringIO()
            sys_stdout = sys.stdout
            sys.stdout = buffer
            print_table(results, show_live_ping=args.check)
            sys.stdout = sys_stdout
            output_str = buffer.getvalue()
        else:
            print_table(results, show_live_ping=args.check)
            return
    elif args.format == "csv":
        csv_header = '"ip","port","protocol","countryCode","country","anonymity","latency_ms","uptime_percent"'
        lines = [csv_header] + [format_proxy(p, "csv") for p in results]
        output_str = "\n".join(lines)
    else:
        lines = [format_proxy(p, args.format) for p in results]
        output_str = "\n".join(lines)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output_str)
        print(f"[✓] Đã lưu {len(results)} proxy vào file: {args.output}")
    else:
        print(output_str)

if __name__ == "__main__":
    main()
