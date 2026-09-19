// Interface do painel: lista as mídias, atualiza ao vivo (SSE) e faz figurinha com um clique.
const $ = seletor => document.querySelector(seletor)

const midias = new Map()
let filtro = 'tudo'
let busca = ''
let chatEscolhido = ''

const TITULOS = {
  tudo: 'Tudo',
  'visualizacao-unica:foto': 'Visualização única · Fotos',
  'visualizacao-unica:video': 'Visualização única · Vídeos',
  'visualizacao-unica:bloqueada': 'Visualização única · Bloqueadas',
  'normais:foto': 'Normais · Fotos',
  'normais:video': 'Normais · Vídeos',
}

const STATUS = {
  iniciando: 'Iniciando...',
  qr: 'Aguardando QR Code',
  conectado: 'Conectado',
  reconectando: 'Reconectando...',
  conflito: 'Conflito de sessão',
  offline: 'Painel sem conexão com o bot',
}

// ---------- API ----------
async function api(caminho, opcoes = {}) {
  const res = await fetch(caminho, { ...opcoes, headers: { 'X-Painel': '1', ...opcoes.headers } })
  const dados = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(dados.erro || `erro ${res.status}`)
  return dados
}

function toast(texto, tipo = '') {
  const el = document.createElement('div')
  el.className = `toast ${tipo}`
  el.textContent = texto
  $('#avisos').append(el)
  setTimeout(() => el.remove(), tipo === 'erro' ? 6000 : 3000)
}

// ---------- filtros ----------
function passaNaPasta(m, pasta = filtro) {
  if (pasta === 'tudo') return true
  const [categoria, tipo] = pasta.split(':')
  if (m.categoria !== categoria) return false
  if (tipo === 'bloqueada') return m.motivo === 'visualizacao-unica'
  if (m.motivo === 'visualizacao-unica') return false
  return tipo === 'video' ? m.animada : !m.animada
}

function passaNaBusca(m) {
  if (chatEscolhido && m.chat !== chatEscolhido) return false
  if (!busca) return true
  return `${m.chatNome} ${m.remetenteNome} ${m.remetente} ${m.legenda ?? ''}`.toLowerCase().includes(busca)
}

function contar() {
  const contas = Object.fromEntries(Object.keys(TITULOS).map(chave => [chave, 0]))
  for (const m of midias.values()) {
    for (const chave of Object.keys(TITULOS)) {
      if (passaNaPasta(m, chave)) contas[chave]++
    }
  }
  for (const el of document.querySelectorAll('[data-conta]')) el.textContent = contas[el.dataset.conta] ?? 0
}

function atualizarListaDeChats() {
  const select = $('#filtro-chat')
  const chats = new Map()
  for (const m of midias.values()) chats.set(m.chat, `${m.grupo ? '👥 ' : ''}${m.chatNome}`)
  const ordenados = [...chats].sort((a, b) => a[1].localeCompare(b[1]))
  const atual = select.value
  select.replaceChildren(new Option('Todas as conversas', ''), ...ordenados.map(([v, t]) => new Option(t, v)))
  select.value = chats.has(atual) ? atual : ''
}

