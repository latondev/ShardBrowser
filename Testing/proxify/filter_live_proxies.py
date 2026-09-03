#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script kiểm tra kết nối thực tế (Live Check) cho danh sách proxy trong proxies_protocol.txt
Chỉ giữ lại các proxy vào được mạng, tự động loại bỏ proxy chết/lỗi.
"""

import os
import sys
import time
import shutil
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

# Đảm bảo mã hóa UTF-8 trên Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

INPUT_FILE = os.path.join(os.path.dirname(__file__), "proxies_protocol.txt")
BACKUP_FILE = os.path.join(os.path.dirname(__file__), "proxies_protocol.bak.txt")

import ssl

# URL kiểm tra kết nối HTTPS chuẩn - bảo đảm proxy không bị lỗi SSL certificate
TEST_URL = "https://api.ipify.org"
TIMEOUT = 5   # Số giây tối đa chờ proxy phản hồi
THREADS = 30  # Số luồng kiểm tra song song

# Context kiểm tra chứng chỉ SSL nghiêm ngặt
SSL_CONTEXT = ssl.create_default_context()

def check_single_proxy(proxy_url: str) -> tuple:
    """
    Kiểm tra 1 proxy:
    - Bắt buộc phải kết nối HTTPS thành công
    - Thẩm định chứng chỉ SSL nghiêm ngặt (loại bỏ proxy can thiệp MITM, expired cert)
    Trả về (is_alive: bool, latency_ms: int, error_msg: str)
    """
    proxy_url = proxy_url.strip()
    if not proxy_url:
        return False, 0, "Empty line"

    proxies_dict = {
        'http': proxy_url,
        'https': proxy_url
    }

    start_time = time.time()
    try:
        proxy_handler = urllib.request.ProxyHandler(proxies_dict)
        https_handler = urllib.request.HTTPSHandler(context=SSL_CONTEXT)
        opener = urllib.request.build_opener(proxy_handler, https_handler)
        
        req = urllib.request.Request(
            TEST_URL,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        
        with opener.open(req, timeout=TIMEOUT) as resp:
            if resp.status == 200:
                elapsed_ms = int((time.time() - start_time) * 1000)
                if elapsed_ms > 1500:
                    return False, elapsed_ms, f"Chậm ({elapsed_ms}ms > 1.5s)"
                return True, elapsed_ms, ""
            else:
                return False, 0, f"HTTP {resp.status}"
    except Exception as e:
        err = str(e)
        if "timed out" in err.lower():
            err_msg = "Timeout"
        elif "certificate" in err.lower() or "ssl" in err.lower():
            err_msg = "Lỗi SSL/Cert"
        elif "connection refused" in err.lower():
            err_msg = "Refused"
        elif "reset" in err.lower():
            err_msg = "Reset"
        elif "tunnel" in err.lower():
            err_msg = "Tunnel Fail"
        else:
            err_msg = err[:25]
        return False, 0, err_msg

def main():
    target_file = sys.argv[1] if len(sys.argv) > 1 else INPUT_FILE

    if not os.path.exists(target_file):
        print(f"[!] Không tìm thấy file: {target_file}")
        return

    with open(target_file, "r", encoding="utf-8") as f:
        raw_lines = [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]

    total = len(raw_lines)
    if total == 0:
        print("[!] File trống, không có proxy nào để kiểm tra.")
        return

    # Sao lưu file gốc phòng hờ
    try:
        shutil.copyfile(target_file, BACKUP_FILE)
    except Exception:
        pass

    print("================================================================")
    print("      KIỂM TRA KẾT NỐI PROXY (LIVE CHECKER)")
    print(f"📁 File: {os.path.basename(target_file)} | Tổng số: {total} proxy")
    print(f"⚡ Số luồng: {THREADS} | Timeout: {TIMEOUT}s")
    print("================================================================\n")

    live_proxies = []
    dead_count = 0
    completed = 0

    with ThreadPoolExecutor(max_workers=THREADS) as executor:
        future_to_proxy = {executor.submit(check_single_proxy, p): p for p in raw_lines}

        for future in as_completed(future_to_proxy):
            proxy = future_to_proxy[future]
            completed += 1
            try:
                is_alive, latency, err = future.result()
            except Exception as e:
                is_alive, latency, err = False, 0, str(e)[:25]

            progress = f"[{completed}/{total}]"
            if is_alive:
                live_proxies.append((proxy, latency))
                print(f"{progress} \033[92m[✓ LIVE]\033[0m {proxy} ({latency}ms)")
            else:
                dead_count += 1
                print(f"{progress} \033[91m[✗ DIE ]\033[0m {proxy} ({err})")

    # Sắp xếp proxy sống theo độ trễ nhanh nhất
    live_proxies.sort(key=lambda x: x[1])

    # Ghi đè danh sách proxy sống vào file
    with open(target_file, "w", encoding="utf-8") as f:
        for p, _ in live_proxies:
            f.write(f"{p}\n")

    print("\n================================================================")
    print("🎉 HOÀN THÀNH KIỂM TRA:")
    print(f"   - Tổng đã test : {total}")
    print(f"   - \033[92mProxy SỐNG (đã giữ lại)\033[0m : {len(live_proxies)}")
    print(f"   - \033[91mProxy CHẾT (đã loại bỏ)\033[0m : {dead_count}")
    print(f"   - File kết quả : {target_file}")
    print(f"   - File sao lưu : {BACKUP_FILE}")
    print("================================================================")

if __name__ == "__main__":
    main()
