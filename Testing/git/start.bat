@echo off
setlocal
cd /d "%~dp0"
title GitHub Auto Suite - ShardBrowser

echo ================================================================
echo        GITHUB REGISTRATION & 2FA SUITE (SHARDBROWSER)
echo ================================================================
echo.
echo  1. Dang ky GitHub bang danh sach Hotmail (Dung Proxy ShardBrowser)
echo  2. Dang ky GitHub bang danh sach Hotmail (Dung Mang Direct / Khong Proxy)
echo  3. Dang ky GitHub bang Gmail tu tao (Batch Runner)
echo  4. Kiem tra quota RapidAPI
echo.
set /p "CHOICE=Nhap lua chon cua ban (1-4, mac dinh 1): "

if "%CHOICE%"=="2" (
    echo.
    echo [*] Dang khoi chay voi Direct IP...
    node batch_hotmail_runner.js --direct --cooldown=30
) else if "%CHOICE%"=="3" (
    echo.
    echo [*] Dang khoi chay tao Gmail hang loat...
    node batch_runner.js 10 20
) else if "%CHOICE%"=="4" (
    echo.
    echo [*] Dang kiem tra quota RapidAPI...
    node check_rapidapi_quota.js
) else (
    echo.
    echo [*] Dang khoi chay Hotmail Runner qua Proxy ShardBrowser...
    node batch_hotmail_runner.js --shard --cooldown=30
)

echo.
echo ================================================================
pause
