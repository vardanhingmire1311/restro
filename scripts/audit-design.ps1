$env:PATH = 'C:\Users\Admin\AppData\Local\restro-node\node-v22.21.1-win-x64;' + $env:PATH
npm.cmd audit --json | Out-File -Encoding UTF8 design-audit.json
