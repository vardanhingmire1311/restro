@echo off
cd /d %~dp0
set PATH=C:\Users\Admin\AppData\Local\restro-node\node-v22.21.1-win-x64;%PATH%
node scripts\dev.mjs 1>>restro.out.log 2>>restro.err.log
