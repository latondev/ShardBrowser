"""
Tích hợp AI Agent (Browser-Use) điều khiển ShardX Anti-detect Browser
====================================================================
Mô hình hoạt động:
  1. ShardX Launcher: Cung cấp trình duyệt chống phát hiện (Anti-detect Fingerprint) qua cổng CDP.
  2. Browser-Use + LLM (Claude / OpenAI / Gemini / DeepSeek): AI tự nhìn màn hình, tự phân tích DOM,
     tự suy nghĩ và thực hiện từng bước (Click, gõ phím, tự sửa lỗi khi gặp sự cố).

Cài đặt thư viện:
  pip install browser-use langchain-openai langchain-anthropic langchain-google-genai requests
"""

import asyncio
import os
import requests
from browser_use import Agent, Browser, BrowserConfig

# ==============================================================================
# CẤU HÌNH AI & SHARDX LAUNCHER
# ==============================================================================

# 1. Cấu hình ShardX Launcher
LAUNCHER_API_URL = "http://127.0.0.1:40325"
API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaGFyZHgtYXBpIiwiaWF0IjoxNzg3MTI4NjE5LCJleHAiOjIxMDI0ODg2MTl9.Y44-0maSpd_9e7_U3yLPHgvFb1O2_GBHReb6qs0H2p0"

# 2. Chọn nhà cung cấp AI & Điền API Key của bạn
# Hỗ trợ: "openai" | "claude" | "gemini" | "deepseek"
AI_PROVIDER = "openai"  # Đổi thành "claude" hoặc "gemini" nếu muốn
AI_API_KEY = "YOUR_AI_API_KEY_HERE"  # <--- Dán API Key AI của bạn vào đây

# 3. Yêu cầu (Prompt) giao cho AI tự động thực hiện
TASK_PROMPT = """
Truy cập vào trang https://github.com/signup,
tự tạo một email ngẫu nhiên dạng test_user_<random>@gmail.com,
nhập mật khẩu an toàn và username ngẫu nhiên,
bấm Tiếp tục (Continue) qua các bước đăng ký.
Nếu gặp lỗi hoặc nút chưa sáng, hãy kiểm tra và xử lý để tiếp tục.
"""
# ==============================================================================


def get_llm():
    """Khởi tạo mô hình AI phù hợp theo cấu hình."""
    if AI_PROVIDER == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model="gpt-4o",
            api_key=AI_API_KEY,
            temperature=0.0
        )
    elif AI_PROVIDER == "claude":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model="claude-3-5-sonnet-20241022",
            api_key=AI_API_KEY,
            temperature=0.0
        )
    elif AI_PROVIDER == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            google_api_key=AI_API_KEY,
            temperature=0.0
        )
    elif AI_PROVIDER == "deepseek":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model="deepseek-chat",
            api_key=AI_API_KEY,
            base_url="https://api.deepseek.com",
            temperature=0.0
        )
    else:
        raise ValueError(f"Không hỗ trợ AI_PROVIDER: {AI_PROVIDER}")


async def main():
    headers = {"Authorization": f"Bearer {API_TOKEN}"}

    print("==================================================")
    print("      KHỞI ĐỘNG BROWSER-USE AI TRÊN SHARDX        ")
    print("==================================================")

    if AI_API_KEY == "YOUR_AI_API_KEY_HERE":
        print("\n(!) BẠN CHƯA ĐIỀN API KEY AI:")
        print("    Vui lòng mở file Testing/test_browser_use_ai.py và dán API Key vào biến AI_API_KEY.")
        return

    # 1. Tạo hoặc chọn 1 Profile từ ShardX
    print("\n[1] Đang kết nối ShardX Launcher để khởi tạo Profile...")
    try:
        # Lấy danh sách profile hiện có hoặc tạo mới
        res = requests.get(f"{LAUNCHER_API_URL}/profiles", headers=headers)
        profiles = res.json()
        if not profiles:
            # Tạo profile random nếu chưa có
            fp_res = requests.get(f"{LAUNCHER_API_URL}/fingerprint/new", headers=headers).json()
            created = requests.post(
                f"{LAUNCHER_API_URL}/profiles",
                headers=headers,
                json={"name": "AI-Agent-Profile", "fingerprint": fp_res["fingerprint"]}
            ).json()
            profile_id = created["id"]
        else:
            profile_id = profiles[0]["id"]

        # 2. Khởi chạy Profile lấy WebSocket CDP
        start_res = requests.post(
            f"{LAUNCHER_API_URL}/profiles/{profile_id}/start",
            headers=headers,
            json={"headless": False}
        ).json()

        ws_url = start_res["cdp"]["web_socket_debugger_url"]
        print(f"-> Đã kết nối ShardX Anti-detect Browser qua CDP:\n   {ws_url}")
    except Exception as e:
        print(f"(!) Lỗi khi khởi động ShardX Profile: {e}")
        return

    # 3. Cấu hình Browser-Use kết nối vào ShardX
    print("\n[2] Đang gắn Browser-Use AI Agent vào ShardX...")
    browser = Browser(
        config=BrowserConfig(
            cdp_url=ws_url,
            headless=False,
            disable_security=True,
        )
    )

    # 4. Khởi tạo Agent với Prompt và LLM
    llm = get_llm()
    agent = Agent(
        task=TASK_PROMPT,
        llm=llm,
        browser=browser,
        use_vision=True,  # Bật tính năng AI nhìn màn hình (Vision)
    )

    print(f"\n[3] Bắt đầu thực thi nhiệm vụ AI:\n--- Prompt: ---\n{TASK_PROMPT.strip()}\n---------------")
    
    # 5. Chạy Agent tự động
    history = await agent.run()

    print("\n==================================================")
    print("-> KẾT QUẢ THỰC THI CỦA AI:")
    print(history.final_result() if history else "Hoàn tất nhiệm vụ.")
    print("==================================================")

    # Chờ 15s trước khi dọn dẹp
    await asyncio.sleep(15)
    requests.post(f"{LAUNCHER_API_URL}/profiles/{profile_id}/stop", headers=headers)
    print("-> Đã đóng trình duyệt.")


if __name__ == "__main__":
    asyncio.run(main())
