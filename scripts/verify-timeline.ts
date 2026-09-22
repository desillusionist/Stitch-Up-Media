import { advanceClock, elementOwnsPosition } from '../src/lib/playbackClock'
import { nextShuttleRate } from '../src/lib/shuttleRates'
import { withSourceTiming, sourceTimingOverrides } from '../src/lib/sourceTiming'
import { dropPreviewsFor, previewKey, rememberedPreviewFor, sequencePreviewKey, sourceOfPreview, sourceOfPreviewKey } from '../src/lib/quickLookTarget'
import { progressPercent, timemarkSeconds } from '../src/lib/progress'
import { aspectSize, clampCrop, cropBands, cropFilter, cropFractions, cropForProportion, cropPixels, exactSizeFields, fitFrame, fitFrameBy, hasCrop, holdCropShape, insetCrop, keptAspect, outputFrameSize, resolutionBox, resolutionShortSide, resizeCorner, resizeExact, shiftCrop, MAX_CROP } from '../src/lib/outputFrame'
import { computeFilmstrip, frameKey, thumbnailSignature } from '../src/lib/filmstrip'
import { DEFAULT_FIT_OFFSET, clipFilters, cropRegion, croppedSize, fitFilters, fitOffsetFor, fitPlacement, fitSignature, fittedSize, hasInsets, innerBox, normaliseInsets, placedSource, sourceCropOf, storedFitOffset } from '../src/lib/sourceFit'
import { PREVIEW_ZOOM_STEPS, PreviewZoom, clampPan, clampPreviewZoom, isPresetZoom, panSlack, zoomFitMode, zoomedRaster } from '../src/lib/previewZoom'
import { scrollToKeepVisible, skimmerOffset } from '../src/lib/timelinePan'
import { BASE_PX_PER_SECOND, FIT_TRAILING_MARKER, ZOOM_MAX, ZOOM_MIN, clampZoom, fitZoom, laneWidthFor, pxPerSec, secondsAt } from '../src/lib/timelineScale'
import { HISTORY_LIMIT, emptyHistory, recordChange, sameField, stepHistory } from '../src/lib/draftHistory'
import { placeMenu } from '../src/lib/menuPlacement'
import { WAVEFORM_BAR, WAVEFORM_PEAKS, normalisePeaks, peaksForTrim, peaksFromSamples, waveformPath } from '../src/lib/waveform'
import { buildTimeline, canApplyClipFit, edgeFade, laneIsMuted, maxEdgeFade, maxFadeAtBoundary, rekeyClipMap, resolveFades, segmentTiming, sourceDuration, sourceFitFor, sourceFps, SourceTiming, stillSecondsFor, usesClipFraming } from '../src/lib/timelineModel'
import { EncodingPreset, QueueTask, SourceFit } from '../src/types'
import { inferredMode, removeSourceFromTask } from '../src/lib/sourceRemoval'

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

  // The lanes are named once for the whole app, and the numbers count the tracks rather than the
  // rows: the video row is not a numbered one, and the first added track is the first AUDIO.
  check('the video lane is just VIDEO', main.label, 'VIDEO')
  check('and the first added track is AUDIO 1', audio.label, 'AUDIO 1')

  // The mute is the export's decision as well as the monitor's, so both ask the same question.
  check('a lane is carried until it is muted', laneIsMuted(task, 'trk'), false)
  const mutedTask = { ...task, mutedLanes: { trk: true } } as unknown as QueueTask
  check('and is not carried once it is', laneIsMuted(mutedTask, 'trk'), true)
  check('while another lane is untouched', laneIsMuted(mutedTask, 'main'), false)
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
  // A probe reports a length as well as a rate — the type has no room for one without the other —
  // so the mock reports the still's own length. Only the rate is read here: a still's length is
  // stillSecondsFor, and never the probe's.
  const probe = (): SourceTiming => ({ duration: 10, fps: 25 })
  const presetOnly = { ...still, preset: { ...still.preset, fps: 30 } } as unknown as QueueTask
  check('a probed still rate does not override the preset', sourceFps(presetOnly, '/frame.png', undefined, probe), 30)
  check('and with no preset either it is 25', sourceFps(still, '/frame.png', undefined, probe), 25)
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
    imageSequencePreviews: { [sequencePreviewKey('/seq/f_0001.png', 24, 240)]: '/tmp/seq-24fps.mp4', '/other.mp4': '/tmp/other.mp4' },
  }) as unknown as QueueTask

  const changed = withSourceTiming(sequence(), '/seq/f_0001.png', { fps: 48 })
  // The generated clip was rendered at 24, so it cannot be shown as though it were 48.
  check('the clip built at the old rate is dropped', changed.imageSequencePreviews, { '/other.mp4': '/tmp/other.mp4' })
  check('the rate is recorded against the source', changed.sourceMetadata, { '/seq/f_0001.png': { fps: 48 } })
  near('the sequence length follows the rate', changed.sequenceInput!.duration!, 5)
  near('and its rate is the new one', changed.sequenceInput!.fps, 48)
  check('a finished job goes back to pending', changed.status, 'pending')
  check('a rate of zero changes nothing', withSourceTiming(sequence(), '/seq/f_0001.png', { fps: 0 }).imageSequencePreviews, { [sequencePreviewKey('/seq/f_0001.png', 24, 240)]: '/tmp/seq-24fps.mp4', '/other.mp4': '/tmp/other.mp4' })

  // Deleting the last preview entry must leave the field absent rather than empty, which
  // is how the rest of the app tests for it.
  const lone = { ...sequence(), imageSequencePreviews: { [sequencePreviewKey('/seq/f_0001.png', 24, 240)]: '/tmp/seq-24fps.mp4' } } as unknown as QueueTask
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
  // The skimmer's offset is its share of the lane area, and the lane area is the whole of the
  // scrollable drawing: the label column is a column of the timeline's grid, beside the scroller
  // rather than inside it, so no figure here has a column to be measured past.
  near('the skimmer starts at the drawing own left edge', skimmerOffset(0, 918), 0)
  near('and ends at its own right edge', skimmerOffset(1, 918), 918)
  near('half way across', skimmerOffset(0.5, 918), 459)
  near('a share of nothing is nothing', skimmerOffset(0.5, 0), 0)

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
  // A crop with a tenth of the picture left in it is still a crop the user may put anywhere: what
  // is capped is the total the two edges take, and moving gives exactly as much as it takes.
  const sliver = { left: MAX_CROP, top: MAX_CROP, right: MAX_CROP, bottom: MAX_CROP }
  check('a crop at its thinnest can still slide along the axis', shiftCrop(sliver, 0.1, 0), { left: 0.55, top: MAX_CROP, right: 0.35, bottom: MAX_CROP })
  check('all the way to the near edge', shiftCrop(sliver, 1, 0), { left: 0.9, top: MAX_CROP, right: 0, bottom: MAX_CROP })
  check('and all the way to the far one', shiftCrop(sliver, -1, 0), { left: 0, top: MAX_CROP, right: 0.9, bottom: MAX_CROP })

  // The case that was reported: a portrait source cropped to landscape, which keeps a third of its
  // height, could be moved about a tenth of the way up or down it and no further — so the top and the
  // bottom of the picture were unreachable. The region's size has nothing to do with where on the
  // axis it may sit.
  const band = cropForProportion(9 / 16, 16 / 9)
  near('the crop keeps a third of the portrait', 1 - band.top - band.bottom, 0.3164, 0.001)
  near('and can be moved to the very top', shiftCrop(band, 0, -1).top, 0, 1e-9)
  near('and to the very bottom', shiftCrop(band, 0, 1).bottom, 0, 1e-9)
  near('with the same height all the way', 1 - shiftCrop(band, 0, 1).top - shiftCrop(band, 0, 1).bottom, 1 - band.top - band.bottom, 1e-9)
  // A single edge may still reach in a long way on its own, as long as the axis keeps a tenth.
  check('one edge may take most of the picture', clampCrop({ left: 0.8, top: 0.6, right: 0, bottom: 0 }), { left: 0.8, top: 0.6, right: 0, bottom: 0 })
  check('but not all of it, however it is shared out', (() => { const c = clampCrop({ left: 0.9, top: 0.4, right: 0.05, bottom: 0.9 }); return [c.left > 0 && c.right > 0, c.top > 0 && c.bottom > 0] })(), [true, true])
  const packed = clampCrop({ left: 0.9, top: 0.4, right: 0.05, bottom: 0.9 })
  near('and what is left on the packed axis is the tenth', 1 - packed.left - packed.right, 0.1, 1e-9)
  near('and the same on the other', 1 - packed.top - packed.bottom, 0.1, 1e-9)

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

