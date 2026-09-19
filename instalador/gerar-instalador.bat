@echo off
rem Gera instalador\dist\BotFigurinha-Setup-<versao>.exe (veja gerar-instalador.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gerar-instalador.ps1"
pause
