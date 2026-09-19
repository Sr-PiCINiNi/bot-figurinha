// Biblioteca de mídias recebidas, organizada em pastas:
//   midia/Visualizacao unica/{Fotos,Videos}   midia/Normais/{Fotos,Videos}
// O índice (midia/indice.json) guarda quem mandou, de onde, e a mensagem original (para responder a ela).
import { EventEmitter } from 'node:events'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { makeThumb, mediaDuration } from './sticker.js'
import { log, logErro } from './log.js'

export const RAIZ = 'midia'
const INDICE = path.join(RAIZ, 'indice.json')
const THUMBS = path.join(RAIZ, '.miniaturas')
export const CATEGORIAS = {
  'visualizacao-unica': 'Visualizacao unica',
  normais: 'Normais',
}

export const storeEvents = new EventEmitter()
let itens = new Map()
let salvarTimer = null

export async function iniciarStore() {
  for (const pasta of Object.values(CATEGORIAS)) {
    await mkdir(path.join(RAIZ, pasta, 'Fotos'), { recursive: true })
    await mkdir(path.join(RAIZ, pasta, 'Videos'), { recursive: true })
  }
  await mkdir(THUMBS, { recursive: true })
  try {
    const lista = JSON.parse(await readFile(INDICE, 'utf8'))
    itens = new Map(lista.map(i => [i.id, i]))
    log(`📚 ${itens.size} mídias na biblioteca`)
  } catch (err) {
    if (err.code !== 'ENOENT') logErro('Índice de mídias ilegível, começando vazio:', err.message)
  }
}

// grava o índice no máximo a cada 1s, trocando o arquivo de uma vez para não corromper
function salvar() {
  clearTimeout(salvarTimer)
  salvarTimer = setTimeout(async () => {
    try {
      const tmp = `${INDICE}.tmp`
      await writeFile(tmp, JSON.stringify([...itens.values()]))
      await rename(tmp, INDICE)
    } catch (err) {
      logErro('Não consegui salvar o índice de mídias:', err.message)
    }
  }, 1000)
}

export function idPara(chat, msgId) {
  return createHash('sha1').update(`${chat}|${msgId}`).digest('hex').slice(0, 16)
}

// o que o painel vê (sem a mensagem bruta)
export function publico(item) {
  const { msg, ...resto } = item
  return resto
}

export function listar() {
  return [...itens.values()].sort((a, b) => b.recebidoEm - a.recebidoEm).map(publico)
}

export function obter(id) {
  return itens.get(id)
}

export function adicionar(item) {
  itens.set(item.id, item)
  salvar()
  storeEvents.emit('midia', publico(item))
  return item
}

export function atualizar(id, patch) {
  const item = itens.get(id)
  if (!item) return null
  Object.assign(item, patch)
  salvar()
  storeEvents.emit('midia', publico(item))
  return item
}

export function caminhoArquivo(item) {
  return item.arquivo ? path.join(RAIZ, item.arquivo) : null
}

export function caminhoThumb(item) {
  return item.thumb ? path.join(RAIZ, item.thumb) : null
}

function limparNome(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'chat'
}

// grava o arquivo da mídia na pasta certa e gera miniatura; o nome ajuda a achar pelo Explorer
export async function guardarArquivo(item, buffer, ext) {
  const pasta = path.join(CATEGORIAS[item.categoria], item.animada ? 'Videos' : 'Fotos')
  const d = new Date(item.recebidoEm)
  const pad = n => String(n).padStart(2, '0')
  const data = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
               `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  const nome = `${data}_${limparNome(item.chatNome)}_${item.id.slice(0, 6)}.${ext}`
  const arquivo = path.join(pasta, nome)
  await writeFile(path.join(RAIZ, arquivo), buffer)

  const patch = { arquivo, tamanho: buffer.length, disponivel: true, motivo: null }
  try {
    const thumb = path.join('.miniaturas', `${item.id}.jpg`)
    await makeThumb(path.join(RAIZ, arquivo), item.animada, path.join(RAIZ, thumb))
    patch.thumb = thumb
  } catch (err) {
    logErro(`Sem miniatura para ${nome}:`, err.stderr?.trim() || err.message)
  }
  if (item.animada) patch.duracao = await mediaDuration(path.join(RAIZ, arquivo))
  return atualizar(item.id, patch)
}

export async function remover(id) {
  const item = itens.get(id)
  if (!item) return false
  for (const f of [caminhoArquivo(item), caminhoThumb(item)]) {
    if (f) await rm(f, { force: true })
  }
  itens.delete(id)
  salvar()
  storeEvents.emit('removida', id)
  return true
}

export function porHashDeFigurinha(hex) {
  for (const item of itens.values()) {
    if (item.figurinhas?.some(f => f.hash === hex) && item.arquivo) return item
  }
  return null
}

// apaga mídias mais velhas que `dias` e, se passar de `maxMB`, as mais antigas primeiro
export async function limparAntigas(dias, maxMB) {
  const limite = Date.now() - dias * 86_400_000
  let total = 0
  let removidas = 0
  for (const item of listar()) { // mais novas primeiro
    total += item.tamanho ?? 0
    if (item.recebidoEm < limite || total > maxMB * 1_048_576) {
      await remover(item.id)
      removidas++
    }
  }
  if (removidas) log(`🧹 ${removidas} mídias antigas apagadas`)
}