console.log('\n== the crop lock ==')
{
  // The switch's own default: a tenth off each axis. Both axes scale together, which is what keeps
  // the shape, so this is the same inset whatever shape it is applied to.
  near('the switch turns on an inset of a tenth a side', insetCrop({ left: 0, top: 0, right: 0, bottom: 0 }, 0.8).left, 0.1, 1e-9)
  near('and the same on the other side', insetCrop({ left: 0, top: 0, right: 0, bottom: 0 }, 0.8).right, 0.1, 1e-9)
  near('and inset a shaped region keeps its shape', keptAspect(insetCrop(cropForProportion(16 / 9, 1), 0.8), 16 / 9)!, 1, 1e-9)
  near('inset keeps the region centred', insetCrop({ left: 0.2, top: 0.1, right: 0.4, bottom: 0.3 }, 0.5).left, 0.3, 1e-9)
  // An extreme region still leaves a picture behind, because the result is clamped like any crop.
  check('an inset extreme region is still a crop of something', hasCrop(insetCrop(cropForProportion(16 / 9, 9 / 16), 0.5)), true)

  // Holding a shape at a fixed extent: the axis the user set stays put and the other follows, so an
  // edge drag under the lock keeps the output's proportions without moving the edge under the pointer.
  const pictureAspect = 16 / 9
  const box = { left: 0.3, top: 0.3, right: 0.3, bottom: 0.3 }
  const heldWidth = holdCropShape(box, 1, pictureAspect, 'width')
  near('holding a shape off the width keeps 1:1', keptAspect(heldWidth, pictureAspect)!, 1, 1e-9)
  near('and leaves the width alone', heldWidth.left, box.left, 1e-9)
  near('with the region still centred', heldWidth.top, heldWidth.bottom, 1e-9)
  const heldHeight = holdCropShape(box, 1, pictureAspect, 'height')
  near('holding it off the height keeps 1:1 too', keptAspect(heldHeight, pictureAspect)!, 1, 1e-9)
  near('and leaves the height alone', heldHeight.top, box.top, 1e-9)
  // The cap still wins: a shape that cannot fit is clamped rather than allowed to empty the picture.
  const extreme = holdCropShape({ left: 0, top: 0, right: 0, bottom: 0 }, 9 / 16, pictureAspect, 'width')
  check('and an impossible shape is capped, not emptied', 1 - extreme.left - extreme.right >= 0.1 - 1e-9, true)
  check('a draw with no shape to hold is left alone', holdCropShape(box, 0, pictureAspect, 'width'), box)
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
  const base = { thumbHeight: 32, outAspect: 16 / 9, fps: 30, inSec: 0, outSec: 8 }
  const wide = computeFilmstrip({ ...base, laneWidth: 640 })
  // The QUICK LOOK helper's rule moved to the timeline, with one change: a tile is the shape of
  // the OUTPUT frame, not of the clip it came from. That is what makes every strip in a job read as
  // the same job — one tile shape, one density — whichever clips are behind it.
  check('a tile is the shape of the output frame', wide.thumbWidth, Math.round(32 * (16 / 9)))
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

  // The QUICK LOOK helper's rule: the tile is the shape of the output frame, so a portrait clip's
  // tiles are the same shape as a landscape clip's and the same number of them fit. What changes
  // with the clip is the picture inside the tile, not the tile.
  const portrait = computeFilmstrip({ ...base, laneWidth: 640, outAspect: 16 / 9 })
  check('a portrait clip gets the same tiles as any other', [portrait.thumbWidth, portrait.thumbCount], [wide.thumbWidth, wide.thumbCount])
  const tallFrame = computeFilmstrip({ ...base, laneWidth: 640, outAspect: 9 / 16 })
  check('a portrait OUTPUT frame makes narrow tiles', tallFrame.thumbWidth, Math.round(32 * (9 / 16)))
  check('so more of them fit', tallFrame.thumbCount > wide.thumbCount, true)
  const likely = [computeFilmstrip({ ...base, laneWidth: 400 }), computeFilmstrip({ ...base, laneWidth: 400 })]
  check('and two clips of the same picture and lane lay out identically', likely[0].thumbWidth === likely[1].thumbWidth && likely[0].thumbCount === likely[1].thumbCount, true)

  // Never more tiles than there are frames to fill them: past that the same frame would be
  // asked for twice over, which is work for nothing.
  const sparse = computeFilmstrip({ ...base, laneWidth: 640, inSec: 0, outSec: 3 / 30 })
  check('a three-frame trim cannot fill more than three tiles', sparse.thumbCount, 3)
  check('and each tile still gets its own frame', sparse.frames.length, 3)

  check('a nonsense picture shape falls back to 16:9', computeFilmstrip({ ...base, laneWidth: 640, outAspect: 0 }).thumbWidth, Math.round(32 * (16 / 9)))

  // A sequence is counted at the rate the TIMELINE works in, and the strip has to be given that rate.
  // Given the one probing its first FRAME invents — an image has no rate of its own, and ffprobe names
  // one anyway — the same ten seconds is 250 frames rather than 240, and the last tiles sample frames
  // the sequence does not have. The cap on the count is the trimmed frames, which is the wrong number.
  const sequence = (fps: number) => computeFilmstrip({ thumbHeight: 32, outAspect: 16 / 9, fps, inSec: 0, outSec: 240 / 24, laneWidth: 100000 })
  check('a strip counts a sequence at the rate it is played at', Math.max(...sequence(24).frames), 239)
  check('counted at the rate probing invents, it samples past the end', Math.max(...sequence(25).frames), 249)

  // The lane's width is the only thing that decides the count, and a tile's own width never
  // follows it. There used to be a fixed ceiling on the count, and past it every tile grew
  // instead of more of them appearing, so a wider window or a deeper zoom magnified the strip
  // rather than packing more frames in. 1518 pixels across one clip was the measured case.
  check('a wider lane keeps buying density', computeFilmstrip({ ...base, laneWidth: 1518 }).thumbCount, Math.round(1518 / wide.thumbWidth))
  check('well past the count that used to be a ceiling', computeFilmstrip({ ...base, laneWidth: 1518 }).thumbCount > 24, true)
  check('four times the lane is about four times the tiles', computeFilmstrip({ ...base, laneWidth: 4000 }).thumbCount, Math.round(4000 / wide.thumbWidth))
  check('the only bound left is the frames the clip has', computeFilmstrip({ ...base, laneWidth: 100000 }).thumbCount, Math.round(8 * 30))
  check('while a tile keeps its own width whatever the lane', [400, 800, 1200, 1600, 2400].every((laneWidth) => computeFilmstrip({ ...base, laneWidth }).thumbWidth === wide.thumbWidth), true)

  // Degenerate inputs still describe a whole clip rather than nothing.
  check('a lane narrower than a tile still shows one', computeFilmstrip({ ...base, laneWidth: 8 }).thumbCount, 1)
  near('and that one tile is the middle of the trim', computeFilmstrip({ ...base, laneWidth: 8 }).frames[0], Math.round(0.5 * 240), 1e-9)
  check('an enormous lane still samples inside the clip', computeFilmstrip({ ...base, laneWidth: 100000 }).frames.every((frame) => frame >= 0 && frame <= 239), true)
  check('a nonsense picture shape still lays out', computeFilmstrip({ ...base, laneWidth: 640, outAspect: Number.NaN }).thumbCount > 0, true)
  check('a zero-width lane still yields one cell', computeFilmstrip({ ...base, laneWidth: 0 }).thumbCount, 1)
  check('and a clip with no frames still samples inside itself', computeFilmstrip({ ...base, laneWidth: 640, inSec: 4, outSec: 4 }).frames.every((frame) => frame === 120), true)

  // The cell the pointer is over and which frame it samples lived here, along with the quantising
  // that kept a skim from flickering. Both went with the hover-skim itself: the strip is read, not
  // scrubbed, so nothing needs to know which tile a pointer is over.

  // A thumbnail's key carries the frame and a signature of everything that decides its picture: the
  // placement, the offset it is cropped at, the crop the job applies and the two boxes. A frame
  // cached under one placement must never be served for another, which is exactly what toggling a
  // fit or dragging the offset would otherwise do.
  const signature = (over: Partial<Parameters<typeof thumbnailSignature>[0]> = {}) => thumbnailSignature({ source: { width: 720, height: 1280 }, frame: { width: 1920, height: 1080 }, ...over })
  check('a key names its frame and its signature', frameKey(120, 'width@0.000,0.000@720x1280>1920x1080|none'), '120|width@0.000,0.000@720x1280>1920x1080|none')
  check('the same frame under another placement is another picture', frameKey(120, signature({ fit: { mode: 'width', offset: { x: 0, y: 0 } } })) === frameKey(120, signature({ fit: { mode: 'height', offset: { x: 0, y: 0 } } })), false)
  check('and so is the same placement moved', frameKey(120, signature({ fit: { mode: 'width', offset: { x: 0, y: 0 } } })) === frameKey(120, signature({ fit: { mode: 'width', offset: { x: 0, y: 0.2 } } })), false)
  check('while the same placement is the same picture', frameKey(120, signature({ fit: { mode: 'width', offset: { x: 0, y: 0 } } })) === frameKey(120, signature({ fit: { mode: 'width', offset: { x: 0, y: 0 } } })), true)
  check('a job crop is part of it too', signature({ crop: { left: 0.1, top: 0, right: 0.1, bottom: 0 } }) === signature(), false)
  check('and no fit at all is its own signature', signature(), 'contain@1920x1080|full|i0.000,0.000,0.000,0.000|none')
}

