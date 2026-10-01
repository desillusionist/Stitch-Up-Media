import { EncodingPreset } from '../types'
import { reconcileAudioToContainer, reconcileCodecToContainer } from './codecChoices'

export const IMAGE_CONTAINERS: Array<EncodingPreset['container']> = ['png', 'jpg']

/** Containers that carry a sound and no picture of their own. */
export const AUDIO_CONTAINERS: Array<EncodingPreset['container']> = ['mp3', 'wav', 'm4a', 'flac']

/** Containers that carry a picture and no sound, the animated one included. */
export const PICTURE_CONTAINERS: Array<EncodingPreset['container']> = ['png', 'jpg', 'gif']

/**
 * Containers whose output may be ONE file or a numbered run of frames.
 *
 * The two still-image containers are the obvious pair. The animated one is here for the same reason
 * and a different shape: a GIF is a single animation by default — that is what the format IS — or the
 * same numbered run a PNG sequence is, so the one control covers all three.
 */
export const FRAME_CONTAINERS: Array<EncodingPreset['container']> = ['png', 'jpg', 'gif']

/** One entry of the IMAGE OUTPUT list: what one file means for this container, and what a run means. */
export interface ImageOutputChoice {
  value: string
  label: string
  /** What the choice stores: a still, a run — or nothing at all, which for a GIF means the animation. */
  mode: EncodingPreset['imageOutputMode']
}

/**
 * The IMAGE OUTPUT list, which is the same question asked of two kinds of format.
 *
 * A still-image container writes a picture: ONE of them or a numbered run. A GIF is a moving picture,
 * so its two answers are the ANIMATION the format is named for and the run of frames it can also be.
 * Both write the same `sequence` mode; only the word on the single-file entry differs, and it is a
 * different word because "SINGLE FRAME" would be a lie about a GIF.
 */
export const imageOutputChoicesFor = (container: EncodingPreset['container']): ImageOutputChoice[] =>
  container === 'gif'
    ? [{ value: 'animation', label: 'ANIMATION', mode: undefined }, { value: 'sequence', label: 'SEQUENCE OF FRAMES', mode: 'sequence' }]
    : [{ value: 'still', label: 'SINGLE FRAME', mode: 'still' }, { value: 'sequence', label: 'SEQUENCE', mode: 'sequence' }]

/** The entry a preset is standing on. An absent mode is this container's own default rather than a blank. */
export const imageOutputChoiceValue = (preset: Pick<EncodingPreset, 'container' | 'imageOutputMode'>): string => {
  const choices = imageOutputChoicesFor(preset.container)
  return choices.find((choice) => choice.mode === preset.imageOutputMode)?.value ?? defaultImageOutputChoiceValue(preset.container)
}

/** What the control opens on: the animation for a GIF, a single frame for everything else. */
export const defaultImageOutputChoiceValue = (container: EncodingPreset['container']): string =>
  container === 'gif' ? 'animation' : 'still'

/** The preset with one entry of its container's IMAGE OUTPUT list applied. */
export const applyImageOutputChoice = (preset: EncodingPreset, value: string): EncodingPreset => {
  const choice = imageOutputChoicesFor(preset.container).find((candidate) => candidate.value === value)
  return choice ? { ...preset, imageOutputMode: choice.mode } : preset
}

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
): EncodingPreset => {
  const toImageContainer = IMAGE_CONTAINERS.includes(container)
  const soundOnlyContainer = AUDIO_CONTAINERS.includes(container)
  const pictureOnlyContainer = PICTURE_CONTAINERS.includes(container)

  // A run of frames survives a change of container wherever the new one can write a run; everything
  // else falls to that container's own default. A still-image container opens on SINGLE FRAME — which
  // is what one .png is — while a GIF opens on its animation, because that is what a GIF is FOR.
  const imageOutputMode = container === 'gif'
    ? (preset.imageOutputMode === 'sequence' ? 'sequence' : undefined)
    : toImageContainer
      ? (preset.imageOutputMode === 'sequence' ? 'sequence' : 'still')
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
