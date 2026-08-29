param (
    [string]$AccountLine = "LobosElfreda26@hotmail.com|4J4jP51n971c|M.C549_BAY.0.U.-Crrx3kwTlIiZUiOo9l0I3tYWz8pz97*gQa!17KgzucLPLNrbilf2LInoVLQDhSYr!n70le5Phi7RqYmEMdyGVrSq0Qbv3jCwuJ11NHf*pJs6oahcuYrQSBaxNFntlu26UTFxfeum0z9NtVhUAqCXVME*BQuAOSu9orewyAYdLt41Qq*6vrVF75s!NiGYyjlyjykI4PDy2823rCMeUrtbKEFTDAvakYcB5T6ogX8sWR7fxtzhSBAUg1!iha3HEy3yX4Tur8B8lQyzIDhcfn2uixvLx!WR460!QFfH*T4BXAQG70*T6rRZUgHPNMvmcXNPS!D4T9K*XG7M7Y!Bp9DSHFq6rpewypYMw9gEcDMD1u5OFuHfhqe47z7otZCeO9okNI0L1DE*RTsLaeC*zcanUJ25Yr43yy6Cy4Ek*YZhvSGcExglXHKEZeHuzqL87sq4yg$$|9e5f94bc-e8a4-4e73-b8be-63364c29d753|kkzwxyymdyzy@smvmail.com"
)

Add-Type -AssemblyName System.Net.Http
$cookieContainer = New-Object System.Net.CookieContainer
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.CookieContainer = $cookieContainer
$handler.AllowAutoRedirect = $false
$client = New-Object System.Net.Http.HttpClient($handler)
$client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

$loginPageRes = $client.GetAsync("https://login.live.com/login.srf").Result
$loginHtml = $loginPageRes.Content.ReadAsStringAsync().Result

$ppftMatch = [regex]::Match($loginHtml, 'value=\\"([^\\"]+)\\" name=\\"PPFT\\"')
$ppft = $ppftMatch.Groups[1].Value

$postParams = New-Object System.Collections.Generic.Dictionary"[string,string]"
$postParams.Add("login", "LobosElfreda26@hotmail.com")
$postParams.Add("loginfmt", "LobosElfreda26@hotmail.com")
$postParams.Add("type", "11")
$postParams.Add("LoginOptions", "3")
$postParams.Add("passwd", "4J4jP51n971c")
$postParams.Add("PPFT", $ppft)
$postParams.Add("PPSX", "Pass")
$postParams.Add("NewUser", "1")
$postParams.Add("IsFidoSupported", "1")

$content = New-Object System.Net.Http.FormUrlEncodedContent($postParams)
$postRes = $client.PostAsync("https://login.live.com/ppsecure/post.srf", $content).Result
$postHtml = $postRes.Content.ReadAsStringAsync().Result

# Tìm các đoạn text quan trọng trong HTML
$titleMatch = [regex]::Match($postHtml, '<title>([^<]+)</title>')
Write-Host "Title: $($titleMatch.Groups[1].Value)"

# Server data object
$serverDataMatch = [regex]::Match($postHtml, 'sErrTxt:"([^"]*)"')
Write-Host "Error Text: $($serverDataMatch.Groups[1].Value)"

$fDocMatch = [regex]::Match($postHtml, 'urlPost:''([^'']+)''')
Write-Host "Next urlPost: $($fDocMatch.Groups[1].Value)"

$flowMatch = [regex]::Match($postHtml, '"arrProofs":(\[[^\]]*\])')
Write-Host "Proofs: $($flowMatch.Groups[1].Value)"

# In ra các từ khóa nghi vấn
if ($postHtml -match "account\.live\.com\/identity\/confirm") {
    Write-Host "Detected: identity/confirm (Account Locked / Phone verification required)" -ForegroundColor Red
}
if ($postHtml -match "account\.live\.com\/Abuse") {
    Write-Host "Detected: Account Abuse / Suspended" -ForegroundColor Red
}
if ($postHtml -match "proofs") {
    Write-Host "Detected: Proofs / Recovery Email Verification" -ForegroundColor Yellow
}
if ($postHtml -match "kmsi" -or $postHtml -match "Stay signed in") {
    Write-Host "Detected: Stay Signed In (Login SUCCESS!)" -ForegroundColor Green
}

# In 1000 ký tự đầu tiên
Write-Host "`nĐoạn HTML tiêu biểu:"
Write-Host $postHtml.Substring(0, [Math]::Min(1500, $postHtml.Length))
