import { spawn } from 'node:child_process'
import { WAVEFORM_PEAKS, peaksFromSamples } from '../src/lib/waveform'

/**
 * A file's audio, decoded to mono 8 kHz float samples and bucketed into peaks — WITHOUT holding the event loop.
 *
 * The figures are the drawing's own and live in `waveform.ts`; what happens here is how the decode is run, and
 * that was wrong in two ways that met in one call. It used to be `execFileSync('ffmpeg', …)`, so the main
 * process — the one serving media to every window and answering the queue's own IPC — stood still for the whole
 * decode: a 24-minute six-channel wav is 849 MB to read, and the app was frozen while it read it. And `'ffmpeg'`
 * is a PATH lookup, which a Finder-launched app does not have — measured, its log said `spawnSync ffmpeg ENOENT`
 * and every waveform in the timeline was a flat line, in the packaged app only.
 *
 * So the binary is named outright (see `FFMPEG_BINARY`) and the child is awaited rather than blocked on. The
 * buffer is still bounded, because a decode that is not bounded is a decode that can take the process with it.
 */
const MAX_DECODED_BYTES = 256 * 1024 * 1024

export const peaksForFile = (filePath: string, binary: string, buckets: number = WAVEFORM_PEAKS): Promise<number[] | null> => new Promise((resolve, reject) => {
  const child = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const chunks: Buffer[] = []
  let size = 0
  let stderr = ''
  let settled = false

  const fail = (error: Error) => {
    if (settled) return
    settled = true
    child.kill('SIGKILL')
    reject(error)
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > MAX_DECODED_BYTES) { fail(new Error(`decoded audio past ${MAX_DECODED_BYTES} bytes`)); return }
    chunks.push(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 65536) stderr += chunk.toString() })
  child.on('error', fail)
  child.on('close', (code) => {
    if (settled) return
    settled = true
    if (code !== 0) { reject(new Error(`${binary} exited with ${code}: ${stderr.trim().slice(-400)}`)); return }
    const raw = Buffer.concat(chunks)
    const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4))
    resolve(samples.length ? peaksFromSamples(samples, buckets) : null)
  })
})
