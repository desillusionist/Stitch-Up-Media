import { advanceClock, elementOwnsPosition } from '../src/lib/playbackClock'
import { nextShuttleRate } from '../src/lib/shuttleRates'
import { buildTimeline, maxFadeAtBoundary, rekeyClipMap, resolveFades, segmentTiming, sourceDuration, sourceFps } from '../src/lib/timelineModel'
import { QueueTask } from '../src/types'

/**
 * Assertions over the pure parts of the EDIT JOB timeline: the fallback playback
 * clock, which clock owns the playhead, the J/K/L ladder, fade clamping, and how a
 * concatenated lane is assembled. Run with `npm run verify`.
 */
let failures = 0
const check = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { console.log(`  ok   ${label}`) } else { failures++; console.log(`  FAIL ${label}\n       got      ${a}\n       expected ${e}`) }
}
const near = (label: string, actual: number, expected: number, tolerance = 1e-6) => {
  if (Math.abs(actual - expected) <= tolerance) { console.log(`  ok   ${label} (${actual})`) } else { failures++; console.log(`  FAIL ${label}: got ${actual}, expected ${expected}`) }
}

console.log('\n== fallback clock: rate is honoured ==')
{
  const first = advanceClock(null, { from: 0, now: 1000, key: 'a', reverse: false, shuttleRate: 0 })
  near('starts at the given position', first.value, 0)
  const second = advanceClock(first.anchor, { from: 0, now: 2000, key: 'a', reverse: false, shuttleRate: 0 })
  near('1x advances 1s per second', second.value, 1)

  const fastStart = advanceClock(null, { from: 4, now: 1000, key: 'still', reverse: false, shuttleRate: 4 })
  const fast = advanceClock(fastStart.anchor, { from: 4, now: 2000, key: 'still', reverse: false, shuttleRate: 4 })
  near('4x advances 4s per second', fast.value, 8)

  const halfStart = advanceClock(null, { from: 10, now: 1000, key: 'still', reverse: false, shuttleRate: 0.5 })
  const half = advanceClock(halfStart.anchor, { from: 10, now: 2000, key: 'still', reverse: false, shuttleRate: 0.5 })
  near('0.5x advances half a second per second', half.value, 10.5)
}

console.log('\n== fallback clock: direction and rebasing ==')
{
  const start = advanceClock(null, { from: 20, now: 1000, key: 'a', reverse: true, shuttleRate: -2 })
  const back = advanceClock(start.anchor, { from: 20, now: 2000, key: 'a', reverse: true, shuttleRate: -2 })
  near('2x reverse moves back 2s per second', back.value, 18)

  const flipped = advanceClock(back.anchor, { from: 18, now: 2000, key: 'a', reverse: false, shuttleRate: 1 })
  near('flipping to forward holds position at the flip', flipped.value, 18)

  const changed = advanceClock(back.anchor, { from: 18, now: 2000, key: 'a', reverse: true, shuttleRate: -4 })
  near('a rate change holds position at the change', changed.value, 18)
  const afterChange = advanceClock(changed.anchor, { from: 18, now: 3000, key: 'a', reverse: true, shuttleRate: -4 })
  near('after the change the new rate applies', afterChange.value, 14)

  const running = advanceClock(null, { from: 3, now: 1000, key: 'clip-a', reverse: false, shuttleRate: 2 })
  const atCrossing = advanceClock(running.anchor, { from: 3, now: 1500, key: 'clip-a', reverse: false, shuttleRate: 2 })
  near('reaches the cut', atCrossing.value, 4)
  const acrossTheCut = advanceClock(atCrossing.anchor, { from: 3.02, now: 1500, key: 'clip-b', reverse: false, shuttleRate: 2 })
  near('a stale rendered position cannot rewind it', acrossTheCut.value, 4)
  const onward = advanceClock(acrossTheCut.anchor, { from: 4, now: 2000, key: 'clip-b', reverse: false, shuttleRate: 2 })
  near('and it keeps its speed in the new segment', onward.value, 5)
}

