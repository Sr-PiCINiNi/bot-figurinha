// Log do bot: vai para a tela, para bot.log e para o painel (últimas linhas + eventos ao vivo).
import { appendFileSync, renameSync, statSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { format } from 'node:util'

const ARQUIVO = 'bot.log'
const MAX_ARQUIVO = 5 * 1_048_576 // passou disso, vira bot.old.log e começa outro
const MEMORIA = 300 // linhas guardadas para quem abre o painel depois

export const logEvents = new EventEmitter()
const recentes = []

function gravar(nivel, texto) {
  const linha = { em: Date.now(), nivel, texto }
  recentes.push(linha)
  if (recentes.length > MEMORIA) recentes.shift()
  logEvents.emit('linha', linha)
  try {
    if (statSync(ARQUIVO, { throwIfNoEntry: false })?.size > MAX_ARQUIVO) renameSync(ARQUIVO, 'bot.old.log')
    appendFileSync(ARQUIVO, `[${new Date(linha.em).toLocaleString()}] ${texto}\n`)
  } catch {}
}

export function log(...args) {
  const texto = format(...args)
  console.log(`[${new Date().toLocaleTimeString()}]`, texto)
  gravar('info', texto)
}

export function logErro(...args) {
  const texto = format(...args)
  console.error(`[${new Date().toLocaleTimeString()}]`, texto)
  gravar('erro', texto)
}

export function linhasRecentes() {
  return recentes.slice()
}
