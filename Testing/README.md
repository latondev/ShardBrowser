# Hướng dẫn Điều khiển & Tự động hóa ShardX Browser bằng Script / AI Agent

Thư mục này chứa các kịch bản mẫu để điều khiển trình duyệt **ShardX Anti-detect Browser** bằng Node.js / Python hoặc giao toàn bộ cho **AI Agent (Browser-Use / Claude / GPT-4o / Gemini)** tự quan sát và thao tác.

---

## 📁 Danh sách các kịch bản

| File | Công nghệ | Mục đích |
| :--- | :--- | :--- |
| [`test_github_register.js`](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/test_github_register.js) | **Node.js (Puppeteer)** | Tạo profile Fingerprint ngẫu nhiên -> Mở ShardX -> Giả lập hành vi người dùng thật (human-like typing) điền form đăng ký GitHub. |
| [`test_browser_use_ai.py`](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/test_browser_use_ai.py) | **Python (Browser-Use + AI)** | **AI Agent tự động hóa hoàn toàn**: Bạn chỉ cần đưa Prompt, AI tự nhìn màn hình (Vision), tự click, tự gõ phím, tự xử lý lỗi từ đầu tới cuối. |
| [`test_puppeteer_launcher.js`](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/test_puppeteer_launcher.js) | **Node.js (Puppeteer)** | Mở profile kiểm tra thông số Fingerprint tại `browserleaks.com`. |
| [`test_playwright_launcher.py`](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/test_playwright_launcher.py) | **Python (Playwright)** | Phiên bản Playwright kết nối CDP qua Launcher API. |
| [`test_direct_chrome_cdp.py`](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/test_direct_chrome_cdp.py) | **Python (Playwright)** | Khởi chạy trực tiếp `chrome.exe` ngầm / headless không cần mở app Launcher. |

---

## 🤖 Hướng dẫn dùng AI Agent (Browser-Use)

1. Cài đặt thư viện:
   ```bash
   pip install browser-use langchain-openai langchain-anthropic langchain-google-genai requests
   ```
2. Mở file [`Testing/test_browser_use_ai.py`](file:///d:/YTB/Resgiter_AI/ShardBrowser/Testing/test_browser_use_ai.py), chọn nhà cung cấp AI (`openai`, `claude`, `gemini`, `deepseek`) và dán `AI_API_KEY` của bạn vào.
3. Thay đổi nội dung nhiệm vụ `TASK_PROMPT` theo ý bạn (VD: *"Vào Shopee tìm kiếm tai nghe...", "Vào GitHub đăng ký tài khoản..."*).
4. Chạy script:
   ```bash
   python Testing/test_browser_use_ai.py
   ```
