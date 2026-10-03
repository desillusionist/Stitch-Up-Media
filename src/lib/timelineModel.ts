import { ClipTransition, EncodingPreset, QueueTask, SequenceInput } from '../types'
import { CropFractions } from './outputFrame'
import { mediaKind } from './mediaKind'
import { outputCarriesPicture } from './outputKind'
import { DEFAULT_CLIP_SPEED, clampClipSpeed, clipDurationFor, clipRetime, speedFor } from './clipSpeed'
import { FrameRate, RateInput, frameCount, makeRate, rateOf, rateValue } from './frameRate'

/** Default length the encoder gives a still frame that outlives its configured duration. */
const DEFAULT_STILL_SECONDS = 10

export interface TimelineSegment {
  key: string
  sourcePath: string
  /** Offset on the consolidated timeline, in seconds. */
  start: number
  /** How long this segment contributes to the finished output, in TIMELINE seconds. */
  duration: number
  /**
   * How much of the SOURCE the output uses, in seconds.
   *
   * The same figure as `duration` at the clip's own speed, and the trimmed length the encoder asks
   * ffmpeg for when a speed divides it: `duration` is the timeline length, this is the run through
   * the source those two figures are two views of. Everything a clip says about its SOURCE — how much
   * of it is kept, the range a strip samples across, whether the trim took anything away — reads
   * this, and everything about the timeline reads `duration`.
   */
  sourceUsedSeconds: number
  /** The rate the clip is played at. 1 is its own speed, and an absent record leaves it here. */
  speed: number
  /**
   * The rate the clip's frames are INTERPRETED at, and the rate its source natively runs at.
   *
   * The two are the same for a clip left alone, and they differ only when a reader has given a clip a rate
   * of its own — which is a retime exactly as a speed is, and is folded into `speed` above so every reader
   * of that one figure follows it. They are kept here because the inspector shows the pair: the effective
   * rate as the field, and the source's own as the reference beside it. Absent on a segment a harness built
   * by hand, which reads as the source's own rate — no reinterpretation.
   */
  rate?: FrameRate
  nativeRate?: FrameRate
  /** What fills the frames a non-unit speed leaves out or repeats. */
  speedInterpolation: 'sampling' | 'blending'
  /** Whether the sound keeps its own pitch while it is sped. */
  maintainPitch: boolean
  /** Offset inside the source file where playback begins. */
  sourceIn: number
  trimmed: boolean
  /** Present when this segment is an interpreted image sequence. */
  sequence?: { frames: number; fps: number }
  /** True when the encoder will loop this single frame for a fixed length. */
  still?: boolean
  /** Applied fade at this clip's head, in seconds. Zero when there is no fade. */
  fadeIn?: number
  /** Applied fade at this clip's tail, in seconds. Zero when there is no fade. */
  fadeOut?: number
}

export interface TimelineLane {
  id: string
  label: string
  kind: 'video' | 'audio'
  /** True when this lane is muxed from the main input rather than added as a track. */
  embedded: boolean
  segments: TimelineSegment[]
  /** Lane length. Audio lanes start at zero and play alongside each other. */
  duration: number
}

export interface TimelineModel {
  lanes: TimelineLane[]
  /** Length of the finished output, following the encoder's reconciliation rule. */
  duration: number
  /**
   * Sources the current encoder path will not use. Multi-track output maps a
   * single video stream, so any extra visual sources are dropped.
   */
  unusedVideoSources: string[]
}

export interface SourceTiming {
  duration: number
  fps?: number
}

export interface ClipFade {
  fadeIn: number
  fadeOut: number
}

/** The fade asked for at the boundary AFTER this clip, in seconds. */
export const transitionDuration = (task: QueueTask, sourcePath: string, index: number): number => {
  const transition: ClipTransition | undefined = task.transitions?.[`${sourcePath}#${index}`] ?? task.transitions?.[sourcePath]
  return transition && transition.type === 'fade' && transition.duration > 0 ? transition.duration : 0
}

/**
 * The two edges of the whole timeline, where a fade is cut from or to black.
 *
 * They are keyed by the edge rather than by a clip, because an edge belongs to the timeline
 * rather than to whichever clip happens to be first: reordering the clips must not move the
 * fade, and no clip-scoped key could promise that.
 */
export const HEAD_FADE_KEY = '#head'
export const TAIL_FADE_KEY = '#tail'

/** The fade asked for at the head or the tail of the timeline, in seconds. */
export const edgeFade = (task: QueueTask, edge: 'head' | 'tail'): number => {
  const transition: ClipTransition | undefined = task.transitions?.[edge === 'head' ? HEAD_FADE_KEY : TAIL_FADE_KEY]
  return transition && transition.type === 'fade' && transition.duration > 0 ? transition.duration : 0
}

/**
 * A boundary fade cannot exceed half of either neighbour, or the two sides would
 * overlap inside a clip. The encoder and the timeline both clamp through this, so
 * the picture and the drawn ramp cannot disagree.
 */
export const maxFadeAtBoundary = (leftDuration: number, rightDuration: number) =>
  Math.max(0, Math.min(leftDuration, rightDuration) / 2)

/**
 * The longest fade an edge can take: the whole clip, less whatever a boundary at the
 * other end of the SAME clip already uses, so the two never overlap.
 */
