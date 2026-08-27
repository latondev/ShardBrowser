#!/bin/bash
# ==============================================================================
# SCRIPT KHỞI CHẠY BOT WORKER (LINUX VPS / XVFB)
# ==============================================================================

set -e

echo "=================================================================="
echo "🤖 KHỞI CHẠY GITHUB BOT WORKER TRÊN LINUX..."
echo "=================================================================="

TARGET_ACCOUNTS=${1:-5000}
COOLDOWN_SEC=${2:-18}

# Cài đặt dependency nếu chưa có
if [ ! -d "node_modules" ]; then
  echo "📦 Đang cài đặt node_modules cho Bot..."
  npm install
fi

# Chạy với xvfb nếu môi trường không có DISPLAY
if [ -z "$DISPLAY" ] && command -v xvfb-run &> /dev/null; then
  echo "🖥️ Đang khởi chạy trong màn hình ảo Xvfb..."
  xvfb-run -a node batch_runner.js $TARGET_ACCOUNTS $COOLDOWN_SEC
else
  node batch_runner.js $TARGET_ACCOUNTS $COOLDOWN_SEC
fi
