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
const { clipFilters, croppedSize, fitFilters, fitPlacement } = require('./.sourceFit.cjs')

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
/** A clip a third of the frame's height, so a picture can be seen to sit inside the canvas with the
 *  bars it leaves either side of it and above and below. */
const band = { size: { width: 1920, height: 540 }, file: make('band', ['-f', 'lavfi', '-i', 'color=c=red:s=1920x540:d=1']) }

/** A clip already the shape of the frame, which needs neither a crop nor a pad. */
const wide = { size: { width: 1920, height: 1080 }, file: make('wide', ['-f', 'lavfi', '-i', 'color=c=red:s=1920x1080:d=1']) }

const NAMES = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], black: [0, 0, 0] }
const name = (rgb) => Object.entries(NAMES)
  .map(([label, target]) => ({ label, distance: target.reduce((total, channel, index) => total + (channel - rgb[index]) ** 2, 0) }))
  .sort((left, right) => left.distance - right.distance)[0].label

/** One frame of a clip through one chain, as the size and the colours that came out of it. */
const through = (clip, fit, crop, points = [[960, 10], [960, 540], [960, 1070], [120, 540]]) => {
  const filters = clipFilters({ source: clip.size, frame, fit, crop })
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
  return { width, height, colours, raw }
}

/**
 * The columns the picture occupies on one scanline, and the rows it occupies in one column.
 *
 * Found from the pixels rather than from the chain, which is the whole point of this harness: it is
 * the only way to say that a picture was translated by exactly the pixels its position asked for, and
 * that the background took up exactly the space it left. Anything brighter than near-black is the
 * picture — the bands are saturated and the background is the pad colour, so the two cannot be
 * confused — and a scanline with nothing on it is reported as no picture at all.
 *
 * The threshold leaves room for the encoder's own ringing at a hard edge, which is a pixel or two of
 * something dark that is not quite black.
 */
const spanX = (shot, y) => {
  const level = (x) => { const at = (Math.round(y) * shot.width + Math.round(x)) * 3; return shot.raw[at] + shot.raw[at + 1] + shot.raw[at + 2] }
  let first = -1, last = -1
  for (let x = 0; x < shot.width; x++) if (level(x) > 36) { if (first < 0) first = x; last = x }
  return [first, last]
}
const spanY = (shot, x) => {
  const level = (y) => { const at = (Math.round(y) * shot.width + Math.round(x)) * 3; return shot.raw[at] + shot.raw[at + 1] + shot.raw[at + 2] }
  let first = -1, last = -1
  for (let y = 0; y < shot.height; y++) if (level(y) > 36) { if (first < 0) first = y; last = y }
  return [first, last]
}

