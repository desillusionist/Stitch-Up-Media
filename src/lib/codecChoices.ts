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
const hevc = (): CodecChoice => ({ value: 'hevc', label: 'H.265 / HEVC', videoCodec: 'hevc' })
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
  proresChoice('prores-4444xq', 'PRORES 4444 XQ', '4444xq'),
]

/**
 * DXV, and the generations this encoder cannot write.
 *
 * Resolume's format has three generations and four variants of the newest, and this build of ffmpeg
 * writes ONE of them: its encoder offers a single `-format` value, `dxt1` — normal quality, no alpha —
 * and nothing else, which is read straight off `ffmpeg -h encoder=dxv`. The rest are shown and cannot be
 * chosen, with the reason, because an entry that is missing is indistinguishable from one that was
 * never thought of — and because the reader asking for DXV3 is owed the fact that it is the ENCODER and
 * not the app that does not have it.
 */
const DXV_REASON = 'THIS BUILD OF FFMPEG WRITES ONLY DXV WITH DXT1 — NORMAL QUALITY, NO ALPHA. ITS ENCODER OFFERS NO OTHER FORMAT.'
const dxv = (): CodecChoice[] => [
  { value: 'dxv', label: 'DXV (DXT1, NO ALPHA)', videoCodec: 'dxv' },
  { value: 'dxv2', label: 'DXV2', videoCodec: 'dxv', reason: DXV_REASON },
  { value: 'dxv3', label: 'DXV3 — NORMAL / NO ALPHA', videoCodec: 'dxv', reason: DXV_REASON },
  { value: 'dxv3hq', label: 'DXV3 — HQ / WITH ALPHA', videoCodec: 'dxv', reason: DXV_REASON },
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
    copy(), ...PRORES_FAMILY, ...dxv(),
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

/** The value a container's picture list opens on, which is what a field's reset puts it back to. */
export const defaultCodecChoiceValue = (container: Container): string => DEFAULT_CHOICE[container]

/** The same for the sound list. */
export const defaultAudioChoiceValue = (container: Container): string => DEFAULT_AUDIO[container]

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

/**
 * The SOUND half of the same question.
 *
 * Asked separately because it is a separate stream with its own rules, and the one that bites hardest is
 * WebM: it takes Vorbis or Opus and refuses an AAC outright, so a WebM job left on the default sound
 * fails on its AUDIO while its picture was never the problem. The lists below are what each container
 * will actually hold, and `npm run verify-codecs` exports every one of them.
 */
export interface AudioChoice {
  value: string
  label: string
  audioCodec: EncodingPreset['audioCodec']
  /** Set when the entry is shown but cannot be chosen, and says why. */
  reason?: string
}

const aCopy = (): AudioChoice => ({ value: 'copy', label: 'COPY THE SOURCE', audioCodec: 'copy' })
const aac = (): AudioChoice => ({ value: 'aac', label: 'AAC', audioCodec: 'aac' })
const mp3 = (): AudioChoice => ({ value: 'mp3', label: 'MP3', audioCodec: 'mp3' })
const opus = (): AudioChoice => ({ value: 'opus', label: 'OPUS', audioCodec: 'opus' })
const pcm = (): AudioChoice => ({ value: 'pcm', label: 'PCM (UNCOMPRESSED)', audioCodec: 'pcm' })
const flac = (): AudioChoice => ({ value: 'flac', label: 'FLAC (LOSSLESS)', audioCodec: 'flac' })
const noSound = (): AudioChoice => ({ value: 'none', label: 'NO SOUND IN THIS FORMAT', audioCodec: 'copy', reason: 'THIS FORMAT CARRIES A PICTURE ONLY, SO THERE IS NOTHING TO ENCODE A SOUND AS.' })

const AUDIO_CHOICES: Record<Container, AudioChoice[]> = {
  mp4: [aCopy(), aac(), mp3(), opus()],
  mov: [aCopy(), aac(), pcm(), mp3()],
  mkv: [aCopy(), aac(), mp3(), opus(), pcm(), flac()],
  // WebM takes Vorbis or Opus and refuses everything else, which is why this list is two long.
  webm: [aCopy(), opus()],
  // A sound container IS its codec, so it offers that one and nothing else.
  mp3: [mp3()],
  wav: [pcm()],
  m4a: [aac(), mp3()],
  flac: [flac()],
  png: [noSound()],
  jpg: [noSound()],
  gif: [noSound()],
}

/** What each container is FOR, as a sound: what a job moved into it should carry. */
const DEFAULT_AUDIO: Record<Container, string> = {
  mp4: 'aac', mov: 'aac', mkv: 'aac', webm: 'opus', mp3: 'mp3', wav: 'pcm', m4a: 'aac', flac: 'flac', png: 'none', jpg: 'none', gif: 'none',
}

/** The container's own sound list, in the order it is offered. */
export const audioChoicesFor = (container: Container): AudioChoice[] => AUDIO_CHOICES[container] ?? [aCopy()]

/** The entry a preset's sound is standing on, with the same single-entry fallback the picture list has. */
export const audioChoiceFor = (preset: Pick<EncodingPreset, 'container' | 'audioCodec'>): AudioChoice | undefined => {
  const choices = audioChoicesFor(preset.container)
  return choices.find((choice) => choice.audioCodec === preset.audioCodec)
    ?? choices.find((choice) => !choice.reason)
    ?? choices[0]
}

/** The value the sound select is showing. */
export const audioChoiceValue = (preset: Pick<EncodingPreset, 'container' | 'audioCodec'>): string =>
  audioChoiceFor(preset)?.value ?? ''

/** The preset with one entry of its container's sound list applied. */
export const applyAudioChoice = (preset: EncodingPreset, value: string): EncodingPreset => {
  const choice = audioChoicesFor(preset.container).find((candidate) => candidate.value === value)
  if (!choice || choice.reason) return preset
  return { ...preset, audioCodec: choice.audioCodec }
}

/** Whether the container can carry this sound codec at all. */
export const containerTakesAudio = (container: Container, audioCodec: EncodingPreset['audioCodec']): boolean =>
  audioChoicesFor(container).some((choice) => !choice.reason && choice.audioCodec === audioCodec)

/** The preset's sound moved onto one its container can hold. */
export const reconcileAudioToContainer = (preset: EncodingPreset, container: Container): EncodingPreset => {
  const moved = { ...preset, container }
  return containerTakesAudio(container, preset.audioCodec)
    ? moved
    : applyAudioChoice(moved, DEFAULT_AUDIO[container])
}