console.log('\n== the monitor zoom ==')
{
  // The user's own case: a portrait source in a landscape panel. A fit must keep the whole frame
  // in view, and only a fit may be answered from the panel — a percentage is the raster's own
  // pixels, so it is the same figure whatever the panel is doing. That is the whole distinction
  // between the two halves of the list, and it is what makes a resize hold a percentage still.
  const viewport = { width: 500, height: 300 }
  const other = { width: 900, height: 700 }
  const raster = { width: 720, height: 1280 }
  const height = (size: { width: number; height: number } | null) => size && Math.round(size.height * 100) / 100
  const width = (size: { width: number; height: number } | null) => size && Math.round(size.width * 100) / 100
  const view = (zoom: Parameters<typeof zoomedRaster>[1]) => zoomedRaster(raster, zoom, viewport)

  check('fit keeps the whole frame inside the panel', height(view({ kind: 'fit' })), 300)
  check('and touches it on one axis', width(view({ kind: 'fit' })), 168.75)
  check('fit width fills the width and overflows the height', [width(view({ kind: 'fitWidth' })), height(view({ kind: 'fitWidth' }))], [500, 888.89])
  check('fit height fills the height', [width(view({ kind: 'fitHeight' })), height(view({ kind: 'fitHeight' }))], [168.75, 300])
  check('a hundred per cent is the raster one for one', view({ kind: 'percent', percent: 100 }), { width: 720, height: 1280 })
  check('a named scale is exactly that scale', view({ kind: 'percent', percent: 50 }), { width: 360, height: 640 })
  check('and four hundred per cent is four times it', view({ kind: 'percent', percent: 400 }), { width: 2880, height: 5120 })
  // The shape holds at every kind of zoom, checked as one list so a new kind is added here too.
  const zooms: PreviewZoom[] = [{ kind: 'fit' }, { kind: 'fitWidth' }, { kind: 'fitHeight' }, { kind: 'percent', percent: 137 }]
  check('the shape is kept at every zoom', zooms.every((zoom) => {
    const size = zoomedRaster(raster, zoom, viewport)
    return size ? Math.abs(size.width / size.height - 720 / 1280) < 1e-9 : false
  }), true)

  // A fit is answered from the panel, a percentage is not: that is the whole point of the split.
  check('a fit follows a resize', height(zoomedRaster(raster, { kind: 'fit' }, other)), 700)
  check('a percentage does not', zoomedRaster(raster, { kind: 'percent', percent: 100 }, other), zoomedRaster(raster, { kind: 'percent', percent: 100 }, viewport))
  check('a nonsense raster draws nothing', zoomedRaster({ width: 0, height: 0 }, { kind: 'fit' }, viewport), null)

  check('the named scales are what the list offers', [25, 50, 75, 100, 150, 200, 400].every((step) => isPresetZoom(step) && PREVIEW_ZOOM_STEPS.includes(step as never)), true)
  check('and nothing else is', [0, 33, 137, 401, 1000].some((percent) => isPresetZoom(percent)), false)
  check('a typed figure is whole and inside the range', [137.4, 1, 5000, 0, Number.NaN].map(clampPreviewZoom), [137, 5, 800, 100, 100])
  check('the fitting keeps its own vocabulary', [zoomFitMode({ kind: 'fit' }), zoomFitMode({ kind: 'fitWidth' }), zoomFitMode({ kind: 'fitHeight' })], ['contain', 'width', 'height'])

  // Panning is view only, and only exists where there is something to spare: half the overflow
  // each way from the centre, so no part of the drawing can be pushed out of reach.
  check('a drawing that fits cannot be panned', [panSlack(400, 500), clampPan(50, 400, 500)], [0, 0])
  check('a drawing that overflows has half the overflow each way', [panSlack(800, 500), clampPan(999, 800, 500), clampPan(-999, 800, 500)], [150, 150, -150])
  check('and a pan inside the slack is left alone', clampPan(40, 800, 500), 40)
  check('a nonsense pan is the centre', clampPan(Number.NaN, 800, 500), 0)
}

