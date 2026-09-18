# Bot Figurinha

Bot de WhatsApp (Baileys) que transforma foto, vídeo e GIF em figurinha com o comando `!s`.

## Como usar no WhatsApp

- **Legenda:** mande a foto/vídeo/GIF com `!s` na legenda.
- **Resposta:** responda a uma foto/vídeo/GIF com `!s`.
- **Visualização única:** só funciona respondendo a ela com `!s` **pelo celular**. O WhatsApp não entrega o conteúdo a aparelhos conectados, como o PC e o próprio bot.
- **Desfazer:** responda a uma figurinha com `!s` e ela volta a ser foto/vídeo (em qualidade original, se foi feita por este bot nos últimos 30 dias).

Funciona no privado e em grupos. Outras mensagens são ignoradas.

## Instalar em outro computador

Precisa de **Node.js 20+**, **ffmpeg** e **git**.

### Windows

```bat
winget install OpenJS.NodeJS.LTS Gyan.FFmpeg Git.Git
git clone https://github.com/Sr-PiCINiNi/bot-figurinha.git
cd bot-figurinha
npm install
iniciar-bot.bat
```

Escaneie o QR Code com o celular do número do bot (WhatsApp > Dispositivos conectados > Conectar dispositivo).
Depois, é só abrir pelo `BotFigurinha.exe`.

Para abrir junto com o Windows: `Win+R` → `shell:startup` → crie ali um atalho para o `BotFigurinha.exe`.

### Servidor Linux

```bash
sudo apt install -y ffmpeg git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
git clone https://github.com/Sr-PiCINiNi/bot-figurinha.git
cd bot-figurinha
npm install
npm start
```

Na primeira vez, o QR aparece no terminal. Depois de conectar, rode em segundo plano com reinício automático:

```bash
sudo npm install -g pm2
pm2 start bot.js --name figurinha
pm2 save && pm2 startup
```

## Importante

- **Uma sessão por vez:** não rode o bot em dois lugares com o mesmo número. Na máquina nova você escaneia um QR novo. Na antiga, feche o bot e remova o aparelho em *Dispositivos conectados*.
- **Pastas que nunca vão para o GitHub** (estão no `.gitignore`):
  - `auth/`: sessão do WhatsApp; quem tiver essa pasta controla o número
  - `originais/`: mídias dos usuários
  - `bot.log`: tem números de telefone

## Configurações (início do `bot.js`)

| Constante | Padrão | O que faz |
|---|---|---|
| `AUTORIZADOS` | `[]` | Números que podem usar o bot (vazio = todos) |
| `MAX_SIMULTANEAS` | `2` | Conversões ao mesmo tempo |
| `ORIGINAIS_DIAS` | `30` | Dias que o original fica guardado para o "desfazer" |
| `ORIGINAIS_MAX_MB` | `2000` | Tamanho máximo da pasta `originais/` |

Com `DEBUG=1`, o log interno do Baileys também aparece.
