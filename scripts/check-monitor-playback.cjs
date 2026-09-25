/**
 * How fast the monitor's picture actually moves, and how often the element is seeked.
 *
 * The app's own playback hook, the app's own media URL and a real video, rendered twice: once with the
 * <video>'s ref handed the hook's own stable callback, and once with the ref written as an inline arrow
 * that also logs — which is a NEW function on every render, so React detaches and reattaches it every
 * time, and every reattach re-runs the hook's load handler.
 *
 * What must hold: how the ref is WRITTEN must not change how fast the picture moves. It does, and this
 * is the harness that says so in numbers rather than in a description.
 *
 * The source is generated rather than taken from a library, so this is a guard that runs anywhere
 * ffmpeg does. It is deliberately a real 1080p file with sound: the number the defect moves is the
 * SEEK COST, so a fixture too small or too cheap would hide it.
 *
 * Usage: electron scripts/check-monitor-playback.cjs [video-with-audio] [seconds]
 */
const { app, BrowserWindow, protocol } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { Readable } = require('node:stream')
const { resolveByteRange, mimeTypeFor } = require('./.mediaRange.cjs')

const PROVIDED = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null
const SAMPLE_SECONDS = Number(process.argv[3] || 2.5)
if (PROVIDED && !fs.existsSync(PROVIDED)) {
  console.error(`no such file: ${PROVIDED}`)
  app.exit(2)
}