console.log('\n== the per-clip output fit ==')
{
  // The user's own case: a portrait clip in a landscape frame. FIT TO WIDTH pins the width and leaves
  // a great deal of height over; FIT TO HEIGHT pins the height and leaves the width short. The same
  // figures describe the exported frame, the filter chain that makes it, and a thumbnail of it, so
  // they are asserted once here rather than in each of the three.
  const source = { width: 720, height: 1280 }
  const frame = { width: 1920, height: 1080 }
  const place = (mode: 'width' | 'height' | 'contain', offset?: { x: number; y: number }) => fitPlacement({ source, frame, fit: { mode, offset: offset ?? DEFAULT_FIT_OFFSET } })

  check('fitting the width pins it to the frame\u2019s', fittedSize(source, frame, 'width'), { width: 1920, height: 3414 })
  check('fitting the height pins that one instead', fittedSize(source, frame, 'height'), { width: 608, height: 1080 })
  check('and the default keeps the whole clip inside the frame', fittedSize(source, frame, 'contain'), { width: 608, height: 1080 })
  check('a square clip in a square frame fits it exactly', fittedSize({ width: 900, height: 900 }, { width: 1080, height: 1080 }, 'contain'), { width: 1080, height: 1080 })

  // At 0, 0 the picture is where it has always been: the axis a fit pins is the frame's, what overflows
  // it is centred, and what falls short is centred in the space it leaves. That is the whole promise of
  // the position being a displacement from the middle rather than from an edge.
  check('the fitted width overflows the height, centred on it', place('width')!.at, { x: 0, y: -1166 })
  // Centred to within the even pixel the position is rounded to: 3414 over a frame 1080 tall leaves
  // 2334 of slack, whose half is 1167 — odd. A picture a pixel off dead centre is the price of an even
  // position, and it is one that no viewer pays any attention to.
  near('which is the middle of what is over', place('width')!.size.height + place('width')!.at.y * 2, frame.height, 2)
  check('the fitted height sits centred across the frame', place('height')!.at, { x: 656, y: 0 })
  check('and so does a clip with no fit of its own', place('contain')!.at, { x: 656, y: 0 })

  // The position moves it, in the frame's own fractions, in both directions and on both axes.
  check('a quarter of the frame to the right is a quarter of it', place('contain', { x: 0.25, y: 0 })!.at.x - place('contain')!.at.x, 480)
  check('and downwards likewise', place('width', { x: 0, y: 0.25 })!.at.y - place('width')!.at.y, 270)
  check('a negative position moves it the other way', place('contain', { x: -0.25, y: 0 })!.at.x - place('contain')!.at.x, -480)
  // Nothing is clamped: a picture may be pushed clear of the canvas, which is what a position past an
  // edge is, and the background shows where it no longer reaches.
  check('a position clear of the frame is allowed', place('contain', { x: 1, y: 0 })!.at.x, 2576)

  // The chain: scale by both figures, place it on the canvas, then square the samples. Nothing in it
  // can stretch the picture, whichever way the clip is fitted or wherever it is put.
  check('a fitted width scales, then crops to the frame', fitFilters({ source, frame, fit: { mode: 'width', offset: DEFAULT_FIT_OFFSET } }), ['scale=1920:3414', 'crop=1920:1080:0:1166', 'setsar=1'])
  check('a fitted height scales, then pads', fitFilters({ source, frame, fit: { mode: 'height', offset: DEFAULT_FIT_OFFSET } }), ['scale=608:1080', 'pad=1920:1080:656:0:color=black', 'setsar=1'])
  check('the default is the same arithmetic with the shortfall filled in', fitFilters({ source, frame }), ['scale=608:1080', 'pad=1920:1080:656:0:color=black', 'setsar=1'])
  check('a clip already the shape of the frame is only scaled', fitFilters({ source: { width: 1080, height: 1920 }, frame: { width: 1080, height: 1920 } }), ['scale=1080:1920', 'setsar=1'])
  check('a frame with no size has no chain', fitFilters({ source, frame: { width: 0, height: 0 } }), null)
  check('and neither has a clip with no size', fitFilters({ source: { width: 0, height: 0 }, frame }), null)
  // Moved but still inside the canvas: the pad carries the position, and the picture is cropped out of
  // nowhere, so there is one fewer filter on it than on the overflow case.
  check('a picture moved inside the canvas is placed, not cropped', fitFilters({ source, frame, fit: { mode: 'contain', offset: { x: 0.2, y: 0 } } }), ['scale=608:1080', 'pad=1920:1080:1040:0:color=black', 'setsar=1'])
  // Moved past an edge: what is on the canvas is cropped out of the picture and padded into place, and
  // the side it moved away from is background. Half a frame to the left of centred puts the picture's
  // own left 304 pixels beyond the canvas, so what survives is its right 304 at the canvas's edge.
  check('a picture moved over an edge is cropped to what is on the canvas', fitFilters({ source, frame, fit: { mode: 'contain', offset: { x: -0.5, y: 0 } } }), ['scale=608:1080', 'crop=304:1080:304:0', 'pad=1920:1080:0:0:color=black', 'setsar=1'])
  // `pad` refuses an output smaller than its input and SILENTLY CENTRES on a negative offset, so the
  // picture's sliver is cropped out and painted over before the canvas is padded: the result is pure
  // background rather than the two-pixel smudge `pad` would otherwise leave in the middle.
  check('a picture pushed clear of the canvas is background and nothing else', fitFilters({ source, frame, fit: { mode: 'contain', offset: { x: 1, y: 0 } } }), ['scale=608:1080', 'crop=2:2:0:0', 'drawbox=x=0:y=0:w=2:h=2:color=black:t=fill', 'pad=1920:1080:0:0:color=black', 'setsar=1'])

  // The INSETS. A margin is neither a crop nor a position: it decides how much of the OUTPUT the clip
  // is not given, so the fit scales the clip into the box the margins leave and centres it THERE, and
  // the offset then slides the picture in frame space as it always did. The two compose in that order.
  // With no margins the box IS the frame, which is why nothing above needed to know about any of this.
  const inset = (l: number, t: number, r: number, b: number) => fitPlacement({ source, frame, fit: { mode: 'contain', offset: DEFAULT_FIT_OFFSET, insets: { l, t, r, b } } })!
  check('no margins is the whole frame', innerBox(frame, undefined), { x: 0, y: 0, width: 1920, height: 1080 })
  check('and leaves the picture exactly where it was', inset(0, 0, 0, 0).at, place('contain')!.at)
  check('all four zero is the same as none at all', hasInsets({ l: 0, t: 0, r: 0, b: 0 }), false)
  // A tenth in from every side leaves four fifths of the frame, starting a tenth in.
  check('a margin shrinks the box the fit works in', innerBox(frame, { l: 0.1, t: 0.1, r: 0.1, b: 0.1 }), { x: 192, y: 108, width: 1536, height: 864 })
  // Four fifths of a 16:9 frame is still 16:9, so the picture is scaled down to fill it: 864 tall, and
  // as wide as its own shape allows. It is INSIDE the frame now, which is what "scaled down" means.
  check('so the clip is scaled down into it', inset(0.1, 0.1, 0.1, 0.1).size, { width: 486, height: 864 })
  check('and sits inside the frame rather than at its edge', inset(0.1, 0.1, 0.1, 0.1).at, { x: 718, y: 108 })
  // The margins of one axis only move the picture along that axis, and by half of what they took: the
  // box's left edge is the margin in, and the picture is centred in what is left of the box.
  check('a margin on one side pushes the box, and the picture with it', innerBox(frame, { l: 0.25, t: 0, r: 0, b: 0 }), { x: 480, y: 0, width: 1440, height: 1080 })
  check('which is where the picture is centred', inset(0.25, 0, 0, 0).at, { x: 896, y: 0 })
  // A FILL fit fills the BOX rather than the frame: the same fill semantics, in a smaller box, which is
  // the whole of what an inset does to a fit.
  check('a fill fit fills the box instead of the frame', fitPlacement({ source, frame, fit: { mode: 'width', offset: DEFAULT_FIT_OFFSET, insets: { l: 0.1, t: 0.1, r: 0.1, b: 0.1 } } })!.size.width, 1536)
  check('and the box is what it overflows', fitPlacement({ source, frame, fit: { mode: 'width', offset: DEFAULT_FIT_OFFSET, insets: { l: 0.1, t: 0.1, r: 0.1, b: 0.1 } } })!.size.height > 864, true)
  // The chain needs nothing added for a margin: the placement put the picture inside the box, so the pad
  // that fills a letterbox fills the margins with it, and the background is one job rather than two.
  check('the margins are filled by the same pad as any other shortfall', fitFilters({ source, frame, fit: { mode: 'contain', offset: DEFAULT_FIT_OFFSET, insets: { l: 0.25, t: 0, r: 0, b: 0 } } }), ['scale=608:1080', 'pad=1920:1080:896:0:color=black', 'setsar=1'])
  check('and zero margins are the chain it always was', fitFilters({ source, frame, fit: { mode: 'contain', offset: DEFAULT_FIT_OFFSET, insets: { l: 0, t: 0, r: 0, b: 0 } } }), fitFilters({ source, frame, fit: { mode: 'contain', offset: DEFAULT_FIT_OFFSET } }))

  // The clamp. Each axis is capped on what its two edges take TOGETHER, by the crop's own rule, so the
  // box cannot be squeezed to nothing — while one edge reaching in hard on its own is allowed, which is
  // the distinction that rule exists to keep.
  check('margins that would leave nothing keep a tenth of the frame', innerBox(frame, { l: 0.9, t: 0, r: 0.9, b: 0 }), { x: 864, y: 0, width: 192, height: 1080 })
  check('and the two edges share the overshoot', normaliseInsets({ l: 0.6, t: 0, r: 0.6, b: 0 }), { l: 0.45, t: 0, r: 0.45, b: 0 })
  check('while one edge on its own may reach in as far as it likes', innerBox(frame, { l: 0.6, t: 0, r: 0, b: 0 }), { x: 1152, y: 0, width: 768, height: 1080 })
  check('a nonsense margin is no margin', normaliseInsets({ l: Number.NaN, t: -1, r: 0, b: 5 }), { l: 0, t: 0, r: 0, b: 0.9 })

  // The cache key: everything that changes the picture — the mode, both figures of the position, the
  // two boxes and the crop — with the position quantised so a dragger still moving does not ask for a
  // new set of thumbnails at every pixel of the drag.
  const sig = (mode: 'width' | 'height' | 'contain', x: number, y: number) => fitSignature({ source, frame, fit: { mode, offset: { x, y } } })
  check('a signature names the fit, the position, both boxes, the crop and the margins', sig('width', 0, 0), 'width@0.000,0.000@720x1280>1920x1080|full|i0.000,0.000,0.000,0.000')
  check('a hair of movement is not a different picture', sig('width', 0, 0.0004) === sig('width', 0, 0), true)
  check('a real move is', sig('width', 0, 0.01) === sig('width', 0, 0), false)
  check('each axis counts', sig('width', 0.01, 0) === sig('width', 0, 0.01), false)
  check('the scale is a different picture at the same position', sig('height', 0, 0) === sig('width', 0, 0), false)
  check('and the default says so rather than naming a fit', fitSignature({ source, frame }), 'contain@1920x1080|full|i0.000,0.000,0.000,0.000')

  // The OLD record: a single number, a place along the one axis a fit left over, counted in the slack
  // that axis had. It converts exactly, because the picture's old position and the centred position are
  // both known sums — and where the old fit left no slack the number did nothing at all, so it reads as
  // centred, which is what it looked like on screen.
  const legacy = (mode: 'width' | 'height' | 'contain', offset: number) => ({ mode, offset } as unknown as SourceFit)
  check('the old centre is the new centre', fitOffsetFor(legacy('width', 0.5), source, frame), { x: 0, y: 0 })
  near('the old start is the top of the picture', fitOffsetFor(legacy('width', 0), source, frame).y, 1167 / 1080, 1e-9)
  near('and the old end is the bottom of it', fitOffsetFor(legacy('width', 1), source, frame).y, -1167 / 1080, 1e-9)
  check('and the conversion puts the picture back where it was', (() => {
    const converted = fitPlacement({ source, frame, fit: legacy('width', 0) })!
    // The old model's own arithmetic: the frame kept a 1080-tall window 0 pixels into the picture.
    return converted.at.y
  })(), 0)
  check('an offset on an axis with no slack did nothing, so it converts to nothing', fitOffsetFor(legacy('height', 0.2), source, frame), { x: 0, y: 0 })
  check('and there is nothing to convert without a fit', fitOffsetFor(undefined, source, frame), { x: 0, y: 0 })
  // What a record SAYS, for the callers that overwrite it: a pair as it stands, the old number centred.
  check('a pair is read as it stands', storedFitOffset({ mode: 'contain', offset: { x: 0.1, y: -0.2 } }), { x: 0.1, y: -0.2 })
  check('and the old number as centred', storedFitOffset(legacy('width', 0)), { x: 0, y: 0 })
  check('a nonsense pair is centred', storedFitOffset({ mode: 'width', offset: { x: Number.NaN, y: 2 } as never }), { x: 0, y: 2 })

  // A fit is carried by the clip that owns it, exactly as a trim is.
  const fitted = { sourceFit: { 'a.mp4#1': { mode: 'width' as const, offset: { x: 0.1, y: 0 } }, 'b.mp4': { mode: 'height' as const, offset: { x: 0, y: 0 } } } } as unknown as QueueTask
  check('a fit is read by the clip that owns it', sourceFitFor(fitted, 'a.mp4', 1), { mode: 'width', offset: { x: 0.1, y: 0 } })
  check('and not by another occurrence of the same file', sourceFitFor(fitted, 'a.mp4', 0), undefined)
  check('a bare path still answers, as a bare trim does', sourceFitFor(fitted, 'b.mp4', 3), { mode: 'height', offset: { x: 0, y: 0 } })
  check('a clip with no fit has none', sourceFitFor(fitted, 'c.mp4', 0), undefined)
  check('and a reorder carries each fit with its clip', rekeyClipMap({ 'a.mp4#0': { mode: 'width' as const, offset: { x: 0.1, y: 0 } }, 'b.mp4#1': { mode: 'height' as const, offset: { x: 0, y: 0 } } }, ['a.mp4', 'b.mp4', 'c.mp4'], ['c.mp4', 'a.mp4', 'b.mp4']), { 'a.mp4#1': { mode: 'width', offset: { x: 0.1, y: 0 } }, 'b.mp4#2': { mode: 'height', offset: { x: 0, y: 0 } } })
  check('a fit set by path alone lands on that clip wherever it moves', rekeyClipMap(fitted.sourceFit, ['a.mp4', 'b.mp4'], ['b.mp4', 'a.mp4']), { 'b.mp4#0': { mode: 'height', offset: { x: 0, y: 0 } }, 'a.mp4#1': { mode: 'width', offset: { x: 0.1, y: 0 } } })
}

