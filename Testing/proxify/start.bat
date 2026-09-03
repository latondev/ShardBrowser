@echo off
setlocal
cd /d "%~dp0"
title Proxify Scraper - Export proxies_protocol.txt

echo ================================================================
echo          PROXIFY SCRAPER - CAO VA LOC PROXY FREE
echo ================================================================
echo.

REM Kiem tra Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% neq 0 (
        echo [!] Khong tim thay Python. Vui long cai dat Python!
        pause
        exit /b 1
    )
    set "PY_CMD=py"
) else (
    set "PY_CMD=python"
)

echo [*] Dang cao va loc proxy tu Proxify.vn...
%PY_CMD% proxify_scraper.py -p http -a elite -l 1000 -n 100 -f protocol -o proxies_protocol.txt %*

if %errorlevel% equ 0 (
    echo.
    echo [v] HOAN TAT: Da xuat danh sach vao file proxies_protocol.txt
    echo.
    set /p "DO_CHECK=Ban co muon kiem tra va loc chi giu lai proxy SONG ngay bay gio khong? (Y/N): "
    if /i "%DO_CHECK%"=="Y" (
        echo.
        %PY_CMD% filter_live_proxies.py
    )
) else (
    echo.
    echo [!] Co loi xay ra trong qua trinh cao proxy.
)

echo.
echo ================================================================
pause