export const maxEdgeFade = (duration: number, neighbourFade: number) =>
  Math.max(0, duration - Math.max(0, neighbourFade))

/**
 * Resolves the fades actually applied to each clip. A boundary fades the
 * preceding clip out and the following clip in, and an edge fades the first clip in
 * from black or the last clip out to black. The last clip has no boundary after it, so
 * any request there is ignored.
 */
export const resolveFades = (durations: number[], requests: number[], edges: { head?: number; tail?: number } = {}): ClipFade[] => {
  const fades: ClipFade[] = durations.map(() => ({ fadeIn: 0, fadeOut: 0 }))
  for (let index = 0; index < durations.length - 1; index++) {
    const requested = Math.max(requests[index] || 0, 0)
    const applied = Math.min(requested, maxFadeAtBoundary(durations[index], durations[index + 1]))
    if (applied <= 0) continue
    fades[index].fadeOut = applied
    fades[index + 1].fadeIn = applied
  }
  const last = durations.length - 1
  if (last >= 0) {
    // The edges are clamped against the same clip's boundary fade, not against a neighbour's,
    // because there is no neighbour on the outside of the timeline to make room for.
    const head = Math.max(edges.head || 0, 0)
    if (head > 0) fades[0].fadeIn = Math.min(head, maxEdgeFade(durations[0], fades[0].fadeOut))
    const tail = Math.max(edges.tail || 0, 0)
    if (tail > 0) fades[last].fadeOut = Math.min(tail, maxEdgeFade(durations[last], fades[last].fadeIn))
  }
  return fades
}

/**
 * Re-keys clip-scoped maps after clips move, so trims and transitions follow their
 * clip instead of staying on an index that now belongs to a different one.
 *
 * Occurrences are matched in order. Looking each path up by its first index put the
 * second occurrence's entry onto the first one, which duplicated a fade onto a cut
 * the user never set and could drop it from the cut they did, whenever the same file
 * appeared twice in one job.
 */
export const rekeyClipMap = <T>(
  map: Record<string, T> | undefined,
  previousPaths: string[],
  nextPaths: string[],
): Record<string, T> | undefined => {
  if (!map) return undefined
  const unclaimed = new Map<string, number[]>()
  previousPaths.forEach((sourcePath, index) => {
    const indices = unclaimed.get(sourcePath)
    if (indices) indices.push(index)
    else unclaimed.set(sourcePath, [index])
  })
  const rekeyed: Record<string, T> = {}
  nextPaths.forEach((sourcePath, nextIndex) => {
    const previousIndex = unclaimed.get(sourcePath)?.shift()
    const value = (previousIndex !== undefined ? map[`${sourcePath}#${previousIndex}`] : undefined)
      ?? map[`${sourcePath}#${nextIndex}`]
      ?? map[sourcePath]
    if (value !== undefined) rekeyed[`${sourcePath}#${nextIndex}`] = value
  })
  return Object.keys(rekeyed).length ? rekeyed : undefined
}

/**
 * Re-keys a clip map after ONE clip is MOVED from one place to another, so its trims and fades travel with
 * it even when the job holds the same file twice.
 *
 * `rekeyClipMap` matches occurrences in order, which is right for a removal or a reorder of DISTINCT paths —
 * each file's k-th occurrence is the same clip either way. Two copies of one file share a path, though, and
 * an in-order match cannot tell which of them moved: it leaves each record on the place it already had, so
 * a drag that swaps the two reads as a reorder and changes nothing at all. A MOVE is unambiguous where a
 * list of paths is not, so the caller that knows which clip was dragged passes the two places, and the
 * records are moved by the same splice.
 */
export const moveClipMap = <T>(
  map: Record<string, T> | undefined,
  previousPaths: string[],
  from: number,
  to: number,
): Record<string, T> | undefined => {
  if (!map) return undefined
  if (from < 0 || from >= previousPaths.length || to < 0 || to >= previousPaths.length) return rekeyClipMap(map, previousPaths, previousPaths)
  const order = previousPaths.map((_, index) => index)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  const rekeyed: Record<string, T> = {}
  order.forEach((previousIndex, nextIndex) => {
    const sourcePath = previousPaths[previousIndex]
    const value = map[`${sourcePath}#${previousIndex}`] ?? map[sourcePath]
    if (value !== undefined) rekeyed[`${sourcePath}#${nextIndex}`] = value
  })
  return Object.keys(rekeyed).length ? rekeyed : undefined
}

/**
 * Consulted only when the task itself carries no timing for a source, which is
 * the normal case: `sourceInfo` and `sourceMetadata` are read all over the app
 * but are never actually populated, so durations have to be probed on demand.
 */
export type TimingResolver = (sourcePath: string) => SourceTiming | undefined

export interface BuildTimelineOptions {
  resolveTiming?: TimingResolver
}

/** `sourceInfo` describes the task's first source only, never its tracks. */
const primarySource = (task: QueueTask) => task.sourcePaths[0]

