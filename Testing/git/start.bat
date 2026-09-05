@echo off
setlocal
cd /d "%~dp0"
title GitHub Auto Suite - ShardBrowser

echo ================================================================
echo        GITHUB REGISTRATION & 2FA SUITE (SHARDBROWSER)
echo ================================================================
echo.
echo  1. Dang ky bang Hotmail (Proxy ShardBrowser Pool - Khuyen dung)
echo  2. Dang ky bang Hotmail (Proxy xoay proxyxoay.shop)
echo  3. Dang ky bang Hotmail (Direct IP - Chu y: De bi GitHub Rate-Limit)
echo  4. Dang ky bang Gmail Batch (Proxy ShardBrowser Pool)
echo  5. Dang ky bang Gmail Batch (Direct IP)
echo  6. Kiem tra quota RapidAPI
echo.
set /p "CHOICE=Nhap lua chon cua ban (1-6, mac dinh 1): "

if "%CHOICE%"=="2" (
    echo.
    echo [*] Dang khoi chay Hotmail Runner qua Proxy xoay...
    node batch_hotmail_runner.js --rotate --cooldown=30
) else if "%CHOICE%"=="3" (
    echo.
    echo [!] Canh bao: Chay Direct IP co the bi GitHub han che (Rate-limit) sau vai luot.
    echo [*] Dang khoi chay voi Direct IP...
    node batch_hotmail_runner.js --direct --cooldown=60
) else if "%CHOICE%"=="4" (
    echo.
    echo [*] Dang khoi chay tao Gmail Batch qua Proxy ShardBrowser...
    node batch_runner.js --count=10 --cooldown=30 --shard
) else if "%CHOICE%"=="5" (
    echo.
    echo [!] Canh bao: Chay Direct IP co the bi GitHub han che IP...
    echo [*] Dang khoi chay tao Gmail Batch voi Direct IP...
    node batch_runner.js --count=10 --cooldown=60 --direct
) else if "%CHOICE%"=="6" (
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

