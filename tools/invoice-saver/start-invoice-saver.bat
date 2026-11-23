@echo off
title Gugan Medicals - Invoice Saver
cd /d "%~dp0"
:loop
node saver.mjs
echo Invoice Saver stopped - restarting in 10 seconds...
timeout /t 10 /nobreak >nul
goto loop
