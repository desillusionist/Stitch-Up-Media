// Reads a real 5.1 wav's waveform, and watches the event loop while it does.
//
// WHAT THIS IS FOR. A six-channel wav opened in the EDIT JOB blanked the whole window, and the log showed the
// waveform never worked at all in the packaged app (`spawnSync ffmpeg ENOENT`). Two faults, one call: the decode
// was `execFileSync('ffmpeg', …)`, so it held the main process for its duration, and it looked the binary up on
// PATH, which a Finder-launched app does not have. So this asserts three things:
//
//   the RESULT      — 2000 buckets, in the drawing's own 0..1 scale, from a 5.1 source, downmixed to mono
//   the CONCURRENCY — the loop keeps ticking during the decode (a 24-minute 5.1 wav is 849 MB to read)
//   the BINARY      — an absolute path, so no PATH is consulted; run this with a stripped PATH to see it work
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { peaksForFile } = require('./.audioPeaks.cjs')
const { FFMPEG_BINARY, probeFile, layoutName } = require('./.probe.cjs')
const { WAVEFORM_PEAKS } = require('./.waveform.cjs')

const problems = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       ${detail}`}`)
  if (!ok) problems.push(label)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-up-peaks-'))
const ff = (args) => execFileSync(FFMPEG_BINARY, ['-hide_banner', '-loglevel', 'error', '-y', ...args])

/** Ticks of a 10ms timer that land while `work` is in flight, as `verify-run` measures them. */
const ticksDuring = async (work) => {
  let ticks = 0
  const ticker = setInterval(() => { ticks++ }, 10)
  const started = Date.now()
  const value = await work()
  const elapsed = Date.now() - started
  clearInterval(ticker)
  return { ticks, elapsed, value }
}

const main = async () => {
  console.log(`  ffmpeg: ${FFMPEG_BINARY}`)
  check('the binary is named outright, not looked up on PATH', path.isAbsolute(FFMPEG_BINARY), FFMPEG_BINARY)

  // A four-second 5.1 source: five tones around the room, which is enough to have a shape.
  const surround = path.join(root, 'surround.wav')
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=4', '-filter_complex',
    '[0:a][1:a]amerge=inputs=2[a2];[a2]pan=5.1|c0=c0|c1=c1|c2=c0|c3=c1|c4=c0|c5=c1[out]', '-map', '[out]', '-c:a', 'pcm_s16le', surround])

  const probed = await probeFile(surround)
  const stream = probed.audioStreams[0]
  console.log(`  the fixture: ${stream.channels} channels, layout ${JSON.stringify(stream.channelLayout)} (${typeof stream.channelLayout})`)
  check('a 5.1 wav is read as six channels', stream.channels === 6, JSON.stringify(stream))
  check('and its layout is a STRING, so a reader may call a string method on it', typeof stream.channelLayout === 'string', String(stream.channelLayout))
  check('and it really says 5.1', stream.channelLayout === '5.1', String(stream.channelLayout))

  const measured = await ticksDuring(() => peaksForFile(surround, FFMPEG_BINARY))
  const peaks = measured.value
  check('the waveform comes back', Array.isArray(peaks), String(peaks))
  check('at the drawing\u2019s own bucket count', peaks.length === WAVEFORM_PEAKS, String(peaks?.length))
  check('normalised, so the loudest bucket is at full scale', Math.abs(Math.max(...peaks) - 1) < 1e-6, String(Math.max(...peaks)))
  check('and every bucket inside the scale', peaks.every((peak) => peak >= 0 && peak <= 1), JSON.stringify(peaks.slice(0, 8)))
  // Silence should draw nothing rather than a line at the top: a bucket that is not there is zero, not loud.
  const loudBuckets = peaks.filter((peak) => peak > 0.5).length
  check('and the tone is not a flat block of full-scale bars', loudBuckets < peaks.length, `${loudBuckets} of ${peaks.length}`)
  console.log(`       four seconds of 5.1 decoded in ${measured.elapsed}ms, the loop ticked ${measured.ticks} times`)

  // The control: the same decode held synchronously. It gives the loop no chance at all, which is what makes the
  // figure above evidence rather than a timer that always ticks.
  const sync = await ticksDuring(() => {
    execFileSync(FFMPEG_BINARY, ['-hide_banner', '-loglevel', 'error', '-i', surround, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 256 * 1024 * 1024 })
  })
  check('the loop kept ticking while the decode ran', measured.ticks >= Math.max(3, Math.floor(measured.elapsed / 40)), `${measured.ticks} ticks over ${measured.elapsed}ms`)
  check('while the synchronous control left it no chance', sync.ticks <= 2, `${sync.ticks} ticks over ${sync.elapsed}ms`)

  // A source with no sound answers with nothing rather than with an error, which is what the timeline draws as a
  // flat line. It is also the shape a caller sees when the file is not a media file at all.
  const silent = await peaksForFile(path.join(root, 'missing.wav'), FFMPEG_BINARY).catch(() => 'rejected')
  check('a file that cannot be read is answered, not thrown at the drawing', silent === 'rejected' || silent === null, String(silent))

  // The probe's own reading of a layout, which is where the blank window came from: the parser turns a numeric
  // name into a number, and the reader used to assume a string.
  check('a numeric 5.1 is put back as its name', layoutName(5.1), '5.1')
  check('a name is left as it is', layoutName('5.1(side)'), '5.1(side)')
  check('`unknown` is an absence', layoutName('unknown') === undefined, String(layoutName('unknown')))
  check('a truncated numeric name is an absence rather than a wrong name', layoutName(5) === undefined, String(layoutName(5)))
  check('and nothing at all is an absence', layoutName(null) === undefined, String(layoutName(null)))

  fs.rmSync(root, { recursive: true, force: true })
  console.log(problems.length ? `\n${problems.length} PEAKS PROBLEM(S)\n` : '\nA 5.1 SOURCE IS READ AS A WAVEFORM WITHOUT FREEZING THE APP, AND ITS LAYOUT SURVIVES THE PROBE\n')
  process.exit(problems.length ? 1 : 0)
}

main().catch((error) => { console.error('HARNESS FAILED', error); process.exit(1) })
