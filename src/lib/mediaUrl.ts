const MEDIA_SCHEME = 'stitch-media'

/**
 * Builds a streamable URL for a local file.
 *
 * Mirrors the `stitch-media` handler registered in electron/main.ts, which
 * forwards the Range header to the filesystem so <video> can seek. A plain
 * file:// URL is not usable here: the dev renderer runs on http://localhost,
 * where Chromium blocks file:// media entirely.
 */
export const mediaUrl = (filePath: string) => `${MEDIA_SCHEME}://media?path=${encodeURIComponent(filePath)}`
