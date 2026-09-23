import { EncodingPreset } from '../types'

/**
 * What a container can carry, which is the question the encoder must ask before it maps anything into
 * one.
 *
 * The answer is a fact about the CONTAINER rather than about any other field on the preset, and it has
 * to be asked here rather than inferred from `outputMode`: a WAV has no room for a picture whatever
 * the preset says, and handing ffmpeg a video filter and a video codec for one is what "video-in-wav"
 * means — a failed encode, not a file with an extra stream in it. The editor's own reading of the
 * container (which controls it disables) asks the same question through this.
 *
 * Ogg is an artwork-capable container this app does not offer, so it is not named here: a container
 * that is not listed carries sound at most.
 */
export type OutputKind =
  /** Carries a picture, and may carry sound beside it. */
  | 'picture'
  /** Carries sound, and can hold a still as attached artwork. */
  | 'art'
  /** Carries sound and nothing else. */
  | 'sound'

const PICTURE_CONTAINERS: Array<EncodingPreset['container']> = ['mp4', 'mov', 'mkv', 'webm', 'gif', 'png', 'jpg']
const ART_CONTAINERS: Array<EncodingPreset['container']> = ['mp3', 'm4a', 'flac']

export const outputKind = (container: EncodingPreset['container']): OutputKind =>
  PICTURE_CONTAINERS.includes(container) ? 'picture' : ART_CONTAINERS.includes(container) ? 'art' : 'sound'

/** Whether the export can hold a video stream at all — the gate on every filter and codec for one. */
export const outputCarriesPicture = (container: EncodingPreset['container']): boolean =>
  outputKind(container) === 'picture'

/** Whether a still can be attached to the export as artwork rather than muxed as a video stream. */
export const outputTakesArt = (container: EncodingPreset['container']): boolean =>
  outputKind(container) === 'art'
