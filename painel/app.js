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
  el.toggleAttribute('data-selecionado', selecionadas.has(m.id))
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
  // no modo seleção o clique marca/desmarca; fora dele, faz a figurinha
  el.querySelector('.card-principal').addEventListener('click', () => {
    if (selecionando) alternarSelecao(el.dataset.id)
    else fazerFigurinha(el.dataset.id)
  })
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
  atualizarBarraSelecao()
}

// ---------- modo seleção (apagar várias) ----------
let selecionando = false
const selecionadas = new Set()

function visiveisAgora() {
  return [...midias.values()].filter(m => passaNaPasta(m) && passaNaBusca(m))
}

function entrarSelecao(ligar) {
  selecionando = ligar
  if (!ligar) selecionadas.clear()
  document.body.classList.toggle('selecionando', ligar)
  $('#modo-selecao').setAttribute('aria-pressed', String(ligar))
  $('#barra-selecao').hidden = !ligar
  renderizar()
}

function alternarSelecao(id) {
  if (selecionadas.has(id)) selecionadas.delete(id)
  else selecionadas.add(id)
  document.querySelector(`.card[data-id="${id}"]`)?.toggleAttribute('data-selecionado', selecionadas.has(id))
  atualizarBarraSelecao()
}

function atualizarBarraSelecao() {
  for (const id of selecionadas) if (!midias.has(id)) selecionadas.delete(id) // apagadas por outro caminho
  const n = selecionadas.size
  $('#selecao-texto').textContent = n ? `${n} selecionada${n > 1 ? 's' : ''}` : 'Nenhuma selecionada'
  $('#apagar-selecionadas').disabled = n === 0
  const visiveis = visiveisAgora()
  const todas = visiveis.length > 0 && visiveis.every(m => selecionadas.has(m.id))
  $('#selecionar-todas').textContent = todas ? 'Desmarcar todas' : 'Selecionar todas'
}

