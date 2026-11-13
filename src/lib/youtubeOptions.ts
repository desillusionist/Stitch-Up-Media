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

/**
 * What a download may ask for: a picture at a ceiling, or a sound on its own.
 *
 * AUDIO IS A FIRST-CLASS CHOICE and not a leftover of the video list: a channel's audio is the most common thing to
 * want from a link, and "the best picture, then throw it away" would download a video to get a podcast.
 */
export type YouTubeQuality = { kind: 'video'; height: number } | { kind: 'audio'; format: 'm4a' | 'mp3' }

/** The list the dialog shows, in the order it shows it. */
export const YOUTUBE_QUALITIES: Array<{ value: string; label: string }> = [
  { value: 'best', label: 'BEST AVAILABLE' },
  { value: '2160', label: '2160P (4K)' },
  { value: '1440', label: '1440P' },
  { value: '1080', label: '1080P' },
  { value: '720', label: '720P' },
  { value: '480', label: '480P' },
  { value: '360', label: '360P' },
  { value: 'audio-m4a', label: 'AUDIO — M4A (BEST)' },
  { value: 'audio-mp3', label: 'AUDIO — MP3 320K' },
]

/** A stored choice as the work it means. An unknown value is the best picture, which is the safest default. */
export const parseQuality = (value: string): YouTubeQuality => {
  if (value === 'audio-m4a' || value === 'audio-mp3') return { kind: 'audio', format: value === 'audio-mp3' ? 'mp3' : 'm4a' }
  const height = Number(value)
  return { kind: 'video', height: Number.isFinite(height) && height > 0 ? height : 0 }
}

/**
 * Whether a link names a PLAYLIST rather than one video.
 *
 * A `watch?v=…&list=…` link is one video that happens to sit in a list, and a reader pasting it means the video — so
 * the presence of `list=` is not enough. The list itself is `/playlist?…`, or a link that names a list and no video.
 * Measured on the strings; `check-update` asserts all three shapes.
 */
export const isPlaylistUrl = (url: string): boolean => {
  const value = String(url || '').trim()
  if (!/^https?:\/\//i.test(value)) return false
  if (/\/playlist\b/i.test(value)) return true
  return /[?&]list=/.test(value) && !/[?&]v=/.test(value)
}

/**
 * Where a download writes. A playlist numbers its files, because two videos in one list may share a title and the
 * order they were fetched in is worth having on disk.
 */
export const outputTemplate = (playlist: boolean): string =>
  playlist ? '%(playlist_index)02d - %(title)s.%(ext)s' : '%(title)s.%(ext)s'

/** `[download] Downloading item 3 of 12`, which is the only place a playlist's own progress is said. */
export const playlistItem = (line: string): { item: number; total: number } | null => {
  const match = /\[download\]\s+Downloading item (\d+) of (\d+)/.exec(line)
  if (!match) return null
  const item = Number(match[1])
  const total = Number(match[2])
  return Number.isFinite(item) && Number.isFinite(total) ? { item, total } : null
}

/** What a download reports as it runs: one file's percentage, and a playlist's place in itself. */
export interface YouTubeProgress {
  percent: number | null
  item?: number
  total?: number
}

/** What yt-dlp is asked for: a format expression, and the switches that go with it. */
export interface DownloadArguments {
  format: string
  extra: string[]
}

export const downloadArguments = (quality: YouTubeQuality, previewSafe: boolean): DownloadArguments => {
  if (quality.kind === 'audio') {
    return {
      // AAC for m4a, which is what AVFoundation previews. mp3 is asked for at a FIXED 320k because its default is a
      // variable rate the reader never chose; the bitrate is part of the name afterwards, so which one it is is visible.
      format: quality.format === 'm4a' ? 'ba[acodec^=mp4a]/ba/b' : 'ba/b',
      extra: ['--extract-audio', '--audio-format', quality.format, ...(quality.format === 'mp3' ? ['--audio-quality', '320K'] : [])],
    }
  }
  return { format: formatSelector({ height: quality.height, previewSafe }), extra: ['--merge-output-format', 'mp4'] }
}

/**
 * The specs a file is named after, so two downloads of one link are two files.
 *
 * A picture is named for its own size (`1920x1080`), a sound for its rate and bitrate (`48kHz 128k`). Taken from the
 * PROBE rather than from what was asked for: a "1080p" request on a 720p upload is a 720p file, and the name should say
 * what the file is rather than what it was asked to be — which is also what makes two qualities impossible to confuse.
 */
export const specSuffix = (info: {
  videoStreams?: Array<{ resolution?: string }>
  audioStreams?: Array<{ sampleRate?: number; bitrate?: string }>
} | null | undefined): string | null => {
  const resolution = info?.videoStreams?.[0]?.resolution
  if (resolution) return `[${resolution}]`
  const audio = info?.audioStreams?.[0]
  if (!audio) return null
  const rate = audio.sampleRate && audio.sampleRate > 0 ? `${Math.round(audio.sampleRate / 1000)}kHz` : ''
  const bitrate = audio.bitrate || ''
  const parts = [rate, bitrate].filter(Boolean).join(' ')
  return parts ? `[${parts}]` : null
}

/** `Title [1920x1080].mp4` — the suffix goes before the extension, never after it. */
export const withSpecSuffix = (filePath: string, suffix: string): string => {
  const slash = filePath.lastIndexOf('/')
  const directory = slash >= 0 ? filePath.slice(0, slash + 1) : ''
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  return `${directory}${base} ${suffix}${extension}`
}

/**
 * `candidate` unless something is there already, then `candidate (2)`, `(3)`… — a rename that never destroys a file.
 *
 * The download is FORCED to overwrite its own name (yt-dlp otherwise reuses a file whose name it recognises, which is
 * what made a second quality produce the first file again), so this is the one place a name may already be taken: a
 * video downloaded twice at the same quality. The predicate is injected so the arithmetic can be asserted.
 */
export const uniquePath = (candidate: string, exists: (path: string) => boolean): string => {
  if (!exists(candidate)) return candidate
  const dot = candidate.lastIndexOf('.')
  const base = dot > 0 ? candidate.slice(0, dot) : candidate
  const extension = dot > 0 ? candidate.slice(dot) : ''
  for (let copy = 2; copy < 1000; copy++) {
    const next = `${base} (${copy})${extension}`
    if (!exists(next)) return next
  }
  return candidate
}