// The same handler privileges the app registers, so the harness plays the file the way the monitor does.
protocol.registerSchemesAsPrivileged([{ scheme: 'stitch-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }])

/** One run of one variant: play, wait, and read what the picture did. */
const measure = `(async () => {
  const v = document.querySelector('video')
  if (!v) return { HARNESS_ERROR: 'no video element' }
  try {
    await new Promise((resolve, reject) => {
      if (v.readyState >= 2) return resolve()
      v.addEventListener('loadeddata', () => resolve(), { once: true })
      v.addEventListener('error', () => reject(new Error('media error ' + (v.error && v.error.code))), { once: true })
      setTimeout(() => reject(new Error('no data after 20s')), 20000)
    })
  } catch (error) { return { HARNESS_ERROR: String(error && error.message) } }
  let seeks = 0
  v.addEventListener('seeking', () => { seeks += 1 })
  window.__renders = 0
  window.__playback.toggle()
  const t0 = performance.now(), c0 = v.currentTime
  await new Promise((resolve) => setTimeout(resolve, ${Math.round(SAMPLE_SECONDS * 1000)}))
  const t1 = performance.now(), c1 = v.currentTime
  window.__playback.pause()
  const wall = (t1 - t0) / 1000
  return {
    sourceDuration: +v.duration.toFixed(3),
    advanced: +(c1 - c0).toFixed(3),
    wall: +wall.toFixed(3),
    rate: +((c1 - c0) / wall).toFixed(3),
    seeks,
    renders: window.__renders,
    readyState: v.readyState,
  }
})()`

/**
 * A WHEEL GESTURE WHILE PLAYING, which is the two-writers fault AND the sound's own behaviour.
 *
 * A wheel fires faster than a render, so the old `seek` path left the auto-advance clock writing the playhead
 * as well and the two fought at every boundary. What is measured here is that the gesture is HONOURED — a delta
 * applied to the hook's own position accumulates rather than being lost — that the transport RESUMES from the
 * settled playhead rather than stalling, and that the SOUND keeps playing through it: the added track is not
 * paused (which was the regression), it is driven by RATE (so it is sped with the wheel), it is not seeked on
 * every tick (which was the jog), and it is handed back its ordinary rate at the end.
 */
const scrubMeasure = `(async () => {
  const v = document.querySelector('video')
  const a = window.__audio
  const p = window.__playback
  if (!v || !p) return { HARNESS_ERROR: 'no video element or playback hook' }
  if (!a) return { HARNESS_ERROR: 'the added track never mounted' }
  if (typeof p.scrubBy !== 'function') return { HARNESS_ERROR: 'the playback hook has no scrubBy' }
  try {
    await new Promise((resolve, reject) => {
      if (v.readyState >= 2) return resolve()
      v.addEventListener('loadeddata', () => resolve(), { once: true })
      v.addEventListener('error', () => reject(new Error('media error ' + (v.error && v.error.code))), { once: true })
      setTimeout(() => reject(new Error('no data after 20s')), 20000)
    })
  } catch (error) { return { HARNESS_ERROR: String(error && error.message) } }
  p.toggle()
  await new Promise((resolve) => setTimeout(resolve, 300))
  // The playback object is re-minted every render, so its fields are a SNAPSHOT: position and playing are
  // re-read from the live handle each time (the hook publishes it every render), while the callbacks are stable.
  const live = () => window.__playback
  const startPos = live().position
  // Counted from HERE, so the reading is the seeks the GESTURE caused and not the ones a load or the settle did.
  let audioSeeks = 0
  a.addEventListener('seeking', () => { audioSeeks += 1 })
  let audioPausedDuring = false
  let videoPausedDuring = false
  let audioRatePeak = 0
  // Thirty ticks, ten milliseconds apart: a flick, and deliberately faster than the render that would carry a
  // rendered position forward — which is exactly why the delta is applied to the hook's own figure.
  for (let i = 0; i < 30; i++) {
    live().scrubBy(0.05)
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (a.paused) audioPausedDuring = true
    if (v.paused) videoPausedDuring = true
    if (a.playbackRate > audioRatePeak) audioRatePeak = a.playbackRate
  }
  const audioSeeksDuring = audioSeeks
  const midPos = live().position
  // Let the gesture fall idle and the transport pick up again.
  await new Promise((resolve) => setTimeout(resolve, 500))
  const resumed = live().playing
  const audioRateAfter = a.playbackRate
  const audioPausedAfter = a.paused
  const t0 = performance.now(), c0 = v.currentTime
  await new Promise((resolve) => setTimeout(resolve, 700))
  const c1 = v.currentTime
  const resumedRate = (c1 - c0) / ((performance.now() - t0) / 1000)
  live().pause()
  return {
    startPos: +startPos.toFixed(3), midPos: +midPos.toFixed(3), scrubDelta: +(midPos - startPos).toFixed(3),
    resumed, resumedRate: +resumedRate.toFixed(3),
    audioPausedDuring, videoPausedDuring, audioRatePeak: +audioRatePeak.toFixed(3),
    audioRateAfter: +audioRateAfter.toFixed(3), audioPausedAfter, audioSeeksDuring,
  }
})()`

/**
 * The two transport faults the keys are about.
 *
 * SLOW MOTION MUST MOVE. K pauses, and K+J / K+L then sets a shuttle rate — with the readout saying 0.5x while
 * the playhead stands still, which is the fault as reported. This drives the hook exactly as the keys do and
 * measures that the playhead ADVANCES at the slow rate.
 *
 * A STOP OR A PLAY PUTS THE SPEED BACK. L accelerates the shared speed, and the selector showed the raised
 * figure long after K or Space, so the only way back to 1x was to pick it. This sets 2x and checks both keys
 * return it to the ordinary speed.
 */
const keysMeasure = `(async () => {
  const v = document.querySelector('video')
  const p = window.__playback
  if (!v || !p) return { HARNESS_ERROR: 'no video element or playback hook' }
  try {
    await new Promise((resolve, reject) => {
      if (v.readyState >= 2) return resolve()
      v.addEventListener('loadeddata', () => resolve(), { once: true })
      v.addEventListener('error', () => reject(new Error('media error ' + (v.error && v.error.code))), { once: true })
      setTimeout(() => reject(new Error('no data after 20s')), 20000)
    })
  } catch (error) { return { HARNESS_ERROR: String(error && error.message) } }
  const live = () => window.__playback
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  // SLOW MOTION: stop (as K does), set the rate the hold sets, and it must run.
  live().pause()
  live().setShuttleRate(0.5)
  await sleep(150)
  const slowStart = live().position
  const slowPlaying = live().playing
  await sleep(600)
  const slowEnd = live().position
  live().pause()
  // THE RESET: L leaves the shared speed raised; K (pause) and Space (toggle) must put it back to ordinary.
  live().setSpeed(2)
  await sleep(40)
  const speedSet = live().speed
  live().pause()
  await sleep(40)
  const speedAfterStop = live().speed
  live().setSpeed(2)
  await sleep(40)
  live().toggle()
  await sleep(40)
  const speedAfterPlay = live().speed
  live().pause()
  return {
    slowPlaying,
    slowAdvanced: +(slowEnd - slowStart).toFixed(3),
    speedSet, speedAfterStop, speedAfterPlay,
  }
})()`

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  execFile('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message)))
    else resolve()
  })
})

