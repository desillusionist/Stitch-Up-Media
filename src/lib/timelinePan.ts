/**
 * How a zoomed timeline follows the skimmer.
 *
 * The lane label column is not part of the scrollable drawing at all — it is a column of the
 * timeline's own grid, beside the scroller rather than inside it — so the skimmer's offset is its
 * share of the lane area and nothing else.
 */
export interface SkimmerView {
  /** The skimmer's offset within the scrollable content, in pixels. */
  offset: number
  scrollLeft: number
  viewportWidth: number
  contentWidth: number
  /** How close to an edge the skimmer may get before the view pans. */
  margin?: number
}

/** The skimmer's offset within the scrollable content, given its share of the timeline. */
export const skimmerOffset = (fraction: number, contentWidth: number): number =>
  fraction * Math.max(0, contentWidth)

/**
 * The scroll position that keeps the skimmer in view, or null when it is already there.
 *
 * Returning null rather than a number for "no change" lets the caller leave the scroll
 * alone, which is what stops a wheel scrub from re-centring on every tick. A timeline
 * that fits its window never pans, because there is nothing to pan.
 *
 * A skimmer outside the margin is centred, and the result is clamped at zero: the
 * content's own left edge is the end of the road.
 */
export const scrollToKeepVisible = (view: SkimmerView): number | null => {
  if (view.contentWidth <= view.viewportWidth + 1) return null
  const margin = view.margin ?? 48
  const left = view.scrollLeft
  const right = view.scrollLeft + view.viewportWidth
  if (view.offset >= left + margin && view.offset <= right - margin) return null
  return Math.max(0, view.offset - view.viewportWidth / 2)
}