console.log('\n== which clock owns the playhead ==')
{
  const clip = { key: 'clip', sourcePath: '/a.mp4', start: 0, duration: 10, sourceIn: 0, trimmed: false }
  const still = { key: 'still', sourcePath: '/a.png', start: 10, duration: 10, sourceIn: 0, trimmed: false, still: true }
  const ready = { readyState: 2, ended: false, clock: 3 }

  check('a ready element owns its own segment', elementOwnsPosition(clip, 3, ready), true)
  check('a still has no element to own it', elementOwnsPosition(still, 12, ready), false)
  check('an unloaded element does not own it', elementOwnsPosition(clip, 3, { ...ready, readyState: 0 }), false)
  check('an ended element does not own it', elementOwnsPosition(clip, 9.9, { ...ready, ended: true }), false)
  check('a playhead past the clip is not the element\'s', elementOwnsPosition(clip, 180, { ...ready, clock: 9.98, ended: true }), false)
  check('and holds even if the element claims to be running', elementOwnsPosition(clip, 180, { ...ready, clock: 9.98 }), false)
}

console.log('\n== the J / K / L ladder ==')
{
  let rate = 0
  const presses: number[] = []
  for (let i = 0; i < 5; i++) { rate = nextShuttleRate(rate, 1); presses.push(rate) }
  check('L doubles then tops out', presses, [1, 2, 4, 8, 8])
  let back = 0
  const reverse: number[] = []
  for (let i = 0; i < 5; i++) { back = nextShuttleRate(back, -1); reverse.push(back) }
  check('J doubles too, all the way to 8x', reverse, [-1, -2, -4, -8, -8])
  check('reversing starts from the bottom', nextShuttleRate(8, -1), -1)
  check('and forward again', nextShuttleRate(-8, 1), 1)
}

