import { advanceClock, elementOwnsPosition } from '../src/lib/playbackClock'
import { nextShuttleRate } from '../src/lib/shuttleRates'
import { withSourceTiming, sourceTimingOverrides } from '../src/lib/sourceTiming'
import { dropPreviewsFor, previewKey, sourceOfPreview, sourceOfPreviewKey } from '../src/lib/quickLookTarget'
import { progressPercent, timemarkSeconds } from '../src/lib/progress'
import { aspectSize, clampCrop, cropBands, cropFilter, cropFractions, cropForProportion, cropPixels, exactSizeFields, fitFrame, fitFrameBy, hasCrop, keptAspect, outputFrameSize, resolutionBox, resolutionShortSide, resizeCorner, resizeExact, shiftCrop, MAX_CROP } from '../src/lib/outputFrame'
import { computeFilmstrip, FILMSTRIP_MAX_TILES, filmstripCell, frameKey, skimFrame } from '../src/lib/filmstrip'
import { scrollToKeepVisible, skimmerOffset } from '../src/lib/timelinePan'
import { buildTimeline, edgeFade, maxEdgeFade, maxFadeAtBoundary, rekeyClipMap, resolveFades, segmentTiming, sourceDuration, sourceFps, stillSecondsFor } from '../src/lib/timelineModel'
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

  // The two edges of the timeline, which cut from and to black. They touch one clip each, so the
  // middle of the job is left alone however long they are asked to be.
  check('a head fade cuts from black on the first clip only', resolveFades([4, 4], [0, 0], { head: 1 }), [
    { fadeIn: 1, fadeOut: 0 }, { fadeIn: 0, fadeOut: 0 },
  ])
  check('a tail fade cuts to black on the last clip only', resolveFades([4, 4], [0, 0], { tail: 1 }), [
    { fadeIn: 0, fadeOut: 0 }, { fadeIn: 0, fadeOut: 1 },
  ])
  check('both edges at once still leave the middle alone', resolveFades([4, 4, 4], [0, 0, 0], { head: 1, tail: 2 }), [
    { fadeIn: 1, fadeOut: 0 }, { fadeIn: 0, fadeOut: 0 }, { fadeIn: 0, fadeOut: 2 },
  ])
  // An edge shares its clip with the boundary at the other end of the SAME clip, so the two are
  // fitted together rather than allowed to overlap.
  check('a head fade cannot run into its own clip\'s tail fade', resolveFades([4, 4], [1], { head: 5 }), [
    { fadeIn: 3, fadeOut: 1 }, { fadeIn: 1, fadeOut: 0 },
  ])
  check('and a tail fade cannot run into its own head fade', resolveFades([4, 4], [1], { tail: 5 }), [
    { fadeIn: 0, fadeOut: 1 }, { fadeIn: 1, fadeOut: 3 },
  ])
  near('an edge can take the whole clip when nothing else uses it', maxEdgeFade(6, 0), 6)
  near('and only what is left when a boundary already does', maxEdgeFade(6, 2), 4)

  // The edge keys are their own, so no clip-scoped key can collide with them.
  const edgeTask = {
    id: 'e', type: 'stitch', status: 'pending', progress: 0, sourcePaths: ['/a.mp4'],
    outputDirectory: '/out', outputFilename: 'o.mp4',
    preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    transitions: { '#head': { type: 'fade', duration: 1 }, '#tail': { type: 'fade', duration: 2 }, '/a.mp4#0': { type: 'fade', duration: 3 } },
  } as unknown as QueueTask
  near('the head edge reads its own key', edgeFade(edgeTask, 'head'), 1)
  near('the tail edge reads its own', edgeFade(edgeTask, 'tail'), 2)
  near('and neither is confused with a clip boundary', edgeFade({ ...edgeTask, transitions: { '/a.mp4#0': { type: 'fade', duration: 3 } } } as unknown as QueueTask, 'tail'), 0)
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
  // A JPEG probe can invent a rate. Letting it win would put the number on screen out of
  // step with the rate the encoder renders at, which follows the record then the preset.
  const presetOnly = { ...still, preset: { ...still.preset, fps: 30 } } as unknown as QueueTask
  check('a probed still rate does not override the preset', sourceFps(presetOnly, '/frame.png', undefined, () => ({ fps: 25 })), 30)
  check('and with no preset either it is 25', sourceFps(still, '/frame.png', undefined, () => ({ fps: 25 })), 25)
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

