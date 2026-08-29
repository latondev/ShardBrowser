param (
    [string]$Email = "LobosElfreda26@hotmail.com",
    [string]$Password = "4J4jP51n971c"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "KIỂM TRA ĐĂNG NHẬP TRỰC TIẾP HOTMAIL WEB" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Email: $Email"
Write-Host "Password: $Password"

try {
    # 1. Lấy trang đăng nhập & trích xuất PPFT + urlPost
    Write-Host "`n[1] Đang tải trang đăng nhập login.live.com..." -ForegroundColor Yellow
    $loginPage = Invoke-WebRequest -Uri "https://login.live.com/login.srf" -WebSession $session -UserAgent $userAgent -Method Get
    
    $html = $loginPage.Content
    
    # Trích xuất PPFT
    $ppftMatch = [regex]::Match($html, 'name="PPFT"[^>]*value="([^"]+)"')
    if (-not $ppftMatch.Success) {
        $ppftMatch = [regex]::Match($html, 'sFTTag:[^"]*"([^"]+)"')
    }
    
    if (-not $ppftMatch.Success) {
        # Thử regex khác cho PPFT
        $ppftMatch = [regex]::Match($html, 'value="([^"]+)" name="PPFT"')
    }
    
    # Trích xuất urlPost
    $urlPostMatch = [regex]::Match($html, 'urlPost:''([^'']+)''')
    if (-not $urlPostMatch.Success) {
        $urlPostMatch = [regex]::Match($html, 'action="([^"]+)"')
    }

    $ppft = if ($ppftMatch.Success) { $ppftMatch.Groups[1].Value } else { "" }
    $urlPost = if ($urlPostMatch.Success) { $urlPostMatch.Groups[1].Value } else { "https://login.live.com/ppsecure/post.srf" }

    Write-Host "URL Post: $urlPost"
    Write-Host "PPFT Token found: $([bool]$ppft)"

    if (-not $ppft) {
        Write-Host "Không trích xuất được PPFT token từ login page. Có thể Microsoft đang hiển thị Captcha hoặc trang mới." -ForegroundColor Red
        exit 1
    }

    # 2. Gửi thông tin đăng nhập
    Write-Host "`n[2] Đang gửi thông tin đăng nhập (POST)..." -ForegroundColor Yellow
    $body = @{
        "login" = $Email
        "loginfmt" = $Email
        "type" = "11"
        "LoginOptions" = "3"
        "lrt" = ""
        "lrtPartition" = ""
        "hisRegion" = ""
        "hisScaleUnit" = ""
        "passwd" = $Password
        "ps" = "2"
        "psRNGCDefaultType" = ""
        "psRNGCEntropy" = ""
        "psRNGCSLK" = ""
        "canary" = ""
        "ctx" = ""
        "hpgrequestid" = ""
        "PPFT" = $ppft
        "PPSX" = "Pass"
        "NewUser" = "1"
        "FoundMSAs" = ""
        "fspost" = "0"
        "i21" = "0"
        "CookieDisclosure" = "0"
        "IsFidoSupported" = "1"
        "isSignupPost" = "0"
        "isRecoveryAttemptPost" = "0"
        "i19" = "449833"
    }

    $postRes = Invoke-WebRequest -Uri $urlPost -WebSession $session -UserAgent $userAgent -Method Post -Body $body -MaximumRedirection 0 -ErrorAction SilentlyContinue

    Write-Host "Response Status Code: $($postRes.StatusCode)"
    
    # Kiểm tra Location header hoặc nội dung HTML
    $location = $postRes.Headers["Location"]
    Write-Host "Location Header: $location"

    $resContent = $postRes.Content

    if ($location) {
        if ($location -match "account.live.com/Abuse" -or $location -match "identity/confirm") {
            Write-Host "`n===> KẾT QUẢ: TÀI KHOẢN BỊ KHÓA (ACCOUNT LOCKED / ABUSE)" -ForegroundColor Red
        } elseif ($location -match "account.live.com/proofs" -or $location -match "recover") {
            Write-Host "`n===> KẾT QUẢ: YÊU CẦU XÁC MINH EMAIL KHÔI PHỤC (NEED VERIFY PROOF)" -ForegroundColor Yellow
        } elseif ($location -match "two-factor" -or $location -match "TwoFactor") {
            Write-Host "`n===> KẾT QUẢ: YÊU CẦU 2FA" -ForegroundColor Cyan
        } elseif ($location -match "outlook.live.com" -or $location -match "account.microsoft.com") {
            Write-Host "`n===> KẾT QUẢ: ĐĂNG NHẬP THÀNH CÔNG! (TÀI KHOẢN HOẠT ĐỘNG LIVE)" -ForegroundColor Green
        } else {
            Write-Host "`n===> Chuyển hướng tới: $location" -ForegroundColor White
        }
    } else {
        if ($resContent -match "sErr.*password" -or $resContent -match "That password is incorrect" -or $resContent -match "Mật khẩu không đúng") {
            Write-Host "`n===> KẾT QUẢ: SAI MẬT KHẨU (WRONG PASSWORD)" -ForegroundColor Red
        } elseif ($resContent -match "account does not exist" -or $resContent -match "Tài khoản không tồn tại") {
            Write-Host "`n===> KẾT QUẢ: TÀI KHOẢN KHÔNG TỒN TẠI (NOT FOUND)" -ForegroundColor Red
        } elseif ($resContent -match "abuse" -or $resContent -match "suspended") {
            Write-Host "`n===> KẾT QUẢ: TÀI KHOẢN BỊ KHÓA (ACCOUNT LOCKED)" -ForegroundColor Red
        } elseif ($resContent -match "proofs") {
            Write-Host "`n===> KẾT QUẢ: YÊU CẦU XÁC MINH (VERIFICATION REQUIRED)" -ForegroundColor Yellow
        } else {
            Write-Host "`n===> Nội dung phản hồi: $($resContent.Substring(0, [Math]::Min(500, $resContent.Length)))"
        }
    }

} catch {
    Write-Host "Lỗi: $($_.Exception.Message)" -ForegroundColor Red
}
