// Painel web local: serve a interface (pasta painel/) e a API usada por ela.
// Por padrão só aceita conexões deste computador (127.0.0.1).
import http from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import QRCode from 'qrcode'
import { log, logErro, logEvents, linhasRecentes } from './log.js'
import * as store from './store.js'
import { wa, estado, fazerFigurinhaDoPainel, reconectar } from './whatsapp.js'
import { config, configEvents, alterarConfig } from './config.js'
import * as usuarios from './usuarios.js'

export const PORTA = Number(process.env.PAINEL_PORTA) || 3777
// PAINEL_HOST=0.0.0.0 abre para a rede (ex.: servidor); aí use PAINEL_SENHA
const HOST = process.env.PAINEL_HOST || '127.0.0.1'
const SENHA = process.env.PAINEL_SENHA || ''
const PASTA_PAINEL = path.resolve('painel')

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.3gp': 'video/3gpp', '.mov': 'video/quicktime', '.webm': 'video/webm',
}

async function estadoPublico() {
  const { qr, ...resto } = estado
  return { ...resto, config: { ...config }, qrSvg: qr ? await QRCode.toString(qr, { type: 'svg', margin: 1 }) : null }
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let corpo = ''
    req.on('data', parte => {
      corpo += parte
      if (corpo.length > 10_000) reject(new Error('corpo grande demais'))
    })
    req.on('end', () => {
      try { resolve(JSON.parse(corpo || '{}')) } catch { reject(new Error('JSON inválido')) }
    })
  })
}

// O Explorer só entende /select,"caminho" exatamente assim; se o Node puser aspas em volta do argumento
// inteiro (o que faz quando o caminho tem espaço), ele ignora o caminho e abre outra pasta.
function abrirExplorer(argumento) {
  spawn('explorer.exe', [argumento], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref()
}

function json(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(dados))
}

