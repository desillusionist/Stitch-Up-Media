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

/** How tall a tile is drawn. The lane sets it, and the tile count is worked out from it. */
export const FILMSTRIP_CLIP_HEIGHT = 32

/** The multiple the tiles are generated at, so they stay crisp on a retina panel. */
export const FILMSTRIP_SCALE = 2

/** No strip needs more tiles than this, whatever the lane width. */
export const FILMSTRIP_MAX_TILES = 24

export interface FilmstripPlan {
  /** A tile's width, from the source's own shape, so the tiles abut with nothing between them. */
  thumbWidth: number
  /** How many tiles fit across the lane as it is right now. */
  thumbCount: number
  /** Each cell's share of the lane. The cells share the lane exactly, so there is no end gap. */
  cellWidth: number
  /** Source frames between one tile and the next. Fractional on purpose — never floor it. */
  step: number
  /** Absolute source frame each tile shows: the middle of its own cell, inside the trim. */
  frames: number[]
}

/**
 * Lay a clip's strip out across the lane as it is now.
 *
 * Order matters here and each line is one of the rules:
 *   thumbWidth from the source's own shape, so nothing is padded and no bars appear between
 *   tiles; thumbCount from how many of those fit across the lane; cellWidth from dividing the
 *   lane among them, so the cells fill it exactly with no trailing gap; inFrame and trimmed
 *   from the clip's own trim; step from the trimmed length over the tile count, kept
 *   FRACTIONAL, because flooring it accumulates rounding error and the last tile then lands
 *   short of the clip's end; and each sample at its own cell's midpoint, offset by inFrame and
 *   clamped inside the trim, so a thumbnail matches the frame the playhead would show there.
 */
export const computeFilmstrip = (o: {
  laneWidth: number
  thumbHeight: number
  srcWidth: number
  srcHeight: number
  fps: number
  inSec: number
  outSec: number
}): FilmstripPlan => {
  const aspect = o.srcWidth > 0 && o.srcHeight > 0 ? o.srcWidth / o.srcHeight : 16 / 9
  const thumbHeight = o.thumbHeight > 0 ? o.thumbHeight : FILMSTRIP_CLIP_HEIGHT
  const thumbWidth = Math.max(1, Math.round(thumbHeight * aspect))
  const laneWidth = Number.isFinite(o.laneWidth) ? Math.max(0, o.laneWidth) : 0
  const thumbCount = Math.max(1, Math.min(FILMSTRIP_MAX_TILES, Math.round(laneWidth / thumbWidth)))
  const cellWidth = laneWidth / thumbCount
  const fps = o.fps > 0 ? o.fps : 30
  const inFrame = Math.max(0, Math.round(o.inSec * fps))
  const trimmed = Math.max(1, Math.round((o.outSec - o.inSec) * fps))
  const step = trimmed / thumbCount
  const frames = Array.from({ length: thumbCount }, (_, index) =>
    inFrame + Math.min(trimmed - 1, Math.round((index + 0.5) * step)))
  return { thumbWidth, thumbCount, cellWidth, step, frames }
}

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
