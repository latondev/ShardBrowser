<#
.SYNOPSIS
    Script kiểm tra trạng thái sống (Live/Die) và khả năng nhận OTP của tài khoản Hotmail/Outlook.
.DESCRIPTION
    Định dạng đầu vào: Email|Password|RefreshToken|ClientId|RecoveryEmail
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\check_hotmail.ps1 "user@hotmail.com|pass|token|clientId|recovery"
#>

param (
    [string]$AccountLine = "LobosElfreda26@hotmail.com|4J4jP51n971c|M.C549_BAY.0.U.-Crrx3kwTlIiZUiOo9l0I3tYWz8pz97*gQa!17KgzucLPLNrbilf2LInoVLQDhSYr!n70le5Phi7RqYmEMdyGVrSq0Qbv3jCwuJ11NHf*pJs6oahcuYrQSBaxNFntlu26UTFxfeum0z9NtVhUAqCXVME*BQuAOSu9orewyAYdLt41Qq*6vrVF75s!NiGYyjlyjykI4PDy2823rCMeUrtbKEFTDAvakYcB5T6ogX8sWR7fxtzhSBAUg1!iha3HEy3yX4Tur8B8lQyzIDhcfn2uixvLx!WR460!QFfH*T4BXAQG70*T6rRZUgHPNMvmcXNPS!D4T9K*XG7M7Y!Bp9DSHFq6rpewypYMw9gEcDMD1u5OFuHfhqe47z7otZCeO9okNI0L1DE*RTsLaeC*zcanUJ25Yr43yy6Cy4Ek*YZhvSGcExglXHKEZeHuzqL87sq4yg$$|9e5f94bc-e8a4-4e73-b8be-63364c29d753|kkzwxyymdyzy@smvmail.com"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$parts = $AccountLine.Trim().Split('|')
$email = $parts[0]
$password = $parts[1]
$refreshToken = if ($parts.Length -ge 3) { $parts[2] } else { "" }
$clientId = if ($parts.Length -ge 4) { $parts[3] } else { "" }
$recoveryEmail = if ($parts.Length -ge 5) { $parts[4] } else { "" }

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     KIỂM TRA TÀI KHOẢN HOTMAIL: $email" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Email:          $email"
Write-Host "Mật khẩu:       $password"
Write-Host "Client ID:      $clientId"
Write-Host "Mail khôi phục: $recoveryEmail"

$isOAuthAlive = $false
$accessToken = $null

# -------------------------------------------------------------------------
# PHẦN 1: KIỂM TRA OAUTH2 REFRESH TOKEN (API NHẬN OTP TỰ ĐỘNG)
# -------------------------------------------------------------------------
Write-Host "`n[1] Kiểm tra OAuth2 Refresh Token (API Graph/Outlook)..." -ForegroundColor Yellow

if ($refreshToken -and $clientId) {
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
            -ErrorAction Stop

        if ($res.access_token) {
            $isOAuthAlive = $true
            $accessToken = $res.access_token
            Write-Host "  -> Refresh Token: [LIVE / HỢP LỆ] ✅" -ForegroundColor Green
            Write-Host "  -> Access Token đã tạo thành công!" -ForegroundColor Green
        }
    } catch {
        Write-Host "  -> Refresh Token: [DIE / HẾT HẠN] ❌" -ForegroundColor Red
        if ($_.ErrorDetails) {
            $errObj = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($errObj) {
                Write-Host "  -> Mã lỗi: $($errObj.error) - $($errObj.error_description)" -ForegroundColor DarkRed
            } else {
                Write-Host "  -> Chi tiết lỗi: $($_.ErrorDetails.Message)" -ForegroundColor DarkRed
            }
        }
    }
} else {
    Write-Host "  -> Không có RefreshToken hoặc ClientId để kiểm tra OAuth." -ForegroundColor Gray
}

