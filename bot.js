// Bot de figurinhas: só age com !s (no grupo e no privado) — na legenda da foto/vídeo/GIF ou respondendo a ela.
// Visualização única não chega em aparelho conectado (limitação do WhatsApp): para ela, responda
// à mensagem com !s pelo celular — a resposta leva uma cópia da mídia que dá para baixar.
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  normalizeMessageContent,
  Browsers,
} from 'baileys'
import qrcode from 'qrcode-terminal'
import sharp from 'sharp'
import pino from 'pino'
import { execFile, execFileSync } from 'node:child_process'
import { promisify, format } from 'node:util'
import { mkdtemp, mkdir, readdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendFileSync, renameSync } from 'node:fs'

// tudo que aparece na tela também vai para bot.log
for (const name of ['log', 'error']) {
  const original = console[name].bind(console)
  console[name] = (...args) => {
    original(...args)
    try { appendFileSync('bot.log', format(...args) + '\n') } catch {}
  }
}

const run = promisify(execFile)
const MAX_BYTES = 490_000 // WhatsApp aceita até ~500 KB em figurinha animada
const MAX_BYTES_STATIC = 100_000 // e até 100 KB em figurinha estática
const MAX_SECONDS = 10
// fps e qualidade testados em ordem até o arquivo caber no limite
const ATTEMPTS = [[15, 50], [12, 40], [10, 30], [10, 20], [8, 15], [6, 10], [5, 5]]
const STATIC_QUALITIES = [90, 75, 60, 45, 30, 15]
const FIT_512 = 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,' +
                'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000'

