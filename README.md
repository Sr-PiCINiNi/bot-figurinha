# Bot Figurinha

Bot de WhatsApp (Baileys) com painel gráfico: as fotos, vídeos e GIFs que chegam ao número do bot aparecem
no painel, organizados em pastas. **Um clique faz a figurinha** e manda na conversa de onde a mídia veio.
O comando `!s` continua funcionando direto no WhatsApp.

## Painel

- **Pastas:** *Visualização única* (Fotos, Vídeos, Bloqueadas) e *Normais* (Fotos, Vídeos). No disco ficam em
  `midia/Visualizacao unica/...` e `midia/Normais/...`.
- **Clique na mídia:** o bot faz a figurinha e envia respondendo à mensagem original.
- **Busca e filtro por conversa**, **Atividade** (o log ao vivo) e o **QR Code** para conectar, tudo no painel.
- Endereço: http://127.0.0.1:3777 (só abre neste computador).

### Visualização única

O servidor do WhatsApp **não entrega o conteúdo** de visualização única a aparelhos conectados, como o bot e o
WhatsApp do PC. Ela aparece no painel como card **bloqueado**. Para liberar, alguém precisa **responder a ela
com `!s` pelo celular**: a resposta traz a foto junto, o bot faz a figurinha e o card é preenchido.

## Comandos no WhatsApp

- **Legenda:** foto/vídeo/GIF com `!s` na legenda.
- **Resposta:** responda a uma foto/vídeo/GIF (inclusive visualização única, pelo celular) com `!s`.
- **Desfazer:** responda a uma figurinha com `!s` e ela volta a ser foto/vídeo, em qualidade original se foi feita
  por este bot.

## Instalar em outro computador

Precisa de **Node.js 20+**, **ffmpeg** e **git**.

### Windows

```bat
winget install OpenJS.NodeJS.LTS Gyan.FFmpeg Git.Git
git clone https://github.com/Sr-PiCINiNi/bot-figurinha.git
cd bot-figurinha
npm install
launcher\compilar.bat
```

Abra o **`BotFigurinha.exe`**. O bot roda escondido, com um ícone na bandeja (perto do relógio), e o painel abre
numa janela própria. Escaneie o QR Code que aparece no painel com o celular do número do bot (WhatsApp >
Dispositivos conectados > Conectar dispositivo).

- **Ícone da bandeja** (botão direito): Abrir painel, Abrir pasta das mídias, Reiniciar bot, Sair. Se o bot cair,
  ele é religado sozinho.
- **Iniciar com o Windows:** `Win+R` → `shell:startup` → crie um atalho para `BotFigurinha.exe --minimizado`.
- **Modo terminal**, para ver o log ao vivo: `iniciar-bot.bat`.

### Servidor Linux

```bash
sudo apt install -y ffmpeg git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
git clone https://github.com/Sr-PiCINiNi/bot-figurinha.git
cd bot-figurinha
npm install
sudo npm install -g pm2
PAINEL_SENHA=uma-senha-forte pm2 start bot.js --name figurinha
pm2 save && pm2 startup
```

O painel fica em `127.0.0.1:3777` do servidor. Para acessar do seu PC, use um túnel SSH:
`ssh -L 3777:127.0.0.1:3777 usuario@servidor` e abra http://127.0.0.1:3777. Se abrir para a rede com
`PAINEL_HOST=0.0.0.0`, defina `PAINEL_SENHA`.

## Importante

- **Uma cópia por vez:** o bot não roda duas vezes no mesmo computador. Mas duas máquinas com o mesmo número
  se derrubam (erro 440). Nesse caso o painel mostra "Conflito de sessão": feche a outra cópia e clique em
  **Reconectar**.
- **Pastas que nunca vão para o GitHub** (estão no `.gitignore`):
  - `auth/`: sessão do WhatsApp; quem tiver essa pasta controla o número
  - `midia/`: mídias recebidas
  - `bot.log`: tem números de telefone

## Configurações

| Onde | Constante | Padrão | O que faz |
|---|---|---|---|
| `bot.js` | `MIDIA_DIAS` | `30` | Dias que as mídias ficam guardadas |
| `bot.js` | `MIDIA_MAX_MB` | `5000` | Tamanho máximo da pasta `midia/` (as mais antigas saem primeiro) |
| `src/whatsapp.js` | `AUTORIZADOS` | `[]` | Números que podem usar o `!s` (vazio = todos) |
| `src/whatsapp.js` | `MAX_AUTO_MB` | `64` | Mídias maiores não são baixadas automaticamente |
| variável de ambiente | `PAINEL_PORTA` / `PAINEL_HOST` / `PAINEL_SENHA` | `3777` / `127.0.0.1` / — | Painel |

Com `DEBUG=1`, o log interno do Baileys também aparece.
