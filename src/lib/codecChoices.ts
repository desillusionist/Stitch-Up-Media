import { EncodingPreset } from '../types'

/**
 * What a container can hold, and what the encoder can write into it.
 *
 * The PRESET list in EXPORT SETTINGS used to be one list for every container, which offered H.264 into a
 * WebM and VP9 into a MOV, and never offered the intermediates a finishing house actually works in. The
 * choice belongs to the CONTAINER, so the table does: a MOV offers the ProRes family, DXV and Hap beside
 * the delivery codecs, a WebM offers VP9 and AV1, and a sound-only container offers nothing at all.
 *
 * Every codec listed here has been run through this machine's own ffmpeg before being offered, which is
 * where the rules the encoder follows come from: DXV, Hap, MPEG-4 and QuickTime Animation all write into
 * a MOV, and Hap — and only Hap — refuses a frame that is not a multiple of four.
 */

/** One entry of the list: what it is called, what it writes, and why it cannot be chosen where it cannot. */
export interface CodecChoice {
  /** What the select stores; not a codec name, because one codec can stand for several entries. */
  value: string
  label: string
  videoCodec: EncodingPreset['videoCodec']
  /** The ProRes entry's own profile, which is the whole of what separates the five of them. */
  proresProfile?: EncodingPreset['proresProfile']
  /** Set when the entry is shown but cannot be chosen, and says why. */
  reason?: string
}

type Container = EncodingPreset['container']

const copy = (): CodecChoice => ({ value: 'copy', label: 'COPY THE SOURCE', videoCodec: 'copy' })
const h264 = (): CodecChoice => ({ value: 'h264', label: 'H.264 / AVC', videoCodec: 'h264' })
const hevc = (): CodecChoice => ({ value: 'hevc', label: 'HEVC / H.265', videoCodec: 'hevc' })
const vp9 = (): CodecChoice => ({ value: 'vp9', label: 'VP9', videoCodec: 'vp9' })
const av1 = (): CodecChoice => ({ value: 'av1', label: 'AV1', videoCodec: 'av1' })
const png = (): CodecChoice => ({ value: 'png', label: 'PNG (LOSSLESS)', videoCodec: 'png' })
const mjpeg = (): CodecChoice => ({ value: 'mjpeg', label: 'MJPEG', videoCodec: 'mjpeg' })

/** The ProRes family, one entry per profile, which is the whole of the difference between them. */
const proresChoice = (value: string, label: string, profile: NonNullable<EncodingPreset['proresProfile']>): CodecChoice =>
  ({ value, label, videoCodec: 'prores', proresProfile: profile })
const PRORES_422 = proresChoice('prores-422', 'PRORES 422', 'standard')
const PRORES_FAMILY: CodecChoice[] = [
  proresChoice('prores-proxy', 'PRORES 422 PROXY', 'proxy'),
  proresChoice('prores-lt', 'PRORES 422 LT', 'lt'),
  PRORES_422,
  proresChoice('prores-hq', 'PRORES 422 HQ', 'hq'),
  proresChoice('prores-4444', 'PRORES 4444', '4444'),
]

/** A container that carries no picture: the entry explains itself rather than leaving an empty box. */
const soundOnly = (): CodecChoice => ({ value: 'none', label: 'NO PICTURE IN THIS FORMAT', videoCodec: 'copy', reason: 'THIS FORMAT CARRIES SOUND ONLY, SO THERE IS NOTHING TO ENCODE A PICTURE AS.' })

