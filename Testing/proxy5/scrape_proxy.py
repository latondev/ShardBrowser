#!/usr/bin/env python3
"""
Proxy5.net Free Proxy Scraper
Scrapes proxies from proxy5.net API with filters:
  - Protocol: HTTP
  - Anonymity: Transparent
  - Max Latency: <= 100 ms
  - Speed: Fast (download_speed >= 250)
  - Min Uptime: >= 50%
  - Last Checked: <= 10 min ago
"""

import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# --- CONFIG ---
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "proxies.txt")
BASE_URL = "https://proxy5.net/api/free-proxies.php"

# Filters (match the image)
FILTER_PROTOCOL = "HTTP"
FILTER_ANONYMITY = "Transparent"
FILTER_MAX_LATENCY_MS = 100
FILTER_MIN_SPEED = 250       # "Fast" = download_speed >= 250
FILTER_MIN_UPTIME_PCT = 50   # >= 50%
FILTER_MAX_LAST_CHECKED_MIN = 10  # <= 10 min ago


def get_data_version():
    """Calculate the data version based on 30-minute window."""
    now_ms = int(time.time() * 1000)
    window_ms = 30 * 60 * 1000
    return math.floor(now_ms / window_ms)


def fetch_proxies():
    """Fetch proxy list from the API."""
    version = get_data_version()
    url = f"{BASE_URL}?v={version}"
    print(f"[*] Fetching proxies from: {url}")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://proxy5.net/free-proxy",
        "Origin": "https://proxy5.net",
    }

    req = Request(url, headers=headers)

    try:
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            print(f"[+] Fetched raw data ({len(raw)} bytes)")
            return data
    except (URLError, HTTPError) as e:
        print(f"[!] Failed to fetch: {e}")
        sys.exit(1)


def parse_proxies(data):
    """Parse the API response into a list of proxy dicts.
    
    The API returns an object with a 'proxies' array or similar structure.
    Each proxy has fields like: ip_address, port, protocols, anonymity,
    country, latency, uptime, last_checked, download_speed, etc.
    """
    proxies = []

    # Handle different response structures
    if isinstance(data, list):
        proxies = data
    elif isinstance(data, dict):
        # Try common keys
        for key in ["proxies", "data", "list", "items", "results"]:
            if key in data and isinstance(data[key], list):
                proxies = data[key]
                break
        # If no key found, maybe the dict itself has proxy info
        if not proxies and "ip_address" in data:
            proxies = [data]

    if not proxies:
        print("[!] No proxies found in response")
        print(f"[!] Response keys: {list(data.keys()) if isinstance(data, dict) else type(data)}")
        # Save raw response for debugging
        debug_file = os.path.join(OUTPUT_DIR, "debug_response.json")
        with open(debug_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"[*] Raw response saved to {debug_file}")

    return proxies


def parse_relative_time(time_str):
    """Parse relative time string like '9 min', '30 sec', '2 hours' to seconds."""
    if not time_str:
        return float("inf")
    time_str = str(time_str).strip().lower()

    import re
    # Match patterns like "9 min", "30 sec", "2 hours", "1 day"
    match = re.match(r"(\d+)\s*(sec|min|hour|day|week|month|year)", time_str)
    if not match:
        return float("inf")

    value = int(match.group(1))
    unit = match.group(2)

    multipliers = {
        "sec": 1,
        "min": 60,
        "hour": 3600,
        "day": 86400,
        "week": 604800,
        "month": 2592000,
        "year": 31536000,
    }

    return value * multipliers.get(unit, 0)


