import { EncodingPreset } from '../types'
import { reconcileCodecToContainer } from './codecChoices'

export const IMAGE_CONTAINERS: Array<EncodingPreset['container']> = ['png', 'jpg']

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

  const imageOutputMode = toImageContainer
    ? (preset.imageOutputMode ?? (singleFrameSource ? 'still' : undefined))
    : (preset.imageOutputMode === 'still' ? undefined : preset.imageOutputMode)

  // The codec follows the container. A codec the new one cannot hold is dropped for the one that
  // container is FOR, rather than handed to a muxer that will refuse it or write a file no player can
  // open. This used to be the image-codec case alone — png frames written into an mp4 — said once here
  // for every pair of containers.
  return reconcileCodecToContainer({ ...preset, container, imageOutputMode }, container)
}
