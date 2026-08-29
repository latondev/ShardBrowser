param (
    [string]$TargetFolder = "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Check2faGit\FileHotmail",
    [string]$OutputDir = "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Check2faGit\Results"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Test-Path $TargetFolder)) {
    Write-Host "Lỗi: Không tìm thấy thư mục: $TargetFolder" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$files = Get-ChildItem -Path $TargetFolder -Filter "*.txt"
if ($files.Count -eq 0) {
    Write-Host "Không tìm thấy file .txt nào trong thư mục: $TargetFolder" -ForegroundColor Yellow
    exit 0
}

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "     BẮT ĐẦU KIỂM TRA TOÀN BỘ CÁC FILE HOTMAIL / OUTLOOK TRONG FOLDER" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "Thư mục nguồn : $TargetFolder"
Write-Host "Số lượng file : $($files.Count) file (.txt)"
Write-Host "Thư mục xuất  : $OutputDir`n"

$allLiveAccounts = [System.Collections.Generic.List[string]]::new()
$allDieAccounts = [System.Collections.Generic.List[string]]::new()
$fileSummaries = [System.Collections.Generic.List[PSCustomObject]]::new()

$grandTotal = 0
$grandLive = 0
$grandDie = 0

foreach ($file in $files) {
    $fileName = $file.Name
    $filePath = $file.FullName
    $lines = Get-Content -Path $filePath | Where-Object { $_.Trim() -ne "" }
    $fileTotal = $lines.Count
    $grandTotal += $fileTotal

    Write-Host "--------------------------------------------------------------------------------" -ForegroundColor Yellow
    Write-Host "📁 Đang xử lý file: $fileName ($fileTotal tài khoản)" -ForegroundColor Yellow
    Write-Host "--------------------------------------------------------------------------------" -ForegroundColor Yellow

    $fileLiveCount = 0
    $fileDieCount = 0
    $accIdx = 0

    foreach ($line in $lines) {
        $accIdx++
        $parts = $line.Trim().Split('|')
        $email = $parts[0]
        $password = if ($parts.Length -ge 2) { $parts[1] } else { "" }
        $refreshToken = if ($parts.Length -ge 3) { $parts[2] } else { "" }
        $clientId = if ($parts.Length -ge 4) { $parts[3] } else { "9e5f94bc-e8a4-4e73-b8be-63364c29d753" }
        $recoveryEmail = if ($parts.Length -ge 5) { $parts[4] } else { "" }

        if (-not $refreshToken) {
            Write-Host "  [$accIdx/$fileTotal] $email -> [THIẾU TOKEN] ❌" -ForegroundColor DarkGray
            $allDieAccounts.Add("$line | THIEU_REFRESH_TOKEN | File: $fileName")
            $fileDieCount++
            continue
        }

        # 1. Đổi Refresh Token lấy Access Token qua OAuth2 endpoint với scope Graph Mail.ReadWrite
        $bodyOAuth = @{
            client_id     = $clientId
            grant_type    = "refresh_token"
            refresh_token = $refreshToken
            scope         = "https://graph.microsoft.com/Mail.ReadWrite"
        }

        $accessToken = $null
        $tokenError = ""

        try {
            $res = Invoke-RestMethod -Uri "https://login.microsoftonline.com/consumers/oauth2/v2.0/token" `
                -Method Post `
                -ContentType "application/x-www-form-urlencoded" `
                -Body $bodyOAuth `
                -TimeoutSec 10 `
                -ErrorAction Stop

            if ($res.access_token) {
                $accessToken = $res.access_token
            }
        } catch {
            if ($_.ErrorDetails) {
                $errObj = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
                $tokenError = if ($errObj) { "$($errObj.error): $($errObj.error_description)" } else { $_.ErrorDetails.Message }
            } else {
                $tokenError = $_.Exception.Message
            }
        }

        # 2. Đọc hộp thư qua Microsoft Graph API
        if ($accessToken) {
            $graphHeaders = @{
                "Authorization" = "Bearer $accessToken"
                "Accept"        = "application/json"
            }

            $inboxCount = 0
            $latestEmailSubject = ""

            try {
                $msgUrl = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?`$top=1&`$select=id,subject,receivedDateTime"
                $msgRes = Invoke-RestMethod -Uri $msgUrl -Headers $graphHeaders -Method Get -TimeoutSec 10 -ErrorAction Stop
                $inboxCount = if ($msgRes.value) { $msgRes.value.Count } else { 0 }
                if ($inboxCount -gt 0) {
                    $latestEmailSubject = $msgRes.value[0].subject
                }
            } catch {
                # Graph inbox check warning (vẫn coi là live vì token hợp lệ)
            }

            Write-Host "  [$accIdx/$fileTotal] $email -> [LIVE ✅] (Inbox: $inboxCount thư | Thư mới: '$latestEmailSubject')" -ForegroundColor Green
            $allLiveAccounts.Add($line)
            $fileLiveCount++
        } else {
            Write-Host "  [$accIdx/$fileTotal] $email -> [DIE ❌] (Token hết hạn/bị hủy)" -ForegroundColor Red
            $allDieAccounts.Add("$line | $tokenError | File: $fileName")
            $fileDieCount++
        }

        Start-Sleep -Milliseconds 60
    }

    $grandLive += $fileLiveCount
    $grandDie += $fileDieCount

    $fileSummaries.Add([PSCustomObject]@{
        FileName   = $fileName
        Total      = $fileTotal
        Live       = $fileLiveCount
        Die        = $fileDieCount
        LiveRate   = if ($fileTotal -gt 0) { "$([Math]::Round(($fileLiveCount / $fileTotal) * 100, 1))%" } else { "0%" }
    })
}

# Xuất ra các file kết quả
$allLiveFile = Join-Path $OutputDir "all_live_accounts.txt"
$allDieFile = Join-Path $OutputDir "all_die_accounts.txt"
$summaryJsonFile = Join-Path $OutputDir "summary_report.json"

$allLiveAccounts | Out-File -FilePath $allLiveFile -Encoding utf8
$allDieAccounts | Out-File -FilePath $allDieFile -Encoding utf8
$fileSummaries | ConvertTo-Json -Depth 3 | Out-File -FilePath $summaryJsonFile -Encoding utf8

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "                     TỔNG KẾT BÁO CÁO TOÀN BỘ FOLDER" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
$fileSummaries | Format-Table -AutoSize | Out-String | Write-Host -ForegroundColor White
Write-Host "--------------------------------------------------------------------------------"
Write-Host "TỔNG CỘNG TOÀN BỘ FOLDER:" -ForegroundColor Cyan
Write-Host "  - Tổng số file quét         : $($files.Count)"
Write-Host "  - Tổng số tài khoản đã check : $grandTotal"
Write-Host "  - Tổng tài khoản LIVE (Nhận OTP) : $grandLive ($([Math]::Round(($grandLive / [Math]::Max(1, $grandTotal)) * 100, 1))%)" -ForegroundColor Green
Write-Host "  - Tổng tài khoản DIE (Hết hạn)   : $grandDie ($([Math]::Round(($grandDie / [Math]::Max(1, $grandTotal)) * 100, 1))%)" -ForegroundColor Red
Write-Host "--------------------------------------------------------------------------------"
Write-Host "📁 File tổng hợp LIVE đã lưu : $allLiveFile" -ForegroundColor Green
Write-Host "📁 File tổng hợp DIE đã lưu  : $allDieFile" -ForegroundColor Red
Write-Host "📁 File JSON báo cáo chi tiết: $summaryJsonFile" -ForegroundColor Cyan
Write-Host "================================================================================`n" -ForegroundColor Cyan
