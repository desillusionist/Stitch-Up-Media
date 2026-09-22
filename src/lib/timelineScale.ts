/**
 * How wide the EDIT JOB timeline is.
 *
 * A lane's width is a function of the ZOOM alone. `pxPerSec` is what a zoom level means — this many
 * pixels of lane per second of output — and a clip's lane is its trimmed length at that rate, so a
 * clip's box changes when the zoom changes and at no other time.
 *
 * The model this replaces derived the rate from the viewport, so every clip's box was a fraction of
 * the window: a resize re-laid the whole timeline out, and the thumbnails and clip boxes stretched
 * with it. That behaviour belongs to the QUICK LOOK helper's strip, which has one strip and no
 * scrollbar; a timeline is a scrolling view of a fixed drawing, and resizing the window should only
 * change how much of it is on screen.
 *
 * FIT is the one place the viewport is consulted, and only at the moment it is pressed: it sets the
 * zoom that makes the whole output as wide as the lane area visible then, less the room the marker on
 * the last cut needs — the marker straddles the edge it hangs on, so a lane area filled to its last
 * pixel would clip it and give the timeline a scrollbar. Afterwards the timeline is that wide until
 * the zoom changes again.
 */

/** The rate a lane is drawn at, in pixels per second of output, at 1x. */
export const BASE_PX_PER_SECOND = 24

/** The range the zoom may take. Below 1 because a long job has to be reachable, however long. */
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 32

/** Pixels of lane per second of output. The zoom decides it, and nothing else does. */
export const pxPerSec = (zoom: number): number =>
  BASE_PX_PER_SECOND * (Number.isFinite(zoom) && zoom > 0 ? zoom : 1)

/** A zoom held inside the range, with nonsense falling back to 1x. */
export const clampZoom = (zoom: number): number =>
  Number.isFinite(zoom) && zoom > 0 ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom)) : 1

/** How wide a clip of this length is drawn. The TRIMMED length, so a trim moves the cut. */
export const laneWidthFor = (seconds: number, zoom: number): number =>
  Math.max(0, Number.isFinite(seconds) ? seconds : 0) * pxPerSec(zoom)

/** The time a point in the lane area stands for, from the lane area's own left edge. */
export const secondsAt = (pixelsIntoLane: number, zoom: number): number =>
  (Number.isFinite(pixelsIntoLane) ? pixelsIntoLane : 0) / pxPerSec(zoom)

/**
 * The room FIT leaves past the end of the output, in pixels, for the marker on the last cut.
 *
 * The `[+]` that adds a trailing fade is centred on its clip's trailing edge, so it hangs half of its
 * own 17px width — and its border with it — past the end of the drawing. A fit that made the output
 * exactly as wide as the lane area would therefore put that marker outside the lane area: the button
 * would be clipped at its outer edge and the timeline would carry a horizontal scrollbar for the sake
 * of the last nine pixels of it.
 */
export const FIT_TRAILING_MARKER = 9

/**
 * The zoom that makes the whole output as wide as the lane area it is given, less that marker's room.
 *
 * Taken from the viewport only when it is asked for — pressing FIT — which is what keeps a fit
 * decision from being remade by every resize.
 */
export const fitZoom = (seconds: number, availableWidth: number): number => {
  const span = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const available = Number.isFinite(availableWidth) ? availableWidth - FIT_TRAILING_MARKER : 0
  if (span <= 0 || available <= 0) return 1
  return clampZoom(available / (span * BASE_PX_PER_SECOND))
}

/**
 * The steps a scale may be drawn at, in seconds.
 *
 * A ladder rather than an arithmetic progression, because a scale is read and not computed: a reader
 * can halve 30 seconds and cannot halve 37, and a grid nobody can do arithmetic with at a glance is a
 * grid that has to be counted instead. The bottom rung is a frame at 25fps, the top an hour, which is
 * the whole range a scale in this window can be looked at across.
 */
