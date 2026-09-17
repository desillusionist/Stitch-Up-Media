import { ClipTransition, QueueTask, SequenceInput } from '../types'
import { mediaKind } from './mediaKind'

/** Default length the encoder gives a still frame that outlives its configured duration. */
const DEFAULT_STILL_SECONDS = 10

export interface TimelineSegment {
  key: string
  sourcePath: string
  /** Offset on the consolidated timeline, in seconds. */
  start: number
  /** How long this segment contributes to the finished output. */
  duration: number
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
 * A boundary fade cannot exceed half of either neighbour, or the two sides would
 * overlap inside a clip. The encoder and the timeline both clamp through this, so
 * the picture and the drawn ramp cannot disagree.
 */
export const maxFadeAtBoundary = (leftDuration: number, rightDuration: number) =>
  Math.max(0, Math.min(leftDuration, rightDuration) / 2)

/**
 * Resolves the fades actually applied to each clip. A boundary fades the
 * preceding clip out and the following clip in. The last clip has no boundary
 * after it, so any request there is ignored.
 */
export const resolveFades = (durations: number[], requests: number[]): ClipFade[] => {
  const fades: ClipFade[] = durations.map(() => ({ fadeIn: 0, fadeOut: 0 }))
  for (let index = 0; index < durations.length - 1; index++) {
    const requested = Math.max(requests[index] || 0, 0)
    const applied = Math.min(requested, maxFadeAtBoundary(durations[index], durations[index + 1]))
    if (applied <= 0) continue
    fades[index].fadeOut = applied
    fades[index + 1].fadeIn = applied
  }
  return fades
}

/**
 * Re-keys clip-scoped maps after clips move, so trims and transitions follow their
 * clip instead of staying on an index that now belongs to a different one.
 */
export const rekeyClipMap = <T>(
  map: Record<string, T> | undefined,
  previousPaths: string[],
  nextPaths: string[],
): Record<string, T> | undefined => {
  if (!map) return undefined
  const rekeyed: Record<string, T> = {}
  nextPaths.forEach((sourcePath, nextIndex) => {
    const previousIndex = previousPaths.indexOf(sourcePath)
    const value = map[`${sourcePath}#${previousIndex}`] ?? map[`${sourcePath}#${nextIndex}`] ?? map[sourcePath]
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

export const sequenceFor = (task: QueueTask, sourcePath: string | undefined): SequenceInput | undefined => {
  if (!sourcePath) return undefined
  return task.sequenceInputs?.[sourcePath] || (task.sequenceInput?.firstFrame === sourcePath ? task.sequenceInput : undefined)
}

export const trimFor = (task: QueueTask, sourcePath: string | undefined, index: number) =>
  task.trimPoints?.[`${sourcePath}#${index}`] || (sourcePath ? task.trimPoints?.[sourcePath] : undefined)

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
 * How long a source contributes to the output.
 *
 * The encoder gives a still frame `-t stillImageDuration` (defaulting to ten
 * seconds), and derives a sequence's length from its frame count over the
 * interpreted fps, so both are resolved here rather than left at zero.
 */
export const sourceDuration = (
  task: QueueTask,
  sourcePath: string | undefined,
  sequence = sequenceFor(task, sourcePath),
  resolve?: TimingResolver,
): number => {
  if (sequence && sequence.fps > 0 && sequence.frameCount > 0) return sequence.frameCount / sequence.fps
  const metadataDuration = sourcePath ? task.sourceMetadata?.[sourcePath]?.duration : undefined
  if (metadataDuration && metadataDuration > 0) return metadataDuration
  if (sourcePath && !sequence && mediaKind(sourcePath) === 'image') {
    return Math.max(0.1, task.stillImageDuration || DEFAULT_STILL_SECONDS)
  }
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
  return {
    key: `${sourcePath}#${index}`,
    sourcePath,
    start,
    duration: timing.duration,
    sourceIn: timing.sourceIn,
    trimmed: timing.trimmed,
    sequence: sequence ? { frames: sequence.frameCount, fps: sequence.fps } : undefined,
    still: isStill || undefined,
  }
}

/** Same timecode shape the native preview prints: HH:MM:SS.FF */
export const timecode = (seconds: number, fps: number) => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const rate = fps > 0 ? Math.round(fps) : 25
  const totalFrames = Math.round(safeSeconds * rate)
  const frames = totalFrames % rate
  const whole = Math.floor(totalFrames / rate)
  return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(frames).padStart(2, '0')}`
}

export const frameStamp = (seconds: number, fps: number) => `FRAME ${String(Math.max(0, Math.round(seconds * fps))).padStart(6, '0')}`

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

export const buildTimeline = (task: QueueTask, options: BuildTimelineOptions = {}): TimelineModel => {
  if (isStillFrameJob(task)) return { lanes: [], duration: 0, unusedVideoSources: [] }
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
    const fades = resolveFades(
      segments.map((segment) => segment.duration),
      task.sourcePaths.map((sourcePath, index) => transitionDuration(task, sourcePath, index)),
    )
    segments.forEach((segment, index) => {
      if (fades[index].fadeIn > 0) segment.fadeIn = fades[index].fadeIn
      if (fades[index].fadeOut > 0) segment.fadeOut = fades[index].fadeOut
    })
    const audioOnly = task.sourcePaths.length > 0 && task.sourcePaths.every((sourcePath) => mediaKind(sourcePath) === 'audio')
    lanes.push({ id: 'main', label: audioOnly ? 'AUDIO 1' : 'VIDEO 1', kind: audioOnly ? 'audio' : 'video', embedded: true, segments, duration: cursor })
    return { lanes, duration: cursor, unusedVideoSources: [] }
  }

  const mainSource = task.sourcePaths[0]
  const mainIsAudio = mainSource != null && mediaKind(mainSource) === 'audio'
  const mainSegment = mainSource ? segmentFor(task, mainSource, 0, 0, options) : null
  lanes.push({
    id: 'main',
    label: mainIsAudio ? 'AUDIO 1' : 'VIDEO 1',
    kind: mainIsAudio ? 'audio' : 'video',
    embedded: true,
    segments: mainSegment ? [mainSegment] : [],
    duration: mainSegment?.duration ?? 0,
  })

  // Audio tracks play in parallel from the start, keyed by index zero, which is
  // how the queue stores their trim points and how the encoder reads them.
  const tracks = task.additionalAudioTracks || []
  tracks.forEach((track, index) => {
    const segment = segmentFor(task, track.path, 0, 0, options)
    const language = (track.language || '').toLowerCase()
    lanes.push({
      id: track.id,
      label: `AUDIO ${index + 2}${language && language !== 'und' ? ` ${language.toUpperCase()}` : ''}`,
      kind: 'audio',
      embedded: false,
      segments: [segment],
      duration: segment.duration,
    })
  })

  const duration = lanes.reduce((longest, lane) => Math.max(longest, lane.duration), 0)
  return { lanes, duration, unusedVideoSources: task.sourcePaths.slice(1) }
}

/** Which lane segment sits under a consolidated time, if any. */
export const segmentAt = (lane: TimelineLane | undefined, seconds: number): TimelineSegment | undefined => {
  if (!lane) return undefined
  return lane.segments.find((segment) => seconds >= segment.start && seconds < segment.start + segment.duration)
    || (seconds >= lane.duration && lane.segments.length ? lane.segments[lane.segments.length - 1] : undefined)
}
