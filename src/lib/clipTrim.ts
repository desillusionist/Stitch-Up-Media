/**
 * Trimming a clip: choosing which part of its SOURCE the job keeps.
 *
 * A trim is a WINDOW into the source — `{ in, out }` in SOURCE seconds — which is exactly what the encoder
 * asks ffmpeg for (`-ss in -t (out - in)`). Kept in the source's own terms rather than in timeline seconds,
 * so it means the same thing at any speed or output rate: the clip's retime turns a run of source into the
 * length it occupies, and a trim does not care how long that is. The drag arrives here as SOURCE seconds
 * because the caller divides the pointer's travel by that retime.
 *
 * The window is dragged by ONE edge at a time, and the other edge is held: that is what makes a trim a trim
 * rather than a slip or a move. A clip may never be closed to nothing, so an edge stops one minimum short of
 * the other, and the out edge stops at the end of the source where its length is known.
 */

/** The part of a source a clip keeps, in source seconds. */
export interface TrimWindow {
  in: number
  out: number
}

/**
 * The shortest run a clip may keep.
 *
 * A frame would be a nicer floor, but the frame size belongs to the clip's rate and this arithmetic is kept
 * about the source's seconds; a millisecond is far below any real frame and still leaves the encoder a run it
 * can write, which is what the floor is for.
 */
export const MIN_TRIM_SECONDS = 1 / 1000

/** The window a clip currently keeps, from the run its segment reports: the in point, and how much it uses. */
export const trimWindowOf = (sourceIn: number, usedSeconds: number): TrimWindow => {
  const start = Number.isFinite(sourceIn) && sourceIn > 0 ? sourceIn : 0
  const used = Number.isFinite(usedSeconds) && usedSeconds > 0 ? usedSeconds : 0
  return { in: start, out: start + used }
}

/**
 * The window after one edge is dragged `deltaSource` seconds of SOURCE (positive to the right).
 *
 * The dragged edge moves and the other is held. The in edge cannot pass below zero nor above the out edge less
 * the minimum; the out edge cannot pass below the in edge plus the minimum, nor above the whole source — where
 * the source's length is known at all, which is what `full` says. An unknown length (zero) leaves the out edge
 * unbounded, so a clip whose file has not been probed yet can still be trimmed by ear rather than refusing.
 */
export const dragTrimWindow = (
  window: TrimWindow,
  edge: 'in' | 'out',
  deltaSource: number,
  full: number,
  min = MIN_TRIM_SECONDS,
): TrimWindow => {
  const floor = Math.max(0, min)
  const delta = Number.isFinite(deltaSource) ? deltaSource : 0
  if (edge === 'in') {
    const ceiling = window.out - floor
    return { in: Math.max(0, Math.min(window.in + delta, ceiling)), out: window.out }
  }
  const ceiling = full > 0 ? full : window.out + Math.max(0, delta)
  return { in: window.in, out: Math.min(ceiling, Math.max(window.in + floor, window.out + delta)) }
}

/**
 * Whether a window keeps the whole source, which is no trim at all.
 *
 * Such a window leaves NO record rather than one that says "everything", so an untouched clip stays off the
 * job's record exactly as one that was never trimmed — the same rule the speed, the fit and the crop follow.
 * A source of unknown length cannot be judged, so the window is kept rather than silently dropped.
 */
export const windowIsWholeSource = (window: TrimWindow, full: number): boolean =>
  full > 0 && window.in <= 1e-6 && window.out >= full - 1e-6
