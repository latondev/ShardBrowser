param (
    [string]$FilePath = "D:\YTB\Resgiter_AI\github_regisster\FileHotmail\hotmail.txt",
    [string]$OutputDir = "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Test\results_graph"
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

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "         KIỂM TRA $total TÀI KHOẢN QUA MICROSOFT GRAPH API VÀ ĐỌC HỘP THƯ" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "File nguồn: $FilePath"
Write-Host "Thư mục xuất kết quả: $OutputDir`n"

$liveAccounts = [System.Collections.Generic.List[string]]::new()
$dieAccounts = [System.Collections.Generic.List[string]]::new()
$detailsList = [System.Collections.Generic.List[PSCustomObject]]::new()

$count = 0

foreach ($line in $lines) {
    $count++
    $parts = $line.Trim().Split('|')
    $email = $parts[0]
    $password = if ($parts.Length -ge 2) { $parts[1] } else { "" }
    $refreshToken = if ($parts.Length -ge 3) { $parts[2] } else { "" }
    $clientId = if ($parts.Length -ge 4) { $parts[3] } else { "9e5f94bc-e8a4-4e73-b8be-63364c29d753" }
    $recoveryEmail = if ($parts.Length -ge 5) { $parts[4] } else { "" }

    if (-not $refreshToken) {
        Write-Host "[$count/$total] $email -> [THIẾU REFRESH TOKEN]" -ForegroundColor DarkGray
        $dieAccounts.Add("$line | THIEU_REFRESH_TOKEN")
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

    # 2. Nếu có Access Token -> Đọc hộp thư qua Microsoft Graph API
    if ($accessToken) {
        $graphHeaders = @{
            "Authorization" = "Bearer $accessToken"
            "Accept"        = "application/json"
        }

        $inboxCount = 0
        $latestEmailSubject = ""
        $latestSender = ""
        $latestTime = ""

        try {
            # Gọi Graph API đọc Inbox
            $msgUrl = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?`$top=3&`$select=id,from,subject,bodyPreview,receivedDateTime"
            $msgRes = Invoke-RestMethod -Uri $msgUrl -Headers $graphHeaders -Method Get -TimeoutSec 10 -ErrorAction Stop
            $inboxCount = if ($msgRes.value) { $msgRes.value.Count } else { 0 }
            if ($inboxCount -gt 0) {
                $latestEmailSubject = $msgRes.value[0].subject
                $latestSender = "$($msgRes.value[0].from.emailAddress.name) <$($msgRes.value[0].from.emailAddress.address)>"
                $latestTime = $msgRes.value[0].receivedDateTime
            }

            Write-Host "[$count/$total] $email -> [LIVE ✅] (Inbox: $inboxCount thư | Thư mới: '$latestEmailSubject')" -ForegroundColor Green
            $liveAccounts.Add($line)
            $detailsList.Add([PSCustomObject]@{
                Index         = $count
                Email         = $email
                Status        = "LIVE"
                InboxCount    = $inboxCount
                LatestSubject = $latestEmailSubject
                LatestSender  = $latestSender
                LatestTime    = $latestTime
            })
        } catch {
            Write-Host "[$count/$total] $email -> [LIVE ✅ (Token OK, Graph API đọc thư: $($_.Exception.Message))]" -ForegroundColor Yellow
            $liveAccounts.Add($line)
        }
    } else {
        Write-Host "[$count/$total] $email -> [DIE ❌] ($tokenError)" -ForegroundColor Red
        $dieAccounts.Add("$line | $tokenError")
        $detailsList.Add([PSCustomObject]@{
            Index         = $count
            Email         = $email
            Status        = "DIE"
            InboxCount    = 0
            LatestSubject = $tokenError
            LatestSender  = ""
            LatestTime    = ""
        })
    }

    # Tránh rate limit nhẹ
    Start-Sleep -Milliseconds 80
}

# Xuất ra file
$liveFile = Join-Path $OutputDir "live_graph_accounts.txt"
$dieFile = Join-Path $OutputDir "die_graph_accounts.txt"
$summaryJsonFile = Join-Path $OutputDir "report_summary.json"

$liveAccounts | Out-File -FilePath $liveFile -Encoding utf8
$dieAccounts | Out-File -FilePath $dieFile -Encoding utf8
$detailsList | ConvertTo-Json -Depth 3 | Out-File -FilePath $summaryJsonFile -Encoding utf8

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "                     TỔNG KẾT BÁO CÁO MICROSOFT GRAPH API" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "Tổng số tài khoản đã kiểm tra  : $total"
Write-Host "Số tài khoản LIVE (Đọc được OTP) : $($liveAccounts.Count) / $total" -ForegroundColor Green
Write-Host "Số tài khoản DIE / Hết hạn    : $($dieAccounts.Count) / $total" -ForegroundColor Red
Write-Host "--------------------------------------------------------------------------------"
Write-Host "File danh sách LIVE : $liveFile" -ForegroundColor Green
Write-Host "File danh sách DIE  : $dieFile" -ForegroundColor Red
Write-Host "File báo cáo JSON   : $summaryJsonFile" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
