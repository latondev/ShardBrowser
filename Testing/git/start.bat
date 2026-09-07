@echo off
setlocal
cd /d "%~dp0"
title GitHub Auto Suite - ShardBrowser

echo ================================================================
echo        GITHUB REGISTRATION & 2FA SUITE (SHARDBROWSER)
echo ================================================================
echo.
echo  --- HOTMAIL (MICROSOFT GRAPH OAUTH2) ---
echo  1. Dang ky bang Hotmail (Proxy ShardBrowser Pool - Khuyen dung)
echo  2. Dang ky bang Hotmail (Proxy xoay proxyxoay.shop)
echo  3. Dang ky bang Hotmail (Direct IP - Chu y: De bi GitHub Rate-Limit)
echo.
echo  --- UNLIMITMAIL (TEMP MAIL KHONG GIOI HAN) ---
echo  4. Dang ky bang UnlimitMail (Proxy ShardBrowser Pool - Khuyen dung)
echo  5. Dang ky bang UnlimitMail (Proxy xoay proxyxoay.shop)
echo  6. Dang ky bang UnlimitMail (Direct IP)
echo.
echo  --- GMAIL CREATOR (RAPIDAPI) ---
echo  7. Dang ky bang Gmail Batch (Proxy ShardBrowser Pool)
echo  8. Dang ky bang Gmail Batch (Direct IP)
echo  9. Kiem tra quota RapidAPI
echo.
set /p "CHOICE=Nhap lua chon cua ban (1-9, mac dinh 1): "

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
    echo [*] Dang khoi chay UnlimitMail Runner qua Proxy ShardBrowser...
    node batch_unlimitmail_runner.js --shard --cooldown=30
) else if "%CHOICE%"=="5" (
    echo.
    echo [*] Dang khoi chay UnlimitMail Runner qua Proxy xoay...
    node batch_unlimitmail_runner.js --rotate --cooldown=20
) else if "%CHOICE%"=="6" (
    echo.
    echo [!] Canh bao: Chay Direct IP co the bi GitHub han che (Rate-limit) sau vai luot.
    echo [*] Dang khoi chay UnlimitMail voi Direct IP...
    node batch_unlimitmail_runner.js --direct --cooldown=60
) else if "%CHOICE%"=="7" (
    echo.
    echo [*] Dang khoi chay tao Gmail Batch qua Proxy ShardBrowser...
    node batch_runner.js --count=10 --cooldown=30 --shard --gmail
) else if "%CHOICE%"=="8" (
    echo.
    echo [!] Canh bao: Chay Direct IP co the bi GitHub han che IP...
    echo [*] Dang khoi chay tao Gmail Batch voi Direct IP...
    node batch_runner.js --count=10 --cooldown=60 --direct --gmail
) else if "%CHOICE%"=="9" (
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
