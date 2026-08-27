# ==============================================================================
# MULTI-STAGE DOCKERFILE CHO DESPLOYGIT ACCOUNT HUB
# ==============================================================================

# Stage 1: Build Dependencies (Biên dịch native sqlite3 addon)
FROM node:20-alpine AS builder

WORKDIR /app

# Cài đặt công cụ build cần thiết cho better-sqlite3
RUN apk add --no-cache python3 make g++ gcc

COPY package.json ./
RUN npm install --omit=dev

# Stage 2: Minimal Production Image
FROM node:20-alpine AS runner

WORKDIR /app

# Thiết lập biến môi trường
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/app/data/accounts.db

# Tạo thư mục lưu data bền vững và cấp quyền cho user node
RUN mkdir -p /app/data && chown -R node:node /app

# Copy dependencies đã build từ builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src/ ./src/
COPY --chown=node:node public/ ./public/

# Chuyển sang non-root user 'node' để tăng cường bảo mật
USER node

# Khai báo cổng ứng dụng
EXPOSE 8080

# Khai báo Volume dữ liệu
VOLUME ["/app/data"]

# Healthcheck định kỳ
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/api/v1/health || exit 1

# Lệnh khởi chạy
CMD ["node", "src/server.js"]