/**
 * The first PICTURE in a job, which is the clip the output frame follows when it follows the source.
 *
 * The first one rather than any other, and a picture rather than a track: a job's own list is in the
 * order it will be joined, so its first visual is where the output starts. An audio track is not a
 * picture and cannot set the output's shape, and a job that is nothing but tracks has none at all —
 * which is why this answers with nothing rather than with a track. Order is the whole of the rule, so
 * a job whose first source is a track and whose second is a clip follows the clip.
 */
export const firstVisualSource = (task: Pick<QueueTask, 'sourcePaths'>): string | undefined =>
  task.sourcePaths.find((sourcePath) => mediaKind(sourcePath) !== 'audio')

/**
 * The picture MATCH SOURCE takes its size from: the clip in hand, or — with no picture in hand — the
 * first picture in the job.
 *
 * The clip in hand rather than the first because the button says what the frame BEING EDITED is, and
 * a frame is a fact about a clip while a job has more than one. A track in hand is no picture, so a
 * job whose playhead rests on a track still follows its first visual rather than having no answer.
 * With nothing selected at all the answer is the same as the job's first, which is where an untouched
 * frame already stands.
 */
export const matchSourceSource = (task: Pick<QueueTask, 'sourcePaths'>, selected: string | undefined): string | undefined =>
  selected && mediaKind(selected) !== 'audio' ? selected : firstVisualSource(task)

export const sequenceFor = (task: QueueTask, sourcePath: string | undefined): SequenceInput | undefined => {
  if (!sourcePath) return undefined
  return task.sequenceInputs?.[sourcePath] || (task.sequenceInput?.firstFrame === sourcePath ? task.sequenceInput : undefined)
}

export const trimFor = (task: QueueTask, sourcePath: string | undefined, index: number) =>
  task.trimPoints?.[`${sourcePath}#${index}`] || (sourcePath ? task.trimPoints?.[sourcePath] : undefined)

/** The lane the clips themselves are on, whose audio is whatever they have embedded. */
export const MAIN_LANE_ID = 'main'

/**
 * Whether the export carries a lane's audio.
 *
 * The M toggle in the editor and the encoder's own mapping both ask this, so a lane cannot be muted
 * on screen and carried in the output, which is what the two of them deciding separately would
 * eventually do.
 */
export const laneIsMuted = (task: QueueTask, laneId: string): boolean => Boolean(task.mutedLanes?.[laneId])

/**
 * Whether a job's visuals are concatenated, which is where crops and fits are per clip.
 *
 * A stitch always joins clips; a combo joins them only when it has more than one visual, since a
 * combo with a single one is a multi-track job with a track beside it. Everywhere else there is one
 * picture and the job-wide crop and resolution own its framing.
 */
export const clipsConcatenate = (task: Pick<QueueTask, 'type' | 'sourcePaths'>): boolean =>
  task.type === 'stitch' || (task.type === 'combo' && task.sourcePaths.filter((source) => mediaKind(source) !== 'audio').length > 1)
/**
 * Whether a fit chosen for a clip can be applied at all, which is a question about the COMMAND.
 *
 * An audio-only export has no picture; a stream copy re-muxes what is already there rather than
 * decoding it; and a GIF is built by `filter_complex` with a mapping of its own. Offering the item
 * where none of those holds is the honest thing for the editor to do — the alternative is an item
 * that can be clicked and does nothing, which reads as the editor having lost the choice.
 */
export const canApplyClipFit = (preset: EncodingPreset): boolean =>
  preset.outputMode !== 'audio' && outputCarriesPicture(preset.container) && preset.videoCodec !== 'copy' && preset.container !== 'gif'

/**
 * Whether a job's export carries a picture of its own.
 *
 * Asked in two places that have to agree. A sound file asked for a video preset is a video job: its
 * export holds a video stream, so the lane the export writes is the picture lane and is named as
 * such. The encoder asks the same question to know it has to SUPPLY that picture — a source with no
 * frame of its own would otherwise leave a container that is a video file in name only. The lane's
 * NAME follows the export; what the lane holds does not, because the file still has no frames and is
 * still drawn as what it is.
 *
 * A container that cannot hold a picture at all is not a video job however the preset is set: a WAV
 * asked for one is still a WAV, so its lane says sound and no picture is supplied for it.
 */
export const jobExportsPicture = (task: Pick<QueueTask, 'preset'>): boolean =>
  task.preset.outputMode !== 'audio' && outputCarriesPicture(task.preset.container)

/**
 * Whether a clip's own framing is what the encoder must run, on a job whose clips are NOT joined.
 *
 * Where clips are concatenated every clip is normalized through its own chain, so a fit is a fit
 * there whether this says so or not. Where they are not — one visual, however many audio tracks sit
 * beside it — the picture used to be left entirely to the job's own resolution and crop, so a fit
 * chosen for that clip reached the editor and stopped there. It reaches the encoder now, and this is
 * the rule that decides when: a fit was chosen, and the command it will be folded into can carry a
 * filter chain at all.
 */
export const usesClipFraming = (task: QueueTask, sourcePath: string | undefined, index: number): boolean =>
  Boolean(sourceFitFor(task, sourcePath, index)) && canApplyClipFit(task.preset)