function findFfmpeg() {
  try {
    return execFileSync('where', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
  } catch {
    return 'ffmpeg'
  }
}
const FFMPEG = findFfmpeg()

async function videoToSticker(input, dir) {
  const out = path.join(dir, 'sticker.webp')
  for (const [fps, quality] of ATTEMPTS) {
    await run(FFMPEG, [
      '-y', '-v', 'error', '-i', input, '-t', String(MAX_SECONDS), '-an',
      '-vf', `fps=${fps},${FIT_512}`,
      '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '3', '-loop', '0',
      out,
    ])
    const { size } = await stat(out)
    console.log(`  fps=${fps} qualidade=${quality} -> ${(size / 1024).toFixed(0)} KB`)
    if (size <= MAX_BYTES) return readFile(out)
  }
  throw new Error('não consegui deixar a figurinha abaixo de 500 KB')
}

async function imageToSticker(input, dir) {
  const out = path.join(dir, 'sticker.webp')
  for (const quality of STATIC_QUALITIES) {
    await run(FFMPEG, [
      '-y', '-v', 'error', '-i', input, '-frames:v', '1', '-vf', FIT_512,
      '-c:v', 'libwebp', '-quality', String(quality), out,
    ])
    const { size } = await stat(out)
    console.log(`  qualidade=${quality} -> ${(size / 1024).toFixed(0)} KB`)
    if (size <= MAX_BYTES_STATIC) return readFile(out)
  }
  throw new Error('não consegui deixar a figurinha abaixo de 100 KB')
}

// figurinha -> foto (estática) ou vídeo (animada), para editar e mandar de novo.
// O ffmpeg não lê WebP animado, então o sharp tira os quadros para um GIF primeiro.
// Fundo transparente vira branco (foto/vídeo do WhatsApp não têm transparência).
async function stickerToMedia(buffer, dir) {
  const { pages = 1 } = await sharp(buffer, { animated: true }).metadata()
  if (pages <= 1) {
    // corta as bordas transparentes que deixam a figurinha quadrada (se falhar, usa a imagem inteira)
    const trimmed = await sharp(buffer).trim().toBuffer().catch(() => buffer)
    const image = await sharp(trimmed).flatten({ background: '#ffffff' }).jpeg({ quality: 95 }).toBuffer()
    return { image }
  }
  const gif = path.join(dir, 'sticker.gif')
  const out = path.join(dir, 'video.mp4')
  await sharp(buffer, { animated: true }).gif().toFile(gif)
  await run(FFMPEG, [
    '-y', '-v', 'error', '-i', gif,
    '-filter_complex', '[0]format=rgba,split[a][b];[a]drawbox=c=white:t=fill[bg];[bg][b]overlay,' +
                       'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
    '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', out,
  ])
  return { video: await readFile(out) }
}

// DEBUG=1 também liga os logs internos do Baileys
const DEBUG = !!process.env.DEBUG
// números que podem usar o bot (só dígitos, com DDI). Vazio = qualquer um (o log mostra quem mandou)
const AUTORIZADOS = []
// quantas conversões rodam ao mesmo tempo (o resto espera na fila)
const MAX_SIMULTANEAS = 2
// guarda a foto/vídeo original de cada figurinha para o !s devolver sem perda de qualidade.
// Arquivo = hash da figurinha (o fileSha256 do WhatsApp, que não muda ao encaminhar).
const ORIGINAIS_DIR = 'originais'
const ORIGINAIS_DIAS = 30 // apaga originais mais velhos que isso
const ORIGINAIS_MAX_MB = 2000 // e os mais antigos se a pasta passar disso

async function saveOriginal(stickerHash, buffer, mimetype) {
  if (!stickerHash?.length) return
  const name = Buffer.from(stickerHash).toString('hex')
  await mkdir(ORIGINAIS_DIR, { recursive: true })
  await writeFile(path.join(ORIGINAIS_DIR, `${name}.bin`), buffer)
  await writeFile(path.join(ORIGINAIS_DIR, `${name}.json`), JSON.stringify({ mimetype }))
}

async function loadOriginal(stickerHash) {
  if (!stickerHash?.length) return null
  const base = path.join(ORIGINAIS_DIR, Buffer.from(stickerHash).toString('hex'))
  try {
    const { mimetype } = JSON.parse(await readFile(`${base}.json`, 'utf8'))
    return { buffer: await readFile(`${base}.bin`), mimetype }
  } catch {
    return null
  }
}

async function pruneOriginals() {
  let files
  try { files = await readdir(ORIGINAIS_DIR) } catch { return }
  const entries = []
  for (const f of files.filter(f => f.endsWith('.bin'))) {
    const s = await stat(path.join(ORIGINAIS_DIR, f)).catch(() => null)
    if (s) entries.push({ base: f.slice(0, -4), size: s.size, mtime: s.mtimeMs })
  }
  entries.sort((a, b) => b.mtime - a.mtime) // mais novos primeiro
  const limit = Date.now() - ORIGINAIS_DIAS * 86_400_000
  let total = 0
  let removed = 0
  for (const e of entries) {
    total += e.size
    if (e.mtime < limit || total > ORIGINAIS_MAX_MB * 1_048_576) {
      await rm(path.join(ORIGINAIS_DIR, `${e.base}.bin`), { force: true })
      await rm(path.join(ORIGINAIS_DIR, `${e.base}.json`), { force: true })
      removed++
    }
  }
  if (removed) log(`🧹 ${removed} originais antigos apagados`)
}

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString()}]`, ...args)
}

// devolve { media, animated } para foto/vídeo/GIF (também enviados como documento)
function getMedia(m) {
  if (!m) return null
  if (m.videoMessage) return { media: m.videoMessage, animated: true }
  if (m.imageMessage) return { media: m.imageMessage, animated: false }
  const mime = m.documentMessage?.mimetype ?? ''
  if (mime === 'image/gif' || mime.startsWith('video/')) return { media: m.documentMessage, animated: true }
  if (mime.startsWith('image/')) return { media: m.documentMessage, animated: false }
  return null
}

// "!s", ".s", "/s", "!fig", "!sticker" (no texto ou na legenda)
const COMANDO = /^[!./](s|fig|figurinha|sticker)(\s|$)/i

function getText(m) {
  if (!m) return ''
  return m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ??
    m.videoMessage?.caption ?? m.documentMessage?.caption ?? ''
}

// contextInfo fica dentro do tipo da mensagem (extendedTextMessage, imageMessage, ...)
function getContextInfo(m) {
  if (!m) return null
  for (const value of Object.values(m)) {
    if (value?.contextInfo) return value.contextInfo
  }
  return null
}

let running = 0
const waiting = []
async function withSlot(fn) {
  if (running >= MAX_SIMULTANEAS) await new Promise(resolve => waiting.push(resolve))
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

function digits(jid) {
  return jid ? jidNormalizedUser(jid).split('@')[0].replace(/\D/g, '') : ''
}

function toSeconds(ts) {
  return Number(ts?.toNumber?.() ?? ts)
}

const startedAt = Math.floor(Date.now() / 1000)
let failures = 0

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({
      level: 'debug',
      hooks: {
        logMethod(args, method) {
          // o WhatsApp não entrega o conteúdo de "visualização única" para aparelhos conectados
          if (String(args[0]?.unavailableType ?? '').startsWith('view_once') && DEBUG) {
            log(`👁️ O WhatsApp não entregou o conteúdo de uma visualização única (${args[0].unavailableType})`)
          }
          if (DEBUG) method.apply(this, args)
        },
      },
    }),
    // registra o aparelho como Desktop (Windows). Foi uma tentativa de receber visualização única que não
    // funcionou, mas a sessão atual foi pareada assim. syncFullHistory precisa ficar false (o padrão do
    // Baileys é true): com ele o login vira "app desktop" e o WhatsApp recusa (erro 428).
    // Trocar isto exige parear de novo (apagar a pasta auth e escanear o QR).
    browser: Browsers.windows('Desktop'),
    syncFullHistory: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.clear()
      console.log('Escaneie o QR Code: WhatsApp > Configurações > Dispositivos conectados > Conectar dispositivo\n')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'open') {
      failures = 0
      log('✅ Conectado! Só com !s: na legenda ou respondendo a foto/vídeo/GIF/figurinha.')
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        // guarda a sessão morta e sai; o iniciar-bot.bat reinicia e mostra um QR novo
        const old = `auth-expirado-${Date.now()}`
        try { renameSync('auth', old) } catch {}
        log(`Sessão encerrada no celular (pasta antiga em ${old}). Reiniciando para gerar outro QR...`)
        process.exit(1)
      }
      // espera cada vez mais entre tentativas (até 1 min) para não martelar o servidor
      const wait = Math.min(60, 2 ** failures++)
      log(`Conexão caiu (código ${code ?? '?'}: ${lastDisconnect?.error?.message ?? 'sem detalhe'}), ` +
          `reconectando em ${wait}s...`)
      setTimeout(start, wait * 1000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      const jid = msg.key.remoteJid
      const content = normalizeMessageContent(msg.message)
      const kinds = content ? Object.keys(content).join(',') : '(sem conteúdo)'
      const ts = toSeconds(msg.messageTimestamp)
      // sincronização/controle interno do WhatsApp: não é mensagem de ninguém
      if (content?.protocolMessage) continue
      if (jid === 'status@broadcast') continue
      const isGroup = jid.endsWith('@g.us')
      const isCommand = COMANDO.test(getText(content).trim())
      // só age com o comando (!s), no grupo e no privado. Vale também para o !s digitado no celular
      // do bot (útil para responder uma visualização única de um usuário e mostrar como funciona)
      if (!isCommand) continue
      log(`📩 comando ${isGroup ? 'no grupo' : 'no privado'} chat=${jid}` +
          `${msg.key.remoteJidAlt ? ` alt=${msg.key.remoteJidAlt}` : ''} fromMe=${msg.key.fromMe} tipo=${kinds}`)

      if (!msg.key.fromMe) {
        const sender = [msg.key.participant, msg.key.participantAlt, jid, msg.key.remoteJidAlt, msg.key.senderPn]
          .filter(j => j && !j.endsWith('@g.us'))
        if (AUTORIZADOS.length && !sender.some(j => AUTORIZADOS.includes(digits(j)))) {
          log(`   ↳ ignorada: remetente não autorizado (${sender.join(' / ')})`)
          continue
        }
      }
      if (ts < startedAt) { log(`   ↳ ignorada: mensagem antiga (${ts} < início ${startedAt})`); continue }
      let media = content
      let found = getMedia(content)
      // truque do "!s"/"!reveal": ao responder uma mídia (inclusive visualização única), a resposta leva
      // uma cópia da mensagem citada com a chave da mídia — dá para baixar por ela
      const quoted = normalizeMessageContent(getContextInfo(content)?.quotedMessage)
      // !s respondendo uma figurinha: desfaz a figurinha em foto/vídeo
      if (!found && quoted?.stickerMessage) {
        const st = quoted.stickerMessage
        if (st.isLottie || st.mimetype === 'application/was') {
          await sock.sendMessage(jid, { text: 'Essa figurinha é do tipo Lottie, não consigo desfazer 😕' },
            { quoted: msg }).catch(() => {})
        } else if (!st.mediaKey?.length || !(st.url || st.directPath)) {
          log('   ↳ resposta a figurinha, mas a cópia citada veio SEM a chave da mídia')
          await sock.sendMessage(jid, { text: 'Não veio a figurinha junto com a resposta 😕 Tente de novo.' },
            { quoted: msg }).catch(() => {})
        } else {
          handleSticker(sock, msg, quoted).catch(err => console.error('❌ Erro não tratado:', err))
        }
        continue
      }
      if (!found && quoted) {
        const q = getMedia(quoted)
        const qKinds = Object.keys(quoted).join(',')
        if (!q) {
          log(`   ↳ resposta a uma mensagem sem mídia (citada: ${qKinds})`)
        } else if (!q.media.mediaKey?.length || !(q.media.url || q.media.directPath)) {
          log(`   ↳ resposta a mídia (${qKinds}), mas a cópia citada veio SEM a chave/endereço da mídia ` +
              `(mediaKey=${!!q.media.mediaKey?.length} url=${!!q.media.url} directPath=${!!q.media.directPath})`)
          await sock.sendMessage(jid, { text: 'Não veio a mídia junto com a resposta 😕 Tente de novo pelo celular.' },
            { quoted: msg }).catch(() => {})
          continue
        } else {
          log(`   ↳ resposta a mídia citada (${qKinds}, viewOnce=${!!q.media.viewOnce}) — usando a cópia citada`)
          media = quoted
          found = q
        }
      }
      if (!found) {
        await sock.sendMessage(jid, { text: 'Responda com *!s* a uma foto, vídeo ou GIF para virar figurinha, ' +
          'ou a uma figurinha para ela voltar a ser foto/vídeo 😉' }, { quoted: msg }).catch(() => {})
        continue
      }
      // não segura o loop: cada mídia é convertida em paralelo (limitado por MAX_SIMULTANEAS)
      handleMedia(sock, msg, media, found).catch(err => console.error('❌ Erro não tratado:', err))
    }
  })
}

async function handleMedia(sock, msg, content, { media: v, animated }) {
  const jid = msg.key.remoteJid
  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {})
  log(`${animated ? '🎬' : '🖼️'} Mídia aceita de ${msg.key.remoteJidAlt ?? jid} (${v.mimetype}, ` +
      `${animated ? `${v.seconds ?? '?'}s, ` : ''}${v.fileLength ?? '?'} bytes)` +
      (running >= MAX_SIMULTANEAS ? ` — na fila (${waiting.length + 1} esperando)` : ''))

  await withSlot(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'figurinha-'))
    try {
      const buffer = await downloadMediaMessage({ ...msg, message: content }, 'buffer', {},
        { logger: sock.logger, reuploadRequest: sock.updateMediaMessage })
      log(`   baixado: ${(buffer.length / 1024).toFixed(0)} KB — convertendo...`)
      const input = path.join(dir, animated ? 'input.mp4' : 'input.img')
      await writeFile(input, buffer)
      const sticker = animated ? await videoToSticker(input, dir) : await imageToSticker(input, dir)
      log('   enviando figurinha...')
      const sent = await sock.sendMessage(jid, { sticker, isAnimated: animated }, { quoted: msg })
      await saveOriginal(sent?.message?.stickerMessage?.fileSha256, buffer, v.mimetype)
        .catch(err => log(`   ⚠️ não consegui guardar o original: ${err.message}`))
      await sock.sendMessage(jid, { react: { text: '', key: msg.key } }).catch(() => {})
      log(`✅ Figurinha enviada para ${msg.key.remoteJidAlt ?? jid}
