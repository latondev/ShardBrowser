# AI Agent Rules & Prompt Optimization

Tài liệu này cấu hình các chỉ dẫn, ràng buộc và quy tắc tối ưu hóa prompt hoạt động đồng bộ trên cả **Antigravity CLI (`agy`)** và **Antigravity IDE**.

---

## 1. Cơ chế hoạt động kép (Dual Setup)
- **Tự động ngầm (Always-on Rules)**: Được định nghĩa tại [AGENTS.md](file:///f:/ToolAllvideo/ShardBrowser/AGENTS.md) và [.agents/rules/prompt_optimization.md](file:///f:/ToolAllvideo/ShardBrowser/.agents/rules/prompt_optimization.md) -> Tự động nạp vào mọi prompt của Agent trong cả CLI và IDE.
- **Kỹ năng tương tác (Interactive Skill)**: Được định nghĩa tại [.agents/skills/prompt-optimize/SKILL.md](file:///f:/ToolAllvideo/ShardBrowser/.agents/skills/prompt-optimize/SKILL.md) -> Hiển thị trực tiếp trong danh sách Skill / Slash command trên giao diện IDE và CLI.

---

## 2. Quy tắc tối ưu Prompt & Phản hồi
- **Be Concise & Action-Oriented**: Trả lời thẳng vào trọng tâm, ưu tiên code diff / giải pháp trực tiếp, tránh giải thích dài dòng không cần thiết.
- **Context-Aware**: Tuân thủ kiến trúc dự án (Tauri + Rust Backend / TypeScript + Vite Frontend).
- **Precise Modifications**: Sửa đổi tối thiểu, chính xác, không thay đổi các cấu hình không liên quan.
- **Verification First**: Kiểm tra typecheck / linter / build sau khi thay đổi logic mã nguồn.
- **Communication**: Phản hồi rõ ràng bằng tiếng Việt hoặc tiếng Anh theo yêu cầu của người dùng.