/**
 * Whether a clip's speed can actually reach the export, which is what decides whether it is offered.
 *
 * Speed is written as a filter chain, and the two paths that can carry one are the concatenating
 * normalizer (every clip of a stitch, and every visual of a combo that joins its visuals) and the
 * single-visual TRANSCODE. Everywhere else the picture is a graph's own or one of several muxed
 * streams, and a clip retimed on screen but not in the file would be worse than a clip that cannot be
 * retimed at all — so the model, the editor and the encoder ask this one question, and a job whose
 * answer is no is drawn and written at the clip's own speed whichever record it carries.
 */
export const canApplyClipSpeed = (task: Pick<QueueTask, 'type' | 'sourcePaths' | 'preset'>, sourcePath: string | undefined): boolean => {
  if (clipsConcatenate(task)) return true
  if (task.type !== 'transcode') return false
  return Boolean(sourcePath) && mediaKind(sourcePath as string) !== 'audio' && !isStillFrameJob(task as QueueTask)
}

/**
 * The crop that applies to one clip, in the left/top/right/bottom form the controls and the filter
 * both work in: the clip's own if it has one, and the job's if it has not.
 */
export const effectiveCropFor = (task: QueueTask, sourcePath: string | undefined, index: number): CropFractions | undefined => {
  const region = sourceCropFor(task, sourcePath, index)
  if (!region) return task.preset.crop
  return {
    left: region.x,
    top: region.y,
    right: Math.max(0, 1 - region.x - region.w),
    bottom: Math.max(0, 1 - region.y - region.h),
  }
}

/**
 * The clip's own place in the job, which is what a trim, a fit or a crop is keyed by.
 *
 * A segment knows its place by the key it was built with, and nothing else carries it, so it is
 * read back from there rather than re-derived by looking the path up: the same file can appear
 * twice in one job, and its first occurrence is not the one being shown.
 */
export const clipIndexOf = (segment: Pick<TimelineSegment, 'key'>): number => {
  const index = Number(segment.key.slice(segment.key.lastIndexOf('#') + 1))
  return Number.isInteger(index) && index >= 0 ? index : 0
}

/**
 * The fit a clip carries, by the same keying as its trim, so the two follow it together.
 *
 * A clip with none is not the same as a clip fitted by default: the default is the fit, and
 * this returning nothing is how "nothing chosen" is carried everywhere it is read.
 */
export const sourceFitFor = (task: QueueTask, sourcePath: string | undefined, index: number) =>
  task.sourceFit?.[`${sourcePath}#${index}`] || (sourcePath ? task.sourceFit?.[sourcePath] : undefined)

/**
 * The crop a clip carries, by the same keying again. An absent one is the whole clip — not an empty
 * crop: a clip with no entry at all has never been cropped, and the job-wide crop stands in for it
 * so that a job cropped before clips could be cropped one by one keeps the crop it had.
 */
export const sourceCropFor = (task: QueueTask, sourcePath: string | undefined, index: number) =>
  task.sourceCrop?.[`${sourcePath}#${index}`] || (sourcePath ? task.sourceCrop?.[sourcePath] : undefined)

/**
 * Interpreter rate for a source. An image sequence's own fps wins, matching the
 * `displayFps` rule the native frame-accurate preview uses, so both agree on
 * frame numbers for the same media.
 */
export const sourceFps = (
  task: QueueTask,
  sourcePath: string | undefined,
  sequence = sequenceFor(task, sourcePath),
  resolve?: TimingResolver,
): number => {
  if (sequence && sequence.fps > 0) return sequence.fps
  const metadataFps = sourcePath ? task.sourceMetadata?.[sourcePath]?.fps : undefined
  if (metadataFps && metadataFps > 0) return metadataFps
  // A still image has no rate of its own, and probing a JPEG can invent one anyway. If
  // that invented rate won here, the number on screen would disagree with the rate the
  // encoder renders at, which follows the same record then the preset then 25.
  if (sourcePath && !sequence && mediaKind(sourcePath) === 'image') {
    return task.preset.fps && task.preset.fps > 0 ? task.preset.fps : 25
  }
  if (sourcePath && sourcePath === primarySource(task)) {
    const streamFps = task.sourceInfo?.videoStreams?.[0]?.fps
    if (streamFps && streamFps > 0) return streamFps
  }
  const probedFps = sourcePath ? resolve?.(sourcePath)?.fps : undefined
  if (probedFps && probedFps > 0) return probedFps
  if (task.preset.fps && task.preset.fps > 0) return task.preset.fps
  return 25
}

/**
 * The rate a source runs at natively, as an exact rational.
 *
 * The same precedence `sourceFps` has always used — a sequence's own rate, then the recorded rate, then the
 * probe's — but held as `num/den`, so a source probed at 29.97 and a preset chosen at 29.97 are the same
 * rate and a long reel's frame count does not drift.
 */
export const nativeRateFor = (
  task: QueueTask,
  sourcePath: string | undefined,
  sequence = sequenceFor(task, sourcePath),
  resolve?: TimingResolver,
): FrameRate => rateOf(sourceFps(task, sourcePath, sequence, resolve))

/**
 * The rate a clip's frames are read at: its own record where it has one, and the source's native rate where
 * it does not. Keyed like its trim and its speed, so it follows the clip through a reorder, and an absent
 * record is not a rate of 1 — it is the source's own, which is what leaves the clip untouched.
 */
