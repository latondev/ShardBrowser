$settingsPath = Join-Path $env:APPDATA 'shardx-launcher\settings.json'
Write-Host "Settings path: $settingsPath"
if (Test-Path $settingsPath) {
    Write-Host "Settings content:"
    Get-Content $settingsPath -Raw
} else {
    Write-Host "Settings file does not exist."
}

$ports = 40320..40330 + 9222
foreach ($port in $ports) {
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $tcp.BeginConnect('127.0.0.1', $port, $null, $null)
        $wait = $ar.AsyncWaitHandle.WaitOne(300, $false)
        if ($wait -and $tcp.Connected) {
            Write-Host "Port $port is OPEN"
        }
    } catch {
    } finally {
        $tcp.Close()
    }
}
