Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
$res = $client.GetStringAsync("https://login.live.com/login.srf").Result
Write-Host "Response length: $($res.Length)"
$matches = [regex]::Matches($res, 'PPFT|sFTTag|flowToken|sFT')
foreach ($m in $matches) {
    Write-Host "Found match: $($m.Value)"
}
# Output first 1000 characters and around matches
$idx = $res.IndexOf("PPFT")
if ($idx -ge 0) {
    $start = [Math]::Max(0, $idx - 100)
    $len = [Math]::Min(300, $res.Length - $start)
    Write-Host "Context near PPFT: $($res.Substring($start, $len))"
} else {
    $idx2 = $res.IndexOf("sFTTag")
    if ($idx2 -ge 0) {
        $start = [Math]::Max(0, $idx2 - 100)
        $len = [Math]::Min(300, $res.Length - $start)
        Write-Host "Context near sFTTag: $($res.Substring($start, $len))"
    } else {
        Write-Host "First 500 chars: $($res.Substring(0, [Math]::Min(500, $res.Length)))"
    }
}
