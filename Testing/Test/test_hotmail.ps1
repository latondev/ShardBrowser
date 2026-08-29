param (
    [string]$AccountLine = "LobosElfreda26@hotmail.com|4J4jP51n971c|M.C549_BAY.0.U.-Crrx3kwTlIiZUiOo9l0I3tYWz8pz97*gQa!17KgzucLPLNrbilf2LInoVLQDhSYr!n70le5Phi7RqYmEMdyGVrSq0Qbv3jCwuJ11NHf*pJs6oahcuYrQSBaxNFntlu26UTFxfeum0z9NtVhUAqCXVME*BQuAOSu9orewyAYdLt41Qq*6vrVF75s!NiGYyjlyjykI4PDy2823rCMeUrtbKEFTDAvakYcB5T6ogX8sWR7fxtzhSBAUg1!iha3HEy3yX4Tur8B8lQyzIDhcfn2uixvLx!WR460!QFfH*T4BXAQG70*T6rRZUgHPNMvmcXNPS!D4T9K*XG7M7Y!Bp9DSHFq6rpewypYMw9gEcDMD1u5OFuHfhqe47z7otZCeO9okNI0L1DE*RTsLaeC*zcanUJ25Yr43yy6Cy4Ek*YZhvSGcExglXHKEZeHuzqL87sq4yg$$|9e5f94bc-e8a4-4e73-b8be-63364c29d753|kkzwxyymdyzy@smvmail.com"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$parts = $AccountLine.Trim().Split('|')
$email = $parts[0]
$password = $parts[1]
$refreshToken = $parts[2]
$clientId = $parts[3]
$recoveryEmail = if ($parts.Length -ge 5) { $parts[4] } else { "" }

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "KIỂM TRA TÀI KHOẢN HOTMAIL / OUTLOOK OAUTH" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Email: $email"
Write-Host "Password: $password"
Write-Host "Client ID: $clientId"
Write-Host "Recovery Email: $recoveryEmail"
Write-Host "Refresh Token: $($refreshToken.Substring(0, 30))... (len: $($refreshToken.Length))"

$accessToken = $null

# [1] Thử đổi qua login.microsoftonline.com
Write-Host "`n[1] Thử đổi Token qua login.microsoftonline.com..." -ForegroundColor Yellow
$body = @{
    client_id     = $clientId
    grant_type    = "refresh_token"
    refresh_token = $refreshToken
}

try {
    $res = Invoke-RestMethod -Uri "https://login.microsoftonline.com/consumers/oauth2/v2.0/token" `
        -Method Post `
        -ContentType "application/x-www-form-urlencoded" `
        -Body $body `
        -ErrorAction Stop

    if ($res.access_token) {
        $accessToken = $res.access_token
        Write-Host "===> ĐỔI TOKEN THÀNH CÔNG (login.microsoftonline.com)!" -ForegroundColor Green
        Write-Host "Access Token: $($accessToken.Substring(0, 30))..."
    }
} catch {
    Write-Host "Lỗi login.microsoftonline.com: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails) {
        Write-Host "Chi tiết: $($_.ErrorDetails.Message)" -ForegroundColor DarkRed
    }
}

# [2] Thử đổi qua login.live.com nếu bước 1 không thành công
if (-not $accessToken) {
    Write-Host "`n[2] Thử đổi Token qua login.live.com..." -ForegroundColor Yellow
    try {
        $resLive = Invoke-RestMethod -Uri "https://login.live.com/oauth20_token.srf" `
            -Method Post `
            -ContentType "application/x-www-form-urlencoded" `
            -Body $body `
            -ErrorAction Stop

        if ($resLive.access_token) {
            $accessToken = $resLive.access_token
            Write-Host "===> ĐỔI TOKEN THÀNH CÔNG (login.live.com)!" -ForegroundColor Green
            Write-Host "Access Token: $($accessToken.Substring(0, 30))..."
        }
    } catch {
        Write-Host "Lỗi login.live.com: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails) {
            Write-Host "Chi tiết: $($_.ErrorDetails.Message)" -ForegroundColor DarkRed
        }
    }
}

if (-not $accessToken) {
    Write-Host "`n[KẾT QUẢ] => Tài khoản DIE hoặc Refresh Token đã hết hạn / không hợp lệ!" -ForegroundColor Red
    exit 1
}

# [3] Kiểm tra thông tin User Profile
Write-Host "`n[3] Kiểm tra thông tin User (Graph API me)..." -ForegroundColor Yellow
$headers = @{
    "Authorization" = "Bearer $accessToken"
    "Accept"        = "application/json"
}

try {
    $me = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/me" -Headers $headers -Method Get -ErrorAction Stop
    Write-Host "Tên hiển thị: $($me.displayName)" -ForegroundColor Green
    Write-Host "User Principal Name: $($me.userPrincipalName)" -ForegroundColor Green
    Write-Host "Mail: $($me.mail)" -ForegroundColor Green
} catch {
    Write-Host "Lỗi đọc User Profile: $($_.Exception.Message)" -ForegroundColor DarkYellow
}

# [4] Lấy danh sách Email / OTP gần nhất
Write-Host "`n[4] Đang lấy 10 email gần nhất từ Hộp thư đến (Inbox)..." -ForegroundColor Yellow
try {
    $msgUrl = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?`$top=10&`$select=id,from,subject,bodyPreview,receivedDateTime"
    $messages = Invoke-RestMethod -Uri $msgUrl -Headers $headers -Method Get -ErrorAction Stop

    if ($messages.value -and $messages.value.Count -gt 0) {
        Write-Host "===> TÌM THẤY $($messages.value.Count) EMAIL TRONG HỘP THƯ:" -ForegroundColor Green
        $i = 1
        foreach ($msg in $messages.value) {
            Write-Host "`n--- Email #$i ---" -ForegroundColor Cyan
            Write-Host "Từ: $($msg.from.emailAddress.name) <$($msg.from.emailAddress.address)>"
            Write-Host "Tiêu đề: $($msg.subject)" -ForegroundColor White
            Write-Host "Thời gian: $($msg.receivedDateTime)"
            Write-Host "Nội dung vắn tắt: $($msg.bodyPreview)" -ForegroundColor Gray
            $i++
        }
    } else {
        Write-Host "===> Hộp thư rỗng (Chưa có thư mới nào)." -ForegroundColor Yellow
    }
} catch {
    Write-Host "Lỗi khi đọc messages: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails) {
        Write-Host "Chi tiết: $($_.ErrorDetails.Message)" -ForegroundColor DarkRed
    }
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "KIỂM TRA HOÀN TẤT: TÀI KHOẢN HOẠT ĐỘNG TỐT (LIVE)" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