// ---------- cards ----------
function tempoRelativo(ms) {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`
  const d = new Date(ms)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function duracao(seg) {
  if (!seg) return ''
  const s = Math.round(seg)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function selo(m) {
  if (m.categoria === 'visualizacao-unica') return `👁️ ${m.animada ? 'Vídeo' : m.tipo === 'desconhecido' ? 'Única' : 'Foto'}`
  return { foto: 'Foto', video: 'Vídeo', gif: 'GIF' }[m.tipo] ?? 'Mídia'
}

function preencherCard(el, m) {
  el.dataset.id = m.id
  const bloqueado = m.motivo === 'visualizacao-unica'
  el.toggleAttribute('data-bloqueado', bloqueado)
  el.toggleAttribute('data-indisponivel', !m.disponivel && !bloqueado)
  el.toggleAttribute('data-trabalhando', m.motivo === 'baixando' || el.hasAttribute('data-enviando'))

  const img = el.querySelector('img')
  const src = m.thumb ? `/api/midias/${m.id}/miniatura` : ''
  if (img.getAttribute('src') !== src) src ? img.setAttribute('src', src) : img.removeAttribute('src')

  el.querySelector('.selo').textContent = selo(m)
  el.querySelector('.duracao').textContent = m.animada ? duracao(m.duracao) : ''
  el.querySelector('.chat').textContent = `${m.grupo ? '👥 ' : ''}${m.chatNome}`
  el.querySelector('.detalhe').textContent =
    `${m.grupo ? `${m.remetenteNome} · ` : ''}${tempoRelativo(m.recebidoEm)}` +
    (m.motivo === 'grande' ? ' · grande demais' : m.motivo === 'erro' ? ' · falhou ao baixar' : '')
  el.querySelector('.detalhe').title = m.legenda || ''

  const feitas = m.figurinhas?.length ?? 0
  const f = el.querySelector('.feitas')
  f.textContent = feitas ? `✓ ${feitas} figurinha${feitas > 1 ? 's' : ''}` : ''
  f.classList.toggle('tem', feitas > 0)
  el.querySelector('.mostrar').hidden = !m.disponivel
  el.querySelector('.card-principal').title = bloqueado
    ? 'O WhatsApp não entrega visualização única ao bot. Responda a ela pelo celular (qualquer texto) para liberar.'
    : m.disponivel ? 'Clique para fazer a figurinha e enviar na conversa' : ''
}

function novoCard(m) {
  const el = $('#card').content.firstElementChild.cloneNode(true)
  el.querySelector('.card-principal').addEventListener('click', () => fazerFigurinha(el.dataset.id))
  el.querySelector('.mostrar').addEventListener('click', () => api(`/api/midias/${el.dataset.id}/mostrar`, { method: 'POST' }))
  el.querySelector('.apagar').addEventListener('click', () => apagar(el.dataset.id))
  preencherCard(el, m)
  return el
}

function renderizar() {
  const grade = $('#grade')
  const visiveis = [...midias.values()]
    .filter(m => passaNaPasta(m) && passaNaBusca(m))
    .sort((a, b) => b.recebidoEm - a.recebidoEm)
  const existentes = new Map([...grade.children].map(el => [el.dataset.id, el]))
  const nova = visiveis.map(m => {
    const el = existentes.get(m.id)
    if (el) { preencherCard(el, m); return el }
    return novoCard(m)
  })
  grade.replaceChildren(...nova)
  $('#vazio').hidden = visiveis.length > 0
  $('#titulo').textContent = TITULOS[filtro]
  $('#aviso-visu').hidden = !(filtro.startsWith('visualizacao-unica') ||
    (filtro === 'tudo' && [...midias.values()].some(m => m.motivo === 'visualizacao-unica')))
  contar()
}

// ---------- ações ----------
async function fazerFigurinha(id) {
  const m = midias.get(id)
  if (!m) return
  if (m.motivo === 'visualizacao-unica') {
    toast('Bloqueada pelo WhatsApp: responda a ela pelo celular (qualquer texto) e ela é liberada aqui.', 'erro')
    return
  }
  if (!m.disponivel) {
    toast(m.motivo === 'baixando' ? 'Ainda baixando, aguarde um instante...' : 'Essa mídia não foi baixada.', 'erro')
    return
  }
  const el = document.querySelector(`.card[data-id="${id}"]`)
  el?.setAttribute('data-enviando', '')
  el?.setAttribute('data-trabalhando', '')
  try {
    await api(`/api/midias/${id}/figurinha`, { method: 'POST' })
    toast(`Figurinha enviada em ${m.chatNome} ✨`, 'ok')
  } catch (err) {
    toast(`Não consegui: ${err.message}`, 'erro')
  } finally {
    el?.removeAttribute('data-enviando')
    if (midias.get(id)?.motivo !== 'baixando') el?.removeAttribute('data-trabalhando')
  }
}

async function apagar(id) {
  const m = midias.get(id)
  if (!m || !confirm(`Apagar esta mídia de ${m.chatNome} do computador?`)) return
  try {
    await api(`/api/midias/${id}`, { method: 'DELETE' })
  } catch (err) {
    toast(`Não consegui apagar: ${err.message}`, 'erro')
  }
}

// ---------- conexão ----------
function mostrarEstado(e) {
  const status = e.status ?? 'offline'
  $('#conexao').dataset.status = status
  $('#conexao-texto').textContent = e.detalhe && status !== 'conectado' ? e.detalhe : STATUS[status] ?? status
  $('#numero').textContent = e.eu ? `${e.eu.nome ? `${e.eu.nome} · ` : ''}+${e.eu.numero}` : 'não conectado'
  $('#conectar').hidden = status !== 'qr'
  if (e.qrSvg) $('#qr').innerHTML = e.qrSvg
  $('#conflito').hidden = status !== 'conflito'
}

function adicionarLinha({ em, nivel, texto }) {
  const li = document.createElement('li')
  li.className = nivel
  const t = document.createElement('time')
  t.textContent = new Date(em).toLocaleTimeString('pt-BR')
  li.append(t, texto)
  const lista = $('#linhas')
  const noFim = lista.scrollTop + lista.clientHeight >= lista.scrollHeight - 30
  lista.append(li)
  while (lista.children.length > 400) lista.firstChild.remove()
  if (noFim) lista.scrollTop = lista.scrollHeight
}

function conectarEventos() {
  const fonte = new EventSource('/api/eventos')
  fonte.addEventListener('estado', ev => mostrarEstado(JSON.parse(ev.data)))
  fonte.addEventListener('midia', ev => {
    const m = JSON.parse(ev.data)
    const nova = !midias.has(m.id)
    midias.set(m.id, m)
    if (nova) atualizarListaDeChats()
    renderizar()
  })
  fonte.addEventListener('removida', ev => {
    midias.delete(JSON.parse(ev.data).id)
    atualizarListaDeChats()
    renderizar()
  })
  fonte.addEventListener('log', ev => adicionarLinha(JSON.parse(ev.data)))
  fonte.onerror = () => mostrarEstado({ status: 'offline' })
  // ao reconectar, recarrega a lista (pode ter chegado coisa enquanto o painel estava sem conexão)
  fonte.onopen = () => carregar()
}

async function carregar() {
  const [lista, linhas] = await Promise.all([api('/api/midias'), api('/api/log')])
  midias.clear()
  for (const m of lista) midias.set(m.id, m)
  $('#linhas').replaceChildren()
  linhas.forEach(adicionarLinha)
  atualizarListaDeChats()
  renderizar()
}

// ---------- eventos da tela ----------
document.querySelectorAll('.pasta').forEach(botao => {
  botao.addEventListener('click', () => {
    filtro = botao.dataset.filtro
    document.querySelectorAll('.pasta').forEach(b => b.setAttribute('aria-current', String(b === botao)))
    renderizar()
  })
})
$('#busca').addEventListener('input', e => { busca = e.target.value.trim().toLowerCase(); renderizar() })
$('#filtro-chat').addEventListener('change', e => { chatEscolhido = e.target.value; renderizar() })
$('#abrir-pasta').addEventListener('click', () => api('/api/abrir-pasta', { method: 'POST' }))
$('#mostrar-atividade').addEventListener('click', () => {
  $('#atividade').hidden = false
  $('#linhas').scrollTop = $('#linhas').scrollHeight
})
$('#fechar-atividade').addEventListener('click', () => { $('#atividade').hidden = true })
$('#reconectar').addEventListener('click', () => api('/api/reconectar', { method: 'POST' }))
setInterval(renderizar, 60_000) // atualiza o "há X min"

conectarEventos()
