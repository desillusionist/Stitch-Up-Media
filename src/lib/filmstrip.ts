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

/**
 * How many tiles a clip shows, from the timeline's zoom.
 *
 * A clip is as wide as its share of the output, so zooming in is the only way to ask for more
 * detail about it: a fixed count would spend the same few tiles on a two-second clip and on a
 * two-minute one. Bounded at both ends, since a tile narrower than a few pixels is noise and a
 * strip of dozens is a slower ffmpeg run for pixels nobody can see.
 */
export const filmstripCountForZoom = (zoom: number): number =>
  Math.max(4, Math.min(24, Math.round(6 * (Number.isFinite(zoom) && zoom > 0 ? zoom : 1))))

/**
 * The identity of one strip: the media, the range of it used, and how finely it was sampled.
 *
 * All four belong in the key. The same footage trimmed differently is a different strip, and a
 * strip sampled at one count is not the strip sampled at another, so keying on the media alone
 * would serve a five-tile strip for a twenty-tile request.
 */
export const filmstripKey = (target: string, sourceIn: number, duration: number, count: number): string =>
  `${target}|${sourceIn.toFixed(3)}|${duration.toFixed(3)}|${count}`
