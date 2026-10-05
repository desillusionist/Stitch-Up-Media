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

/**
 * The range the manual zoom may take. Below 1 because a long job has to be reachable, however long —
 * a quarter of an hour of output is still a timeline a reader scrolls, and the FIT below is not held
 * to this floor at all, so the floor is only how far the BUTTONS go.
 */
export const ZOOM_MIN = 0.01
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
 *
 * The fit is capped at ZOOM_MAX and NOT floored at ZOOM_MIN. A fit held up to ZOOM_MIN could not fit a
 * job longer than the floor allows — sixteen minutes needed 0.039x in a 900-pixel panel and stopped at
 * 0.05, so the whole output was permanently out of reach, which is the opposite of what a fit is for.
 * This is the same rule the QUICK LOOK strip's fit follows in `electron/quicklook-scale.swift`.
 */
export const fitZoom = (seconds: number, availableWidth: number): number => {
  const span = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const available = Number.isFinite(availableWidth) ? availableWidth - FIT_TRAILING_MARKER : 0
  if (span <= 0 || available <= 0) return 1
  return Math.min(ZOOM_MAX, available / (span * BASE_PX_PER_SECOND))
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
 * is what the marks SAY, not how many of them there are across the screen.
 *
 * Where a FRAME is wide enough to see, the scale counts in FRAMES rather than in ladder steps: a mark per
 * frame, and a label every so many frames that it stands far enough apart to read. That is not a detail —
 * the arrow keys step by one frame, and a scale whose marks are not frames makes a one-frame step land
 * between two marks and read as though it had skipped one. Below that width the ladder takes over, because
 * frames are no longer separable and a grid a reader can halve is the most useful thing left.
 */
export const rulerSteps = (zoom: number, fps = 0): { major: number; divisor: number; step: number } => {
  const rate = pxPerSec(zoom)
  const frame = fps > 0 ? 1 / Math.round(fps) : 0
  if (frame > 0 && frame * rate >= RULER_MINOR_PX) {
    const divisor = Math.max(1, Math.ceil(RULER_MAJOR_PX / (frame * rate)))
    return { major: frame * divisor, divisor, step: frame }
  }
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
export const rulerTicks = (duration: number, zoom: number, visible?: RulerWindow, fps = 0): RulerTick[] => {
  const span = Number.isFinite(duration) && duration > 0 ? duration : 0
  if (span <= 0) return []
  const { step, divisor } = rulerSteps(zoom, fps)
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
  // The mark at the very end of the output is DROPPED rather than drawn. It is right-aligned inside the
  // scale, so it lands on top of the mark before it as soon as the two are a label apart — and the end of
  // the output is said by the live readout in the gutter beside the lanes, which cannot overlap itself.
  if (ticks.length && span - ticks[ticks.length - 1].time < step / 2) ticks.pop()
  return ticks
}

/**
 * A wheel notch's worth of zoom, eased.
 *
 * Gentle on purpose. The magnifier steps by halves because a button is pressed once; a wheel arrives in
 * dozens, and at a fifth per notch a flick crossed the whole range before the finger had stopped moving.
 * The response is eased rather than fixed: a small movement zooms a little and a fast one travels, which
 * is the ease-in a gesture wants and the ease-out a flick wants. It is the same easing the wheel SCRUB is
 * given, because a wheel should feel like one thing wherever in this window it is used.
 */
export const RULER_ZOOM_PER_NOTCH = 0.06

export const zoomedBy = (zoom: number, deltaY: number): number => {
  if (!Number.isFinite(deltaY) || deltaY === 0) return zoom
  const eased = Math.tanh(Math.abs(deltaY) / 40)
  const factor = 1 + RULER_ZOOM_PER_NOTCH * eased
  return clampZoom(deltaY < 0 ? zoom * factor : zoom / factor)
}
