import { QueueTask, SequenceInput } from '../types'
import { mediaKind } from './mediaKind'

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
export const sourceFps = (task: QueueTask, sourcePath: string | undefined, sequence = sequenceFor(task, sourcePath)): number => {
  if (sequence && sequence.fps > 0) return sequence.fps
  const metadataFps = sourcePath ? task.sourceMetadata?.[sourcePath]?.fps : undefined
  if (metadataFps && metadataFps > 0) return metadataFps
  const streamFps = task.sourceInfo?.videoStreams?.[0]?.fps
  if (streamFps && streamFps > 0) return streamFps
  if (task.preset.fps && task.preset.fps > 0) return task.preset.fps
  return 25
}

/** A sequence derives its duration from frame count and interpreted fps, as the native preview does. */
export const sourceDuration = (task: QueueTask, sourcePath: string | undefined, sequence = sequenceFor(task, sourcePath)): number => {
  if (sequence && sequence.fps > 0 && sequence.frameCount > 0) return sequence.frameCount / sequence.fps
  const metadataDuration = sourcePath ? task.sourceMetadata?.[sourcePath]?.duration : undefined
  if (metadataDuration && metadataDuration > 0) return metadataDuration
  return task.sourceInfo?.duration ?? 0
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

const segmentFor = (task: QueueTask, sourcePath: string, index: number, start: number): TimelineSegment => {
  const timing = segmentTiming(sourceDuration(task, sourcePath), trimFor(task, sourcePath, index))
  return { key: `${sourcePath}#${index}`, sourcePath, start, duration: timing.duration, sourceIn: timing.sourceIn, trimmed: timing.trimmed }
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
export const buildTimeline = (task: QueueTask): TimelineModel => {
  const lanes: TimelineLane[] = []

  if (task.type === 'stitch') {
    let cursor = 0
    const segments = task.sourcePaths.map((sourcePath, index) => {
      const segment = segmentFor(task, sourcePath, index, cursor)
      cursor += segment.duration
      return segment
    })
    const audioOnly = task.sourcePaths.length > 0 && task.sourcePaths.every((sourcePath) => mediaKind(sourcePath) === 'audio')
    lanes.push({ id: 'main', label: audioOnly ? 'AUDIO 1' : 'VIDEO 1', kind: audioOnly ? 'audio' : 'video', embedded: true, segments, duration: cursor })
    return { lanes, duration: cursor, unusedVideoSources: [] }
  }

  const mainSource = task.sourcePaths[0]
  const mainIsAudio = mainSource != null && mediaKind(mainSource) === 'audio'
  const mainSegment = mainSource ? segmentFor(task, mainSource, 0, 0) : null
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
    const segment = segmentFor(task, track.path, 0, 0)
    lanes.push({
      id: track.id,
      label: `AUDIO ${index + 2} ${(track.language || 'und').toUpperCase()}`,
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
