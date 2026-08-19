"""
Điều khiển trực tiếp ShardX Chromium bằng Playwright (Không cần mở app Launcher)
================================================================================
Kịch bản này tự khởi động tiến trình chrome.exe của ShardX cùng với file fingerprint,
mở cổng Remote Debugging CDP và gắn Playwright vào để tự động hóa hoàn toàn độc lập.

Yêu cầu:
   pip install playwright
"""

import asyncio
import os
import subprocess
from pathlib import Path
from playwright.async_api import async_playwright

# 1. Đường dẫn tới binary ShardX chrome.exe và User Data
APPDATA = os.environ.get("APPDATA")
CHROME_EXE = Path(APPDATA) / "shardx-launcher" / "runtime" / "ShardX-Windows" / "chrome.exe"
PROFILES_DIR = Path(APPDATA) / "shardx-launcher" / "profiles"
USER_DATA_ROOT = Path(APPDATA) / "shardx-launcher" / "user-data"


async def main():
    if not CHROME_EXE.exists():
        print(f"(!) Không tìm thấy ShardX chrome.exe tại: {CHROME_EXE}")
        return

    # Lấy profile đầu tiên trong thư mục profiles
    profile_files = list(PROFILES_DIR.glob("*.json"))
    if not profile_files:
        print("(!) Chưa có profile nào. Hãy tạo profile trong app ShardX trước.")
        return

    profile_id = profile_files[0].stem
    udd = USER_DATA_ROOT / profile_id
    fp_file = udd / "fingerprint.json"

    print(f"[1] Sử dụng profile ID: {profile_id}")
    print(f"    - UserDataDir : {udd}")
    print(f"    - Fingerprint : {fp_file}")

    # Đảm bảo thư mục tồn tại
    udd.mkdir(parents=True, exist_ok=True)

    # 2. Khởi chạy tiến trình ShardX Chromium với cổng CDP
    cdp_port = 9222
    cmd = [
        str(CHROME_EXE),
        f"--fingerprint-profile={fp_file}",
        f"--user-data-dir={udd}",
        f"--remote-debugging-port={cdp_port}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-sandbox",
        "--test-type"
    ]

    print(f"[2] Đang khởi chạy ShardX Chrome trên cổng CDP: http://127.0.0.1:{cdp_port}...")
    proc = subprocess.Popen(cmd)

    # Đợi 2 giây để Chrome mở cổng CDP
    await asyncio.sleep(2)

    try:
        # 3. Kết nối Playwright tới cổng CDP
        print("[3] Đang kết nối Playwright...")
        async with async_playwright() as p:
            browser = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else await context.new_page()

            # 4. Điều hướng và thực hiện tác vụ tự động
            print("[4] Đang mở trang https://google.com...")
            await page.goto("https://www.google.com")
            print(f"-> Tiêu đề: {await page.title()}")

            # Tìm ô tìm kiếm và gõ thử
            search_box = page.locator("textarea[name='q'], input[name='q']").first
            if await search_box.is_visible():
                await search_box.fill("ShardBrowser Anti-detect")
                print("-> Đã nhập từ khóa tìm kiếm thành công.")

            print("[5] Chờ 5 giây quan sát...")
            await asyncio.sleep(5)

            await browser.close()
    finally:
        # 5. Đóng tiến trình Chrome
        print("[6] Đóng tiến trình Chrome...")
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        print("-> Hoàn tất!")


if __name__ == "__main__":
    asyncio.run(main())
