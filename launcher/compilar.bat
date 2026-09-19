@echo off
rem Gera o BotFigurinha.exe usando o compilador C# que já vem no Windows.
rem Sem argumento, grava na pasta do bot; com argumento, no caminho indicado (usado pelo instalador).
cd /d "%~dp0"
set SAIDA=%~1
if "%SAIDA%"=="" set SAIDA=..\BotFigurinha.exe
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /codepage:65001 /target:winexe /optimize ^
  /win32icon:icone.ico /reference:System.Windows.Forms.dll /reference:System.Drawing.dll ^
  "/out:%SAIDA%" BotFigurinha.cs
