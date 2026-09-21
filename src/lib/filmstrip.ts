/**
 * Filmstrip rules for the EDIT JOB timeline.
 *
 * The lane width is DYNAMIC — `trimmedSeconds x pixelsPerSecond(zoom)` — so every figure below
 * is recomputed from the current one. That is the point: the strip must span exactly the lane
 * whatever its width is, and a wider lane must buy density rather than less of the range.
 *
 * The two things that must never happen are partial coverage and sampling outside the trim.
 * Coverage comes from the step being derived from the tile count, and the samples are offset
 * by the clip's in-point and stepped across the trimmed span, so each thumbnail shows the frame
 * the playhead would show at that place on the lane.
 */

/**
 * How tall a tile is drawn. This is the lane's row height, and it is the one number the whole
 * strip hangs off: the tile count is worked out from it, and the stylesheet draws the tile at
 * it too (by way of the `--filmstrip-tile` property the timeline sets from this figure), so the
 * picture that is extracted and the picture that is painted are the same size.
 */
export const FILMSTRIP_CLIP_HEIGHT = 32

/** The multiple the tiles are generated at, so they stay crisp on a retina panel. */
export const FILMSTRIP_SCALE = 2

/**
 * How long the lane's width has to hold still before frames are extracted for it.
 *
 * The strip's LAYOUT follows the width as it changes, one animation frame behind at most, but the
 * frames themselves are not asked for until the width settles: a drag of the window edge names a
 * slightly different set of frames on every frame of it, and extracting for each of those would
 * put an ffmpeg behind the whole drag.
 */
export const FILMSTRIP_SETTLE_MS = 180

export interface FilmstripPlan {
  /** A tile's width, from the source's own picture. */
  thumbWidth: number
  /** How many tiles fit across the lane as it is right now. */
  thumbCount: number
  /**
   * Each cell's share of the lane. The cells share the lane exactly, so there is no end gap. This
   * is the width the tile is PAINTED at, in pixels — not a percentage of the clip — so the strip
   * on screen is this arithmetic's and cannot be stretched by whatever the clip's box turns out
   * to be. A percent width was the bug: while a resize was in progress the count was a layout
   * behind, and the tiles stretched to fill the clip instead of the strip growing denser.
   */
  cellWidth: number
  /** Source frames between one tile and the next. Fractional on purpose — never floor it. */
  step: number
  /** Absolute SOURCE TIME each tile samples, at its own cell's midpoint. */
  times: number[]
  /** The absolute source frame each time falls on, which is the key its picture is cached under. */
  frames: number[]
}

/**
 * Lay a clip's strip out across the lane as it is now.
 *
 * This is the QUICK LOOK helper's own arithmetic, moved to the timeline: the tile is as wide as
 * its own picture, the count is how many of those fit across the lane, and the cells are equal
 * shares of the lane. Every cell is then filled with its picture — `resizeAspectFill`, which is
 * `object-fit: cover` on the web side — so a cell is never letterboxed and the strip reads as
 * one row of frames rather than a row of frames in assorted frames.
 *
 * The tile's width coming from the SOURCE is what makes that filling harmless: a tile is already
 * the shape of its own picture, so covering its cell crops a sliver rather than a third of the
 * frame. Shaping the cells after the OUTPUT instead meant a portrait clip's thumbnails were
 * cropped down to a landscape slice, and padding them to fit meant bars of a different thickness
 * on every clip.
 */
export const computeFilmstrip = (o: {
  laneWidth: number
  thumbHeight: number
  /** The source's own width over its height. */
  srcAspect: number
  fps: number
  inSec: number
  outSec: number
}): FilmstripPlan => {
  const srcAspect = Number.isFinite(o.srcAspect) && o.srcAspect > 0 ? o.srcAspect : 16 / 9
  const thumbHeight = o.thumbHeight > 0 ? o.thumbHeight : FILMSTRIP_CLIP_HEIGHT
  const thumbWidth = Math.max(1, Math.round(thumbHeight * srcAspect))
  const laneWidth = Number.isFinite(o.laneWidth) ? Math.max(0, o.laneWidth) : 0
  const fps = o.fps > 0 ? o.fps : 30
  const inFrame = Math.max(0, Math.round(o.inSec * fps))
  const trimmed = Math.max(1, Math.round((o.outSec - o.inSec) * fps))
  // How many whole tiles fit across the lane as it is now, and never more than there are frames to
  // fill them with: past that the same frame would be asked for twice over, which is work for
  // nothing. There is deliberately no other ceiling on this. There used to be a fixed one, and
  // past it the count stopped rising with the lane and every tile simply grew, so a wider window
  // or a deeper zoom magnified the strip instead of packing more frames into it. The lane's own
  // width is the bound, and a tile's own width is what decides the count.
  const thumbCount = Math.max(1, Math.min(Math.round(laneWidth / thumbWidth), trimmed))
  const cellWidth = laneWidth / thumbCount
  const step = trimmed / thumbCount
  // A time and the frame it falls on, derived together so the picture a tile shows and the key
  // it is cached under cannot drift apart. The time is what is asked for, because seeking to a
  // time works on any source however its frames are numbered; the frame index is what is cached,
  // because that is what stays stable when the lane is re-laid out and the times shift a little.
  const times = Array.from({ length: thumbCount }, (_, index) => o.inSec + ((index + 0.5) * step) / fps)
  const frames = times.map((time) => Math.max(inFrame, Math.min(inFrame + trimmed - 1, Math.round(time * fps))))
  return { thumbWidth, thumbCount, cellWidth, step, times, frames }
}

/**
 * The identity of a thumbnail: the frame, and the source shape it was drawn at.
 *
 * The shape belongs in the key because a thumbnail is generated at its tile's width, which comes
 * from the source. Footage whose shape has changed must not be served the pictures drawn for the
 * old one.
 */
export const frameKey = (index: number, srcAspect: number): string =>
  `${index}|${(Number.isFinite(srcAspect) && srcAspect > 0 ? srcAspect : 16 / 9).toFixed(4)}`

/**
 * Which tile a fraction of the clip falls in, and how far into it.
 *
 * The tile is what the live frame is drawn over; the within-tile fraction is what the frame is
 * sampled at, so moving across one tile still advances the picture rather than holding it until
 * the pointer crosses into the next.
 */
export const filmstripCell = (fraction: number, count: number): { cell: number; within: number } => {
  const tiles = Math.max(1, Math.round(count))
  const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0
  const cell = Math.max(0, Math.min(tiles - 1, Math.floor(clamped * tiles)))
  return { cell, within: clamped * tiles - cell }
}

/**
 * The source frame a skimmed moment falls on, quantised to about a twelfth of a second.
 *
 * The quantising stops the picture flickering between neighbouring frames on a still hand, and
 * keeps the frame cache useful while the pointer is being dragged slowly. The result is an
 * absolute source frame index, which is the same key the strip's own frames are cached under,
 * so a skimmed frame and a strip frame are never extracted twice.
 */
export const skimFrame = (seconds: number, fps: number): number =>
  Math.max(0, Math.round((Math.round((Number.isFinite(seconds) ? seconds : 0) * 12) / 12) * (fps > 0 ? fps : 30)))