async function apagarSelecionadas() {
  const ids = [...selecionadas]
  if (!ids.length || !confirm(`Apagar ${ids.length} mídia${ids.length > 1 ? 's' : ''} do computador?`)) return
  $('#apagar-selecionadas').disabled = true
  try {
    const { apagadas } = await api('/api/midias/apagar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    })
    toast(`${apagadas} mídia${apagadas === 1 ? '' : 's'} apagada${apagadas === 1 ? '' : 's'}`, 'ok')
    entrarSelecao(false)
  } catch (err) {
    toast(`Não consegui apagar: ${err.message}`, 'erro')
    atualizarBarraSelecao()
  }
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
  if (e.config) mostrarComando(e.config.comandoAtivo)
}

function mostrarComando(ativo) {
  $('#comando-ativo').checked = ativo
  $('#comando-texto').textContent = ativo ? 'Ativo no WhatsApp' : 'Desligado — só pelo painel'
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
  fonte.addEventListener('usuario', ev => {
    const u = JSON.parse(ev.data)
    usuarios.set(u.numero, u)
    renderizarUsuarios()
  })
  // mudou um cargo: o cargo efetivo e as contagens dos usuários podem ter mudado junto
  fonte.addEventListener('cargos', () => carregarPessoas())
  fonte.onerror = () => mostrarEstado({ status: 'offline' })
  // ao reconectar, recarrega a lista (pode ter chegado coisa enquanto o painel estava sem conexão)
  fonte.onopen = () => carregar()
}

async function carregar() {
  const [lista, linhas] = await Promise.all([api('/api/midias'), api('/api/log'), carregarPessoas()])
  midias.clear()
  for (const m of lista) midias.set(m.id, m)
  $('#linhas').replaceChildren()
  linhas.forEach(adicionarLinha)
  atualizarListaDeChats()
  renderizar()
}

// ---------- usuários e cargos ----------
const usuarios = new Map()
let cargos = { cargoPadrao: null, cargos: [], permissoes: {} }
let buscaUsuarios = ''
let cargoFiltrado = ''

function mostrarVista(vista) {
  $('#vista-midias').hidden = vista !== 'midias'
  $('#vista-usuarios').hidden = vista !== 'usuarios'
  $('#vista-cargos').hidden = vista !== 'cargos'
}

async function carregarPessoas() {
  const [lista, c] = await Promise.all([api('/api/usuarios'), api('/api/cargos')])
  cargos = c
  usuarios.clear()
  for (const u of lista) usuarios.set(u.numero, u)
  renderizarCargos()
  renderizarUsuarios()
}

const cargoPorId = id => cargos.cargos.find(c => c.id === id)

function formatarNumero(u) {
  if (u.semTelefone) return 'sem telefone (id interno do WhatsApp)'
  const n = u.numero
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(n)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${n}`
}

function renderizarUsuarios() {
  $('#conta-usuarios').textContent = usuarios.size
  const filtro = $('#filtro-cargo')
  const atual = filtro.value
  filtro.replaceChildren(new Option('Todos os cargos', ''), ...cargos.cargos.map(c => new Option(c.nome, c.id)))
  filtro.value = cargoPorId(atual) ? atual : ''

  const visiveis = [...usuarios.values()]
    .filter(u => !cargoFiltrado || u.cargoEfetivo === cargoFiltrado)
    .filter(u => !buscaUsuarios || `${u.nome ?? ''} ${u.numero}`.toLowerCase().includes(buscaUsuarios))
    .sort((a, b) => (b.ultimoContato ?? 0) - (a.ultimoContato ?? 0))

  const linhas = visiveis.map(u => {
    const tr = document.createElement('tr')
    const pessoa = document.createElement('td')
    const nome = u.nome || formatarNumero(u)
    pessoa.innerHTML = '<div class="pessoa"><span class="avatar"></span><div><strong></strong><span class="sutil"></span></div></div>'
    pessoa.querySelector('.avatar').textContent = [...nome.replace(/^\+/, '')][0]?.toUpperCase() ?? '?'
    pessoa.querySelector('strong').textContent = nome
    pessoa.querySelector('.sutil').textContent = u.nome ? formatarNumero(u) : ''

    const tdCargo = document.createElement('td')
    const caixa = document.createElement('span')
    caixa.className = 'seletor-cargo'
    const select = document.createElement('select')
    select.setAttribute('aria-label', `Cargo de ${nome}`)
    const padrao = cargoPorId(cargos.cargoPadrao)
    select.append(new Option(`Padrão (${padrao?.nome ?? '—'})`, ''), ...cargos.cargos.map(c => new Option(c.nome, c.id)))
    select.value = u.cargo && cargoPorId(u.cargo) ? u.cargo : ''
    caixa.style.setProperty('--cor-cargo', cargoPorId(u.cargoEfetivo)?.cor ?? '')
    select.addEventListener('change', () => mudarCargo(u.numero, select.value || null))
    caixa.append(select)
    tdCargo.append(caixa)

    const tdComandos = document.createElement('td')
    tdComandos.className = 'num'
    tdComandos.textContent = u.comandos ?? 0
    const tdContato = document.createElement('td')
    tdContato.className = 'sutil'
    tdContato.textContent = u.ultimoContato ? tempoRelativo(u.ultimoContato) : '—'
    tr.append(pessoa, tdCargo, tdComandos, tdContato)
    return tr
  })
  $('#lista-usuarios').replaceChildren(...linhas)
  $('#usuarios-vazio').hidden = visiveis.length > 0
}

async function mudarCargo(numero, cargo) {
  try {
    const u = await api(`/api/usuarios/${numero}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cargo }),
    })
    usuarios.set(u.numero, u)
    renderizarUsuarios()
    toast(`${u.nome || formatarNumero(u)} agora é ${cargoPorId(u.cargoEfetivo)?.nome}`, 'ok')
  } catch (err) {
    toast(`Não consegui mudar o cargo: ${err.message}`, 'erro')
    renderizarUsuarios()
  }
}

// interruptores de permissão (usados nos cards de cargo e no formulário de cargo novo)
function montarPermissoes(caixa, valores, aoMudar) {
  caixa.replaceChildren(...Object.entries(cargos.permissoes).map(([chave, rotulo]) => {
    const label = document.createElement('label')
    label.className = 'permissao'
    label.innerHTML = '<span></span><input type="checkbox" role="switch"><span class="trilho" aria-hidden="true"></span>'
    label.querySelector('span').textContent = rotulo
    const input = label.querySelector('input')
    input.name = chave
    input.checked = !!valores?.[chave]
    if (aoMudar) input.addEventListener('change', () => aoMudar(chave, input.checked))
    return label
  }))
}

