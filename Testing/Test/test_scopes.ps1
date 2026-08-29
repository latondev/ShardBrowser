param (
    [string]$AccountLine = "lacerenzaweigman7380@outlook.com|arCtSSJUQS7|M.C538_BL2.0.U.MsaArtifacts.-CvwfxSfFPfXo9gq0dhlO5XxChtp53iOu4dotwGWtuoNbKevcMZ9AIgGoAgIjzatILf8A6vhJ9hqmVZ6Ey61iWtaZi5c63RGB7vOapugHfyobRU5rGbwLYM*nEUJj0mTyhWDUnKdrlixVhUmbfrGtZQS74Ah0fhdl3M8wgdBkE2UI7P7gzmbX8Bo2bMxlD7vDNgez7koOlAGJ17KDy5SE!J2hUONvu6YPATuA70naK3ZJiyrJXweuKmWN*jbSdYYT11kI3MNEBiefxrJcszosMeJ1boUBjTR4zYfnM1jqADYrct0vLd!Ncy1ZASuH41CLKHcJb!qCMHFBXcSyCEMTqCTgfl7j52XIipyeX!kIsIGCH2HLjR96mGM331EKYKH6XRs3QnVwv77uNcKBnAnAycfksvQBU8H5HFzLT5pXJ9!BaJ2ZoZEIob3FKJjE9Su0TrHa!jWOuMEMCGOM9QoCCTg$|9e5f94bc-e8a4-4e73-b8be-63364c29d753"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$parts = $AccountLine.Trim().Split('|')
$email = $parts[0]
$password = $parts[1]
$refreshToken = $parts[2]
$clientId = $parts[3]

Write-Host "Testing scopes for: $email"

$scopes = @(
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/User.Read",
    "https://outlook.office.com/mail.read",
    "https://outlook.office.com/IMAP.AccessAsUser.All",
    "wl.imap wl.emails",
    ""
)

foreach ($sc in $scopes) {
    Write-Host "`nTesting scope: '$sc'" -ForegroundColor Yellow
    $body = @{
        client_id     = $clientId
        grant_type    = "refresh_token"
        refresh_token = $refreshToken
    }
    if ($sc) {
        $body["scope"] = $sc
    }

    try {
        $res = Invoke-RestMethod -Uri "https://login.microsoftonline.com/consumers/oauth2/v2.0/token" `
            -Method Post `
            -ContentType "application/x-www-form-urlencoded" `
            -Body $body `
            -ErrorAction Stop

        $token = $res.access_token
        Write-Host "Token obtained! (scope returned: $($res.scope))" -ForegroundColor Green

        # Test Graph API with this token
        $headers = @{
            "Authorization" = "Bearer $token"
            "Accept"        = "application/json"
        }

        try {
            $me = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/me" -Headers $headers -Method Get -ErrorAction Stop
            Write-Host "Graph /me SUCCESS! User: $($me.displayName)" -ForegroundColor Green
        } catch {
            Write-Host "Graph /me Failed: $($_.Exception.Message)" -ForegroundColor Red
        }

        try {
            $inbox = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?`$top=2" -Headers $headers -Method Get -ErrorAction Stop
            Write-Host "Graph Inbox SUCCESS! Messages count: $($inbox.value.Count)" -ForegroundColor Green
            if ($inbox.value.Count -gt 0) {
                Write-Host "Subject: $($inbox.value[0].subject)"
            }
        } catch {
            Write-Host "Graph Inbox Failed: $($_.Exception.Message)" -ForegroundColor Red
        }

        # Test Outlook REST API
        try {
            $outlook = Invoke-RestMethod -Uri "https://outlook.office.com/api/v2.0/me/messages?`$top=2" -Headers $headers -Method Get -ErrorAction Stop
            Write-Host "Outlook API SUCCESS! Messages count: $($outlook.value.Count)" -ForegroundColor Green
        } catch {
            Write-Host "Outlook API Failed: $($_.Exception.Message)" -ForegroundColor Red
        }

    } catch {
        Write-Host "Token error: $($_.Exception.Message)" -ForegroundColor Red
    }
}
