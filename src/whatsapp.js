// Conexão com o WhatsApp (Baileys): recebe mídias para o painel e atende o comando !s.
//
// Visualização única não chega em aparelho conectado (limitação do servidor do WhatsApp): ela entra no
// painel como card bloqueado. Quando alguém responde a ela com !s pelo celular, a resposta traz uma cópia
// da mídia com a chave de download, e o card é preenchido.
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  normalizeMessageContent,
  Browsers,
  BufferJSON,
} from 'baileys'
import pino from 'pino'
import qrcodeTerminal from 'qrcode-terminal'
import { EventEmitter } from 'node:events'
import { randomInt } from 'node:crypto'
import { readFile, renameSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { log, logErro } from './log.js'
import { mediaToSticker, stickerToMedia } from './sticker.js'
import * as store from './store.js'
import { config } from './config.js'
import * as usuarios from './usuarios.js'

const lerArquivo = promisify(readFile)

// ---- configuração ----
const DEBUG = !!process.env.DEBUG
// quantas conversões/downloads rodam ao mesmo tempo (o resto espera na fila)
const MAX_SIMULTANEAS = 2
// !s enviado com o bot desligado ainda é atendido se tiver até isto de atraso
const ATRASO_MAX_COMANDO = 10 * 60
// mídias maiores que isto não são baixadas automaticamente para o painel
const MAX_AUTO_MB = 64
// "!s", ".s", "/s", "!fig", "!sticker" (no texto ou na legenda)
const COMANDO = /^[!./](s|fig|figurinha|sticker)(\s|$)/i
// comandos de sorteio: !moeda (cara ou coroa) e !d20 (1 a 20)
const JOGO = /^[!./](moeda|d20)\s*$/i

export const wa = new EventEmitter()
export const estado = { status: 'iniciando', qr: null, eu: null, detalhe: '' }
let sock = null
const startedAt = Math.floor(Date.now() / 1000)
let falhas = 0
let conflitos = 0
let tentativaTimer = null

function mudarEstado(patch) {
  Object.assign(estado, patch)
  wa.emit('estado', { ...estado })
}

// ---- utilidades de mensagem ----

// devolve { media, animada } para foto/vídeo/GIF (também enviados como documento)
function getMedia(m) {
  if (!m) return null
  if (m.videoMessage) return { media: m.videoMessage, animada: true, gif: !!m.videoMessage.gifPlayback }
  if (m.imageMessage) return { media: m.imageMessage, animada: false }
  const mime = m.documentMessage?.mimetype ?? ''
  if (mime === 'image/gif' || mime.startsWith('video/')) return { media: m.documentMessage, animada: true, gif: mime === 'image/gif' }
  if (mime.startsWith('image/')) return { media: m.documentMessage, animada: false }
  return null
}

function temChave(media) {
  return !!media?.mediaKey?.length && !!(media.url || media.directPath)
}

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

function ehVisualizacaoUnica(raw, media) {
  return !!(media?.viewOnce || raw?.viewOnceMessage || raw?.viewOnceMessageV2 || raw?.viewOnceMessageV2Extension)
}

function digits(jid) {
  return jid ? jidNormalizedUser(jid).split('@')[0].replace(/\D/g, '') : ''
}

function toSeconds(ts) {
  return Number(ts?.toNumber?.() ?? ts)
}

function toNumber(v) {
  return Number(v?.toNumber?.() ?? v ?? 0)
}

function extensao(mimetype, animada) {
  const sub = (mimetype ?? '').split('/')[1]?.split(';')[0]
  if (sub === 'jpeg') return 'jpg'
  if (sub && /^[a-z0-9]+$/.test(sub)) return sub
  return animada ? 'mp4' : 'jpg'
}

// o número de quem mandou (em grupo é o participante), preferindo o formato de telefone
function remetenteDe(key) {
  const opcoes = [key.participantAlt, key.participant, key.remoteJidAlt, key.remoteJid].filter(Boolean)
  return opcoes.find(j => j.endsWith('@s.whatsapp.net')) ?? opcoes.find(j => !j.endsWith('@g.us')) ?? ''
}

function serializar(msg) {
  return JSON.stringify({ key: msg.key, message: msg.message, messageTimestamp: msg.messageTimestamp },
    BufferJSON.replacer)
}

function desserializar(texto) {
  return texto ? JSON.parse(texto, BufferJSON.reviver) : null
}

const nomesDeGrupo = new Map()
async function nomeDoGrupo(jid) {
  if (nomesDeGrupo.has(jid)) return nomesDeGrupo.get(jid)
  let nome = 'Grupo'
  try {
    nome = (await sock.groupMetadata(jid)).subject || nome
  } catch {}
  nomesDeGrupo.set(jid, nome)
  return nome
}

// ---- fila: no máximo MAX_SIMULTANEAS conversões ao mesmo tempo ----
let rodando = 0
const esperando = []
async function naFila(fn) {
  if (rodando >= MAX_SIMULTANEAS) await new Promise(resolve => esperando.push(resolve))
  rodando++
  try {
    return await fn()
  } finally {
    rodando--
    esperando.shift()?.()
  }
}

// ---- conexão ----

export async function iniciarWhatsApp() {
  clearTimeout(tentativaTimer)
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))
  const atual = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: DEBUG ? 'debug' : 'silent' }),
    // registra o aparelho como Desktop (Windows); a sessão atual foi pareada assim. syncFullHistory
    // precisa ficar false (o padrão do Baileys é true): com ele o WhatsApp recusa o login (erro 428).
    browser: Browsers.windows('Desktop'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  })
  sock = atual

  atual.ev.on('creds.update', saveCreds)

  atual.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (sock !== atual) return // evento de uma conexão antiga
    if (qr) {
      mudarEstado({ status: 'qr', qr, detalhe: 'Escaneie o QR Code com o celular do bot' })
      if (process.stdout.isTTY) qrcodeTerminal.generate(qr, { small: true })
    }
    if (connection === 'open') {
      falhas = 0
      const eu = { id: atual.user?.id, nome: atual.user?.name ?? '', numero: digits(atual.user?.id) }
      mudarEstado({ status: 'conectado', qr: null, eu, detalhe: '' })
      log(`✅ Conectado como ${eu.nome || eu.numero}`)
      // conflito só zera depois de ficar 1 min conectado sem ser derrubado
      setTimeout(() => { if (sock === atual && estado.status === 'conectado') conflitos = 0 }, 60_000)
    }
    if (connection === 'close') tratarQueda(lastDisconnect)
  })

  // confirmações de entrega das figurinhas (privado: messages.update; grupo: recibo de cada participante)
  atual.ev.on('messages.update', updates => {
    for (const { key, update } of updates) if (key.fromMe) registrarEntrega(key.id, update.status)
  })
  atual.ev.on('message-receipt.update', recibos => {
    for (const { key, receipt } of recibos) {
      if (!key.fromMe) continue
      registrarEntrega(key.id, receipt.readTimestamp ? 4 : receipt.receiptTimestamp ? 3 : null)
    }
  })

  atual.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      try {
        await tratarMensagem(msg, type)
      } catch (err) {
        logErro('Erro ao tratar mensagem:', err.stack ?? err.message)
      }
    }
  })
}