async function editarCargo(id, campos) {
  try {
    await api(`/api/cargos/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campos),
    })
  } catch (err) {
    toast(`Não consegui salvar o cargo: ${err.message}`, 'erro')
    carregarPessoas()
  }
}

function renderizarCargos() {
  $('#conta-cargos').textContent = cargos.cargos.length
  const cards = cargos.cargos.map(c => {
    const el = $('#cargo').content.firstElementChild.cloneNode(true)
    el.style.setProperty('--cor-cargo', c.cor)
    const cor = el.querySelector('.cargo-cor')
    cor.value = c.cor
    cor.addEventListener('change', () => editarCargo(c.id, { cor: cor.value }))
    const nome = el.querySelector('.cargo-nome')
    nome.value = c.nome
    nome.addEventListener('change', () => editarCargo(c.id, { nome: nome.value }))
    nome.addEventListener('keydown', e => { if (e.key === 'Enter') nome.blur() })
    montarPermissoes(el.querySelector('[data-permissoes]'), c.permissoes,
      (chave, valor) => editarCargo(c.id, { permissoes: { [chave]: valor } }))
    const rodape = el.querySelector('.cargo-rodape')
    rodape.textContent = `${c.usuarios} usuário${c.usuarios === 1 ? '' : 's'}`
    if (c.id === cargos.cargoPadrao) {
      const selo = document.createElement('span')
      selo.className = 'selo-padrao'
      selo.textContent = 'padrão para quem chega'
      rodape.append(selo)
    }
    el.querySelector('.cargo-apagar').addEventListener('click', async () => {
      if (!confirm(`Apagar o cargo "${c.nome}"? Quem tem esse cargo passa a usar o cargo padrão.`)) return
      try {
        await api(`/api/cargos/${c.id}`, { method: 'DELETE' })
      } catch (err) {
        toast(`Não consegui apagar: ${err.message}`, 'erro')
      }
    })
    return el
  })
  $('#lista-cargos').replaceChildren(...cards)

  const padrao = $('#cargo-padrao')
  padrao.replaceChildren(...cargos.cargos.map(c => new Option(c.nome, c.id)))
  padrao.value = cargos.cargoPadrao

  const novo = $('#novo-cargo [data-permissoes]')
  if (!novo.children.length) montarPermissoes(novo, { foto: true, video: true, visuUnica: false, moeda: true, dados: true })
}

// ---------- eventos da tela ----------
document.querySelectorAll('.pasta').forEach(botao => {
  botao.addEventListener('click', () => {
    document.querySelectorAll('.pasta').forEach(b => b.setAttribute('aria-current', String(b === botao)))
    if (botao.dataset.vista) {
      mostrarVista(botao.dataset.vista)
      return
    }
    filtro = botao.dataset.filtro
    mostrarVista('midias')
    renderizar()
  })
})
$('#busca').addEventListener('input', e => { busca = e.target.value.trim().toLowerCase(); renderizar() })
$('#modo-selecao').addEventListener('click', () => entrarSelecao(!selecionando))
$('#cancelar-selecao').addEventListener('click', () => entrarSelecao(false))
$('#apagar-selecionadas').addEventListener('click', apagarSelecionadas)
$('#selecionar-todas').addEventListener('click', () => {
  const visiveis = visiveisAgora()
  const todas = visiveis.every(m => selecionadas.has(m.id))
  for (const m of visiveis) todas ? selecionadas.delete(m.id) : selecionadas.add(m.id)
  renderizar()
})
document.addEventListener('keydown', e => { if (e.key === 'Escape' && selecionando) entrarSelecao(false) })
$('#busca-usuarios').addEventListener('input', e => { buscaUsuarios = e.target.value.trim().toLowerCase(); renderizarUsuarios() })
$('#filtro-cargo').addEventListener('change', e => { cargoFiltrado = e.target.value; renderizarUsuarios() })
$('#cargo-padrao').addEventListener('change', async e => {
  try {
    await api('/api/cargos/padrao', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.target.value }),
    })
    toast(`Quem chegar agora entra como ${cargoPorId(e.target.value)?.nome}`, 'ok')
  } catch (err) {
    toast(`Não consegui mudar: ${err.message}`, 'erro')
  }
})
$('#novo-cargo').addEventListener('submit', async e => {
  e.preventDefault()
  const form = e.target
  const permissoes = Object.fromEntries([...form.querySelectorAll('[data-permissoes] input')].map(i => [i.name, i.checked]))
  try {
    const c = await api('/api/cargos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: form.nome.value, cor: form.cor.value, permissoes }),
    })
    form.nome.value = ''
    toast(`Cargo "${c.nome}" criado`, 'ok')
  } catch (err) {
    toast(`Não consegui criar: ${err.message}`, 'erro')
  }
})
$('#filtro-chat').addEventListener('change', e => { chatEscolhido = e.target.value; renderizar() })
$('#abrir-pasta').addEventListener('click', () => api('/api/abrir-pasta', { method: 'POST' }))
$('#mostrar-atividade').addEventListener('click', () => {
  $('#atividade').hidden = false
  $('#linhas').scrollTop = $('#linhas').scrollHeight
})
$('#fechar-atividade').addEventListener('click', () => { $('#atividade').hidden = true })
$('#reconectar').addEventListener('click', () => api('/api/reconectar', { method: 'POST' }))
$('#comando-ativo').addEventListener('change', async e => {
  const ativo = e.target.checked
  e.target.disabled = true
  try {
    const cfg = await api('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comandoAtivo: ativo }),
    })
    mostrarComando(cfg.comandoAtivo)
    toast(cfg.comandoAtivo ? 'Comando !s ativado no WhatsApp' : 'Comando !s desligado', 'ok')
  } catch (err) {
    mostrarComando(!ativo)
    toast(`Não consegui mudar: ${err.message}`, 'erro')
  } finally {
    e.target.disabled = false
  }
})
setInterval(renderizar, 60_000) // atualiza o "há X min"

conectarEventos()
