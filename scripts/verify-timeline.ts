import { advanceClock, elementOwnsPosition } from '../src/lib/playbackClock'
import { nextShuttleRate, nextForwardRung, FORWARD_ACCELERATE_RUNGS } from '../src/lib/shuttleRates'
import { SCRUB_RATE_MAX, SCRUB_RATE_MIN, SCRUB_RATE_SMOOTHING, scrubRateFor } from '../src/lib/scrubAudio'
import { withSourceTiming, sourceTimingOverrides } from '../src/lib/sourceTiming'
import { PREVIEW_FORMAT_VERSION, dropPreviewsFor, previewKey, rememberedPreviewFor, rememberedProxyFor, previewProxyKey, resolveQuickLookRequest, sequencePreviewKey, sourceOfPreview, sourceOfPreviewKey, stillPreviewKey } from '../src/lib/quickLookTarget'
import { webviewPlaysVideo } from '../src/lib/previewCodec'
import { progressPercent, timemarkSeconds } from '../src/lib/progress'
import { aspectSize, clampCrop, cropBands, cropFilter, cropFractions, cropForProportion, cropPixels, exactSizeFields, fitFrame, fitFrameBy, hasCrop, holdCropShape, insetCrop, keptAspect, outputFrameSize, resolutionBox, resolutionShortSide, resizeCorner, resizeExact, shiftCrop, MAX_CROP } from '../src/lib/outputFrame'
import { computeFilmstrip, frameKey, thumbnailSignature } from '../src/lib/filmstrip'
import { DEFAULT_FIT_OFFSET, clipFilters, cropRegion, croppedSize, fitFilters, fitOffsetFor, fitPlacement, fitSignature, fittedSize, hasInsets, innerBox, normaliseInsets, placedSource, sourceCropOf, storedFitOffset } from '../src/lib/sourceFit'
import { PREVIEW_ZOOM_STEPS, PreviewZoom, clampPan, clampPreviewZoom, isPresetZoom, panSlack, zoomFitMode, zoomedRaster } from '../src/lib/previewZoom'
import { scrollToKeepVisible, skimmerOffset } from '../src/lib/timelinePan'
import { BASE_PX_PER_SECOND, FIT_TRAILING_MARKER, RULER_STEPS, ZOOM_MAX, ZOOM_MIN, clampZoom, fitZoom, laneWidthFor, pxPerSec, rulerSteps, rulerTicks, secondsAt, zoomedBy } from '../src/lib/timelineScale'
import { HISTORY_LIMIT, emptyHistory, endGesture, recordChange, sameField, stepHistory } from '../src/lib/draftHistory'
import { outputCarriesPicture, outputKind, outputTakesArt } from '../src/lib/outputKind'
import { presetSummary } from '../src/lib/presetSummary'
import { DEFAULT_EQ_STYLE, DEFAULT_TUNE, DRAWING_MAX_EDGE, DRAWING_STILL_SETTLE_MS, DRAWING_THEMES, EQ_DEFAULT_BARS, EQ_DEFAULT_PEAK_DECAY, EQ_LABEL_FREQUENCIES, EQ_MAX_BARS, EQ_MAX_GAP, EQ_MAX_SENSITIVITY, EQ_MIN_BARS, EQ_MIN_BAR_PX, EQ_PEAK_DECAY_MAX, EQ_PILL_PEAK_DECAY, EQ_SEGMENT_GAP_MAX, MATRIX_DIM_SHARE, MONO_MIX, PROGRESS_LINE_CASE, SCROLLING_WAVEFORM_MAX_EDGE, SCOPE_DEFAULT_PERSIST, VISUALIZATIONS, VISUALIZATION_DEFAULTS, VISUALIZATION_PROGRESS_CASE_COLOR, VISUALIZATION_PROGRESS_COLOR, WAVE_DEFAULT_CHANNELS, barsGeometry, clampEqBars, clampEqGap, clampEqSensitivity, clampPeakDecay, clampSaturation, clampScopePersist, clampScopeZoom, clampSegmentGap, colourList, dimmedColour, drawingCanvas, drawingColorOf, drawingDefaultsFor, drawingPictureFor, drawingTuneOf, eqStyleOf, isBarsTemplate, isMirroredTemplate, isSpectrumTemplate, isWaveTemplate, progressLineWidth, scopeFade, scopeSide, scopeTint, scopeTintFilter, segmentHeight, stillWarmupSeconds, templateFor, templateMaxEdge, themeFor, visualizationBackgroundKind, visualizationGraph, visualizationProgressLine, visualizationStillGraph } from '../src/lib/visualization'
import { DEFAULT_PREVIEW_SPEED, PREVIEW_SPEEDS, clampPreviewSpeed, playbackRateFor, preservesPitchFor, steppedPreviewSpeed } from '../src/lib/previewSpeed'
import { MAX_CLIP_SPEED, MIN_CLIP_SPEED, atempoChain, clampClipSpeed, clipDurationFor, clipRetime, clipSpeedLabel, slavedAudioAt, sourceTimeAt, speedAudioFilters, speedFor, speedVideoFilters, timelineTimeAt, trimmedForDuration } from '../src/lib/clipSpeed'
import { DEFAULT_RATE, RATE_PRESETS, frameCount, frameFloor, makeRate, rateLabel, rateOf, rateRationalLabel, ratesEqual, rateValue, secondsForFrames } from '../src/lib/frameRate'
import { AUDIO_CHANNELS, audioChannelsFor, audioCodecFacts, audioDepthsFor, audioFacts, channelFacts, channelLayoutFor, clampAudioChannels, kilohertz, outputChannels, probeHasAudio, resolvedAudioChannels } from '../src/lib/audioFacts'
import { placeMenu } from '../src/lib/menuPlacement'
import { AUDIO_LAYOUTS, audioLayoutState, CLIPPING_GUARD_FILTER, containerHoldsStreams, resolvedAudioLayout, sumsAudioLanes } from '../src/lib/audioLayout'
import { videoCodecFacts } from '../src/lib/videoFacts'
import { WAVEFORM_BAR, WAVEFORM_PEAKS, normalisePeaks, peaksForTrim, peaksFromSamples, waveformPath } from '../src/lib/waveform'
import { buildTimeline, canApplyClipFit, canApplyClipSpeed, clipRangeLabel, clipRateFor, clipSummary, crossfadeAt, crossfadeAtTime, edgeFade, EMPTY_AUDIO_LANE_ID, firstVisualSource, jobExportsPicture, joinedTimeline, laneIsMuted, matchSourceSource, maxCrossfade, maxEdgeFade, maxFadeAtBoundary, nativeRateFor, nearestInsertPosition, nothingToTime, outputRangeLabel, resolveCrossfades, resolveFades, runsOnAnchoredClock, secondsFromTimecode, segmentTiming, sourceCropFor, sourceDuration, sourceFitFor, sourceFps, SourceTiming, STITCHED_AUDIO_LANE_ID, stampPair, stillSecondsFor, taskHasFootage, timecode, TimelineSegment, trackEdgeFade, trackEdgeFadeKey, tracksConcatenate, trimFor, usesClipFraming } from '../src/lib/timelineModel'
import { addedClipNumbers, clipIdAt, clipKey, clipNumberAt, copyLabelFor, matchClipIdsToPaths, materializeClipIds, materializeClipNumbers, moveAlong, moveClipIds, newClipId, newTrackId, trackKey } from '../src/lib/clipIds'
import { dragTrimWindow, trimWindowOf, windowIsWholeSource } from '../src/lib/clipTrim'
import { detectSequences } from '../src/lib/detectSequences'
import { clipRecordsFor } from '../src/lib/sourceRemoval'
import { clipAudioDropped, embeddedAudioCustomised, embeddedGainDb, embeddedStreamCount, enabledEmbeddedStreams, extractedBy, gainForDb } from '../src/lib/embeddedAudio'
import { EncodingPreset, MediaProbeInfo, MediaStreamInfo, QueueTask, SourceFit } from '../src/types'
import { inferredMode, removeSourceFromTask, withSourceList } from '../src/lib/sourceRemoval'
import { applyContainerChange, applyImageOutputChoice, defaultImageOutputChoiceValue, FRAME_CONTAINERS, imageOutputChoiceValue, imageOutputChoicesFor } from '../src/lib/containerSwitch'
import { applyCodecChoice, audioChoiceValue, audioChoicesFor, codecChoiceValue, codecChoicesFor, containerTakesAudio, containerTakesCodec, reconcileAudioToContainer, reconcileCodecToContainer } from '../src/lib/codecChoices'
import { bitsPerSecond, estimateLabel, estimateOutputSize, framesFrom, sizeLabel } from '../src/lib/outputSize'
import { pixelDepth, pixelDepthLabel, proresDepth, proresDepthLabel } from '../src/lib/pixelDepth'
import { mediaKind } from '../src/lib/mediaKind'
import { DEFAULT_BLANK_FILL, DEFAULT_PLACEHOLDER_SECONDS, PLACEHOLDER_SOURCE_SECONDS, filePathsOnly, makePlaceholderPath, normaliseFill, placeholderFill, withPlaceholderFill } from '../src/lib/placeholder'

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
  const clip = { key: 'clip', sourcePath: '/a.mp4', start: 0, duration: 10, sourceUsedSeconds: 10, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: false }
  const still = { key: 'still', sourcePath: '/a.png', start: 10, duration: 10, sourceUsedSeconds: 10, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: false, still: true }
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
  // L ACCELERATES through the speed the selector and the wheel own, so a step is the next rung ABOVE wherever
  // the transport already is — a wheeled 1.5x becomes 2x, a wheeled 3x becomes 4x, never a jump back to 1x.
  check('the accelerate rungs are the shuttle\u2019s own four', FORWARD_ACCELERATE_RUNGS.join(','), '1,2,4,8')
  check('from the ordinary speed the next rung is 2x', nextForwardRung(1), 2)
  check('and again, up to the top', [1, 2, 4].map(nextForwardRung), [2, 4, 8])
  check('the top rung is the top rather than a wrap', nextForwardRung(8), 8)
  check('a speed between rungs lands on the next one above it', [1.5, 3].map(nextForwardRung), [2, 4])
  check('and a slow speed climbs to the first rung', nextForwardRung(0.5), 1)
}

