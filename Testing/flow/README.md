# 🎨 Google Flow Automation Suite (ShardBrowser Edition)

Bộ công cụ tự động hóa toàn diện cho **Google Flow Canvas AI (`labs.google/fx/tools/flow`)** kết hợp cùng **ShardBrowser Multi-Profile Antidetect** và **Flow Chrome Extension**.

---

## 🌟 Tính Năng Nổi Bật

- 🚀 **Đồng Bộ Hoàn Toàn Với ShardBrowser**: Tự động kết nối ShardBrowser Launcher API (`ShardBrowserApiClient`), liên kết đúng Profile nhóm **`Veo3`** (`tuanvu1568`) với cổng CDP độc lập.
- 🔄 **Chạy Song Song Đa Tác Vụ (Multi-Profile Concurrency)**: Chạy đồng thời với các tool khác (như `Testing/git` nhóm `GitHub-Auto`) mà không bao giờ bị nghẽn hay chặn cổng CDP của nhau.
- 🧩 **Tự Động Nạp Cấu Hình Vào Extension**: Tự động ghi đè cài đặt từ `config.json` vào Chrome Extension Storage (`flow_automation_settings`).
- 📂 **Khởi Tạo Dự Án Mới Thông Minh**: Tự động phát hiện trạng thái trang chủ hoặc Canvas để tạo ngay một dự án mới toanh không độ trễ.
- ✍️ **Tương Thích Slate.js Editor**: Nhập liệu câu prompt bằng luồng Native Virtual Keyboard, giúp React State của Google Flow nhận diện 100%, xóa bỏ hoàn toàn lỗi *"Bạn phải cung cấp câu lệnh"*.
- ⏳ **Theo Dõi Tiến Độ Render Trực Tiếp**: Tự động bắt sự kiện phần trăm render (`13% -> 23% -> ... -> 100%`) từ Google AI Engine.
- 📥 **Tự Động Trích Xuất & Tải Ảnh HD**: Tải trực tiếp các ảnh thành phẩm độ phân giải cao (**1376 x 768**) về máy theo định dạng chuẩn **`id_name`**.

---

## 📁 Cấu Trúc Thư Mục

```text
Testing/flow/
├── config.json              # ⚙️ File cấu hình chính (Prompt, Mode, Tỉ lệ, Folder lưu...)
├── config.sample.json       # 📄 File cấu hình mẫu
├── package.json             # 📦 Quản lý dependencies và script chạy
├── tsconfig.json            # 🔧 Cấu hình TypeScript
├── README.md                # 📖 Tài liệu hướng dẫn sử dụng
├── src/                     # 💻 Mã nguồn TypeScript
│   ├── extension_sync_runner.ts  # 🚀 Runner chính (Launcher API + Slate.js + Download)
│   ├── shard-api.ts              # 🔗 Client giao tiếp ShardBrowser Launcher API
│   ├── form-filler.ts            # 📝 Module điền form & Slate editor
│   ├── navigator.ts              # 🌐 Module điều hướng Canvas
│   ├── types.ts                  # 🏷️ Định nghĩa kiểu dữ liệu TypeScript
│   └── index.ts                  # 🚪 Entry point
└── downloads/               # 💾 Thư mục chứa ảnh/video đã tải về
    └── farm-project/             # 📂 Thư mục con tương ứng với từng dự án
```

---

## ⚙️ Hướng Dẫn Cấu Hình `config.json`

Tệp `config.json` cho phép bạn tùy chỉnh mọi thông số render:

```json
{
  "url": "https://labs.google/fx/vi/tools/flow",
  "mode": "text-to-image",
  "aspectRatio": "16:9",
  "outputCount": 2,
  "prompt": "A beautiful peaceful organic farm with green rolling hills, cute cows and sheep grazing, a classic red wooden barn, golden hour sunrise lighting, 8k ultra detailed photography masterwork",
  "prompts": [
    "A beautiful peaceful organic farm with green rolling hills, cute cows and sheep grazing, a classic red wooden barn, golden hour sunrise lighting, 8k ultra detailed photography masterwork"
  ],
  "delayRange": [
    15,
    25
  ],
  "download": {
    "enabled": true,
    "folder": "./downloads/farm-project"
  }
}
```

### 📋 Giải thích các thông số:
| Tham số | Giá trị hỗ trợ | Mô tả |
| :--- | :--- | :--- |
| `mode` | `"text-to-image"`, `"text-to-video"`, `"image-to-video"` | Chế độ sinh ảnh hoặc video |
| `aspectRatio` | `"16:9"`, `"9:16"`, `"1:1"` | Tỉ lệ khung hình đầu ra |
| `outputCount` | `1`, `2`, `4` | Số lượng biến thể ảnh/video sinh ra cho mỗi prompt |
| `prompt` / `prompts` | `string` hoặc mảng `string[]` | Nội dung câu lệnh miêu tả chi tiết |
| `download.folder` | Đường dẫn thư mục (ví dụ: `./downloads/farm-project`) | Thư mục lưu trữ hình ảnh tải về máy |

---

## 🚀 Hướng Dẫn Sử Dụng

### 1. Cài Đặt Ban Đầu (Nếu chưa cài)
```bash
cd Testing/flow
npm install
```

### 2. Chạy Tự Động Hóa Flow
Chỉ cần chạy lệnh sau:
```bash
npm run ext:run
```

Quy trình sẽ tự động thực hiện:
1. Kết nối vào Profile `Veo3` (`tuanvu1568`) trên ShardBrowser.
2. Nạp cấu hình vào Extension.
3. Tạo Dự Án Mới trên Google Flow.
4. Gõ prompt và nhấn Render.
5. Đợi Google AI tạo xong và tải ảnh về `./downloads/...`.

---

## 🖼️ Định Dạng Tệp Tải Về (`id_name`)

Các tệp ảnh tải về máy sẽ được đặt tên theo định dạng chuẩn:
```text
{id}_{name}_{timestamp}.png
```
- **Ví dụ**:
  - `1_farm-project_1787740323557.png`
  - `2_farm-project_1787740323558.png`

---

## 🔀 Chạy Song Song Đa Tool (Flow + GitHub Auto)

Bạn có thể mở 2 terminal độc lập để chạy cùng một lúc:

- **Terminal 1 (Google Flow Automation)**:
  ```bash
  cd Testing/flow
  npm run ext:run
  ```

- **Terminal 2 (GitHub Account Creator)**:
  ```bash
  node Testing/git/batch_runner.js 5000 18
  ```

Hai tool sử dụng 2 profile hoàn toàn độc lập trong ShardBrowser (`Veo3` và `GitHub-Auto`), không bao giờ bị xung đột cổng CDP.