// arquivo com suporte a Range (o <video> do navegador pede pedaços)
async function enviarArquivo(req, res, arquivo, cache = 'no-cache') {
  const info = await stat(arquivo).catch(() => null)
  if (!info?.isFile()) return json(res, 404, { erro: 'arquivo não encontrado' })
  const tipo = TIPOS[path.extname(arquivo).toLowerCase()] ?? 'application/octet-stream'
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const inicio = range[1] ? Number(range[1]) : 0
    const fim = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
    res.writeHead(206, {
      'Content-Type': tipo, 'Content-Length': fim - inicio + 1, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${inicio}-${fim}/${info.size}`, 'Cache-Control': cache,
    })
    createReadStream(arquivo, { start: inicio, end: fim }).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': info.size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache })
  createReadStream(arquivo).pipe(res)
}

// ---- eventos ao vivo (Server-Sent Events) ----
const ouvintes = new Set()
function transmitir(evento, dados) {
  const pacote = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`
  for (const res of ouvintes) res.write(pacote)
}
wa.on('estado', async () => transmitir('estado', await estadoPublico()))
configEvents.on('mudou', async () => transmitir('estado', await estadoPublico()))
usuarios.usuariosEvents.on('usuario', u => transmitir('usuario', u))
usuarios.usuariosEvents.on('cargos', c => transmitir('cargos', c))
store.storeEvents.on('midia', item => transmitir('midia', item))
store.storeEvents.on('removida', id => transmitir('removida', { id }))
logEvents.on('linha', linha => transmitir('log', linha))
setInterval(() => { for (const res of ouvintes) res.write(': ping\n\n') }, 25_000)

function autorizado(req) {
  // DNS rebinding: com o painel só local, o endereço acessado tem que ser o local
  if (HOST === '127.0.0.1') {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (!['127.0.0.1', 'localhost'].includes(host)) return false
  }
  if (!SENHA) return true
  const [tipo, valor] = (req.headers.authorization ?? '').split(' ')
  return tipo === 'Basic' && Buffer.from(valor ?? '', 'base64').toString().split(':').slice(1).join(':') === SENHA
}

async function rotear(req, res) {
  const url = new URL(req.url, 'http://painel')
  const rota = url.pathname
  const metodo = req.method

  if (!autorizado(req)) {
    res.writeHead(401, SENHA ? { 'WWW-Authenticate': 'Basic realm="Bot Figurinha"' } : {})
    return res.end('não autorizado')
  }
  // ações só com o cabeçalho do painel: outro site aberto no navegador não consegue mandá-lo
  if (metodo !== 'GET' && req.headers['x-painel'] !== '1') return json(res, 403, { erro: 'origem não permitida' })

  if (rota === '/api/estado') return json(res, 200, await estadoPublico())
  if (rota === '/api/midias') return json(res, 200, store.listar())
  if (rota === '/api/log') return json(res, 200, linhasRecentes())
  if (rota === '/api/eventos') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    res.write(`event: estado\ndata: ${JSON.stringify(await estadoPublico())}\n\n`)
    ouvintes.add(res)
    req.on('close', () => ouvintes.delete(res))
    return
  }
  // ---- usuários e cargos ----
  if (rota === '/api/usuarios' && metodo === 'GET') return json(res, 200, usuarios.listarUsuarios())
  if (rota === '/api/cargos' && metodo === 'GET') {
    return json(res, 200, { ...usuarios.estadoCargos(), permissoes: usuarios.PERMISSOES })
  }
  try {
    const mu = /^\/api\/usuarios\/(\d{5,20})$/.exec(rota)
    if (mu && metodo === 'PATCH') {
      const { cargo } = await lerCorpo(req)
      const u = usuarios.definirCargo(mu[1], cargo ?? null)
      log(`🏷️ ${u.nome || `+${u.numero}`} agora é ${usuarios.cargoDe(u.numero).nome}`)
      return json(res, 200, u)
    }
    if (rota === '/api/cargos' && metodo === 'POST') {
      const cargo = usuarios.criarCargo(await lerCorpo(req))
      log(`🏷️ Cargo criado: ${cargo.nome}`)
      return json(res, 200, cargo)
    }
    if (rota === '/api/cargos/padrao' && metodo === 'PUT') {
      usuarios.definirCargoPadrao((await lerCorpo(req)).id)
      return json(res, 200, usuarios.estadoCargos())
    }
    const mc = /^\/api\/cargos\/([\w-]{1,40})$/.exec(rota)
    if (mc && metodo === 'PATCH') return json(res, 200, usuarios.editarCargo(mc[1], await lerCorpo(req)))
    if (mc && metodo === 'DELETE') {
      usuarios.removerCargo(mc[1])
      return json(res, 200, { ok: true })
    }
  } catch (err) {
    return json(res, 400, { erro: err.message })
  }

  if (rota === '/api/config' && metodo === 'POST') {
    const novo = alterarConfig(await lerCorpo(req))
    log(`⚙️ Comando !s ${novo.comandoAtivo ? 'ativado' : 'desativado'} pelo painel`)
    return json(res, 200, novo)
  }
  if (rota === '/api/reconectar' && metodo === 'POST') {
    reconectar()
    return json(res, 200, { ok: true })
  }

  const m = /^\/api\/midias\/([0-9a-f]{16})(?:\/(arquivo|miniatura|figurinha|mostrar))?$/.exec(rota)
  if (m) {
    const [, id, acao] = m
    const item = store.obter(id)
    if (!item) return json(res, 404, { erro: 'mídia não encontrada' })
    if (acao === 'arquivo' && metodo === 'GET') return enviarArquivo(req, res, store.caminhoArquivo(item) ?? '')
    if (acao === 'miniatura' && metodo === 'GET') {
      return enviarArquivo(req, res, store.caminhoThumb(item) ?? '', 'max-age=86400')
    }
    if (acao === 'figurinha' && metodo === 'POST') {
      try {
        await fazerFigurinhaDoPainel(id)
        return json(res, 200, { ok: true })
      } catch (err) {
        logErro('❌ Figurinha pelo painel:', err.stderr?.trim() || err.message)
        return json(res, 400, { erro: err.message })
      }
    }
    if (acao === 'mostrar' && metodo === 'POST') {
      // abre o Explorer com o arquivo selecionado
      const arquivo = store.caminhoArquivo(item)
      if (arquivo && process.platform === 'win32') abrirExplorer(`/select,"${path.resolve(arquivo)}"`)
      return json(res, 200, { ok: true })
    }
    if (!acao && metodo === 'DELETE') {
      await store.remover(id)
      return json(res, 200, { ok: true })
    }
    return json(res, 405, { erro: 'método não permitido' })
  }

  if (rota === '/api/abrir-pasta' && metodo === 'POST') {
    if (process.platform === 'win32') abrirExplorer(`"${path.resolve(store.RAIZ)}"`)
    return json(res, 200, { ok: true })
  }

  // arquivos da interface
  if (metodo === 'GET' && !rota.startsWith('/api/')) {
    const arquivo = path.resolve(PASTA_PAINEL, `.${rota === '/' ? '/index.html' : decodeURIComponent(rota)}`)
    if (!arquivo.startsWith(PASTA_PAINEL + path.sep)) return json(res, 403, { erro: 'caminho inválido' })
    return enviarArquivo(req, res, arquivo)
  }
  json(res, 404, { erro: 'não encontrado' })
}

export function iniciarPainel() {
  return new Promise((resolve, reject) => {
    const servidor = http.createServer((req, res) => {
      rotear(req, res).catch(err => {
        logErro('Erro no painel:', err.stack ?? err.message)
        if (!res.headersSent) json(res, 500, { erro: err.message })
        else res.end()
      })
    })
    servidor.on('error', reject)
    servidor.listen(PORTA, HOST, () => {
      log(`🖥️ Painel em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORTA}`)
      resolve(servidor)
    })
  })
}