/** The source's own length, which the harness's one-clip model is built from. */
const probeDuration = (filePath) => new Promise((resolve) => {
  execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], (error, stdout) => {
    resolve(error ? 0 : Number(String(stdout).trim()))
  })
})

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  protocol.handle('stitch-media', async (request) => {
    const target = new URL(request.url).searchParams.get('path')
    if (!target || !path.isAbsolute(target)) return new Response('Missing media path', { status: 400 })
    let size
    try { size = fs.statSync(target).size } catch { return new Response('Not found', { status: 404 }) }
    const range = resolveByteRange(request.headers.get('Range'), size)
    if (range) {
      const body = Readable.toWeb(fs.createReadStream(target, { start: range.start, end: range.end }))
      return new Response(body, { status: 206, headers: { 'Content-Type': mimeTypeFor(target), 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Accept-Ranges': 'bytes' } })
    }
    const body = Readable.toWeb(fs.createReadStream(target))
    return new Response(body, { status: 200, headers: { 'Content-Type': mimeTypeFor(target), 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  })

  // A real file with a picture and sound, at the size the defect's cost is measured at.
  let file = PROVIDED
  let fixture = null
  if (!file) {
    fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-up-monitor-')), 'fixture.mp4')
    try {
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25:duration=8',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8',
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', '-movflags', '+faststart', fixture,
      ])
      file = fixture
    } catch (error) {
      console.error('HARNESS FAILED: could not build its own source.', String(error.message))
      app.exit(1)
      return
    }
  }

  const duration = Number(await probeDuration(file)) || 30
  // The page is handed its values before its bundle runs, so the model it builds is the real one.
  const htmlPath = path.join(__dirname, '.monitor-repro.html')
  fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#000;margin:0}</style></head>
<body><div id="root"></div>
<script>window.__file = ${JSON.stringify(file)}; window.__duration = ${duration}; window.__fps = 25;</script>
<script src="./.monitor-repro.js"></script></body></html>`, 'utf8')

  const win = new BrowserWindow({
    width: 700, height: 500, show: false,
    // No gesture is available in a harness, and the added track is deliberately NOT muted — its being audible
    // during a scrub is the behaviour under test, so autoplay is permitted rather than worked around.
    webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, autoplayPolicy: 'no-user-gesture-required' },
  })
  const run = (script) => win.webContents.executeJavaScript(`(() => { try { return ${script} } catch (error) { return { HARNESS_ERROR: String((error && error.stack) || error) } } })()`)

  const results = {}
  for (const variant of ['stable', 'inline']) {
    await win.loadFile(htmlPath, { query: { variant } })
    await new Promise((resolve) => setTimeout(resolve, 400))
    results[variant] = await run(measure)
    // The scrub is about the hook and not about how the ref is spelled, so it is measured once.
    if (variant === 'stable' && !results[variant].HARNESS_ERROR) {
      results.scrub = await run(scrubMeasure)
      results.keys = await run(keysMeasure)
    }
  }

  console.log(JSON.stringify({ file: PROVIDED || 'generated 1080p fixture', sourceDuration: +duration.toFixed(3), sampleSeconds: SAMPLE_SECONDS, results }, null, 2))

  const problems = []
  const stable = results.stable, inline = results.inline
  for (const name of ['stable', 'inline']) {
    const result = results[name]
    if (result.HARNESS_ERROR) problems.push(`the ${name} run could not be measured: ${result.HARNESS_ERROR}`)
  }
  // The wheel gesture: the deltas accumulate hand over hand, the transport resumes from where it settled, and
  // the SOUND keeps up with it — the added track is not paused (the regression), is sped with the wheel, is not
  // seeked on every tick (the jog), and is handed back its ordinary rate at the end.
  if (results.scrub && !results.scrub.HARNESS_ERROR) {
    const scrub = results.scrub
    // Thirty ticks of 0.05s is 1.5s; a generous window, because the render cadence rounds each landing.
    if (!(Math.abs(scrub.scrubDelta - 1.5) < 0.7)) problems.push(`a wheel gesture of 1.5s moved the playhead ${scrub.scrubDelta}s`)
    if (!scrub.resumed) problems.push('the transport was left stopped after a scrub over a playing job')
    if (!(scrub.resumedRate >= 0.85)) problems.push(`playback did not resume after the scrub: ${scrub.resumedRate}\u00d7`)
    if (scrub.audioPausedDuring) problems.push('the added track was PAUSED during the scrub, so the scrub went silent')
    if (scrub.videoPausedDuring) problems.push('the picture was PAUSED during the scrub')
    if (!(scrub.audioRatePeak > 1.05)) problems.push(`the added track was not sped with the wheel: its rate only reached ${scrub.audioRatePeak}\u00d7`)
    if (!(scrub.audioSeeksDuring < 8)) problems.push(`the added track was seeked on nearly every tick: ${scrub.audioSeeksDuring} seeks over 30 ticks`)
    if (!(Math.abs(scrub.audioRateAfter - 1) < 0.01)) problems.push(`the added track was left at ${scrub.audioRateAfter}\u00d7 rather than handed back its ordinary rate`)
    if (scrub.audioPausedAfter) problems.push('the added track was left paused after the scrub over a playing job')
  } else if (results.scrub) {
    problems.push(`the scrub could not be measured: ${results.scrub.HARNESS_ERROR}`)
  }
  // SLOW MOTION MOVES, AND A STOP OR A PLAY PUTS THE SPEED BACK.
  if (results.keys && !results.keys.HARNESS_ERROR) {
    const keys = results.keys
    if (!keys.slowPlaying) problems.push('slow motion did not start the transport')
    if (!(keys.slowAdvanced > 0.15)) problems.push(`slow motion showed a rate but the playhead did not move: it advanced ${keys.slowAdvanced}s over 0.6s at 0.5x`)
    if (keys.speedSet !== 2) problems.push(`setting the shared speed left it at ${keys.speedSet}x rather than 2x`)
    if (keys.speedAfterStop !== 1) problems.push(`a STOP did not put the shared speed back: it stayed at ${keys.speedAfterStop}x`)
    if (keys.speedAfterPlay !== 1) problems.push(`PLAY/PAUSE did not put the shared speed back: it stayed at ${keys.speedAfterPlay}x`)
  } else if (results.keys) {
    problems.push(`the keys could not be measured: ${results.keys.HARNESS_ERROR}`)
  }
  if (!problems.length) {
    // The element is handed a real, seekable video through the app's own URL: it must play it at the
    // rate the file is written at, however the ref is spelled.
    if (!(stable.rate >= 0.85)) problems.push(`the stable ref does not play at its own rate: ${stable.rate}\u00d7`)
    if (Math.abs(inline.rate - stable.rate) > 0.15) problems.push(`how the ref is written changes the playback rate: ${inline.rate}\u00d7 inline against ${stable.rate}\u00d7 stable`)
    // The invariant the defect moves most plainly: a ref that is a new function every render makes the
    // element be seeked over and over. One seek per play is the whole of what is expected of it.
    if (inline.seeks > Math.max(4, stable.seeks * 4)) problems.push(`the inline ref seeks the element over and over: ${inline.seeks} seeks against ${stable.seeks}`)
  }
  if (problems.length) console.error(`\n${problems.length} PLAYBACK PROBLEM(S)\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`)
  else console.log('\nTHE REF IS WRITTEN EITHER WAY AND IT PLAYS THE SAME')

  try { fs.unlinkSync(htmlPath) } catch {}
  if (fixture) { try { fs.rmSync(path.dirname(fixture), { recursive: true, force: true }) } catch {} }
  app.exit(problems.length ? 1 : 0)
}).catch((error) => { console.error('HARNESS FAILED', error); app.exit(1) })
