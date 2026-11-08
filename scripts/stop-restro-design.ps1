$ErrorActionPreference = 'Stop'
$listener = Get-NetTCPConnection -LocalPort 3847 -State Listen -ErrorAction SilentlyContinue
if ($listener) { $listener | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ } }
