---
name: prompt-optimize
description: Tối ưu hóa prompt, tinh chỉnh phản hồi, tăng cường tính cô đọng và chuẩn hóa phong cách lập trình cho cả Antigravity CLI (agy) và Antigravity IDE.
---

# Prompt & Response Optimization Skill

Skill này cung cấp các nguyên tắc và hướng dẫn tối ưu hóa câu lệnh (prompt), định hướng hành động và chuẩn hóa phản hồi tương thích hoàn toàn trên cả **Antigravity CLI (`agy`)** và **Antigravity IDE**.

## 1. Mục tiêu & Phạm vi áp dụng
- Áp dụng khi người dùng yêu cầu tối ưu hóa câu hỏi / prompt trước khi gửi AI.
- Áp dụng khi tạo phản hồi code, đảm bảo tính súc tích, chính xác và không dư thừa.
- Tương thích chéo trên cả môi trường dòng lệnh (CLI) và giao diện trực quan (IDE).

## 2. Quy tắc tối ưu Prompt (Prompt Optimization)
- **Rõ ràng & Cụ thể**: Xác định chính xác file, module, hàm cần xử lý.
- **Tập trung vào mục tiêu (Action-Oriented)**: Nêu rõ kết quả đầu ra mong muốn (code diff, refactor, debug, test) thay vì mô tả chung chung.
- **Ngữ cảnh dự án ShardBrowser**:
  - Backend: Rust + Tauri (`src-tauri/`)
  - Frontend: TypeScript + Vite + HTML/CSS (`src/`)

## 3. Quy tắc phản hồi của Agent
- **Ngắn gọn & Trực tiếp**: Trả lời thẳng vào vấn đề, kèm diff / code cần chỉnh sửa.
- **Chính xác & Tối thiểu**: Chỉ sửa đổi những dòng cần thiết, không viết lại cả file lớn nếu không cần.
- **Kiểm chứng sau khi sửa**: Luôn kiểm tra tính tương thích và linter/typecheck.
- **Ngôn ngữ**: Trả lời bằng tiếng Việt hoặc tiếng Anh theo ngữ cảnh người dùng.
