const MEDIA_SCHEME = 'stitch-media'

/**
 * Builds a streamable URL for a local file.
 *
 * Mirrors the `stitch-media` handler registered in electron/main.ts, which
 * forwards the Range header to the filesystem so <video> can seek. A plain
 * file:// URL is not usable here: the dev renderer runs on http://localhost,
 * where Chromium blocks file:// media entirely.
 *
 * The empty path after the host is written out rather than left off, because Chromium's own URL
 * parser writes it out: `stitch-media://media?path=x` is canonicalised to `stitch-media://media/?path=x`
 * before the request is made, so the URL an element reports through `currentSrc` differed from the
 * one it was given — the same file appearing under two spellings in anything that logs both, and two
 * spellings of one URL is the kind of difference a cache can be wrong about.
 */
export const mediaUrl = (filePath: string) => `${MEDIA_SCHEME}://media/?path=${encodeURIComponent(filePath)}`
