# Proxify.vn Free Proxy Scraper & Filter Tool

Công cụ cào và lọc danh sách proxy miễn phí từ `https://proxify.vn/proxy-free` (sử dụng trực tiếp API backend `https://api.proxify.vn/api/proxy-free`).

---

## 1. File trong thư mục
- `proxify_scraper.py`: Script Python CLI (đầy đủ tính năng lọc, xuất file, kiểm tra live connection đa luồng).
- `proxify_scraper.js`: Module ES JavaScript (dùng cho Node.js / frontend).

---

## 2. Cách chạy nhanh (Python)

### Lọc theo cấu hình phổ biến:
```bash
# Proxy HTTP, Elite, Latency <= 500ms, lấy 100 dòng
python Testing/proxify/proxify_scraper.py -p http -a elite -l 500 -n 100

# Proxy Việt Nam
python Testing/proxify/proxify_scraper.py --scope vn

# Proxy SOCKS5 nhanh nhất (< 500ms), dạng socks5://IP:Port
python Testing/proxify/proxify_scraper.py -p socks5 -l 500 -f protocol

# Xuất danh sách IP:Port vào file txt
python Testing/proxify/proxify_scraper.py -p http -a elite -l 500 -f ip:port -o Testing/proxify/proxies.txt

# Xuất full JSON
python Testing/proxify/proxify_scraper.py -f json -o Testing/proxify/proxies.json

# Lọc và kiểm tra kết nối thực tế (Live Check)
python Testing/proxify/proxify_scraper.py -p http -a elite -l 500 --check
```

---

## 3. Cách chạy nhanh (Node.js)

```bash
node Testing/proxify/proxify_scraper.js
```
