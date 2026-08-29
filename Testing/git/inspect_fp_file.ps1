$fpDir = Join-Path $env:APPDATA 'shardx-launcher\fingerprints'
$fpFile = Get-ChildItem -Path $fpDir -Filter "*.json" | Select-Object -First 1
if ($fpFile) {
    Write-Host "File name:" $fpFile.Name
    $content = Get-Content $fpFile.FullName -Raw | ConvertFrom-Json
    Write-Host "Top level keys:" ($content | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name)
    if ($content.payload) {
        Write-Host "Payload keys:" ($content.payload | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name)
    }
}
