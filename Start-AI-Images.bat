@echo off
cd /d "%~dp0"
node --env-file=.env.local scripts/start-images.mjs
if errorlevel 1 pause
