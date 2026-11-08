$env:PATH = 'C:\Users\Admin\AppData\Local\restro-node\node-v22.21.1-win-x64;' + $env:PATH
node scripts/test-design-db.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd run build
exit $LASTEXITCODE
