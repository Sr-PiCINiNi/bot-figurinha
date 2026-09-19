// Usuários (todo mundo que manda mensagem ao bot) e cargos (o que cada um pode fazer com o !s).
// Tudo fica em usuarios.json, que tem números de telefone: nunca vai para o GitHub.
import { readFileSync } from 'node:fs'
import { writeFile, rename } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { logErro } from './log.js'

const ARQUIVO = 'usuarios.json'

// o que um cargo pode fazer: figurinha com !s por tipo de mídia, e os comandos de sorteio
export const PERMISSOES = {
  foto: 'Figurinha de fotos',
  video: 'Figurinha de vídeos e GIFs',
  visuUnica: 'Figurinha de visualização única',
  moeda: 'Comando !moeda',
  dados: 'Comando de dados (!d20, !5d6...)',
}

const CARGOS_INICIAIS = [
  { id: 'bloqueado', nome: 'Bloqueado', cor: '#e5484d',
    permissoes: { foto: false, video: false, visuUnica: false, moeda: false, dados: false } },
  { id: 'comum', nome: 'Comum', cor: '#8696a0',
    permissoes: { foto: true, video: true, visuUnica: false, moeda: true, dados: true } },
  { id: 'vip', nome: 'VIP', cor: '#f5a524',
    permissoes: { foto: true, video: true, visuUnica: true, moeda: true, dados: true } },
]

export const usuariosEvents = new EventEmitter()
let dados = { cargoPadrao: 'comum', cargos: structuredClone(CARGOS_INICIAIS), usuarios: {} }
let salvarTimer = null

try {
  dados = { ...dados, ...JSON.parse(readFileSync(ARQUIVO, 'utf8')) }
} catch (err) {
  if (err.code !== 'ENOENT') logErro('usuarios.json ilegível, começando com os cargos padrão:', err.message)
}
// cargos salvos antes de uma permissão existir: ela vem liberada para quem já podia alguma coisa
// e negada para quem não podia nada (ex.: Bloqueado), para ninguém perder nem ganhar acesso de surpresa
for (const cargo of dados.cargos) {
  // o !d20 virou o comando de dados (!NdM): herda a permissão que o cargo tinha
  if (cargo.permissoes && 'd20' in cargo.permissoes) {
    cargo.permissoes.dados ??= cargo.permissoes.d20
    delete cargo.permissoes.d20
    salvar()
  }
  const podiaAlgo = Object.values(cargo.permissoes ?? {}).some(Boolean)
  for (const chave of Object.keys(PERMISSOES)) {
    if (!(chave in (cargo.permissoes ??= {}))) cargo.permissoes[chave] = podiaAlgo
  }
}

// grava no máximo a cada 1s (chegam muitas mensagens), trocando o arquivo de uma vez
function salvar() {
  clearTimeout(salvarTimer)
  salvarTimer = setTimeout(async () => {
    try {
      await writeFile(`${ARQUIVO}.tmp`, JSON.stringify(dados, null, 2))
      await rename(`${ARQUIVO}.tmp`, ARQUIVO)
    } catch (err) {
      logErro('Não consegui salvar usuarios.json:', err.message)
    }
  }, 1000)
}

function cargoPorId(id) {
  return dados.cargos.find(c => c.id === id)
}

// cargo efetivo: o do usuário, ou o padrão (também se o cargo dele foi apagado)
export function cargoDe(numero) {
  const u = dados.usuarios[numero]
  return cargoPorId(u?.cargo) ?? cargoPorId(dados.cargoPadrao) ?? dados.cargos[0]
}

export function pode(numero, permissao) {
  return !!cargoDe(numero)?.permissoes?.[permissao]
}

export function podeAlgo(numero) {
  return Object.values(cargoDe(numero)?.permissoes ?? {}).some(Boolean)
}

export function nomeDoUsuario(numero) {
  return dados.usuarios[numero]?.nome
}

