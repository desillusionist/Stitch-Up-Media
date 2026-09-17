import { advanceClock, elementOwnsPosition } from '../src/lib/playbackClock'
import { nextShuttleRate } from '../src/lib/shuttleRates'
import { buildTimeline, maxFadeAtBoundary, resolveFades, segmentTiming } from '../src/lib/timelineModel'
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
  check('J starts its own ladder at 1x', nextShuttleRate(0, -1), -1)
  check('J doubles too', nextShuttleRate(-2, -1), -4)
  check('reversing starts from the bottom', nextShuttleRate(8, -1), -1)
  check('and forward again', nextShuttleRate(-4, 1), 1)
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

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
