@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ==============================================================================
echo [PROXIFY LINKER] TU DONG LIEN KET THU MUC PROXIFY SANG CAC THU MUC DICH
echo ==============================================================================

set "SOURCE_DIR=%~dp0"
if "%SOURCE_DIR:~-1%"=="\" set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"

echo [NGUON] Thu muc goc: "%SOURCE_DIR%"
echo.

set "TARGETS_FILE=%SOURCE_DIR%\targets.txt"
set /a COUNT=0
set /a SUCCESS_COUNT=0

REM Kiem tra tham so dong lenh
if not "%~1"=="" (
    for %%A in (%*) do (
        call :ProcessLink %%A
    )
    goto :Finish
)

REM Kiem tra file targets.txt
if not exist "%TARGETS_FILE%" (
    echo [CANH BAO] Chua co file targets.txt, dang tao file mau...
    (
        echo # Danh sach thu muc dich can lien ket (Moi dong 1 duong dan)
        echo D:\YTB\Resgiter_AI\Resgit\Seekai\proxify
    ) > "%TARGETS_FILE%"
    echo [OK] Da tao targets.txt
    echo.
)

echo [DANH SACH] Dang doc tu targets.txt ...
echo ------------------------------------------------------------------------------

for /f "usebackq eol=# tokens=* delims=" %%L in ("%TARGETS_FILE%") do (
    set "LINE=%%L"
    if defined LINE (
        for /f "tokens=* delims= " %%T in ("!LINE!") do set "LINE=%%T"
        if not "!LINE!"=="" (
            call :ProcessLink "!LINE!"
        )
    )
)

goto :Finish

:ProcessLink
set /a COUNT+=1
set "RAW_TARGET=%~1"
set "TARGET_DIR=%RAW_TARGET%"

REM Tu dong them \proxify neu duong dan chua co
for %%F in ("%TARGET_DIR%") do (
    if /i not "%%~nxF"=="proxify" (
        set "TARGET_DIR=%TARGET_DIR%\proxify"
    )
)

echo.
echo [%COUNT%] Dang lien ket: "!TARGET_DIR!"

REM Tao thu muc cha neu chua co
for %%P in ("!TARGET_DIR!\..") do (
    if not exist "%%~fP" (
        mkdir "%%~fP" >nul 2>&1
    )
)

REM Xoa thu muc cu neu co
if exist "!TARGET_DIR!" (
    rmdir "!TARGET_DIR!" >nul 2>&1
    if exist "!TARGET_DIR!" (
        echo     [*] Thu muc da ton tai, dang lam sach de tao lien ket...
        rmdir /s /q "!TARGET_DIR!" >nul 2>&1
    )
)

REM Tao Directory Junction
mklink /J "!TARGET_DIR!" "%SOURCE_DIR%" >nul 2>&1

if exist "!TARGET_DIR!" (
    echo     [+] THANH CONG! Da tao lien ket Junction xong.
    set /a SUCCESS_COUNT+=1
) else (
    echo     [-] THAT BAI! Khong the tao lien ket.
)
exit /b

:Finish
set /a FAIL_COUNT=COUNT-SUCCESS_COUNT
echo.
echo ==============================================================================
echo [KET QUA HOAN TAT]
echo    - Tong so duong dan: %COUNT%
echo    - Thanh cong: %SUCCESS_COUNT%
echo    - That bai: %FAIL_COUNT%
echo ==============================================================================
echo.
echo Meo: Ban co the mo file targets.txt de them hoac bot cac duong dan bat ky luc nao.
echo.
pause
