/**
 * Every codec the PRESET list offers, put through the real encoder.
 *
 * The list is a claim: that a MOV can hold a DXV, that a Hap is a Hap, that the ProRes entries really do
 * differ by profile. Those are claims about the machine's own ffmpeg rather than about the table, and the
 * way to settle them is to export one file through the engine's own path — not a copy of its arguments —
 * and read back what came out. A choice that cannot be written is worse than a choice that is missing: it
 * is an option that fails the whole job long after the reader picked it.
 *
 * `COPY THE SOURCE` is deliberately not exercised: whether a passthrough is legal depends on the SOURCE
 * rather than on the container, which is a decision the reader makes with the file in hand.
 *
 * The still containers are exercised with a single frame, and the movie ones with a second of footage, so
 * the probe reads a file with a picture in it either way.
 *
 * Usage: node scripts/check-codec-choices.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { FFmpegEngine } = require('./.engine.cjs')
const { codecChoicesFor } = require('./.codecChoices.cjs')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'codec-choices-'))

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message)))
    else resolve(stdout)
  })
})

/** What ffmpeg calls each codec the preset can be set to. */
const CODEC_NAME = {
  h264: 'h264', hevc: 'hevc', prores: 'prores', vp9: 'vp9', av1: 'av1',
  dxv: 'dxv', hap: 'hap', mpeg4: 'mpeg4', qtrle: 'qtrle', png: 'png', mjpeg: 'mjpeg', gif: 'gif',
}

/** Every container the list can be asked for, and whether the job it is asked with is a still. */
const CONTAINERS = ['mp4', 'mov', 'mkv', 'webm', 'gif', 'png', 'jpg']
const STILL_CONTAINERS = ['gif', 'png', 'jpg']
/**
 * The sound each container is given here, which is the sound it can actually hold.
 *
 * WebM takes Vorbis or Opus and refuses an AAC outright — "Only VP8 or VP9 or AV1 video and Vorbis or
 * Opus audio are supported" — so a WebM job with the default AAC fails on its SOUND rather than on its
 * picture, which would say nothing about the codecs under test.
 */
const audioFor = (container) => (container === 'webm' ? 'opus' : 'aac')

let failures = 0
const check = (label, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) failures++
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label}${same ? '' : `\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`}`)
}

/** One export through the engine's own path, and the codec of the picture it wrote. */
const exportWith = (source, container, choice) => new Promise((resolve, reject) => {
  const directory = path.join(work, `${container}-${choice.value}`)
  fs.mkdirSync(directory, { recursive: true })
  const outputFilename = `out.${container}`
  const still = STILL_CONTAINERS.includes(container)
  const engine = new FFmpegEngine()
  engine.runTask({
    id: `codec-${container}-${choice.value}`, type: 'transcode', status: 'pending', progress: 0,
    sourcePaths: [source], outputDirectory: directory, outputFilename,
    preset: {
      id: 'p', name: 'P', container, audioCodec: audioFor(container), resolution: 'source', outputMode: 'video',
      videoCodec: choice.videoCodec,
      ...(choice.proresProfile ? { proresProfile: choice.proresProfile } : {}),
      ...(still ? { imageOutputMode: 'still' } : {}),
    },
  }, () => {}, () => resolve(path.join(directory, outputFilename)), (error) => reject(error))
})

/** The codec of the file's first picture, which is what says whether the choice was really written. */
const videoCodec = async (file) => {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', file])
  return String(out).trim()
}

;(async () => {
  // A frame size every codec here accepts: four-by-four blocks are the strictest of them.
  const source = path.join(work, 'source.mp4')
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source])

  for (const container of CONTAINERS) {
    console.log(`\n== ${container.toUpperCase()} ==`)
    const choices = codecChoicesFor(container).filter((choice) => !choice.reason && choice.videoCodec !== 'copy')
    if (!choices.length) { check(`${container} offers something to encode with`, false, true); continue }
    for (const choice of choices) {
      const label = `${choice.value}${choice.proresProfile ? ` (${choice.proresProfile})` : ''}`
      try {
        const file = await exportWith(source, container, choice)
        check(`${container} writes ${label}`, await videoCodec(file), CODEC_NAME[choice.videoCodec])
      } catch (error) {
        failures++
        console.log(`FAIL ${container} ${label} did not export at all\n       ${String(error).split('\n')[0].slice(0, 200)}`)
      }
    }
  }

  console.log(failures === 0 ? '\nEVERY OFFERED CODEC EXPORTS\n' : `\n${failures} CODEC(S) FAILED\n`)
  fs.rmSync(work, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
})().catch((error) => { console.error(error); fs.rmSync(work, { recursive: true, force: true }); process.exit(1) })