function tratarQueda(lastDisconnect) {
  const code = lastDisconnect?.error?.output?.statusCode
  const motivo = lastDisconnect?.error?.message ?? 'sem detalhe'

  if (code === DisconnectReason.loggedOut) {
    // sessão removida no celular: guarda a pasta antiga e pede um QR novo
    const antiga = `auth-expirado-${Date.now()}`
    try { renameSync('auth', antiga) } catch {}
    log(`Sessão encerrada no celular (pasta antiga em ${antiga}). Gerando QR novo...`)
    mudarEstado({ status: 'reconectando', eu: null, detalhe: 'Sessão encerrada no celular — gerando QR novo' })
    tentativaTimer = setTimeout(iniciarWhatsApp, 2000)
    return
  }

  if (code === DisconnectReason.connectionReplaced) {
    // 440: outra cópia do bot conectou com a mesma sessão; ficar tentando só faz as duas se derrubarem
    conflitos++
    if (conflitos >= 3) {
      logErro('⚠️ Outra cópia do bot está usando esta sessão. Parei de reconectar — feche a outra cópia ' +
              'e clique em "Reconectar" no painel.')
      mudarEstado({ status: 'conflito', detalhe: 'Outra cópia do bot está conectada com este número' })
      return
    }
    log(`⚠️ Outra conexão assumiu a sessão (${conflitos}/3). Tentando de novo em 30s...`)
    mudarEstado({ status: 'reconectando', detalhe: 'Outra conexão assumiu a sessão' })
    tentativaTimer = setTimeout(iniciarWhatsApp, 30_000)
    return
  }

  // espera cada vez mais entre tentativas (até 1 min) para não martelar o servidor
  const espera = Math.min(60, 2 ** falhas++)
  log(`Conexão caiu (código ${code ?? '?'}: ${motivo}), reconectando em ${espera}s...`)
  mudarEstado({ status: 'reconectando', detalhe: `Conexão caiu (${code ?? '?'}) — tentando em ${espera}s` })
  tentativaTimer = setTimeout(iniciarWhatsApp, espera * 1000)
}

