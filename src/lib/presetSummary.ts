import { EncodingPreset } from '../types'
import { hasCrop } from './outputFrame'
import { outputCarriesPicture } from './outputKind'

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
