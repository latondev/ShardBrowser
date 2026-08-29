param (
    [string]$FilePath = "D:\YTB\Resgiter_AI\github_regisster\FileHotmail\order_DH20260521IZBTNK_20260602.txt",
    [string]$OutputDir = "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Test\results"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Test-Path $FilePath)) {
    Write-Host "Lỗi: Không tìm thấy file: $FilePath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$lines = Get-Content -Path $FilePath | Where-Object { $_.Trim() -ne "" }
$total = $lines.Count

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   BẮT ĐẦU KIỂM TRA HÀNG LOẠT $total TÀI KHOẢN HOTMAIL" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "File nguồn: $FilePath"
Write-Host "Thư mục xuất kết quả: $OutputDir`n"

$liveAccounts = [System.Collections.Generic.List[string]]::new()
$dieAccounts = [System.Collections.Generic.List[string]]::new()
$errorAccounts = [System.Collections.Generic.List[string]]::new()

$count = 0

foreach ($line in $lines) {
    $count++
    $parts = $line.Trim().Split('|')
    $email = $parts[0]
    $password = if ($parts.Length -ge 2) { $parts[1] } else { "" }
    $refreshToken = if ($parts.Length -ge 3) { $parts[2] } else { "" }
    $clientId = if ($parts.Length -ge 4) { $parts[3] } else { "" }
    $recoveryEmail = if ($parts.Length -ge 5) { $parts[4] } else { "" }

    if (-not $refreshToken -or -not $clientId) {
        Write-Host "[$count/$total] $email -> [THIẾU TOKEN]" -ForegroundColor DarkGray
        $dieAccounts.Add("$line | THIEU_TOKEN")
        continue
    }

    $bodyOAuth = @{
        client_id     = $clientId
        grant_type    = "refresh_token"
        refresh_token = $refreshToken
    }

    try {
        $res = Invoke-RestMethod -Uri "https://login.microsoftonline.com/consumers/oauth2/v2.0/token" `
            -Method Post `
            -ContentType "application/x-www-form-urlencoded" `
            -Body $bodyOAuth `
            -TimeoutSec 10 `
            -ErrorAction Stop

        if ($res.access_token) {
            Write-Host "[$count/$total] $email -> [LIVE - NHẬN ĐƯỢC OTP] ✅" -ForegroundColor Green
            $liveAccounts.Add($line)
        } else {
            Write-Host "[$count/$total] $email -> [KHÔNG CÓ ACCESS TOKEN]" -ForegroundColor Yellow
            $dieAccounts.Add("$line | NO_ACCESS_TOKEN")
        }
    } catch {
        $msg = $_.Exception.Message
        $errDesc = ""
        if ($_.ErrorDetails) {
            $errObj = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($errObj) {
                $errDesc = $errObj.error_description
            } else {
                $errDesc = $_.ErrorDetails.Message
            }
        }
        
        if ($errDesc -match "expired" -or $errDesc -match "invalid_grant" -or $msg -match "400") {
            Write-Host "[$count/$total] $email -> [DIE / TOKEN HẾT HẠN] ❌" -ForegroundColor Red
            $dieAccounts.Add("$line | TOKEN_EXPIRED")
        } else {
            Write-Host "[$count/$total] $email -> [LỖI: $msg]" -ForegroundColor DarkYellow
            $errorAccounts.Add("$line | ERROR: $msg")
        }
    }

    # Nghỉ nhẹ 100ms tránh rate limit của MS
    Start-Sleep -Milliseconds 100
}

# Xuất ra file
$liveFile = Join-Path $OutputDir "live_accounts.txt"
$dieFile = Join-Path $OutputDir "die_accounts.txt"
$errorFile = Join-Path $OutputDir "error_accounts.txt"

$liveAccounts | Out-File -FilePath $liveFile -Encoding utf8
$dieAccounts | Out-File -FilePath $dieFile -Encoding utf8
if ($errorAccounts.Count -gt 0) {
    $errorAccounts | Out-File -FilePath $errorFile -Encoding utf8
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "                 TỔNG KẾT KẾT QUẢ KIỂM TRA" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Tổng số tài khoản đã check : $total"
Write-Host "Số tài khoản LIVE (Nhận OTP) : $($liveAccounts.Count)" -ForegroundColor Green
Write-Host "Số tài khoản DIE / Hết hạn  : $($dieAccounts.Count)" -ForegroundColor Red
Write-Host "Số tài khoản lỗi khác      : $($errorAccounts.Count)" -ForegroundColor Yellow
Write-Host "----------------------------------------------------------"
Write-Host "File Live đã lưu: $liveFile" -ForegroundColor Green
Write-Host "File Die đã lưu : $dieFile" -ForegroundColor Red
Write-Host "==========================================================" -ForegroundColor Cyan
