// Reads a real audio file the way the timeline does and checks the shape that comes out.
//
// The peaks are the whole of a waveform: whether a loud passage draws tall and a silence draws flat
// is a question about a decoded signal, and the drawing rules can only be asserted as strings. So
// this makes a file that is one second of a tone followed by one second of silence, decodes it
// through the same ffmpeg call the main process makes, buckets it with the same function, and
// reports what the first half and the second half came out as.
//
// Run with `npm run verify-wave`, which builds first and compiles the module the drawing and the
// main process both use.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { WAVEFORM_PEAKS, peaksForTrim, peaksFromSamples, waveformPath } = require('./.waveform.cjs')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'waveform-'))
const tone = path.join(work, 'tone.wav')

// A second of a 440Hz tone at full scale, then a second of nothing at all.
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono:d=1',
  '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1',
  tone,
])

// Exactly what electron/main.ts runs to read a file's audio.
const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', tone, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 256 * 1024 * 1024 })
const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4))
const peaks = peaksFromSamples(samples)

const loud = peaks.slice(0, peaks.length / 2)
const quiet = peaks.slice(peaks.length / 2)
const loudest = (values) => values.reduce((max, value) => Math.max(max, value), 0)
const average = (values) => values.reduce((total, value) => total + value, 0) / Math.max(1, values.length)
/** The reach of each bar either side of the centre line, read back out of a drawn path. */
const reaches = (path) => [...path.matchAll(/M[\d.]+ ([\d.]+)L[\d.]+ ([\d.]+)/g)].map(([, top, bottom]) => (Number(bottom) - Number(top)) / 2)

let failures = 0
const check = (label, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) failures++
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label}${same ? '' : `\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`}`)
}

console.log('\n== the waveform, through ffmpeg ==')
console.log(`   samples ${samples.length}, buckets ${peaks.length}, loudest ${loudest(loud).toFixed(4)}, quietest-loud ${loudest(quiet).toFixed(4)}`)

check('a file is read into the buckets the drawing expects', peaks.length, WAVEFORM_PEAKS)
check('the tone is drawn loud', average(loud) > 0.5, true)
// Not a zero: a concatenated seam leaves a sample or two of something, and a real silence in a real
// file is rarely bit-exact either. What matters is that it is nothing against the tone beside it.
check('the silence is drawn flat', loudest(quiet) < loudest(loud) / 20, true)
check('and the two halves are nothing like each other', average(quiet) < average(loud) / 50, true)
check('and the loudest bucket in the file is the file own scale', loudest(peaks), 1)
check('so the tone reads at full height', loudest(loud) > 0.99, true)
const whole = waveformPath({ peaks, width: 400, height: 32 })
check('the drawing of the whole file has bars', reaches(whole).length > 90, true)
check('with the tone drawn tall', Math.max(...reaches(whole)) > 10, true)
// The silent trim draws bars too, because a bar is never shorter than a pixel: what says it is
// silent is that every one of them is that minimum.
const silentTrim = waveformPath({ peaks: peaksForTrim(peaks, 1, 2, 2), width: 400, height: 32 })
check('a trim of the silent half draws only minimum bars', [reaches(silentTrim).length > 90, Math.max(...reaches(silentTrim)) <= 1.05], [true, true])
check('and a file with no audio draws nothing', waveformPath({ peaks: [], width: 400, height: 32 }), '')

console.log(failures === 0 ? '\nALL WAVEFORMS PASSED\n' : `\n${failures} WAVEFORM(S) FAILED\n`)
fs.rmSync(work, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