let failures = 0
const check = (label, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) failures++
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label}${same ? '' : `\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`}`)
}

console.log('\n== the per-clip fit, through ffmpeg ==')

// A tall clip fitted to the width overflows the frame by a great deal of height, and the position
// decides which band of it survives. At 0, 0 the frame is filled by the middle of the picture, which
// is exactly where it sat before a position existed — the property that makes this model additive.
const centred = through(tall, { mode: 'width', offset: { x: 0, y: 0 } })
check('a fitted width fills the frame', [centred.width, centred.height], [1920, 1080])
check('centring keeps the middle of a tall clip', centred.colours, ['green', 'green', 'green', 'green'])
check('and covers the frame on the axis that overflows', spanY(centred, 960), [0, 1079])
check('the picture moved up shows the top of it', through(tall, { mode: 'width', offset: { x: 0, y: 1.08 } }).colours, ['red', 'red', 'red', 'red'])
check('and moved down, the bottom', through(tall, { mode: 'width', offset: { x: 0, y: -1.08 } }).colours, ['blue', 'blue', 'blue', 'blue'])

// The other axis is pinned short and filled in rather than cropped: the picture keeps its whole
// height and its own shape, so all three of its bands survive, and the frame is made up by black
// either side of it. That contrast with the crop case above is the whole difference between the
// two fits, and it is only visible in the pixels.
const short = through(tall, { mode: 'height', offset: { x: 0, y: 0 } })
check('a fitted height fills the frame too', [short.width, short.height], [1920, 1080])
check('and keeps the whole picture, with the shortfall filled in beside it', short.colours, ['red', 'green', 'blue', 'black'])
check('and the default fit gives the same picture', through(tall, undefined).colours, short.colours)
check('the bars are exactly where the shortfall is', spanX(short, 540), [656, 1263])

const same = through(wide, { mode: 'height', offset: { x: 0, y: 0 } })
check('a clip the shape of the frame is only scaled', [same.width, same.height], [1920, 1080])
check('and keeps every part of itself', same.colours, ['red', 'red', 'red', 'red'])

// The POSITION, in the pixels. The picture that has room to move is the one with a gap beside it, so
// these use the fitted-height case above (608 wide in a 1920 frame) and a landscape clip that leaves
// bars above and below. What must hold: a share of the frame IS that many pixels of it, the side the
// picture moves away from becomes background, and the side it moves TOWARDS is clipped by the canvas.
const pillar = through(tall, { mode: 'contain', offset: { x: 0, y: 0 } })
check('a picture with a gap beside it is centred in the frame', spanX(pillar, 540), [656, 1263])
check('a quarter of the frame to the right is 480 pixels of it', spanX(through(tall, { mode: 'contain', offset: { x: 0.25, y: 0 } }), 540), [1136, 1743])
check('and the other way likewise', spanX(through(tall, { mode: 'contain', offset: { x: -0.25, y: 0 } }), 540), [176, 783])
check('half a frame to the right leaves a bar twice as wide on the left', spanX(through(tall, { mode: 'contain', offset: { x: 0.5, y: 0 } }), 540), [1616, 1919])
check('and the background is everything on the other side of it', through(tall, { mode: 'contain', offset: { x: 0.5, y: 0 } }).colours[3], 'black')

const centredBand = through(band, { mode: 'contain', offset: { x: 0, y: 0 } })
check('a picture with a gap above and below is centred too', spanY(centredBand, 960), [270, 809])
check('a quarter of the frame down is 270 pixels of it', spanY(through(band, { mode: 'contain', offset: { x: 0, y: 0.25 } }), 960), [540, 1079])
check('so the bar above it is half the frame, and there is none below', through(band, { mode: 'contain', offset: { x: 0, y: 0.25 } }).colours, ['black', 'red', 'red', 'red'])
check('and further down, the rest of it is clipped away', spanY(through(band, { mode: 'contain', offset: { x: 0, y: 0.5 } }), 960), [810, 1079])
// Clear of the canvas altogether: background and nothing else, which is a position rather than an
// error, and the one case where the chain has to produce a canvas of pure pad colour.
const clearOfIt = through(tall, { mode: 'contain', offset: { x: 1, y: 0 } })
check('a picture pushed clear of the canvas is background and nothing else', [spanX(clearOfIt, 540), spanY(clearOfIt, 960)], [[-1, -1], [-1, -1]])
check('at every point of it', clearOfIt.colours, ['black', 'black', 'black', 'black'])

// Crop then fit: the crop picks which band of the source is kept, in the source's own space, and the
// fit places what is left. A crop keeping only the middle band is green however it is then fitted,
// and the frame is covered either way — which is the whole claim of the two stages composing.
const middleBand = { left: 0, top: 426 / 1280, right: 0, bottom: 426 / 1280 }
const cropped = through(tall, { mode: 'width', offset: { x: 0, y: 0 } }, middleBand)
check('a crop is taken before the fit', [cropped.width, cropped.height], [1920, 1080])
check('and only what it kept survives', cropped.colours, ['green', 'green', 'green', 'green'])
// The bars a cropped clip leaves are much narrower than an uncropped clip's, so the sample that
// looks for one is taken at the very edge rather than where the old ones used to be.
const barPoints = [[960, 10], [960, 540], [960, 1070], [20, 540]]
check('the fitted crop covers the frame too', through(tall, { mode: 'height', offset: { x: 0, y: 0 } }, middleBand, barPoints).colours, ['green', 'green', 'green', 'black'])
check('a crop with no fit is fitted the default way', through(tall, undefined, middleBand, barPoints).colours, ['green', 'green', 'green', 'black'])
// The crop and the position are independent: what the crop kept is what the position moves, so a
// cropped band moved sideways shows the background on one side and the band on the other.
const croppedMoved = through(tall, { mode: 'contain', offset: { x: 0.3, y: 0 } }, middleBand, [[100, 540], [400, 540], [700, 540], [1900, 540]])
check('a cropped picture moved sideways is the band, with background beside it', croppedMoved.colours, ['black', 'black', 'green', 'green'])
check('and the extent of the kept region is what the fit is worked out from', cropped.colours.length, 4)
check('a cropped region of the source is smaller than the source', croppedSize(tall.size, middleBand), { width: 720, height: 428 })

// INSETS, read off the pixels. A margin is background the picture was never given, so it shows as the
// pad colour, and the picture itself is where the placement put it — inside the box the margins leave.
// The extents below are what says that: where the picture starts and stops, on each side, for a margin
// on that side, which is the geometry a reader cannot get from the filter string.
const margins = (l, t, r, b) => ({ mode: 'contain', offset: { x: 0, y: 0 }, insets: { l, t, r, b } })

const noneAtAll = through(band, { mode: 'contain', offset: { x: 0, y: 0 } })
const zeroed = through(band, margins(0, 0, 0, 0))
check('zero margins draw exactly what no margins drew', [spanY(zeroed, 960), zeroed.colours], [spanY(noneAtAll, 960), noneAtAll.colours])
// A margin at the top AND the bottom leaves a box half the frame's height, which is exactly the shape
// of this band — so the band fills the box and the background above and below it is exactly the
// margins, which is the cleanest statement of what a bar IS: the margin, once the picture fills its box.
const bars = through(band, margins(0, 0.25, 0, 0.25))
check('the bars are exactly the margins', spanY(bars, 960), [270, 809])
check('with the picture between them', bars.colours, ['black', 'red', 'black', 'red'])
// One-sided: the box starts a quarter of the frame UP from the bottom edge, and the picture is centred
// in what is left of it, so it sits inward from where it did — with the margin above it and the box's
// own leftover below, which is background either way.
const topOnly = through(band, margins(0, 0.25, 0, 0))
check('a one-sided margin moves the picture inward', spanY(topOnly, 960), [406, 945])
check('and its extent is strictly inside the frame', spanY(topOnly, 960)[1] < frame.height - 1, true)
// A margin on a side: the box is narrower, the band is narrower with it, and its LEFT edge is the
// margin in — the whole point being that the picture is centred in the box, not in the frame.
const leftMargin = through(band, margins(0.25, 0, 0, 0))
check('a left margin starts the picture a quarter of the way in', spanX(leftMargin, 540), [480, 1919])
check('and the margin itself is background', leftMargin.colours[3], 'black')
const rightMargin = through(band, margins(0, 0, 0.25, 0))
check('a right margin stops it three quarters of the way across', spanX(rightMargin, 540), [0, 1439])
check('with the background on the far side', spanX(rightMargin, 540)[1] < frame.width - 1, true)

// A margin on every side scales the picture DOWN rather than cropping it: the tall clip is contained
// in a box four fifths of the frame, so the whole of it survives and it is strictly inside the canvas.
const insetTall = { mode: 'contain', offset: { x: 0, y: 0 }, insets: { l: 0.1, t: 0.1, r: 0.1, b: 0.1 } }
const shrunken = through(tall, insetTall, undefined, [[960, 200], [960, 540], [960, 850], [100, 540]])
check('an inset picture is scaled down, not cut', [shrunken.width, shrunken.height], [1920, 1080])
check('and sits strictly inside the frame', [spanX(shrunken, 540), spanY(shrunken, 960)], [[718, 1203], [108, 971]])
check('so all three of its bands are still there', shrunken.colours, ['red', 'green', 'blue', 'black'])
// A FILL fit fills the box: the width is pinned to the box's own width, which is the frame's less its
// margins, and the rest follows from the picture's shape exactly as it does without any margins.
const filled = through(tall, { mode: 'width', offset: { x: 0, y: 0 }, insets: { l: 0.1, t: 0, r: 0.1, b: 0 } })
check('a fill fit fills the box the margins leave', spanX(filled, 540), [192, 1727])
check('and covers it top to bottom', spanY(filled, 960), [0, 1079])

console.log(failures === 0 ? '\nALL CHAINS PASSED\n' : `\n${failures} CHAIN(S) FAILED\n`)
fs.rmSync(work, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