console.log('\n== tail seeking on a multi-track lane ==')
{
  const task = {
    id: 't', type: 'multitrack', status: 'pending', progress: 0,
    sourcePaths: ['/clip.mp4'], outputDirectory: '/out', outputFilename: 'o.mkv',
    sourceBaseName: 'clip',
    preset: { id: 'p', name: 'P', container: 'mkv', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    additionalAudioTracks: [{ id: 'trk', path: '/long.wav', language: 'und' }],
  } as unknown as QueueTask
  const model = buildTimeline(task, { resolveTiming: (sourcePath) => (sourcePath === '/clip.mp4' ? { duration: 10 } : { duration: 420 }) })
  const main = model.lanes[0]
  const audio = model.lanes[1]
  near('output runs to the longer audio', model.duration, 420)
  near('the video lane keeps its own length', main.duration, 10)
  const clip = main.segments[0]
  check('a click at three minutes is past the video clip', 180 > clip.start + clip.duration, true)
  check('so the element cannot answer for it', elementOwnsPosition(clip, 180, { readyState: 4, ended: true, clock: 10 }), false)
  check('and the audio track does own it', elementOwnsPosition(audio.segments[0], 180, { readyState: 4, ended: false, clock: 180 }), true)
}

console.log('\n== fades on a concatenated lane ==')
{
  near('a boundary fade cannot exceed half of either neighbour', maxFadeAtBoundary(10, 2), 1)
  check('a fade fades both sides of the cut', resolveFades([4, 4, 4], [0.5, 0, 0]), [
    { fadeIn: 0, fadeOut: 0.5 }, { fadeIn: 0.5, fadeOut: 0 }, { fadeIn: 0, fadeOut: 0 },
  ])
  check('a request past the limit is reduced, not accepted', resolveFades([4, 0.4], [5]), [
    { fadeIn: 0, fadeOut: 0.2 }, { fadeIn: 0.2, fadeOut: 0 },
  ])
  check('the last clip has no boundary after it', resolveFades([4, 4], [0.5, 0.5]), [
    { fadeIn: 0, fadeOut: 0.5 }, { fadeIn: 0.5, fadeOut: 0 },
  ])
  check('a trim shortens the clip before fades are placed', segmentTiming(20, { in: 5, out: 9 }), { duration: 4, sourceIn: 5, trimmed: true })
}

console.log('\n== a combo exposes cuts too ==')
{
  const combo = {
    id: 'c', type: 'combo', status: 'pending', progress: 0,
    sourcePaths: ['/a.mp4', '/b.mp4'], outputDirectory: '/out', outputFilename: 'o.mkv',
    sourceBaseName: 'a',
    preset: { id: 'p', name: 'P', container: 'mkv', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    transitions: { '/a.mp4#0': { type: 'fade', duration: 0.5 } },
    additionalAudioTracks: [{ id: 'trk', path: '/long.wav', language: 'und' }],
  } as unknown as QueueTask
  const model = buildTimeline(combo, { resolveTiming: () => ({ duration: 4 }) })
  const main = model.lanes[0]
  check('both visuals are on the main lane', main.segments.map((segment) => segment.sourcePath), ['/a.mp4', '/b.mp4'])
  near('the cut sits at the first clip\'s end', main.segments[1].start, 4)
  check('nothing is reported unused', model.unusedVideoSources, [])
  // A zero-length fade is left absent rather than stored as zero, which is how the
  // rest of the app tests for one.
  check('the fade on the cut is drawn', main.segments.map((segment) => [segment.fadeIn, segment.fadeOut]), [[undefined, 0.5], [0.5, undefined]])
}

console.log('\n== clips keep what belongs to them when they move ==')
{
  // The same file twice: each occurrence has to keep its own entry, or a fade set on
  // the second cut appears on the first and vanishes from the one it was set on.
  const duplicated = { 'a.mp4#0': { type: 'fade', duration: 0.5 }, 'a.mp4#1': { type: 'fade', duration: 1.5 } }
  check('a repeated file keeps one entry per occurrence', rekeyClipMap(duplicated, ['a.mp4', 'a.mp4'], ['a.mp4', 'a.mp4']), duplicated)

  // A transition belongs to the clip before the cut, so moving that clip moves it.
  const moved = { 'a.mp4#0': 0.5, 'b.mp4#1': 1.5 }
  check('a reorder carries each fade with its clip', rekeyClipMap(moved, ['a.mp4', 'b.mp4', 'c.mp4'], ['c.mp4', 'a.mp4', 'b.mp4']), { 'a.mp4#1': 0.5, 'b.mp4#2': 1.5 })

  // Removing the clip a fade sits after leaves nothing to fade into.
  check('a removed clip takes its fade with it', rekeyClipMap({ 'a.mp4#0': 0.5, 'b.mp4#1': 1.5, 'c.mp4#2': 2 }, ['a.mp4', 'b.mp4', 'c.mp4'], ['a.mp4', 'b.mp4']), { 'a.mp4#0': 0.5, 'b.mp4#1': 1.5 })
  check('an empty result is no map at all', rekeyClipMap({ 'a.mp4#0': 1 }, ['a.mp4'], ['b.mp4']), undefined)
}

console.log('\n== the rate a still image is rendered at ==')
{
  const still = {
    id: 's', type: 'transcode', status: 'pending', progress: 0,
    sourcePaths: ['/frame.png'], outputDirectory: '/out', outputFilename: 'o.mov',
    sourceBaseName: 'frame', stillImageDuration: 10,
    preset: { id: 'p', name: 'P', container: 'mov', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
  } as unknown as QueueTask
  check('a still with no record falls back to the preset, then 25', sourceFps(still, '/frame.png'), 25)
  const recorded = { ...still, sourceMetadata: { '/frame.png': { fps: 30 } } } as unknown as QueueTask
  check('the recorded rate wins over the fallback', sourceFps(recorded, '/frame.png'), 30)
  const probed = { ...recorded, preset: { ...recorded.preset, fps: 60 } } as unknown as QueueTask
  check('and over the preset rate too', sourceFps(probed, '/frame.png'), 30)
  check('its length is still the still duration, not a rate', sourceDuration(still, '/frame.png'), 10)

  // A sequence carries its own rate, and that is the one both the encoder and the
  // native trimmer read, so it has to beat the record on the source.
  const sequence = {
    ...recorded, sourcePaths: ['/seq/f_0001.png'],
    sequenceInputs: { '/seq/f_0001.png': { dir: '/seq', pattern: 'f_%04d.png', globPattern: '*', startNumber: 1, frameCount: 240, hasGaps: false, missing: [], fps: 24, firstFrame: '/seq/f_0001.png' } },
  } as unknown as QueueTask
  check('a sequence rate beats the record on its first frame', sourceFps(sequence, '/seq/f_0001.png'), 24)
  near('and its length follows the rate', sourceDuration(sequence, '/seq/f_0001.png'), 10)
  const reframed = { ...sequence, sequenceInputs: { '/seq/f_0001.png': { ...sequence.sequenceInputs!['/seq/f_0001.png'], fps: 48 } } } as unknown as QueueTask
  near('changing the rate changes the length', sourceDuration(reframed, '/seq/f_0001.png'), 5)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
