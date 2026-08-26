@echo off
chcp 65001 >nul
title KIEM TRA HAN MUC RAPIDAPI KEYS - SHARDBROWSER
color 0b

cd /d "%~dp0"

echo.
echo ==============================================================================
echo        HE THONG KIEM TRA HAN MUC REQUEST RAPIDAPI (GMAIL CREATOR POOL)
echo ==============================================================================
echo.

node check_rapidapi_quota.js

echo.
echo Nhan phim bat ky de thoat...
pause >nul
