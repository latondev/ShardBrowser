param (
    [string]$FilePath = "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Check2faGit\FileHotmail\order_DH20260521IZBTNK_20260602.txt"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http

$lines = Get-Content -Path $FilePath | Where-Object { $_.Trim() -ne "" } | Select-Object -Skip 1 -First 5

Write-Host "Testing web login on accounts 2 to 6 from order_DH..." -ForegroundColor Cyan

foreach ($line in $lines) {
    $parts = $line.Trim().Split('|')
    $email = $parts[0]
    $password = $parts[1]
    $recoveryEmail = if ($parts.Length -ge 5) { $parts[4] } else { "" }

    $cookieContainer = New-Object System.Net.CookieContainer
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.CookieContainer = $cookieContainer
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

    try {
        $loginPageRes = $client.GetAsync("https://login.live.com/login.srf").Result
        $loginHtml = $loginPageRes.Content.ReadAsStringAsync().Result

        $ppftMatch = [regex]::Match($loginHtml, 'value=\\"([^\\"]+)\\" name=\\"PPFT\\"')
        if (-not $ppftMatch.Success) {
            $ppftMatch = [regex]::Match($loginHtml, 'name="PPFT"[^>]*value="([^"]+)"')
        }
        $ppft = $ppftMatch.Groups[1].Value

        $postParams = New-Object System.Collections.Generic.Dictionary"[string,string]"
        $postParams.Add("login", $email)
        $postParams.Add("loginfmt", $email)
        $postParams.Add("type", "11")
        $postParams.Add("LoginOptions", "3")
        $postParams.Add("passwd", $password)
        $postParams.Add("PPFT", $ppft)
        $postParams.Add("PPSX", "Pass")
        $postParams.Add("NewUser", "1")
        $postParams.Add("IsFidoSupported", "1")

        $content = New-Object System.Net.Http.FormUrlEncodedContent($postParams)
        $postRes = $client.PostAsync("https://login.live.com/ppsecure/post.srf", $content).Result
        $postHtml = $postRes.Content.ReadAsStringAsync().Result
        $location = if ($postRes.Headers.Location) { $postRes.Headers.Location.ToString() } else { "" }

        if ($postHtml -match "80046704" -or $postHtml -match "password is incorrect") {
            Write-Host "$email => [SAI MẬT KHẨU (Incorrect Password)]" -ForegroundColor Red
        } elseif ($location -match "account.live.com/Abuse" -or $location -match "identity/confirm" -or $postHtml -match "abuse") {
            Write-Host "$email => [BỊ KHÓA / LOCKED BY MICROSOFT]" -ForegroundColor Red
        } elseif ($location -match "account.live.com/proofs" -or $postHtml -match "proofs") {
            Write-Host "$email => [YÊU CẦU XÁC MINH MAIL KHÔI PHỤC ($recoveryEmail)]" -ForegroundColor Yellow
        } elseif ($location -match "account.microsoft.com" -or $location -match "outlook.live.com" -or $location -match "privacynotice") {
            Write-Host "$email => [LOGIN WEB THÀNH CÔNG! ✅]" -ForegroundColor Green
        } else {
            Write-Host "$email => Status: $([int]$postRes.StatusCode) | Location: $location" -ForegroundColor Cyan
        }
    } catch {
        Write-Host "$email => Lỗi: $($_.Exception.Message)" -ForegroundColor Red
    } finally {
        $client.Dispose()
    }

    Start-Sleep -Milliseconds 200
}