def seconds_ago(time_str):
    """Calculate how many seconds ago a time string was."""
    # Try relative time format first (e.g., "9 min", "30 sec")
    result = parse_relative_time(time_str)
    if result != float("inf"):
        return result

    # Try ISO datetime format
    try:
        s = str(time_str).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        now = datetime.now(timezone.utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        diff = now - dt
        return max(0, diff.total_seconds())
    except (ValueError, TypeError):
        return float("inf")


def matches_filter(proxy):
    """Check if proxy matches all filter criteria."""
    # Protocol filter
    protocols = proxy.get("protocols", proxy.get("protocol", ""))
    if isinstance(protocols, list):
        protocols_str = " ".join(str(p).upper() for p in protocols)
    else:
        protocols_str = str(protocols).upper()
    if FILTER_PROTOCOL.upper() not in protocols_str:
        return False

    # Anonymity filter
    anonymity = str(proxy.get("anonymity", "")).strip()
    if anonymity.lower() != FILTER_ANONYMITY.lower():
        return False

    # Latency filter
    latency = proxy.get("latency", proxy.get("ping", 9999))
    try:
        latency = float(latency)
    except (ValueError, TypeError):
        latency = 9999
    if latency > FILTER_MAX_LATENCY_MS:
        return False

    # Speed filter
    speed = proxy.get("download_speed", proxy.get("speed", proxy.get("mbps", 0)))
    try:
        speed = float(speed)
    except (ValueError, TypeError):
        speed = 0
    if speed < FILTER_MIN_SPEED:
        return False

    # Uptime filter
    uptime = proxy.get("uptime", proxy.get("uptime_percent", 0))
    try:
        uptime = float(uptime)
    except (ValueError, TypeError):
        uptime = 0
    if uptime < FILTER_MIN_UPTIME_PCT:
        return False

    # Last checked filter
    last_checked = proxy.get("last_checked", proxy.get("last_check", proxy.get("checked_at", "")))
    seconds = seconds_ago(last_checked)
    max_seconds = FILTER_MAX_LAST_CHECKED_MIN * 60
    if seconds > max_seconds:
        return False

    return True


def format_proxy(proxy):
    """Format proxy as ip:port string."""
    ip = proxy.get("ip_address", proxy.get("ip", proxy.get("host", "")))
    port = proxy.get("port", "")
    return f"{ip}:{port}"


def main():
    print("=" * 60)
    print("  Proxy5.net Free Proxy Scraper")
    print("=" * 60)
    print(f"  Filters:")
    print(f"    Protocol:      {FILTER_PROTOCOL}")
    print(f"    Anonymity:     {FILTER_ANONYMITY}")
    print(f"    Max Latency:   <= {FILTER_MAX_LATENCY_MS} ms")
    print(f"    Min Speed:     >= {FILTER_MIN_SPEED} (Fast)")
    print(f"    Min Uptime:    >= {FILTER_MIN_UPTIME_PCT}%")
    print(f"    Last Checked:  <= {FILTER_MAX_LAST_CHECKED_MIN} min ago")
    print("=" * 60)

    # Fetch
    data = fetch_proxies()

    # Parse
    proxies = parse_proxies(data)
    print(f"[+] Total proxies fetched: {len(proxies)}")

    if not proxies:
        print("[!] No proxies to filter. Exiting.")
        sys.exit(1)

    # Debug: show first proxy structure
    if proxies:
        print(f"[*] Sample proxy keys: {list(proxies[0].keys())}")
        print(f"[*] Sample proxy: {json.dumps(proxies[0], indent=2)[:500]}")

    # Filter
    filtered = [p for p in proxies if matches_filter(p)]
    print(f"[+] Proxies matching filters: {len(filtered)}")

    # Format and deduplicate
    proxy_strings = []
    seen = set()
    for p in filtered:
        s = format_proxy(p)
        if s and ":" in s and s not in seen:
            seen.add(s)
            proxy_strings.append(s)

    print(f"[+] Unique proxies after dedup: {len(proxy_strings)}")

    # Save to file
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(proxy_strings) + "\n" if proxy_strings else "")

    print(f"[+] Saved to: {OUTPUT_FILE}")

    # Also save full data with details
    details_file = os.path.join(OUTPUT_DIR, "proxies_detailed.json")
    with open(details_file, "w", encoding="utf-8") as f:
        json.dump(filtered, f, indent=2, ensure_ascii=False)
    print(f"[+] Detailed data saved to: {details_file}")

    # Summary
    print("\n" + "=" * 60)
    print(f"  DONE! {len(proxy_strings)} proxies saved to proxies.txt")
    print("=" * 60)

    # Show first few
    if proxy_strings:
        print("\nFirst 10 proxies:")
        for s in proxy_strings[:10]:
            print(f"  {s}")


if __name__ == "__main__":
    main()
