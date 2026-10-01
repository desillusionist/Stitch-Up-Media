import { EncodingPreset } from '../types'
import { reconcileAudioToContainer, reconcileCodecToContainer } from './codecChoices'

export const IMAGE_CONTAINERS: Array<EncodingPreset['container']> = ['png', 'jpg']

/** Containers that carry a sound and no picture of their own. */
export const AUDIO_CONTAINERS: Array<EncodingPreset['container']> = ['mp3', 'wav', 'm4a', 'flac']

/** Containers that carry a picture and no sound, the animated one included. */
export const PICTURE_CONTAINERS: Array<EncodingPreset['container']> = ['png', 'jpg', 'gif']

/**
 * Applies a container change to a preset.
 *
 * The container decides what a job IS, in both directions and for all three of its streams, so this is
 * the one place a change of FORMAT is worked out:
 *
 * - A lone still is a single frame in an image container and a timed clip outside one, which is why the
 *   still-image mode is set on the way in and cleared on the way out.
 * - The PICTURE codec follows the container: one written for another format is dropped for the one that
 *   format is for, rather than handed to a muxer that will refuse it.
 * - The SOUND codec follows the same rule and for the same reason, and it is the one that bites hardest
 *   — WebM takes Opus and refuses an AAC outright, failing the job on its audio while its picture was
 *   never the problem.
 * - A container with no picture has nothing to write one as, so `outputMode` says so; a container with no
 *   sound is told the same way.
 */
export const applyContainerChange = (
  preset: EncodingPreset,
  container: EncodingPreset['container'],
  singleFrameSource: boolean,
): EncodingPreset => {
  const toImageContainer = IMAGE_CONTAINERS.includes(container)
  const soundOnlyContainer = AUDIO_CONTAINERS.includes(container)
  const pictureOnlyContainer = PICTURE_CONTAINERS.includes(container)

  const imageOutputMode = toImageContainer
    ? (preset.imageOutputMode ?? (singleFrameSource ? 'still' : undefined))
    : (preset.imageOutputMode === 'still' ? undefined : preset.imageOutputMode)

  // A container with no picture says so, and one with no sound says that: the same statement the two
  // toggles in EXPORT SETTINGS make, kept on the preset so the encoder and the window agree without
  // either of them having to ask what the other decided.
  const outputMode = soundOnlyContainer ? ('audio' as const) : (preset.outputMode === 'audio' ? undefined : preset.outputMode)
  const audioEnabled = pictureOnlyContainer ? false : (soundOnlyContainer ? undefined : preset.audioEnabled)

  return reconcileAudioToContainer(
    reconcileCodecToContainer({ ...preset, container, imageOutputMode, outputMode, audioEnabled }, container),
    container,
  )
}
