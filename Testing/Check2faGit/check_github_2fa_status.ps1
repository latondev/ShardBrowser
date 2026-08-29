<#
.SYNOPSIS
    Script kiểm tra trạng thái 2FA của danh sách tài khoản GitHub từ file github_accounts.txt.
.DESCRIPTION
    Phân loại chính xác:
    1. ĐÃ BẬT 2FA (Hỏi mã TOTP từ Authenticator App).
    2. CHƯA BẬT 2FA -> BÁO GỬI CODE VỀ EMAIL (Device Verification).
    3. ĐĂNG NHẬP THẲNG (Không có 2FA).
    4. SAI MẬT KHẨU / BỊ KHÓA.
#>

param (
    [string]$FilePath = "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Check2faGit\github_accounts.txt",
    [string]$OutputDir = "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Check2faGit\Results_GitHub"
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

$lines = Get-Content -Path $FilePath | Where-Object { $_.Trim() -ne "" }
$total = $lines.Count

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "      BẮT ĐẦU KIỂM TRA TRẠNG THÁI 2FA CHO $total TÀI KHOẢN GITHUB" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "File nguồn: $FilePath"
Write-Host "Thư mục xuất kết quả: $OutputDir`n"

$list2faEnabled = [System.Collections.Generic.List[string]]::new()
$listEmailCodeReq = [System.Collections.Generic.List[string]]::new()
$listDirectLogin = [System.Collections.Generic.List[string]]::new()
$listFailed = [System.Collections.Generic.List[string]]::new()
$listDetails = [System.Collections.Generic.List[PSCustomObject]]::new()

$count = 0

foreach ($line in $lines) {
    $count++
    $parts = $line.Trim().Split('|') | ForEach-Object { $_.Trim() }
    $login = $parts[0]
    $password = if ($parts.Length -ge 2) { $parts[1] } else { "" }
    $secret2fa = if ($parts.Length -ge 3) { $parts[2] } else { "" }

    $cookieContainer = New-Object System.Net.CookieContainer
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.CookieContainer = $cookieContainer
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
    $client.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")

    $statusStr = "UNKNOWN"
    $detailStr = ""

    try {
        # 1. GET /login để lấy authenticity_token
        $loginPageRes = $client.GetAsync("https://github.com/login").Result
        $loginHtml = $loginPageRes.Content.ReadAsStringAsync().Result

        $tokenMatch = [regex]::Match($loginHtml, 'name="authenticity_token"\s+value="([^"]+)"')
        if (-not $tokenMatch.Success) {
            $tokenMatch = [regex]::Match($loginHtml, 'value="([^"]+)"\s+name="authenticity_token"')
        }
        $authToken = $tokenMatch.Groups[1].Value

        if (-not $authToken) {
            $statusStr = "ERROR_GET_TOKEN"
            $detailStr = "Không trích xuất được authenticity_token từ trang login."
            Write-Host "[$count/$total] $login -> [LỖI TOKEN]" -ForegroundColor DarkGray
            $listFailed.Add("$line | $statusStr")
        } else {
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

            if ($location -match "two-factor/app" -or $location -match "sessions/two-factor" -or $postHtml -match "app_totp" -or $postHtml -match "authenticator app") {
                $statusStr = "2FA_ENABLED"
                $detailStr = "Đã bật 2FA (Hỏi mã TOTP App)"
                Write-Host "[$count/$total] $login -> [ĐÃ BẬT 2FA (TOTP) ✅]" -ForegroundColor Green
                $list2faEnabled.Add($line)
            } elseif ($location -match "verified-device" -or $location -match "device-verification" -or $postHtml -match "device verification" -or $postHtml -match "sent a verification code" -or $postHtml -match "verification code sent" -or $location -match "sessions/two-factor/sms") {
                $statusStr = "EMAIL_CODE_REQUIRED"
                $detailStr = "CHƯA BẬT 2FA -> BÁO GỬI CODE VỀ EMAIL"
                Write-Host "[$count/$total] $login -> [CHƯA BẬT 2FA - GỬI CODE EMAIL ⚠️]" -ForegroundColor Yellow
                $listEmailCodeReq.Add($line)
            } elseif ($location -eq "https://github.com/" -or $location -eq "/" -or ($location -match "github.com/(?!login|session)" -and $location -notmatch "login")) {
                $statusStr = "DIRECT_LOGIN"
                $detailStr = "Đăng nhập thẳng (Chưa có 2FA)"
                Write-Host "[$count/$total] $login -> [LOGIN THẲNG (KHÔNG 2FA) ℹ️]" -ForegroundColor Cyan
                $listDirectLogin.Add($line)
            } elseif ($postHtml -match "Incorrect username or password" -or $postHtml -match "flash-error" -or $location -match "/login") {
                $statusStr = "WRONG_PASSWORD_OR_LOCKED"
                $detailStr = "Sai mật khẩu hoặc tài khoản bị khóa"
                Write-Host "[$count/$total] $login -> [SAI PASS / KHÓA ❌]" -ForegroundColor Red
                $listFailed.Add("$line | $statusStr")
            } else {
                $statusStr = "OTHER"
                $detailStr = "Location: $location"
                Write-Host "[$count/$total] $login -> [KHÁC: $location]" -ForegroundColor DarkYellow
                $listFailed.Add("$line | $statusStr ($location)")
            }
        }
    } catch {
        $statusStr = "EXCEPTION"
        $detailStr = $_.Exception.Message
        Write-Host "[$count/$total] $login -> [LỖI KẾT NỐI: $($_.Exception.Message)]" -ForegroundColor DarkRed
        $listFailed.Add("$line | $statusStr - $($_.Exception.Message)")
    } finally {
        $client.Dispose()
    }

    $listDetails.Add([PSCustomObject]@{
        Index    = $count
        Login    = $login
        Status   = $statusStr
        Detail   = $detailStr
        Secret   = $secret2fa
    })

    # Giãn cách 200ms tránh rate-limit login GitHub
    Start-Sleep -Milliseconds 200
}

# Xuất ra file
$file2fa = Join-Path $OutputDir "github_2fa_enabled.txt"
$fileEmailCode = Join-Path $OutputDir "github_email_code_required.txt"
$fileDirect = Join-Path $OutputDir "github_direct_login.txt"
$fileFailed = Join-Path $OutputDir "github_failed_or_wrong_pass.txt"
$fileJson = Join-Path $OutputDir "github_report_summary.json"

$list2faEnabled | Out-File -FilePath $file2fa -Encoding utf8
$listEmailCodeReq | Out-File -FilePath $fileEmailCode -Encoding utf8
$listDirectLogin | Out-File -FilePath $fileDirect -Encoding utf8
$listFailed | Out-File -FilePath $fileFailed -Encoding utf8
$listDetails | ConvertTo-Json -Depth 3 | Out-File -FilePath $fileJson -Encoding utf8

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "                     TỔNG KẾT BÁO CÁO TÀI KHOẢN GITHUB" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "Tổng số tài khoản đã kiểm tra             : $total"
Write-Host "✅ Số tài khoản ĐÃ BẬT 2FA (TOTP App)       : $($list2faEnabled.Count)" -ForegroundColor Green
Write-Host "⚠️ Số tài khoản CHƯA BẬT 2FA (HỎI CODE MAIL): $($listEmailCodeReq.Count)" -ForegroundColor Yellow
Write-Host "ℹ️ Số tài khoản ĐĂNG NHẬP THẲNG (Không 2FA): $($listDirectLogin.Count)" -ForegroundColor Cyan
Write-Host "❌ Số tài khoản SAI PASS / BỊ KHÓA / LỖI    : $($listFailed.Count)" -ForegroundColor Red
Write-Host "--------------------------------------------------------------------------------"
Write-Host "📁 File CHƯA BẬT 2FA (Hỏi code email) đã lưu: $fileEmailCode" -ForegroundColor Yellow
Write-Host "📁 File ĐÃ BẬT 2FA (TOTP) đã lưu            : $file2fa" -ForegroundColor Green
Write-Host "📁 File SAI PASS / LỖI đã lưu               : $fileFailed" -ForegroundColor Red
Write-Host "📁 File Báo cáo chi tiết JSON               : $fileJson" -ForegroundColor Cyan
Write-Host "================================================================================`n" -ForegroundColor Cyan