console.log('\n== a fit on a job whose clips are not joined ==')
{
  // Where clips are concatenated every one is normalized through its own chain, so a fit is a fit
  // there by construction. Where they are not — one visual with its tracks beside it — the fit is
  // folded into the job's own command instead, and this is the rule that says whether there is a
  // command for it to be folded into. The editor asks the same question when it offers the item.
  const job = (preset: Partial<EncodingPreset>) => ({
    type: 'transcode',
    sourcePaths: ['a.mp4'],
    sourceFit: { 'a.mp4#0': { mode: 'width', offset: { x: 0, y: 0 } } },
    preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p', ...preset },
  }) as unknown as QueueTask
  check('a fit on a muxed visual is the encoder business', usesClipFraming(job({}), 'a.mp4', 0), true)
  check('but not on an audio-only job, which has no picture', usesClipFraming(job({ outputMode: 'audio' }), 'a.mp4', 0), false)
  check('nor on a stream copy, which has nothing to scale', usesClipFraming(job({ videoCodec: 'copy' }), 'a.mp4', 0), false)
  check('nor on a GIF, whose chain is built by filter_complex', usesClipFraming(job({ container: 'gif' }), 'a.mp4', 0), false)
  check('and a clip with no fit has nothing to fold in', usesClipFraming(job({}), 'b.mp4', 0), false)
  check('the editor asks the same question of the preset alone', [canApplyClipFit(job({}).preset), canApplyClipFit(job({ outputMode: 'audio' }).preset), canApplyClipFit(job({ videoCodec: 'copy' }).preset), canApplyClipFit(job({ container: 'gif' }).preset)], [true, false, false, false])
}

