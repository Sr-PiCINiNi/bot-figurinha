@echo off
rem Gera o BotFigurinha.exe na pasta do bot usando o compilador C# que já vem no Windows.
cd /d "%~dp0"
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /codepage:65001 /target:winexe /optimize ^
  /win32icon:icone.ico /reference:System.Windows.Forms.dll /reference:System.Drawing.dll ^
  /out:..\BotFigurinha.exe BotFigurinha.cs
