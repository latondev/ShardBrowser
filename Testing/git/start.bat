@echo off
setlocal
cd /d "%~dp0"
title GitHub Auto Suite - ShardBrowser

echo ================================================================
echo        GITHUB REGISTRATION & 2FA SUITE (SHARDBROWSER)
echo ================================================================
echo.
echo  --- UNLIMITMAIL (TEMP MAIL VO HAN - KHUYEN DUNG) ---
echo  1. Dang ky UnlimitMail (Proxy ShardBrowser + Cooldown 120s + Slider)
echo  2. Dang ky UnlimitMail (Proxy Xoay proxyxoay.shop + Cooldown 30s)
echo  3. Dang ky UnlimitMail (Direct IP - Chu y: De bi GitHub Rate-Limit)
echo.
echo  --- HOTMAIL (MICROSOFT GRAPH OAUTH2) ---
echo  4. Dang ky Hotmail (Proxy ShardBrowser + Cooldown 120s + Slider)
echo  5. Dang ky Hotmail (Proxy Xoay proxyxoay.shop)
echo  6. Dang ky Hotmail (Direct IP)
echo.
echo  --- GMAIL CREATOR (RAPIDAPI) & TEST ---
echo  7. Dang ky Gmail Batch (Proxy ShardBrowser Pool)
echo  8. Chay thu nghiem 1 tai khoan E2E Test (Single Run)
echo  9. Kiem tra quota RapidAPI
echo.
set /p "CHOICE=Nhap lua chon cua ban (1-9, mac dinh 1): "

if "%CHOICE%"=="2" (
    echo.
    echo [*] Dang khoi chay UnlimitMail Runner qua Proxy xoay...
    node batch_unlimitmail_runner.js --rotate --cooldown=30 --slider
) else if "%CHOICE%"=="3" (
    echo.
    echo [!] Canh bao: Chay Direct IP co the bi GitHub han che (Rate-limit) sau vai luot.
    echo [*] Dang khoi chay UnlimitMail voi Direct IP...
    node batch_unlimitmail_runner.js --direct --cooldown=120 --slider
) else if "%CHOICE%"=="4" (
    echo.
    echo [*] Dang khoi chay Hotmail Runner qua Proxy ShardBrowser...
    node batch_hotmail_runner.js --shard --cooldown=120 --slider
) else if "%CHOICE%"=="5" (
    echo.
    echo [*] Dang khoi chay Hotmail Runner qua Proxy xoay...
    node batch_hotmail_runner.js --rotate --cooldown=30 --slider
) else if "%CHOICE%"=="6" (
    echo.
    echo [!] Canh bao: Chay Direct IP co the bi GitHub han che (Rate-limit) sau vai luot.
    echo [*] Dang khoi chay Hotmail voi Direct IP...
    node batch_hotmail_runner.js --direct --cooldown=120 --slider
) else if "%CHOICE%"=="7" (
    echo.
    echo [*] Dang khoi chay tao Gmail Batch qua Proxy ShardBrowser...
    node batch_runner.js --count=10 --cooldown=120 --shard --gmail --slider
) else if "%CHOICE%"=="8" (
    echo.
    echo [*] Dang khoi chay thu nghiem 1 tai khoan E2E duy nhat...
    node ai_agent_runner.js --shard --slider --unlimitmail
) else if "%CHOICE%"=="9" (
    echo.
    echo [*] Dang kiem tra quota RapidAPI...
    node check_rapidapi_quota.js
) else (
    echo.
    echo [*] Dang khoi chay UnlimitMail Runner qua Proxy ShardBrowser (Cooldown 120s, Slider)...
    node batch_unlimitmail_runner.js --shard --cooldown=120 --slider
)

echo.
echo ================================================================
pause
