$env:PATH = 'C:\Users\Admin\AppData\Local\restro-node\node-v22.21.1-win-x64;' + $env:PATH
npm.cmd install --save-exact next@15.5.29 --no-fund
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd install --save-dev --save-exact eslint-config-next@15.5.29 --no-fund
exit $LASTEXITCODE