// botão "Reconectar" do painel
export function reconectar() {
  conflitos = 0
  falhas = 0
  try { sock?.end(undefined) } catch {}
  mudarEstado({ status: 'reconectando', detalhe: 'Reconectando...' })
  iniciarWhatsApp().catch(err => logErro('Falha ao reconectar:', err.message))
}

// ---- mensagens ----

async function tratarMensagem(msg, type) {
  const jid = msg.key.remoteJid
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) return
  const content = normalizeMessageContent(msg.message)
  if (content?.protocolMessage || content?.reactionMessage) return

  const texto = getText(content).trim()
  // com o !s desligado no painel, o comando vira mensagem comum (a mídia ainda vai para o painel)
  const comando = config.comandoAtivo && COMANDO.test(texto)
  const jogo = JOGO.exec(texto)?.[1]?.toLowerCase()
  // todo mundo que manda mensagem entra na lista de usuários do painel (o número do bot não)
  const autor = msg.key.fromMe ? null : await quemMandou(msg)
  if (autor && type === 'notify') {
    usuarios.registrar(autor.numero, { nome: msg.pushName, comando: comando || !!jogo, semTelefone: autor.semTelefone })
  }

  if (jogo && type === 'notify') {
    await tratarJogo(msg, jogo, autor?.numero ?? null)
    return
  }
  if (comando) {
    await tratarComando(msg, content, autor?.numero ?? null)
    return
  }
  // mídias novas vão para o painel, inclusive as mandadas pelo celular do bot (fromMe + notify).
  // O que o próprio bot envia (figurinhas, originais do "desfazer") chega como append e fica de fora.
  if (type !== 'notify') return
  await liberarPorResposta(msg, content)
  await receberMidia(msg, content)
}

// quem mandou a mensagem; semTelefone = o WhatsApp só deu o id interno (LID) e não achamos o telefone
async function quemMandou(msg) {
  const jid = remetenteDe(msg.key)
  const numero = await numeroDe(jid)
  return { numero, semTelefone: jid.endsWith('@lid') && numero === digits(jid) }
}

// telefone (só dígitos) de um jid; o LID (id interno do WhatsApp) é convertido pela tabela do Baileys
async function numeroDe(jid) {
  if (!jid) return ''
  if (jid.endsWith('@lid')) {
    const eu = sock.user?.lid && jidNormalizedUser(sock.user.lid)
    if (eu && jidNormalizedUser(jid) === eu) return digits(sock.user.id)
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null)
    if (pn) return digits(pn)
  }
  return digits(jid)
}

function nomeDe(numero, pushName) {
  if (numero && numero === digits(sock.user?.id)) return sock.user?.name || 'Você (bot)'
  return pushName || usuarios.nomeDoUsuario(numero) || (numero ? `+${numero}` : 'Desconhecido')
}

// dados comuns de um item da biblioteca a partir da mensagem
async function dadosBase(msg, chat) {
  const grupo = chat.endsWith('@g.us')
  const remetente = msg.key.fromMe ? digits(sock.user?.id) : await numeroDe(remetenteDe(msg.key))
  const remetenteNome = nomeDe(remetente, msg.key.fromMe ? null : msg.pushName)
  // no privado a conversa é com a outra pessoa, mesmo quando quem mandou foi o celular do bot
  const outro = grupo ? '' : await numeroDe(msg.key.remoteJidAlt ?? chat)
  return {
    chat,
    grupo,
    chatNome: grupo ? await nomeDoGrupo(chat) : msg.key.fromMe ? nomeDe(outro) : remetenteNome,
    remetente,
    remetenteNome,
  }
}