# Nếu OAuth sống -> Lấy trực tiếp thư & OTP
if ($isOAuthAlive -and $accessToken) {
    Write-Host "`n[2] Đang đọc hộp thư đến (Inbox) qua Microsoft Graph API..." -ForegroundColor Yellow
    $headers = @{
        "Authorization" = "Bearer $accessToken"
        "Accept"        = "application/json"
    }
    try {
        $msgUrl = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?`$top=5&`$select=id,from,subject,bodyPreview,receivedDateTime"
        $messages = Invoke-RestMethod -Uri $msgUrl -Headers $headers -Method Get -ErrorAction Stop

        if ($messages.value -and $messages.value.Count -gt 0) {
            Write-Host "  -> ĐỌC THƯ THÀNH CÔNG! Tìm thấy $($messages.value.Count) thư mới nhất:" -ForegroundColor Green
            $idx = 1
            foreach ($m in $messages.value) {
                Write-Host "`n  --- Thư #$idx ---" -ForegroundColor Cyan
                Write-Host "  Người gửi : $($m.from.emailAddress.name) <$($m.from.emailAddress.address)>"
                Write-Host "  Tiêu đề   : $($m.subject)"
                Write-Host "  Thời gian : $($m.receivedDateTime)"
                Write-Host "  Nội dung  : $($m.bodyPreview)" -ForegroundColor Gray
                $idx++
            }
        } else {
            Write-Host "  -> Hộp thư đến hiện tại rỗng." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  -> Lỗi khi truy xuất hộp thư: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# -------------------------------------------------------------------------
# PHẦN 2: KIỂM TRA TRẠNG THÁI WEB LOGIN (EMAIL + PASSWORD)
# -------------------------------------------------------------------------
Write-Host "`n[2] Kiểm tra trạng thái Web Login (Email + Mật khẩu)..." -ForegroundColor Yellow

Add-Type -AssemblyName System.Net.Http
$cookieContainer = New-Object System.Net.CookieContainer
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.CookieContainer = $cookieContainer
$handler.AllowAutoRedirect = $false
$client = New-Object System.Net.Http.HttpClient($handler)
$client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

try {
    $loginPageRes = $client.GetAsync("https://login.live.com/login.srf").Result
    $loginHtml = $loginPageRes.Content.ReadAsStringAsync().Result

    $ppft = ""
    $ppftMatch = [regex]::Match($loginHtml, 'value=\\"([^\\"]+)\\" name=\\"PPFT\\"')
    if (-not $ppftMatch.Success) {
        $ppftMatch = [regex]::Match($loginHtml, 'name=\\"PPFT\\"[^>]*value=\\"([^\\"]+)\\"')
    }
    if (-not $ppftMatch.Success) {
        $ppftMatch = [regex]::Match($loginHtml, 'name="PPFT"[^>]*value="([^"]+)"')
    }
    if ($ppftMatch.Success) {
        $ppft = $ppftMatch.Groups[1].Value
    }

    $urlPost = "https://login.live.com/ppsecure/post.srf"
    $urlPostMatch = [regex]::Match($loginHtml, 'urlPost:''([^'']+)''')
    if ($urlPostMatch.Success) {
        $urlPost = $urlPostMatch.Groups[1].Value
    }

    if (-not $ppft) {
        Write-Host "  -> Không lấy được Flow Token PPFT từ Microsoft." -ForegroundColor Red
    } else {
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
        $postRes = $client.PostAsync($urlPost, $content).Result
        $postHtml = $postRes.Content.ReadAsStringAsync().Result
        $location = if ($postRes.Headers.Location) { $postRes.Headers.Location.ToString() } else { "" }

        Write-Host "`n==========================================================" -ForegroundColor Green
        Write-Host "                  KẾT QUẢ TỔNG QUAN" -ForegroundColor Green
        Write-Host "==========================================================" -ForegroundColor Green

        if ($postHtml -match "account or password is incorrect" -or $postHtml -match "That password is incorrect" -or $postHtml -match "80046704") {
            Write-Host "❌ TRẠNG THÁI: SAI MẬT KHẨU (INCORRECT PASSWORD)" -ForegroundColor Red
            Write-Host "   -> Microsoft trả về mã lỗi 80046704 (The account or password is incorrect)." -ForegroundColor DarkRed
            Write-Host "   -> Mật khẩu '$password' không đúng hoặc tài khoản đã bị thay đổi mật khẩu." -ForegroundColor DarkYellow
            Write-Host "   -> Mail khôi phục hiện tại của tài khoản: $recoveryEmail" -ForegroundColor Cyan
        } elseif ($location -match "account.live.com/Abuse" -or $location -match "identity/confirm" -or $postHtml -match "abuse") {
            Write-Host "❌ TRẠNG THÁI: TÀI KHOẢN BỊ KHÓA (LOCKED / SUSPENDED)" -ForegroundColor Red
            Write-Host "   -> Tài khoản bị Microsoft tạm khóa do vi phạm hoặc hành vi bất thường."
        } elseif ($location -match "account.live.com/proofs" -or $postHtml -match "proofs") {
            Write-Host "⚠️ TRẠNG THÁI: YÊU CẦU XÁC MINH EMAIL KHÔI PHỤC ($recoveryEmail)" -ForegroundColor Yellow
        } elseif ($postHtml -match "account does not exist" -or $postHtml -match "Tài khoản không tồn tại") {
            Write-Host "❌ TRẠNG THÁI: TÀI KHOẢN KHÔNG TỒN TẠI" -ForegroundColor Red
        } elseif ($location -match "account.microsoft.com" -or $location -match "outlook.live.com" -or $location -match "privacynotice") {
            Write-Host "✅ TRẠNG THÁI: TÀI KHOẢN LIVE VÀ ĐĂNG NHẬP THÀNH CÔNG!" -ForegroundColor Green
        } else {
            Write-Host "ℹ️ Chi tiết: HTTP $([int]$postRes.StatusCode) - Kiểm tra phản hồi trong file debug."
        }
    }
} catch {
    Write-Host "Lỗi Web Login: $($_.Exception.Message)" -ForegroundColor Red
}

$client.Dispose()
Write-Host "==========================================================`n" -ForegroundColor Cyan