console.log('\n== the timeline metric ==')
{
  // A lane's width is the zoom's business and nobody else's. There is no viewport anywhere in these
  // figures, which is what makes a window resize change only how much of the timeline is on screen:
  // the same duration at the same zoom is the same width, however wide the panel happens to be.
  check('the rate is the zoom alone', [pxPerSec(1), pxPerSec(2), pxPerSec(0.5)], [BASE_PX_PER_SECOND, BASE_PX_PER_SECOND * 2, BASE_PX_PER_SECOND / 2])
  check('a nonsense zoom is 1x', pxPerSec(Number.NaN), BASE_PX_PER_SECOND)
  check('a lane is its own length at that rate', [laneWidthFor(4, 1), laneWidthFor(600, 1)], [96, 14400])
  check('a trim shortens it', laneWidthFor(3.5, 2) < laneWidthFor(4, 2), true)
  check('and a nonsense length is nothing', [laneWidthFor(Number.NaN, 1), laneWidthFor(-5, 1)], [0, 0])
  check('doubling the zoom doubles the drawing', laneWidthFor(600, 2), 28800)
  check('a point in the lane area is read against the rate', [secondsAt(96, 1), secondsAt(48, 2)], [4, 1])
  check('and a point before the lanes is the start', secondsAt(-40, 1), -40 / BASE_PX_PER_SECOND)

  // FIT is the one place the viewport is consulted, and it is a decision rather than a state: the
  // zoom it sets is a zoom like any other, so the next resize reveals more of the timeline instead
  // of re-deciding what the zoom should be.
  // The headroom is the marker's own: without it the fit filled the lane area to its last pixel and
  // the trailing [+] hung outside it, clipped, with a scrollbar to reach it.
  near('fit fills the lane area less the room the last cut\u2019s marker needs', laneWidthFor(30, fitZoom(30, 900)), 900 - FIT_TRAILING_MARKER)
  check('a longer output fits the same area at a smaller zoom', fitZoom(60, 900) < fitZoom(30, 900), true)
  check('a fit is held inside the zoom range', [clampZoom(fitZoom(1, 100000)), clampZoom(fitZoom(100000, 100))], [ZOOM_MAX, ZOOM_MIN])
  check('and a fit of nothing is 1x', [fitZoom(0, 900), fitZoom(30, 0), clampZoom(Number.NaN)], [1, 1, 1])
}

console.log('\n== the per-clip crop ==')
{
  // The crop and the fit are two stages, and the order between them is the whole design: the crop
  // picks WHAT of the clip is kept, in the source's own space, and the fit decides HOW that sits in
  // the frame. A crop stored against the source is also what makes it survive a change of output
  // size or shape, since nothing in it refers to the frame at all.
  const source = { width: 720, height: 1280 }
  const frame = { width: 1920, height: 1080 }
  const middleBand = { left: 0, top: 426 / 1280, right: 0, bottom: 426 / 1280 }
  const round6 = (value: number) => Math.round(value * 1e6) / 1e6
  const region = cropRegion(middleBand)
  check('a crop is a region of the source', [region.x, region.y, region.w, round6(region.h)], [0, 0.3328125, 1, 0.334375])
  check('no crop is the whole source', cropRegion(undefined), { x: 0, y: 0, w: 1, h: 1 })
  check('and a region goes back to the four edges the controls show', sourceCropOf(middleBand), { x: 0, y: 0.332813, w: 1, h: 0.334375 })
  check('the kept region is whole pixels of the source', croppedSize(source, middleBand), { width: 720, height: 428 })
  check('an uncropped clip is the source', croppedSize(source, undefined), source)
  check('a nonsense source is nothing rather than a guess', croppedSize({ width: 0, height: 0 }, middleBand), { width: 0, height: 0 })

  // The chain: the crop first, at the pixels the region stands for, and then the fit worked out from
  // what was kept rather than from the source it came out of.
  const chain = clipFilters({ source, frame, crop: middleBand, fit: { mode: 'width', offset: { x: 0, y: 0 } } })
  check('the crop comes first in the chain', chain?.slice(0, 2), ['crop=720:428:0:426', 'scale=1920:1142'])
  check('an uncropped clip is only placed', clipFilters({ source: { width: 1920, height: 1080 }, frame, fit: { mode: 'width', offset: { x: 0, y: 0 } } }), ['scale=1920:1080', 'setsar=1'])
  check('a crop with no fit is placed the default way', clipFilters({ source, frame, crop: middleBand }), ['crop=720:428:0:426', 'scale=1816:1080', 'pad=1920:1080:52:0:color=black', 'setsar=1'])
  check('and a clip with neither is the whole picture in the frame', clipFilters({ source: { width: 608, height: 1080 }, frame }), ['scale=608:1080', 'pad=1920:1080:656:0:color=black', 'setsar=1'])

  // The signature carries the crop, quantised, because it is part of what a thumbnail looks like: a
  // crop dragged a tenth of a per cent does not need the strip again, a real one does.
  const sig = (crop: Parameters<typeof fitSignature>[0]['crop']) => fitSignature({ source, frame, crop })
  check('a signature carries the crop', sig(middleBand).endsWith('|0.000,0.333,0.000,0.333|i0.000,0.000,0.000,0.000'), true)
  check('a different crop is a different picture', sig(middleBand) === sig({ left: 0.1, top: 0, right: 0, bottom: 0 }), false)
  check('and no crop says so', sig(undefined).endsWith('|full|i0.000,0.000,0.000,0.000'), true)

  // What the monitor draws. A crop is a box over a picture rather than a smaller picture, so the
  // whole source is drawn AROUND the kept region: the region lands exactly where the fit put it,
  // and the part the crop removes lies the same distance beyond it that the crop cut off — still
  // on screen, which is what lets the box be dragged back over it.
  const placed = placedSource({ source, frame, crop: middleBand })
  const plain = placedSource({ source, frame })
  check('a clip with no crop is drawn exactly as the fit places it everywhere else',
    plain && [plain.source.width, plain.source.height, plain.source.x, plain.source.y],
    plain && [plain.placement.size.width, plain.placement.size.height, plain.placement.at.x, plain.placement.at.y])
  check('a nonsense source has nowhere to be drawn', placedSource({ source: { width: 0, height: 0 }, frame }), null)
  if (placed) {
    // The kept region's own box, in frame pixels, read back off the whole source's box.
    near('the kept region is as tall as the fit made it', placed.source.height * region.h, placed.placement.size.height, 1)
    near('and sits where the fit put it', placed.source.y + region.y * placed.source.height, placed.placement.at.y, 1)
    check('with the rest of the picture drawn around it', placed.source.height > frame.height, true)
    check('and as wide as the fit made it too', Math.abs(placed.source.width * region.w - placed.placement.size.width) < 1, true)
    // The two scales differ only by the fit's own rounding to an even pair, which is a sub-pixel of
    // the source: the drawing never stretches a picture by anything a viewer could see.
    check('with the two axes scaled to within a fraction of a pixel of each other', Math.abs(placed.source.width / source.width - placed.source.height / source.height) < 0.002, true)
  }
}

