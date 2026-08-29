$testAccounts = @(
    "ya8tbjfn424@mlongmail.com | 01652530159Aa@|KQYTYNCQND42SUAT",
    "dnd.n.g.z.m.s.n.fsm.bt@gmail.com | TempMail@2026xY! | BRHLSDIDZLCRBTBV"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http

foreach ($line in $testAccounts) {
    # Tách và TRIM từng phần tử để loại bỏ khoảng trắng thừa
    $parts = $line.Trim().Split('|') | ForEach-Object { $_.Trim() }
    $login = $parts[0]
    $password = $parts[1]
    $secret2fa = $parts[2]

    Write-Host "`nTesting cleaned credentials:" -ForegroundColor Cyan
    Write-Host "Login   : '$login'"
    Write-Host "Password: '$password'"
    Write-Host "Secret  : '$secret2fa'"

    $cookieContainer = New-Object System.Net.CookieContainer
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.CookieContainer = $cookieContainer
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

    try {
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
        Write-Host "Location   : $location" -ForegroundColor Yellow

        if ($location -match "two-factor/app" -or $location -match "sessions/two-factor" -or $postHtml -match "app_totp") {
            Write-Host "=> KẾT QUẢ: ĐÃ BẬT 2FA (TOTP) THÀNH CÔNG! ✅" -ForegroundColor Green
        } elseif ($location -match "verified-device" -or $location -match "device-verification" -or $postHtml -match "verification code") {
            Write-Host "=> KẾT QUẢ: CHƯA BẬT 2FA -> GỬI CODE VỀ EMAIL ⚠️" -ForegroundColor Yellow
        } else {
            Write-Host "=> KẾT QUẢ KHÁC: $location" -ForegroundColor Red
        }

    } catch {
        Write-Host "Lỗi: $($_.Exception.Message)" -ForegroundColor Red
    } finally {
        $client.Dispose()
    }
}
