$env:PATH = 'C:\Users\Admin\AppData\Local\restro-node\node-v22.21.1-win-x64;' + $env:PATH
New-Item -ItemType Directory -Force 'C:\Users\Admin\AppData\Local\restro-design-tools' | Out-Null
npm.cmd install --prefix 'C:\Users\Admin\AppData\Local\restro-design-tools' --no-audit --no-fund playwright
