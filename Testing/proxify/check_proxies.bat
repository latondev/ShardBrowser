@echo off
setlocal
cd /d "%~dp0"
title Kiem Tra Va Loc Proxy Song - Proxify

echo ================================================================
echo        KIEM TRA VA LOC PROXY SONG (FILTER LIVE PROXIES)
echo ================================================================
echo.

REM Kiem tra Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% neq 0 (
        echo [!] Khong tim thay Python tren he thong. Vui long cai dat Python!
        pause
        exit /b 1
    )
    set "PY_CMD=py"
) else (
    set "PY_CMD=python"
)

%PY_CMD% filter_live_proxies.py %*

echo.
pause
