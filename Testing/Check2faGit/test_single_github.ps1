param (
    [string]$AccountLine = "litalienkussmaul104@outlook.com|01652530159Aa@|YBXMILOQIN7SQ7EN"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$parts = $AccountLine.Trim().Split('|')
$login = $parts[0]
$password = $parts[1]
$secret2fa = if ($parts.Length -ge 3) { $parts[2] } else { "" }

Write-Host "Testing GitHub Login for: $login" -ForegroundColor Cyan

Add-Type -AssemblyName System.Net.Http
$cookieContainer = New-Object System.Net.CookieContainer
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.CookieContainer = $cookieContainer
$handler.AllowAutoRedirect = $false
$client = New-Object System.Net.Http.HttpClient($handler)
$client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
$client.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")

try {
    # 1. GET /login để lấy authenticity_token & cookies
    $loginPageRes = $client.GetAsync("https://github.com/login").Result
    $loginHtml = $loginPageRes.Content.ReadAsStringAsync().Result

    $tokenMatch = [regex]::Match($loginHtml, 'name="authenticity_token"\s+value="([^"]+)"')
    if (-not $tokenMatch.Success) {
        $tokenMatch = [regex]::Match($loginHtml, 'value="([^"]+)"\s+name="authenticity_token"')
    }
    $authToken = $tokenMatch.Groups[1].Value

    Write-Host "Authenticity Token found: $([bool]$authToken)"

    # 2. POST /session
    $postParams = New-Object System.Collections.Generic.Dictionary"[string,string]"
    $postParams.Add("commit", "Sign in")
    $postParams.Add("authenticity_token", $authToken)
    $postParams.Add("login", $login)
    $postParams.Add("password", $password)
    $postParams.Add("trusted_device", "")
    $postParams.Add("user_session[browser_session_id]", "")
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

    Write-Host "Status Code: $([int]$postRes.StatusCode) ($($postRes.StatusCode))"
    Write-Host "Location Header: $location" -ForegroundColor Yellow

    if ($location -match "two-factor/app" -or $location -match "sessions/two-factor" -or $postHtml -match "app_totp" -or $postHtml -match "authenticator app") {
        Write-Host "=> TRẠNG THÁI: ĐÃ BẬT 2FA (Hỏi mã TOTP / App Authenticator) ✅" -ForegroundColor Green
    } elseif ($location -match "verified-device" -or $location -match "device-verification" -or $postHtml -match "device verification" -or $postHtml -match "sent a verification code" -or $postHtml -match "verification code sent") {
        Write-Host "=> TRẠNG THÁI: CHƯA BẬT 2FA -> ĐANG BÁO GỬI CODE VỀ EMAIL ⚠️" -ForegroundColor Yellow
    } elseif ($location -eq "https://github.com/" -or $location -eq "/" -or $location -match "github.com/(?!login|session)") {
        Write-Host "=> TRẠNG THÁI: ĐĂNG NHẬP THÀNH CÔNG (KHÔNG BẬT 2FA, KHÔNG HỎI CODE) ℹ️" -ForegroundColor Cyan
    } elseif ($postHtml -match "Incorrect username or password" -or $postHtml -match "flash-error") {
        Write-Host "=> TRẠNG THÁI: SAI TÊN ĐĂNG NHẬP HOẶC MẬT KHẨU ❌" -ForegroundColor Red
    } else {
        Write-Host "=> TRẠNG THÁI KHÁC. Đang ghi file debug..."
        $postHtml | Out-File -FilePath "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Check2faGit\debug_git_res.html" -Encoding utf8
    }

} catch {
    Write-Host "Lỗi: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    $client.Dispose()
}
