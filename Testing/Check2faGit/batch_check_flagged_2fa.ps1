<#
.SYNOPSIS
    Script kiểm tra danh sách tài khoản GitHub từ output_1.txt:
    1. Lọc tài khoản ĐÃ BẬT 2FA (Bỏ qua tài khoản chưa bật 2FA / đòi code email).
    2. Đăng nhập bằng mã TOTP 6 số từ Secret Key.
    3. Kiểm tra xem tài khoản có bị lỗi "This account is flagged, and therefore cannot authorize a third party application" hay không.
    4. Phân loại và xuất báo cáo đầy đủ.
#>

param (
    [string]$FilePath = "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Check2faGit\output_1.txt",
    [string]$OutputDir = "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Check2faGit\Results_CheckFlag"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http

if (-not (Test-Path $FilePath)) {
    Write-Host "Lỗi: Không tìm thấy file: $FilePath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# Hàm tính mã TOTP 6 số chuẩn RFC 6238
function Get-TotpCode([string]$Secret) {
    if (-not $Secret) { return "" }
    $alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    $cleanKey = $Secret.Trim().ToUpper() -replace '[=\s-]', ''
    $bits = ""
    for ($i = 0; $i -lt $cleanKey.Length; $i++) {
        $val = $alphabet.IndexOf($cleanKey[$i])
        if ($val -ge 0) {
            $bits += [Convert]::ToString($val, 2).PadLeft(5, '0')
        }
    }
    $bytes = [System.Collections.Generic.List[byte]]::new()
    for ($i = 0; $i + 8 -le $bits.Length; $i += 8) {
        $bytes.Add([Convert]::ToByte($bits.Substring($i, 8), 2))
    }
    $keyBytes = $bytes.ToArray()

    $epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $counter = [Math]::Floor($epoch / 30)
    $counterBytes = [BitConverter]::GetBytes([long]$counter)
    if ([BitConverter]::IsLittleEndian) {
        [Array]::Reverse($counterBytes)
    }

    $hmac = New-Object System.Security.Cryptography.HMACSHA1 -ArgumentList @(,$keyBytes)
    $hash = $hmac.ComputeHash($counterBytes)

    $offset = $hash[$hash.Length - 1] -band 0xF
    $binary = (($hash[$offset] -band 0x7F) -shl 24) -bor `
              (($hash[$offset + 1] -band 0xFF) -shl 16) -bor `
              (($hash[$offset + 2] -band 0xFF) -shl 8) -bor `
              ($hash[$offset + 3] -band 0xFF)

    $otp = ($binary % 1000000).ToString().PadLeft(6, '0')
    return $otp
}

$lines = Get-Content -Path $FilePath | Where-Object { $_.Trim() -ne "" }
$total = $lines.Count

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "     BẮT ĐẦU KIỂM TRA $total TÀI KHOẢN GITHUB: 2FA & LỖI FLAGGED OAUTH" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "File nguồn: $FilePath"
Write-Host "Thư mục xuất kết quả: $OutputDir`n"

$listLiveGood = [System.Collections.Generic.List[string]]::new()
$listFlagged = [System.Collections.Generic.List[string]]::new()
$listNot2faOrVerifyMail = [System.Collections.Generic.List[string]]::new()
$listWrongPassOrError = [System.Collections.Generic.List[string]]::new()

$count = 0

# File xuất kết quả thời gian thực
$fileLiveGood = Join-Path $OutputDir "github_live_good_2fa.txt"
$fileFlagged = Join-Path $OutputDir "github_flagged_2fa.txt"
$fileNot2fa = Join-Path $OutputDir "github_not_2fa_or_mail_code.txt"
$fileWrongPass = Join-Path $OutputDir "github_wrong_pass_or_locked.txt"
$fileSummaryJson = Join-Path $OutputDir "summary_report.json"

# Xóa file cũ nếu có
Remove-Item -Path $fileLiveGood, $fileFlagged, $fileNot2fa, $fileWrongPass, $fileSummaryJson -Force -ErrorAction SilentlyContinue

foreach ($line in $lines) {
    $count++
    $parts = $line.Trim().Split('|') | ForEach-Object { $_.Trim() }
    $login = $parts[0]
    $password = if ($parts.Length -ge 2) { $parts[1] } else { "" }
    $secret2fa = if ($parts.Length -ge 3) { $parts[2] } else { "" }

    $indexPrefix = "[$count/$total] $login"

    $cookieContainer = New-Object System.Net.CookieContainer
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.CookieContainer = $cookieContainer
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
    $client.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")

    try {
        # 1. GET /login
        $loginPageRes = $client.GetAsync("https://github.com/login").Result
        $loginHtml = $loginPageRes.Content.ReadAsStringAsync().Result

        $tokenMatch = [regex]::Match($loginHtml, 'name="authenticity_token"\s+value="([^"]+)"')
        if (-not $tokenMatch.Success) {
            $tokenMatch = [regex]::Match($loginHtml, 'value="([^"]+)"\s+name="authenticity_token"')
        }
        $authToken = $tokenMatch.Groups[1].Value

        if (-not $authToken) {
            Write-Host "$indexPrefix -> [LỖI TOKEN LOGIN] ❌" -ForegroundColor DarkGray
            $listWrongPassOrError.Add("$line | ERROR_TOKEN")
            "$line | ERROR_TOKEN" | Out-File -FilePath $fileWrongPass -Append -Encoding utf8
            continue
        }

        # 2. POST /session
        $postParams = New-Object System.Collections.Generic.Dictionary"[string,string]"
        $postParams.Add("commit", "Sign in")
        $postParams.Add("authenticity_token", $authToken)
        $postParams.Add("login", $login)
        $postParams.Add("password", $password)
        $postParams.Add("trusted_device", "")
        $postParams.Add("webauthn-conditional", "undefined")
        $postParams.Add("javascript-support", "true")
        $postParams.Add("webauthn-support", "supported")
        $postParams.Add("webauthn-iuvpaa-support", "unsupported")
        $postParams.Add("return_to", "https://github.com/login")
        $postParams.Add("required_field_bf86", "")
        $postParams.Add("timestamp", [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString())
        $postParams.Add("timestamp_secret", "")

        $content = New-Object System.Net.Http.FormUrlEncodedContent($postParams)
        $postRes = $client.PostAsync("https://github.com/session", $content).Result
        $location = if ($postRes.Headers.Location) { $postRes.Headers.Location.ToString() } else { "" }
        $postHtml = $postRes.Content.ReadAsStringAsync().Result

        # Kiểm tra trạng thái phản hồi
        $is2fa = $location -match "two-factor" -or $postHtml -match "two-factor"
        $isDeviceVerify = $location -match "verified-device" -or $location -match "device-verification" -or $postHtml -match "device verification" -or $postHtml -match "sent a verification code"

        # Nếu chưa bật 2FA (hỏi mã qua email) -> BỎ QUA
        if ($isDeviceVerify) {
            Write-Host "$indexPrefix -> [BỎ QUA: CHƯA BẬT 2FA / ĐÒI MÃ EMAIL] ⚠️" -ForegroundColor Yellow
            $listNot2faOrVerifyMail.Add("$line | EMAIL_CODE_REQUIRED")
            "$line | EMAIL_CODE_REQUIRED" | Out-File -FilePath $fileNot2fa -Append -Encoding utf8
            continue
        }

        # Nếu sai pass hoặc lỗi khác
        if (-not $is2fa) {
            if ($postHtml -match "Incorrect username or password" -or $location -match "/login") {
                Write-Host "$indexPrefix -> [SAI MẬT KHẨU / BỊ KHÓA] ❌" -ForegroundColor Red
                $listWrongPassOrError.Add("$line | WRONG_PASSWORD")
                "$line | WRONG_PASSWORD" | Out-File -FilePath $fileWrongPass -Append -Encoding utf8
            } else {
                Write-Host "$indexPrefix -> [KHÔNG 2FA / $location] ℹ️" -ForegroundColor DarkGray
                $listNot2faOrVerifyMail.Add("$line | NO_2FA")
                "$line | NO_2FA" | Out-File -FilePath $fileNot2fa -Append -Encoding utf8
            }
            continue
        }

        # ---------------------------------------------------------------------
        # ĐÃ BẬT 2FA -> TIẾN HÀNH ĐĂNG NHẬP BẰNG TOTP SECRET
        # ---------------------------------------------------------------------
        $twoFactorUrl = if ($location.StartsWith("http")) { $location } else { "https://github.com$location" }
        if ($twoFactorUrl -notmatch "two-factor") { $twoFactorUrl = "https://github.com/sessions/two-factor/app" }

        $twoFactorPageRes = $client.GetAsync($twoFactorUrl).Result
        $twoFactorHtml = $twoFactorPageRes.Content.ReadAsStringAsync().Result

        $otpTokenMatch = [regex]::Match($twoFactorHtml, 'name="authenticity_token"\s+value="([^"]+)"')
        if (-not $otpTokenMatch.Success) {
            $otpTokenMatch = [regex]::Match($twoFactorHtml, 'value="([^"]+)"\s+name="authenticity_token"')
        }
        $otpAuthToken = $otpTokenMatch.Groups[1].Value

        $otpCode = Get-TotpCode $secret2fa

        $otpPostParams = New-Object System.Collections.Generic.Dictionary"[string,string]"
        $otpPostParams.Add("authenticity_token", $otpAuthToken)
        $otpPostParams.Add("otp", $otpCode)

        $otpContent = New-Object System.Net.Http.FormUrlEncodedContent($otpPostParams)
        $otpPostRes = $client.PostAsync("https://github.com/sessions/two-factor", $otpContent).Result
        $afterOtpLocation = if ($otpPostRes.Headers.Location) { $otpPostRes.Headers.Location.ToString() } else { "" }

        # ---------------------------------------------------------------------
        # KIỂM TRA LỖI FLAGGED (THIRD PARTY APPLICATION OAUTH)
        # ---------------------------------------------------------------------
        $oauthTestUrl = "https://github.com/login/oauth/authorize?client_id=Iv1.b507a08c87ecfe81&scope=repo,read:user"
        $oauthRes = $client.GetAsync($oauthTestUrl).Result
        $oauthHtml = $oauthRes.Content.ReadAsStringAsync().Result

        $profileRes = $client.GetAsync("https://github.com/settings/profile").Result
        $profileHtml = $profileRes.Content.ReadAsStringAsync().Result

        $isFlagged = ($oauthHtml -match "This account is flagged" -or $oauthHtml -match "cannot authorize a third party application" -or $profileHtml -match "This account is flagged" -or $profileHtml -match "Your account has been flagged")

        if ($isFlagged) {
            Write-Host "$indexPrefix -> [2FA OK NHƯNG BỊ FLAGGED ❌] (This account is flagged...)" -ForegroundColor DarkRed
            $listFlagged.Add("$line | FLAGGED_OAUTH_THIRD_PARTY")
            "$line | FLAGGED_OAUTH_THIRD_PARTY" | Out-File -FilePath $fileFlagged -Append -Encoding utf8
        } else {
            Write-Host "$indexPrefix -> [LIVE GOOD 2FA ✅] (Tài khoản sạch, không bị flagged)" -ForegroundColor Green
            $listLiveGood.Add($line)
            $line | Out-File -FilePath $fileLiveGood -Append -Encoding utf8
        }

    } catch {
        Write-Host "$indexPrefix -> [EXCEPTION: $($_.Exception.Message)]" -ForegroundColor DarkRed
        $listWrongPassOrError.Add("$line | EXCEPTION: $($_.Exception.Message)")
        "$line | EXCEPTION: $($_.Exception.Message)" | Out-File -FilePath $fileWrongPass -Append -Encoding utf8
    } finally {
        $client.Dispose()
    }

    # Nghỉ nhẹ 100ms tránh spam request
    Start-Sleep -Milliseconds 100
}

# Tổng hợp JSON
$summaryData = [PSCustomObject]@{
    TotalAccounts      = $total
    LiveGood2FA        = $listLiveGood.Count
    Flagged2FA         = $listFlagged.Count
    Not2faOrVerifyMail = $listNot2faOrVerifyMail.Count
    WrongPassOrError   = $listWrongPassOrError.Count
    Timestamp          = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
}
$summaryData | ConvertTo-Json -Depth 3 | Out-File -FilePath $fileSummaryJson -Encoding utf8

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "                     TỔNG KẾT BÁO CÁO TOÀN BỘ FILE" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "Tổng số tài khoản trong file output_1.txt   : $total"
Write-Host "✅ LIVE GOOD (Đã có 2FA, SẠCH, không bị flagged) : $($listLiveGood.Count) ($([Math]::Round(($listLiveGood.Count / $total) * 100, 1))%)" -ForegroundColor Green
Write-Host "❌ BỊ FLAGGED (Đã có 2FA nhưng BỊ GẮN CỜ OAUTH) : $($listFlagged.Count) ($([Math]::Round(($listFlagged.Count / $total) * 100, 1))%)" -ForegroundColor DarkRed
Write-Host "⚠️ BỎ QUA (Chưa bật 2FA / Đòi mã Email)         : $($listNot2faOrVerifyMail.Count) ($([Math]::Round(($listNot2faOrVerifyMail.Count / $total) * 100, 1))%)" -ForegroundColor Yellow
Write-Host "❌ SAI MẬT KHẨU / BỊ KHÓA HẲN                   : $($listWrongPassOrError.Count) ($([Math]::Round(($listWrongPassOrError.Count / $total) * 100, 1))%)" -ForegroundColor Red
Write-Host "--------------------------------------------------------------------------------"
Write-Host "📁 File TÀI KHOẢN SẠCH LIVE GOOD đã lưu : $fileLiveGood" -ForegroundColor Green
Write-Host "📁 File TÀI KHOẢN BỊ FLAGGED đã lưu      : $fileFlagged" -ForegroundColor DarkRed
Write-Host "📁 File TÀI KHOẢN BỎ QUA (Chưa 2FA)     : $fileNot2fa" -ForegroundColor Yellow
Write-Host "📁 File BÁO CÁO JSON tổng kết            : $fileSummaryJson" -ForegroundColor Cyan
Write-Host "================================================================================`n" -ForegroundColor Cyan