// chamado a cada mensagem recebida; `semTelefone` = só temos o id interno (LID) da pessoa
export function registrar(numero, { nome, comando = false, semTelefone = false } = {}) {
  if (!numero) return
  const agora = Date.now()
  const novo = !dados.usuarios[numero]
  const u = dados.usuarios[numero] ??= { numero, cargo: null, comandos: 0, primeiroContato: agora }
  if (nome) u.nome = nome
  u.semTelefone = semTelefone
  u.ultimoContato = agora
  if (comando) u.comandos = (u.comandos ?? 0) + 1
  salvar()
  // mensagem comum de quem já está na lista não precisa atualizar o painel na hora
  if (novo || comando) usuariosEvents.emit('usuario', publicoUsuario(u))
}

function publicoUsuario(u) {
  return { ...u, cargoEfetivo: cargoDe(u.numero)?.id }
}

export function listarUsuarios() {
  return Object.values(dados.usuarios).map(publicoUsuario)
}

export function definirCargo(numero, cargoId) {
  const u = dados.usuarios[numero]
  if (!u) throw new Error('usuário não encontrado')
  if (cargoId !== null && !cargoPorId(cargoId)) throw new Error('cargo não encontrado')
  u.cargo = cargoId // null = usa o cargo padrão
  salvar()
  usuariosEvents.emit('usuario', publicoUsuario(u))
  return publicoUsuario(u)
}

export function estadoCargos() {
  const contagem = {}
  for (const u of Object.values(dados.usuarios)) {
    const id = cargoDe(u.numero)?.id
    contagem[id] = (contagem[id] ?? 0) + 1
  }
  return { cargoPadrao: dados.cargoPadrao, cargos: dados.cargos.map(c => ({ ...c, usuarios: contagem[c.id] ?? 0 })) }
}

function avisarCargos() {
  salvar()
  usuariosEvents.emit('cargos', estadoCargos())
}

function validarCargo({ nome, cor, permissoes }, atual = {}) {
  const limpo = { ...atual }
  if (nome !== undefined) {
    limpo.nome = String(nome).trim().slice(0, 30)
    if (!limpo.nome) throw new Error('o cargo precisa de um nome')
    if (dados.cargos.some(c => c.id !== atual.id && c.nome.toLowerCase() === limpo.nome.toLowerCase())) {
      throw new Error('já existe um cargo com esse nome')
    }
  }
  if (cor !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(cor)) throw new Error('cor inválida')
    limpo.cor = cor
  }
  if (permissoes !== undefined) {
    limpo.permissoes = { ...(atual.permissoes ?? {}) }
    for (const chave of Object.keys(PERMISSOES)) {
      if (chave in permissoes) limpo.permissoes[chave] = !!permissoes[chave]
    }
  }
  return limpo
}

export function criarCargo(campos) {
  const nenhuma = Object.fromEntries(Object.keys(PERMISSOES).map(chave => [chave, false]))
  const cargo = validarCargo({ cor: '#00a884', permissoes: {}, ...campos }, { permissoes: nenhuma })
  cargo.id = randomBytes(4).toString('hex')
  dados.cargos.push(cargo)
  avisarCargos()
  return cargo
}

export function editarCargo(id, campos) {
  const i = dados.cargos.findIndex(c => c.id === id)
  if (i < 0) throw new Error('cargo não encontrado')
  dados.cargos[i] = validarCargo(campos, dados.cargos[i])
  avisarCargos()
  return dados.cargos[i]
}

// quem tinha o cargo apagado passa a usar o cargo padrão
export function removerCargo(id) {
  if (dados.cargos.length <= 1) throw new Error('precisa sobrar pelo menos um cargo')
  if (!cargoPorId(id)) throw new Error('cargo não encontrado')
  dados.cargos = dados.cargos.filter(c => c.id !== id)
  if (dados.cargoPadrao === id) dados.cargoPadrao = dados.cargos[0].id
  for (const u of Object.values(dados.usuarios)) if (u.cargo === id) u.cargo = null
  avisarCargos()
}

export function definirCargoPadrao(id) {
  if (!cargoPorId(id)) throw new Error('cargo não encontrado')
  dados.cargoPadrao = id
  avisarCargos()
}