console.log('\n== how a scrub drives the sound ==')
{
  // The sound is driven by RATE that tracks the wheel, so a scrub is heard sped with the scroll. Velocity is in
  // timeline-seconds per wall-second, so 1 is the sound's own speed.
  check('a scrub at the sound’s own speed plays it at 1x', scrubRateFor(1, 1), 1)
  check('a flick of five seconds a second plays it at 5x, smoothed towards it', scrubRateFor(5, 1), 1 + (5 - 1) * SCRUB_RATE_SMOOTHING)
  check('and a reading the other way is the same magnitude, because an element cannot run backwards', scrubRateFor(-5, 1), scrubRateFor(5, 1))
  check('the rate is smoothed rather than snapped to the reading', scrubRateFor(5, 1) < 5, true)
  check('a very slow drag slows the sound to the floor rather than stopping it', scrubRateFor(0.05, 1), SCRUB_RATE_MIN)
  check('and a very fast flick is held below a scream', scrubRateFor(50, 1) <= SCRUB_RATE_MAX, true)
  check('a reading of nothing leaves the last rate in place', scrubRateFor(0, 2), 2)
  check('the floor is the floor', SCRUB_RATE_MIN, 0.5)
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

console.log('\n== what a lone sound file is named ==')
{
  // One sound file is a SOUND lane, whatever the export does with it. The lane's name follows what it
  // HOLDS; naming it VIDEO described the container rather than the clips and read as the sound having
  // landed on the wrong row. The export still supplies a black picture when the preset writes video, and
  // the job still answers `jobExportsPicture` truly, so the encoder and the model agree about the FILE.
  const job = (over: Partial<QueueTask> = {}) => ({
    id: 's', type: 'transcode', status: 'pending', progress: 0,
    sourcePaths: ['/track.wav'], outputDirectory: '/out', outputFilename: 'o.mp4',
    preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    ...over,
  }) as unknown as QueueTask
  const timing = { resolveTiming: () => ({ duration: 300 }) }

  const asVideo = job()
  const videoLane = buildTimeline(asVideo, timing).lanes[0]
  check('a sound file is named AUDIO 1 even asked for video', videoLane.label, 'AUDIO 1')
  check('while its export still carries a picture', jobExportsPicture(asVideo), true)
  check('and the lane still holds a sound', videoLane.kind, 'audio')

  const asSound = job({ preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source', outputMode: 'audio' } })
  check('asked for sound it is named AUDIO 1 too', buildTimeline(asSound, timing).lanes[0].label, 'AUDIO 1')
  check('and its export carries no picture', jobExportsPicture(asSound), false)

  const stitchOfSounds = job({ type: 'stitch', sourcePaths: ['/a.wav', '/b.wav'] })
  check('a stitch of sound files is named AUDIO 1', buildTimeline(stitchOfSounds, { resolveTiming: () => ({ duration: 5 }) }).lanes[0].label, 'AUDIO 1')
  // A container that cannot hold a picture at all is not a video job however the preset is set, so the
  // lane keeps its own name and nothing is supplied for it to hold.
  const intoWav = job({ preset: { id: 'p', name: 'P', container: 'wav', videoCodec: 'h264', audioCodec: 'pcm', resolution: 'source' } })
  check('a wav asked for video is named for its sound too', buildTimeline(intoWav, timing).lanes[0].label, 'AUDIO 1')
  check('and its export carries no picture', jobExportsPicture(intoWav), false)
  const pictureJob = job({ sourcePaths: ['/clip.mp4'] })
  check('and a picture job is named VIDEO as it always was', buildTimeline(pictureJob, { resolveTiming: () => ({ duration: 10 }) }).lanes[0].label, 'VIDEO')
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

console.log('\n== X-FADE: a cross-dissolve OVERLAPS, so the join is shorter ==')
{
  // A cross-dissolve is NOT the boundary fade: it OVERLAPS its two neighbours, so the join loses the overlap's
  // length rather than merely darkening the cut. This is the arithmetic the timeline, the duration readout and
  // the encoder have to agree on, proved on its own before any of the three is allowed to draw or write it.
  const durations = [4, 6, 10]
  near('a job of plain cuts runs the sum of its clips', joinedTimeline(durations, resolveCrossfades(durations, [0, 0, 0])).total, 20)
  check('one crossfade is applied whole when it fits', resolveCrossfades(durations, [2, 0, 0]), [2, 0, 0])
  near('and the join is shorter by its own length', joinedTimeline(durations, [2]).total, 18)
  // The clamp, mirroring `maxFadeAtBoundary`: never more than half the shorter neighbour.
  near('a crossfade is clamped to half the shorter neighbour', maxCrossfade(10, 2), 1)
  check('so a greedy request is reduced, not accepted', resolveCrossfades(durations, [100, 100, 0]), [2, 3, 0])
  near('and the total is the sum less the clamped overlaps', joinedTimeline(durations, resolveCrossfades(durations, [100, 100, 0])).total, 15)
  // TWO crossfades that share a clip cannot together use more than it: one takes its HEAD, the other its TAIL.
  check('two crossfades sharing a clip are clamped against it together', resolveCrossfades([10, 4, 10], [100, 100, 0]), [2, 2, 0])
  // Placement: each clip begins its overlap earlier than the one before it ended, which is the region they share.
  const placed = joinedTimeline([4, 6, 10], [2, 3, 0])
  check('each clip begins the overlap earlier than the last ended', placed.starts, [0, 2, 5])
  near('and the join ends on the total', placed.total, 15)
  check('the last clip has no boundary after it to overlap', resolveCrossfades([4, 6], [1, 5])[1], 0)
  // The reader: a boundary FADE is not a crossfade, a crossfade is, and an untouched boundary is a plain cut.
  const fadeTask = { transitions: { a: { type: 'fade', duration: 2 }, b: { type: 'crossfade', duration: 1.5 } } } as unknown as QueueTask
  near('a boundary FADE is not read as a crossfade', crossfadeAt(fadeTask, 'a'), 0)
  near('while a crossfade is', crossfadeAt(fadeTask, 'b'), 1.5)
  near('and a boundary with no transition is a plain cut', crossfadeAt(fadeTask, 'c'), 0)
}

console.log('\n== X-FADE on the TIMELINE: the clips OVERLAP where the encoder dissolves them ==')
{
  const job = (over: Partial<QueueTask> = {}) => ({
    id: 'x', type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: ['/a.mp4', '/b.mp4'], outputDirectory: '/out', outputFilename: 'o.mp4',
    preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    transitions: { '/a.mp4#0': { type: 'crossfade', duration: 2 } },
    ...over,
  }) as unknown as QueueTask
  const timing = { resolveTiming: () => ({ duration: 10 }) }
  const probes = { sourceHasPicture: { '/a.mp4': true, '/b.mp4': true }, sourceHasAudio: { '/a.mp4': true, '/b.mp4': true } }

  const crossed = buildTimeline(job(), { ...timing, ...probes })
  const lane = crossed.lanes[0]
  const [first, second] = lane.segments
  near('the lane is one overlap shorter than the sum', lane.duration, 18)
  near('and so is the job', crossed.duration, 18)
  near('the second clip BEGINS before the first ended', second.start, 8)
  near('which is exactly the overlap', first.start + first.duration - second.start, 2)
  near('the outgoing clip carries how far it dissolves out', first.crossfadeOut ?? 0, 2)
  near('and the incoming one how far it dissolves in', second.crossfadeIn ?? 0, 2)
  near('the first clip never dissolves in', first.crossfadeIn ?? 0, 0)
  near('and the last never dissolves out', second.crossfadeOut ?? 0, 0)

  // The encoder refuses a cross-dissolve whose neighbours do not BOTH carry a picture and a sound, and falls
  // back to plain cuts. The timeline must refuse it too, or it would draw an overlap the file never takes.
  const silent = buildTimeline(job(), { ...timing, sourceHasPicture: probes.sourceHasPicture, sourceHasAudio: { '/a.mp4': true, '/b.mp4': false } })
  near('a silent neighbour keeps the plain-cut join', silent.lanes[0].duration, 20)
  near('so the second clip is not pulled back', silent.lanes[0].segments[1].start, 10)
  near('and nothing is marked as dissolving', silent.lanes[0].segments[0].crossfadeOut ?? 0, 0)
  // A FADE is not a cross-dissolve and changes no length, so the stream test has nothing to say about it.
  near('while a boundary FADE is unaffected by the stream test', buildTimeline(job({ transitions: { '/a.mp4#0': { type: 'fade', duration: 2 } } }), { ...timing, ...probes }).lanes[0].duration, 20)

  // The MONITOR's own geometry, read from the placed lane: which clip is coming in, and how far across the
  // blend the playhead is. This is the figure the two pictures and their sound are blended by.
  near('the blend begins where the incoming clip begins', crossfadeAtTime(lane.segments, 8)?.t ?? -1, 0)
  near('its midpoint is halfway across', crossfadeAtTime(lane.segments, 9)?.t ?? -1, 0.5)
  check('and the clip it names is the INCOMING one', crossfadeAtTime(lane.segments, 9)?.incoming.key, '/b.mp4#1')
  near('approaching the outgoing clip\u2019s end it nears one', crossfadeAtTime(lane.segments, 9.9)?.t ?? -1, 0.95)
  check('before the blend the outgoing clip is shown alone', crossfadeAtTime(lane.segments, 7.9), null)
  check('and past it the incoming clip is the active one, not a blend', crossfadeAtTime(lane.segments, 10), null)
  // On the plain-cut lane the stream test forced, there is no blend anywhere.
  check('a lane with no overlap has no blend at all', crossfadeAtTime(silent.lanes[0].segments, 9), null)
}

console.log('\n== ADD BLANK / ADD SILENCE placeholders ==')
{
  // A placeholder is a source with NOTHING behind it, so its length is its TRIM against an endless source —
  // which is what lets a blank be stretched without a file to stretch into — and it is drawn as a clip of the
  // WHOLE of itself rather than as a piece cut from a file.
  const blank = makePlaceholderPath('video', 'cc3344')
  const silence = makePlaceholderPath('audio')
  check('a blank is a picture', mediaKind(blank), 'video')
  check('and a silence is sound', mediaKind(silence), 'audio')
  check('the blank carries the colour it was made with', placeholderFill(blank), 'cc3344')
  check('a blank with no colour named is black', placeholderFill(makePlaceholderPath('video')), DEFAULT_BLANK_FILL)
  check('and a silence has no colour to carry', placeholderFill(silence), null)
  // A PLACEHOLDER IS NOT A FILE, so the missing-file check must not be handed one: named to the file system it
  // reads as a file that is not there, which is how a job with a BLANK in it reported its own blank as missing.
  check('the file-system check is handed the real files', filePathsOnly(['/a.mov', '/b.wav']), ['/a.mov', '/b.wav'])
  check('and never a job\u2019s own blanks or silences', filePathsOnly([blank, '/a.mov', silence]), ['/a.mov'])
  check('nor a path that is nothing at all', filePathsOnly([undefined, '/a.mov']), ['/a.mov'])
  const repainted = withPlaceholderFill(blank, '#00FF99')
  check('repainting keeps the kind and the id', repainted.split(':').slice(0, 3), blank.split(':').slice(0, 3))
  check('and carries the new colour', placeholderFill(repainted), '00ff99')
  check('nonsense is not a colour, and black is', normaliseFill('chartreuse'), DEFAULT_BLANK_FILL)

  const job = (over: Partial<QueueTask> = {}) => ({
    id: 'p', type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: ['/a.mp4', blank, '/b.mp4'], outputDirectory: '/out', outputFilename: 'o.mp4',
    preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    trimPoints: { [blank]: { in: 0, out: 30 } },
    ...over,
  }) as unknown as QueueTask
  const timing = { resolveTiming: () => ({ duration: 10 }) }
  near('a placeholder source is endless', sourceDuration(job(), blank), PLACEHOLDER_SOURCE_SECONDS)

  const lane = buildTimeline(job(), timing).lanes[0]
  const shown = lane.segments[1]
  near('so its clip is exactly its trim', shown.duration, 30)
  check('and is not marked TRIMMED \u2014 it is the whole of itself', shown.trimmed, false)
  near('the clip after it begins after that length', lane.segments[2].start, 40)

  // STRETCHING is another trim against the same endless source, with no file to run out of.
  const stretched = buildTimeline(job({ trimPoints: { [blank]: { in: 0, out: 2000 } } }), timing).lanes[0].segments[1]
  near('a blank stretches to any length asked for', stretched.duration, 2000)

  // A placeholder with no trim at all falls back to the default rather than to the ten-hour ceiling.
  const untrimmed = buildTimeline(job({ trimPoints: undefined }), timing).lanes[0].segments[1]
  near('and a blank with no trim lands at the default', untrimmed.duration, DEFAULT_PLACEHOLDER_SECONDS)

  // THE TRANSPORT CLOCK. A blank has no file and so no element, so the ANCHORED clock must own the playhead
  // through it — without which the transport held at the blank's start forever, waiting for an element that
  // never arrives. The decision is asked here rather than inside the hook so it can be read on its own.
  const clipSegment = { key: 'k', sourcePath: '/a.mp4', start: 0, duration: 4, sourceUsedSeconds: 4, speed: 1, sourceIn: 0, trimmed: false } as TimelineSegment
  const blankSegment = { key: shown.key, sourcePath: blank, start: 4, duration: 4, sourceUsedSeconds: 4, speed: 1, sourceIn: 0, trimmed: false } as TimelineSegment
  check('a blank runs on the anchored clock', runsOnAnchoredClock(blankSegment, false, false), true)
  check('and still does if an element is left mounted beside it', runsOnAnchoredClock(blankSegment, false, true), true)
  check('a real clip with an element owns its own clock', runsOnAnchoredClock(clipSegment, false, true), false)
  check('and a real clip whose element has not arrived still waits for it', runsOnAnchoredClock(clipSegment, false, false), false)
  check('a still runs on the anchored clock too', runsOnAnchoredClock({ ...clipSegment, still: true } as TimelineSegment, false, true), true)
  check('so does a sound-only main lane with no element', runsOnAnchoredClock(clipSegment, true, false), true)
  check('while one that HAS an element does not', runsOnAnchoredClock(clipSegment, true, true), false)
  check('and no segment at all owns nothing', runsOnAnchoredClock(undefined, false, false), false)
}

console.log('\n== a picked image resolves to its OWN sequence, not the folder beside it ==')
{
  const folder = '/shots/'
  const siblings = [`${folder}clip_0001.jpg`, `${folder}clip_0002.jpg`, `${folder}clip_0003.jpg`, `${folder}.DS_Store`, `${folder}other.mov`, `${folder}notes.txt`]
  const found = detectSequences(siblings, { minFrames: 2 })
  const frames = [`${folder}clip_0001.jpg`, `${folder}clip_0002.jpg`, `${folder}clip_0003.jpg`]
  check('only the image frames form a sequence', found.length, 1)
  check('and it carries exactly those frames', found[0].files, frames)
  // What the app picks: the frame's OWN sequence. The whole sibling list is what dragged a neighbour movie
  // and a dot-file into the job as extra sources.
  const picked = found.find((sequence) => sequence.files.includes(`${folder}clip_0002.jpg`))
  check('and the picked frame resolves to that sequence alone', picked?.files, frames)
  check('so a neighbouring movie is not added', (picked?.files ?? []).some((file) => file.endsWith('.mov')), false)
  check('and a dot-file is not either', (picked?.files ?? []).some((file) => file.includes('.DS_Store')), false)
}

console.log('\n== a fade on an added track ==')
{
  // An added track is one clip on a lane of its own, so its head and tail fade IT and nothing else. The
  // record cannot be the timeline's own `#head`/`#tail` — those belong to the main lane and are shared by
  // every job — so the track's own clip key carries the two, and the drawn ramp reads back off that key.
  const trackKey = '/t.wav#0'
  const task = {
    id: 'tf', type: 'multitrack', status: 'pending', progress: 0,
    sourcePaths: ['/v.mp4'],
    additionalAudioTracks: [{ id: 'trk', path: '/t.wav', language: 'und' }],
    outputDirectory: '/o', outputFilename: 'o.mkv',
    preset: { id: 'p', name: 'P', container: 'mkv', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    transitions: {
      [trackEdgeFadeKey(trackKey, 'head')]: { type: 'fade', duration: 0.5 },
      [trackEdgeFadeKey(trackKey, 'tail')]: { type: 'fade', duration: 0.75 },
    },
  } as unknown as QueueTask
  check('a track fade reads back off that track\u2019s own clip key', [trackEdgeFade(task, trackKey, 'head'), trackEdgeFade(task, trackKey, 'tail')], [0.5, 0.75])
  check('and the timeline\u2019s own edge key is not the same record', edgeFade(task, 'head'), 0)
  const lanes = buildTimeline(task, { resolveTiming: () => ({ duration: 10 }) }).lanes
  const trackLane = lanes.find((lane) => lane.id === 'trk')
  near('the track\u2019s clip draws its fade in', trackLane?.segments[0].fadeIn ?? -1, 0.5)
  near('and its fade out', trackLane?.segments[0].fadeOut ?? -1, 0.75)
  // A fade on one lane is not a fade on the other: the main lane\u2019s clip is left untouched.
  check('while the main lane\u2019s clip keeps no edge fade of its own', lanes[0].segments[0].fadeIn ?? 0, 0)
  // The same clamp the timeline draws with is the one the engine places, so a fade longer than the clip is
  // reduced rather than written past its end.
  const tooLong = { ...task, transitions: { [trackEdgeFadeKey(trackKey, 'head')]: { type: 'fade', duration: 40 } } } as unknown as QueueTask
  near('and a fade longer than the track is clamped to it', buildTimeline(tooLong, { resolveTiming: () => ({ duration: 6 }) }).lanes.find((lane) => lane.id === 'trk')?.segments[0].fadeIn ?? -1, 6)
}

console.log('\n== the empty audio lane ==')
{
  // Every job mode carries a lane with nothing to land yet, so a source can be added from the timeline
  // rather than only by reopening the job. It lengthens nothing and holds no clip; it is the [+] at its head
  // that matters. A job whose main lane is ALREADY a sound lane needs no second one, and a job with real
  // tracks has their own lanes instead.
  const preset = { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' }
  const videoJob = {
    id: 'e', type: 'transcode', status: 'pending', progress: 0,
    sourcePaths: ['/v.mp4'], outputDirectory: '/o', outputFilename: 'o.mp4', preset,
  } as unknown as QueueTask
  const videoLanes = buildTimeline(videoJob, { resolveTiming: () => ({ duration: 10 }) }).lanes
  check('a job with no audio still carries a lane to add some on', videoLanes.map((lane) => lane.id), ['main', EMPTY_AUDIO_LANE_ID])
  check('and that lane is empty, silent and named', [videoLanes[1].segments.length, videoLanes[1].duration, videoLanes[1].label], [0, 0, 'AUDIO 1'])
  check('so it does not lengthen the timeline', buildTimeline(videoJob, { resolveTiming: () => ({ duration: 10 }) }).duration, 10)
  const soundJob = { ...videoJob, sourcePaths: ['/t.wav'] } as unknown as QueueTask
  check('while a sound job needs no second sound lane', buildTimeline(soundJob, { resolveTiming: () => ({ duration: 5 }) }).lanes.map((lane) => lane.id), ['main'])
  const trackJob = { ...videoJob, type: 'multitrack', additionalAudioTracks: [{ id: 't', path: '/a.wav', language: 'und' }] } as unknown as QueueTask
  check('and a job with a real track has its own lanes instead', buildTimeline(trackJob, { resolveTiming: () => ({ duration: 5 }) }).lanes.map((lane) => lane.id), ['main', 't'])
  const stitchOfVideo = { ...videoJob, type: 'stitch', sourcePaths: ['/a.mp4', '/b.mp4'] } as unknown as QueueTask
  check('a stitch of pictures gets one too', buildTimeline(stitchOfVideo, { resolveTiming: () => ({ duration: 4 }) }).lanes.map((lane) => lane.id), ['main', EMPTY_AUDIO_LANE_ID])
}

console.log('\n== tracks sequenced on one lane ==')
{
  // COMBO's own mode is how the TRACKS relate to each other. 'stitch' sequences them into one lane and one
  // output stream — a second axis of concatenation — while the default stacks them in parallel from zero.
  const preset = { id: 'p', name: 'P', container: 'mkv', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' }
  const job = (over: Partial<QueueTask> = {}) => ({
    id: 'sq', type: 'combo', comboMode: 'stitch', status: 'pending', progress: 0,
    sourcePaths: ['/v1.mp4', '/v2.mp4'],
    additionalAudioTracks: [{ id: 't1', path: '/a.wav', language: 'und' }, { id: 't2', path: '/b.wav', language: 'eng' }],
    outputDirectory: '/o', outputFilename: 'o.mkv', preset, ...over,
  }) as unknown as QueueTask
  const timing = { resolveTiming: (path: string) => ({ duration: path === '/a.wav' ? 3 : path === '/b.wav' ? 4 : 2 }) }
  check('the mode is read for a combo and a multi-track alike', [tracksConcatenate(job()), tracksConcatenate({ ...job(), type: 'multitrack' } as unknown as QueueTask), tracksConcatenate(job({ comboMode: 'multitrack' }))], [true, true, false])
  const sequenced = buildTimeline(job(), timing)
  check('a sequenced COMBO keeps its tracks on ONE lane', sequenced.lanes.map((lane) => lane.id), ['main', STITCHED_AUDIO_LANE_ID])
  const audioLane = sequenced.lanes[1]
  check('with one segment per track, in order', audioLane.segments.map((segment) => segment.sourcePath), ['/a.wav', '/b.wav'])
  check('each starting where the last ended', [audioLane.segments[0].start, audioLane.segments[1].start], [0, 3])
  near('and the lane running to their sum', audioLane.duration, 7)
  near('so the output runs to the longer of the visuals and the sequenced tracks', sequenced.duration, 7)
  const stacked = buildTimeline(job({ comboMode: 'multitrack' }), timing)
  check('while a stacked COMBO keeps one lane per track', stacked.lanes.map((lane) => lane.id), ['main', 't1', 't2'])
  check('each playing from zero', stacked.lanes.slice(1).map((lane) => lane.segments[0].start), [0, 0])
  near('and the output running to the longest', stacked.duration, 4)
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

console.log('\n== a clip keeps its records wherever it moves ==')
{
  // TWO SEGMENTS OF ONE FILE, each with records of its own — the case a PATH cannot tell apart, and the one
  // both bugs came from. They carry opaque ids, as an import gives them, so the id is what every per-clip
  // record is filed under and what BOTH React lists (the timeline and the queue) key their element by.
  const key0 = newClipId()
  const key1 = newClipId()
  const base: QueueTask = {
    id: 'g', type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: ['a.mp4', 'a.mp4'], clipIds: [key0, key1],
    outputDirectory: '/out', outputFilename: 'o.mp4',
    preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    trimPoints: { [key0]: { in: 0, out: 5 }, [key1]: { in: 6, out: 10 } },
    sourceFit: { [key0]: { mode: 'width', offset: { x: 0, y: 0 } }, [key1]: { mode: 'height', offset: { x: 0, y: 0 } } },
    sourceCrop: { [key0]: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, [key1]: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } },
    sourceSpeed: { [key0]: { speed: 2, interpolation: 'sampling', maintainPitch: true }, [key1]: { speed: 0.5, interpolation: 'blending', maintainPitch: false } },
    sourceFps: { [key0]: makeRate(12, 1), [key1]: makeRate(48, 1) },
  }
  const recordsAt = (task: QueueTask, index: number) => ({
    trim: trimFor(task, 'a.mp4', index)?.out,
    fit: sourceFitFor(task, 'a.mp4', index)?.mode,
    crop: sourceCropFor(task, 'a.mp4', index)?.w,
    speed: speedFor(task, 'a.mp4', index).speed,
    rate: rateLabel(clipRateFor(task, 'a.mp4', index, makeRate(30, 1))),
  })
  const clipsOf = (task: QueueTask) => buildTimeline(task).lanes[0].segments.map((segment) => segment.key)

  check('two copies of one file are two clips', clipsOf(base), [key0, key1])
  check('each carries the id it was given, and its own place beside it', buildTimeline(base).lanes[0].segments.map((segment) => segment.index), [0, 1])
  check('the first copy reads its own records', recordsAt(base, 0), { trim: 5, fit: 'width', crop: 0.8, speed: 2, rate: '12' })
  check('and the second reads its own', recordsAt(base, 1), { trim: 10, fit: 'height', crop: 0.6, speed: 0.5, rate: '48' })

  // A MOVE: the ids are spliced with the paths, so not one record had to be re-keyed — it was already filed
  // under the clip, and the clip moved.
  const moved: QueueTask = { ...base, clipIds: moveClipIds(materializeClipIds(base), 1, 0), clipNumbers: moveAlong(materializeClipNumbers(base), 1, 0) }
  check('a move puts the second clip first, id and all', clipsOf(moved), [key1, key0])
  // The label follows the clip rather than staying on the row it used to sit on: a job that was never
  // reordered counts 1 then 2, and after the drag the clip that was second is still shown by 2 wherever
  // it now sits — the bug the queue's screenshots showed, where the numbers stayed put and the lengths
  // swapped under them.
  check('two copies are shown as CLIP 1 and CLIP 2 where they first sit', [clipNumberAt(base, 0), clipNumberAt(base, 1)], [1, 2])
  check('and the number travels with its clip when the second is dragged in front of the first', [clipNumberAt(moved, 0), clipNumberAt(moved, 1)], [2, 1])
  const back: QueueTask = { ...moved, clipIds: moveClipIds(materializeClipIds(moved), 1, 0), clipNumbers: moveAlong(materializeClipNumbers(moved), 1, 0) }
  check('and comes home with it when it is dragged back again', [clipsOf(back), clipNumberAt(back, 0), clipNumberAt(back, 1)], [[key0, key1], 1, 2])
  check('and the clip that moved kept its trims, fit, crop, speed and rate', recordsAt(moved, 0), { trim: 10, fit: 'height', crop: 0.6, speed: 0.5, rate: '48' })
  check('while the other keeps its own', recordsAt(moved, 1), { trim: 5, fit: 'width', crop: 0.8, speed: 2, rate: '12' })

  // A REMOVAL: one id goes, and every record of the survivor still resolves at its new place.
  const removed = removeSourceFromTask(moved, 'a.mp4', 0) as QueueTask
  check('a removal leaves one clip', removed.sourcePaths.length, 1)
  check('and it is the one that was not taken out', removed.clipIds, [key0])
  check('with every record still its own', recordsAt(removed, 0), { trim: 5, fit: 'width', crop: 0.8, speed: 2, rate: '12' })

  // A DUPLICATE: a third occurrence is a third clip, with an id of its own and none of the others' records.
  const dupKey = newClipId()
  const duplicated: QueueTask = { ...base, sourcePaths: ['a.mp4', 'a.mp4', 'a.mp4'], clipIds: [key0, key1, dupKey] }
  check('a duplicate is a clip of its own', new Set(materializeClipIds(duplicated)).size, 3)
  check('and it carries none of the records of the copy it came from', [trimFor(duplicated, 'a.mp4', 2), speedFor(duplicated, 'a.mp4', 2).speed], [undefined, 1])

  // A SPLIT: each clip into a job of its own, taking its records under its own id.
  const splitFirst: QueueTask = { ...base, id: 's1', type: 'transcode', sourcePaths: ['a.mp4'], clipIds: [key0], ...clipRecordsFor(base, key0, 'a.mp4') }
  const splitSecond: QueueTask = { ...base, id: 's2', type: 'transcode', sourcePaths: ['a.mp4'], clipIds: [key1], ...clipRecordsFor(base, key1, 'a.mp4') }
  check('a split takes the clip\u2019s own records', recordsAt(splitFirst, 0), { trim: 5, fit: 'width', crop: 0.8, speed: 2, rate: '12' })
  check('and the other clip\u2019s its own', recordsAt(splitSecond, 0), { trim: 10, fit: 'height', crop: 0.6, speed: 0.5, rate: '48' })

  // A LEGACY JOB has no ids and no migration on disk: the id a clip falls back to IS the key its records
  // already carry, and materializing writes exactly that down before the list moves — so a removal that
  // shifts the places does not shift the ids with them.
  const legacy: QueueTask = {
    id: 'l', type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: ['a.mp4', 'a.mp4'], outputDirectory: '/out', outputFilename: 'o.mp4',
    preset: base.preset,
    trimPoints: { 'a.mp4#1': { in: 6, out: 10 } },
  }
  check('a legacy clip reads the key it always had', clipIdAt(legacy, 1), 'a.mp4#1')
  check('and an untouched legacy clip is still not retimed', buildTimeline(legacy).lanes[0].segments.map((segment) => segment.key), ['a.mp4#0', 'a.mp4#1'])
  const legacyRemoved = removeSourceFromTask(legacy, 'a.mp4', 0) as QueueTask
  check('so a removal keeps the survivor\u2019s own record', trimFor(legacyRemoved, 'a.mp4', 0)?.out, 10)
  check('and materializing writes the legacy keys down', materializeClipIds(legacy), ['a.mp4#0', 'a.mp4#1'])
  // The one list op that still takes bare paths: a reorder handed over without ids matches occurrences in order.
  check('a bare-path reorder matches each id to its path', matchClipIdsToPaths(['a.mp4', 'b.mp4'], ['A', 'B'], ['b.mp4', 'a.mp4']), ['B', 'A'])
}

console.log('\n== what a copy of one file is called ==')
{
  // A file imported once is named by the file. A file imported twice is named by its copies, and the number is
  // the travel-along one, so a reorder carries the label with the clip — the reading the queue's screenshots
  // got wrong was not the number existing but the label staying behind.
  check('one import of a file needs no label', copyLabelFor({ sourcePaths: ['a.mp4'] }, 0), undefined)
  const pair = { sourcePaths: ['a.mp4', 'a.mp4'] }
  check('two copies are COPY 1 and COPY 2', [copyLabelFor(pair, 0), copyLabelFor(pair, 1)], ['COPY 1', 'COPY 2'])
  const swapped = { sourcePaths: ['a.mp4', 'a.mp4'], clipNumbers: [2, 1] }
  check('and the number travels with the clip it names', [copyLabelFor(swapped, 0), copyLabelFor(swapped, 1)], ['COPY 2', 'COPY 1'])
  check('two different files each keep their own name', [copyLabelFor({ sourcePaths: ['a.mp4', 'b.mp4'] }, 0), copyLabelFor({ sourcePaths: ['a.mp4', 'b.mp4'] }, 1)], [undefined, undefined])
  // The guard: an index has to name that path in the JOB's own list, or an audio track's lane index would
  // count the copies of whatever file happens to sit at that place in `sourcePaths`.
  check('an index that names another file is no label', copyLabelFor(pair, 0, 'b.mp4'), undefined)
}

console.log('\n== two tracks of one file are two tracks ==')
{
  // An added track has no id to travel in the source list: its own record IS its identity, and the lane row,
  // the mute and the trim are all keyed by it. Two adds of one file must therefore be two DISTINCT ids — the
  // clock-and-place a generator can hand out (the same millisecond, the same place) gave both the same one,
  // and two lanes wearing one key is how a second copy of one file went missing from the timeline.
  check('two generated track ids differ', newTrackId() === newTrackId(), false)
  const job = {
    id: 'm', type: 'multitrack', status: 'pending', progress: 0,
    sourcePaths: ['/clip.mp4'], outputDirectory: '/out', outputFilename: 'o.mkv',
    preset: { id: 'p', name: 'P', container: 'mkv', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    additionalAudioTracks: [{ id: newTrackId(), path: '/t.wav', language: 'und' }, { id: newTrackId(), path: '/t.wav', language: 'und' }],
  } as unknown as QueueTask
  const lanes = buildTimeline(job, { resolveTiming: () => ({ duration: 10 }) }).lanes
  // The visual plus the two tracks, and the two tracks carry DIFFERENT ids so nothing keys them together.
  check('two copies of one track are two lanes', lanes.length, 3)
  check('and they are keyed apart', new Set(lanes.map((lane) => lane.id)).size, 3)
  check('with the numbers counting the tracks', [lanes[1].label, lanes[2].label], ['AUDIO 1', 'AUDIO 2'])
}

console.log('\n== trimming a clip ==')
{
  const whole = trimWindowOf(0, 10)
  check('a window reads its in point and its run', whole, { in: 0, out: 10 })
  // The OUT edge: dragged right it grows the clip, left it shortens it, and it stops at the end of the source.
  check('the out edge stops at the end of the source', dragTrimWindow(whole, 'out', 5, 10), { in: 0, out: 10 })
  check('and dragged left shortens the clip', dragTrimWindow(whole, 'out', -3, 10), { in: 0, out: 7 })
  check('the in edge holds while the out edge moves', dragTrimWindow({ in: 2, out: 8 }, 'out', -1, 10), { in: 2, out: 7 })
  // The IN edge: dragged right it trims the head, and it stops at zero and one minimum short of the out edge.
  check('the in edge trims the head', dragTrimWindow(whole, 'in', 3, 10), { in: 3, out: 10 })
  check('the out edge holds while the in edge moves', dragTrimWindow({ in: 2, out: 8 }, 'in', 2, 10), { in: 4, out: 8 })
  check('the in edge cannot pass below zero', dragTrimWindow({ in: 2, out: 8 }, 'in', -5, 10), { in: 0, out: 8 })
  check('and stops one minimum short of the out edge', dragTrimWindow({ in: 2, out: 8 }, 'in', 20, 10, 0.5).in, 7.5)
  check('the out edge stops one minimum past the in edge', dragTrimWindow({ in: 2, out: 8 }, 'out', -20, 10, 0.5).out, 2.5)
  check('an unknown length leaves the out edge unbounded', dragTrimWindow({ in: 0, out: 10 }, 'out', 5, 0), { in: 0, out: 15 })
  // A window that keeps the whole source is NOT a decision, so it leaves no record behind.
  check('a window keeping everything is no trim', windowIsWholeSource({ in: 0, out: 10 }, 10), true)
  check('dropping anything off the tail is a trim', windowIsWholeSource({ in: 0, out: 9 }, 10), false)
  check('trimming the head is a trim', windowIsWholeSource({ in: 1, out: 10 }, 10), false)
  check('and an unknown length cannot be called whole', windowIsWholeSource({ in: 0, out: 10 }, 0), false)
}

console.log('\n== a timeline reorder moves every list together ==')
{
  const key0 = newClipId()
  const key1 = newClipId()
  const task = { sourcePaths: ['a.mp4', 'b.mp4'], clipIds: [key0, key1], clipNumbers: [1, 2] }
  // The timeline's drag is the same splice of the three lists the queue's reorder is, so each clip keeps its id
  // and its copy number while the ORDER it is joined in changes.
  check('the paths take the new order', moveAlong(task.sourcePaths, 1, 0), ['b.mp4', 'a.mp4'])
  check('and the ids travel with them', moveAlong(materializeClipIds(task), 1, 0), [key1, key0])
  check('and so do the copy numbers', moveAlong(materializeClipNumbers(task), 1, 0), [2, 1])
}

console.log('\n== the numbers a run of added sources takes ==')
{
  const task = { sourcePaths: ['a.mp4', 'b.mp4'], clipNumbers: [1, 1] }
  check('a file not in the job takes the first number', addedClipNumbers(task, ['c.mp4']), [1])
  check('a copy of a file already there takes the next', addedClipNumbers(task, ['a.mp4']), [2])
  // Two copies added in ONE gesture number one after the other, which `nextClipNumber` alone could not do —
  // it reads only the list that exists before the add, so both would take the same figure.
  check('two copies added together run on', addedClipNumbers(task, ['a.mp4', 'a.mp4']), [2, 3])
  check('two different new files each number from one', addedClipNumbers(task, ['c.mp4', 'd.mp4']), [1, 1])
}

console.log('\n== a number list that does not fit its sources ==')
{
  // THE BUG. A clip-number array SHORTER than the source list made its tail fall back to the RANK, and the
  // rank landed on a number a copy already carried — which is how two copies of one file came to read `COPY 2`
  // at once. A list that is not the length of the sources is now ignored WHOLE, so the ranks stand instead.
  const short = { sourcePaths: ['a.mp4', 'a.mp4'], clipNumbers: [2] }
  check('a short number list is ignored whole', [clipNumberAt(short, 0), clipNumberAt(short, 1)], [1, 2])
  check('so two copies read different numbers', [copyLabelFor(short, 0), copyLabelFor(short, 1)], ['COPY 1', 'COPY 2'])
  check('and materializing ignores it too', materializeClipNumbers(short), [1, 2])
  // A list that DOES fit is trusted, travel and all.
  const fitted = { sourcePaths: ['a.mp4', 'a.mp4'], clipNumbers: [2, 1] }
  check('a list that fits is trusted', [clipNumberAt(fitted, 0), clipNumberAt(fitted, 1)], [2, 1])
}

console.log('\n== where a pasted clip goes ==')
{
  // The candidates are the timeline's [+] markers, and the nearest to the skimmer wins — the head at zero,
  // every cut, the tail at the end.
  check('a skimmer at the head takes the head', nearestInsertPosition([0, 4, 10], 0), 0)
  check('and one at the tail takes the tail', nearestInsertPosition([0, 4, 10], 10), 2)
  check('just past a cut takes that cut', nearestInsertPosition([0, 4, 10], 4.5), 1)
  check('nearer the start than the first cut takes the head', nearestInsertPosition([0, 4, 10], 1.5), 0)
  check('a tie goes to the earlier marker', nearestInsertPosition([0, 4], 2), 0)
  check('an empty timeline takes the only place there is', nearestInsertPosition([], 3), 0)
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
  // A clip's key carries the FORMAT it was written in as well as the parameters it was written at, so
  // a change to how one is encoded is a change of key: a job that has already been queued names the
  // clip built the old way, and without the version it would go on playing it.
  const at25 = stillPreviewKey('/frame.png', 25, 10)
  const at30 = stillPreviewKey('/frame.png', 30, 10)
  const longer = stillPreviewKey('/frame.png', 25, 20)
  check('a different rate is a different clip', at25 === at30, false)
  check('a different length is a different clip', at25 === longer, false)
  check('and both still name their source', [sourceOfPreviewKey(at25), sourceOfPreviewKey(at30)], ['/frame.png', '/frame.png'])
  check('the key says which format the clip was written in', at25.includes(`v${PREVIEW_FORMAT_VERSION}`), true)

  // A sequence's clip carries its rate and frame count: a clip built at another rate is a
  // different length, so playing it would run the sequence at the wrong speed rather than
  // merely looking stale. This is what made every sequence play too fast.
  const seqAt25 = sequencePreviewKey('/seq/f_0001.png', 25, 240)
  const seqAt30 = sequencePreviewKey('/seq/f_0001.png', 30, 240)
  const seqReframed = sequencePreviewKey('/seq/f_0001.png', 30, 300)
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
  // A fit is carried by the clip that owns it, so a MOVE carries it and the place it lands in reads it.
  const fitIds = ['k-a', 'k-b', 'k-c']
  const fits = { 'k-a': { mode: 'width' as const, offset: { x: 0.1, y: 0 } }, 'k-b': { mode: 'height' as const, offset: { x: 0, y: 0 } } }
  const reordered = { sourcePaths: ['c.mp4', 'a.mp4', 'b.mp4'], clipIds: moveClipIds(fitIds, 2, 0), sourceFit: fits } as unknown as QueueTask
  check('a reorder carries each fit with its clip', [sourceFitFor(reordered, 'a.mp4', 1)?.mode, sourceFitFor(reordered, 'b.mp4', 2)?.mode], ['width', 'height'])
  check('and the clip that moved reads its own fit, which it has none of', sourceFitFor(reordered, 'c.mp4', 0), undefined)
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
  // A FIT IS CAPPED, NEVER FLOORED. A fit held up to ZOOM_MIN could not fit a long job at all — the whole
  // output stayed out of reach, which is the opposite of what a fit is for — so the manual zoom's floor is
  // the buttons' business and not the fit's. The sixteen-minute case the report named is the reading here.
  check('a fit is capped at the deepest zoom', fitZoom(1, 100000), ZOOM_MAX)
  check('but a long job is not floored at the manual zoom\u2019s own floor', fitZoom(100000, 100) < ZOOM_MIN, true)
  near('sixteen minutes fits a 900-pixel panel', laneWidthFor(960, fitZoom(960, 900)), 900 - FIT_TRAILING_MARKER)
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
  // A clip's records are filed under its own ID, which does not move when the clip does, so a removal only
  // has to drop the id of the clip that went: everything else is left where it is and still resolves.
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
  check('a surviving clip keeps its own record under its own id', droppedFirst?.trimPoints, { 'c.mp4#2': { in: 3, out: 4 } })
  check('and its fit', droppedFirst?.sourceFit, { 'c.mp4#2': { mode: 'width', offset: 0.5 } })
  check('and the other survivor its crop', droppedFirst?.sourceCrop, { 'b.mp4#1': { x: 0, y: 0, w: 1, h: 1 } })
  // And they still RESOLVE, at the place the clip now holds rather than the one it had.
  check('and it is read at the place the clip now holds', [trimFor(droppedFirst as QueueTask, 'c.mp4', 1)?.in, sourceCropFor(droppedFirst as QueueTask, 'b.mp4', 0)?.w], [3, 1])
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

console.log('\n== the list an editor is showing ==')
{
  // The same three-clip job the removal above is read on, so the two routes can be read against each
  // other: a list the editor sends is a removal or several, and it has to land where they land.
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

  const dropped = withSourceList(job(), ['a.mp4', 'c.mp4'])
  const byRemoval = removeSourceFromTask(job(), 'b.mp4', 1)
  check('a list without b leaves the same records a removal of b would',
    [dropped?.trimPoints, dropped?.sourceFit, dropped?.sourceCrop, dropped?.transitions],
    [byRemoval?.trimPoints, byRemoval?.sourceFit, byRemoval?.sourceCrop, byRemoval?.transitions])
  check('so the clip that went left no records behind', [dropped?.sourceFit?.['b.mp4#1'], dropped?.trimPoints?.['b.mp4#1']], [undefined, undefined])

  // An ORDER is the one thing a removal cannot express. It is carried by the ids, which travel with the
  // clips, so the records stay filed under the clip and are READ at whatever place the clip now holds.
  const reversed = withSourceList(job(), ['c.mp4', 'b.mp4', 'a.mp4'])
  check('a list in another order keeps each clip\u2019s own trim', [trimFor(reversed as QueueTask, 'c.mp4', 0)?.in, trimFor(reversed as QueueTask, 'a.mp4', 2)?.in], [3, 1])
  check('and each clip\u2019s own fit', sourceFitFor(reversed as QueueTask, 'c.mp4', 0)?.mode, 'width')
  check('and each clip\u2019s own crop', sourceCropFor(reversed as QueueTask, 'b.mp4', 1)?.w, 1)
  const twice = job({ sourcePaths: ['a.mp4', 'a.mp4'], trimPoints: { 'a.mp4#1': { in: 5, out: 6 } } })
  check('two copies of one file keep their own trims when the order turns round', withSourceList(twice, ['a.mp4', 'a.mp4'])?.trimPoints, { 'a.mp4#1': { in: 5, out: 6 } })

  // A track has no place and nothing filed against one, so it simply goes; the mode is then re-read
  // from what is left, exactly as a removal re-reads it.
  const withTrack = job({ sourcePaths: ['a.mp4'], additionalAudioTracks: [{ id: 't', path: 's.wav', language: 'und' }] })
  check('a track the editor took out is not carried', withSourceList(withTrack, ['a.mp4'], [])?.additionalAudioTracks, undefined)
  check('and the job reads as what is left', withSourceList(withTrack, ['a.mp4'], [])?.type, 'transcode')
  check('while a track that stayed is carried', withSourceList(withTrack, ['a.mp4'], [{ id: 't', path: 's.wav', language: 'und' }])?.additionalAudioTracks, [{ id: 't', path: 's.wav', language: 'und' }])

  // A list the queue already has changes nothing, and a list with nothing left in it is no job at all.
  const same = withSourceList(job(), ['a.mp4', 'b.mp4', 'c.mp4'])
  check('the list the job already has leaves every record where it was', [same?.trimPoints, same?.sourceFit, same?.sourceCrop], [job().trimPoints, job().sourceFit, job().sourceCrop])
  check('and a list with nothing left in it is no job', withSourceList(job(), []), null)
}

console.log('\n== where a sequence picture is without asking ==')
{
  // The editor reads a built clip's whereabouts off the task rather than waiting for a round trip to
  // confirm it exists, which is what stops the monitor saying PREPARING on every open of a job whose
  // clips are all built. The key carries the rate, so a clip built at another rate is not this
  // source's clip — it is a different length from the one the timeline expects.
  const frame = '/seq/f_0001.png'
  const spec = (rate: number) => sequencePreviewKey(frame, rate, 240)
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

  // A DRAG is one step back, however many moves it took. The draft is remembered when the gesture
  // ends, from the state it was in before it began, so walking a drag back is one press rather than
  // one per twitch — and a drag that ended where it started leaves no step behind at all.
  const afterTheDrag = { fps: 25, mutedLanes: { main: true } }
  const gesture = endGesture(emptyHistory<typeof draft>(), draft, afterTheDrag)
  check('a drag of fifty moves is one step back', gesture?.past, [draft])
  check('and stepping back from it shows the state before the drag', stepHistory(gesture!, afterTheDrag, 'undo')?.state, draft)
  check('and it starts no branch ahead of it', gesture?.future, [])
  check('a gesture that ended where it began is no step at all', endGesture(emptyHistory<typeof draft>(), draft, { ...draft, mutedLanes: { main: true } }), null)

  // The cap. It is a limit on how far back a window can step, not a count of edits made.
  let deep = emptyHistory<{ step: number }>()
  for (let index = 0; index < HISTORY_LIMIT + 10; index++) {
    const before = { step: index }
    deep = recordChange(deep, before, { step: index + 1 }) as typeof deep
  }
  check('the history stops growing at its limit', deep.past.length, HISTORY_LIMIT)
  check('and the oldest states are the ones let go', deep.past[0], { step: 10 })
}
console.log('\n== the canvas a drawing is made on ==')
{
  // The drawings are made on a bounded canvas and scaled up, which is not a preference: drawn natively at
  // the frame's own size these filters come out dim and colourless on this ffmpeg, and correct at or
  // below 1280. So the canvas follows the FRAME's shape and its long edge stops at the cap — a portrait
  // frame draws portrait, a landscape frame landscape, and both are even, because an encoder refuses an
  // odd one.
  check('a frame inside the cap is drawn at its own size', drawingCanvas(1280, 720), { width: 1280, height: 720 })
  check('a small frame likewise', drawingCanvas(640, 360), { width: 640, height: 360 })
  check('a landscape frame is capped on its width', drawingCanvas(1920, 1080), { width: 1280, height: 720 })
  check('a portrait frame is capped on its height', drawingCanvas(1080, 1920), { width: 720, height: 1280 })
  check('a square frame keeps its square', drawingCanvas(2160, 2160), { width: 1280, height: 1280 })
  check('4K is capped the same as 1080p', drawingCanvas(3840, 2160), { width: 1280, height: 720 })
  check('an odd frame is rounded to an even canvas', drawingCanvas(1921, 1081), { width: 1280, height: 720 })
  check('and the long edge never exceeds the cap', Object.values(drawingCanvas(6000, 4000)).every((side) => side <= DRAWING_MAX_EDGE), true)
}

console.log('\n== the graph that draws the export\u2019s own mix ==')
{
  // The audio is SPLIT, not read twice: one mix feeds the drawing and the encoder, which is the whole
  // reason the picture is a graph rather than a filter beside the encoder's own. The drawing is made at
  // the bounded canvas and scaled UP to the frame with lanczos.
  const lone = visualizationGraph({ template: 'waveform', width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2 })
  check('a lone sound is split into the drawing and the export', lone.includes('[0:a]asplit=2[mixA][mixV]'), true)
  check('and the export\u2019s audio comes from the mix', lone.includes('[mixA]aresample=48000'), true)
  check('the drawing is made at the capped canvas', lone.includes('showwavespic=s=1280x720:scale=lin:draw=full:split_channels=0:colors=#9fbf9a'), true)
  // The waveform's own three knobs are on the filter, and the FILLED draw is the default: measured, the
  // lighter `scale` draw covers about a fifth of what `full` does at a 1080-row frame, which is why the
  // editor's monitor read as blank when the lighter one was used.
  check('and drawn with the weight it was given', drawingTuneOf({}).waveWeight, 'fill')
  // The one difference between the editor's still and the export's picture: a PICTURE is one frame, so it is
  // held for the sound's length. Without the loop the export would be ONE frame of video, whatever the sound.
  check('and held for the whole of the sound it is drawn from', lone.includes(',loop=loop=-1:size=1,scale=1920:1080'), true)
  check('and scaled up to the frame with lanczos', lone.includes(',scale=1920:1080:flags=lanczos[w]'), true)
  check('over a colour it was given, in the frame\u2019s own shape', lone.includes('color=c=#000000:s=1920x1080:r=30[bg]'), true)
  check('and flattened to the format every path writes', lone.includes('[plate]format=yuv420p[v]'), true)
  check('the drawing and the plate are brought together before that', lone.includes('[bg][w]overlay=shortest=1[plate]'), true)
  // A drawing with no progress line asked for is the drawing alone: the plate goes straight to the format, with
  // no bar source in the graph at all.
  check('and without the line there is no bar to overlay', lone.includes(`${VISUALIZATION_PROGRESS_COLOR}`), false)

  // The progress line, which is what makes a PICTURE a progress readout rather than a still: a bar a few pixels
  // wide, the height of the frame, laid over the assembled plate at a time-driven x. The expression is the whole
  // of it — the bar travels from the left edge at t=0 to the right edge at the sound's own end.
  const swept = visualizationGraph({ template: 'waveform', width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2, duration: 5, progressLine: true })
  check('a picture asked for a progress line is given a bar', swept.includes(`color=c=${VISUALIZATION_PROGRESS_COLOR}:s=`), true)
  check('the bar is the height of the frame and a few pixels wide', swept.includes(`color=c=${VISUALIZATION_PROGRESS_COLOR}:s=6x1080:r=30[core]`), true)
  // The core is cased in the background colour: a bare amber line all but disappears over a drawing that fills
  // its frame with colour, which is the spectrum — that is why it looked like it was not drawing at all.
  check('and it is cased in the dark, so it reads on a bright drawing too', swept.includes(`color=c=${VISUALIZATION_PROGRESS_CASE_COLOR}:s=${progressLineWidth(1080) + PROGRESS_LINE_CASE * 2}x1080:r=30[case]`), true)
  check('the case and the core are composited into one bar', swept.includes(`[case][core]overlay=x=${PROGRESS_LINE_CASE}:y=0[bar]`), true)
  check('and it is laid over the plate rather than under it', swept.includes('[plate][bar]overlay=x='), true)
  check('the bar sweeps the sound\u2019s own length', swept.includes(`x='(t/5.000)*(main_w-overlay_w)'`), true)
  check('and the result is flattened like everything else', swept.includes(`format=yuv420p[v]`), true)
  // A drawing that MOVES is its own progress, so the line is never laid over one, even when it is asked for.
  const sweptMoving = visualizationGraph({ template: 'eq', width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2, duration: 5, progressLine: true })
  check('a moving drawing is given no bar even when a line is asked for', sweptMoving.includes('[bar]'), false)
  // And a sound with no known length has nothing to sweep across, so the bar is not drawn at all.
  const sweptUnknown = visualizationGraph({ template: 'waveform', width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2, duration: 0, progressLine: true })
  check('and a sound of no known length gets no bar either', sweptUnknown.includes('[bar]'), false)

  const tracks = visualizationGraph({ template: 'eq', width: 1080, height: 1920, fps: 25, color: '#ffffff', sources: ['0:a', '1:a', '2:a'], background: { input: 0 }, rate: 48000, channels: 2 })
  check('several tracks are summed into one mix', tracks.includes('[0:a][1:a][2:a]amix=inputs=3:normalize=0'), true)
  check('with the levels as they were set', tracks.includes('normalize=0'), true)
  // AND THE OPT-IN CLIPPING GUARD RIDES ON THE EXPORT'S OWN HALF of the split: it sits after the sum, on the
  // audio that is written rather than on the audio that is drawn, so the picture is still made from the raw mix.
  const guarded = visualizationGraph({ template: 'eq', width: 1080, height: 1920, fps: 25, color: '#ffffff', sources: ['0:a', '1:a', '2:a'], background: { input: 0 }, rate: 48000, channels: 2, preventClipping: true })
  check('a guarded drawing drops the limiter on the export’s half', guarded.includes(`[mixA]aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo,${CLIPPING_GUARD_FILTER}[aout]`), true)
  check('and a lone source is not guarded, having nothing to be summed with', visualizationGraph({ template: 'eq', width: 1080, height: 1920, fps: 25, color: '#ffffff', sources: ['0:a'], background: { input: 0 }, rate: 48000, channels: 2, preventClipping: true }).includes('alimiter'), false)
  // And a 5.1 drawing lays its OWN half out at six channels, the two halves of the split agreeing.
  check('a 5.1 drawing lays the export’s half out at 5.1', visualizationGraph({ template: 'eq', width: 1080, height: 1920, fps: 25, color: '#ffffff', sources: ['0:a'], background: { input: 0 }, rate: 48000, channels: 6 }).includes('channel_layouts=5.1[aout]'), true)
  check('the drawing sits on the picture input it was given', tracks.includes('[0:v]scale=1080:1920,setsar=1[bg]'), true)
  // The EQ is the one template whose drawing is NOT made on the capped canvas: it is made one pixel per bar at
  // the frame\u2019s own height, because the stretch that makes the bars chunky is nearest-neighbour and a
  // vertical stretch would step the frequency axis too.
  check('an EQ drawing is made one pixel per bar at the frame\u2019s own height', tracks.includes('showfreqs=s=64x1920:mode=bar'), true)

  // Its own two quirks: `showspectrum` has no rate option, so the rate is imposed after it, and its
  // colouring is ffmpeg's own ramp, so the hex this app offers is not passed to it.
  const spectrum = visualizationGraph({ template: 'spectrum', width: 1920, height: 1080, fps: 24, color: '#ff0000', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2 })
  check('the spectrum is drawn as a picture of the whole sound', spectrum.includes('showspectrumpic=s=1280x720:mode=combined:color=green:saturation=1:scale=log:legend=0'), true)
  check('and it is not handed a colour it cannot use', spectrum.includes('colors=#ff0000'), false)
  // Its legend band occupies the right-hand edge, so with the default the picture does not reach its own
  // frame: measured, the right-hand column reads black with `legend=1` and 196 with `legend=0`.
  check('and it is told not to take the edge for a legend', spectrum.includes('legend=0'), true)
  check('and it is held like every other picture', spectrum.includes(',loop=loop=-1:size=1'), true)

  // The SCROLLING spectrum is the one that has to be told to slide, and the reason is the same kind: left on
  // its default it draws one column per emitted frame into a frame nothing fills, so its right-hand edge
  // stays black for the whole export — measured, a maximum luma of 16 there against 233 with `slide=scroll`.
  const scrolled = visualizationGraph({ template: 'spectrum-scroll', width: 1920, height: 1080, fps: 24, color: '#ff0000', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2 })
  check('the scrolling spectrum is told to slide, which is what fills its frame', scrolled.includes('slide=scroll'), true)
  // And the scrolling WAVEFORM is drawn on a smaller canvas than everything else, which is measured too: at
  // exactly 1280 wide with this app's own green, `showwaves` in `cline` mode draws a PURPLE line. It is drawn
  // as a FILL — `cline` is a centred line per sample, and with `draw=full` it inks the whole envelope, which is
  // what the still waveform's `showwavespic` draws, so the two agree. It was briefly `mode=line`, and the
  // measurement is why it is not: `line` covers about a FIFTH of what `cline` does at a 1080-row frame, so the
  // monitor showed a strip of sparse dashes.
  const scrollingWave = visualizationGraph({ template: 'waveform-scroll', width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2 })
  check('the scrolling waveform draws on its own, smaller canvas', scrollingWave.includes('showwaves=s=960x540:mode=cline:scale=lin:draw=full:split_channels=0:rate=30:colors=#9fbf9a'), true)
  check('and it is the filled drawing, not the lighter stroke', scrollingWave.includes('draw=full'), true)
  check('and a moving drawing is NOT held, because it moves', scrollingWave.includes('loop='), false)

  // A stitch draws the CONCATENATED stream it writes, named down to its index: `[0:a]` would stand
  // for every audio stream of the joined input, and the two halves of one split must be laid out the
  // same way or the waveform would be drawn from a stream the export does not carry.
  const stitched = visualizationGraph({ template: 'waveform', width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a:0'], background: '#000000', rate: 44100, channels: 1 })
  check('a stitch draws the concatenated stream itself', stitched.includes('[0:a:0]asplit=2[mixA][mixV]'), true)
  check('laid out at the rate the stitch writes rather than a fixed one', stitched.includes('aresample=44100:async=1,aformat=sample_fmts=fltp:channel_layouts=mono[aout]'), true)
}

console.log('\n== what a drawing sits on ==')
{
  // One answer from settings that have accumulated: the choice, or — for a job saved before the choice
  // existed — the flag that used to mean the same thing. The editor and the encoder ask this one function,
  // which is what keeps a selector and an export from disagreeing about an older job.
  const on = (preset: Partial<EncodingPreset>) => visualizationBackgroundKind(preset as EncodingPreset)
  check('a drawing that says nothing sits on its colour', on({}), 'colour')
  check('a job saved before the choice was one reads as over its still', on({ visualizationOnStill: true }), 'still')
  check('and one that says both takes the choice', on({ visualizationBackground: 'image', visualizationOnStill: true }), 'image')
  check('an uploaded image is a choice like any other', on({ visualizationBackground: 'image' }), 'image')
  check('and switching back to the still is not a flag any more', on({ visualizationBackground: 'still', visualizationOnStill: true }), 'still')

  // The still the editor looks at, built by the same module as the export so the two cannot drift.
  const wave = visualizationStillGraph({ template: 'waveform', width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000' })
  check('a waveform still is the whole file in one picture', wave.includes('showwavespic=s=1280x720:scale=lin:draw=full:split_channels=0:colors=#9fbf9a'), true)
  check('laid on the colour it was given', wave.includes('color=c=#000000:s=1920x1080:r=30[bg]'), true)
  check('drawn at the capped canvas and scaled up', wave.includes('scale=1920:1080:flags=lanczos[scaled]'), true)
  check('and flattened into one picture', wave.includes('[plate]format=yuv420p[out]'), true)
  check('with the drawing and the plate brought together first', wave.includes('[bg][scaled]overlay=shortest=1[plate]'), true)
  // The still shows the bar PINNED AT THE LEFT rather than guessing at a moment: the sweep is what playback
  // does, and the still's job is to show that the design has a bar in it.
  const sweptStill = visualizationStillGraph({ template: 'waveform', width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', progressLine: true })
  check('a still asked for a progress line shows the bar', sweptStill.includes(`color=c=${VISUALIZATION_PROGRESS_COLOR}:s=`), true)
  check('pinned at the left, because a still is not a moment of playback', sweptStill.includes(`[plate][bar]overlay=x='0':y=0,format=yuv420p[out]`), true)
  // The line is a per-job choice with ON as the default: a job saved before it existed says nothing about it
  // and gets one, and only an explicit off turns it off. The bar is a share of the frame's height, so it reads
  // the same at any output size, and never disappears on a tiny frame.
  check('a job that says nothing about the line gets one', visualizationProgressLine({} as EncodingPreset), true)
  check('and only an explicit off turns it off', visualizationProgressLine({ visualizationProgressLine: false } as EncodingPreset), false)
  check('the bar is a few pixels at 1080p', progressLineWidth(1080), 6)
  check('and wider at 4K, in proportion', progressLineWidth(2160), 13)
  check('never thinner than two pixels, even on a tiny frame', progressLineWidth(10) >= 2, true)
  const spec = visualizationStillGraph({ template: 'spectrum', width: 1080, height: 1920, fps: 25, color: '#ffffff', sources: ['0:a', '1:a'], background: { input: 1 } })
  check('a spectrum still is the whole sound in one picture too', spec.includes('showspectrumpic=s=720x1280:mode=combined:color=green:saturation=1:scale=log:legend=0'), true)
  check('and the still has no loop, because a still is one frame', spec.includes('loop='), false)
  check('several sources are summed before it', spec.includes('[0:a][1:a]amix=inputs=2:normalize=0'), true)
  check('and an uploaded image is the background by input', spec.includes('[1:v]scale=1080:1920,setsar=1[bg]'), true)

  // The template table, which is what keeps "the editor offers a colour" and "the encoder is given one" from
  // disagreeing: the two spectra colour themselves by intensity and take no colour of their own.
  check('the waveform is what a job gets unless it asks for something else', templateFor(undefined).id, 'waveform')
  check('the two pictures come first, then the eight that move', VISUALIZATIONS.map((template) => template.kind), ['picture', 'picture', 'moving', 'moving', 'moving', 'moving', 'moving', 'moving', 'moving', 'moving'])
  check('the colour field is offered exactly where a colour does something', VISUALIZATIONS.map((template) => template.colour), [true, false, true, true, true, true, true, false, true, false])
  check('and the bar drawings are the five that share their knobs', VISUALIZATIONS.filter((template) => isBarsTemplate(template.id)).map((template) => template.id), ['eq', 'mirrored-bars', 'led-eq', 'matrix-panel', 'peak-pills'])
  check('of which two are mirrored — the bars, and the panel\u2019s active layer', VISUALIZATIONS.filter((template) => isMirroredTemplate(template.id)).map((template) => template.id), ['mirrored-bars', 'matrix-panel'])
  check('and a newly saved name resolves rather than crashing', templateFor('led-eq').id, 'led-eq')
  check('the two waveforms are a pair too', VISUALIZATIONS.filter((template) => isWaveTemplate(template.id)).map((template) => template.id), ['waveform', 'waveform-scroll'])
  check('and the two spectra', VISUALIZATIONS.filter((template) => isSpectrumTemplate(template.id)).map((template) => template.id), ['spectrum', 'spectrum-scroll'])
  check('a job saved with a template that is still there keeps it', templateFor('spectrum-scroll').id, 'spectrum-scroll')
  check('and one naming nothing falls back rather than crashing', templateFor(undefined).id, 'waveform')

  // How long a drawing is given to fill first. A PICTURE is the whole sound already and is taken at once; a
  // drawing that MOVES is BLACK at t=0, because its canvas fills as it scrolls, so its sample has to be taken
  // somewhere the window is populated — a couple of seconds in, or the window's own fill time where that is
  // longer, and never past the middle of the sound.
  check('a waveform picture is taken at once, with no warm-up', stillWarmupSeconds('waveform', 4, 1280, 30), 0)
  check('nor does a spectrum picture need one', stillWarmupSeconds('spectrum', 4, 1280, 30), 0)
  check('a scrolling waveform is sampled away from its empty first frame', stillWarmupSeconds('waveform-scroll', 4, 960, 30), 2)
  check('the bars too', stillWarmupSeconds('eq', 4, 1280, 30), 2)
  check('and the mirrored bars', stillWarmupSeconds('mirrored-bars', 4, 1280, 30), 2)
  check('and the scope, which has no trace at all at t=0', stillWarmupSeconds('scope', 4, 1280, 30), 2)
  check('a scrolling spectrum waits for its window to fill', stillWarmupSeconds('spectrum-scroll', 5, 1280, 30), 2.5)
  check('but never past the middle of the sound', stillWarmupSeconds('waveform-scroll', 3, 960, 30), 1.5)
  check('and a one-second one is sampled at its own middle, its window never filling', stillWarmupSeconds('spectrum-scroll', 1, 1280, 30), 0.5)
  check('a long scrolling spectrum is sampled at its middle rather than made to wait a minute', stillWarmupSeconds('spectrum-scroll', 60, 1280, 30), 30)
  check('while a long scrolling waveform is not made to wait at all', stillWarmupSeconds('waveform-scroll', 60, 960, 30), 2)
  check('and a sound with no length has no frame to ask for', stillWarmupSeconds('eq', 0, 1280, 30), 0)
  check('the debounce is the 150ms the editor was asked for', DRAWING_STILL_SETTLE_MS, 150)

  // The canvas each template is drawn on. The scrolling waveform's cap is lower than the rest, and it is a
  // measurement: at exactly 1280 wide that filter draws the wrong colour.
  check('every template but one is capped at the same edge', templateMaxEdge('waveform'), DRAWING_MAX_EDGE)
  check('the scrolling waveform is capped lower', templateMaxEdge('waveform-scroll'), SCROLLING_WAVEFORM_MAX_EDGE)
  check('a 16:9 frame draws at the scrolling waveform\u2019s own size', drawingCanvas(1920, 1080, templateMaxEdge('waveform-scroll')), { width: 960, height: 540 })
  check('and at the shared size for everything else', drawingCanvas(1920, 1080, templateMaxEdge('spectrum')), { width: 1280, height: 720 })
}

console.log('\n== the EQ drawing\u2019s own knobs ==')
{
  // `showfreqs` has no bar count, no thickness and no gap: its bars are one output column each, so the count
  // IS the width. The knobs are therefore made out of what it does have — the size it is drawn at and a
  // nearest-neighbour stretch — while the filter's own four options are passed straight through.
  const settings = { template: 'eq' as const, width: 1920, height: 1080, fps: 30, color: '#ffffff', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2 }
  const eq = visualizationGraph({ ...settings, eq: DEFAULT_EQ_STYLE })
  check('an EQ drawing is made one pixel per bar, at the frame\u2019s own height', eq.includes(`showfreqs=s=${EQ_DEFAULT_BARS}x1080:mode=bar`), true)
  check('and its amplitude scale is passed through', eq.includes('ascale=log'), true)
  check('and its frequency scale', eq.includes('fscale=lin'), true)
  check('and its sensitivity floor', eq.includes(`minamp=${EQ_MAX_SENSITIVITY}`), true)
  check('and its colour', eq.includes('colors=#ffffff'), true)
  check('and the bars are made chunky by a nearest-neighbour stretch', eq.includes('scale=1920:1080:flags=neighbor'), true)
  check('with no grid drawn when there is no gap', eq.includes('drawgrid'), false)

  const gapped = visualizationGraph({ ...settings, eq: { ...DEFAULT_EQ_STYLE, bars: 128, gap: 6 } })
  check('a bar count changes the width the drawing is made at', gapped.includes('showfreqs=s=128x1080:mode=bar'), true)
  check('and a gap lays a grid over the stretched bars', gapped.includes('drawgrid=x=0:y=99999:w=15:h=99999:t=6:c=black'), true)
  const shaped = visualizationGraph({ ...settings, eq: { ...DEFAULT_EQ_STYLE, amplitude: 'sqrt', frequency: 'rlog', sensitivity: 1e-7 } })
  check('the amplitude scale is the one asked for', shaped.includes('ascale=sqrt'), true)
  check('the frequency scale is the one asked for', shaped.includes('fscale=rlog'), true)
  check('and the sensitivity is the one asked for', shaped.includes('minamp=1e-7'), true)
  check('a template that is not the EQ is given none of it', visualizationGraph({ ...settings, template: 'waveform', eq: { ...DEFAULT_EQ_STYLE, bars: 8 } }).includes('showfreqs'), false)

  // The editor\u2019s still is built by the same builder with the same knobs, so a design judged in the monitor
  // is the one that is encoded — including the bar count and the gap, which are graph-level facts.
  const eqStill = visualizationStillGraph({ template: 'eq', width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', eq: { ...DEFAULT_EQ_STYLE, bars: 32, gap: 4 } })
  check('the still draws the same bars', eqStill.includes('showfreqs=s=32x1080:mode=bar'), true)
  check('and the same chunky stretch', eqStill.includes(',scale=1920:1080:flags=neighbor,pad=1920:1080:0:0:color=black'), true)
  check('and the same gap', eqStill.includes('drawgrid='), true)

  // The knobs, held to what the filter takes. One bar is not a spectrum and a thousand-pixel gap is nothing
  // but gap, and `minamp` has a ceiling of its own which is the least sensitive end of its range.
  const defaults = eqStyleOf({})
  check('a job that says nothing about the EQ gets the default density', defaults.bars, EQ_DEFAULT_BARS)
  check('and no gap', defaults.gap, 0)
  check('and ffmpeg\u2019s own floor', defaults.sensitivity, EQ_MAX_SENSITIVITY)
  check('a bar count is never below two', clampEqBars(1), EQ_MIN_BARS)
  check('nor above the range a stretch is worth', clampEqBars(100000), EQ_MAX_BARS)
  check('and nonsense falls back to the default', clampEqBars(undefined), EQ_DEFAULT_BARS)
  check('a gap is never negative', clampEqGap(-5), 0)
  check('nor wider than a bar is worth', clampEqGap(100000), EQ_MAX_GAP)
  check('sensitivity is never above ffmpeg\u2019s own floor', clampEqSensitivity(1), EQ_MAX_SENSITIVITY)
  check('and nonsense falls back to it too', clampEqSensitivity('nonsense'), EQ_MAX_SENSITIVITY)
  const spoken = eqStyleOf({ eqBars: 200, eqGap: 8, eqAmplitude: 'cbrt', eqFrequency: 'log', eqSensitivity: 1e-8 })
  check('a style says what the job said about the bars', spoken.bars, 200)
  check('and about the gap', spoken.gap, 8)
  check('and about the amplitude scale', spoken.amplitude, 'cbrt')
  check('and about the frequency scale', spoken.frequency, 'log')
  check('and about the sensitivity', spoken.sensitivity, 1e-8)
}

console.log('\n== the bar drawings\u2019 geometry, and the panel of lights ==')
{
  // Uneven bars and a gap that drifts off its bar are one arithmetic fault, and this is the whole of the fix:
  // `showfreqs` draws one bar per output column, so `frameWidth / bars` is a fractional bar and the remainder
  // lands unevenly on the last one. So the drawing is made at exactly `bars` pixels, stretched to a WHOLE
  // number of pixels per bar, and the strip that leaves over is centred on a black pad rather than stretched
  // across the frame — and the gap grid is then drawn from the PAD's own origin, so every gap lands on a bar
  // boundary and every bar is the same width, the last one included.
  const settings = { width: 1920, height: 1080, fps: 30, color: '#ffffff', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2 }
  // 1920 / 64 is exactly 30, so the strip is the frame and the pad has nothing to do.
  const exact = visualizationGraph({ ...settings, template: 'eq', eq: { ...DEFAULT_EQ_STYLE, bars: 64 } })
  check('a bar count that divides the frame needs no pad', exact.includes(',scale=1920:1080:flags=neighbor,pad=1920:1080:0:0:color=black'), true)
  check('and its bars are a whole number of pixels wide', Math.floor(1920 / 64) * 64 === 1920, true)
  // 1920 / 7 is not: 274 pixels per bar leaves two over, and the 1918-wide strip is centred.
  const odd = visualizationGraph({ ...settings, template: 'eq', eq: { ...DEFAULT_EQ_STYLE, bars: 7, gap: 6 } })
  check('a bar count that does not divide it is drawn at a whole number of pixels per bar', odd.includes(',scale=1918:1080:flags=neighbor'), true)
  check('and the strip that leaves over is centred on a black pad rather than stretched', odd.includes(',pad=1920:1080:1:0:color=black'), true)
  check('with the gap grid drawn from the pad, so the first gap is on the first bar\u2019s boundary', odd.includes('drawgrid=x=1:y=99999:w=274:h=99999:t=6:c=black'), true)
  // A gap is a share of a bar, so on a bar two pixels wide it is most of the bar and the drawing becomes a
  // comb. Past three pixels it is turned off rather than drawn.
  const dense = visualizationGraph({ ...settings, width: 1280, template: 'eq', eq: { ...DEFAULT_EQ_STYLE, bars: 512, gap: 8 } })
  check('a bar under three pixels wide drops its gap rather than becoming a comb', dense.includes('drawgrid'), false)
  check('which is what the three-pixel floor is for', EQ_MIN_BAR_PX, 3)
  check('and a bar of exactly three keeps it', visualizationGraph({ ...settings, width: 1536, template: 'eq', eq: { ...DEFAULT_EQ_STYLE, bars: 512, gap: 4 } }).includes('drawgrid'), true)

  // SEGMENTED is the same grid turned sideways: dividers across every bar, so each becomes a stack of blocks.
  // The divider height is a figure the frame divides EXACTLY into, because a grid aligned from an edge leaves
  // the far block cut off — and a cut-off top block is the first thing a reader would notice.
  const segmented = visualizationGraph({ ...settings, template: 'eq', eq: DEFAULT_EQ_STYLE, tune: { ...DEFAULT_TUNE, segmented: true } })
  check('a segmented drawing puts a divider across every block', segmented.includes(',drawgrid=x=99999:y=0:w=99999:h=8:t=1:c=black'), true)
  check('at a height the frame divides exactly into', 1080 / segmentHeight(1080), 135)
  check('and again at 720', 720 / segmentHeight(720), 90)
  check('and it is off unless it is asked for', visualizationGraph({ ...settings, template: 'eq', eq: DEFAULT_EQ_STYLE }).includes('drawgrid'), false)
}

console.log('\n== mirrored bars ==')
{
  // The mirror is two half-drawings rather than one, and that is arithmetic rather than taste: the bars are
  // made at HALF the frame's height, one copy is flipped, and the two are stacked about the centre line, so
  // the bars grow both ways from it. The pair is exactly symmetric, which is what the encoder harness reads
  // off a decoded frame — a vflip difference of nearly nothing against the plain drawing's large one.
  const settings = { width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2 }
  const mirrored = visualizationGraph({ ...settings, template: 'mirrored-bars', eq: DEFAULT_EQ_STYLE })
  check('a mirrored drawing is made at half the frame\u2019s height', mirrored.includes('showfreqs=s=64x540:mode=bar'), true)
  check('and stretched to the frame\u2019s full width', mirrored.includes(',scale=1920:540:flags=neighbor'), true)
  check('then stacked under its own reflection', mirrored.includes('split[halfAbove][halfBelow];[halfAbove]vflip[flipped];[flipped][halfBelow]vstack'), true)
  check('which makes up the frame\u2019s height again', mirrored.includes('vstack,pad=1920:1080:0:0:color=black[w]'), true)
  check('and two half-heights are the whole height', 2 * 540, 1080)
  // The editor's still is built by the same builder, so the two cannot be different drawings.
  const mirroredStill = visualizationStillGraph({ ...settings, template: 'mirrored-bars', sources: ['0:a'], eq: DEFAULT_EQ_STYLE })
  check('and the editor\u2019s still is the same two halves', mirroredStill.includes('[flipped][halfBelow]vstack,pad=1920:1080:0:0:color=black[scaled]'), true)
  // Everything the bars share, the mirror inherits — it is one geometry with the mirror applied to it.
  const mirroredKnobs = visualizationGraph({ ...settings, template: 'mirrored-bars', eq: { ...DEFAULT_EQ_STYLE, bars: 128, gap: 6 }, tune: { ...DEFAULT_TUNE, segmented: true } })
  check('the mirror inherits the bar count and the gap', mirroredKnobs.includes('showfreqs=s=128x540:mode=bar') && mirroredKnobs.includes('drawgrid=x=0:y=99999:w=15:h=99999:t=6:c=black'), true)
  check('and the segments too', mirroredKnobs.includes(',drawgrid=x=99999:y=0:w=99999:h=8:t=1:c=black'), true)
}

console.log('\n== the LED templates ==')
{
  // The three LED looks are the bars with different settings, so the assertions are about the two things they
  // add to the family: a PEAK HOLD, which is a split, a `lagfun` and a recombine; and MATRIX PANEL's lit field,
  // a source beneath the active layer. Neither may disturb a template that asks for neither, which is why the
  // plain bars are asserted alongside.
  const settings = { width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2 }
  const ledEq = { eq: eqStyleOf({ visualization: 'led-eq' }), tune: drawingTuneOf({ visualization: 'led-eq' }) }

  // A peak hold: the drawing forked, one fork lagged, the two recombined by lightening. Measured on the encoder
  // harness, the same loud-then-quiet sound reads its top band 16 (black) without the hold and 158 with it, and
  // the ghost then falls 158 to 132 to 103 across the quiet stretch.
  const held = visualizationGraph({ ...settings, template: 'led-eq', ...ledEq })
  check('the LED EQ opens at its own bar count', held.includes('showfreqs=s=16x1080:mode=bar'), true)
  check('a hold forks the drawing', held.includes('split[holdLive][holdGhostSrc]'), true)
  check('with one fork lagged, which is what holds a peak rather than losing it', held.includes('lagfun=decay=0.95'), true)
  check('and the two recombined by lightening, so the bar itself stays whole', held.includes('[holdLive][holdGhost]blend=all_mode=lighten'), true)
  // The LED EQ's own defaults, which is the whole of what makes it a different look from the plain bars.
  check('and is blocked and holding without being asked', [drawingTuneOf({ visualization: 'led-eq' }).segmented, drawingTuneOf({ visualization: 'led-eq' }).peakHold], [true, true])
  check('its hold is the ordinary decay', drawingTuneOf({ visualization: 'led-eq' }).peakDecay, EQ_DEFAULT_PEAK_DECAY)
  check('and it is NOT mirrored, unlike the bars beside it', isMirroredTemplate('led-eq'), false)
  // A hold nobody asked for is absent from the graph entirely, so the plain bars are byte for byte what they
  // were — which the geometry section above already asserts in full.
  check('a drawing with no hold has no lagfun in it', visualizationGraph({ ...settings, template: 'eq', eq: DEFAULT_EQ_STYLE, tune: DEFAULT_TUNE }).includes('lagfun'), false)
  // And a decay of zero turns a hold off even where it was switched on: a peak that falls instantly is no peak.
  const faded = drawingTuneOf({ visualization: 'led-eq', eqPeakDecay: 0 })
  check('a hold faded to nothing is off', [faded.peakHold, faded.peakDecay], [false, 0])
  check('so its graph has no lagfun either', visualizationGraph({ ...settings, template: 'led-eq', eq: eqStyleOf({ visualization: 'led-eq' }), tune: faded }).includes('lagfun'), false)
  // The decay is capped below one on purpose: a `lagfun` that never lets go would make the drawing an image
  // that only ever grows, which stops being a drawing of the sound at all.
  check('a decay is capped below one', clampPeakDecay(2), EQ_PEAK_DECAY_MAX)
  check('and nonsense falls back to the ordinary hold', clampPeakDecay('nonsense'), EQ_DEFAULT_PEAK_DECAY)

  // PEAK PILLS: the blocks with a wide divider and a slower fall, which is what tells it apart from the LED EQ.
  const pills = drawingTuneOf({ visualization: 'peak-pills' })
  check('the pills are the blocks with a wider divider', [pills.segmented, pills.segmentGap], [true, 3])
  check('and a slower hold than the LED EQ', [pills.peakDecay > EQ_DEFAULT_PEAK_DECAY, pills.peakDecay === EQ_PILL_PEAK_DECAY], [true, true])
  const pillGraph = visualizationGraph({ ...settings, template: 'peak-pills', eq: eqStyleOf({ visualization: 'peak-pills' }), tune: pills })
  check('so its divider is drawn several pixels thick', pillGraph.includes(`:h=${segmentHeight(1080)}:t=3:c=black`), true)
  check('and it is not mirrored either', pillGraph.includes('vstack'), false)
  check('a block gap is held between a hairline and half a block', [clampSegmentGap(0), clampSegmentGap(99)], [1, EQ_SEGMENT_GAP_MAX])

  // MATRIX PANEL: a lit field beneath the mirrored, blocked bars, the two merged by lightening. The field is a
  // SOURCE, because it is not derived from the sound at all — that is the whole difference between a panel and
  // a bar chart, and the reason it cannot be a suffix on the drawing's own chain.
  const panelEq = { ...eqStyleOf({ visualization: 'matrix-panel' }), gap: 6 }
  const panel = visualizationGraph({ ...settings, template: 'matrix-panel', eq: panelEq, tune: drawingTuneOf({ visualization: 'matrix-panel' }) })
  const panelChain = panel.split(';').find((chain) => chain.includes('[panel]')) ?? ''
  check('the panel lights its unlit cells from a source of its own', panel.includes(`color=c=${dimmedColour('#9fbf9a', MATRIX_DIM_SHARE)}:s=1920x1080:r=30`), true)
  check('built at the same bar geometry as the bars above it', panel.includes(',drawgrid=x=0:y=99999:w=80:h=99999:t=6:c=black'), true)
  check('and carrying the same block dividers', panel.includes(`:h=${segmentHeight(1080)}:t=1:c=black[panel]`), true)
  check('the active layer is the mirrored barred drawing', panel.includes('vstack'), true)
  check('merged with the panel by lightening, so a dark bar lets the field through', panel.includes('[panel][active]blend=all_mode=lighten'), true)
  check('bounded by the drawing, because the panel source itself never ends', panel.includes('shortest=1'), true)
  check('and the panel is not mirrored, because a field has no centre line', panelChain.includes('vstack'), false)
  check('the LED panel opens at more bars than the bar chart', eqStyleOf({ visualization: 'matrix-panel' }).bars > eqStyleOf({ visualization: 'led-eq' }).bars, true)
  // The dim is a share of whatever colour the drawing is made in, so the panel follows the theme and the
  // swatch rather than being a fixed grey.
  check('the dim follows the drawing\u2019s own colour', dimmedColour('#9fbf9a', MATRIX_DIM_SHARE), '#181d17')
  check('a short hex is read the same way', dimmedColour('#fff', 0.5), '#808080')
  check('and something unreadable dims to the one colour that cannot be wrong', dimmedColour('nonsense', 0.5), '#000000')
  check('so an amber panel is the amber, dimmed', visualizationGraph({ ...settings, color: '#c5b879', template: 'matrix-panel', eq: panelEq, tune: drawingTuneOf({ visualization: 'matrix-panel' }) }).includes(`color=c=${dimmedColour('#c5b879', MATRIX_DIM_SHARE)}`), true)

  // LABELS, only the LED EQ's, drawn after the blocks so they sit over them rather than under.
  const labelled = visualizationGraph({ ...settings, template: 'led-eq', eq: eqStyleOf({ visualization: 'led-eq' }), tune: drawingTuneOf({ visualization: 'led-eq', eqLabels: true }) })
  check('the LED EQ is offered its band labels', drawingTuneOf({ visualization: 'led-eq', eqLabels: true }).labels, true)
  check('and they are the seven a reader recognises', EQ_LABEL_FREQUENCIES, ['63', '160', '400', '1k', '2.5k', '6.3k', '16k'])
  check('drawn in a face that is legible and the drawing\u2019s own colour', labelled.includes('drawtext=font=Menlo:text=63'), true)
  check('and after the blocks, so they read over them', labelled.indexOf('drawgrid') < labelled.indexOf('drawtext'), true)
  check('while off unless asked for', drawingTuneOf({ visualization: 'led-eq' }).labels, false)
  check('and a template that is not the LED EQ is offered none', visualizationGraph({ ...settings, template: 'eq', eq: DEFAULT_EQ_STYLE, tune: drawingTuneOf({ visualization: 'eq', eqLabels: true }) }).includes('drawtext'), false)

  // The bar geometry the panel and the bars share, asserted directly as well as through the graphs.
  check('the geometry is the whole-pixel bar, the strip and the leftover', barsGeometry(1920, 7), { barPx: 274, strip: 1918, pad: 1 })
  check('and a count that divides the frame leaves nothing over', barsGeometry(1920, 64), { barPx: 30, strip: 1920, pad: 0 })

  // The defaults table: a template that declares none must resolve exactly as it always did, which is what keeps
  // every job saved before these three from being redrawn.
  check('a template that declares no defaults declares none', [VISUALIZATION_DEFAULTS.waveform, VISUALIZATION_DEFAULTS.eq, drawingDefaultsFor(undefined), drawingDefaultsFor('scope')], [{}, {}, {}, {}])
  check('the editor\u2019s still is built through the same chains', visualizationStillGraph({ ...settings, template: 'matrix-panel', sources: ['0:a'], eq: panelEq, tune: drawingTuneOf({ visualization: 'matrix-panel' }) }).includes('[panel][active]blend=all_mode=lighten:shortest=1'), true)
}

console.log('\n== the vector scope ==')
{
  // A scope plots one channel against the other, which is why its canvas is SQUARE — stretched to a 16:9
  // frame a circle would be an ellipse — and why a mono sound cannot be fed straight in. The pair is traced as
  // a LISSAJOUS, so the figure is a circle whose radius is the amplitude and sits ON the centre of the canvas;
  // the polar mode read the same pair as an angle and a distance and drew a fountain rising from the baseline.
  const settings = { width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2 }
  // The ring is what a scope draws UNLESS it is told otherwise, and that is the correction of a wrong guess: a
  // container's channel count is not its content, so a mono signal stored as stereo — the commonest case by
  // far — was fed straight in and drew a spoke. Measured on the encoder harness, that sound reaches one
  // column band of twenty as a spoke and fourteen as a ring.
  const scope = visualizationGraph({ ...settings, template: 'scope', tune: DEFAULT_TUNE })
  check('a scope draws a synthesised ring by default', scope.includes('aphaseshift=shift=0.25'), true)
  check('and the sound is mixed to ONE channel first, so the pair is built from the sound', scope.includes('[mixV]aformat=channel_layouts=mono,asplit=2[scopeQ1][scopeQ2]'), true)
  check('and one half is shifted a quarter of a cycle', scope.includes('[scopeQ2]aphaseshift=shift=0.25[scopeQ]'), true)
  check('and the halves are joined into a stereo pair, which is what opens it into a ring', scope.includes('[scopeI][scopeQ]join=inputs=2:channel_layout=stereo,avectorscope='), true)
  check('as a lissajous trace at the frame rate and draw mode', scope.includes('avectorscope=mode=lissajous:rate=30:draw=dot:zoom=1'), true)
  check('on a square canvas the frame short side gives it', scope.includes(':s=1080x1080'), true)
  check('padded either side, so a ring stays a ring', scope.includes(',pad=1920:1080:420:0:color=black[w]'), true)
  // Monochrome, then TINTED: a per-channel contrast cannot land on a colour — equal contrasts give a
  // near-neutral trace however bright they are set, which is why it read as white — so the filter draws a grey
  // trace and the tint multiplies that grey back up to the drawing's own colour.
  check('the trace is drawn monochrome rather than coloured by the filter', scope.includes('rc=255:gc=255:bc=255'), true)
  check('and its chroma is dropped before the tint', scope.includes(',format=gray,format=rgb24,lutrgb='), true)
  check('which multiplies the grey up to the drawing\u2019s own colour', scope.includes(scopeTintFilter('#9fbf9a')), true)
  check('the tint is the colour\u2019s own three channels, as shares', scopeTint('#9fbf9a'), { red: 159 / 255, green: 191 / 255, blue: 154 / 255 })
  check('so a custom colour tints the trace to itself', visualizationGraph({ ...settings, template: 'scope', color: '#ff0000', tune: DEFAULT_TUNE }).includes(scopeTintFilter('#ff0000')), true)
  check('while an unreadable colour falls back to the app\u2019s own green', scopeTint('nonsense'), scopeTint('#9fbf9a'))
  check('and faded by the inverse of the persistence', scope.includes('rf=128:gf=128:bf=128'), true)
  check('the default persistence is a short trail', scopeFade(SCOPE_DEFAULT_PERSIST), 128)
  check('dots by default, which is the cleaner of the two draws', drawingTuneOf({}).scopeDraw, 'dot')
  check('and a job that asks for a line gets one', drawingTuneOf({ scopeDraw: 'line' }).scopeDraw, 'line')
  check('with anything else settling for the default', drawingTuneOf({ scopeDraw: 'nonsense' as never }).scopeDraw, 'dot')
  check('full persistence is no fade at all, which is an endless trail', scopeFade(1), 0)
  check('and none is the shortest trail the filter has', scopeFade(0), 255)
  check('the square is the frame\u2019s short side', scopeSide({ width: 1920, height: 1080 }), 1080)
  check('a portrait frame is squared on its own short side', scopeSide({ width: 1080, height: 1920 }), 1080)
  check('and a 4K frame is still drawn at the cap, like every other drawing', scopeSide({ width: 3840, height: 2160 }), DRAWING_MAX_EDGE)
  // The quadrature is the drawing's own, so the export's audio is untouched by it.
  check('the quadrature is the drawing\u2019s own, so the export\u2019s audio is the untouched mix', scope.includes('[mixA]aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]'), true)
  // TRUE STEREO is the opt-in for genuinely wide music: the sound's own two channels, straight in.
  const wide = visualizationGraph({ ...settings, template: 'scope', tune: drawingTuneOf({ scopeTrueStereo: true }) })
  check('TRUE STEREO feeds the sound\u2019s own pair, with no quadrature in front of it', wide.includes('aphaseshift'), false)
  check('and no downmix either', wide.includes('aformat=channel_layouts=mono'), false)
  check('so the scope is handed the mix as it stands, and traced the same way', wide.includes('[mixV]avectorscope=mode=lissajous'), true)
  check('and it is off unless it is asked for', drawingTuneOf({}).trueStereo, false)
  check('the editor\u2019s still is opened out the same way', visualizationStillGraph({ ...settings, template: 'scope', sources: ['0:a'] }).includes('aphaseshift=shift=0.25'), true)
}

console.log('\n== the theme, and the knobs each template reads ==')
{
  // The palette is one answer the editor and the encoder both read, and it settles TWO things: the colour the
  // templates that take one are drawn in, and the monochrome ramp the two spectra colour themselves with.
  check('a job that names no theme gets the green', themeFor(undefined).id, 'green')
  check('and one naming amber gets the CRT amber', themeFor('amber').color, '#c5b879')
  check('the two ramps are single-hue, one per theme', DRAWING_THEMES.map((theme) => theme.ramp), ['green', 'fiery'])
  check('and neither of them is a rainbow', DRAWING_THEMES.some((theme) => theme.ramp.includes('rainbow')), false)
  check('the theme decides the colour where the job names none', drawingColorOf({ drawingTheme: 'amber' }), '#c5b879')
  check('and the job\u2019s own colour wins where it names one', drawingColorOf({ drawingTheme: 'amber', visualizationColor: '#ff0000' }), '#ff0000')
  const settings = { width: 1920, height: 1080, fps: 30, color: '#ffffff', sources: ['0:a'], background: '#000000', rate: 48000, channels: 2 }
  check('so an amber spectrum is drawn on the warm ramp', visualizationGraph({ ...settings, template: 'spectrum', sources: ['0:a'], tune: drawingTuneOf({ drawingTheme: 'amber' }) }).includes(':color=fiery:'), true)
  check('and a green one on the green', visualizationGraph({ ...settings, template: 'spectrum', sources: ['0:a'], tune: drawingTuneOf({}) }).includes(':color=green:'), true)

  // The waveform's own three: how the amplitude is scaled, how heavy the drawing is, and how many waveforms
  // it draws. The first two are the filter's own options; the third is a DOWNMIX, because both waveform filters
  // draw a channel per row and a stereo input fills the frame with two of them however `split_channels` is set.
  const twoWaves = visualizationGraph({ ...settings, template: 'waveform', sources: ['0:a'], tune: drawingTuneOf({ waveScale: 'log', waveWeight: 'line', waveChannels: 2 }) })
  check('the waveform\u2019s amplitude scale is passed through', twoWaves.includes('showwavespic=s=1280x720:scale=log'), true)
  check('and its weight is one of ffmpeg\u2019s two draw modes', twoWaves.includes('draw=scale'), true)
  check('two waveforms keep the sound\u2019s own pair and ask the filter to split it', twoWaves.includes('split_channels=1'), true)
  check('and nothing is mixed down for them', twoWaves.includes('aformat=channel_layouts=mono'), false)
  const oneWave = visualizationGraph({ ...settings, template: 'waveform', sources: ['0:a'], tune: drawingTuneOf({}) })
  check('ONE waveform — the default — mixes the sound down before the filter', oneWave.includes('[mixV]aformat=channel_layouts=mono,showwavespic='), true)
  check('and asks for no split, because there is nothing to split', oneWave.includes('split_channels=0'), true)
  check('and the scrolling one is given the same thing, so the two agree', visualizationGraph({ ...settings, template: 'waveform-scroll', sources: ['0:a'], tune: drawingTuneOf({}) }).includes('[mixV]aformat=channel_layouts=mono,showwaves='), true)
  check('two waveforms there too, where they are asked for', visualizationGraph({ ...settings, template: 'waveform-scroll', sources: ['0:a'], tune: drawingTuneOf({ waveChannels: 2 }) }).includes('split_channels=1'), true)
  check('the default weight is the filled draw', drawingTuneOf({}).waveWeight, 'fill')
  check('because the lighter one is what reads as a blank monitor on a 1080-row frame', drawingTuneOf({ waveWeight: 'line' }).waveWeight, 'line')
  check('and an amplitude scale the job says nothing about is linear', drawingTuneOf({}).waveScale, 'lin')
  check('and a job that says nothing draws ONE waveform', drawingTuneOf({}).waveChannels, 1)
  check('which is the default the table carries', WAVE_DEFAULT_CHANNELS, 1)
  check('and the downmix is the layout-agnostic one, so it is never told what it is handed', oneWave.includes(MONO_MIX), true)

  // And the colour, which is a LIST indexed by channel: a short list leaves the channels it does not cover
  // drawn in the filter's own default, which is how a stereo source came to be drawn in white. Measured, one
  // entry puts pure white in the frame and a full list puts the theme's green there and nothing else.
  const bars = visualizationGraph({ ...settings, template: 'eq', sources: ['0:a'], eq: DEFAULT_EQ_STYLE })
  check('the bars are given a colour PER CHANNEL, so none of them falls back to white', bars.includes(`colors=${colourList('#ffffff')}`), true)
  check('and that is more entries than a sound can have channels', colourList('#ffffff').split('|').length >= 6, true)
  check('which is eight entries, the widest layout ffmpeg names', colourList('#ffffff').split('|').length, 8)
  check('and all of them are the one colour', new Set(colourList('#9fbf9a').split('|')), new Set(['#9fbf9a']))
  check('the mirrored bars are given it too', visualizationGraph({ ...settings, template: 'mirrored-bars', sources: ['0:a'], eq: DEFAULT_EQ_STYLE }).includes(colourList('#ffffff')), true)

  // And the spectra's own two. `sat` is a multiplier rather than an on/off, and 0 is a grey ramp.
  const saturated = visualizationGraph({ ...settings, template: 'spectrum', sources: ['0:a'], tune: drawingTuneOf({ spectrumScale: 'cbrt', spectrumSaturation: 3 }) })
  check('the spectrum\u2019s own scale and saturation are passed through', saturated.includes('saturation=3:scale=cbrt'), true)
  check('a saturation past what the filter takes is held to it', clampSaturation(99), 10)
  check('and one below it likewise', clampSaturation(-99), 0)
  check('the scope\u2019s zoom is held between its own two ends', [clampScopeZoom(99), clampScopeZoom(0.05)], [10, 0.2])
  check('and a zoom of nothing means nothing, so it falls back rather than shrinking to a dot', clampScopeZoom(0), 1)
  check('and its persistence between none and all', [clampScopePersist(9), clampScopePersist(-9)], [1, 0])
  check('every knob has a default, so a job that says nothing about one still draws', Object.keys(DEFAULT_TUNE).length >= 10, true)
}

console.log('\n== the preview speed ==')
{
  // PREVIEW ONLY: this is the monitor\u2019s own playbackRate and a multiplier on the fallback clock. Nothing
  // here reaches ffmpeg — an export at an altered speed would be a different render, `setpts` and `atempo`.
  check('the speeds the monitor offers', PREVIEW_SPEEDS.join(','), '0.5,1,1.5,2,3,4,8')
  check('and it opens at ordinary speed', DEFAULT_PREVIEW_SPEED, 1)
  check('a speed that is not offered is answered with the ordinary one', clampPreviewSpeed(7), DEFAULT_PREVIEW_SPEED)
  check('and so is nonsense', clampPreviewSpeed('nonsense'), DEFAULT_PREVIEW_SPEED)
  check('an offered one is kept', clampPreviewSpeed(1.5), 1.5)
  // The element\u2019s rate is the shuttle and the speed composed, because the two are separate controls.
  check('at rest the element runs at the preview speed', playbackRateFor(0, 2), 2)
  check('a shuttle multiplies it', playbackRateFor(4, 2), 8)
  check('and the pair is capped at what an element will take', playbackRateFor(8, 3), 16)
  check('reverse is the element\u2019s own rate times the speed', playbackRateFor(-4, 2), 2)
  // The fallback clock runs at it too, or a preview would drop back to 1x for the length of a still.
  const quick = advanceClock(null, { from: 0, now: 1000, key: 'a', reverse: false, shuttleRate: 0, speed: 2 })
  const quicker = advanceClock(quick.anchor, { from: 0, now: 2000, key: 'a', reverse: false, shuttleRate: 0, speed: 2 })
  near('a 2x preview advances 2s per second over a still', quicker.value, 2)
  const slow = advanceClock(null, { from: 0, now: 1000, key: 'a', reverse: false, shuttleRate: 0, speed: 0.5 })
  const slower = advanceClock(slow.anchor, { from: 0, now: 2000, key: 'a', reverse: false, shuttleRate: 0, speed: 0.5 })
  near('and a 0.5x one advances half of one', slower.value, 0.5)
  const both = advanceClock(null, { from: 0, now: 1000, key: 'a', reverse: false, shuttleRate: 2, speed: 2 })
  const bothAfter = advanceClock(both.anchor, { from: 0, now: 2000, key: 'a', reverse: false, shuttleRate: 2, speed: 2 })
  near('a shuttle and a speed compose', bothAfter.value, 4)

  // The WHEEL over the monitor climbs the same ladder the selector offers, one rung per tick either way, and
  // it STOPS at the ends rather than wrapping: a wheel that jumped from 4x back to 0.5x would change something
  // the reader did not ask for at the moment they asked for nothing more.
  check('a wheel up climbs one rung', steppedPreviewSpeed(1, 1), 1.5)
  check('and again, all the way to the top', [1, 1.5, 2, 3, 4, 8].map((rate) => steppedPreviewSpeed(rate, 1)), [1.5, 2, 3, 4, 8, 8])
  check('a wheel down drops one rung', steppedPreviewSpeed(2, -1), 1.5)
  check('and again, all the way to the bottom', [8, 4, 3, 2, 1.5, 1].map((rate) => steppedPreviewSpeed(rate, -1)), [4, 3, 2, 1.5, 1, 0.5])
  check('and the bottom is the bottom rather than a wrap', steppedPreviewSpeed(0.5, -1), 0.5)
  check('a speed the list does not carry is stepped from the ordinary one', steppedPreviewSpeed(7, 1), 1.5)

  // The pitch rule, which is stated once because the element’s property is the INVERSE of the phrase. A steady
  // speed keeps its pitch — the same voice at a different tempo — and so now does a fast-forward: the raised
  // pitch a tape transport would give it read as a fault across the whole of a shuttle, so every forward rate
  // is pitch-corrected and the one constant above is the whole of the rule.
  check('a steady speed keeps its pitch', preservesPitchFor(0), true)
  check('and so does a 2x preview, which is a viewing speed rather than a shuttle', [playbackRateFor(0, 2), preservesPitchFor(0)], [2, true])
  check('a shuttle at ordinary speed keeps it', preservesPitchFor(1), true)
  check('a fast-forward keeps it too, rather than raising it', preservesPitchFor(2), true)
  check('and so does the top of the ladder', preservesPitchFor(8), true)
  check('every forward rate is pitch-corrected alike', [1, 2, 4, 8].map(preservesPitchFor), [true, true, true, true])
  check('reverse keeps the property, but it is paused rather than played so nothing is heard', preservesPitchFor(-4), true)
}

console.log('\n== what a sound is, and what the export will make of it ==')
{
  // The facts are read off a probe, and every part of them is optional because ffprobe genuinely does not know
  // some of them: a lossy file has no sample size at all, and a great many wavs name no channel layout. An
  // absent figure is left OUT of the line rather than shown as a zero, which would be a claim about the file
  // rather than a gap in it. The figures these cases are built from are ones this machine's ffprobe answers —
  // measured on a 16-bit wav, a 24-bit one, a 5.1 one, an mp3, a FLAC and an AAC.
  const sound = (stream: Partial<MediaStreamInfo>): MediaProbeInfo => ({
    format: 'wav', duration: 5, size: 0, bitrate: 0, videoStreams: [], audioStreams: [{ codec: 'pcm_s16le', ...stream }],
  })
  const silent: MediaProbeInfo = { format: 'png', duration: 0, size: 0, bitrate: 0, videoStreams: [], audioStreams: [] }

  check('a 16-bit stereo wav reads as its rate, its sample size and its layout', audioFacts(sound({ channels: 2, sampleRate: 48000, bitDepth: 16 })), '48 KHZ | 16 BIT | STEREO')
  check('a 24-bit one at 44.1 reads as that', audioFacts(sound({ channels: 2, sampleRate: 44100, bitDepth: 24 })), '44.1 KHZ | 24 BIT | STEREO')
  check('a file that names its layout is believed over its count', audioFacts(sound({ channels: 6, sampleRate: 48000, bitDepth: 16, channelLayout: '5.1' })), '48 KHZ | 16 BIT | 5.1')
  check('and one that names none has its count spoken for it', audioFacts(sound({ channels: 6, sampleRate: 48000 })), '48 KHZ | 6 CH')
  // A lossy file has no sample size, and the line leaves it out rather than claiming zero bits of one.
  check('a lossy file loses the part the container does not carry', audioFacts(sound({ codec: 'mp3', channels: 2, sampleRate: 48000 })), '48 KHZ | STEREO')
  check('and its codec and bitrate read on their own line', audioCodecFacts(sound({ codec: 'mp3', channels: 2, bitrate: '320k' })), 'MP3 | 320K')
  check('one and two channels are spelled out rather than counted', [channelFacts({ codec: 'x', channels: 1 }), channelFacts({ codec: 'x', channels: 2 })], ['MONO', 'STEREO'])
  check('and a rate reads in kHz without a trailing zero', [kilohertz(48000), kilohertz(44100)], ['48', '44.1'])
  check('a source with no sound in it has no facts to show', [audioFacts(silent), audioCodecFacts(silent), probeHasAudio(silent)], [null, null, false])
  check('which is how a caller knows not to offer a sound control', probeHasAudio(sound({ channels: 2 })), true)
  check('a probe that never arrived says nothing rather than guessing', audioFacts(undefined), null)

  // THE PICTURE has a line of its own, the mirror of the sound's: the container is the FORMAT row and the
  // samples are the DEPTH row, so neither says how the picture is WRITTEN — which is why the inspector could
  // show `AUDIO CODEC` and nothing at all for the video.
  const picture = (stream: Partial<MediaStreamInfo>): MediaProbeInfo => ({
    format: 'mov', duration: 5, size: 0, bitrate: 0, audioStreams: [], videoStreams: [{ codec: 'h264', ...stream }],
  })
  check('a picture\u2019s codec reads on its own line', videoCodecFacts(picture({})), 'H264')
  check('and its bitrate beside it where the container records one', videoCodecFacts(picture({ codec: 'prores', bitrate: '12500k' })), 'PRORES | 12500K')
  check('while a stream with no bitrate leaves it out rather than claiming zero', videoCodecFacts(picture({ codec: 'vp9' })), 'VP9')
  check('a source with no picture in it has no facts to show', videoCodecFacts(silent), null)
  check('and a probe that never arrived says nothing either', videoCodecFacts(undefined), null)

  // The output channel count, which is a CHOICE rather than a fact, and which stores nothing at all for SOURCE:
  // every path that owns the output layout has an answer of its own — a stitch follows the widest source it was
  // given — and a stereo written here would override that answer with a figure nobody chose.
  check('the layouts the editor offers', AUDIO_CHANNELS.map((option) => option.name), ['SOURCE', 'MONO', 'STEREO', '5.1'])
  check('a preset that says nothing asks for nothing', outputChannels({}), undefined)
  check('and one asking for mono gets one', outputChannels({ audioChannels: 1 }), 1)
  check('and for stereo, two', [outputChannels({ audioChannels: 2 }), channelLayoutFor(2)], [2, 'stereo'])
  check('a mono layout is named for the graph', channelLayoutFor(1), 'mono')
  // 5.1 is six channels under ffmpeg's own layout name, and the name is what the drawing's `aformat` takes.
  check('and 5.1 is six channels under its own name', [outputChannels({ audioChannels: 6 }), channelLayoutFor(6)], [6, '5.1'])
  check('a figure that is not on the list falls back to SOURCE rather than to two', clampAudioChannels(5), 0)
  check('as does nonsense', clampAudioChannels('nonsense'), 0)
  check('and the figures that are on it are kept', [clampAudioChannels(1), clampAudioChannels(2), clampAudioChannels(6)], [1, 2, 6])
  // MP3 IS THE ONE CODEC THAT REFUSES 5.1 — MEASURED: "Specified channel layout '5.1' is not supported by the
  // libmp3lame encoder" — so it is left off that codec's list, and a stored 5.1 falls back to the path's own
  // answer rather than being handed to a muxer that would refuse the file. AAC, PCM, FLAC, Opus and Vorbis all
  // write six, so they keep it.
  check('5.1 is offered for the codecs that carry it', audioChannelsFor('aac').map((option) => option.value), [0, 1, 2, 6])
  check('and refused for the one that does not', audioChannelsFor('mp3').map((option) => option.value), [0, 1, 2])
  check('so a stored 5.1 is written on a codec that carries it', resolvedAudioChannels({ audioChannels: 6, audioCodec: 'aac' }), 6)
  check('and held back on the one that does not', resolvedAudioChannels({ audioChannels: 6, audioCodec: 'mp3' }), undefined)
  check('while a stereo is written wherever it is asked for', resolvedAudioChannels({ audioChannels: 2, audioCodec: 'mp3' }), 2)
}

console.log('\n== how several audio lanes are laid out ==')
{
  // MEASURED, by muxing two `-map`ped audio streams into each container and reading the count back: these
  // five hold both, and wav, flac and mp3 refuse a second outright — "Nothing was written into output file,
  // because at least one of its streams received no packets".
  check('a container with room holds the lanes apart', ['mp4', 'mov', 'mkv', 'webm', 'm4a'].map((container) => containerHoldsStreams(container as EncodingPreset['container'])), [true, true, true, true, true])
  check('and one that holds a single track does not', ['wav', 'flac', 'mp3'].map((container) => containerHoldsStreams(container as EncodingPreset['container'])), [false, false, false])
  check('nor do the picture and frame containers', (['png', 'jpg', 'gif'] as const).some((container) => containerHoldsStreams(container)), false)

  const mkv = { container: 'mkv' as const }
  check('a job that says nothing keeps the lanes apart', resolvedAudioLayout(mkv), 'separate')
  check('an explicit MIXDOWN is honoured', resolvedAudioLayout({ ...mkv, audioLayout: 'mixdown' as const }), 'mixdown')
  check('and an explicit SEPARATE where the container can hold it', resolvedAudioLayout({ ...mkv, audioLayout: 'separate' as const }), 'separate')
  // THE FIX: a container that holds ONE track sums the lanes rather than being handed a second stream it
  // refuses — which is what turned a multi-track export to a wav into a failed job.
  check('a wav sums even when the job said nothing', resolvedAudioLayout({ container: 'wav' }), 'mixdown')
  check('and sums even when the job asked for SEPARATE', resolvedAudioLayout({ container: 'wav', audioLayout: 'separate' }), 'mixdown')
  // A MIXDOWN is honoured in a container that could hold the lanes apart: the container is a limit, not an override.
  check('while a MIXDOWN in a roomy container is still a mixdown', resolvedAudioLayout({ container: 'mkv', audioLayout: 'mixdown' }), 'mixdown')

  check('both layouts are offered', AUDIO_LAYOUTS.map((entry) => entry.value), ['separate', 'mixdown'])
  check('a job with nothing to refuse shows what it will write', audioLayoutState(mkv, { sequenced: false, drawing: false }), { value: 'separate', locked: false, separateBlocked: null, reason: null })
  check('a SEQUENCED set is locked, because it is one stream already', audioLayoutState(mkv, { sequenced: true, drawing: false }), { value: 'mixdown', locked: true, separateBlocked: 'THE TRACKS ARE SEQUENCED, SO THEY ALREADY FORM ONE STREAM.', reason: 'sequenced' })
  check('a DRAWING is locked too, because it builds its own mix', audioLayoutState(mkv, { sequenced: false, drawing: true }), { value: 'mixdown', locked: true, separateBlocked: 'A DRAWING SUMMS THE LANES ITSELF.', reason: 'drawing' })
  check('and a one-track container offers no SEPARATE, naming the format', audioLayoutState({ container: 'mp3' }, { sequenced: false, drawing: false }), { value: 'mixdown', locked: false, separateBlocked: 'THIS FORMAT CARRIES ONE AUDIO TRACK.', reason: 'format' })

  // THE CLIPPING GUARD is offered wherever the lanes are really SUMMED. An unlocked MIXDOWN is the encoder's own
  // `amix`; a DRAWING sums through its own graph, which the guard is wired into too. A SEPARATE layout adds
  // nothing to anything, and a SEQUENCED set is CONCATENATED — one lane after another, never together — so
  // neither has a sum for a guard to catch.
  check('a raw mixdown has something to guard', sumsAudioLanes({ value: 'mixdown', reason: null }), true)
  check('and a drawing does too, summing in its own graph', sumsAudioLanes({ value: 'mixdown', reason: 'drawing' }), true)
  check('and a one-track container, whose lanes are summed for it', sumsAudioLanes({ value: 'mixdown', reason: 'format' }), true)
  check('but a separate layout adds nothing to anything', sumsAudioLanes({ value: 'separate', reason: null }), false)
  check('and a sequenced set is concatenated rather than summed', sumsAudioLanes({ value: 'mixdown', reason: 'sequenced' }), false)
  // The guard's filter, spelled out: `level=disabled` so it never re-levels a mix that is already inside the
  // scale, `limit=1.0` for full scale, and `latency=1` so the limiter's own lookahead does not drift the
  // soundtrack away from its picture (measured at 5 ms without it).
  check('the guard is a limiter that neither re-levels nor delays', CLIPPING_GUARD_FILTER, 'alimiter=level=disabled:limit=1.0:latency=1')
}

console.log('\n== whether an export draws its own sound ==')
{
  const preset = { id: 'p', name: 'P', container: 'mp4' as const, videoCodec: 'h264' as const, audioCodec: 'aac' as const, resolution: 'source' as const }
  const job = (task: Partial<QueueTask>) => drawingPictureFor({
    id: 'v', type: 'transcode', status: 'pending', progress: 0, sourcePaths: [],
    outputDirectory: '/tmp', outputFilename: 'o.mp4', preset, ...task,
  } as QueueTask)
  const drawing = { ...preset, audioPicture: 'visualization' as const }

  const sound = job({ sourcePaths: ['/tmp/a.wav'], preset: drawing })
  check('a job of sound asked for a drawing draws one', sound.draws, true)
  check('from its own sound', sound.sources, ['/tmp/a.wav'])
  check('and it is offered a picture at all', job({ sourcePaths: ['/tmp/a.wav'] }).offersPicture, true)
  check('a job left alone draws nothing', job({ sourcePaths: ['/tmp/a.wav'] }).draws, false)
  check('a job with footage keeps its own picture', job({ sourcePaths: ['/tmp/a.mp4'], preset: drawing }).offersPicture, false)
  check('and so is not drawn for', job({ sourcePaths: ['/tmp/a.mp4'], preset: drawing }).draws, false)
  check('a container that cannot hold a picture is not offered one', job({ sourcePaths: ['/tmp/a.wav'], preset: { ...preset, container: 'wav', audioCodec: 'pcm' } }).offersPicture, false)

  // A still under a track: the track is what is drawn and the still is what it sits on.
  const covered = job({ sourcePaths: ['/tmp/cover.png'], additionalAudioTracks: [{ id: 't', path: '/tmp/b.wav', language: 'und' }], preset: drawing })
  check('a still under a track draws the track', covered.sources, ['/tmp/b.wav'])
  check('and the still is the picture it could sit on', covered.still, '/tmp/cover.png')
  check('with no still, there is none to sit on', sound.still, null)

  // The same file can be two places in a job — the main lane and an added track — and it is drawn from once.
  const twice = job({ sourcePaths: ['/tmp/a.wav'], additionalAudioTracks: [{ id: 't', path: '/tmp/a.wav', language: 'und' }], preset: drawing })
  check('a file that is in the job twice is drawn from once', twice.sources, ['/tmp/a.wav'])
  // The order is the export's: the main lane's own sound first, then the added tracks.
  const many = job({ sourcePaths: ['/tmp/a.wav'], additionalAudioTracks: [{ id: 't1', path: '/tmp/b.wav', language: 'und' }, { id: 't2', path: '/tmp/c.wav', language: 'und' }], preset: drawing })
  check('and the tracks follow it, in the order they are carried', many.sources, ['/tmp/a.wav', '/tmp/b.wav', '/tmp/c.wav'])
  check('an audio-only export is not offered a picture', job({ sourcePaths: ['/tmp/a.wav'], preset: { ...preset, outputMode: 'audio' } }).offersPicture, false)
}

console.log('\n== what a container can carry ==')
{
  // The gate the encoder and the editor both ask. A fact about the CONTAINER rather than about any other
  // field on the preset: a WAV asked for video is still a WAV, so the answer cannot be read off a codec.
  const carries = (...names: Array<EncodingPreset['container']>) => names.map(outputCarriesPicture)
  const takesArt = (...names: Array<EncodingPreset['container']>) => names.map(outputTakesArt)
  check('a movie container carries a picture', carries('mp4', 'mov', 'mkv', 'webm'), [true, true, true, true])
  check('an image container carries one too', carries('png', 'jpg', 'gif'), [true, true, true])
  check('an artwork-capable sound container carries none', carries('mp3', 'm4a', 'flac'), [false, false, false])
  check('and a wav carries none either', outputCarriesPicture('wav'), false)
  check('but it takes no artwork', outputTakesArt('wav'), false)
  check('while the ones that do are named', takesArt('mp3', 'm4a', 'flac'), [true, true, true])
  check('and a wav is a sound kind and nothing more', outputKind('wav'), 'sound')
  check('a container the app does not offer is not assumed to carry a picture', outputCarriesPicture('ogg' as EncodingPreset['container']), false)
}

console.log('\n== what a custom preset will actually produce ==')
{
  // Read only when the preset has stopped being the preset it started from, which is the one case a
  // name says nothing about the output. Every figure comes from the preset alone, and one it does not
  // carry is named as the source's rather than guessed at.
  const preset = (over: Partial<EncodingPreset> = {}): EncodingPreset => ({
    id: 'p', name: 'CUSTOM', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source',
    ...over,
  } as EncodingPreset)
  check('a video preset names its container and codec', presetSummary(preset())[0], 'MP4 // H264')
  check('and says the frame follows the source while it does', presetSummary(preset())[1], 'SOURCE SIZE // SOURCE FPS')
  check('an exact size is shown as the figure it is', presetSummary(preset({ width: 1920, height: 1080, fps: 30 }))[1], '1920x1080 // 30 FPS')
  const cropped = presetSummary(preset({ crop: { left: 0.1, top: 0, right: 0, bottom: 0 } }))
  check('a cropped source says so rather than showing the figures', cropped.includes('SOURCE CROPPED'), true)
  check('a bitrate is the quality line', presetSummary(preset({ videoBitrate: '8M' })).some((line) => line === 'QUALITY 8M'), true)
  check('a copied stream has no quality to name', presetSummary(preset({ videoCodec: 'copy' })).includes('QUALITY COPIED'), true)
  check('and a sound-only container says it has no picture', presetSummary(preset({ container: 'mp3', videoCodec: 'copy' }))[0], 'MP3 // NO PICTURE')
  check('an audio-only export says so too', presetSummary(preset({ outputMode: 'audio' }))[0], 'MP4 // NO PICTURE')
  check('a dropped audio track is said outright', presetSummary(preset({ audioEnabled: false })).includes('AUDIO DROPPED'), true)
  check('and an audio bitrate rides with the codec', presetSummary(preset({ audioBitrate: '320k' })).some((line) => line === 'AUDIO AAC 320K'), true)
  check('a still frame is named before the container', presetSummary(preset({ imageOutputMode: 'still' }))[0], 'SINGLE FRAME')
  check('and a sequence likewise', presetSummary(preset({ imageOutputMode: 'sequence' }))[0], 'IMAGE SEQUENCE')
}

console.log('\n== the timeline scale ==')
{
  const span = 137.5
  const stepAt = (zoom: number) => rulerSteps(zoom).step
  // The step follows the ZOOM, which is what makes the scale read the same at every zoom: zooming in
  // puts marks between the ones that were there, and zooming out takes them away again.
  check('the scale subdivides as the zoom goes in', stepAt(8) < stepAt(1), true)
  check('and coarsens as it comes out', stepAt(1) < stepAt(0.2), true)
  check('and the labelled step is always a rung of the ladder', [0.2, 1, 4, 16, 32].every((zoom) => RULER_STEPS.includes(rulerSteps(zoom).major)), true)
  // Half an hour of lane at the closest zoom is an enormous drawing, and the scale is drawn only where
  // it is being looked at — which is what lets it stay fine without being tens of thousands of marks.
  const drawn = rulerTicks(1800, 32, { from: 0, to: secondsAt(1350, 32) })
  check('only the visible stretch of a long scale is drawn', drawn.length <= 200, true)
  check('and that stretch is covered by it', drawn[0].time <= 0 && drawn[drawn.length - 1].time >= secondsAt(1350, 32), true)
  // The end of the output is NOT a mark: it is right-aligned inside the scale, so it lands on top of the
  // mark before it, and the live readout in the gutter is what says where the output ends.
  const whole = rulerTicks(span, 1)
  check('the end of the output is not a mark', whole.every((tick) => tick.time < span), true)
  check('and the scale still reaches up to it', span - whole[whole.length - 1].time < rulerSteps(1).step, true)
  check('and nothing is drawn past the end', whole.every((tick) => tick.time <= span + 1e-9), true)
  // Where a frame can be seen, a mark IS a frame — which is what makes one arrow press land on one mark
  // rather than between two of them. The arrow step is a frame, so the two are the same unit.
  check('at a close zoom a mark is a frame apart', rulerSteps(32, 25).step, 1 / 25)
  check('and one frame is exactly one mark', rulerSteps(32, 25).step * 25, 1)
  check('and its labels stand several frames apart', rulerSteps(32, 25).divisor > 1, true)
  // A mark stands where the time it names stands, which is what lets it be placed by time alone.
  const at = rulerTicks(60, 4)
  check('every mark is a whole number of steps from the start', at.every((tick, index) => Math.abs(tick.time - index * rulerSteps(4).step) < 1e-9), true)
  // A wheel notch is gentle, eased, and finer than a magnifier press, because a wheel arrives in dozens.
  check('a notch magnifies in', zoomedBy(2, -100) > 2, true)
  check('and out', zoomedBy(2, 100) < 2, true)
  check('and a wheel that did not move changes nothing', zoomedBy(2, 0), 2)
  check('a notch is a gentle step', zoomedBy(1, -100) < 1.1, true)
  check('and a faster flick travels further', zoomedBy(1, -400) > zoomedBy(1, -100), true)
  check('and neither can leave the range', [zoomedBy(ZOOM_MAX, -100), zoomedBy(ZOOM_MIN, 100)], [ZOOM_MAX, ZOOM_MIN])
}

console.log('\n== what a clip says it is ==')
{
  // The figures the request gave, spelled the way it asked for them: the whole source, what the output
  // takes from it, and the range it takes it from. The same shape for a picture and for a track,
  // because it is the same question — a track's frames are counted at the project's rate, which is the
  // only rate a track has and the rate the output is written at.
  const frames = { fps: 30, mode: 'framestamp' as const }
  check('a trimmed clip in frames',
    clipSummary({ ...frames, totalSeconds: 4306 / 30, usedSeconds: 2160 / 30, sourceIn: 0, trimmed: true }),
    '4306 frames at 30 fps | 2160 trimmed frames [0000-2160]')
  check('an untrimmed clip in frames',
    clipSummary({ ...frames, totalSeconds: 4306 / 30, usedSeconds: 4306 / 30, sourceIn: 0, trimmed: false }),
    '4306 frames at 30 fps | source')
  check('a trimmed clip in timecodes',
    clipSummary({ totalSeconds: 4306 / 30, usedSeconds: 72, sourceIn: 0, trimmed: true, fps: 30, mode: 'timestamp' }),
    '00:02:23.16 at 30 fps | 00:01:12.00 trimmed [00:00:00.00-00:01:12.00]')
  check('an untrimmed clip in timecodes',
    clipSummary({ totalSeconds: 4306 / 30, usedSeconds: 4306 / 30, sourceIn: 0, trimmed: false, fps: 30, mode: 'timestamp' }),
    '00:02:23.16 at 30 fps | source')
  check('a track is counted at the project rate',
    clipSummary({ ...frames, totalSeconds: 90, usedSeconds: 90, sourceIn: 0, trimmed: false }),
    '2700 frames at 30 fps | source')
  check('and a trimmed track says what was taken',
    clipSummary({ ...frames, totalSeconds: 90, usedSeconds: 30, sourceIn: 60, trimmed: true }),
    '2700 frames at 30 fps | 900 trimmed frames [1800-2700]')
  check('and reads as time when that is the setting',
    clipSummary({ totalSeconds: 90, usedSeconds: 30, sourceIn: 60, trimmed: true, fps: 30, mode: 'timestamp' }),
    '00:01:30.00 at 30 fps | 00:00:30.00 trimmed [00:01:00.00-00:01:30.00]')
  // A trim that takes nothing away is not a trim: a range around the whole of the source IS the source,
  // and a still's chosen length is the whole of it in the same way.
  check('a trim of the whole source is the source',
    clipSummary({ ...frames, totalSeconds: 72, usedSeconds: 72, sourceIn: 0, trimmed: true }),
    '2160 frames at 30 fps | source')
  check('and so is a still, whose length is the whole of it',
    clipSummary({ ...frames, totalSeconds: 10, usedSeconds: 10, sourceIn: 0, trimmed: true }),
    '300 frames at 30 fps | source')
  // The playhead's own line: the unit said once, and the two figures joined by "of".
  check('the playhead line in frames', stampPair(0, 123456 / 30, 30, 'framestamp'), 'FRAME 000000 of 123456')
  check('the playhead line in timecodes', stampPair(1, 60, 30, 'timestamp'), '00:00:01.00 of 00:01:00.00')

  // The clip's own run and the output's total, which are the two halves of the line under the monitor and
  // the value under USED in PROPERTIES. The counts are read as numbers and left unpadded; the range's ends
  // are positions and padded to six digits, so they line up as a box.
  check('a clip reads as its count, its range and its source',
    clipRangeLabel({ usedSeconds: 353 / 30, sourceIn: 0, totalSeconds: 11745 / 30, fps: 30, mode: 'framestamp' }),
    'FRAMES: 353 [000000-000353] OF 11745')
  check('and the output as its own count', outputRangeLabel(907 / 30, 30, 'framestamp'), 'TOTAL OUTPUT FRAMES: 907')
  check('a run from the middle draws the range it covers',
    clipRangeLabel({ usedSeconds: 2, sourceIn: 3, totalSeconds: 10, fps: 25, mode: 'framestamp' }),
    'FRAMES: 50 [000075-000125] OF 250')
  check('and the same run in timecodes',
    clipRangeLabel({ usedSeconds: 2, sourceIn: 3, totalSeconds: 10, fps: 25, mode: 'timestamp' }),
    'TIME: 00:00:02.00 [00:00:03.00-00:00:05.00] OF 00:00:10.00')
  check('the output\u2019s unit follows the mode too', outputRangeLabel(2, 25, 'timestamp'), 'TOTAL OUTPUT TIME: 00:00:02.00')
  // A clip that uses the whole of its source still draws the range: the range spanning everything is a fact
  // about the clip rather than a fault, and it is what lets the reader see that nothing was taken away.
  check('a clip that uses all of its source draws the range around it',
    clipRangeLabel({ usedSeconds: 4, sourceIn: 0, totalSeconds: 4, fps: 25, mode: 'framestamp' }),
    'FRAMES: 100 [000000-000100] OF 100')
  check('and a source of no known length is still readable',
    clipRangeLabel({ usedSeconds: 1, sourceIn: 0, totalSeconds: 0, fps: 25, mode: 'framestamp' }),
    'FRAMES: 25 [000000-000025] OF 0')
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

console.log('\n== which clip the output frame follows ==')
{
  // MATCH SOURCE follows the FIRST picture in a job. Order is the whole of the rule, because a job's
  // sources are in the order they will be joined and the output starts at its first visual — and a
  // track is not a picture, so it cannot set the shape of anything. Following the clip under the
  // playhead instead made the output's own shape a question of where the playhead happened to be.
  const first = (paths: string[]) => firstVisualSource({ sourcePaths: paths })
  check('the first clip is the first picture', first(['/one.mp4', '/two.mp4']), '/one.mp4')
  check('and the order decides it rather than the shape', first(['/tall.mp4', '/wide.mp4']), '/tall.mp4')
  check('an audio track is not a picture', first(['/podcast.wav']), undefined)
  check('so a job led by a track follows its first clip', first(['/podcast.wav', '/clip.mp4']), '/clip.mp4')
  check('a track after a clip does not change it', first(['/clip.mp4', '/music.mp3']), '/clip.mp4')
  check('and a job of nothing but tracks follows nothing', first(['/a.wav', '/b.wav']), undefined)
}

console.log('\n== what MATCH SOURCE takes its size from ==')
{
  // The button sets the frame to the picture IN HAND — the clip under the playhead — rather than the
  // job's first, but falls back to the first when what is in hand is no picture at all. That fallback
  // is what keeps a playhead resting on a track from leaving the button with no answer.
  const match = (paths: string[], selected: string | undefined) => matchSourceSource({ sourcePaths: paths }, selected)
  check('the picture in hand', match(['/one.mp4', '/two.mp4'], '/two.mp4'), '/two.mp4')
  check('and the order does not decide it', match(['/one.mp4', '/two.mp4'], '/one.mp4'), '/one.mp4')
  check('a still counts as a picture', match(['/one.mp4', '/still.png'], '/still.png'), '/still.png')
  check('a track in hand is no picture, so the first stands', match(['/one.mp4', '/two.mp4'], '/music.mp3'), '/one.mp4')
  check('with nothing in hand the first stands', match(['/one.mp4', '/two.mp4'], undefined), '/one.mp4')
  check('and a job of nothing but tracks still has no answer', match(['/a.wav', '/b.wav'], '/a.wav'), undefined)
}

void (async () => {
  // WHICH source a preview is for. A multi-track job keeps its audio in `additionalAudioTracks`, not in
  // `sourcePaths`, so an index into `sourcePaths` cannot name one — and an index that misses resolves to
  // the first entry, which is how a Quick Look asked for from an audio clip came back showing the job's
  // first video. Naming the source outright is what closes that.
  console.log('\n== which source a preview is for ==')
  {
    const task = {
      id: 'q', type: 'multitrack', status: 'pending', progress: 0,
      sourcePaths: ['/video-one.mp4', '/video-two.mp4'],
      additionalAudioTracks: [{ id: 't1', path: '/podcast.wav', language: 'und' }],
      outputDirectory: '/out', outputFilename: 'o.mov',
      preset: { id: 'p', name: 'P', container: 'mov', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
    } as unknown as QueueTask
    // The old call: an index, which for an audio track can only land on a video.
    const byIndex = await resolveQuickLookRequest(task, undefined, { sourceIndex: 0 })
    check('an index into the sources names a video, which is all it can name', byIndex?.target, '/video-one.mp4')
    // The fix: the track's own path, which is what the menu now passes.
    const byPath = await resolveQuickLookRequest(task, undefined, { sourcePath: '/podcast.wav', sourceIndex: 0 })
    check('naming the audio track resolves to the audio itself', byPath?.target, '/podcast.wav')
    // No generated clip and no still handling: the helper is handed the file and draws its own
    // waveform, which it decides to do by finding no video track in it.
    check('and it is handed over as footage rather than a still frame', byPath?.stillMode, false)
    check('with nothing unavailable about it', byPath?.previewUnavailable, undefined)
    // A video named the same way still resolves to itself, and to the generated clip if it is a
    // sequence — naming a source must not bypass what resolution does for it.
    const named = await resolveQuickLookRequest(task, undefined, { sourcePath: '/video-two.mp4', sourceIndex: 1 })
    check('a video named outright is still itself', named?.target, '/video-two.mp4')
    // And a task that names nothing keeps the queue's own rule: no index, no path, the first source.
    const plain = await resolveQuickLookRequest(task, undefined, {})
    check('a request naming nothing is the job\u2019s first source', plain?.target, '/video-one.mp4')
  }

  console.log('\n== a source the app\u2019s own webview cannot decode ==')
  {
    // A `<video>` is Chromium's decoder, and it knows the codecs a browser knows. FFMPEG reads far more than
    // that — which is why a Resolume DXV exported perfectly well and previewed as a black frame.
    check('an ordinary h264 mp4 is played as it is', webviewPlaysVideo({ container: 'mp4', videoCodecs: ['h264'] }), true)
    check('and a vp9 webm too', webviewPlaysVideo({ container: 'webm', videoCodecs: ['vp9'] }), true)
    check('a DXV is not', webviewPlaysVideo({ container: 'mov', videoCodecs: ['dxv'] }), false)
    check('nor a Hap', webviewPlaysVideo({ container: 'mov', videoCodecs: ['hap'] }), false)
    check('nor ProRes, however ordinary its container', webviewPlaysVideo({ container: 'mov', videoCodecs: ['prores'] }), false)
    // The container is half the question: Chromium plays the WebM subset of Matroska and not Matroska.
    check('nor h264 inside the wrong wrapper', webviewPlaysVideo({ container: 'mkv', videoCodecs: ['h264'] }), false)
    // A codec string carries its profile after a dot, and `avc1.64001f` is still avc1.
    check('a codec is read past its profile', webviewPlaysVideo({ container: 'mp4', videoCodecs: ['avc1.64001f'] }), true)
    check('and so is a vp9 one', webviewPlaysVideo({ container: 'webm', videoCodecs: ['vp09.00.10.08'] }), true)
    // A source with no picture has nothing for the element to fail to decode, and its sound is a different
    // question answered by a different element.
    check('a source with no video stream is not a proxy question at all', webviewPlaysVideo({ container: 'wav', videoCodecs: [] }), true)

    // The proxy is remembered on the task under a key of its own, which is what lets a built one be found
    // rather than rebuilt on the next open.
    const job = { imageSequencePreviews: { [previewProxyKey('/a.mov')]: '/cache/a.mp4' } } as unknown as QueueTask
    check('a proxy is found by its source', rememberedProxyFor(job, '/a.mov'), '/cache/a.mp4')
    check('and a source with none has none', rememberedProxyFor(job, '/b.mov'), undefined)
    check('the key is not the sequence key', previewProxyKey('/a.mov') === sequencePreviewKey('/a.mov', 24, 240), false)

    // Resolving for such a source asks the bridge to build one and hands the proxy back as the target.
    const source = { id: 't', type: 'transcode', status: 'pending', progress: 0, sourcePaths: ['/a.mov'], outputDirectory: '/out', outputFilename: 'o.mp4', preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' } } as unknown as QueueTask
    const asked: string[] = []
    const builder = { previewProxyFor: async (file: string) => { asked.push(file); return '/cache/built.mp4' }, pathExists: async () => false }
    const proxied = await resolveQuickLookRequest(source, builder, { sourceIndex: 0, needsPreviewProxy: true })
    check('a source that needs a proxy asks for one', asked, ['/a.mov'])
    check('and the proxy is what the monitor is handed', proxied?.target, '/cache/built.mp4')
    check('reported back so the caller remembers it', proxied?.regeneratedPreview?.path, '/cache/built.mp4')
    // A source the element can play is handed over as itself and nothing is built.
    const untouched = { previewProxyFor: async () => { throw new Error('nothing should have been built') }, pathExists: async () => false }
    const kept = await resolveQuickLookRequest(source, untouched, { sourceIndex: 0 })
    check('a source that needs no proxy is handed over as itself', kept?.target, '/a.mov')
  }

  console.log('\n== a clip\u2019s own speed ==')
  {
    check('a speed below the floor is the clip\u2019s own', clampClipSpeed(0), 1)
    check('and above the ceiling is held at it', clampClipSpeed(999), MAX_CLIP_SPEED)
    check('and a negative speed is nonsense too', clampClipSpeed(-2), 1)
    check('a rate inside the range is kept as it is', clampClipSpeed(1.5), 1.5)
    check('and the floor itself is allowed', clampClipSpeed(MIN_CLIP_SPEED), MIN_CLIP_SPEED)

    // `atempo` takes one factor in [0.5, 2], so anything past either end is a chain of them whose
    // PRODUCT is the speed — which is what keeps a pitch-corrected sound exactly as long as the picture.
    check('a speed inside the range is one link', atempoChain(1.5), [1.5])
    check('twice the speed is one at the top', atempoChain(2), [2])
    check('four times is two of them', atempoChain(4), [2, 2])
    check('eight times is three', atempoChain(8), [2, 2, 2])
    check('half speed is one at the bottom', atempoChain(0.5), [0.5])
    check('a quarter is two halves', atempoChain(0.25), [0.5, 0.5])
    const product = (factors: number[]) => factors.reduce((total, factor) => total * factor, 1)
    check('a speed that is neither is split, and the product is still the speed', Math.abs(product(atempoChain(3)) - 3) < 1e-9, true)
    check('and so is a slow one', Math.abs(product(atempoChain(0.3)) - 0.3) < 1e-9, true)
    check('and a very fast one', Math.abs(product(atempoChain(16)) - 16) < 1e-9, true)

    // The two halves of one retiming, empty at the clip's own speed so an untouched export is untouched.
    check('a clip at its own speed is handed no picture filter', speedVideoFilters(1, 'sampling', 30), [])
    check('and no sound filter either', speedAudioFilters(1, true), [])
    check('a sped picture is a setpts', speedVideoFilters(2, 'sampling', 30), ['setpts=(PTS-STARTPTS)/2'])
    check('blending adds the interpolator at the output rate', speedVideoFilters(2, 'blending', 30), ['setpts=(PTS-STARTPTS)/2', 'minterpolate=fps=30:mi_mode=blend'])
    check('and blending without a known rate is just the setpts', speedVideoFilters(2, 'blending', 0), ['setpts=(PTS-STARTPTS)/2'])
    check('a pitch-kept sound is the atempo chain', speedAudioFilters(4, true), ['atempo=2', 'atempo=2'])
    check('a pitch-let-go sound shifts the sample rate instead', speedAudioFilters(2, false, 48000), ['asetrate=96000', 'aresample=48000'])

    // The relationship the inspector edits from either end.
    check('a clip\u2019s length is the trim over the speed', clipDurationFor(10, 2), 5)
    check('and a length asks for the speed that needs it', trimmedForDuration(5, 2), 10)
    check('a record is the clip\u2019s own speed when there is none', speedFor({}, '/a.mp4', 0).speed, 1)
    check('a record is found by its clip\u2019s key', speedFor({ sourceSpeed: { '/a.mp4#1': { speed: 2, interpolation: 'sampling' } } }, '/a.mp4', 1).speed, 2)
    check('and by the path alone as a job-wide fallback', speedFor({ sourceSpeed: { '/a.mp4': { speed: 2, interpolation: 'sampling' } } }, '/a.mp4', 3).speed, 2)
    check('a nonsense record reads as the clip\u2019s own speed', speedFor({ sourceSpeed: { '/a.mp4#0': { speed: 0, interpolation: 'sampling' } } }, '/a.mp4', 0).speed, 1)
    check('a rate reads the way the monitor spells one', clipSpeedLabel(0.5), '0.5x')

    // A ONE-FRAME STEP OF THE LENGTH has to survive the speed it is STORED as. DURATION and SPEED are one
    // relationship, so a frame of a long clip is a speed change far below a thousandth — and at three
    // decimals it rounded straight back to where it started, which is why the wheel and the arrows went
    // dead for a long clip at a slow speed. The two cases the report named are asserted by name, plus an
    // hour, so the precision is pinned to the arithmetic rather than to a feeling about it.
    const frameStepSurvives = (seconds: number, rate: number) => {
      const speed = clampClipSpeed(seconds / (seconds + 1 / rate))
      return speed !== 1 && Math.abs(seconds / speed - (seconds + 1 / rate)) < 1e-3
    }
    check('one frame of a 7m49s source at 30 fps moves the length', frameStepSurvives(7 * 60 + 49 + 19 / 30, 30), true)
    check('and one frame of a 2m59s source at 24 fps moves it too', frameStepSurvives(2 * 60 + 59 + 13 / 24, 24), true)
    check('and an hour of source at 25 fps still moves a frame', frameStepSurvives(3600, 25), true)
  }

  console.log('\n== a rate held exactly ==')
  {
    // A RATE IS A COUNT OF FRAMES OVER A COUNT OF SECONDS, and the two commonest are not whole numbers.
    // 30000/1001 is what a reader calls 29.97, and holding the decimal instead loses the exactness the whole
    // module is for — so a probed 29.97 and a chosen 29.97 have to BE 30000/1001, not 2997/100.
    check('a probed 29.97 is the exact NTSC rate', rateOf(29.97), makeRate(30000, 1001))
    check('which is not the decimal it is written as', rateValue(rateOf(29.97)) !== 29.97, true)
    check('and a chosen 29.97 is the same rate, not one a thousandth apart', ratesEqual(rateOf(29.97), makeRate(30000, 1001)), true)
    check('23.976 is 24000/1001', rateRationalLabel(rateOf(23.976)), '24000/1001')
    check('a whole rate is itself', rateOf(30), makeRate(30, 1))
    check('a typed decimal is the rational it is written as', rateOf(23.5), makeRate(47, 2))
    check('the label of an NTSC rate is the familiar decimal', rateLabel(makeRate(30000, 1001)), '29.97')
    check('and a rate that is neither prints the whole of itself', rateLabel(makeRate(47, 2)), '23.5')
    check('the default is the one the app has always fallen back to', rateLabel(DEFAULT_RATE), '30')
    // The presets are the eight the window draws, each an exact rational, and the NTSC three are the ones a
    // float would round: 23.976, 29.97 and 59.94 are held as `.../1001` rather than as their decimals.
    check('the preset list is the eight the window offers', RATE_PRESETS.map((entry) => entry.label), ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'])
    check('and the NTSC three are held over 1001', RATE_PRESETS.filter((entry) => entry.rate.den === 1001).map((entry) => entry.rate.den), [1001, 1001, 1001])
    // The two readings of a rate are inverses, so a frame index and an instant never drift apart.
    check('a frame begins where the frame says', secondsForFrames(29, makeRate(30000, 1001)), (29 * 1001) / 30000)
    check('and the instant falls back on that frame', frameFloor(secondsForFrames(29, makeRate(30000, 1001)), makeRate(30000, 1001)), 29)
    check('a rate counts whole frames', frameCount(1, makeRate(30000, 1001)), 30)

    // THE COMPOSITION. `retime = speed × fps_clip / native`, which is the whole of how a rate of the clip's
    // own and a speed fold together: at the source's own rate it is the plain speed, and a 24p clip read at
    // 12 is half as fast again — twice the length — whatever the speed beside it says.
    const NTSC = makeRate(30000, 1001)
    check('a clip at its source rate and its own speed is not retimed', clipRetime(1, makeRate(24, 1), makeRate(24, 1)), 1)
    check('a 24p clip read at 12 runs at half speed', clipRetime(1, makeRate(12, 1), makeRate(24, 1)), 0.5)
    check('and a speed beside it multiplies', clipRetime(2, makeRate(12, 1), makeRate(24, 1)), 1)
    check('a clip read at twice its source rate runs twice as fast', clipRetime(1, makeRate(48, 1), makeRate(24, 1)), 2)
    check('a measured NTSC rate folds in exactly', Math.abs(clipRetime(1, NTSC, makeRate(30, 1)) - 30000 / 1001 / 30) < 1e-12, true)
  }

  console.log('\n== a clip at a rate of its own, on the timeline ==')
  {
    const rateTask: QueueTask = {
      id: 'r', type: 'transcode', status: 'pending', progress: 0,
      sourcePaths: ['/a.mp4'], outputDirectory: '/out', outputFilename: 'o.mp4',
      preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
      sourceMetadata: { '/a.mp4': { duration: 10, fps: 24 } },
    }
    // Left alone, the clip is its source's own rate and nothing is retimed: the length is the trim.
    const plain = buildTimeline(rateTask)
    check('the source\u2019s own rate is read as a rational', nativeRateFor(rateTask, '/a.mp4'), makeRate(24, 1))
    check('and a clip\u2019s own record wins over it', clipRateFor({ ...rateTask, sourceFps: { '/a.mp4#0': makeRate(12, 1) } }, '/a.mp4', 0, makeRate(24, 1)), makeRate(12, 1))
    check('a clip left at its source rate is not retimed', plain.lanes[0].segments[0].duration, 10)
    check('and its interpreted rate is its source\u2019s', rateLabel(plain.lanes[0].segments[0].rate!), '24')
    // Given 12 fps of its own, ten seconds of 24p frames are read at half rate: the clip is twenty seconds.
    const reread = buildTimeline({ ...rateTask, sourceFps: { '/a.mp4#0': makeRate(12, 1) } })
    const segment = reread.lanes[0].segments[0]
    check('a 24p clip read at 12fps runs twice as long', segment.duration, 20)
    check('and the whole timeline is twice as long', reread.duration, 20)
    check('its interpreted rate is what was chosen', rateLabel(segment.rate!), '12')
    check('while its native rate is still the source\u2019s own', rateLabel(segment.nativeRate!), '24')
    check('the sector of the source it uses is unchanged by the rate', segment.sourceUsedSeconds, 10)
    // And a speed beside a rate composes, rather than replacing it.
    const both = buildTimeline({
      ...rateTask,
      sourceFps: { '/a.mp4#0': makeRate(12, 1) },
      sourceSpeed: { '/a.mp4#0': { speed: 2, interpolation: 'sampling', maintainPitch: true } },
    })
    check('a speed and a rate of its own compose to their product', both.lanes[0].segments[0].duration, 10)
  }

  console.log('\n== a sped clip on the timeline ==')
  {
    const speedTask = {
      id: 's', type: 'stitch', status: 'pending', progress: 0,
      sourcePaths: ['/a.mp4', '/b.mp4'], outputDirectory: '/out', outputFilename: 'o.mp4',
      preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source', fps: 30 },
      // a is ten seconds and run at twice its speed; b is left alone.
      sourceSpeed: { '/a.mp4#0': { speed: 2, interpolation: 'sampling' } },
    } as unknown as QueueTask
    const timing = (path: string) => ({ duration: path === '/a.mp4' ? 10 : 4 })
    const built = buildTimeline(speedTask, { resolveTiming: timing })
    const clips = built.lanes[0].segments
    check('a clip at 2x takes half the timeline it would', clips[0].duration, 5)
    check('and it still uses the whole of its source', clips[0].sourceUsedSeconds, 10)
    check('its speed rides on the segment', clips[0].speed, 2)
    check('the clip after it starts where the sped one ended', clips[1].start, 5)
    check('an untouched clip keeps its own speed', clips[1].duration, 4)
    check('and the output is the sped total', built.duration, 9)
    // A trim and a speed compose: what the trim keeps is what the speed then divides.
    const trimmed = buildTimeline({ ...speedTask, trimPoints: { '/a.mp4#0': { in: 2, out: 8 } } } as unknown as QueueTask, { resolveTiming: timing })
    check('a trimmed clip at 2x is the trim over two', trimmed.lanes[0].segments[0].duration, 3)
    check('while the source run it keeps is the trim itself', trimmed.lanes[0].segments[0].sourceUsedSeconds, 6)

    // The mapping the MONITOR plays by, which is the same one the encoder's filters produce: at 2x the
    // source is two seconds in for every one the timeline has crossed, and reading the element's clock
    // back gives the timeline instant it belongs to. This is the acceptance criterion, checked as
    // arithmetic rather than taken on trust.
    const span = { start: 5, duration: 5, sourceIn: 2, speed: 2 }
    check('a timeline instant maps to the source instant the speed puts it at', sourceTimeAt(6, span), 4)
    check('and the end of the clip maps to the end of the source run it keeps', sourceTimeAt(10, span), 12)
    check('reading the clock back gives the timeline instant again', timelineTimeAt(sourceTimeAt(7.5, span), span), 7.5)
    check('and at a clip\u2019s own speed both are the plain offset', [sourceTimeAt(6, { ...span, speed: 1 }), timelineTimeAt(6, { ...span, speed: 1 })], [3, 9])
    check('a timeline instant before the clip clamps to its in point', sourceTimeAt(1, span), 2)

    // A SLAVED TRACK PAST ITS OWN END. The playhead can outlast an added track — the picture runs on — and a
    // driver that kept parking the element at its out point every frame is what made the last syllable
    // cycle. The reading says WHEN to stop touching the element, not only where its last instant is.
    check('a slaved track is driven inside its own clip', slavedAudioAt(7.5, span), { at: 2 + 2.5 * 2, past: false })
    check('and parked at its out point, but told to stand down, past it', slavedAudioAt(12, span), { at: 12, past: true })
    const track = { start: 0, duration: 8, sourceIn: 0, speed: 1 }
    check('a track whose clip has run out is past at the clip\u2019s own end', [slavedAudioAt(7.9, track).past, slavedAudioAt(8, track).past], [false, true])
    check('while the instant it is parked at never runs past the source it keeps', slavedAudioAt(99, track).at, 8)

    // Where the encoder can carry a speed. The drawn timeline reads the record only where the export does,
    // so a speed that cannot be written is not drawn either. A MULTI-TRACK and a single-visual COMBO can
    // now carry one — the encoder retimes their visual and their tracks — so the timeline draws it too.
    check('a stitch can carry a clip speed', canApplyClipSpeed(speedTask, '/a.mp4'), true)
    const multi = { ...speedTask, type: 'multitrack' } as unknown as QueueTask
    check('a multi-track job can now too', canApplyClipSpeed(multi, '/a.mp4'), true)
    check('so its visual is drawn retimed', buildTimeline(multi, { resolveTiming: timing }).lanes[0].segments[0].duration, 5)
    check('a still has no frames to retime', canApplyClipSpeed({ ...multi, sourcePaths: ['/a.png'] } as unknown as QueueTask, '/a.png'), false)
    const convert = { ...speedTask, type: 'transcode', sourcePaths: ['/a.mp4'] } as unknown as QueueTask
    check('a single visual convert can', canApplyClipSpeed(convert, '/a.mp4'), true)
    const soundConvert = { ...speedTask, type: 'transcode', sourcePaths: ['/a.wav'] } as unknown as QueueTask
    check('a sound convert cannot', canApplyClipSpeed(soundConvert, '/a.wav'), false)
  }

  console.log('\n== a clip\u2019s speed follows the clip ==')
  {
    const job = {
      id: 'r', type: 'stitch', status: 'pending', progress: 0,
      sourcePaths: ['/a.mp4', '/b.mp4', '/c.mp4'], outputDirectory: '/o', outputFilename: 'o.mp4',
      preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
      sourceSpeed: { '/a.mp4#0': { speed: 2, interpolation: 'sampling' } },
    } as unknown as QueueTask
    // A reorder carries the ids, so the speed stays filed under the clip and is READ at its new place —
    // rather than being re-keyed onto whatever now occupies the place the clip left.
    const reordered = withSourceList(job, ['/c.mp4', '/a.mp4', '/b.mp4'])
    check('a reorder moves a clip\u2019s speed with it', speedFor(reordered as QueueTask, '/a.mp4', 1).speed, 2)
    check('and leaves nothing on the place it left', speedFor(reordered as QueueTask, '/c.mp4', 0).speed, 1)
    // A removal from the end leaves the earlier clip's record where it is; a removal of the clip itself
    // takes its record with it.
    const dropped = removeSourceFromTask(job, '/c.mp4', 2)
    check('removing a later clip leaves an earlier clip\u2019s speed alone', speedFor(dropped as QueueTask, '/a.mp4', 0).speed, 2)
    const gone = removeSourceFromTask(job, '/a.mp4', 0)
    check('removing the clip itself takes its speed with it', gone?.sourceSpeed, undefined)
  }

  console.log('\n== which codecs a container offers ==')
  {
    const values = (container: EncodingPreset['container']) => codecChoicesFor(container).map((choice) => choice.value)
    check('a MOV offers the ProRes family', values('mov').filter((value) => value.startsWith('prores')), ['prores-proxy', 'prores-lt', 'prores-422', 'prores-hq', 'prores-4444', 'prores-4444xq'])
    check('and DXV and Hap beside it', [values('mov').includes('dxv'), values('mov').includes('hap')], [true, true])
    // The DXV generations this encoder cannot write are shown and cannot be chosen, rather than missing.
    const dxvEntries = codecChoicesFor('mov').filter((choice) => choice.value.startsWith('dxv'))
    check('DXV is offered once as what it is, with the rest refused', [dxvEntries.length, dxvEntries.filter((choice) => !choice.reason).map((choice) => choice.value)], [4, ['dxv']])
    check('an MP4 offers none of them', values('mp4').filter((value) => value.startsWith('prores') || value === 'dxv' || value === 'hap'), [])
    check('a WebM offers only what it can hold', values('webm'), ['copy', 'vp9', 'av1'])
    check('a GIF offers its own encoder', values('gif'), ['gif'])
    check('a still container offers the one codec it writes', [values('png'), values('jpg')], [['png'], ['mjpeg']])
    // A sound container has nothing to encode a picture as, and says so rather than leaving an empty box.
    const soundOnly = codecChoicesFor('wav')
    check('a sound container offers one entry, and it cannot be chosen', [soundOnly.length, Boolean(soundOnly[0].reason)], [1, true])
    check('which is what that container reads by', codecChoiceValue({ container: 'wav', videoCodec: 'h264' }), 'none')

    // The five ProRes entries are told apart by their PROFILE, which is what the select has to carry.
    check('each ProRes entry carries its own profile', codecChoicesFor('mov').filter((choice) => choice.videoCodec === 'prores').map((choice) => choice.proresProfile), ['proxy', 'lt', 'standard', 'hq', '4444', '4444xq'])
    const master = { id: 'p', name: 'P', container: 'mov', videoCodec: 'prores', audioCodec: 'aac', resolution: 'source', proresProfile: 'hq' } as EncodingPreset
    check('a ProRes HQ preset stands on its own entry', codecChoiceValue(master), 'prores-hq')
    check('and ProRes with no profile stands on the standard one', codecChoiceValue({ ...master, proresProfile: undefined }), 'prores-422')
    check('choosing an entry writes the codec and the profile together', (() => { const next = applyCodecChoice(master, 'prores-lt'); return [next.videoCodec, next.proresProfile] })(), ['prores', 'lt'])
    check('and choosing DXV writes DXV and drops the profile', (() => { const next = applyCodecChoice(master, 'dxv'); return [next.videoCodec, next.proresProfile] })(), ['dxv', undefined])

    // A container that cannot hold the codec moves the job onto what that container is FOR.
    check('whether a container takes a codec is asked of its own list', [containerTakesCodec('mp4', 'h264'), containerTakesCodec('mp4', 'dxv'), containerTakesCodec('webm', 'h264'), containerTakesCodec('mov', 'hap')], [true, false, false, true])
    type Preset = EncodingPreset['videoCodec']
    const moved = (videoCodec: Preset, container: EncodingPreset['container']) => {
      const next = reconcileCodecToContainer({ ...master, videoCodec }, container)
      return [next.container, next.videoCodec]
    }
    check('a ProRes master moved into an MP4 falls back to H.264', moved('prores', 'mp4'), ['mp4', 'h264'])
    // A png stream inside a MOV is one no player opens either, so the still-image codecs are not offered
    // outside the containers they belong to: this is the rule the image-codec special case used to be.
    check('and a PNG sequence moved into a MOV does too', moved('png', 'mov'), ['mov', 'h264'])
    check('while VP9 into a WebM is left alone', moved('vp9', 'webm'), ['webm', 'vp9'])
    check('but H.264 into a WebM is not', moved('h264', 'webm'), ['webm', 'vp9'])
    check('and DXV into an MKV is not', moved('dxv', 'mkv'), ['mkv', 'h264'])
    check('a codec the container already holds is left exactly as it is', reconcileCodecToContainer(master, 'mov'), master)
    check('a still-image codec has no container but its own', codecChoicesFor('mp4').filter((choice) => choice.videoCodec === 'png' || choice.videoCodec === 'mjpeg'), [])

    // And the container change the editor actually calls, end to end.
    const changed = (videoCodec: Preset, container: EncodingPreset['container'], from: EncodingPreset['container'] = 'mp4') => {
      const next = applyContainerChange({ ...master, container: from, videoCodec, proresProfile: undefined }, container)
      return [next.container, next.videoCodec]
    }
    check('changing FORMAT to MOV keeps a codec MOV can hold', changed('h264', 'mov'), ['mov', 'h264'])
    check('and drops one it cannot', changed('vp9', 'mov'), ['mov', 'h264'])
    check('leaving an image container for a movie one drops the image codec', changed('png', 'mp4', 'png'), ['mp4', 'h264'])
    check('and moving into a still container takes its own', changed('h264', 'jpg'), ['jpg', 'mjpeg'])
  }

  console.log('\n== which sounds a container offers ==')
  {
    const soundValues = (container: EncodingPreset['container']) => audioChoicesFor(container).filter((choice) => !choice.reason).map((choice) => choice.value)
    check('a WebM offers Opus and nothing else it can hold', soundValues('webm'), ['copy', 'opus'])
    check('an MP4 offers the sounds a player expects', soundValues('mp4'), ['copy', 'aac', 'mp3', 'opus'])
    check('a WAV offers the one codec it is', soundValues('wav'), ['pcm'])
    check('an M4A opens on AAC', soundValues('m4a'), ['aac', 'mp3'])
    check('a MATROSKA offers the lot', soundValues('mkv'), ['copy', 'aac', 'mp3', 'opus', 'pcm', 'flac'])
    // A picture container carries no sound at all, and says so where the list would be.
    const pngSound = audioChoicesFor('png')
    check('a picture container offers one entry, and it cannot be chosen', [pngSound.length, Boolean(pngSound[0].reason)], [1, true])
    check('which is what that container reads by', audioChoiceValue({ container: 'gif', audioCodec: 'aac' }), 'none')

    check('whether a container takes a sound is asked of its own list', [containerTakesAudio('webm', 'aac'), containerTakesAudio('webm', 'opus'), containerTakesAudio('mp4', 'flac')], [false, true, false])
    type Audio = EncodingPreset['audioCodec']
    const soundMoved = (audioCodec: Audio, container: EncodingPreset['container']) => {
      const next = reconcileAudioToContainer({ id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec, resolution: 'source' } as EncodingPreset, container)
      return [next.container, next.audioCodec]
    }
    check('an AAC job moved into a WebM becomes Opus', soundMoved('aac', 'webm'), ['webm', 'opus'])
    check('and one moved into a WAV becomes PCM', soundMoved('aac', 'wav'), ['wav', 'pcm'])
    check('while Opus into a Matroska is left alone', soundMoved('opus', 'mkv'), ['mkv', 'opus'])
    check('and an AAC into an MP4 is too', soundMoved('aac', 'mp4'), ['mp4', 'aac'])
  }

  console.log('\n== a timecode read back ==')
  {
    check('the frame group is a COUNT of frames, not a decimal', secondsFromTimecode('00:00:13.10', 25), 13.4)
    check('and it round-trips through the shape the window writes', timecode(secondsFromTimecode('00:00:13.10', 25) as number, 25), '00:00:13.10')
    check('hours are counted up', secondsFromTimecode('01:02:03.00', 25), 3723)
    check('a half-typed figure still reads', secondsFromTimecode('00:12', 25), 12)
    check('and so does one with no groups at all', secondsFromTimecode('13', 25), 13)
    check('a figure with no frames reads as whole seconds', secondsFromTimecode('00:00:07', 25), 7)
    check('nonsense reads as nothing', [secondsFromTimecode('', 25), secondsFromTimecode('ab', 25), secondsFromTimecode('00:xx:01.00', 25)], [null, null, null])
    check('and a zero timecode is zero seconds', secondsFromTimecode('00:00:00.00', 25), 0)
  }

  console.log('\n== one file or a run of frames ==')
  {
    // The IMAGE OUTPUT list, which is the same question asked of two kinds of format: a still-image
    // container writes a picture, the animated one writes an animation.
    check('the containers that can write a run are the two still ones and the animated one', FRAME_CONTAINERS, ['png', 'jpg', 'gif'])
    check('a still container offers a single frame and a run', imageOutputChoicesFor('png').map((choice) => [choice.value, choice.label]), [['still', 'SINGLE FRAME'], ['sequence', 'SEQUENCE']])
    check('and the animated one is offered all three, its animation included', imageOutputChoicesFor('gif').map((choice) => [choice.value, choice.label]), [['still', 'SINGLE FRAME'], ['animation', 'ANIMATION'], ['sequence', 'SEQUENCE OF FRAMES']])
    check('a job that names nothing opens on the animation for a GIF', imageOutputChoiceValue({ container: 'gif' }), 'animation')
    check('and on a single frame for a still container', imageOutputChoiceValue({ container: 'png' }), 'still')
    check('a run reads back as a run', imageOutputChoiceValue({ container: 'gif', imageOutputMode: 'sequence' }), 'sequence')
    check('and a single frame reads back for a GIF too', imageOutputChoiceValue({ container: 'gif', imageOutputMode: 'still' }), 'still')
    check('and the defaults are the same two', [defaultImageOutputChoiceValue('gif'), defaultImageOutputChoiceValue('jpg')], ['animation', 'still'])
    // What the choice STORES: a GIF's animation is the absence of a mode, because that is what the
    // engine's own gif muxer branch is, and a still is the mode the encoder turns into `-frames:v 1`.
    const blank: EncodingPreset = { id: 'p', name: 'P', container: 'gif', videoCodec: 'gif', audioCodec: 'copy', resolution: 'source' }
    check('choosing the animation stores no mode at all', applyImageOutputChoice(blank, 'animation').imageOutputMode, undefined)
    check('and choosing a run stores one', applyImageOutputChoice(blank, 'sequence').imageOutputMode, 'sequence')
    // And what a change of FORMAT makes of it: a run survives wherever the new container can write one,
    // and everything else falls to that container's own default — SINGLE FRAME for a still image, the
    // animation for a GIF, which is what the container IS.
    const modeAfter = (from: EncodingPreset['container'], to: EncodingPreset['container'], imageOutputMode?: EncodingPreset['imageOutputMode']) =>
      applyContainerChange({ ...blank, container: from, imageOutputMode }, to).imageOutputMode
    check('a video put into PNG becomes a single frame', modeAfter('mp4', 'png'), 'still')
    check('a video put into GIF becomes its animation', modeAfter('mp4', 'gif'), undefined)
    check('a run put into PNG stays a run', modeAfter('mp4', 'png', 'sequence'), 'sequence')
    check('and a run put into GIF stays one too', modeAfter('png', 'gif', 'sequence'), 'sequence')
    check('while a single frame survives into the animated one', modeAfter('mp4', 'gif', 'still'), 'still')
    check('while a GIF animation moved into PNG becomes a single frame', modeAfter('gif', 'png'), 'still')
    check('and a still-image container has no say over a movie one', modeAfter('png', 'mp4'), undefined)
  }

  console.log('\n== a single frame is not the same as having nothing to time ==')
  {
    // A single frame out of FOOTAGE has every frame of itself to choose from, so its timeline stays — which
    // is what lets SINGLE FRAME mean the frame under the playhead. Only a source that is itself one frame
    // has nothing to time.
    const frameJob = (sourcePaths: string[], extra: Partial<QueueTask> = {}) => ({
      id: 'j', type: 'transcode', status: 'pending', progress: 0,
      sourcePaths, outputDirectory: '/out', outputFilename: 'o.png',
      preset: { id: 'p', name: 'P', container: 'png', videoCodec: 'png', audioCodec: 'copy', resolution: 'source', imageOutputMode: 'still' },
      ...extra,
    } as unknown as QueueTask)
    check('a video asked for one frame has footage in it', taskHasFootage(frameJob(['/a.mp4'])), true)
    check('so its timeline stays, for the frame to be picked from', nothingToTime(frameJob(['/a.mp4'])), false)
    check('a lone still has no footage', taskHasFootage(frameJob(['/a.png'])), false)
    check('and its single frame has nothing to time', nothingToTime(frameJob(['/a.png'])), true)
    check('a sound file has no picture to time either', nothingToTime(frameJob(['/a.wav'])), true)
    check('an interpreted sequence IS footage', taskHasFootage({ sourcePaths: ['/s0001.png'], sequenceInput: {} as never }), true)
    check('and a job asked for a movie is not a single frame at all', nothingToTime(frameJob(['/a.mp4'], { preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' } })), false)
  }

  console.log('\n== what a file is going to weigh ==')
  {
    // The bitrate parser, which is the whole of the arithmetic for every preset built on a named rate.
    check('a figure with no unit is bits a second', bitsPerSecond('200000'), 200000)
    check('k is a thousand', bitsPerSecond('320k'), 320000)
    check('and M is a million', bitsPerSecond('8M'), 8000000)
    check('while nonsense reads as nothing', [bitsPerSecond('fast'), bitsPerSecond(''), bitsPerSecond(undefined)], [undefined, undefined, undefined])
    // A named bitrate wins over everything a rate-codec could work out — but ONLY where the codec writes at
    // a rate, which is the rule pinned below, after ProRes's own target is defined.
    check('a named bitrate sizes a file', estimateOutputSize({ seconds: 10, frames: 0, containerized: true, picture: true, sound: false, videoCodec: 'h264', videoBitrate: '8M', audioCodec: 'aac' }), { bytes: 10100000, confidence: 'close' })
    check('as does a stream copy', estimateOutputSize({ seconds: 10, frames: 0, containerized: true, picture: true, sound: false, videoCodec: 'copy', audioCodec: 'aac' }), undefined)
    // ProRes IS a bitrate by specification, so its published target is scaled by the frame's own area and
    // rate — the OUTPUT frame, never the source's.
    const proresBytes = (width: number, height: number, fps = 29.97) => estimateOutputSize({ seconds: 10, frames: 0, containerized: true, picture: true, sound: false, videoCodec: 'prores', proresProfile: 'hq', width, height, fps, audioCodec: 'aac' })?.bytes
    check('a ProRes HQ at 1080p30 is its documented target for ten seconds', proresBytes(1920, 1080), 277750000)
    near('and twice the frame area is twice the size', (proresBytes(3840, 2160) as number) / (proresBytes(1920, 1080) as number), 4)
    near('and twice the rate is twice the size', (proresBytes(1920, 1080, 59.94) as number) / (proresBytes(1920, 1080) as number), 2)
    // AND A BITRATE THE CODEC IGNORES MUST NOT SIZE ANYTHING. A preset carried into a format whose codec has
    // no rate control kept its old bitrate, and the estimate honoured it — so a ProRes, a PNG or a JPG export
    // read the same megabytes whatever FORMAT and PRESET said, which is the fixed figure a reader reported.
    // The rate belongs to the ENCODER, and an encoder that is never told one must not be sized as if it were.
    const withBitrate = (videoCodec: EncodingPreset['videoCodec']) => estimateOutputSize({ seconds: 10, frames: 0, containerized: true, picture: true, sound: false, videoCodec, videoBitrate: '8M', width: 1920, height: 1080, fps: 30, audioCodec: 'aac' })
    const proresWith = (videoBitrate?: string) => estimateOutputSize({ seconds: 10, frames: 0, containerized: true, picture: true, sound: false, videoCodec: 'prores', proresProfile: 'hq', videoBitrate, width: 1920, height: 1080, fps: 30, audioCodec: 'aac' })?.bytes
    check('a codec with no rate control ignores the bitrate beside it', proresWith('8M'), proresWith(undefined))
    check('and a picture codec keyed on its own quality ignores it too', withBitrate('mjpeg')?.confidence, 'rough')
    check('and a passthrough has no figure whatever is beside it', withBitrate('copy'), undefined)
    check('while a delivery codec keeps the rate it was given', withBitrate('h264')?.bytes, 10100000)
    check('and so does a second one, because the rate is the same rate', withBitrate('vp9')?.bytes, 10100000)
    // PCM is arithmetic rather than a setting, and it is the one figure the SUMMARY draws plainly.
    check('a WAV of PCM is its own arithmetic, and says it is exact', estimateOutputSize({ seconds: 10, frames: 0, containerized: true, picture: false, sound: true, videoCodec: 'copy', audioCodec: 'pcm', audioSampleRate: 48000, audioChannels: 2 }), { bytes: 1939200, confidence: 'exact' })
    // A content-dependent codec is a RANGE, never a number.
    check('and a FLAC is a range rather than a figure', estimateOutputSize({ seconds: 10, frames: 0, containerized: true, picture: false, sound: true, videoCodec: 'copy', audioCodec: 'flac', audioSampleRate: 48000, audioChannels: 2 }), { bytes: 872640, high: 1260480, confidence: 'rough' })
    // The picture is sized from the OUTPUT frame and the COUNT of frames, so one frame is one frame however
    // long the source is — which is the whole of what SINGLE FRAME changes about the figure. A numbered run
    // of image files is not wrapped in a container, so it pays no muxer's per cent.
    // The picture is sized from the OUTPUT frame and the COUNT of frames, so one frame is one frame however
    // long the source is — which is the whole of what SINGLE FRAME changes about the figure. A numbered run
    // of image files is not wrapped in a container, so it pays no muxer's per cent. The brackets are the
    // measured ones: a flat frame at the low end and a photograph at the high.
    const frameBytes = (videoCodec: EncodingPreset['videoCodec'], frames: number, extra: Partial<Parameters<typeof estimateOutputSize>[0]> = {}) => estimateOutputSize({ seconds: 0, frames, containerized: false, picture: true, sound: false, videoCodec, width: 1920, height: 1080, fps: 30, audioCodec: 'copy', ...extra })
    check('a PNG single frame is a bracket over one frame of samples', frameBytes('png', 1), { bytes: 9953, high: 1445714, confidence: 'rough' })
    check('sixteen bits a channel is twice the samples', frameBytes('png', 1, { bitDepth: 16 }), { bytes: 19907, high: 2891428, confidence: 'rough' })
    check('and a run of ten is ten of them', frameBytes('png', 10), { bytes: 99533, high: 14457139, confidence: 'rough' })
    // THE SETTING MOVES THE FIGURE, which is the whole of what a reader changing it expects to see. A PNG
    // at level 0 is its own samples stored and nothing more, and level 9 comes out under the default's.
    check('a PNG at level 0 is its samples stored and nothing more', frameBytes('png', 1, { pngCompression: 0 })?.bytes, 6241951)
    check('and level 9 comes out under the default', (frameBytes('png', 1, { pngCompression: 9 })?.high ?? 0) < (frameBytes('png', 1)?.high ?? 0), true)
    check('a JPEG falls back to the encoder own quality', frameBytes('mjpeg', 1), { bytes: 23432, high: 152410, confidence: 'rough' })
    check('and a better quality is a bigger file', (frameBytes('mjpeg', 1, { jpegQuality: 2 })?.high ?? 0) > (frameBytes('mjpeg', 1, { jpegQuality: 31 })?.high ?? 0), true)
    check('a GIF is bracketed by its own palette', frameBytes('gif', 1), { bytes: 84396, high: 762255, confidence: 'rough' })
    // A stream nobody writes contributes nothing rather than making the whole answer unknown.
    check('a silent video is still a size', estimateOutputSize({ seconds: 10, frames: 0, containerized: true, picture: true, sound: false, videoCodec: 'h264', videoBitrate: '8M', audioCodec: 'aac' })?.bytes, 10100000)
    check('and a length of nothing has no size at all', estimateOutputSize({ seconds: 0, frames: 0, containerized: true, picture: true, sound: false, videoCodec: 'h264', videoBitrate: '8M', audioCodec: 'aac' }), undefined)
    // The units a reader thinks in, and the confidence drawn in the SUMMARY's own line.
    check('a size is written in the unit that fits it', [sizeLabel(900), sizeLabel(1500), sizeLabel(1500000), sizeLabel(2000000000)], ['900 B', '1.5 kB', '1.5 MB', '2 GB'])
    check('an exact figure is written plainly', estimateLabel({ bytes: 1939200, confidence: 'exact' }), '1.9 MB')
    check('a fixed-rate one is marked as the target it is', estimateLabel({ bytes: 10100000, confidence: 'close' }), '≈ 10.1 MB')
    check('and a content-dependent one is drawn as the range it is, in one unit', estimateLabel({ bytes: 311040, high: 1451520, confidence: 'rough' }), '~ 0.3-1.5 MB')
    check('while nothing to go on says UNKNOWN rather than guessing', estimateLabel(undefined), 'UNKNOWN')
    // The frame count a run is sized by.
    check('an assembled length is counted at the rate it is written', framesFrom(10, 30), 300)
    check('and a length of nothing is still one frame', framesFrom(0, 30), 1)
  }

  console.log('\n== a delivery codec, and the depth it is written at ==')
  {
    // A CRF delivery codec has no bitrate until it has encoded, so its figure is the BRACKET its own
    // encoder lands in across content — measured on this machine with the very settings the engine passes.
    const crf = (videoCodec: EncodingPreset['videoCodec']) => estimateOutputSize({ seconds: 10, frames: 0, containerized: true, picture: true, sound: false, videoCodec, width: 1920, height: 1080, fps: 30, audioCodec: 'copy' })
    check('a CRF delivery codec is a bracket rather than a figure', [crf('h264')?.bytes, crf('h264')?.high, crf('h264')?.confidence], [706838, 11741371, 'rough'])
    check('and every one of the four is bracketed', ['hevc', 'vp9', 'av1'].map((codec) => crf(codec as EncodingPreset['videoCodec'])?.confidence), ['rough', 'rough', 'rough'])
    // The newer codecs write less at the quality they are asked for, which is the ordering a reader would
    // expect and the one the measurements came out in.
    const highs = (['h264', 'hevc', 'vp9', 'av1'] as const).map((codec) => crf(codec)?.high ?? 0)
    check('and the newer ones come out smaller at their own quality', highs.every((value, index) => index === 0 || value < highs[index - 1]), true)
    // A sound that names no bitrate is answerable too, from the encoder's own default rather than a guess.
    const soundBytes = (audioCodec: EncodingPreset['audioCodec'], extra: Partial<Parameters<typeof estimateOutputSize>[0]> = {}) => estimateOutputSize({ seconds: 10, frames: 0, containerized: true, picture: false, sound: true, videoCodec: 'copy', audioCodec, audioSampleRate: 48000, audioChannels: 2, ...extra })
    near('a sound that names no bitrate gets the encoder own default', soundBytes('mp3')?.bytes ?? 0, 161600, 1)
    near('and AAC its own', soundBytes('aac')?.bytes ?? 0, 161600, 1)
    near('and Opus the average it writes', soundBytes('opus')?.bytes ?? 0, 147713, 1)
    check('each of them is marked as the estimate it is', [soundBytes('mp3')?.confidence, soundBytes('aac')?.confidence, soundBytes('opus')?.confidence], ['close', 'close', 'close'])
    // A LOSSLESS sound's depth is part of its arithmetic, so asking for more bits asks for more bytes: the
    // figures are 48000 samples a second, two channels, over ten seconds, plus the muxer's per cent.
    check('a WAV that names no depth is sixteen bits', soundBytes('pcm')?.bytes, 1939200)
    check('eight bits a sample is half of that', soundBytes('pcm', { audioBitDepth: 8 })?.bytes, 969600)
    check('twenty-four is half again', soundBytes('pcm', { audioBitDepth: 24 })?.bytes, 2908800)
    check('and thirty-two is twice the sixteen', soundBytes('pcm', { audioBitDepth: 32 })?.bytes, 3878400)
    check('while a FLAC at twenty-four is a bracket over the same samples', soundBytes('flac', { audioBitDepth: 24 }), { bytes: 1308960, high: 1890720, confidence: 'rough' })
    // WHICH CODECS HAVE A DEPTH AT ALL, which is the question the field is drawn on: the lossless two store
    // samples, and the lossy ones store a transform with no samples in it to give a depth to.
    check('a WAV takes eight, sixteen, twenty-four and thirty-two bits', audioDepthsFor('pcm'), [8, 16, 24, 32])
    check('a FLAC takes sixteen and twenty-four', audioDepthsFor('flac'), [16, 24])
    check('and a lossy codec has none, because it stores no samples', [audioDepthsFor('mp3'), audioDepthsFor('aac'), audioDepthsFor('opus'), audioDepthsFor('copy')], [[], [], [], []])
    // The DEPTH a source is held at, read off its own pixel format rather than assumed.
    check('a pixel format says its own depth', [pixelDepth('yuv420p'), pixelDepth('yuv420p10le'), pixelDepth('yuv444p12le'), pixelDepth('gray16le')], [8, 10, 12, 16])
    check('and the packed ones say it per channel', [pixelDepth('rgb24'), pixelDepth('rgb48be')], [8, 16])
    check('nonsense has no depth to read', [pixelDepth(undefined), pixelDepth(''), pixelDepth('weird')], [undefined, undefined, undefined])
    check('a label carries the format as well', pixelDepthLabel('yuv420p10le'), '10-BIT // YUV420P10LE')
    // And ProRes, whose depth its PROFILE decides rather than any control.
    check('the 422 family is ten bits', [proresDepth('proxy'), proresDepth('lt'), proresDepth('standard'), proresDepth('hq')], [10, 10, 10, 10])
    check('and the 4444 family is twelve', [proresDepth('4444'), proresDepth('4444xq')], [12, 12])
    check('which is what its label says, alpha and all', [proresDepthLabel('hq'), proresDepthLabel('4444xq')], ['10-BIT', '12-BIT + ALPHA'])
  }

  console.log('\n== a clip\u2019s own embedded sound, and taking a stream out to a track ==')
  {
    const task = {
      id: 'e', type: 'multitrack', status: 'pending', progress: 0,
      sourcePaths: ['/v.mp4'], outputDirectory: '/out', outputFilename: 'o.mkv',
      preset: { id: 'p', name: 'P', container: 'mkv', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' },
      additionalAudioTracks: [{ id: 'trk', path: '/music.wav', language: 'und' }],
    } as unknown as QueueTask
    const clipId = clipKey(task, '/v.mp4', 0)
    // UNTOUCHED: every stream is enabled at unity, and nothing is customised, so the encoder keeps its own path.
    check('an untouched clip carries every stream', enabledEmbeddedStreams(task, clipId, '/v.mp4', 3).map((stream) => stream.index), [0, 1, 2])
    check('and is not customised at all', embeddedAudioCustomised(task, clipId, '/v.mp4'), false)
    check('so none of its sound is dropped', clipAudioDropped(task, clipId, '/v.mp4', 3), false)
    // A MUTE drops one stream and leaves the others.
    const muted = { ...task, embeddedAudio: { [clipId]: [{ index: 1, muted: true }] } } as unknown as QueueTask
    check('muting one stream drops just it', enabledEmbeddedStreams(muted, clipId, '/v.mp4', 3).map((stream) => stream.index), [0, 2])
    check('and the clip is now customised', embeddedAudioCustomised(muted, clipId, '/v.mp4'), true)
    // A LEVEL is read back in dB, and becomes a linear gain the encoder can write.
    const levelled = { ...task, embeddedAudio: { [clipId]: [{ index: 2, gainDb: -6 }] } } as unknown as QueueTask
    check('a level is read back in dB', embeddedGainDb(levelled, clipId, 2), -6)
    check('and -6 dB is about half the amplitude', Math.round(gainForDb(-6) * 100) / 100, 0.5)
    const allMuted = { ...task, embeddedAudio: { [clipId]: [{ index: 0, muted: true }, { index: 1, muted: true }, { index: 2, muted: true }] } } as unknown as QueueTask
    check('muting every stream drops the clip\u2019s whole sound', clipAudioDropped(allMuted, clipId, '/v.mp4', 3), true)

    // EXTRACTION is a TRACK claiming a stream, keyed by the track\u2019s OWN id rather than the clip\u2019s.
    const extracted = {
      ...task,
      additionalAudioTracks: [...(task.additionalAudioTracks || []), { id: 'x1', path: '/v.mp4', language: 'und', streamIndex: 1, sourceClipId: clipId }],
    } as unknown as QueueTask
    const claim = (extracted.additionalAudioTracks || []).find((track) => track.sourceClipId) as { id: string; path: string; sourceClipId?: string }
    check('the extraction is found as a claim on the stream', extractedBy(extracted, clipId, '/v.mp4', 1)?.id, 'x1')
    check('so the picture stops carrying it', enabledEmbeddedStreams(extracted, clipId, '/v.mp4', 3).map((stream) => stream.index), [0, 2])
    check('and the claim makes the clip customised', embeddedAudioCustomised(extracted, clipId, '/v.mp4'), true)
    check('the extracted track keys on its own id, not the clip\u2019s', trackKey(extracted, claim), '/v.mp4#x1')
    check('while a plain track keeps the legacy key it always had', trackKey(task, { id: 'trk', path: '/music.wav' }), '/music.wav#0')
    // The timeline gives them their OWN segments — same file, two keys — so a trim of one cannot bleed into the other.
    const timeline = buildTimeline(extracted, { resolveTiming: () => ({ duration: 8 }) })
    const trackLane = timeline.lanes.find((lane) => lane.segments.some((segment) => segment.key === '/v.mp4#x1'))
    check('the picture and the extracted track are separate segments', [timeline.lanes[0].segments[0].key, Boolean(trackLane)], [clipId, true])
    // The claim alone is the whole record: deleting the track puts the stream straight back, with nothing to undo.
    const restored = { ...extracted, additionalAudioTracks: task.additionalAudioTracks } as unknown as QueueTask
    check('deleting the track puts the stream back', enabledEmbeddedStreams(restored, clipId, '/v.mp4', 3).map((stream) => stream.index), [0, 1, 2])
    // HOW MANY STREAMS A CLIP IS TREATED AS CARRYING, which the monitor needs where the probe has not answered.
    // A record of a mute at index 1 is itself the evidence of a SECOND stream, so a clip whose probe is not in
    // yet still knows the size of its sound — which is what lets the picture stop sounding under the track that
    // took its only stream, rather than the element playing the file as if nothing had happened.
    const twoMuted = { ...task, embeddedAudio: { [clipId]: [{ index: 0, muted: true }, { index: 1, muted: true }] } } as unknown as QueueTask
    check('a record of two streams is itself the count', embeddedStreamCount(twoMuted, clipId, '/v.mp4', 0), 2)
    check('the probe wins where it has answered', embeddedStreamCount(twoMuted, clipId, '/v.mp4', 5), 5)
    check('and a clip with nothing known still counts as one', embeddedStreamCount(task, clipId, '/v.mp4', 0), 1)
    const onlyExtracted = { ...task, additionalAudioTracks: [{ id: 'x0', path: '/v.mp4', language: 'und', streamIndex: 0, sourceClipId: clipId }] } as unknown as QueueTask
    check('an extracted stream is itself evidence of a stream', embeddedStreamCount(onlyExtracted, clipId, '/v.mp4', 0), 1)
    check('so the picture is dropped rather than sounding under the track', clipAudioDropped(onlyExtracted, clipId, '/v.mp4', embeddedStreamCount(onlyExtracted, clipId, '/v.mp4', 0)), true)
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`)
  process.exit(failures === 0 ? 0 : 1)
})()
