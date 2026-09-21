/**
 * Filmstrip rules for the EDIT JOB timeline.
 *
 * A clip in filmstrip view shows frames sampled across the range the clip actually uses, so the
 * tiles are of the trimmed footage rather than of the whole source.
 *
 * The one thing that must never happen is partial coverage: a strip that stops short of the
 * clip's end is lying about what the clip contains. Coverage comes from the STEP being derived
 * from the tile count — `step = totalFrames / thumbCount` — so however many tiles fit, they
 * always span the whole range. Widening the window raises the count and lowers the step, which
 * packs MORE frames into the SAME span. A fixed step would instead make coverage
 * `thumbCount x step`, so it would only reach the end when the window happened to be huge.
 */

/** How tall a tile is drawn. The lane sets it, and the tile count is worked out from it. */
export const FILMSTRIP_CLIP_HEIGHT = 32

/** The multiple the tiles are generated at, so they stay crisp on a retina panel. */
export const FILMSTRIP_SCALE = 2

/** No strip needs more tiles than this, whatever the window width. */
export const FILMSTRIP_MAX_TILES = 24

export interface FilmstripPlan {
  /** A tile's width, from the source's own shape, so the tiles abut with nothing between them. */
  thumbWidth: number
  /** How many tiles fit across the window. */
  thumbCount: number
  /** Frames between one tile and the next. Fractional on purpose — never floor it. */
  step: number
  /** The frame each tile shows: the middle of its own cell, so the strip starts and ends level. */
  frames: number[]
}

/**
 * How many tiles a strip has, how far apart they are sampled, and which frame each shows.
 *
 * `thumbWidth` is aspect-aware, which is what keeps bars out from between the tiles: a tile is
 * as wide as its own picture, not as wide as a fixed cell some other picture would have fitted.
 * `step` stays fractional, because flooring it accumulates rounding error and the last tile
 * then lands short of the clip's end. The samples are taken at each cell's midpoint, so the
 * first and last tiles sit level within the range rather than both crowding its near edge.
 *
 * The leftover of `floor` — under one tile's width — is trailing space, not missing coverage.
 * Narrowing `step` to fill it would pull the last tile back off the end and lose exactly what
 * this is for.
 */
export const computeFilmstrip = (o: {
  windowWidth: number
  thumbHeight: number
  srcWidth: number
  srcHeight: number
  /** duration in seconds x fps */
  totalFrames: number
}): FilmstripPlan => {
  const aspect = o.srcWidth > 0 && o.srcHeight > 0 ? o.srcWidth / o.srcHeight : 16 / 9
  const thumbHeight = o.thumbHeight > 0 ? o.thumbHeight : FILMSTRIP_CLIP_HEIGHT
  const thumbWidth = Math.max(1, Math.round(thumbHeight * aspect))
  const windowWidth = Number.isFinite(o.windowWidth) ? o.windowWidth : 0
  const thumbCount = Math.max(1, Math.min(FILMSTRIP_MAX_TILES, Math.floor(windowWidth / thumbWidth)))
  const totalFrames = Math.max(1, Math.round(o.totalFrames))
  const step = totalFrames / thumbCount
  const last = totalFrames - 1
  const frames = Array.from({ length: thumbCount }, (_, index) => Math.min(last, Math.round((index + 0.5) * step)))
  return { thumbWidth, thumbCount, step, frames }
}

/**
 * The identity of one strip: the media, the range of it used, and the window it was fitted to.
 *
 * The window rather than the resulting tile count, because the count is worked out from the
 * media's own shape, which the caller does not know until the strip comes back.
 */
export const filmstripKey = (target: string, sourceIn: number, duration: number, windowWidth: number): string =>
  `${target}|${sourceIn.toFixed(3)}|${duration.toFixed(3)}|${Math.round(windowWidth)}`

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
 * The time bucket a skimmed frame is taken at, to about a twelfth of a second.
 *
 * Two purposes: it quantises the seek so the answer is the same for pointers a hair apart,
 * which stops the frame flickering between neighbours on a still hand, and it makes the
 * generator's cache actually hit while the pointer is being dragged slowly.
 */
export const skimBucket = (seconds: number): number => Math.round((Number.isFinite(seconds) ? seconds : 0) * 12)
