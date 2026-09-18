@echo off
chcp 65001 >nul
title Bot Figurinha
cd /d "%~dp0"
rem Reinicia o bot sozinho se ele cair. Para parar de vez, feche esta janela.
:loop
node bot.js
echo.
echo [%date% %time%] Bot parou (codigo %errorlevel%). Reiniciando em 10 segundos...
timeout /t 10 /nobreak >nul
goto loop
