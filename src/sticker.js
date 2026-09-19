// Conversões com ffmpeg/sharp: mídia -> figurinha, figurinha -> mídia e miniaturas do painel.
import sharp from 'sharp'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const MAX_BYTES = 490_000 // WhatsApp aceita até ~500 KB em figurinha animada
const MAX_BYTES_STATIC = 100_000 // e até 100 KB em figurinha estática
const MAX_SECONDS = 10
// fps e qualidade testados em ordem até o arquivo caber no limite
const ATTEMPTS = [[15, 50], [12, 40], [10, 30], [10, 20], [8, 15], [6, 10], [5, 5]]
const STATIC_QUALITIES = [90, 75, 60, 45, 30, 15]
const FIT_512 = 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,' +
                'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000'

// o instalador traz o ffmpeg em runtime/; fora dele, usa o que estiver no PATH
function findFfmpeg() {
  const embutido = fileURLToPath(new URL(`../runtime/ffmpeg${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
  if (existsSync(embutido)) return embutido
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    return execFileSync(cmd, ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || 'ffmpeg'
  } catch {
    return 'ffmpeg'
  }
}
export const FFMPEG = findFfmpeg()

// roda fn com uma pasta temporária que é apagada no final
async function withTemp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'figurinha-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

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
    if (size <= MAX_BYTES_STATIC) return readFile(out)
  }
  throw new Error('não consegui deixar a figurinha abaixo de 100 KB')
}

// mídia (buffer) -> figurinha webp
export function mediaToSticker(buffer, animated) {
  return withTemp(async dir => {
    const input = path.join(dir, animated ? 'input.mp4' : 'input.img')
    await writeFile(input, buffer)
    return animated ? videoToSticker(input, dir) : imageToSticker(input, dir)
  })
}

// figurinha -> foto (estática) ou vídeo (animada), para editar e mandar de novo.
// O ffmpeg não lê WebP animado, então o sharp tira os quadros para um GIF primeiro.
// Fundo transparente vira branco (foto/vídeo do WhatsApp não têm transparência).
export async function stickerToMedia(buffer) {
  const { pages = 1 } = await sharp(buffer, { animated: true }).metadata()
  if (pages <= 1) {
    // corta as bordas transparentes que deixam a figurinha quadrada (se falhar, usa a imagem inteira)
    const trimmed = await sharp(buffer).trim().toBuffer().catch(() => buffer)
    const image = await sharp(trimmed).flatten({ background: '#ffffff' }).jpeg({ quality: 95 }).toBuffer()
    return { image }
  }
  return withTemp(async dir => {
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
  })
}

// miniatura jpg (lado maior 360px) para o painel; vídeo/GIF usa um quadro do começo
export async function makeThumb(file, animated, out) {
  if (!animated) {
    await sharp(file).rotate().resize(360, 360, { fit: 'inside' }).jpeg({ quality: 78 }).toFile(out)
    return
  }
  await withTemp(async dir => {
    const frame = path.join(dir, 'frame.png')
    await run(FFMPEG, ['-y', '-v', 'error', '-ss', '0.3', '-i', file, '-frames:v', '1', frame])
      .catch(() => run(FFMPEG, ['-y', '-v', 'error', '-i', file, '-frames:v', '1', frame]))
    await sharp(frame).resize(360, 360, { fit: 'inside' }).jpeg({ quality: 78 }).toFile(out)
  })
}

// duração em segundos (para mostrar no card); null se não der para ler
export async function mediaDuration(file) {
  try {
    const { stderr } = await run(FFMPEG, ['-hide_banner', '-i', file]).catch(e => e)
    const m = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(stderr ?? '')
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
  } catch {
    return null
  }
}