async function receberMidia(msg, content) {
  const chat = msg.key.remoteJid
  const id = store.idPara(chat, msg.key.id)
  if (store.obter(id)?.disponivel) return
  const recebidoEm = toSeconds(msg.messageTimestamp) * 1000 || Date.now()

  // visualização única chega vazia: vira card bloqueado até alguém responder a ela pelo celular
  if (!content && msg.key.isViewOnce) {
    if (store.obter(id)) return
    const base = await dadosBase(msg, chat)
    store.adicionar({
      id, categoria: 'visualizacao-unica', animada: false, tipo: 'desconhecido', recebidoEm, ...base,
      disponivel: false, motivo: 'visualizacao-unica', figurinhas: [], msg: serializar(msg),
    })
    log(`👁️ Visualização única de ${base.remetenteNome} em ${base.chatNome} (bloqueada pelo WhatsApp)`)
    return
  }

  const found = getMedia(content)
  if (!found) return
  const base = await dadosBase(msg, chat)
  const item = store.adicionar({
    id,
    categoria: ehVisualizacaoUnica(msg.message, found.media) ? 'visualizacao-unica' : 'normais',
    animada: found.animada,
    tipo: found.gif ? 'gif' : found.animada ? 'video' : 'foto',
    mimetype: found.media.mimetype,
    legenda: found.media.caption ?? '',
    recebidoEm,
    ...base,
    disponivel: false,
    motivo: 'baixando',
    figurinhas: [],
    msg: serializar(msg),
  })

  const tamanho = toNumber(found.media.fileLength)
  if (tamanho > MAX_AUTO_MB * 1_048_576) {
    store.atualizar(id, { motivo: 'grande', tamanho })
    log(`📥 ${item.tipo} de ${base.remetenteNome} em ${base.chatNome} é grande demais para baixar automaticamente`)
    return
  }
  await baixarPara(item, msg, content, found)
  log(`📥 ${item.tipo} de ${base.remetenteNome} em ${base.chatNome}`)
}

// baixa a mídia de uma mensagem (content = conteúdo que tem a mídia) e guarda no item
async function baixarPara(item, msg, content, found) {
  try {
    const buffer = await naFila(() => downloadMediaMessage({ key: msg.key, message: content }, 'buffer', {},
      { logger: sock.logger, reuploadRequest: sock.updateMediaMessage }))
    return await store.guardarArquivo(item, buffer, extensao(found.media.mimetype, found.animada))
  } catch (err) {
    store.atualizar(item.id, { disponivel: false, motivo: 'erro' })
    throw err
  }
}

// !moeda e !d20. Quem está num cargo sem nenhuma permissão (ex.: Bloqueado) é ignorado, como no !s.
async function tratarJogo(msg, jogo, autor) {
  if (autor && !usuarios.podeAlgo(autor)) return
  if (toSeconds(msg.messageTimestamp) < startedAt - ATRASO_MAX_COMANDO) return
  let resposta
  if (jogo === 'moeda') {
    resposta = randomInt(2) ? '🪙 Deu *cara*!' : '🪙 Deu *coroa*!'
  } else {
    const n = randomInt(1, 21)
    resposta = `🎲 Tirou *${n}*` + (n === 20 ? ' — acerto crítico! 🔥' : n === 1 ? ' — falha crítica! 💀' : '')
  }
  await sock.sendMessage(msg.key.remoteJid, { text: resposta }, { quoted: msg }).catch(() => {})
  log(`🎲 !${jogo} de ${msg.pushName || autor || 'você'}: ${resposta.replace(/\*/g, '')}`)
}

