# ⚡ THÔNG TIN QUẢN TRỊ HỆ THỐNG DESPLOYGIT (LƯU TRỮ & BOT WORKER)

Tài liệu tổng hợp toàn bộ thông tin đăng nhập, cấu hình server, cơ chế hoạt động của bot và các lệnh quản trị nhanh để tra cứu khi cần.

---

## 🖥️ 1. Thông Tin Web Dashboard Quản Trị Tài Khoản

| Mục | Chi tiết |
| :--- | :--- |
| **Đường dẫn truy cập** | **[http://180.93.115.138:8080](http://180.93.115.138:8080)** |
| **Tài khoản (Username)** | `admin` |
| **Mật khẩu (Password)** | `AdminSecure@2026!Pass` |
| **Quyền hạn** | Toàn quyền xem, tìm kiếm, xuất file, xóa tài khoản |

### ✨ Các tính năng nổi bật trên Web Dashboard:
- **Xem danh sách tài khoản:** Ẩn/hiện mật khẩu, xem mã 2FA TOTP, danh sách Recovery Codes, Proxy và thời gian tạo.
- **Nút Copy 1-Click (`⚡`):** Sao chép nhanh dòng tài khoản theo định dạng chuẩn: `email|password|2fa_secret`.
- **Nút "Copy All (txt)":** Sao chép toàn bộ danh sách tài khoản đang lọc chỉ trong 1 cú click.
- **Nút Xuất Dữ Liệu:** Tải trực tiếp file `.TXT`, `.CSV`, hoặc `.JSON` về máy.

---

## 🔑 2. Thông Tin Máy Chủ VPS (Ubuntu 24.04 LTS)

| Mục | Thông tin |
| :--- | :--- |
| **Địa chỉ IP** | `180.93.115.138` |
| **Cổng SSH** | `22` |
| **Tên người dùng** | `root` |
| **Mật khẩu SSH** | `uN0%lfIHjilk` |
| **Cấu hình phần cứng** | 2 vCPU \| 2 GB RAM (kèm 4 GB Swap) \| 30 GB NVMe SSD |

---

## 🌐 3. Cấu Hình RESTful API Server

Dành cho các máy Client / Tool khác nếu muốn bắn dữ liệu về lưu trữ tập trung:

- **Endpoint nhận tài khoản:** `POST http://180.93.115.138:8080/api/v1/accounts`
- **Header xác thực:** `X-API-Key: shardx-secret-api-key-2026-very-secure`
- **Endpoint Healthcheck:** `GET http://180.93.115.138:8080/api/v1/health`

---

## 🤖 4. Cơ Chế Hoạt Động Của Bot Worker (`git-bot`)

Bot được cấu hình chạy ngầm **24/7 tự động 100%** qua **PM2** và màn hình ảo **Xvfb**:

1. **Chế độ Vô Hạn (Infinite):** Bot tự động đăng ký liên tục không giới hạn số lượng mục tiêu.
2. **Chỉ dùng RapidAPI (Gmail):** Tự động bốc ngẫu nhiên từ danh sách 48 key trong file `rapidapikey.md`.
3. **Cơ chế Cooldown 1 Giờ Thông Minh:** Khi tất cả key trong pool đều hết lượt tạo Gmail trong giờ đó:
   - Bot tự động **tạm nghỉ 1 giờ (3600s)** và có log đếm ngược.
   - Hết 1 giờ, bot tự động nạp lại key và tiếp tục tạo tài khoản.
   - Bạn có thể dán thêm key mới vào `rapidapikey.md` bất kỳ lúc nào mà không cần khởi động lại bot.
4. **Tự động xoay IP Proxy Dân Cư:** Gọi `proxyxoay.shop` cấp IP mới trước mỗi phiên mở Chrome.
5. **Đồng bộ dữ liệu kép:** Vừa ghi nối tiếp vào `/root/DesployGit/bot/output.txt`, vừa lưu vào Database SQLite của Dashboard.

---

## 📁 5. Vị Trí Các File Quan Trọng Trên VPS

- **Thư mục dự án:** `/root/DesployGit`
- **File Database SQLite:** `/root/DesployGit/data/accounts.db`
- **File danh sách tài khoản dạng text:** `/root/DesployGit/bot/output.txt`
- **File danh sách RapidAPI keys:** `/root/DesployGit/bot/rapidapikey.md`

---

## 🛠️ 6. Các Lệnh Quản Trị VPS Thường Dùng (SSH)

Sau khi SSH vào VPS (`ssh root@180.93.115.138`), bạn có thể gõ các lệnh sau:

```bash
# 1. Xem nhật ký Bot đang chạy trực tiếp (Live Logs)
pm2 logs git-bot

# 2. Xem nhật ký Server Web Dashboard
pm2 logs account-hub

# 3. Xem danh sách và tình trạng các tiến trình đang chạy
pm2 status

# 4. Khởi động lại Bot khi cần
pm2 restart git-bot

# 5. Khởi động lại toàn bộ Server & Bot
pm2 restart all

# 6. Xem nội dung file text tài khoản đã lưu
cat /root/DesployGit/bot/output.txt
```