`)
    } catch (err) {
      console.error('❌ Erro:', err.stderr?.trim() || err.message)
      if (DEBUG) console.error(err)
      await sock.sendMessage(jid, { text: `Não consegui fazer a figurinha: ${err.message}` }, { quoted: msg })
        .catch(() => {})
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

async function handleSticker(sock, msg, quoted) {
  const jid = msg.key.remoteJid
  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {})
  log(`🔄 Desfazendo figurinha de ${msg.key.participantAlt ?? msg.key.remoteJidAlt ?? jid}` +
      ` (${quoted.stickerMessage.isAnimated ? 'animada' : 'estática'})`)

  await withSlot(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'figurinha-'))
    try {
      // figurinha feita por este bot: devolve o arquivo original, sem perda de qualidade
      const original = await loadOriginal(quoted.stickerMessage.fileSha256)
      if (original) {
        const { buffer, mimetype } = original
        const content = mimetype.startsWith('video/') ? { video: buffer, mimetype }
          : mimetype === 'image/gif' ? { document: buffer, mimetype, fileName: 'original.gif' }
          : mimetype.startsWith('image/') ? { image: buffer, mimetype }
          : { document: buffer, mimetype, fileName: 'original' }
        await sock.sendMessage(jid, content, { quoted: msg })
        await sock.sendMessage(jid, { react: { text: '', key: msg.key } }).catch(() => {})
        log(`✅ Original devolvido em qualidade total (${mimetype}, ${(buffer.length / 1024).toFixed(0)} KB)\n`)
        return
      }
      // figurinha de fora: reconverte a partir da própria figurinha (perde qualidade)
      log('   original não guardado — reconvertendo a figurinha')
      const buffer = await downloadMediaMessage({ key: msg.key, message: quoted }, 'buffer', {},
        { logger: sock.logger, reuploadRequest: sock.updateMediaMessage })
      const result = await stickerToMedia(buffer, dir)
      await sock.sendMessage(jid, result.video ? { video: result.video, mimetype: 'video/mp4' } : { image: result.image },
        { quoted: msg })
      await sock.sendMessage(jid, { react: { text: '', key: msg.key } }).catch(() => {})
      log(`✅ Figurinha desfeita em ${result.video ? 'vídeo' : 'foto'}\n`)
    } catch (err) {
      console.error('❌ Erro:', err.stderr?.trim() || err.message)
      if (DEBUG) console.error(err)
      await sock.sendMessage(jid, { text: `Não consegui desfazer a figurinha: ${err.message}` }, { quoted: msg })
        .catch(() => {})
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

process.on('unhandledRejection', err => console.error('❌ Erro não tratado:', err))
// erro grave: sai para o iniciar-bot.bat reiniciar do zero
process.on('uncaughtException', err => {
  console.error('💥 Erro grave, reiniciando:', err)
  process.exit(1)
})

log(`Iniciando... ffmpeg: ${FFMPEG}${DEBUG ? ' | DEBUG ligado' : ''}`)
pruneOriginals()
setInterval(pruneOriginals, 6 * 3_600_000)
start()
