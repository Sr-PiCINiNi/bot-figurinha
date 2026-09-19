# Gera instalador\dist\BotFigurinha-Setup-<versão>.exe
# Precisa, só na máquina que gera: Node.js, Inno Setup 6 (winget install JRSoftware.InnoSetup)
# e o ffmpeg essentials em instalador\cache\ffmpeg.exe (baixado automaticamente se faltar).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$raiz = Split-Path $PSScriptRoot -Parent
$cache = Join-Path $PSScriptRoot 'cache'
$app = Join-Path $PSScriptRoot 'build\app'
$versao = (Get-Content (Join-Path $raiz 'package.json') -Raw | ConvertFrom-Json).version

$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
          "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 não encontrado. Instale com: winget install JRSoftware.InnoSetup' }

# ffmpeg essentials (tem libwebp e libx264, que o bot usa), conferindo o checksum publicado
New-Item -ItemType Directory -Force $cache | Out-Null
$ffmpeg = Join-Path $cache 'ffmpeg.exe'
if (-not (Test-Path $ffmpeg)) {
  Write-Host 'Baixando ffmpeg essentials (gyan.dev)...'
  $zip = Join-Path $cache 'ffmpeg-essentials.zip'
  $url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  Invoke-WebRequest -UseBasicParsing $url -OutFile $zip
  $esperado = (Invoke-WebRequest -UseBasicParsing "$url.sha256").Content.Trim().Split(' ')[0]
  if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $esperado) { throw 'Checksum do ffmpeg não confere' }
  $tmp = Join-Path $cache 'ffmpeg-x'
  Expand-Archive $zip -DestinationPath $tmp -Force
  Copy-Item (Get-ChildItem $tmp -Recurse -Filter ffmpeg.exe | Select-Object -First 1).FullName $ffmpeg
  Copy-Item (Get-ChildItem $tmp -Recurse -Filter 'LICENSE*' | Select-Object -First 1).FullName (Join-Path $cache 'ffmpeg-LICENSE.txt')
  Remove-Item $tmp -Recurse -Force
}

Write-Host "Montando Bot Figurinha $versao..."
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
New-Item -ItemType Directory -Force $app, (Join-Path $app 'runtime\licencas') | Out-Null
foreach ($item in 'bot.js', 'package.json', 'package-lock.json', 'README.md', 'iniciar-bot.bat', 'src', 'painel') {
  Copy-Item (Join-Path $raiz $item) $app -Recurse
}
# a bandeja é compilada direto aqui (a da pasta do bot pode estar em uso)
& (Join-Path $raiz 'launcher\compilar.bat') (Join-Path $app 'BotFigurinha.exe')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o BotFigurinha.exe' }
# dependências de produção, instaladas limpas a partir do package-lock
Push-Location $app
npm ci --omit=dev --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm ci falhou' }
Pop-Location

# Node e ffmpeg embutidos (o app procura primeiro em runtime\)
$node = (Get-Command node).Source
Copy-Item $node (Join-Path $app 'runtime\node.exe')
Copy-Item $ffmpeg (Join-Path $app 'runtime\ffmpeg.exe')
# a instalação do Node nem sempre traz o LICENSE; nesse caso, pega o oficial da mesma versão
$licNode = Join-Path $cache "node-$(node -v)-LICENSE.txt"
if (-not (Test-Path $licNode)) {
  Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/nodejs/node/$(node -v)/LICENSE" -OutFile $licNode
}
Copy-Item $licNode (Join-Path $app 'runtime\licencas\node-LICENSE.txt')
Copy-Item (Join-Path $cache 'ffmpeg-LICENSE.txt') (Join-Path $app 'runtime\licencas\ffmpeg-LICENSE.txt')
Set-Content (Join-Path $app 'runtime\licencas\LEIA-ME.txt') -Encoding UTF8 -Value @"
Componentes de terceiros incluídos:
- Node.js $(node -v) (licença MIT) - https://nodejs.org
- FFmpeg essentials build de gyan.dev (licença GPLv3) - https://www.gyan.dev/ffmpeg/builds/
  Código-fonte do FFmpeg: https://ffmpeg.org/download.html
"@

Write-Host 'Gerando o instalador...'
& $iscc /Q "/DVersao=$versao" (Join-Path $PSScriptRoot 'BotFigurinha.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup falhou' }
$saida = Join-Path $PSScriptRoot "dist\BotFigurinha-Setup-$versao.exe"
Write-Host ("Pronto: {0} ({1:N0} MB)" -f $saida, ((Get-Item $saida).Length / 1MB))
