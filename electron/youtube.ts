import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * A YouTube (or any yt-dlp-supported) link, turned into a media file on disk.
 *
 * WHY yt-dlp AND NOT A LIBRARY: it is the one thing that keeps working as sites change, it is what a reader would
 * reach for themselves, and the app already shells out to ffmpeg by ABSOLUTE PATH for the same reason — a
 * Finder-launched app has no Homebrew on its PATH. So the binary is resolved here the same way, and ffmpeg's own
 * directory is handed over, because merging a separate picture and sound track is a second program's job and yt-dlp
 * would otherwise look for one on that same PATH.
 *
 * The download writes into a directory the READER chose (`~/Downloads` by default), under yt-dlp's own title-based
 * name. Nothing here registers the result as generated: a downloaded video is the reader's file, not a cache entry,
 * and CLEAR CACHE must never take it.
 */
const CANDIDATES = [
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  path.join(os.homedir(), '.local/bin/yt-dlp'),
  '/usr/bin/yt-dlp',
]

/** The yt-dlp this app runs: the first one that is really installed. */
export const YTDLP_BINARY = CANDIDATES.find((candidate) => fs.existsSync(candidate)) || 'yt-dlp'

/** Whether a downloader is installed at all, which the window needs to know before offering the action. */
export const youtubeAvailable = () => fs.existsSync(YTDLP_BINARY) || YTDLP_BINARY === 'yt-dlp'

/**
 * The percentage on one line of yt-dlp's progress, or null.
 *
 * yt-dlp writes `[download]  12.3% of ~ 123.45MiB at 1.23MiB/s ETA 00:12` with `--newline`, and that is the only
 * figure the window needs: a bar, and whether anything is happening.
 */
export const downloadPercent = (line: string): number | null => {
  const match = /\[download\]\s+([\d.]+)%/.exec(line)
  if (!match) return null
  const percent = Number(match[1])
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null
}

/** A line that is the path of a finished file, which is what `--print after_move:filepath` answers with. */
export const finishedFile = (line: string): string | null => {
  const trimmed = line.trim()
  if (!trimmed.startsWith('/')) return null
  if (!/\.(mp4|mkv|webm|mov|m4a|mp3|opus|wav|flac|aac)$/i.test(trimmed)) return null
  return trimmed
}

export { YOUTUBE_HEIGHTS, formatSelector } from '../src/lib/youtubeOptions'
import { formatSelector } from '../src/lib/youtubeOptions'

export interface YouTubeDownload {
  url: string
  directory: string
  /** Where ffmpeg lives, so yt-dlp can merge a separate picture and sound without one on PATH. */
  ffmpegDirectory?: string
  /** The largest height to take, or 0 for the best there is. */
  height?: number
  /** Whether to ask for H.264 + AAC, which macOS can preview. On unless the reader turns it off. */
  previewSafe?: boolean
  onProgress?: (percent: number | null) => void
}

/**
 * Downloads the link into `directory` and answers with the files it wrote.
 *
 * `--no-playlist` is deliberate: a link that happens to carry a list beside its video would otherwise start pulling
 * the whole list into the reader's Downloads folder. The format request takes the best picture and sound and merges
 * them to mp4 when they are separate, and falls back to a single file when they are not.
 */
export const downloadYouTube = ({ url, directory, ffmpegDirectory, height, previewSafe, onProgress }: YouTubeDownload): Promise<string[]> => new Promise((resolve, reject) => {
  fs.mkdirSync(directory, { recursive: true })
  const args = [
    '--no-playlist',
    '--newline',
    '--no-simulate',
    '--print', 'after_move:filepath',
    '-f', formatSelector({ height, previewSafe }),
    '--merge-output-format', 'mp4',
    '-o', path.join(directory, '%(title)s.%(ext)s'),
    ...(ffmpegDirectory ? ['--ffmpeg-location', ffmpegDirectory] : []),
    url,
  ]
  const child = spawn(YTDLP_BINARY, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const files = new Set<string>()
  let stderr = ''
  let settled = false

  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of String(chunk).split('\n')) {
      const percent = downloadPercent(line)
      if (percent != null) onProgress?.(percent)
      const file = finishedFile(line)
      if (file) files.add(file)
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 65536) stderr += chunk.toString() })
  child.on('error', (error) => {
    if (settled) return
    settled = true
    onProgress?.(null)
    reject(error)
  })
  child.on('close', (code) => {
    if (settled) return
    settled = true
    if (code !== 0) { reject(new Error(stderr.trim().slice(-400) || `yt-dlp exited with ${code}`)); return }
    onProgress?.(100)
    resolve([...files])
  })
})