export const RULER_STEPS = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

/** How far apart two marks of the same rank must be to be worth drawing, in pixels. */
export const RULER_MAJOR_PX = 72
/** How far apart subdivisions must be to be worth drawing at all. */
export const RULER_MINOR_PX = 12

/** One mark on the scale: where it is, and whether it is one of the ones that carries a label. */
export interface RulerTick {
  time: number
  major: boolean
}

/** The span of the scale that is on screen, in seconds. */
export interface RulerWindow {
  from: number
  to: number
}

/**
 * The two steps a scale is drawn at: how far apart its labelled marks are, and how far apart its marks are.
 *
 * Both come from the ZOOM alone, which is what makes the scale read the same at every zoom: what changes
 * is what the marks SAY, not how many of them there are across the screen. The major step is the first
 * rung of the ladder that stands far enough apart to be read, and the subdivisions are the finest of the
 * usual ones — fifths down to halves — that still stands apart enough to be seen.
 */
export const rulerSteps = (zoom: number): { major: number; divisor: number; step: number } => {
  const rate = pxPerSec(zoom)
  const major = RULER_STEPS.find((candidate) => candidate * rate >= RULER_MAJOR_PX) ?? RULER_STEPS[RULER_STEPS.length - 1]
  const divisor = [5, 4, 2, 1].find((part) => (major / part) * rate >= RULER_MINOR_PX) ?? 1
  return { major, divisor, step: major / divisor }
}

/**
 * The marks a scale carries at a zoom, and which of them are worth a label.
 *
 * Chosen so the scale looks the same at every zoom: zooming in subdivides, because the step follows the
 * zoom down the ladder and the same span of time gains marks between the ones it had, and zooming out
 * coarsens for the same reason the other way. The scale is now a function of the zoom alone, which is
 * exactly what an adaptive scale is.
 *
 * A WINDOW is what keeps that honest. A close zoom on a long job is an enormous drawing — twelve
 * minutes at the closest zoom is nearly half a million pixels — and a scale drawn across the whole of it
 * would be tens of thousands of marks, of which a hundred are ever visible. So the marks are generated
 * for the stretch that is on screen, and the scale is fine because it can afford to be.
 *
 * With no window, the whole span is drawn: that is what a caller that has no screen — a test — means.
 */
export const rulerTicks = (duration: number, zoom: number, visible?: RulerWindow): RulerTick[] => {
  const span = Number.isFinite(duration) && duration > 0 ? duration : 0
  if (span <= 0) return []
  const { step, divisor } = rulerSteps(zoom)
  const from = Math.max(0, Math.min(span, visible ? visible.from : 0))
  const to = Math.max(from, Math.min(span, visible ? visible.to : span))
  const ticks: RulerTick[] = []
  const first = Math.max(0, Math.floor(from / step))
  const last = Math.ceil(to / step)
  for (let index = first; index <= last; index += 1) {
    const time = index * step
    if (time > span + step / 1000) break
    ticks.push({ time, major: index % divisor === 0 })
  }
  // The end of the output itself, which a reader looks for and which is not always on the grid.
  const onGrid = ticks.some((tick) => Math.abs(tick.time - span) < step / 1000)
  if (!onGrid && to >= span - step / 1000) ticks.push({ time: span, major: true })
  return ticks
}

/**
 * A wheel notch's worth of zoom.
 *
 * Finer than the magnifier's doubling, and for a plain reason: a button is pressed once and a wheel
 * arrives in dozens, so a step that feels right on a button makes a wheel unusable before the finger
 * has stopped moving.
 */
export const RULER_ZOOM_PER_NOTCH = 1.2

export const zoomedBy = (zoom: number, direction: 1 | -1): number =>
  clampZoom(zoom * (direction > 0 ? RULER_ZOOM_PER_NOTCH : 1 / RULER_ZOOM_PER_NOTCH))
