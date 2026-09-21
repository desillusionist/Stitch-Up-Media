// Runs the real per-clip fit chains through the real ffmpeg and reads the frames that come out.
//
// Whether a crop keeps the part of the picture the offset asked for, and whether a pad fills the
// gap beside it, is a question about pixels rather than about strings, and the strings are all an
// assertion can see. So this makes a source clip whose top third is red, middle green and bottom
// blue, runs a chain over it, and reports the size of the frame and the colour at three points
// down it: a chain that keeps the middle of a tall clip shows green at all three.
//
// Run with `npm run verify-fit`, which builds first and compiles the arithmetic the chains come
// from, so what is exercised is the module the encoder imports rather than a copy of it.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { fitFilters } = require('./.sourceFit.cjs')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-chain-'))
const frame = { width: 1920, height: 1080 }

const run = (args, options) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], options)

const make = (name, args) => {
  const file = path.join(work, `${name}.mp4`)
  run([...args, '-pix_fmt', 'yuv420p', '-t', '1', file])
  return file
}
// A 720x1280 clip banded down its height, so which part of the picture a chain kept can be read
// off the result instead of taken on trust.
const tall = {
  size: { width: 720, height: 1280 },
  file: make('bands', [
    '-f', 'lavfi', '-i', 'color=c=red:s=720x426:d=1',
    '-f', 'lavfi', '-i', 'color=c=lime:s=720x428:d=1',
    '-f', 'lavfi', '-i', 'color=c=blue:s=720x426:d=1',
    '-filter_complex', '[0:v][1:v][2:v]vstack=inputs=3',
  ]),
}
/** A clip already the shape of the frame, which needs neither a crop nor a pad. */
const wide = { size: { width: 1920, height: 1080 }, file: make('wide', ['-f', 'lavfi', '-i', 'color=c=red:s=1920x1080:d=1']) }

const NAMES = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], black: [0, 0, 0] }
const name = (rgb) => Object.entries(NAMES)
  .map(([label, target]) => ({ label, distance: target.reduce((total, channel, index) => total + (channel - rgb[index]) ** 2, 0) }))
  .sort((left, right) => left.distance - right.distance)[0].label

/** One frame of a clip through one chain, as the size and the colours that came out of it. */
const through = (clip, fit, points = [[960, 10], [960, 540], [960, 1070], [120, 540]]) => {
  const filters = fitFilters({ source: clip.size, frame, fit })
  if (!filters) throw new Error('the arithmetic produced no chain')
  const shot = path.join(work, `shot-${filters.join('|').replace(/[^a-z0-9]/gi, '_')}.png`)
  run(['-i', clip.file, '-frames:v', '1', '-vf', filters.join(','), shot])
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', shot], { encoding: 'utf8' }))
  const { width, height } = probe.streams[0]
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', shot, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 })
  const colours = points.map(([x, y]) => {
    const at = (Math.round(y) * width + Math.round(x)) * 3
    return name([raw[at], raw[at + 1], raw[at + 2]])
  })
  return { width, height, colours }
}

let failures = 0
const check = (label, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) failures++
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label}${same ? '' : `\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`}`)
}

console.log('\n== the per-clip fit, through ffmpeg ==')

// A tall clip fitted to the width overflows the frame by a great deal of height, and the offset
// chooses which band of it survives. The frame is filled, cropped, whichever way it is read.
const centred = through(tall, { mode: 'width', offset: 0.5 })
check('a fitted width fills the frame', [centred.width, centred.height], [1920, 1080])
check('centring keeps the middle of a tall clip', centred.colours, ['green', 'green', 'green', 'green'])
check('the start keeps the top of it', through(tall, { mode: 'width', offset: 0 }).colours, ['red', 'red', 'red', 'red'])
check('and the end keeps the bottom', through(tall, { mode: 'width', offset: 1 }).colours, ['blue', 'blue', 'blue', 'blue'])

// The other axis is pinned short and filled in rather than cropped: the picture keeps its whole
// height and its own shape, so all three of its bands survive, and the frame is made up by black
// either side of it. That contrast with the crop case above is the whole difference between the
// two fits, and it is only visible in the pixels.
const short = through(tall, { mode: 'height', offset: 0.5 })
check('a fitted height fills the frame too', [short.width, short.height], [1920, 1080])
check('and keeps the whole picture, with the shortfall filled in beside it', short.colours, ['red', 'green', 'blue', 'black'])
check('and the default fit gives the same picture', through(tall, undefined).colours, short.colours)

const same = through(wide, { mode: 'height', offset: 0.5 })
check('a clip the shape of the frame is only scaled', [same.width, same.height], [1920, 1080])
check('and keeps every part of itself', same.colours, ['red', 'red', 'red', 'red'])

console.log(failures === 0 ? '\nALL CHAINS PASSED\n' : `\n${failures} CHAIN(S) FAILED\n`)
fs.rmSync(work, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
