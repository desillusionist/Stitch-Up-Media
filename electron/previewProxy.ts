import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { probeFile } from './ffmpeg/probe'
import { runFfmpeg } from './ffmpeg/run'
import { webviewPlaysVideo } from '../src/lib/previewCodec'

/**
 * A preview proxy: the file the monitors are actually handed.
 *
 * A Resolume DXV, a Hap, a ProRes, a DNxHD — anything the webview's decoder does not know — is read perfectly
 * well by FFMPEG and not at all by a `<video>`. This transcodes such a source to H.264 the once and remembers
 * where it put it, so the monitor, the filmstrip and the frame-accurate helper play the picture the export
 * would have made from the same frames.
 *
 * Two properties are non-negotiable and both are here:
 *
 *  - The SOURCE'S OWN RATE, passed straight through. Nothing writes `-r`, so a constant-rate source stays
 *    constant at its own rate and a variable one keeps its timestamps. This is what keeps a frame index, a
 *    trim point and the helper's in/out points meaning the same frame in the proxy as in the source.
 *  - The SOURCE'S OWN SIZE. The only filter is the even-dimension rounding 4:2:0 requires, which moves a
 *    dimension by at most one pixel and never re-scales. The monitor's fit, crop and output-frame arithmetic
 *    reads the source's natural size, so a downscaled proxy would make the framing preview lie.
 */

/** How hard the proxy is compressed. Visually lossless at a fraction of a lossless file's size. */
const PROXY_CRF = '18'
/** Generous: a long 4K source is a long transcode, and the bound is only there to catch a wedged decode. */
const PROXY_TIMEOUT_MS = 900000

export interface ProxyCache {
  [sourceKey: string]: string
}

/** What identifies one version of a source's proxy: the file, its size and its mtime. */
export const previewProxySourceKey = (filePath: string): string => {
  try {
    const info = fs.statSync(filePath)
    return `${filePath}\u0000${info.size}\u0000${Math.round(info.mtimeMs)}`
  } catch {
    return `${filePath}\u0000unreadable`
  }
}

/**
 * Where one source's proxy goes: its own directory under the cache, holding a file named after the SOURCE.
 *
 * The directory is named from the source's identity, so two files called `clip.mov` cannot collide; the FILE is
 * named after the source because the frame-accurate helper titles its window with the file it was handed, and a
 * title reading `3f9a1c-preview.mp4` would be a window that no longer names what is open. The extension is
 * `.mp4` whatever the source was: the contents are H.264, and a `.mkv` name would ask the muxer for a container
 * the webview cannot play — which is the whole reason the proxy exists.
 */
const proxyPathFor = (root: string, filePath: string): string => {
  const base = path.basename(filePath, path.extname(filePath)).replace(/[^\w .-]/g, '_').slice(0, 80) || 'source'
  const digest = createHash('sha1').update(previewProxySourceKey(filePath)).digest('hex').slice(0, 8)
  return path.join(root, `preview-${digest}`, `${base}.mp4`)
}

export const readProxyCache = (registryPath: string): ProxyCache => {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as unknown
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as ProxyCache : {}
  } catch {
    return {}
  }
}

export const writeProxyCache = (registryPath: string, cache: ProxyCache): void => {
  try {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true })
    fs.writeFileSync(registryPath, JSON.stringify(cache), 'utf8')
  } catch { /* a cache that cannot be written is a cache that is rebuilt */ }
}

/**
 * Writes the proxy. The arguments are the whole of what makes one: H.264, 4:2:0 at limited range — the pair
 * every Chromium build reads without argument — the source's own rate and size, and a length that is the
 * source's (nothing trims or slows it).
 */
export const buildPreviewProxy = async (inputPath: string, proxyPath: string): Promise<void> => {
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', PROXY_CRF, '-pix_fmt', 'yuv420p',
    // At most one pixel of rounding per axis, which 4:2:0 needs and which is not a re-scale.
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-color_range', 'tv',
    // The sound comes along, because a clip's embedded audio is played from this element too.
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    proxyPath,
  ], PROXY_TIMEOUT_MS)
}

export interface PreviewProxyDeps {
  /** Where generated files go, unless they are asked to sit beside their source. */
  cacheDirectory?: string
  saveTempNextToSource?: boolean
  /** The file the path-per-source mapping is kept in, so a proxy is built once and not once per run. */
  registryPath: string
  /** Records a generated file so the cache-clear knows it is ours to delete. */
  register: (filePath: string) => void
}

/**
 * The file the monitors should be given for a source.
 *
 * The source itself when a `<video>` can play it — the common case, and no work at all. Otherwise a proxy,
 * built once and remembered against the file's own size and mtime, so editing the file makes a new proxy and
 * nothing else does. `null` means a proxy was NEEDED and could not be built, which is the one answer a caller
 * has to say out loud rather than play a black frame about.
 */
export const previewProxyFor = async (inputPath: string, deps: PreviewProxyDeps): Promise<string | null> => {
  if (!inputPath) return inputPath
  let videoCodecs: string[] = []
  try {
    const probe = await probeFile(inputPath)
    videoCodecs = (probe.videoStreams || []).map((stream) => stream.codec)
  } catch {
    // A file that will not probe is handed over as it is. Whatever is wrong with it is not something a proxy
    // can fix, and the decode notice is the right answer rather than a second failure from here.
    return inputPath
  }
  const facts = { container: path.extname(inputPath).slice(1), videoCodecs }
  if (webviewPlaysVideo(facts)) return inputPath

  const key = previewProxySourceKey(inputPath)
  const cache = readProxyCache(deps.registryPath)
  const remembered = cache[key]
  if (remembered && fs.existsSync(remembered)) return remembered

  const root = deps.saveTempNextToSource
    ? path.dirname(inputPath)
    : (deps.cacheDirectory || path.join(os.tmpdir(), 'Stitch Up Media'))
  const proxyPath = proxyPathFor(root, inputPath)
  fs.mkdirSync(path.dirname(proxyPath), { recursive: true })
  try {
    await buildPreviewProxy(inputPath, proxyPath)
    deps.register(proxyPath)
    cache[key] = proxyPath
    writeProxyCache(deps.registryPath, cache)
    return proxyPath
  } catch {
    try { fs.unlinkSync(proxyPath) } catch {}
    return null
  }
}