// autor = número de quem mandou o !s; null quando foi o próprio número do bot (que sempre pode tudo)
async function tratarComando(msg, content, autor) {
  const jid = msg.key.remoteJid
  const ts = toSeconds(msg.messageTimestamp)
  const cargo = autor ? usuarios.cargoDe(autor) : null
  log(`📩 !s ${jid.endsWith('@g.us') ? 'no grupo' : 'no privado'} de ${msg.pushName || autor || 'você'}` +
      (cargo ? ` (cargo ${cargo.nome})` : ''))

  // cargo sem nenhuma permissão (ex.: Bloqueado): ignora em silêncio, para não virar spam de recusa
  if (autor && !usuarios.podeAlgo(autor)) {
    log('   ↳ ignorado: o cargo não tem nenhuma permissão')
    return
  }
  // tolera !s mandado enquanto o bot reiniciava, mas não reprocessa histórico antigo
  if (ts < startedAt - ATRASO_MAX_COMANDO) {
    log(`   ↳ ignorado: comando de ${Math.round((startedAt - ts) / 60)} min antes do bot ligar`)
    return
  }

  const responder = texto => sock.sendMessage(jid, { text: texto }, { quoted: msg }).catch(() => {})
  // o cargo libera ou não cada tipo de mídia
  const negado = async permissao => {
    if (!autor || usuarios.pode(autor, permissao)) return false
    log(`   ↳ negado: o cargo ${cargo.nome} não libera ${usuarios.PERMISSOES[permissao].toLowerCase()}`)
    await responder(`🚫 Seu cargo (*${cargo.nome}*) não permite figurinha de ` +
      `${usuarios.PERMISSOES[permissao].toLowerCase()}.`)
    return true
  }
  const permissaoDe = (visu, animada) => visu ? 'visuUnica' : animada ? 'video' : 'foto'

  // mídia com !s na legenda
  const propria = getMedia(content)
  if (propria) {
    if (await negado(permissaoDe(ehVisualizacaoUnica(msg.message, propria.media), propria.animada))) return
    const base = await dadosBase(msg, jid)
    const id = store.idPara(jid, msg.key.id)
    const item = store.obter(id)?.disponivel ? store.obter(id) : store.adicionar({
      id,
      categoria: ehVisualizacaoUnica(msg.message, propria.media) ? 'visualizacao-unica' : 'normais',
      animada: propria.animada, tipo: propria.gif ? 'gif' : propria.animada ? 'video' : 'foto',
      mimetype: propria.media.mimetype, legenda: propria.media.caption ?? '',
      recebidoEm: ts * 1000 || Date.now(), ...base, disponivel: false, motivo: 'baixando', figurinhas: [],
      msg: serializar(msg),
    })
    await comReacao(msg, async () => {
      const pronto = item.disponivel ? item : await baixarPara(item, msg, content, propria)
      await enviarFigurinha(pronto, msg)
    }, responder)
    return
  }

  const ctx = getContextInfo(content)
  const quoted = normalizeMessageContent(ctx?.quotedMessage)
  if (!quoted) {
    await responder('Responda com *!s* a uma foto, vídeo ou GIF para virar figurinha, ' +
      'ou a uma figurinha para ela voltar a ser foto/vídeo 😉')
    return
  }

  // !s respondendo uma figurinha: desfaz em foto/vídeo
  if (quoted.stickerMessage) {
    const st = quoted.stickerMessage
    if (st.isLottie || st.mimetype === 'application/was') {
      await responder('Essa figurinha é do tipo Lottie, não consigo desfazer 😕')
    } else if (!temChave(st)) {
      await responder('Não veio a figurinha junto com a resposta 😕 Tente de novo.')
    } else {
      await comReacao(msg, () => desfazerFigurinha(msg, quoted), responder)
    }
    return
  }

  const q = getMedia(quoted)
  if (!q) {
    await responder('Responda com *!s* a uma foto, vídeo ou GIF 😉')
    return
  }

  const citada = await itemDaCitacao(msg, ctx, quoted, q)
  if (!citada) {
    await responder('Não veio a mídia junto com a resposta 😕 Tente de novo pelo celular.')
    return
  }
  if (await negado(permissaoDe(citada.item.categoria === 'visualizacao-unica', q.animada))) return
  await comReacao(msg, async () => {
    const pronto = await baixarCitada(citada)
    await enviarFigurinha(pronto, msg)
  }, responder)
}

