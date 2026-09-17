import { TimelineSegment } from './timelineModel'

/**
 * A clock that runs on wall time, used whenever no media element is entitled to
 * own the playhead: a still frame, a tail past the end of the video, and all of
 * reverse playback.
 */
export interface ClockAnchor {
  position: number
  startedAt: number
  key: string | undefined
  direction: 1 | -1
  rate: number
}

export interface ClockInput {
  /** Position to start from when there is no usable anchor. */
  from: number
  /** Wall time, from `performance.now()`. */
  now: number
  /** Identity of the segment the clock is running over. */
  key: string | undefined
  reverse: boolean
  /** Signed shuttle rate. Zero means ordinary forward playback. */
  shuttleRate: number
}

/**
 * Advances the fallback clock one step.
 *
 * The shuttle rate is applied here because this clock is the only one a still
 * frame or a tail past the end of the video has. Without it a shuttle dropped to
 * normal speed on entering such a segment while the indicator still read 2x, 4x
 * or 8x.
 *
 * A rebase continues from the value it just computed rather than restarting from
 * `from`. `from` is the rendered position, which lags a frame behind, so
 * restarting from it stepped the playhead backwards at every cut.
 */
export const advanceClock = (anchor: ClockAnchor | null, input: ClockInput): { value: number; anchor: ClockAnchor } => {
  const direction: 1 | -1 = input.reverse ? -1 : 1
  const rate = Math.max(0.05, Math.abs(input.shuttleRate) || 1)
  const value = anchor
    ? anchor.position + anchor.direction * anchor.rate * (input.now - anchor.startedAt) / 1000
    : input.from
  const reusable = Boolean(anchor && anchor.key === input.key && anchor.direction === direction && anchor.rate === rate)
  return { value, anchor: reusable ? anchor as ClockAnchor : { position: value, startedAt: input.now, key: input.key, direction, rate } }
}

/**
 * Which clock owns the playhead at a given moment.
 *
 * The element is consulted only while it is actually holding its own segment.
 * Anywhere else, or once it has run past where the playhead sits, the fallback
 * clock takes over: an added audio track can outlast the video, and a position
 * beyond the video must not be dragged back to the cut.
 */
export const elementOwnsPosition = (
  segment: TimelineSegment | undefined,
  playhead: number,
  element: { readyState: number; ended: boolean; clock: number },
): boolean => {
  if (!segment || segment.still) return false
  if (element.readyState < 1 || element.ended) return false
  if (playhead > segment.start + segment.duration + 0.001) return false
  return element.clock - segment.sourceIn >= -0.05
}
