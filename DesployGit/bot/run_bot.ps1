# ==============================================================================
# SCRIPT KHỞI CHẠY BOT WORKER (WINDOWS POWERSHELL)
# ==============================================================================

param (
    [int]$TargetAccounts = 5000,
    [int]$CooldownSeconds = 18
)

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "🤖 KHỞI CHẠY GITHUB BOT WORKER TRÊN WINDOWS..." -ForegroundColor Cyan
Write-Host "🎯 Mục tiêu: $TargetAccounts tài khoản | Nghỉ giữa các acc: $CooldownSeconds s" -ForegroundColor Yellow
Write-Host "==================================================================" -ForegroundColor Cyan

if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Đang cài đặt node_modules..." -ForegroundColor Yellow
    npm install
}

node batch_runner.js $TargetAccounts $CooldownSeconds
