/**
 * What a YouTube download may ask for — the two choices the dialog offers, and the yt-dlp selector they become.
 *
 * THIS LIVES IN `src/lib` rather than beside the downloader because the DIALOG needs the list, and a renderer cannot
 * import the downloader: that module reaches for `node:child_process` and `fs` as it loads. The selector is a string
 * built by a pure function, so it is asserted in `check-update` without a download in sight.
 */
/**
 * The formats to ask yt-dlp for, which is where BOTH reported problems are answered.
 *
 * THE PREVIEW ONE FIRST. yt-dlp's plain `bv*+ba/b` takes the best codecs YouTube has, and above 1080p those are VP9 or
 * AV1 with Opus sound — a combination Chromium decodes and macOS does NOT. So a downloaded video played in the app's
 * EDIT JOB monitor and would not play in Finder's Quick Look or in the app's own Quick Look helper, which is the
 * AVFoundation path. H.264 with AAC is the pairing AVFoundation decodes, so the preview-safe selector asks for
 * `avc1` + `mp4a` first and falls back, in order, to AVC with any sound, then AVC at all, then whatever is best at
 * that height — a download that works and is not previewable beats a download that fails, but it is the LAST resort
 * rather than the first choice.
 *
 * THE QUALITY ONE. A height is a CEILING, not a demand: asking for 1080p on a 720p video gives 720p, which is what a
 * reader means by "at most 1080p". `0` means no ceiling.
 */
export const formatSelector = (options: { height?: number; previewSafe?: boolean } = {}): string => {
  const height = options.height && options.height > 0 ? `[height<=${options.height}]` : ''
  if (options.previewSafe === false) return `bv*${height}+ba/b${height}`
  return [
    `bv*${height}[vcodec^=avc1]+ba[acodec^=mp4a]`,
    `bv*${height}[vcodec^=avc1]+ba`,
    `bv*${height}[vcodec^=avc1]/b${height}[vcodec^=avc1]`,
    `bv*${height}+ba/b${height}`,
  ].join('/')
}

/** The heights the download offers, as the dialog lists them. `0` is "the best there is". */
export const YOUTUBE_HEIGHTS = [0, 2160, 1440, 1080, 720, 480, 360] as const