/** The list for each container, exhaustive by type so a container added later cannot be forgotten. */
const CHOICES: Record<Container, CodecChoice[]> = {
  // MP4 is the delivery container: the codecs a player expects, and nothing a player would refuse. The
  // still-image codecs are not here at all — a png or an mjpeg stream inside an mp4 is one no player
  // will open, which is the fault the image-codec rule this replaces was written for.
  mp4: [copy(), h264(), hevc(), av1(), vp9()],
  // MOV is the finishing container, which is what the ProRes family, DXV and Hap are for — and MJPEG,
  // which a QuickTime file has always been able to carry.
  mov: [
    copy(), ...PRORES_FAMILY,
    { value: 'dxv', label: 'RESOLUME DXV', videoCodec: 'dxv' },
    { value: 'hap', label: 'HAP / VIDVOX', videoCodec: 'hap' },
    h264(), hevc(),
    { value: 'mpeg4', label: 'MPEG-4 PART 2', videoCodec: 'mpeg4' },
    { value: 'qtrle', label: 'QUICKTIME ANIMATION', videoCodec: 'qtrle' },
    mjpeg(),
  ],
  mkv: [copy(), h264(), hevc(), av1(), vp9(), PRORES_422],
  webm: [copy(), vp9(), av1()],
  gif: [{ value: 'gif', label: 'GIF', videoCodec: 'gif' }],
  png: [png()],
  jpg: [{ value: 'mjpeg', label: 'JPEG', videoCodec: 'mjpeg' }],
  mp3: [soundOnly()],
  wav: [soundOnly()],
  m4a: [soundOnly()],
  flac: [soundOnly()],
}

/** The container's own list, in the order it is offered. */
export const codecChoicesFor = (container: Container): CodecChoice[] => CHOICES[container] ?? [copy()]

/** The entry a preset is standing on, by the codec AND the ProRes profile, which is what tells the five apart. */
export const codecChoiceFor = (preset: Pick<EncodingPreset, 'container' | 'videoCodec' | 'proresProfile'>): CodecChoice | undefined => {
  const choices = codecChoicesFor(preset.container)
  const profile = preset.videoCodec === 'prores' ? preset.proresProfile ?? 'standard' : undefined
  return choices.find((choice) => choice.videoCodec === preset.videoCodec && choice.proresProfile === profile)
    // A preset written before a profile was part of the choice still lands on its codec's first entry
    // rather than on nothing, so the list is never left showing a blank.
    ?? choices.find((choice) => choice.videoCodec === preset.videoCodec)
    // And a container with ONE entry has only one thing it can be saying: a sound container's entry
    // explains itself, and a still container's is the codec it writes however the job was set up.
    ?? (choices.length === 1 ? choices[0] : undefined)
}

/** The value the select is showing. */
export const codecChoiceValue = (preset: Pick<EncodingPreset, 'container' | 'videoCodec' | 'proresProfile'>): string =>
  codecChoiceFor(preset)?.value ?? ''

/** The preset with one entry of its container's list applied. */
export const applyCodecChoice = (preset: EncodingPreset, value: string): EncodingPreset => {
  const choice = codecChoicesFor(preset.container).find((candidate) => candidate.value === value)
  if (!choice || choice.reason) return preset
  return { ...preset, videoCodec: choice.videoCodec, proresProfile: choice.proresProfile }
}

/**
 * The choice a container falls back to when it cannot hold the one the job arrived with.
 *
 * Named per container rather than taken as the list's first entry, because "first" would mean ProRes
 * Proxy for a MOV and COPY for a WebM, and a job moved into a new container wants the codec a reader
 * would have picked for it: what that container is FOR.
 */
const DEFAULT_CHOICE: Record<Container, string> = {
  mp4: 'h264', mov: 'h264', mkv: 'h264', webm: 'vp9', gif: 'gif', png: 'png', jpg: 'mjpeg', mp3: 'none', wav: 'none', m4a: 'none', flac: 'none',
}

/** Whether the container can write this codec at all. */
export const containerTakesCodec = (container: Container, videoCodec: EncodingPreset['videoCodec']): boolean =>
  codecChoicesFor(container).some((choice) => !choice.reason && choice.videoCodec === videoCodec)

/** The preset moved onto a codec its container can hold, onto that entry's ProRes profile with it. */
export const reconcileCodecToContainer = (preset: EncodingPreset, container: Container): EncodingPreset => {
  const moved = { ...preset, container }
  return containerTakesCodec(container, preset.videoCodec)
    ? moved
    : applyCodecChoice(moved, DEFAULT_CHOICE[container])
}