console.log('\n== taking a source out of a job ==')
{
  // Everything keyed by a clip's PLACE has to move with the clips that survive, so the records are
  // rebuilt from the surviving entries rather than filtered: a filter would leave "a.mp4#2" naming
  // the clip that is now the third one's predecessor.
  const job = (over: Partial<QueueTask> = {}) => ({
    id: 'j', type: 'stitch', sourcePaths: ['a.mp4', 'b.mp4', 'c.mp4'], outputDirectory: '/o', outputFilename: 'o.mp4',
    preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    status: 'pending', progress: 0,
    trimPoints: { 'a.mp4#0': { in: 1, out: 2 }, 'c.mp4#2': { in: 3, out: 4 } },
    transitions: { 'a.mp4#0': { type: 'fade', duration: 0.5 } },
    sourceFit: { 'c.mp4#2': { mode: 'width', offset: 0.5 } },
    sourceCrop: { 'b.mp4#1': { x: 0, y: 0, w: 1, h: 1 } },
    ...over,
  }) as QueueTask

  const droppedFirst = removeSourceFromTask(job(), 'a.mp4', 0)
  check('the trim on a surviving clip is re-keyed to its new place', droppedFirst?.trimPoints, { 'c.mp4#1': { in: 3, out: 4 } })
  check('and so is its fit', droppedFirst?.sourceFit, { 'c.mp4#1': { mode: 'width', offset: 0.5 } })
  check('and its crop', droppedFirst?.sourceCrop, { 'b.mp4#0': { x: 0, y: 0, w: 1, h: 1 } })
  // The clip that went takes its own records with it — there is nothing left for them to be about.
  check('the records of the clip that went go with it', droppedFirst?.transitions, undefined)
  const droppedLast = removeSourceFromTask(job(), 'c.mp4', 2)
  check('a transition survives on the clip it was made at', droppedLast?.transitions, { 'a.mp4#0': { type: 'fade', duration: 0.5 } })
  check('while the last clip\u2019s fit goes with the last clip', droppedLast?.sourceFit, undefined)

  // Two entries for the same file: an index names the one, a path alone would take both.
  const twice = job({ sourcePaths: ['a.mp4', 'a.mp4'] })
  check('an index takes out that occurrence only', removeSourceFromTask(twice, 'a.mp4', 1)?.sourcePaths, ['a.mp4'])
  check('a path alone takes out every occurrence', removeSourceFromTask(twice, 'a.mp4')?.sourcePaths, undefined)

  // A job left with tracks but no picture plays those tracks rather than carrying them beside nothing.
  const withTracks = job({ sourcePaths: ['a.mp4'], additionalAudioTracks: [{ id: 't', path: 'score.wav', language: 'und' }] })
  const promoted = removeSourceFromTask(withTracks, 'a.mp4', 0)
  check('tracks become the sources when the last picture goes', [promoted?.sourcePaths, promoted?.additionalAudioTracks], [['score.wav'], undefined])
  check('and the job reads as what is left', promoted?.type, 'transcode')
  check('a track going leaves the picture where it was', removeSourceFromTask(withTracks, 'score.wav', 0)?.additionalAudioTracks, undefined)

  // Removing what the job has nothing else of cannot happen, and must not look as though it had.
  check('the last source of a job takes the job with it', removeSourceFromTask(job({ sourcePaths: ['a.mp4'] }), 'a.mp4', 0), null)
  check('but not when there is a track to carry on with', removeSourceFromTask(withTracks, 'a.mp4', 0)! !== null, true)

  // The mode is a consequence of what is left, not a field that is carried over.
  check('one picture and one track is a multi-track job', inferredMode(['a.mp4'], [{ path: 's.wav' }]), 'multitrack')
  check('two pictures and a track is a combo', inferredMode(['a.mp4', 'b.mp4'], [{ path: 's.wav' }]), 'combo')
  check('tracks alone are joined if there are two of them', [inferredMode(['s.wav']), inferredMode(['s.wav', 't.wav'])], ['transcode', 'stitch'])
}