// Uma resposta aponta para a mensagem original (stanzaId) e leva uma cópia dela, com a chave da mídia.
// O item do painel é o da mensagem original — inclusive o card bloqueado de visualização única,
// que assim ganha o arquivo. Devolve null se a cópia veio sem a chave (e o item ainda não tem arquivo).
async function itemDaCitacao(msg, ctx, quoted, q) {
  const jid = msg.key.remoteJid
  const idOriginal = ctx.stanzaId ? store.idPara(jid, ctx.stanzaId) : store.idPara(jid, msg.key.id)
  let item = store.obter(idOriginal)
  if (!item?.disponivel && !temChave(q.media)) {
    log('   ↳ a cópia citada veio sem a chave da mídia')
    return null
  }

  const autor = await numeroDe(ctx.participant)
  const keyOriginal = {
    remoteJid: jid,
    id: ctx.stanzaId,
    fromMe: !!autor && autor === digits(sock.user?.id),
    participant: ctx.participant || undefined,
  }
  const msgOriginal = { key: keyOriginal, message: ctx.quotedMessage, messageTimestamp: msg.messageTimestamp }
  if (!item) {
    const base = await dadosBase({ key: keyOriginal, pushName: null }, jid)
    item = store.adicionar({
      id: idOriginal,
      categoria: 'normais', animada: q.animada, tipo: q.gif ? 'gif' : q.animada ? 'video' : 'foto',
      recebidoEm: toSeconds(msg.messageTimestamp) * 1000 || Date.now(), ...base,
      legenda: q.media.caption ?? '', disponivel: false, motivo: 'baixando', figurinhas: [],
      msg: serializar(msgOriginal),
    })
  }
  const visu = ehVisualizacaoUnica(ctx.quotedMessage, q.media) || item.categoria === 'visualizacao-unica'
  if (!item.disponivel) {
    item = store.atualizar(item.id, {
      categoria: visu ? 'visualizacao-unica' : item.categoria,
      animada: q.animada, tipo: q.gif ? 'gif' : q.animada ? 'video' : 'foto',
      mimetype: q.media.mimetype, motivo: 'baixando',
    })
  }
  log(`   ↳ usando a mídia citada${visu ? ' (visualização única)' : ''}`)
  return { item, msgOriginal, quoted, q }
}

function baixarCitada({ item, msgOriginal, quoted, q }) {
  return item.disponivel ? item : baixarPara(item, msgOriginal, quoted, q)
}

// resposta comum (sem !s) a um card bloqueado: só libera o card; a figurinha sai pelo clique no painel
async function liberarPorResposta(msg, content) {
  const ctx = getContextInfo(content)
  if (!ctx?.stanzaId || !ctx.quotedMessage) return
  const existente = store.obter(store.idPara(msg.key.remoteJid, ctx.stanzaId))
  if (!existente || existente.disponivel) return
  const quoted = normalizeMessageContent(ctx.quotedMessage)
  const q = getMedia(quoted)
  if (!q) return
  log(`🔓 Resposta à mídia bloqueada de ${existente.remetenteNome} em ${existente.chatNome}`)
  const citada = await itemDaCitacao(msg, ctx, quoted, q)
  if (!citada) return
  await baixarCitada(citada)
  log('   ↳ liberada no painel — clique nela para fazer a figurinha')
}

// ⏳ enquanto trabalha; em caso de erro, avisa na conversa
async function comReacao(msg, fn, responder) {
  const jid = msg.key.remoteJid
  await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {})
  try {
    await fn()
  } catch (err) {
    logErro('❌ Erro:', err.stderr?.trim() || err.message)
    await responder(`Não consegui: ${err.message}`)
  } finally {
    await sock.sendMessage(jid, { react: { text: '', key: msg.key } }).catch(() => {})
  }
}

// converte o arquivo do item em figurinha e manda respondendo `quoted` (ou a mensagem original)
async function enviarFigurinha(item, quoted) {
  const buffer = await lerArquivo(store.caminhoArquivo(item))
  const sticker = await naFila(() => mediaToSticker(buffer, item.animada))
  const alvo = quoted ?? citacaoLeve(desserializar(item.msg))
  const sent = await sock.sendMessage(item.chat, { sticker, isAnimated: item.animada }, alvo ? { quoted: alvo } : {})
  const hash = sent?.message?.stickerMessage?.fileSha256
  store.atualizar(item.id, {
    figurinhas: [...(item.figurinhas ?? []), { hash: hash ? Buffer.from(hash).toString('hex') : null, em: Date.now() }],
  })
  log(`✅ Figurinha enviada em ${item.chatNome} ${quoted ? '(pelo !s)' : '(pelo painel)'}`)
  if (sent?.key?.id) acompanharEntrega(sent.key.id, item.chatNome)
}

// Resposta à mídia original pelo painel: cita só o que aparece na "caixinha" da resposta (tipo, legenda,
// miniatura), como o próprio WhatsApp faz. Citando a mídia inteira (chave de download, url, hashes), a
// figurinha chegava aos membros do grupo mas não aparecia nos outros aparelhos do número do bot.
const CAMPOS_CITACAO = ['mimetype', 'caption', 'jpegThumbnail', 'width', 'height', 'seconds', 'gifPlayback']
function citacaoLeve(msg) {
  if (!msg?.key?.id) return null
  const conteudo = normalizeMessageContent(msg.message) ?? {}
  const tipo = ['imageMessage', 'videoMessage', 'documentMessage'].find(t => conteudo[t])
  if (!tipo) return null
  const leve = {}
  for (const campo of CAMPOS_CITACAO) if (conteudo[tipo][campo] != null) leve[campo] = conteudo[tipo][campo]
  if (typeof leve.jpegThumbnail === 'string') leve.jpegThumbnail = Buffer.from(leve.jpegThumbnail, 'base64')
  return { key: msg.key, message: { [tipo]: leve } }
}

