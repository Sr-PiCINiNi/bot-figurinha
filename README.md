# 🟢 Bot Figurinha

Transforma fotos, vídeos e GIFs do WhatsApp em figurinhas. As mídias que chegam ao número do bot aparecem num
**painel no computador**, separadas em pastas. **Um clique** faz a figurinha e manda na conversa. Também funciona
direto no WhatsApp com o comando **`!s`**.

**[⬇️ Baixar o instalador para Windows](https://github.com/Sr-PiCINiNi/bot-figurinha/releases/latest)**

---

## 📦 Como instalar (passo a passo)

### Do que você precisa

- Um **computador com Windows 10 ou 11**, que fique ligado enquanto o bot estiver em uso.
- Um **número de WhatsApp só para o bot**, num celular com internet. Use um número secundário: bots não
  oficiais podem ser banidos pelo WhatsApp.

Não precisa instalar mais nada. Tudo o que o bot usa já vem dentro do instalador.

### 1. Baixe o instalador

Entre em **[Releases](https://github.com/Sr-PiCINiNi/bot-figurinha/releases/latest)** e clique no arquivo
**`BotFigurinha-Setup-x.x.x.exe`** (por volta de 60 MB).

### 2. Abra o instalador

Dê dois cliques no arquivo baixado. O Windows pode mostrar um destes avisos:

- **"O Windows protegeu o computador"** (tela azul): clique em **Mais informações** e depois em
  **Executar assim mesmo**.
- **O navegador avisando que o arquivo "não é baixado com frequência"**: clique em **⋯ → Manter**.

Os avisos aparecem porque o instalador não tem assinatura digital, um certificado pago. O código está todo
aqui no GitHub.

### 3. Instale

Clique em **Avançar** e depois em **Instalar**. Não é preciso ser administrador. Você pode marcar:

- ☑️ **Criar atalho na Área de Trabalho**
- ☑️ **Ligar o bot junto com o Windows**, para ele estar sempre ativo

No final, deixe marcado **"Abrir o Bot Figurinha agora"** e clique em **Concluir**.

### 4. Conecte o número do bot

O painel abre sozinho, mostrando um **QR Code**. No **celular do número do bot**:

1. Abra o WhatsApp.
2. Toque em **⋮ (ou Configurações) → Dispositivos conectados → Conectar dispositivo**.
3. Aponte a câmera para o QR Code do painel.

Quando aparecer **🟢 Conectado** no painel, está pronto. Só é preciso fazer isso uma vez.

### 5. Onde o bot fica

O bot roda em segundo plano, com um ícone **perto do relógio** do Windows (se não estiver visível, clique na
setinha **^**). Clique com o **botão direito** no ícone para:

- **Abrir painel**
- **Abrir pasta das mídias**
- **Reiniciar bot**
- **Sair**, que desliga o bot

Para abrir o painel depois, use o atalho **Bot Figurinha** da Área de Trabalho ou do Menu Iniciar.

---

## 🖼️ Como usar

### Pelo painel (no computador)

- As fotos e vídeos que chegam ao número do bot aparecem na hora, separados em pastas:
  - **👁️ Visualização única:** Fotos, Vídeos, Bloqueadas
  - **🖼️ Normais:** Fotos, Vídeos
- **Clique numa mídia** e a figurinha é feita e enviada na conversa de onde ela veio.
- **Busca e filtro** por conversa ficam no topo. **📜 Atividade** mostra o que o bot está fazendo.
- O interruptor **Comando !s** liga ou desliga o comando no WhatsApp.

### Pelo WhatsApp

| O que fazer | Resultado |
|---|---|
| Mandar foto/vídeo/GIF com **`!s`** na legenda | vira figurinha |
| **Responder** a uma foto/vídeo/GIF com **`!s`** | vira figurinha |
| **Responder** a uma figurinha com **`!s`** | volta a ser foto/vídeo (em qualidade original, se foi feita pelo bot) |

Também funcionam `.s`, `/s`, `!fig` e `!sticker`.

### ⚠️ Visualização única

O WhatsApp **não entrega** o conteúdo de visualização única ao bot, nem ao WhatsApp do computador. É uma trava
do próprio WhatsApp. Ela aparece no painel como **🔒 bloqueada**. Para liberar:

- Alguém **responde a ela pelo celular**, com qualquer texto. O card é liberado no painel e é só clicar.
- Ou responde com **`!s`**, e a figurinha já sai na hora.

Quem **enviou** a visualização única não consegue responder a ela. Tem que ser outra pessoa da conversa.

---

## ❓ Dúvidas comuns

<details>
<summary><b>O painel mostra "Conflito de sessão"</b></summary>

Há outra cópia do bot conectada com o mesmo número, em outro computador ou servidor. Feche a outra e clique em
**Reconectar** no painel.
</details>

<details>
<summary><b>Desconectei o bot pelo celular. E agora?</b></summary>

O painel mostra um QR Code novo. É só escanear de novo (passo 4).
</details>

<details>
<summary><b>Onde ficam as fotos e vídeos?</b></summary>

No ícone perto do relógio, clique em **Abrir pasta das mídias**. Elas ficam organizadas em
`Visualizacao unica\Fotos`, `Normais\Videos` etc. As mídias com mais de 30 dias são apagadas automaticamente,
e a pasta nunca passa de 5 GB.
</details>

<details>
<summary><b>Como atualizar para uma versão nova?</b></summary>

Baixe o instalador novo e instale por cima. A conexão com o WhatsApp e as mídias são mantidas.
</details>

<details>
<summary><b>Como desinstalar?</b></summary>

Vá em **Configurações → Aplicativos → Bot Figurinha → Desinstalar**. Ele pergunta se deve apagar também a
conexão e as mídias. Responda **Não** se for reinstalar depois.
</details>

---

## 🛠️ Para desenvolvedores

### Rodar pelo código

Precisa de **Node.js 20+** e **ffmpeg**.

```bat
git clone https://github.com/Sr-PiCINiNi/bot-figurinha.git
cd bot-figurinha
npm install
launcher\compilar.bat
BotFigurinha.exe
```

`iniciar-bot.bat` roda em modo terminal, com o log ao vivo.

### Servidor Linux

```bash
sudo apt install -y ffmpeg git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
git clone https://github.com/Sr-PiCINiNi/bot-figurinha.git && cd bot-figurinha
npm install
sudo npm install -g pm2
PAINEL_SENHA=uma-senha-forte pm2 start bot.js --name figurinha
pm2 save && pm2 startup
```

O painel fica em `127.0.0.1:3777` do servidor. Para acessar do seu PC, use um túnel:
`ssh -L 3777:127.0.0.1:3777 usuario@servidor`.

### Gerar o instalador

```bat
winget install JRSoftware.InnoSetup
instalador\gerar-instalador.bat
```

Mude `version` no `package.json` antes. Na primeira vez, o script baixa o ffmpeg essentials (gyan.dev) e confere
o checksum. O resultado fica em `instalador\dist\`.

### Configurações

| Onde | Constante | Padrão | O que faz |
|---|---|---|---|
| `bot.js` | `MIDIA_DIAS` / `MIDIA_MAX_MB` | `30` / `5000` | Por quanto tempo e até quanto espaço as mídias ficam guardadas |
| `src/whatsapp.js` | `AUTORIZADOS` | `[]` | Números que podem usar o `!s` (vazio = todos) |
| `src/whatsapp.js` | `MAX_AUTO_MB` | `64` | Mídias maiores não são baixadas automaticamente |
| ambiente | `PAINEL_PORTA` / `PAINEL_HOST` / `PAINEL_SENHA` | `3777` / `127.0.0.1` / — | Painel |

Nunca publique as pastas `auth/` (a sessão do WhatsApp: quem tiver essa pasta controla o número), `midia/` e o
`bot.log`. Elas já estão no `.gitignore`.

### Componentes de terceiros

O instalador inclui o [Node.js](https://nodejs.org) (licença MIT) e o
[FFmpeg](https://ffmpeg.org) essentials build de [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (licença GPLv3).
As licenças vão junto, em `runtime\licencas`.
