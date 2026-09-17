import { EncodingPreset } from '../types'

export const IMAGE_CONTAINERS: Array<EncodingPreset['container']> = ['png', 'jpg']
const IMAGE_CODECS: Array<EncodingPreset['videoCodec']> = ['png', 'mjpeg']

/**
 * Applies a container change to a preset.
 *
 * The container decides whether a lone still is a single frame or a timed clip, in
 * both directions. Clearing the still-image mode only on the way out of an image
 * container left the job stuck in clip mode when the user came back, which is why
 * a still kept a duration instead of reading zero.
 */
export const applyContainerChange = (
  preset: EncodingPreset,
  container: EncodingPreset['container'],
  singleFrameSource: boolean,
): EncodingPreset => {
  const toImageContainer = IMAGE_CONTAINERS.includes(container)
  const leavingImages = IMAGE_CONTAINERS.includes(preset.container) && !toImageContainer

  const imageOutputMode = toImageContainer
    ? (preset.imageOutputMode ?? (singleFrameSource ? 'still' : undefined))
    : (preset.imageOutputMode === 'still' ? undefined : preset.imageOutputMode)

  return {
    ...preset,
    container,
    imageOutputMode,
    // An image codec cannot fill a movie container, so leaving images falls back to
    // the default video codec rather than writing png frames into an mp4.
    videoCodec: leavingImages && IMAGE_CODECS.includes(preset.videoCodec) ? 'h264' : preset.videoCodec,
  }
}
