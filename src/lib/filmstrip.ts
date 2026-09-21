/**
 * Filmstrip rules for the EDIT JOB timeline.
 *
 * A clip in filmstrip view shows frames sampled across the range the clip actually uses, so
 * the tiles are of the trimmed footage rather than of the whole source. The same questions are
 * asked here as in the QUICK LOOK helper — how many tiles, and which ones — so the timeline and
 * the helper cannot disagree about what a clip contains.
 */

/**
 * The cell every tile is padded into.
 *
 * Every tile is the same size whatever shape the source is, with the picture fitted inside and
 * bars filling the rest. That is what makes the strip's geometry knowable: a tile's width on
 * screen can be worked out from the clip's height alone, so the number of tiles can be chosen
 * to cover the clip's width, and a skimmed frame can be placed on the very tile it belongs to.
 * A strip of natural-aspect tiles could not do either, because nothing outside the image knows
 * how wide its tiles came out.
 */
export const FILMSTRIP_CELL = { width: 114, height: 64 }

/** The cell's width for its height, which is what a tile's width on screen is derived from. */
export const FILMSTRIP_TILE_ASPECT = FILMSTRIP_CELL.width / FILMSTRIP_CELL.height

/** The height a clip is drawn at. The lane sets it; this is what the count is worked out from. */
export const FILMSTRIP_CLIP_HEIGHT = 32

/**
 * How many tiles a clip needs, from its width on screen.
 *
 * The count follows the CLIP's width, not the zoom alone. Keying it to the zoom meant a
 * two-second clip and a two-minute one at the same zoom asked for the same number of tiles, so
 * a short clip packed dozens of frames into a few pixels while a long one spread a handful
 * across its whole width. It is rounded UP so the tiles always reach the clip's right edge,
 * which is also what stops the last of the range being cut off with no tile to show it.
 */
export const filmstripCountFor = (clipWidth: number): number => {
  const tileWidth = FILMSTRIP_CLIP_HEIGHT * FILMSTRIP_TILE_ASPECT
  if (!(clipWidth > 0) || !Number.isFinite(clipWidth)) return 1
  return Math.max(1, Math.min(24, Math.ceil(clipWidth / tileWidth)))
}

/**
 * The identity of one strip: the media, the range of it used, and how finely it was sampled.
 *
 * All four belong in the key. The same footage trimmed differently is a different strip, and a
 * strip sampled at one count is not the strip sampled at another, so keying on the media alone
 * would serve a five-tile strip for a twenty-tile request.
 */
export const filmstripKey = (target: string, sourceIn: number, duration: number, count: number): string =>
  `${target}|${sourceIn.toFixed(3)}|${duration.toFixed(3)}|${count}`

/**
 * Which of a strip's tiles a fraction of the clip falls in, and how far into it.
 *
 * The cell is what the frame is drawn over; the within-cell fraction is what the frame is
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
