import ffmpeg from 'fluent-ffmpeg'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { MediaProbeInfo } from '../../src/types'

// Automatically point to Homebrew ffmpeg/ffprobe on Apple Silicon or standard locations. THE PATHS ARE NAMED
// rather than left to PATH because a Finder-launched app inherits LaunchServices' own PATH, which has neither
// of them: the binaries were found while the app was started from a terminal and not once it was installed.
const POSSIBLE_FFMPEG_PATHS = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg'
]

const POSSIBLE_FFPROBE_PATHS = [
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/usr/bin/ffprobe'
]

const firstInstalled = (candidates: string[], fallback: string): string => candidates.find((candidate) => fs.existsSync(candidate)) || fallback

/** The ffmpeg every other module must use, resolved once. `'ffmpeg'` is only right where one really is on PATH. */
export const FFMPEG_BINARY = firstInstalled(POSSIBLE_FFMPEG_PATHS, 'ffmpeg')
const FFPROBE_BINARY = firstInstalled(POSSIBLE_FFPROBE_PATHS, 'ffprobe')

ffmpeg.setFfmpegPath(FFMPEG_BINARY)
ffmpeg.setFfprobePath(FFPROBE_BINARY)

/**
 * A stream's layout NAME, as ffprobe writes it and as everything that shows one expects it.
 *
 * THE NAME CAN ARRIVE AS A NUMBER. ffprobe says `"5.1"` for a six-channel file, and the JSON parser this
 * probe runs on turns any numeric-looking string into a number — so a 5.1 wav's layout reached the app as
 * `5.1`, the reader called `.toUpperCase()` on it, and the throw took the whole EDIT JOB window with it: a
 * blank page and nothing in the log. Put the name back where it can be read; a name that came back as a
 * WHOLE number was one with a zero in it (`5.0` read as `5`), and that reading is an ABSENCE rather than a
 * wrong name, because the channel count says it better than a truncated layout does.
 */
export const layoutName = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? undefined : String(value)
  return typeof value === 'string' && value && value !== 'unknown' ? value : undefined
}

export function probeFile(filePath: string): Promise<MediaProbeInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: Error | null, data: ffmpeg.FfprobeData) => {
      if (err) {
        return reject(err)
      }

      const format = (data.format.format_name || 'unknown').split(',').map((item) => item.trim()).join(', ')
      // Read as NUMBERS. ffprobe answers "N/A" as a STRING when it cannot measure one — a single image
      // has no length in its container at all — and `"N/A" || 0` is `"N/A"`, not zero. Every caller then
      // turned it into NaN with `Number(...)`, and NaN is not a length and does not compare as one: the
      // encoder's tail padding was switched off by it, because `NaN > 0` is false.
      const duration = Number(data.format.duration) || 0
      const size = Number(data.format.size) || 0
      const bitrate = Number(data.format.bit_rate) || 0

      const videoStreams = (data.streams || [])
        .filter((s: ffmpeg.FfprobeStream) => s.codec_type === 'video')
        .map((s: ffmpeg.FfprobeStream) => ({
          codec: s.codec_name || 'unknown',
          resolution: s.width && s.height ? `${s.width}x${s.height}` : undefined,
          fps: s.r_frame_rate ? eval(s.r_frame_rate) : undefined,
          bitrate: s.bit_rate ? `${Math.round(Number(s.bit_rate) / 1000)}k` : undefined,
          // The picture's own storage format, which is where its DEPTH is read from rather than guessed at.
          pixelFormat: s.pix_fmt || undefined,
        }))

      const audioStreams = (data.streams || [])
        .filter((s: ffmpeg.FfprobeStream) => s.codec_type === 'audio')
        .map((s: ffmpeg.FfprobeStream, audioIndex: number) => {
          // Read as numbers, because ffprobe answers `N/A` and `0` for figures it cannot give: a lossy codec
          // has no bits per sample at all, and a wav written without a layout says `unknown` rather than
          // stereo. Each of those is an ABSENCE, and a zero or the word `unknown` shown as a fact would be a
          // claim about the file. `bits_per_sample` is the container's own figure and the one a PCM file
          // fills in; `bits_per_raw_sample` is the decoder's, which is what FLAC has.
          const sampleBits = Number(s.bits_per_raw_sample) || s.bits_per_sample || 0
          return {
            codec: s.codec_name || 'unknown',
            channels: s.channels,
            sampleRate: s.sample_rate ? Number(s.sample_rate) : undefined,
            bitrate: s.bit_rate ? `${Math.round(Number(s.bit_rate) / 1000)}k` : undefined,
            language: (s.tags as any)?.language || 'und',
            bitDepth: sampleBits > 0 ? sampleBits : undefined,
            channelLayout: layoutName(s.channel_layout),
            // The stream's place among the AUDIO streams, which is what `-map 0:a:N` addresses — not
            // `s.index`, which counts every stream in the container (video included) and would name the
            // wrong one the moment a picture sat beside the sound. The title rides along where the
            // container carries one, so a reader can tell two tracks of one file apart.
            index: audioIndex,
            title: (s.tags as any)?.title || undefined,
          }
        })

      let dpi: string | undefined
      let colorProfile: string | undefined
      let pixelFormat: string | undefined
      const imagePath = /\.(jpg|jpeg|png|gif|webp|tif|tiff|bmp)$/i.test(filePath)
      if (imagePath) {
        const stream = (data.streams || []).find((candidate: any) => candidate.codec_type === 'video') as any
        pixelFormat = stream?.pix_fmt || undefined
        colorProfile = stream?.color_space || stream?.color_primaries || undefined
        try {
          const sips = execFileSync('/usr/bin/sips', ['-g', 'dpiWidth', '-g', 'dpiHeight', filePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
          const values = [...sips.matchAll(/dpi(?:Width|Height):\s*([0-9.]+)/gi)].map((match) => match[1])
          if (values.length) dpi = values.join(' × ')
        } catch { /* DPI is optional and unavailable on many images. */ }
      }
      resolve({
        format,
        duration,
        size,
        bitrate,
        videoStreams,
        audioStreams,
        dpi,
        colorProfile,
        pixelFormat,
      })
    })
  })
}