console.log('\n== where a sequence picture is without asking ==')
{
  // The editor reads a built clip's whereabouts off the task rather than waiting for a round trip to
  // confirm it exists, which is what stops the monitor saying PREPARING on every open of a job whose
  // clips are all built. The key carries the rate, so a clip built at another rate is not this
  // source's clip — it is a different length from the one the timeline expects.
  const frame = '/seq/f_0001.png'
  const spec = (rate: number) => previewKey(frame, `seq:${rate}:240`)
  const task = {
    id: 's', type: 'stitch', sourcePaths: [frame], outputDirectory: '/out', outputFilename: 'o.mov',
    preset: { id: 'p', name: 'P', container: 'mov', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    status: 'pending', progress: 0,
    sequenceInputs: { [frame]: { dir: '/seq', pattern: 'f_%04d.png', globPattern: '*', startNumber: 1, frameCount: 240, hasGaps: false, missing: [], fps: 24, firstFrame: frame } },
    imageSequencePreviews: { [spec(24)]: '/tmp/seq-24fps.mp4', [spec(30)]: '/tmp/seq-30fps.mp4' },
  } as unknown as QueueTask
  check('a clip built at the rate in hand is found', rememberedPreviewFor(task, frame, 24), '/tmp/seq-24fps.mp4')
  check('and the one built at another rate is not mistaken for it', rememberedPreviewFor(task, frame, 30), '/tmp/seq-30fps.mp4')
  check('a rate with no clip built at it has none', rememberedPreviewFor(task, frame, 25), undefined)
  check('a source that is not a sequence has no generated clip', rememberedPreviewFor(task, '/other.mp4', 24), undefined)
  check('and neither has nothing at all', rememberedPreviewFor(task, undefined, 24), undefined)
  // The key the queue writes one under is the key the editor looks one up by. They were spelled
  // separately and disagreed, which was invisible: the clip was on disk and the editor simply never
  // found it, so it rebuilt the whole sequence on every open.
  check('the queue and the editor spell a sequence key the same way', sequencePreviewKey(frame, 24, 240), spec(24))
  const filed = {
    id: 'q', type: 'stitch', status: 'pending', progress: 0, sourcePaths: [frame],
    outputDirectory: '/out', outputFilename: 'o.mov',
    preset: { id: 'p', name: 'P', container: 'mov', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    sequenceInputs: { [frame]: { dir: '/seq', pattern: 'f_%04d.png', globPattern: '*', startNumber: 1, frameCount: 240, hasGaps: false, missing: [], fps: 24, firstFrame: frame } },
    imageSequencePreviews: { [sequencePreviewKey(frame, 24, 240)]: '/tmp/seq-24fps.mp4' },
  } as unknown as QueueTask
  check('so a clip the queue filed is the one the editor finds', rememberedPreviewFor(filed, frame, 24), '/tmp/seq-24fps.mp4')
}
console.log('\n== where a right-click menu goes ==')
{
  const viewport = { width: 1000, height: 700 }
  const size = { width: 200, height: 240 }
  const at = (x: number, y: number) => placeMenu({ point: { x, y }, size, viewport })
  // The pointer's own point is the preference, and it is kept whenever the menu fits there.
  check('a menu that fits opens where it was asked for', at(300, 100), { x: 300, y: 100 })
  check('and one that just fits at the bottom does too', at(300, 700 - 240 - 8), { x: 300, y: 452 })
  // Past that it flips above the pointer, so the menu is read and the clip under it stays visible.
  check('past the bottom edge it opens upward instead', at(300, 600), { x: 300, y: 360 })
  // The threshold itself: one pixel more room and it stays below, one less and it flips.
  check('the last point with room below keeps the pointer', at(300, 452), { x: 300, y: 452 })
  check('and the next one flips', at(300, 453), { x: 300, y: 213 })
  // A menu taller than the window can fit neither way, and the top of it is the part worth having.
  const tall = placeMenu({ point: { x: 300, y: 600 }, size: { width: 200, height: 900 }, viewport })
  check('a menu taller than the window is pinned to its top margin', tall.y, 8)
  check('a menu wider than the window likewise', placeMenu({ point: { x: 900, y: 100 }, size: { width: 1200, height: 100 }, viewport }).x, 8)
  // Sideways: the same flip, so a click near the right edge does not push the menu off it.
  check('a menu that would overhang the right edge opens leftward', at(950, 100), { x: 750, y: 100 })
  check('and one near the left edge stays put', at(8, 100), { x: 8, y: 100 })
}

console.log('\n== undo and redo ==')
{
  // A draft and the changes a control makes to it. The records are the interesting part: every caller
  // builds them anew whether or not it is changing anything, so identity says nothing about them.
  const draft = { fps: 30, mutedLanes: { main: true } }
  check('a record of the same content is the same value', sameField({ main: true }, { main: true }), true)
  check('and a different content is not', sameField({ main: true }, { main: false }), false)
  check('a figure follows identity', [sameField(30, 30), sameField(30, 25)], [true, false])
  check('and nothing is not zero', sameField(undefined, 0), false)

  // A change that changes nothing is not a step: a crop dragged against an edge it is already at, or
  // a mute switched on twice, would otherwise leave a stack of identical states behind.
  check('writing the same figure again is not a change', recordChange(emptyHistory<typeof draft>(), draft, { fps: 30 }), null)
  check('nor is writing the same record again', recordChange(emptyHistory<typeof draft>(), draft, { mutedLanes: { main: true } }), null)
  const recorded = recordChange(emptyHistory<typeof draft>(), draft, { fps: 25 })
  check('a real change remembers what was there', recorded?.past, [draft])
  check('and starts no branch ahead of it', recorded?.future, [])

  // Stepping: back and forward again lands where it started, and neither end runs away.
  const first = { past: [draft], future: [] }
  const undone = stepHistory(first, { fps: 25, mutedLanes: { main: true } }, 'undo')
  check('undo shows what was there', undone?.state, draft)
  check('and keeps what it came from for a redo', undone?.history.future, [{ fps: 25, mutedLanes: { main: true } }])
  const redone = stepHistory(undone!.history, undone!.state, 'redo')
  check('redo shows it again', redone?.state, { fps: 25, mutedLanes: { main: true } })
  check('and the stack is back as it was', redone?.history, first)
  check('nothing to undo at the start', stepHistory(emptyHistory<typeof draft>(), draft, 'undo'), null)
  check('and nothing to redo at the end', stepHistory(first, draft, 'redo'), null)

  // The cap. It is a limit on how far back a window can step, not a count of edits made.
  let deep = emptyHistory<{ step: number }>()
  for (let index = 0; index < HISTORY_LIMIT + 10; index++) {
    const before = { step: index }
    deep = recordChange(deep, before, { step: index + 1 }) as typeof deep
  }
  check('the history stops growing at its limit', deep.past.length, HISTORY_LIMIT)
  check('and the oldest states are the ones let go', deep.past[0], { step: 10 })
}
console.log('\n== the waveform ==')
{
  // The helper's rules, which the timeline borrows: root mean square per bucket, normalised against
  // the loudest bucket in the file, drawn as bars either side of the centre. The real decode is
  // checked against a real audio file by `npm run verify-wave`; this is the arithmetic around it.
  const silence = peaksFromSamples(new Float32Array(8000), 4)
  const tone = new Float32Array(8000)
  for (let index = 0; index < 4000; index++) tone[index] = 0.5
  const halves = peaksFromSamples(tone, 4)
  check('a file is read into the buckets asked for', silence.length, 4)
  check('silence is flat', silence, [0, 0, 0, 0])
  check('a loud half is loud and a silent half flat', [halves[0] > 0.9, halves[3]], [true, 0])
  check('and the loudest bucket is the file own scale', Math.max(...halves), 1)
  check('nothing at all is read as flat', peaksFromSamples(new Float32Array(0), 3), [0, 0, 0])
  check('a louder file is not a different shape', normalisePeaks([2, 1, 0]).map((peak) => Math.round(peak * 100) / 100), [1, 0.5, 0])

  // A trim shows the part of the file it covers, which is what makes a trimmed clip's waveform agree
  // with the frames beside it.
  const wide = peaksFromSamples(tone, 100)
  check('a trim takes the part of the file it covers', [peaksForTrim(wide, 0, 0.5, 1).length, peaksForTrim(wide, 0.5, 1, 1).length], [50, 50])
  check('and reads the silence where the file is silent', peaksForTrim(wide, 0.5, 1, 1).every((peak) => peak === 0), true)
  check('a file with no known length is shown whole', peaksForTrim(wide, 0, 1, 0).length, 100)

  // The drawing: one path, bars on a stride, each straddling the centre line.
  const path = waveformPath({ peaks: [1, 0, 1, 0], width: 16, height: 32 })
  const bars = [...path.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)]
  check('one bar per stride of the clip', bars.length, 4)
  check('every bar is on the centre line', bars.every(([, , top, , bottom]) => Math.abs(32 - (Number(top) + Number(bottom))) < 1e-9), true)
  check('a silent bar is still a bar', bars[1][4], (32 / 2 + 1).toFixed(2))
  check('and a loud one reaches further', Number(bars[0][2]) < Number(bars[1][2]), true)
  check('the bar is as wide as the helper draws it', Number(bars[0][1]), WAVEFORM_BAR / 2)
  check('a clip with no width draws nothing', [waveformPath({ peaks: [1], width: 0, height: 32 }), waveformPath({ peaks: [], width: 40, height: 32 })], ['', ''])
  check('the reading is the helper own resolution', WAVEFORM_PEAKS, 2000)
  check('and no more bars than buckets', waveformPath({ peaks: Array.from({ length: 10 }, () => 1), width: 100000, height: 32 }).length < 600, true)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
