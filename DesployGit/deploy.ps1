# ==============================================================================
# DESPLOYGIT ACCOUNT HUB - POWERSHELL DEPLOY SCRIPT (WINDOWS / LOCAL DOCKER)
# ==============================================================================

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "🚀 BẮT ĐẦU TRIỂN KHAI DESPLOYGIT ACCOUNT HUB (DOCKER / LOCAL)..." -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Kiểm tra .env
if (-not (Test-Path ".env")) {
    Write-Host "⚠️ Chưa tìm thấy file .env, đang copy từ .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "✅ Đã tạo file .env thành công!" -ForegroundColor Green
}

# 2. Tạo thư mục data
if (-not (Test-Path "data")) {
    New-Item -ItemType Directory -Path "data" | Out-Null
}

# 3. Build & Run Docker Compose
Write-Host "🐳 Đang build và chạy Docker Compose..." -ForegroundColor Yellow
docker compose down 2>$null
docker compose up -d --build

Write-Host "==================================================================" -ForegroundColor Green
Write-Host "🎉 KHỞI CHẠY CONTAINER THÀNH CÔNG!" -ForegroundColor Green
Write-Host "📊 Web Dashboard : http://localhost:8080" -ForegroundColor White
Write-Host "🔑 Ingest API    : POST http://localhost:8080/api/v1/accounts" -ForegroundColor White
Write-Host "==================================================================" -ForegroundColor Green