// ---- entrega: o "enviada" acima só quer dizer que o servidor aceitou; aqui vemos se chegou nos celulares ----
const STATUS_ENTREGA = { 0: '❌ erro', 2: '✓ no servidor', 3: '✓✓ entregue', 4: '✓✓ lida', 5: '✓✓ vista' }
const acompanhadas = new Map() // id da mensagem -> { chatNome, status, timer }

function acompanharEntrega(id, chatNome) {
  const timer = setTimeout(() => {
    const a = acompanhadas.get(id)
    acompanhadas.delete(id)
    if (a && (a.status ?? 0) < 3) {
      logErro(`⚠️ A figurinha em ${chatNome} não foi confirmada como entregue em 2 min ` +
              `(último status: ${STATUS_ENTREGA[a.status] ?? 'nenhum'})`)
    }
  }, 120_000)
  acompanhadas.set(id, { chatNome, status: null, timer })
}

function registrarEntrega(id, status) {
  const a = acompanhadas.get(id)
  if (!a || status == null || status <= (a.status ?? -1)) return
  a.status = status
  log(`   ${STATUS_ENTREGA[status] ?? `status ${status}`} — figurinha em ${a.chatNome}`)
  if (status >= 3) {
    clearTimeout(a.timer)
    acompanhadas.delete(id)
  }
}

// clique no painel
export async function fazerFigurinhaDoPainel(id) {
  if (estado.status !== 'conectado') throw new Error('o bot não está conectado ao WhatsApp')
  const item = store.obter(id)
  if (!item) throw new Error('mídia não encontrada')
  if (!item.disponivel) {
    throw new Error(item.motivo === 'visualizacao-unica'
      ? 'o WhatsApp não entrega visualização única ao bot — responda a ela pelo celular para liberar'
      : 'essa mídia não foi baixada')
  }
  await enviarFigurinha(item, null)
}

// !s numa figurinha: devolve o original (se foi feita aqui) ou reconverte a própria figurinha
async function desfazerFigurinha(msg, quoted) {
  const jid = msg.key.remoteJid
  const hash = quoted.stickerMessage.fileSha256
  const hex = hash?.length ? Buffer.from(hash).toString('hex') : null
  const item = hex ? store.porHashDeFigurinha(hex) : null
  const original = item
    ? { buffer: await lerArquivo(store.caminhoArquivo(item)), mimetype: item.mimetype ?? '' }
    : await originalAntigo(hex)
  if (original) {
    const { buffer, mimetype } = original
    const content = mimetype.startsWith('video/') ? { video: buffer, mimetype }
      : mimetype === 'image/gif' ? { document: buffer, mimetype, fileName: 'original.gif' }
      : mimetype.startsWith('image/') ? { image: buffer, mimetype }
      : { document: buffer, mimetype, fileName: 'original' }
    await sock.sendMessage(jid, content, { quoted: msg })
    log(`✅ Original devolvido em qualidade total (${(buffer.length / 1024).toFixed(0)} KB)`)
    return
  }
  log('   original não guardado — reconvertendo a figurinha')
  const buffer = await downloadMediaMessage({ key: msg.key, message: quoted }, 'buffer', {},
    { logger: sock.logger, reuploadRequest: sock.updateMediaMessage })
  const result = await naFila(() => stickerToMedia(buffer))
  await sock.sendMessage(jid, result.video ? { video: result.video, mimetype: 'video/mp4' } : { image: result.image },
    { quoted: msg })
  log(`✅ Figurinha desfeita em ${result.video ? 'vídeo' : 'foto'}`)
}

// figurinhas feitas antes do painel guardavam o original em originais/<hash>.bin
async function originalAntigo(hex) {
  if (!hex) return null
  try {
    const base = path.join('originais', hex)
    const { mimetype } = JSON.parse(await lerArquivo(`${base}.json`, 'utf8'))
    return { buffer: await lerArquivo(`${base}.bin`), mimetype }
  } catch {
    return null
  }
}