console.log('\n== changing a rate leaves nothing stale behind ==')
{
  const sequence = () => ({
    id: 's', type: 'stitch', status: 'done', progress: 40,
    sourcePaths: ['/seq/f_0001.png', '/other.mp4'], outputDirectory: '/out', outputFilename: 'o.mov',
    sourceBaseName: 'f', stillImageDuration: 10,
    preset: { id: 'p', name: 'P', container: 'mov', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    sequenceInput: { dir: '/seq', pattern: 'f_%04d.png', globPattern: '*', startNumber: 1, frameCount: 240, hasGaps: false, missing: [], fps: 24, firstFrame: '/seq/f_0001.png' },
    sequenceInputs: { '/seq/f_0001.png': { dir: '/seq', pattern: 'f_%04d.png', globPattern: '*', startNumber: 1, frameCount: 240, hasGaps: false, missing: [], fps: 24, firstFrame: '/seq/f_0001.png' } },
    imageSequencePreviews: { '/seq/f_0001.png': '/tmp/seq-24fps.mp4', '/other.mp4': '/tmp/other.mp4' },
  }) as unknown as QueueTask

  const changed = withSourceTiming(sequence(), '/seq/f_0001.png', { fps: 48 })
  // The generated clip was rendered at 24, so it cannot be shown as though it were 48.
  check('the clip built at the old rate is dropped', changed.imageSequencePreviews, { '/other.mp4': '/tmp/other.mp4' })
  check('the rate is recorded against the source', changed.sourceMetadata, { '/seq/f_0001.png': { fps: 48 } })
  near('the sequence length follows the rate', changed.sequenceInput!.duration!, 5)
  near('and its rate is the new one', changed.sequenceInput!.fps, 48)
  check('a finished job goes back to pending', changed.status, 'pending')
  check('a rate of zero changes nothing', withSourceTiming(sequence(), '/seq/f_0001.png', { fps: 0 }).imageSequencePreviews, { '/seq/f_0001.png': '/tmp/seq-24fps.mp4', '/other.mp4': '/tmp/other.mp4' })

  // Deleting the last preview entry must leave the field absent rather than empty, which
  // is how the rest of the app tests for it.
  const lone = { ...sequence(), imageSequencePreviews: { '/seq/f_0001.png': '/tmp/seq-24fps.mp4' } } as unknown as QueueTask
  check('the last preview leaving empties the field', withSourceTiming(lone, '/seq/f_0001.png', { fps: 30 }).imageSequencePreviews, undefined)

  // One rule for the rate, whichever window asked: the timeline model's own.
  check('a sequence reports its own rate', sourceFps(sequence(), '/seq/f_0001.png'), 24)
  const still = { ...sequence(), sourcePaths: ['/frame.png'], sequenceInput: undefined, sequenceInputs: undefined, sourceMetadata: { '/frame.png': { fps: 30 } } } as unknown as QueueTask
  check('a still reports the rate recorded for it', sourceFps(still, '/frame.png'), 30)
  const bare = { ...still, sourceMetadata: undefined, preset: { ...still.preset, fps: 50 } } as unknown as QueueTask
  check('then the preset', sourceFps(bare, '/frame.png'), 50)
  const nothing = { ...bare, preset: { ...bare.preset, fps: undefined } } as unknown as QueueTask
  check('and finally 25', sourceFps(nothing, '/frame.png'), 25)
}

console.log('\n== a zoomed timeline follows the skimmer ==')
{
  // The ruler, the lane heads and the playhead all start after this column.
  const LABEL = 102
  near('the skimmer sits past the label column', skimmerOffset(0, 918, LABEL), 102)
  near('and at the far edge', skimmerOffset(1, 918, LABEL), 918)
  near('half way across', skimmerOffset(0.5, 918, LABEL), 510)

  const view = { scrollLeft: 0, viewportWidth: 918, contentWidth: 918 }
  check('a timeline that fits its window never pans', scrollToKeepVisible({ ...view, offset: 900 }), null)

  const zoomed = { scrollLeft: 0, viewportWidth: 918, contentWidth: 918 * 4 }
  check('a skimmer inside the window and its margin does not move it', scrollToKeepVisible({ ...zoomed, offset: 400 }), null)
  check('a skimmer in the left margin is centred', scrollToKeepVisible({ ...zoomed, offset: 10 }), 0)
  near('a skimmer past the right margin is centred', scrollToKeepVisible({ ...zoomed, offset: 900 })!, 441)
  near('and the centring is clamped at the start', scrollToKeepVisible({ ...zoomed, scrollLeft: 300, offset: 310 })!, 0)

  // The same effect has to fire for a wheel scrub and for an arrow step, both of which
  // move the skimmer while the transport is paused, so this is checked for a paused
  // position rather than one playback produced.
  const walked = scrollToKeepVisible({ ...zoomed, scrollLeft: 0, offset: 3000 })
  near('a long step still lands the skimmer in view', walked!, 2541)
  check('and the answer really is in view', walked! + 918 >= 3000, true)
}

console.log('\n== a generated clip is keyed by what it was built with ==')
{
  // A sequence's clip is identified by its source alone.
  check('a plain key is the source', previewKey('/seq/f_0001.png'), '/seq/f_0001.png')
  // A still's also carries the rate and length, so changing either misses the cache and
  // rebuilds instead of handing back footage at parameters the user replaced.
  const at25 = previewKey('/frame.png', 'still:25:10')
  const at30 = previewKey('/frame.png', 'still:30:10')
  const longer = previewKey('/frame.png', 'still:25:20')
  check('a different rate is a different clip', at25 === at30, false)
  check('a different length is a different clip', at25 === longer, false)
  check('and both still name their source', [sourceOfPreviewKey(at25), sourceOfPreviewKey(at30)], ['/frame.png', '/frame.png'])

  // A sequence's clip carries its rate and frame count: a clip built at another rate is a
  // different length, so playing it would run the sequence at the wrong speed rather than
  // merely looking stale. This is what made every sequence play too fast.
  const seqAt25 = previewKey('/seq/f_0001.png', 'seq:25:240')
  const seqAt30 = previewKey('/seq/f_0001.png', 'seq:30:240')
  const seqReframed = previewKey('/seq/f_0001.png', 'seq:30:300')
  check('another rate is another sequence clip', seqAt25 === seqAt30, false)
  check('and so is another frame count', seqAt30 === seqReframed, false)
  check('a sequence clip still names its source', sourceOfPreviewKey(seqAt30), '/seq/f_0001.png')

  // The helper reports the clip it was handed on close, so the clip has to lead back to
  // the media the user picked, or the in/out points are filed against a file name that
  // will not exist the next time the helper opens.
  const previews = { [at30]: '/tmp/still-30fps.mp4', '/other.mp4': '/tmp/other.mp4' }
  check('a clip leads back to its source', sourceOfPreview(previews, '/tmp/still-30fps.mp4'), '/frame.png')
  check('a source that was never generated leads nowhere', sourceOfPreview(previews, '/tmp/unknown.mp4'), null)

  const pruned = { ...previews, [at25]: '/tmp/still-25fps.mp4' }
  dropPreviewsFor(pruned, '/frame.png')
  check('every clip for one source is dropped together', pruned, { '/other.mp4': '/tmp/other.mp4' })

  // A rate change invalidates a still's clip even though its key is not the source path.
  const stillTask = {
    id: 's', type: 'transcode', status: 'pending', progress: 0,
    sourcePaths: ['/frame.png'], outputDirectory: '/out', outputFilename: 'o.mov', sourceBaseName: 'frame',
    preset: { id: 'p', name: 'P', container: 'mov', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    imageSequencePreviews: { [at30]: '/tmp/still-30fps.mp4', '/other.mp4': '/tmp/other.mp4' },
  } as unknown as QueueTask
  check('a rate change drops a still clip built at the old rate', withSourceTiming(stillTask, '/frame.png', { fps: 60 }).imageSequencePreviews, { '/other.mp4': '/tmp/other.mp4' })
}

console.log('\n== a still’s clip length is settable per source ==')
{
  const still = {
    id: 's', type: 'transcode', status: 'pending', progress: 0,
    sourcePaths: ['/frame.png'], outputDirectory: '/out', outputFilename: 'o.mov',
    sourceBaseName: 'frame', stillImageDuration: 10,
    preset: { id: 'p', name: 'P', container: 'mov', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
  } as unknown as QueueTask
  near('the job default is used until one is recorded', stillSecondsFor(still, '/frame.png'), 10)
  near('and a job-wide default is itself a fallback for nothing', stillSecondsFor({ ...still, stillImageDuration: 4 } as QueueTask, '/frame.png'), 4)
  near('with neither, ten seconds', stillSecondsFor({ ...still, stillImageDuration: undefined } as QueueTask, '/frame.png'), 10)

  const recorded = withSourceTiming(still, '/frame.png', { seconds: 20 })
  near('a recorded length wins over the job default', stillSecondsFor(recorded, '/frame.png'), 20)
  near('and the timeline contributes exactly that', sourceDuration(recorded, '/frame.png'), 20)
  check('recording a length drops the clip built at the other one', recorded.imageSequencePreviews, undefined)
  check('applying what is already recorded changes nothing', withSourceTiming(recorded, '/frame.png', { seconds: 20 }), recorded)
  check('and neither does an empty override', withSourceTiming(recorded, '/frame.png', {}), recorded)
  near('a still keeps its rate when only its length changes', sourceFps(recorded, '/frame.png'), 25)

  // An interpreted sequence derives its length from its frames, so a length is not a choice
  // that can be offered for it, and offering one must not disturb it.
  const seqTask = {
    ...still, sourcePaths: ['/seq/f_0001.png'], sequenceInput: { dir: '/seq', pattern: 'f_%04d.png', globPattern: '*', startNumber: 1, frameCount: 240, hasGaps: false, missing: [], fps: 24, firstFrame: '/seq/f_0001.png' },
  } as unknown as QueueTask
  check('a length cannot be recorded against a sequence', withSourceTiming(seqTask, '/seq/f_0001.png', { seconds: 20 }), seqTask)
  near('but its rate can', withSourceTiming(seqTask, '/seq/f_0001.png', { fps: 48 }).sequenceInput!.duration!, 5)
  near('and its length follows the rate', sourceDuration(withSourceTiming(seqTask, '/seq/f_0001.png', { fps: 48 }), '/seq/f_0001.png'), 5)

  // The editor sends back everything it has recorded, so only what can actually be set is
  // sent: a sequence's derived length is not mistaken for a choice.
  check('only what can be set is sent back', sourceTimingOverrides(recorded), { '/frame.png': { seconds: 20 } })
  check('a sequence sends its rate and no length', sourceTimingOverrides(seqTask), { '/seq/f_0001.png': { fps: 24 } })
}

console.log('\n== the output frame ==')
{
  check('a named resolution is a box', resolutionBox('1080p'), { width: 1920, height: 1080 })
  check('and source is no box at all', resolutionBox('source'), undefined)

  // An exact size is applied as it stands, so the frame is that shape whatever the picture is.
  check('an exact size is the frame', outputFrameSize({ natural: { width: 1195, height: 896 }, exact: { width: 1920, height: 1080 }, box: { width: 1920, height: 1080 } }), { width: 1920, height: 1080 })
  check('an odd exact size is rounded to even', outputFrameSize({ exact: { width: 1921, height: 1081 } }), { width: 1920, height: 1080 })

  // A named resolution is the frame itself now: the picture is fitted inside the box and padded
  // out to it, so the output really is the resolution that was asked for. It used to be the
  // fitted size, which is what made 4K on a portrait source come out portrait.
  check('a named resolution IS the frame, whatever the picture is', outputFrameSize({ natural: { width: 1195, height: 896 }, box: { width: 1920, height: 1080 } }), { width: 1920, height: 1080 })
  check('and the same for a portrait source asked for 4K', outputFrameSize({ natural: { width: 720, height: 1280 }, box: { width: 3840, height: 2160 } }), { width: 3840, height: 2160 })
  check('and a 720p box is 720p too', outputFrameSize({ natural: { width: 1920, height: 1080 }, box: { width: 1280, height: 720 } }), { width: 1280, height: 720 })

  // With neither, the picture's shape is the output's, and only the encoder's even-size
  // rounding applies. This is the case that used to fail the whole job outright.
  check('source resolution is the picture, rounded to even', outputFrameSize({ natural: { width: 1195, height: 896 } }), { width: 1194, height: 896 })
  check('nothing is drawn before the picture has loaded', outputFrameSize({ box: { width: 1920, height: 1080 } }), { width: 1920, height: 1080 })

  check('a wide frame in a tall box is limited by the width', fitFrame({ width: 400, height: 600 }, 16 / 9), { width: 400, height: 225 })
  check('a wide frame in a wide box is limited by the height', fitFrame({ width: 800, height: 400 }, 16 / 9), { width: 711.1111111111111, height: 400 })

  // How the monitor fits the picture into its panel. Width and height fill that one dimension
  // and let the other run over, which is what the two fit commands mean; contain does not.
  check('fit to width fills the width', fitFrameBy({ width: 400, height: 300 }, 16 / 9, 'width'), { width: 400, height: 225 })
  near('fit to height fills the height', fitFrameBy({ width: 400, height: 300 }, 16 / 9, 'height')!.width, 533.3333333333334, 1e-9)
  check('and its height is the panel', fitFrameBy({ width: 400, height: 300 }, 16 / 9, 'height')!.height, 300)
  check('contain is still the whole frame inside', fitFrameBy({ width: 400, height: 300 }, 16 / 9, 'contain'), fitFrame({ width: 400, height: 300 }, 16 / 9))
  check('and is what being asked for nothing gets', fitFrameBy({ width: 400, height: 300 }, 16 / 9), fitFrame({ width: 400, height: 300 }, 16 / 9))
  check('no room draws nothing in any mode', [fitFrameBy({ width: 0, height: 300 }, 16 / 9, 'width'), fitFrameBy({ width: 400, height: 0 }, 16 / 9, 'height')], [null, null])
  near('a box that matches the frame is the whole box', fitFrame({ width: 800, height: 600 }, 4 / 3)!.width, 800)
  check('an empty box draws nothing', fitFrame({ width: 0, height: 600 }, 16 / 9), null)
  check('and neither does a nonsense aspect', fitFrame({ width: 800, height: 600 }, 0), null)
}

console.log('\n== progress is measured against the length the job will have ==')
{
  near('a timemark becomes seconds', timemarkSeconds('00:02:59.41')!, 179.41)
  check('a bare number is not a timemark', timemarkSeconds('12'), null)
  check('nor is nothing', timemarkSeconds(undefined), null)
  // The reported case: the timemark advanced while the bar sat empty, because
  // fluent-ffmpeg never supplied a percentage for that input.
  check('a position against the expected length is a percentage', progressPercent({ timemark: '00:00:30.00', expectedSeconds: 60 }), 50)
  check('the fallback is used when there is no position', progressPercent({ expectedSeconds: 0, fallback: 42 }), 42)
  check('an unknown length falls back as well', progressPercent({ expectedSeconds: 0 }), 0)
  check('a position past the end is clamped', progressPercent({ timemark: '00:02:00.00', expectedSeconds: 60 }), 100)
  check('and the fallback is clamped too', progressPercent({ expectedSeconds: 0, fallback: 140 }), 100)
  check('half a minute of a long job is a small percentage', progressPercent({ timemark: '00:00:30.00', expectedSeconds: 600 }), 5)
}

console.log('\n== the output shape ==')
{
  // A named resolution is a short side, which is what makes it meaningful upright: 1080p is
  // not a 1920-wide slot.
  check('16:9 at 1080p', aspectSize(16 / 9, 1080), { width: 1920, height: 1080 })
  check('4:3 at 1080p', aspectSize(4 / 3, 1080), { width: 1440, height: 1080 })
  check('1:1 at 1080p', aspectSize(1, 1080), { width: 1080, height: 1080 })
  check('9:16 at 1080p is upright', aspectSize(9 / 16, 1080), { width: 1080, height: 1920 })
  check('16:9 at 720p', aspectSize(16 / 9, 720), { width: 1280, height: 720 })
  check('the short side each resolution stands for', [resolutionShortSide('4k'), resolutionShortSide('1080p'), resolutionShortSide('720p'), resolutionShortSide('source')], [2160, 1080, 720, 1080])
}

console.log('\n== cropping ==')
{
  check('an empty crop is no crop', hasCrop({ left: 0, top: 0, right: 0, bottom: 0 }), false)
  check('and an absent one is none either', hasCrop(undefined), false)
  check('any edge makes it a crop', hasCrop({ left: 0.1, top: 0, right: 0, bottom: 0 }), true)
  // The whole point of clamping: the filter must never be handed an empty picture. Each edge
  // is capped on its own, so a crop may still reach MAX_CROP in from both sides at once and
  // the smallest sliver left is the tenth that 2 x MAX_CROP allows.
  check('a crop cannot eat the whole frame', clampCrop({ left: 0.9, top: 0, right: 0.9, bottom: 0 }), { left: MAX_CROP, top: 0, right: MAX_CROP, bottom: 0 })
  near('and the sliver it leaves is a tenth', 1 - MAX_CROP * 2, 0.1, 1e-9)
  check('a negative edge is no edge', clampCrop({ left: -1, top: 0, right: 0, bottom: 0 }).left, 0)
  check('the filter keeps the picture it was asked for', cropFilter({ left: 0.1, top: 0.05, right: 0, bottom: 0.05 }), 'crop=max(2\\,iw*0.900000):max(2\\,ih*0.900000):iw*0.100000:ih*0.050000')
  check('and the smallest side is floored at two pixels', cropFilter({ left: 0, top: 0, right: 0, bottom: 0 }).startsWith('crop=max(2\\,iw*1.000000)'), true)

  // The shading the monitor draws: the four bands a kept rect leaves inside its picture box.
  // A 100x50 picture keeping the middle 50x20 (from x=25, y=15) leaves a 25-wide strip on
  // each side and a 15-tall strip above and below, and nothing at all overlapping the kept
  // rect. That is what stops a crop from tinting the output frame or the rest of the stage.
  const bands = cropBands({ left: 0, top: 0, width: 100, height: 50 }, { left: 25, top: 15, width: 50, height: 20 })
  check('the crop shades each side separately', bands, [
    { left: 0, top: 0, width: 25, height: 50 },
    { left: 75, top: 0, width: 25, height: 50 },
    { left: 25, top: 0, width: 50, height: 15 },
    { left: 25, top: 35, width: 50, height: 15 },
  ])
  check('an untouched picture leaves no shade', cropBands({ left: 0, top: 0, width: 100, height: 50 }, { left: 0, top: 0, width: 100, height: 50 }).every((band) => band.width === 0 || band.height === 0), true)
}

console.log('\n== crop proportions and units ==')
{
  // Reading the same crop in the other unit. The fractions are the stored form; the pixels are
  // what the fields show, and the two must describe one crop rather than drifting apart.
  check('a crop read in pixels', cropPixels({ left: 0.1, top: 0.05, right: 0.2, bottom: 0.1 }, { width: 1920, height: 1080 }), { left: 192, top: 54, right: 384, bottom: 108 })
  check('and read back as fractions', cropFractions({ left: 192, top: 54, right: 384, bottom: 108 }, { width: 1920, height: 1080 }), { left: 0.1, top: 0.05, right: 0.2, bottom: 0.1 })
  check('a crop of nothing is no pixels either', cropPixels({ left: 0, top: 0, right: 0, bottom: 0 }, { width: 1920, height: 1080 }), { left: 0, top: 0, right: 0, bottom: 0 })

  // The shape a crop keeps, which is what the proportion list matches against.
  check('no crop keeps the picture shape', keptAspect({ left: 0, top: 0, right: 0, bottom: 0 }, 16 / 9), 16 / 9)
  near('half the width kept is half the shape', keptAspect({ left: 0.25, top: 0, right: 0.25, bottom: 0 }, 16 / 9)!, 8 / 9)
  check('a crop that keeps nothing has no shape', keptAspect({ left: 0.5, top: 0, right: 0.5, bottom: 0 }, 16 / 9), undefined)

  // The shapes the list offers. Each must actually KEEP the shape it names, which is the whole
  // point, and must trim only one axis so the region stays the largest of that shape that fits.
  const square = cropForProportion(16 / 9, 1)
  near('a 16:9 picture cropped to 1:1 keeps 1:1', keptAspect(square, 16 / 9)!, 1, 1e-9)
  check('and trims the sides, not the top', [square.top, square.bottom], [0, 0])

  const vertical = cropForProportion(16 / 9, 9 / 16)
  near('a 16:9 picture cropped to 9:16 keeps 9:16', keptAspect(vertical, 16 / 9)!, 9 / 16, 1e-9)
  check('and trims the sides, not the top', [vertical.top, vertical.bottom], [0, 0])

  const landscape = cropForProportion(9 / 16, 16 / 9)
  near('a portrait picture cropped to landscape keeps 16:9', keptAspect(landscape, 9 / 16)!, 16 / 9, 1e-9)
  check('and trims the top and bottom instead', [landscape.left, landscape.right], [0, 0])

  check('a picture with no shape asked for gets no crop', cropForProportion(0, 1), { left: 0, top: 0, right: 0, bottom: 0 })
}

console.log('\n== moving and resizing the crop ==')
{
  const box = { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 }
  // Sliding the region: both edges of an axis move together, which is what keeps its size.
  const movedRight = shiftCrop(box, 0.05, 0)
  near('a crop moves right by giving the right edge away', movedRight.left, 0.15, 1e-9)
  near('and the right edge gives exactly as much', movedRight.right, 0.05, 1e-9)
  const movedDown = shiftCrop(box, 0, 0.05)
  near('and moves down by giving the bottom edge away', movedDown.top, 0.15, 1e-9)
  near('with the bottom edge giving the same', movedDown.bottom, 0.05, 1e-9)
  // It stops at the picture rather than shrinking itself against the edge.
  check('a move past the right edge stops with nothing left over', shiftCrop(box, 1, 0), { left: 0.2, top: 0.1, right: 0, bottom: 0.1 })
  check('and the same the other way', shiftCrop(box, -1, 0), { left: 0, top: 0.1, right: 0.2, bottom: 0.1 })
  check('a crop already at the cap both sides cannot move along it', shiftCrop({ left: MAX_CROP, top: 0.1, right: MAX_CROP, bottom: 0.1 }, 0.1, 0), { left: MAX_CROP, top: 0.1, right: MAX_CROP, bottom: 0.1 })

  const picture = { width: 1920, height: 1080 }
  const from = { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 }
  // Resizing from a corner holds the shape chosen in the proportion list. The pointer is given
  // in picture fractions, and the shape is held in pixels, so the two only agree once the
  // picture's own shape is taken into account: that is the whole job of this rule.
  const square = resizeCorner({ crop: from, picture, corner: 'bottomRight', point: { x: 0.8, y: 0.8 }, ratio: 1 })
  near('a corner drag to 1:1 keeps 1:1', keptAspect(square, 16 / 9)!, 1, 1e-9)
  check('and the opposite corner does not move', [square.left, square.top], [from.left, from.top])

  const anchored = resizeCorner({ crop: from, picture, corner: 'topLeft', point: { x: 0.2, y: 0.2 }, ratio: 1 })
  near('dragging the other corner keeps 1:1 too', keptAspect(anchored, 16 / 9)!, 1, 1e-9)
  check('and IT leaves its own opposite corner still', [anchored.right, anchored.bottom], [from.right, from.bottom])

  const wide = resizeCorner({ crop: from, picture, corner: 'topRight', point: { x: 0.6, y: 0.2 }, ratio: 4 / 3 })
  near('each listed shape is held, not only 1:1', keptAspect(wide, 16 / 9)!, 4 / 3, 1e-9)

  // Without a shape from the list the region's own shape is held, so a corner is always
  // proportional rather than free.
  const own = resizeCorner({ crop: from, picture, corner: 'bottomRight', point: { x: 0.9, y: 0.9 } })
  near('with nothing chosen the crop keeps its own shape', keptAspect(own, 16 / 9)!, keptAspect(from, 16 / 9)!, 1e-9)

  // NONE in the list holds no shape at all, so the corner follows the pointer on both axes and
  // the region it leaves is the pointer's shape rather than a locked one.
  const free = resizeCorner({ crop: from, picture, corner: 'bottomRight', point: { x: 0.8, y: 0.7 }, free: true })
  check('a freeform corner leaves the anchor alone', [free.left, free.top], [from.left, from.top])
  near('and follows the pointer across', free.right, 0.2, 1e-9)
  near('and follows it down', free.bottom, 0.3, 1e-9)
  near('so the region kept is the pointer shape, not a locked one', keptAspect(free, 16 / 9)!, (0.7 * 1920) / (0.6 * 1080), 1e-9)
  // Still bounded: the moving edge cannot pass the cap, so neither can the pointer drag it there.
  const pushed = resizeCorner({ crop: from, picture, corner: 'bottomRight', point: { x: 0.5, y: 0.5 }, free: true })
  near('and a freeform drag is still capped across', pushed.right, MAX_CROP, 1e-9)
  near('and down', pushed.bottom, MAX_CROP, 1e-9)
}

console.log('\n== the exact-size fields ==')
{
  // The fields start from the preset's own pair when it has one, and otherwise from the frame
  // the encoder is already writing, so an edit to one edge has something to keep the other from.
  check('a set pair wins', exactSizeFields({ width: 1920, height: 1080 }, { width: 1280, height: 720 }), { width: 1920, height: 1080 })
  check('an unset pair falls back to the effective frame', exactSizeFields({}, { width: 1280, height: 720 }), { width: 1280, height: 720 })
  check('and nothing at all before the media has loaded', exactSizeFields({}, undefined), undefined)

  // An edit always writes BOTH edges, because the encoder ignores an exact size that is only
  // half set, which is what made typing in one field look like nothing happened.
  check('editing the width keeps the height when unlocked', resizeExact({ width: 1920, height: 1080 }, 'width', 1280, false), { width: 1280, height: 1080 })
  check('editing the height keeps the width when unlocked', resizeExact({ width: 1920, height: 1080 }, 'height', 720, false), { width: 1920, height: 720 })
  check('a locked width carries the height with it', resizeExact({ width: 1920, height: 1080 }, 'width', 1280, true), { width: 1280, height: 720 })
  check('a locked height carries the width with it', resizeExact({ width: 1920, height: 1080 }, 'height', 720, true), { width: 1280, height: 720 })
  check('a locked portrait pair stays portrait', resizeExact({ width: 1080, height: 1920 }, 'width', 540, true), { width: 540, height: 960 })
  check('a locked square stays square', resizeExact({ width: 1080, height: 1080 }, 'height', 500, true), { width: 500, height: 500 })
  // A frame can never be zero pixels wide, whatever is typed into the box.
  check('a locked size never falls to zero', resizeExact({ width: 1920, height: 1080 }, 'width', 0, true), { width: 2, height: 2 })
}

console.log('\n== the timeline filmstrip ==')
{
  // The lane width is dynamic, so every figure is recomputed from the one in hand. Coverage is
  // the whole point: the samples must span the clip's whole TRIM however many tiles fit, and a
  // wider lane must buy density rather than less of the range. That is what deriving the step
  // from the tile count does, and what a fixed step cannot do.
  const base = { thumbHeight: 32, srcAspect: 16 / 9, fps: 30, inSec: 0, outSec: 8 }
  const wide = computeFilmstrip({ ...base, laneWidth: 640 })
  check('a tile is as wide as its own picture', wide.thumbWidth, Math.round(32 * (16 / 9)))
  check('the count is how many fit across the lane', wide.thumbCount, Math.round(640 / wide.thumbWidth))
  near('the cells share the lane exactly', wide.cellWidth * wide.thumbCount, 640, 1e-9)
  near('the step is the trimmed frames over the count', wide.step, Math.round(8 * 30) / wide.thumbCount, 1e-9)

  // Sampling is inside the TRIM, offset by the in-point, so each tile matches the frame the
  // playhead would show at that place on the lane.
  const trimmed = computeFilmstrip({ ...base, laneWidth: 640, inSec: 2, outSec: 6 })
  const first = Math.round(2 * 30)
  const last = Math.round(6 * 30) - 1
  check('the first sample is inside the trim, not before it', trimmed.frames[0] >= first, true)
  check('and the last is still inside it', trimmed.frames[trimmed.frames.length - 1] <= last, true)
  check('nothing is sampled from outside the trim', trimmed.frames.every((frame) => frame >= first && frame <= last), true)
  check('the last sample reaches the far end of the trim', trimmed.frames[trimmed.frames.length - 1] > last - trimmed.step, true)
  check('with one sample per tile', trimmed.frames.length, trimmed.thumbCount)
  check('with one sample time per tile', trimmed.times.length, trimmed.thumbCount)
  check('the sample times run forward', trimmed.times.every((time, index) => index === 0 || time > trimmed.times[index - 1]), true)
  check('and every one is inside the trim', trimmed.times.every((time) => time >= 2 && time <= 6), true)
  // A time and the frame it falls on are derived together, so the picture a tile asks for and
  // the key it is cached under cannot drift apart.
  check('each time names the frame it falls on', trimmed.frames.every((frame, index) => frame === Math.max(first, Math.min(last, Math.round(trimmed.times[index] * 30)))), true)

  // Density, not coverage: a wider lane fits more tiles AND samples more densely across the
  // same span, and a narrower one still reaches the end.
  const narrow = computeFilmstrip({ ...base, laneWidth: 320 })
  check('a narrower lane fits fewer tiles', narrow.thumbCount < wide.thumbCount, true)
  check('but still reaches the far end', narrow.frames[narrow.frames.length - 1] > Math.round(8 * 30) - 1 - narrow.step, true)
  check('and the wide lane samples more densely', wide.step < narrow.step, true)

  // The QUICK LOOK helper's rule: the tile is the shape of its own picture, so filling a cell
  // with it crops a sliver. A portrait source therefore makes narrow tiles and so more of them,
  // which is the helper's behaviour too rather than a fault.
  const portrait = computeFilmstrip({ ...base, laneWidth: 640, srcAspect: 9 / 16 })
  check('a portrait picture makes narrow tiles', portrait.thumbWidth, Math.round(32 * (9 / 16)))
  check('so more of them fit', portrait.thumbCount > wide.thumbCount, true)
  const likely = [computeFilmstrip({ ...base, laneWidth: 400 }), computeFilmstrip({ ...base, laneWidth: 400 })]
  check('and two clips of the same picture and lane lay out identically', likely[0].thumbWidth === likely[1].thumbWidth && likely[0].thumbCount === likely[1].thumbCount, true)

  // Never more tiles than there are frames to fill them: past that the same frame would be
  // asked for twice over, which is work for nothing.
  const sparse = computeFilmstrip({ ...base, laneWidth: 640, inSec: 0, outSec: 3 / 30 })
  check('a three-frame trim cannot fill more than three tiles', sparse.thumbCount, 3)
  check('and each tile still gets its own frame', sparse.frames.length, 3)

  check('a nonsense picture shape falls back to 16:9', computeFilmstrip({ ...base, laneWidth: 640, srcAspect: 0 }).thumbWidth, Math.round(32 * (16 / 9)))

  // Degenerate inputs still describe a whole clip rather than nothing.
  check('a lane narrower than a tile still shows one', computeFilmstrip({ ...base, laneWidth: 8 }).thumbCount, 1)
  near('and that one tile is the middle of the trim', computeFilmstrip({ ...base, laneWidth: 8 }).frames[0], Math.round(0.5 * 240), 1e-9)
  check('an enormous lane is capped', computeFilmstrip({ ...base, laneWidth: 100000 }).thumbCount, FILMSTRIP_MAX_TILES)
  check('a nonsense picture shape still lays out', computeFilmstrip({ ...base, laneWidth: 640, srcAspect: Number.NaN }).thumbCount > 0, true)
  check('a zero-width lane still yields one cell', computeFilmstrip({ ...base, laneWidth: 0 }).thumbCount, 1)
  check('and a clip with no frames still samples inside itself', computeFilmstrip({ ...base, laneWidth: 640, inSec: 4, outSec: 4 }).frames.every((frame) => frame === 120), true)

  // The cell the pointer is over, and how far into it.
  check('the first tile holds the start', filmstripCell(0, 4), { cell: 0, within: 0 })
  check('halfway across four tiles is the third of them', filmstripCell(0.5, 4), { cell: 2, within: 0 })
  near('a little into the first tile is a little into the first frame', filmstripCell(0.1, 4)!.within, 0.4, 1e-9)
  check('and the last fraction cannot fall off the end', filmstripCell(1, 4).cell, 3)
  check('a nonsense fraction lands on the first tile', filmstripCell(Number.NaN, 4).cell, 0)

  // A skimmed moment becomes an absolute source frame, which is the key its frame is cached
  // under: the same key the strip's own frames use, so neither is ever extracted twice.
  check('a skimmed moment becomes a source frame', skimFrame(1, 30), 30)
  check('two moments a hair apart share one frame', skimFrame(1.01, 30) === skimFrame(0.99, 30), true)
  check('and a later moment is a later frame', skimFrame(1.5, 30) > skimFrame(1, 30), true)
  check('a nonsense moment is the first frame', skimFrame(Number.NaN, 30), 0)
  check('a clip with no rate still gives a frame', skimFrame(1, 0), 30)

  // A thumbnail's key carries the frame and the source shape it was drawn at, because a tile is
  // generated at its own picture's width and footage whose shape changed must not be served the
  // pictures drawn for the old one.
  check('a key names its frame and its shape', frameKey(120, 16 / 9), '120|1.7778')
  check('the same frame at another shape is another picture', frameKey(120, 16 / 9) === frameKey(120, 4 / 3), false)
  check('while the same frame at the same shape is the same picture', frameKey(120, 16 / 9) === frameKey(120, 16 / 9), true)
  check('a nonsense shape falls back rather than colliding', frameKey(1, 0), '1|1.7778')
}

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
