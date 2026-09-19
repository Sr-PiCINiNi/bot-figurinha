@echo off
chcp 65001 >nul
title Bot Figurinha (modo terminal)
cd /d "%~dp0"
rem Modo terminal, para ver o log ao vivo. No dia a dia use o BotFigurinha.exe (roda na bandeja).
rem Reinicia o bot sozinho se ele cair. Para parar de vez, feche esta janela.
rem usa o Node que vem com o instalador, se existir
set NODE=node
if exist "runtime\node.exe" set NODE="runtime\node.exe"
:loop
%NODE% bot.js
if %errorlevel%==3 (
  echo.
  echo O bot ja esta rodando ^(provavelmente pelo BotFigurinha.exe, na bandeja^). Painel: http://127.0.0.1:3777
  pause
  exit /b
)
echo.
echo [%date% %time%] Bot parou (codigo %errorlevel%). Reiniciando em 10 segundos...
timeout /t 10 /nobreak >nul
goto loop
