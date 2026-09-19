// Preferências alteradas pelo painel, salvas em config.json (continuam valendo depois de reiniciar).
import { readFileSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { logErro } from './log.js'

const ARQUIVO = 'config.json'
const PADRAO = {
  comandoAtivo: true, // o bot atende !s no WhatsApp
}

export const configEvents = new EventEmitter()
export const config = { ...PADRAO }

try {
  Object.assign(config, JSON.parse(readFileSync(ARQUIVO, 'utf8')))
} catch (err) {
  if (err.code !== 'ENOENT') logErro('config.json ilegível, usando o padrão:', err.message)
}

// só aceita chaves conhecidas, com o mesmo tipo do padrão
export function alterarConfig(mudancas) {
  for (const [chave, valor] of Object.entries(mudancas)) {
    if (chave in PADRAO && typeof valor === typeof PADRAO[chave]) config[chave] = valor
  }
  writeFileSync(ARQUIVO, JSON.stringify(config, null, 2))
  configEvents.emit('mudou', { ...config })
  return { ...config }
}
