import { EncodingPreset } from '../types'
import { hasCrop } from './outputFrame'
import { outputCarriesPicture } from './outputKind'
import { kilohertz } from './audioFacts'
import { rateValue } from './frameRate'

/**
 * What a preset will actually produce, as the lines a tooltip shows.
 *
 * A preset that stops describing the job becomes CUSTOM, and a name that no longer says what the
 * output is is the one case where a summary is worth more than the label — which is why this is read
 * when the name is CUSTOM and not before. Everything here comes from the preset alone and never from a
 * source, so both windows can say the same thing about the same job without probing anything: a figure
 * the preset does not carry is named as the source's rather than guessed at.
 */
export const presetSummary = (preset: EncodingPreset): string[] => {
  const lines: string[] = []
  const pictureless = !outputCarriesPicture(preset.container) || preset.outputMode === 'audio'
  if (preset.imageOutputMode === 'still') lines.push('SINGLE FRAME')
  else if (preset.imageOutputMode === 'sequence') lines.push('IMAGE SEQUENCE')
  // A GIF with no mode named is its own animation rather than a single frame, and the summary says so
  // rather than leaving the reader to infer a run from a format that is overwhelmingly used for motion.
  else if (preset.container === 'gif') lines.push('GIF ANIMATION')
  lines.push(pictureless
    ? `${preset.container.toUpperCase()} // NO PICTURE`
    : `${preset.container.toUpperCase()} // ${preset.videoCodec.toUpperCase()}${preset.hardwareAccelerated ? ' HW' : ''}`)
  if (!pictureless) {
    const size = preset.width && preset.height
      ? `${preset.width}x${preset.height}`
      : preset.resolution === 'source' ? 'SOURCE SIZE' : preset.resolution.toUpperCase()
    lines.push(`${size} // ${preset.fps ? `${preset.fps} FPS` : 'SOURCE FPS'}`)
    if (preset.aspectRatio && preset.aspectRatio !== 'source') lines.push(`ASPECT ${preset.aspectRatio.toUpperCase()}`)
    if (preset.crop && hasCrop(preset.crop)) lines.push('SOURCE CROPPED')
    lines.push(preset.videoCodec === 'copy'
      ? 'QUALITY COPIED'
      : preset.videoBitrate ? `QUALITY ${preset.videoBitrate.toUpperCase()}` : 'QUALITY DEFAULT')
  }
  const dropped = !pictureless && preset.audioEnabled === false
  lines.push(dropped
    ? 'AUDIO DROPPED'
    : `AUDIO ${preset.audioCodec.toUpperCase()}${preset.audioBitrate && preset.audioCodec !== 'copy' && preset.audioCodec !== 'pcm' ? ` ${preset.audioBitrate.toUpperCase()}` : ''}`)
  return lines
}

/** A frame rate as the brief line writes it: `30`, or `29.97` where it is not a whole number. */
const briefFps = (value: number | undefined): string | null => {
  const fps = Number(value)
  if (!Number.isFinite(fps) || fps <= 0) return null
  const text = Math.abs(fps - Math.round(fps)) < 0.01 ? String(Math.round(fps)) : fps.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `${text} FPS`
}

/**
 * What a preset will produce, as the ONE line that sits beside the output's name in the QUEUE.
 *
 * The same three facts a SOURCE row carries beside its own name — a size, what it is written as, and a rate —
 * so the two columns read alike and the export's line lines up under the sources'. Read from the PRESET alone,
 * exactly as `presetSummary` is, so nothing is probed for it: a figure the preset does not carry is NAMED as the
 * source's rather than guessed at, so a job that names nothing reads `SOURCE SIZE · H264 · SOURCE FPS`.
 */
export const outputBriefDetails = (preset: EncodingPreset): string => {
  if (!outputCarriesPicture(preset.container) || preset.outputMode === 'audio') {
    const hz = preset.audioSampleRate ? `${kilohertz(preset.audioSampleRate)} KHZ` : 'SOURCE RATE'
    return [`AUDIO ${preset.audioCodec.toUpperCase()}`, hz].join(' · ')
  }
  const size = preset.width && preset.height ? `${preset.width}x${preset.height}` : preset.resolution === 'source' ? 'SOURCE SIZE' : preset.resolution.toUpperCase()
  return [size, preset.videoCodec.toUpperCase(), briefFps(preset.fpsRate ? rateValue(preset.fpsRate) : preset.fps) ?? 'SOURCE FPS'].join(' · ')
}
