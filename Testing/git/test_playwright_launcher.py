"""
Hướng dẫn điều khiển ShardX Browser qua Python + Playwright / Patchright
=======================================================================
1. Cài đặt thư viện:
   pip install playwright
   playwright install-deps

2. Cách hoạt động:
   - Script gọi API của ShardX Launcher để start 1 profile (bật sẵn CDP)
   - Nhận về `web_socket_debugger_url`
   - Playwright kết nối trực tiếp vào trình duyệt qua CDP (`chromium.connect_over_cdp`)
   - Tự động điều hướng, click, điền form, chụp ảnh màn hình,...
"""

import asyncio
import requests
from playwright.async_api import async_playwright

# Cấu hình API của ShardX Launcher (xem trong Settings của app)
LAUNCHER_API_URL = "http://127.0.0.1:40325"
API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaGFyZHgtYXBpIiwiaWF0IjoxNzg3MTI4NjE5LCJleHAiOjIxMDI0ODg2MTl9.Y44-0maSpd_9e7_U3yLPHgvFb1O2_GBHReb6qs0H2p0"


async def main():
    headers = {"Authorization": f"Bearer {API_TOKEN}"}

    # 1. Lấy danh sách profiles từ Launcher
    print("[1] Đang lấy danh sách profile từ Launcher...")
    try:
        res = requests.get(f"{LAUNCHER_API_URL}/profiles", headers=headers)
        if res.status_code == 401:
            print("(!) Chưa có token hoặc token không hợp lệ. Hãy kiểm tra API_TOKEN trong Settings.")
            return
        profiles = res.json()
        print(f"-> Tìm thấy {len(profiles)} profile.")
    except Exception as e:
        print(f"(!) Không kết nối được tới Launcher API: {e}")
        print("-> Đảm bảo ShardX Launcher đang chạy.")
        return

    if not profiles:
        print("(!) Bạn chưa tạo profile nào trên ShardX Launcher.")
        return

    target_profile = profiles[0]
    profile_id = target_profile["id"]
    profile_name = target_profile.get("name", "Unnamed")
    print(f"[2] Khởi chạy profile '{profile_name}' (ID: {profile_id}) với CDP...")

    # 2. Khởi chạy profile qua API (bật remote debugging CDP)
    start_res = requests.post(
        f"{LAUNCHER_API_URL}/profiles/{profile_id}/start",
        headers=headers,
        json={"headless": False}
    )
    start_data = start_res.json()
    cdp_info = start_data.get("cdp")

    if not cdp_info or "web_socket_debugger_url" not in cdp_info:
        print(f"(!) Không lấy được CDP endpoint: {start_data}")
        return

    ws_url = cdp_info["web_socket_debugger_url"]
    print(f"-> CDP WebSocket URL: {ws_url}")

    # 3. Kết nối Playwright vào ShardX Browser
    print("[3] Đang kết nối Playwright qua CDP...")
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(ws_url)
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else await context.new_page()

        # 4. Tự động hóa tác vụ: Mở trang test fingerprint
        print("[4] Đang mở trang kiểm tra fingerprint (browserleaks.com/javascript)...")
        await page.goto("https://browserleaks.com/javascript", wait_until="domcontentloaded")
        
        title = await page.title()
        print(f"-> Tiêu đề trang: {title}")

        # Lấy thông tin navigator từ trang web
        user_agent = await page.evaluate("navigator.userAgent")
        platform = await page.evaluate("navigator.platform")
        hardware_concurrency = await page.evaluate("navigator.hardwareConcurrency")

        print(f"--- Kết quả Fingerprint trên trang web ---")
        print(f"  User-Agent : {user_agent}")
        print(f"  Platform   : {platform}")
        print(f"  CPU Cores  : {hardware_concurrency}")
        print(f"------------------------------------------")

        # Đợi 10 giây để quan sát
        print("[5] Chờ 10 giây trước khi hoàn tất...")
        await asyncio.sleep(10)

        # 5. Dọn dẹp / Đóng profile
        print("[6] Dừng profile...")
        requests.post(f"{LAUNCHER_API_URL}/profiles/{profile_id}/stop", headers=headers)
        print("-> Hoàn tất!")


if __name__ == "__main__":
    asyncio.run(main())