export const clipRateFor = (task: QueueTask, sourcePath: string | undefined, index: number, native: FrameRate): FrameRate => {
  const record = task.sourceFps?.[`${sourcePath}#${index}`] ?? (sourcePath ? task.sourceFps?.[sourcePath] : undefined)
  return record && record.num > 0 && record.den > 0 ? makeRate(record.num, record.den) : native
}

/**
 * How long a still image's clip should be.
 *
 * A record against the source wins over the job-wide default, so one still in a stitch can
 * be given its own length from MEDIA INFO. The timeline, the generated clip and the encoder
 * all resolve it here, which is what keeps the three showing the same number. A probe is
 * never consulted: an image has no intrinsic runtime, and a probe of one reports a single
 * frame.
 */
export const stillSecondsFor = (task: QueueTask, sourcePath: string | undefined): number => {
  const recorded = sourcePath ? task.sourceMetadata?.[sourcePath]?.duration : undefined
  if (recorded && recorded > 0) return recorded
  return Math.max(0.1, task.stillImageDuration || DEFAULT_STILL_SECONDS)
}

/**
 * How long a source contributes to the output.
 *
 * The encoder gives a still frame `-t next to stillSecondsFor`, and derives a sequence's
 * length from its frame count over the interpreted fps, so both are resolved here rather
 * than left at zero.
 */
export const sourceDuration = (
  task: QueueTask,
  sourcePath: string | undefined,
  sequence = sequenceFor(task, sourcePath),
  resolve?: TimingResolver,
): number => {
  if (sequence && sequence.fps > 0 && sequence.frameCount > 0) return sequence.frameCount / sequence.fps
  if (sourcePath && !sequence && mediaKind(sourcePath) === 'image') return stillSecondsFor(task, sourcePath)
  const metadataDuration = sourcePath ? task.sourceMetadata?.[sourcePath]?.duration : undefined
  if (metadataDuration && metadataDuration > 0) return metadataDuration
  if (sourcePath && sourcePath === primarySource(task) && task.sourceInfo?.duration) return task.sourceInfo.duration
  const probedDuration = sourcePath ? resolve?.(sourcePath)?.duration : undefined
  return probedDuration && probedDuration > 0 ? probedDuration : 0
}

/**
 * How much of a source reaches the output, and from where.
 *
 * Mirrors the encoder: it emits `-ss in -t (out - in)` and applies nothing when
 * the trim is unusable, so an out point past the end of the media is clamped and
 * an in point on its own runs to the end of the source.
 */
export const segmentTiming = (fullDuration: number, trim?: { in: number; out: number }) => {
  if (!trim || (trim.in <= 0 && trim.out <= trim.in)) return { duration: fullDuration, sourceIn: 0, trimmed: false }
  const sourceIn = Math.max(0, trim.in)
  if (trim.out > trim.in) {
    const out = fullDuration > 0 ? Math.min(trim.out, fullDuration) : trim.out
    return { duration: Math.max(0, out - sourceIn), sourceIn, trimmed: true }
  }
  return { duration: fullDuration > 0 ? Math.max(0, fullDuration - sourceIn) : 0, sourceIn, trimmed: true }
}

const segmentFor = (task: QueueTask, sourcePath: string, index: number, start: number, options: BuildTimelineOptions): TimelineSegment => {
  const sequence = sequenceFor(task, sourcePath)
  const full = sourceDuration(task, sourcePath, sequence, options.resolveTiming)
  const timing = segmentTiming(full, trimFor(task, sourcePath, index))
  const isStill = !sequence && mediaKind(sourcePath) === 'image'
  // The trim is measured in SOURCE seconds — that is what the encoder asks ffmpeg for — and the
  // timeline length is that divided by the RETIME, which is the clip's speed with its interpreted rate
  // folded in. At the source's own rate and its own speed the retime is one and the length is the trim,
  // which is what every reader of `duration` before either existed still gets. Both are only read where the
  // export can carry them, so a drawn timeline can never show a retiming the file will not.
  const nativeRate = nativeRateFor(task, sourcePath, sequence, options.resolveTiming)
  // The rate is only read where the export can carry a retime, exactly as the speed is: a clip drawn
  // reinterpreted while the file is written at the source's own rate would be worse than one that could not
  // be reinterpreted at all.
  const carried = canApplyClipSpeed(task, sourcePath)
  const rate = carried ? clipRateFor(task, sourcePath, index, nativeRate) : nativeRate
  const speed = carried ? speedFor(task, sourcePath, index) : DEFAULT_CLIP_SPEED
  // Held to the same bounds the SPEED is, so the length the timeline draws and the seek the monitor makes
  // are the one figure `clipDurationFor` also clamps: an extreme composition cannot draw a length the
  // encoder would write at a different one.
  const retime = clampClipSpeed(clipRetime(speed.speed, rate, nativeRate))
  return {
    key: `${sourcePath}#${index}`,
    sourcePath,
    start,
    duration: clipDurationFor(timing.duration, retime),
    sourceUsedSeconds: timing.duration,
    speed: retime,
    rate,
    nativeRate,
    speedInterpolation: speed.interpolation,
    maintainPitch: speed.maintainPitch !== false,
    sourceIn: timing.sourceIn,
    trimmed: timing.trimmed,
    sequence: sequence ? { frames: sequence.frameCount, fps: sequence.fps } : undefined,
    still: isStill || undefined,
  }
}

