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
 * zoom that makes the whole output exactly as wide as the lane area visible then. Afterwards the
 * timeline is that wide until the zoom changes again.
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

/** How wide the whole timeline is drawn, its label column included. */
export const contentWidthFor = (seconds: number, zoom: number, labelWidth: number): number =>
  labelWidth + laneWidthFor(seconds, zoom)

/** The time a point in the lane area stands for, from the label column's edge. */
export const secondsAt = (pixelsIntoLane: number, zoom: number): number =>
  (Number.isFinite(pixelsIntoLane) ? pixelsIntoLane : 0) / pxPerSec(zoom)

/**
 * The zoom that makes the whole output exactly as wide as the lane area it is given.
 *
 * Taken from the viewport only when it is asked for — pressing FIT — which is what keeps a fit
 * decision from being remade by every resize.
 */
export const fitZoom = (seconds: number, availableWidth: number): number => {
  const span = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const available = Number.isFinite(availableWidth) ? availableWidth : 0
  if (span <= 0 || available <= 0) return 1
  return clampZoom(available / (span * BASE_PX_PER_SECOND))
}
