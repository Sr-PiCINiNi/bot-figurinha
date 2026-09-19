; Instalador do Bot Figurinha (Inno Setup 6). Gere com: instalador\gerar-instalador.bat
; Traz Node.js e ffmpeg junto (pasta runtime), então quem instala não precisa de mais nada.
; Instala na pasta do usuário (sem pedir administrador), porque o bot grava ali a sessão e as mídias.

#ifndef Versao
  #define Versao "0.0.0"
#endif

[Setup]
AppId={{E83F7E41-0047-4292-8F9A-EBD9608DF37D}
AppName=Bot Figurinha
AppVersion={#Versao}
AppVerName=Bot Figurinha {#Versao}
AppPublisher=Sr-PiCINiNi
AppPublisherURL=https://github.com/Sr-PiCINiNi/bot-figurinha
DefaultDirName={localappdata}\Programs\Bot Figurinha
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=dist
OutputBaseFilename=BotFigurinha-Setup-{#Versao}
SetupIconFile=..\launcher\icone.ico
UninstallDisplayIcon={app}\BotFigurinha.exe
UninstallDisplayName=Bot Figurinha
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=force

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "atalho"; Description: "Criar atalho na Área de Trabalho"
Name: "iniciarwindows"; Description: "Ligar o bot junto com o Windows (fica perto do relógio)"

[Files]
Source: "build\app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userprograms}\Bot Figurinha"; Filename: "{app}\BotFigurinha.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\Bot Figurinha"; Filename: "{app}\BotFigurinha.exe"; WorkingDir: "{app}"; Tasks: atalho
Name: "{userstartup}\Bot Figurinha"; Filename: "{app}\BotFigurinha.exe"; Parameters: "--minimizado"; WorkingDir: "{app}"; Tasks: iniciarwindows

[Run]
Filename: "{app}\BotFigurinha.exe"; Description: "Abrir o Bot Figurinha agora"; Flags: nowait postinstall skipifsilent

[Code]
// fecha o bot desta instalação (bandeja + node) antes de atualizar ou desinstalar; outras cópias não são tocadas
procedure FecharBot();
var
  Codigo: Integer;
begin
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like ''' +
    ExpandConstant('{app}') + '\*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
    '', SW_HIDE, ewWaitUntilTerminated, Codigo);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  FecharBot();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  FecharBot();
  Result := True;
end;

// a sessão do WhatsApp (auth), as mídias e os logs não são do instalador: pergunta antes de apagar
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if SuppressibleMsgBox('Apagar também a conexão com o WhatsApp e as fotos/vídeos guardados?' + #13#10#13#10 +
        'Escolha "Não" se for instalar de novo (assim não precisa escanear o QR Code outra vez).',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES then
      DelTree(ExpandConstant('{app}'), True, True, True);
  end;
end;
