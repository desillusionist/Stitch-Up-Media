/**
 * Filmstrip rules for the EDIT JOB timeline.
 *
 * A clip in filmstrip view shows frames sampled across the range the clip actually uses, so
 * the tiles are of the trimmed footage rather than of the whole source. The same questions are
 * asked here as in the QUICK LOOK helper — how many tiles, and which ones — so the timeline and
 * the helper cannot disagree about what a clip contains.
 */

/** How tall the tiles are drawn. The frame generator samples at the same height. */
export const FILMSTRIP_HEIGHT = 34

/** A tile's nominal width at that height, used to work out how many a clip needs. */
export const FILMSTRIP_TILE_WIDTH = Math.round(FILMSTRIP_HEIGHT * 1.5)

/**
 * How many tiles a clip needs, from its width on screen.
 *
 * The count follows the CLIP's width, not the zoom alone. Keying it to the zoom meant a
 * two-second clip and a two-minute one at the same zoom asked for the same number of tiles, so
 * a short clip packed dozens of frames into a few pixels while a long one spread a handful
 * across its whole width. Bounded at both ends: below one there is no strip, and above a couple
 * of dozen the extra frames cost a longer ffmpeg run for pixels nobody can resolve.
 */
export const filmstripCountForWidth = (clipWidth: number): number =>
  Math.max(1, Math.min(24, Math.round((Number.isFinite(clipWidth) ? clipWidth : 0) / FILMSTRIP_TILE_WIDTH)))

/**
 * The identity of one strip: the media, the range of it used, and how finely it was sampled.
 *
 * All four belong in the key. The same footage trimmed differently is a different strip, and a
 * strip sampled at one count is not the strip sampled at another, so keying on the media alone
 * would serve a five-tile strip for a twenty-tile request.
 */
export const filmstripKey = (target: string, sourceIn: number, duration: number, count: number): string =>
  `${target}|${sourceIn.toFixed(3)}|${duration.toFixed(3)}|${count}`
