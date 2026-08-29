param (
    [string]$FilePath = "D:\YTB\Resgiter_AI\ShardBrowser\Testing\Check2faGit\FileHotmail\order_DH20260521IZBTNK_20260602.txt"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$lines = Get-Content -Path $FilePath | Where-Object { $_.Trim() -ne "" } | Select-Object -First 10

Write-Host "Testing first 10 accounts from order_DH with scope 'https://graph.microsoft.com/Mail.ReadWrite'..." -ForegroundColor Cyan

foreach ($line in $lines) {
    $parts = $line.Trim().Split('|')
    $email = $parts[0]
    $password = $parts[1]
    $refreshToken = $parts[2]
    $clientId = $parts[3]
    $recoveryEmail = if ($parts.Length -ge 5) { $parts[4] } else { "" }

    $body = @{
        client_id     = $clientId
        grant_type    = "refresh_token"
        refresh_token = $refreshToken
        scope         = "https://graph.microsoft.com/Mail.ReadWrite"
    }

    try {
        $res = Invoke-RestMethod -Uri "https://login.microsoftonline.com/consumers/oauth2/v2.0/token" `
            -Method Post `
            -ContentType "application/x-www-form-urlencoded" `
            -Body $body `
            -ErrorAction Stop

        Write-Host "$email => LIVE! Access Token obtained!" -ForegroundColor Green
    } catch {
        $msg = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        Write-Host "$email => Token Failed: $msg" -ForegroundColor Red
    }
}
