param (
    [string]$AccountLine = "el.la.m.ed.arate.n@gmail.com|ShardX@2026!Pass#4071|YU6TMLEKHTIWSJUP"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http

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

$cookieContainer = New-Object System.Net.CookieContainer
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.CookieContainer = $cookieContainer
$handler.AllowAutoRedirect = $true
$client = New-Object System.Net.Http.HttpClient($handler)
$client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
$client.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")

# 1. Login
$loginPageRes = $client.GetAsync("https://github.com/login").Result
$loginHtml = $loginPageRes.Content.ReadAsStringAsync().Result
$tokenMatch = [regex]::Match($loginHtml, 'name="authenticity_token"\s+value="([^"]+)"')
if (-not $tokenMatch.Success) {
    $tokenMatch = [regex]::Match($loginHtml, 'value="([^"]+)"\s+name="authenticity_token"')
}
$authToken = $tokenMatch.Groups[1].Value

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
$postHtml = $postRes.Content.ReadAsStringAsync().Result

# 2FA
$otpTokenMatch = [regex]::Match($postHtml, 'name="authenticity_token"\s+value="([^"]+)"')
if (-not $otpTokenMatch.Success) {
    $otpTokenMatch = [regex]::Match($postHtml, 'value="([^"]+)"\s+name="authenticity_token"')
}
$otpAuthToken = $otpTokenMatch.Groups[1].Value
$otpCode = Get-TotpCode $secret2fa

$otpPostParams = New-Object System.Collections.Generic.Dictionary"[string,string]"
$otpPostParams.Add("authenticity_token", $otpAuthToken)
$otpPostParams.Add("otp", $otpCode)

$otpContent = New-Object System.Net.Http.FormUrlEncodedContent($otpPostParams)
$otpPostRes = $client.PostAsync("https://github.com/sessions/two-factor", $otpContent).Result

Write-Host "✅ Đã đăng nhập xong!"

$endpointsToTest = @(
    "https://github.com/settings/tokens",
    "https://github.com/settings/tokens/new",
    "https://github.com/settings/security",
    "https://github.com/settings/profile",
    "https://github.com/settings/emails",
    "https://github.com/settings/applications",
    "https://github.com/new",
    "https://github.com/contact/report-abuse"
)

foreach ($ep in $endpointsToTest) {
    $res = $client.GetAsync($ep).Result
    $html = $res.Content.ReadAsStringAsync().Result
    $finalUri = $res.RequestMessage.RequestUri.ToString()

    $hasFlagged = $html -match "flagged" -or $html -match "spam" -or $html -match "cannot authorize" -or $html -match "suspended" -or $html -match "restricted"
    Write-Host "`nEndpoint: $ep -> Final: $finalUri"
    Write-Host "Match keywords (flagged/spam/cannot authorize/suspended/restricted): $hasFlagged"

    if ($hasFlagged) {
        $matches = [regex]::Matches($html, '([^.\n]{0,50}(?:flagged|spam|cannot authorize|suspended|restricted)[^.\n]{0,50})', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        foreach ($m in $matches) {
            Write-Host "   Snippet: $($m.Groups[1].Value.Trim())" -ForegroundColor Yellow
        }
    }
}
