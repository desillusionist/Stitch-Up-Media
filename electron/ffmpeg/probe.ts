import ffmpeg from 'fluent-ffmpeg'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { MediaProbeInfo } from '../../src/types'

// Automatically point to Homebrew ffmpeg/ffprobe on Apple Silicon or standard locations
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

for (const p of POSSIBLE_FFMPEG_PATHS) {
  if (fs.existsSync(p)) {
    ffmpeg.setFfmpegPath(p)
    break
  }
}

for (const p of POSSIBLE_FFPROBE_PATHS) {
  if (fs.existsSync(p)) {
    ffmpeg.setFfprobePath(p)
    break
  }
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
            channelLayout: s.channel_layout && s.channel_layout !== 'unknown' ? s.channel_layout : undefined,
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
