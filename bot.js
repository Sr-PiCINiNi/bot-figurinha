// Bot Figurinha: painel local (http://127.0.0.1:3777) + WhatsApp.
// - Mídias recebidas aparecem no painel, separadas em Visualização única / Normais (Fotos e Vídeos);
//   um clique faz a figurinha e manda na conversa de onde a mídia veio.
// - No WhatsApp, !s na legenda ou respondendo uma mídia faz a figurinha; !s numa figurinha desfaz.
import { readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { log, logErro } from './src/log.js'
import { FFMPEG } from './src/sticker.js'
import { iniciarStore, limparAntigas } from './src/store.js'
import { iniciarPainel, PORTA } from './src/painel.js'
import { iniciarWhatsApp } from './src/whatsapp.js'

// mídias guardadas: mais velhas que isto são apagadas, e as mais antigas saem se passar do limite
const MIDIA_DIAS = 30
const MIDIA_MAX_MB = 5000
// código de saída quando já existe outra cópia rodando (o BotFigurinha.exe não reinicia nesse caso)
const SAIDA_JA_RODANDO = 3

// ---- uma cópia só: duas conectadas com a mesma sessão se derrubam sem parar (erro 440) ----
const TRAVA = 'bot.lock'
function processoVivo(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}
try {
  const pid = Number(readFileSync(TRAVA, 'utf8'))
  if (pid && pid !== process.pid && processoVivo(pid)) {
    logErro(`Já existe uma cópia do bot rodando (processo ${pid}). Abra o painel: http://127.0.0.1:${PORTA}`)
    process.exit(SAIDA_JA_RODANDO)
  }
} catch {}
writeFileSync(TRAVA, String(process.pid))
const soltarTrava = () => {
  try {
    if (Number(readFileSync(TRAVA, 'utf8')) === process.pid) rmSync(TRAVA)
  } catch {}
}
process.on('exit', soltarTrava)
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sinal, () => process.exit(0))

process.on('unhandledRejection', err => logErro('❌ Erro não tratado:', err?.stack ?? err))
// erro grave: sai para o BotFigurinha.exe (ou pm2) reiniciar do zero
process.on('uncaughtException', err => {
  logErro('💥 Erro grave, reiniciando:', err.stack ?? err)
  process.exit(1)
})

// figurinhas feitas antes do painel guardavam o original em originais/; some sozinho depois de 30 dias
function limparOriginaisAntigos() {
  const limite = Date.now() - MIDIA_DIAS * 86_400_000
  try {
    for (const f of readdirSync('originais')) {
      const arquivo = path.join('originais', f)
      if (statSync(arquivo).mtimeMs < limite) rmSync(arquivo)
    }
  } catch {}
}

async function manutencao() {
  await limparAntigas(MIDIA_DIAS, MIDIA_MAX_MB).catch(err => logErro('Limpeza de mídias:', err.message))
  limparOriginaisAntigos()
}

log(`Iniciando... ffmpeg: ${FFMPEG}`)
await iniciarStore()
try {
  await iniciarPainel()
} catch (err) {
  logErro(`Não consegui abrir o painel na porta ${PORTA}: ${err.message}`)
  process.exit(1)
}
await manutencao()
setInterval(manutencao, 6 * 3_600_000)
await iniciarWhatsApp()
