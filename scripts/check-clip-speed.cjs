/**
 * What a clip's own speed does to the file the encoder writes.
 *
 * The speed is a claim about TIME and the only place it can be checked is the finished file: how long
 * the export runs, how many frames it holds, and which clip is on screen at an instant the timeline
 * says belongs to the sped one. A filter string cannot answer any of those, so this runs the encoder's
 * own stitch path — the real one, not a copy of its arguments — over generated fixtures and reads the
 * result back.
 *
 * The fixtures are two one-colour clips joined end to end: red for two seconds, then green for one. The
 * red one is run at twice its speed, so the timeline is red for ONE second and green for the second
 * after it — one second shorter than the sources are, and a join that has moved with it. Everything
 * below follows from that: the length, the frame count, and which colour is on screen either side of
 * the cut.
 *
 * A control run with no speed at all is made beside it, because the property that matters most is that
 * a job which has never been retimed is the file it always was.
 *
 * Usage: node scripts/check-clip-speed.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { FFmpegEngine } = require('./.engine.cjs')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-speed-'))

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message)))
    else resolve(stdout)
  })
})
const runFfmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

/** A clip of one colour with a tone under it, at the rate and length asked for. */
const makeClip = async (name, colour, seconds) => {
  const file = path.join(work, `${name}.mp4`)
  await runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=${colour}:s=320x240:r=30:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${colour === 'red' ? 440 : 660}:sample_rate=48000:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ])
  return file
}

const secondsOf = async (file) => Number(String(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim())
const framesOf = async (file) => Number(String(await run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim())
/** Whether the file carries a sound stream at all, which is what says the retimed sound was written. */
const hasAudio = async (file) => String(await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim() === 'audio'
/** The colour at a point in the finished file: red inside the sped clip's run, green inside the next. */
const colourAt = async (file, time) => {
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'crop=2:2:100:100,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
  const [r, g, b] = [raw[0], raw[1], raw[2]]
  if (r > g && r > b) return 'red'
  if (g > r && g > b) return 'green'
  return 'other'
}

const preset = { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source', fps: 30, outputMode: 'video' }

let failures = 0
const check = (label, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) failures++
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label}${same ? '' : `\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`}`)
}

/** Runs one stitch to completion and hands back the file it wrote. */
const stitch = (sources, outputFilename, sourceSpeed) => new Promise((resolve, reject) => {
  const engine = new FFmpegEngine()
  const directory = path.join(work, `${outputFilename}-dir`)
  fs.mkdirSync(directory, { recursive: true })
  const task = {
    id: `job-${outputFilename}`, type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: sources, outputDirectory: directory, outputFilename,
    preset, ...(sourceSpeed ? { sourceSpeed } : {}),
  }
  engine.runTask(task, () => {}, () => resolve(path.join(directory, outputFilename)), (error) => reject(error))
})

;(async () => {
  const red = await makeClip('red', 'red', 2)
  const green = await makeClip('green', 'green', 1)

  console.log('\n== a clip run at twice its speed ==')
  const sped = await stitch([red, green], 'sped.mp4', { [`${red}#0`]: { speed: 2, interpolation: 'sampling' } })
  check('the export is the timeline length, not the sources\' own', Math.abs(await secondsOf(sped) - 2) < 0.2, true)
  check('and holds the frames that length at 30 fps', Math.abs(await framesOf(sped) - 60) <= 2, true)
  check('the sped picture is still there', await colourAt(sped, 0.4), 'red')
  // The join moved with the sped clip: the red clip is two source seconds and ONE timeline second, so a
  // second in is already the green one. A speed that shortened the picture without moving the cut would
  // show red here.
  check('and the cut after it lands where the sped length puts it', await colourAt(sped, 1.4), 'green')
  check('the sound was retimed beside the picture rather than dropped', await hasAudio(sped), true)

  console.log('\n== and a clip at its own speed is untouched ==')
  const plain = await stitch([red, green], 'plain.mp4', undefined)
  check('the export runs the whole of both clips', Math.abs(await secondsOf(plain) - 3) < 0.2, true)
  check('with every frame they had', Math.abs(await framesOf(plain) - 90) <= 2, true)
  check('the first clip is still on screen a second in', await colourAt(plain, 1.4), 'red')
  check('and the second after the cut at two', await colourAt(plain, 2.4), 'green')

  console.log('\n== a slow clip takes longer ==')
  const slow = await stitch([red, green], 'slow.mp4', { [`${red}#0`]: { speed: 0.5, interpolation: 'sampling' } })
  check('half speed runs the clip twice as long', Math.abs(await secondsOf(slow) - 5) < 0.3, true)
  check('so the cut after it moves out to four seconds', await colourAt(slow, 3.4), 'red')
  check('and the green one still follows it', await colourAt(slow, 4.4), 'green')

  console.log(failures === 0 ? '\nCLIP SPEED MATCHES THE EXPORT\n' : `\n${failures} CLIP SPEED CHECK(S) FAILED\n`)
  fs.rmSync(work, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
})().catch((error) => { console.error(error); fs.rmSync(work, { recursive: true, force: true }); process.exit(1) })