/** The whole frames a second a rate is COUNTED in, which is what a timecode's last field runs to. */
const nominalRate = (input: RateInput): number => Math.max(1, Math.round(rateValue(input)))

/** Same timecode shape the native preview prints: HH:MM:SS.FF */
export const timecode = (seconds: number, input: RateInput) => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const nominal = nominalRate(input)
  const totalFrames = frameCount(safeSeconds, input)
  const frames = totalFrames % nominal
  const whole = Math.floor(totalFrames / nominal)
  return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(frames).padStart(2, '0')}`
}

export const frameStamp = (seconds: number, input: RateInput) => `FRAME ${frameNumber(seconds, input)}`

/**
 * The seconds a timecode of the window's own shape stands for: HH:MM:SS.FF.
 *
 * The last field is SECONDS AND FRAMES rather than a decimal fraction — `00:00:13.10` is thirteen seconds
 * and ten frames, which is what `timecode` writes and therefore what a reader types back into it. The
 * groups are optional and may be left half-typed, so `13`, `00:13` and `00:00:13.10` all read; anything
 * that is not a figure at all answers with nothing, and the field leaves the value where it was.
 */
export const secondsFromTimecode = (text: string, input: RateInput): number | null => {
  const rate = nominalRate(input)
  const trimmed = text.trim()
  if (!trimmed) return null
  const groups = trimmed.split(':')
  const last = groups.pop() ?? ''
  const [secondsText, framesText] = last.split('.')
  const whole = Number(secondsText)
  if (!Number.isFinite(whole)) return null
  const frames = framesText === undefined || framesText === '' ? 0 : Number(framesText)
  if (!Number.isFinite(frames)) return null
  const before = groups.map(Number)
  if (before.some((value) => !Number.isFinite(value))) return null
  // HH:MM before the last group, or MM when only one of them is there.
  const lead = before.length === 2 ? before[0] * 3600 + before[1] * 60 : before.length === 1 ? before[0] * 60 : 0
  return Math.max(0, lead + whole + frames / rate)
}

/**
 * The frame a time falls on, as a number and nothing else.
 *
 * A stamp carries the word FRAME because it is read on its own; a scale does not, because the column of
 * numbers under it says what they are — ten labels all saying FRAME would be nine words too many.
 */
export const frameNumber = (seconds: number, input: RateInput) => String(frameCount(seconds, input)).padStart(6, '0')

/**
 * Where the playhead is and how long the output is, as one line.
 *
 * "of" rather than a slash, and the frame stamp's own word said once rather than twice: a reader
 * comparing the two numbers wants the numbers, and a unit repeated on both sides of the join is a unit
 * read twice. A framestamp is therefore spelled out here rather than by joining two stamps.
 */
export const stampPair = (position: number, total: number, input: RateInput, mode: 'framestamp' | 'timestamp'): string => {
  const rate = input
  const frames = (seconds: number) => String(frameCount(seconds, rate)).padStart(6, '0')
  return mode === 'framestamp'
    ? `FRAME ${frames(position)} of ${frames(total)}`
    : `${timecode(position, rate)} of ${timecode(total, rate)}`
}

/**
 * The unit a range is measured in, which is the window's setting rather than a fact about the clip.
 *
 * A framestamp counts frames and a timestamp prints timecodes, and the two appear in the same place, so the
 * word naming the figure has to move with the mode rather than being written into either call site.
 */
const rangeUnit = (mode: 'framestamp' | 'timestamp'): string => (mode === 'framestamp' ? 'FRAMES' : 'TIME')

/** A length in whichever unit the window is showing, unpadded: a count of frames, or a timecode. */
const rangeValue = (seconds: number, rate: RateInput, mode: 'framestamp' | 'timestamp'): string =>
  mode === 'framestamp' ? String(frameCount(seconds, rate)) : timecode(seconds, rate)

/** What a clip's own run through its source is read from. */
export interface ClipRangeInput {
  /** How much of the source the output uses. */
  usedSeconds: number
  /** Where in the source that run begins. */
  sourceIn: number
  /** The whole source, which is what the clip is a piece of. */
  totalSeconds: number
  /** The rate the clip is measured at: the source's own, so the frames are the source's frames. */
  fps: RateInput
  mode: 'framestamp' | 'timestamp'
}

/**
 * A clip's own run through its source: how much is used, the range it covers, and how much there is of it.
 *
 * The range's ends are padded to six digits in frames so the two ends read as a box of digits, while the
 * counts around it are left unpadded because they are READ as numbers rather than as positions — the same
 * distinction the scale makes between a mark and a length. It says nothing about TRIMMING: a clip that uses
 * all of its source draws a range around all of it, which is a fact rather than a fault, and the reader can
 * see from the range that nothing was taken away.
 */
export const clipRangeLabel = ({ usedSeconds, sourceIn, totalSeconds, fps, mode }: ClipRangeInput): string => {
  const rate = fps
  const padded = (seconds: number) => String(frameCount(seconds, rate)).padStart(6, '0')
  const range = mode === 'framestamp'
    ? `[${padded(sourceIn)}-${padded(sourceIn + usedSeconds)}]`
    : `[${timecode(sourceIn, rate)}-${timecode(sourceIn + usedSeconds, rate)}]`
  return `${rangeUnit(mode)}: ${rangeValue(usedSeconds, rate, mode)} ${range} OF ${rangeValue(totalSeconds, rate, mode)}`
}

/** How long the assembled output is, in the same terms — the other half of the line under the monitor. */
export const outputRangeLabel = (seconds: number, fps: RateInput, mode: 'framestamp' | 'timestamp'): string =>
  `TOTAL OUTPUT ${rangeUnit(mode)}: ${rangeValue(seconds, fps, mode)}`

/**
 * Whether a clip uses the whole of its source, which is the same question as whether its trim takes
 * anything away.
 *
 * A trim that spans the source IS the source, and a still's chosen length is the whole of it in the same
 * way. Saying "trimmed" or drawing a range around all of it is saying something the numbers contradict —
 * and it is said in two places: the clip's tooltip and the line inside the clip's own box. It is asked
 * of the SOURCE run rather than of the timeline length, because it is a question about the trim and a
 * speed changes the timeline length without touching what was kept.
 */
export const usesAllSource = (segment: Pick<TimelineSegment, 'sourceUsedSeconds' | 'sourceIn'>, totalSeconds: number): boolean =>
  segment.sourceIn <= 1e-6 && segment.sourceUsedSeconds >= totalSeconds - 1e-6

/** What a clip's tooltip needs to say, in the terms the window is showing lengths in. */
export interface ClipSummaryInput {
  /** The whole source, which is what the clip is a piece of. */
  totalSeconds: number
  /** The rate the clip is measured at: the source's own, or the project's for a track. */
  fps: RateInput
  /** How much of the source the output uses. */
  usedSeconds: number
  /** Where in the source that piece starts. */
  sourceIn: number
  /** Whether any of it was taken away, which is the difference between the two spellings. */
  trimmed: boolean
  mode: 'framestamp' | 'timestamp'
}

/**
 * A clip in one line: what it is made of, and what the output takes from it.
 *
 * The same shape for a picture and a track, because it is the same question: how much of this source is
 * there, and how much of it is being used. What differs is only the unit, and that is the window's own
 * setting rather than a fact about the clip — a track measured in frames is counted at the project's
 * rate, which is the only rate it has, and a track measured in timecodes is read as the time it is.
 *
 * A clip that uses all of its source says "source" rather than repeating the whole length twice, since
 * the two figures would be the same figure.
 */
export const clipSummary = ({ totalSeconds, fps, usedSeconds, sourceIn, trimmed, mode }: ClipSummaryInput): string => {
  const rate = fps
  const frames = (seconds: number) => String(frameCount(seconds, rate))
  const stamp = (seconds: number) => (mode === 'framestamp' ? frames(seconds) : timecode(seconds, rate))
  const whole = mode === 'framestamp' ? `${frames(totalSeconds)} frames` : timecode(totalSeconds, rate)
  // A trim that takes NOTHING away is not a trim: a range that spans the whole source IS the source, and
  // "2160 trimmed frames [0000-2160]" about a clip that uses all of it is a range drawn around everything.
  // A still is the same case — its chosen length is the whole of it — so it says source too.
  if (!trimmed || usesAllSource({ sourceUsedSeconds: usedSeconds, sourceIn }, totalSeconds)) return `${whole} at ${rate} fps | source`
  const used = mode === 'framestamp' ? `${frames(usedSeconds)} trimmed frames` : `${timecode(usedSeconds, rate)} trimmed`
  // The range is padded to four digits in frames, because a range is read as a box of digits rather
  // than as two numbers, and a ragged box is read twice.
  const range = mode === 'framestamp'
    ? `[${stamp(sourceIn).padStart(4, '0')}-${stamp(sourceIn + usedSeconds).padStart(4, '0')}]`
    : `[${stamp(sourceIn)}-${stamp(sourceIn + usedSeconds)}]`
  return `${whole} at ${rate} fps | ${used} ${range}`
}

/**
 * Draws the fades the encoder will actually render onto the clips they belong to,
 * using the one clamping rule, so a drawn ramp can never disagree with the output.
 */
const applyFades = (task: QueueTask, segments: TimelineSegment[]) => {
  const fades = resolveFades(
    segments.map((segment) => segment.duration),
    segments.map((segment, index) => transitionDuration(task, segment.sourcePath, index)),
    { head: edgeFade(task, 'head'), tail: edgeFade(task, 'tail') },
  )
  segments.forEach((segment, index) => {
    if (fades[index].fadeIn > 0) segment.fadeIn = fades[index].fadeIn
    if (fades[index].fadeOut > 0) segment.fadeOut = fades[index].fadeOut
  })
  return segments
}

/**
 * Builds the consolidated timeline the output will actually have.
 *
 * STITCH concatenates every source in order. TRANSCODE, MULTI-TRACK and COMBO
 * map a single video stream and mux their audio tracks alongside it from zero,
 * so the finished length is the longer of the video and the longest track, which
 * is exactly how the encoder reconciles them (padding video with a freeze frame).
 *
 * COMBO is modelled as multi-track because the encoder dispatches purely on
 * `type`, and never reads `comboMode`.
 */
/**
 * A single frame in and a single frame out. Such a job has nothing to time, so it
 * gets no timeline, and its still previews through the lite helper.
 */
export const isStillFrameJob = (task: QueueTask) => task.preset.imageOutputMode === 'still'

/** Whether a job's sources hold anything with a timeline of its own: footage, or an interpreted sequence. */
export const taskHasFootage = (task: Pick<QueueTask, 'sourcePaths' | 'sequenceInput' | 'sequenceInputs'>): boolean =>
  task.sourcePaths.some((source) => mediaKind(source) === 'video')
  || Boolean(task.sequenceInput)
  || Object.keys(task.sequenceInputs ?? {}).length > 0

/**
 * A job with nothing to TIME: one frame in, one frame out, out of a source that is itself one frame.
 *
 * `isStillFrameJob` says the OUTPUT is a single frame, which is a fact about the preset and stays true
 * however long the source is. That is not the same as having nothing to time. A VIDEO asked for one PNG
 * has every frame of itself to choose from, so hiding the timeline for it took away the only way to say
 * WHICH frame — and SINGLE FRAME now means the frame under the playhead. So the timeline is withheld only
 * when the source is a lone still, where there is genuinely nothing to scrub.
 */
export const nothingToTime = (task: QueueTask): boolean => isStillFrameJob(task) && !taskHasFootage(task)

export const buildTimeline = (task: QueueTask, options: BuildTimelineOptions = {}): TimelineModel => {
  if (nothingToTime(task)) return { lanes: [], duration: 0, unusedVideoSources: [] }
  const lanes: TimelineLane[] = []

  if (task.type === 'stitch') {
    let cursor = 0
    const segments = task.sourcePaths.map((sourcePath, index) => {
      const segment = segmentFor(task, sourcePath, index, cursor, options)
      cursor += segment.duration
      return segment
    })
    // Fades are resolved from the same rules the encoder applies, so the drawn
    // ramp is what will actually be rendered.
    applyFades(task, segments)
    const audioOnly = task.sourcePaths.length > 0 && task.sourcePaths.every((sourcePath) => mediaKind(sourcePath) === 'audio')
    // A job whose export carries a picture is named for the picture it writes, whatever its sources
    // hold: a stitch of sound files asked for a video preset is a video job.
    const soundLane = audioOnly && !jobExportsPicture(task)
    lanes.push({ id: MAIN_LANE_ID, label: soundLane ? 'AUDIO 1' : 'VIDEO', kind: audioOnly ? 'audio' : 'video', embedded: true, segments, duration: cursor })
    return { lanes, duration: cursor, unusedVideoSources: [] }
  }

  // A combo concatenates its visuals, which is what the encoder now does with them.
  // A multi-track job maps a single video stream, so anything past the first is
  // unused and is reported as such.
  const concatenatesVisuals = task.type === 'combo' && task.sourcePaths.length > 1
  const visualSources = concatenatesVisuals ? task.sourcePaths : task.sourcePaths.slice(0, 1)
  let cursor = 0
  const mainSegments = visualSources.map((sourcePath, index) => {
    const segment = segmentFor(task, sourcePath, index, cursor, options)
    cursor += segment.duration
    return segment
  })
  const mainSource = visualSources[0]
  const mainIsAudio = mainSource != null && mediaKind(mainSource) === 'audio'
  // Named for the export, not for the file: a lone sound file asked for a video preset is a video
  // job whose export carries a black picture beside the track, so its lane says VIDEO.
  const mainNamesItselfSound = mainIsAudio && !jobExportsPicture(task)
  // A combo that concatenates has real cuts, so its fades are resolved here too.
  // A multi-track job has a single clip, where resolveFades finds no boundary.
  applyFades(task, mainSegments)
  lanes.push({
    id: MAIN_LANE_ID,
    label: mainNamesItselfSound ? 'AUDIO 1' : 'VIDEO',
    kind: mainIsAudio ? 'audio' : 'video',
    embedded: true,
    segments: mainSegments,
    duration: cursor,
  })

  // Audio tracks play in parallel from the start, keyed by index zero, which is
  // how the queue stores their trim points and how the encoder reads them.
  const tracks = task.additionalAudioTracks || []
  tracks.forEach((track, index) => {
    const segment = segmentFor(task, track.path, 0, 0, options)
    const language = (track.language || '').toLowerCase()
    lanes.push({
      id: track.id,
      label: `AUDIO ${index + 1}${language && language !== 'und' ? ` ${language.toUpperCase()}` : ''}`,
      kind: 'audio',
      embedded: false,
      segments: [segment],
      duration: segment.duration,
    })
  })

  const duration = lanes.reduce((longest, lane) => Math.max(longest, lane.duration), 0)
  return { lanes, duration, unusedVideoSources: concatenatesVisuals ? [] : task.sourcePaths.slice(1) }
}

/** Which lane segment sits under a consolidated time, if any. */
export const segmentAt = (lane: TimelineLane | undefined, seconds: number): TimelineSegment | undefined => {
  if (!lane) return undefined
  return lane.segments.find((segment) => seconds >= segment.start && seconds < segment.start + segment.duration)
    || (seconds >= lane.duration && lane.segments.length ? lane.segments[lane.segments.length - 1] : undefined)
}
