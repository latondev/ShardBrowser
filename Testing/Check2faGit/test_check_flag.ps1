param (
    [string]$AccountLine = "el.la.m.ed.arate.n@gmail.com|ShardX@2026!Pass#4071|YU6TMLEKHTIWSJUP"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http

# Hàm tính TOTP 6 số bằng PowerShell .NET
function Get-TotpCode([string]$Secret) {
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

$parts = $AccountLine.Trim().Split('|') | ForEach-Object { $_.Trim() }
$login = $parts[0]
$password = $parts[1]
$secret2fa = $parts[2]

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "KIỂM TRA TÀI KHOẢN: $login" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$cookieContainer = New-Object System.Net.CookieContainer
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.CookieContainer = $cookieContainer
$handler.AllowAutoRedirect = $false
$client = New-Object System.Net.Http.HttpClient($handler)
$client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
$client.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")

try {
    # 1. GET /login
    Write-Host "[1] Đang mở trang login..." -ForegroundColor Yellow
    $loginPageRes = $client.GetAsync("https://github.com/login").Result
    $loginHtml = $loginPageRes.Content.ReadAsStringAsync().Result

    $tokenMatch = [regex]::Match($loginHtml, 'name="authenticity_token"\s+value="([^"]+)"')
    if (-not $tokenMatch.Success) {
        $tokenMatch = [regex]::Match($loginHtml, 'value="([^"]+)"\s+name="authenticity_token"')
    }
    $authToken = $tokenMatch.Groups[1].Value

    # 2. POST /session
    Write-Host "[2] Đang đăng nhập (User + Pass)..." -ForegroundColor Yellow
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

    Write-Host "Location: $location" -ForegroundColor Cyan

    # Kiểm tra xem có yêu cầu 2FA TOTP không
    $is2fa = $location -match "two-factor" -or $postHtml -match "two-factor"
    $isDeviceVerify = $location -match "verified-device" -or $postHtml -match "device verification"

    if ($isDeviceVerify) {
        Write-Host "=> TRẠNG THÁI: CHƯA BẬT 2FA (ĐÒI MÃ EMAIL) -> BỎ QUA" -ForegroundColor Yellow
        exit 0
    }

    if (-not $is2fa) {
        Write-Host "=> TRẠNG THÁI: KHÔNG PHẢI 2FA HOẶC SAI PASS (Location: $location)" -ForegroundColor Red
        exit 0
    }

    Write-Host "==> ĐÃ BẬT 2FA (TOTP)! Đang thực hiện đăng nhập TOTP..." -ForegroundColor Green

    # 3. Mở trang Two Factor để lấy token xác thực OTP
    $twoFactorUrl = if ($location.StartsWith("http")) { $location } else { "https://github.com$location" }
    if ($twoFactorUrl -notmatch "two-factor") { $twoFactorUrl = "https://github.com/sessions/two-factor/app" }
    
    $twoFactorPageRes = $client.GetAsync($twoFactorUrl).Result
    $twoFactorHtml = $twoFactorPageRes.Content.ReadAsStringAsync().Result

    $otpTokenMatch = [regex]::Match($twoFactorHtml, 'name="authenticity_token"\s+value="([^"]+)"')
    if (-not $otpTokenMatch.Success) {
        $otpTokenMatch = [regex]::Match($twoFactorHtml, 'value="([^"]+)"\s+name="authenticity_token"')
    }
    $otpAuthToken = $otpTokenMatch.Groups[1].Value

    # Sinh mã TOTP 6 số
    $otpCode = Get-TotpCode $secret2fa
    Write-Host "Mã TOTP 6 số đã sinh: [ $otpCode ]" -ForegroundColor Green

    # 4. POST /sessions/two-factor
    $otpPostParams = New-Object System.Collections.Generic.Dictionary"[string,string]"
    $otpPostParams.Add("authenticity_token", $otpAuthToken)
    $otpPostParams.Add("otp", $otpCode)

    $otpContent = New-Object System.Net.Http.FormUrlEncodedContent($otpPostParams)
    $otpPostRes = $client.PostAsync("https://github.com/sessions/two-factor", $otpContent).Result
    $afterOtpLocation = if ($otpPostRes.Headers.Location) { $otpPostRes.Headers.Location.ToString() } else { "" }

    Write-Host "Sau khi nhập OTP Location: $afterOtpLocation" -ForegroundColor Cyan

    # 5. KIỂM TRA FLAGGED / OAUTH AUTHORIZATION
    Write-Host "`n[5] Đang kiểm tra xem tài khoản có bị Flagged (Third party application) hay không..." -ForegroundColor Yellow

    # Test OAuth Authorize URL (VD: client_id của ứng dụng OAuth phổ biến như 01ab8ac9400c4e429b23 hoặc Iv1.b507a08c87ecfe81)
    $oauthTestUrl = "https://github.com/login/oauth/authorize?client_id=Iv1.b507a08c87ecfe81&scope=repo,read:user"
    $oauthRes = $client.GetAsync($oauthTestUrl).Result
    $oauthHtml = $oauthRes.Content.ReadAsStringAsync().Result

    # Cũng kiểm tra trang settings/profile hoặc security
    $profileRes = $client.GetAsync("https://github.com/settings/profile").Result
    $profileHtml = $profileRes.Content.ReadAsStringAsync().Result

    Write-Host "`n==========================================" -ForegroundColor Green
    Write-Host "KẾT QUẢ KIỂM TRA FLAGGED:" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green

    $isFlagged = $false
    $flagReason = ""

    if ($oauthHtml -match "This account is flagged" -or $oauthHtml -match "cannot authorize a third party application" -or $profileHtml -match "This account is flagged") {
        $isFlagged = $true
        $flagReason = "This account is flagged, and therefore cannot authorize a third party application."
        Write-Host "❌ TRẠNG THÁI: TÀI KHOẢN BỊ FLAGGED (BỊ GẮN CỜ / KHÔNG THỂ DÙNG OAUTH)" -ForegroundColor Red
        Write-Host "   -> Chi tiết: $flagReason" -ForegroundColor DarkRed
    } elseif ($profileHtml -match "Your account has been flagged" -or $oauthHtml -match "Your account has been flagged") {
        $isFlagged = $true
        $flagReason = "Your account has been flagged."
        Write-Host "❌ TRẠNG THÁI: TÀI KHOẢN BỊ FLAGGED (GẮN CỜ SPAM)" -ForegroundColor Red
    } elseif ($profileHtml -match "Sign in to GitHub" -or $profileHtml -match "/login") {
        Write-Host "⚠️ TRẠNG THÁI: CHƯA ĐĂNG NHẬP THÀNH CÔNG HẲN (Cần kiểm tra thêm)" -ForegroundColor Yellow
    } else {
        Write-Host "✅ TRẠNG THÁI: TÀI KHOẢN SẠCH (LIVE GOOD - 2FA OK - KHÔNG BỊ FLAGGED)!" -ForegroundColor Green
    }

} catch {
    Write-Host "Lỗi: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    $client.Dispose()
}
