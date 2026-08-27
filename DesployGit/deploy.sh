#!/bin/bash
# ==============================================================================
# DESPLOYGIT ACCOUNT HUB - LINUX VPS DEPLOY SCRIPT (1-CLICK DOCKER)
# ==============================================================================

set -e

echo "=================================================================="
echo "🚀 BẮT ĐẦU TRIỂN KHAI DESPLOYGIT ACCOUNT HUB LÊN LINUX VPS..."
echo "=================================================================="

# 1. Kiểm tra và tạo file .env nếu chưa có
if [ ! -f .env ]; then
  echo "⚠️ Chưa tìm thấy file .env, đang sao chép từ .env.example..."
  cp .env.example .env
  echo "✅ Đã tạo file .env. Hãy chỉnh sửa mật khẩu và API_SECRET_KEY nếu cần!"
fi

# 2. Tạo thư mục lưu database
mkdir -p data
chmod 777 data

# 3. Kiểm tra Docker & Docker Compose
if ! command -v docker &> /dev/null; then
  echo "📦 Đang cài đặt Docker..."
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  sudo usermod -aG docker $USER || true
  rm -f get-docker.sh
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
  echo "📦 Đang cài đặt Docker Compose plugin..."
  sudo apt-get update && sudo apt-get install -y docker-compose-plugin
fi

# 4. Mở tường lửa (UFW) nếu UFW đang bật
if command -v ufw &> /dev/null; then
  PORT=$(grep -E '^PORT=' .env | cut -d '=' -f2 || echo "8080")
  PORT=${PORT:-8080}
  echo "🛡️ Cấu hình tường lửa UFW cho port $PORT..."
  sudo ufw allow $PORT/tcp || true
fi

# 5. Build và khởi động Container
echo "🐳 Đang build và khởi chạy Docker Compose..."
if docker compose version &> /dev/null; then
  docker compose down || true
  docker compose up -d --build
else
  docker-compose down || true
  docker-compose up -d --build
fi

echo "=================================================================="
echo "🎉 TRIỂN KHAI THÀNH CÔNG!"
echo "📊 Web Dashboard : http://$(curl -s ifconfig.me || echo 'YOUR_VPS_IP'):8080"
echo "🔑 Ingest API    : POST http://$(curl -s ifconfig.me || echo 'YOUR_VPS_IP'):8080/api/v1/accounts"
echo "=================================================================="
