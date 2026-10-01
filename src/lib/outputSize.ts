import { EncodingPreset } from '../types'

/**
 * How big the file is going to be, when that is a question with an answer.
 *
 * A size is only knowable for an encoder that writes at a FIXED rate, and it is a question the SUMMARY
 * line is asked on every job, so this answers it where it can and says nothing where it cannot. Three
 * cases have a figure:
 *
 * - a bitrate the job names, which is what most of the presets are built on;
 * - ProRes, whose profile IS a bitrate — the family is a fixed-rate format by specification, so the
 *   documented target for the profile, scaled by the frame's area and rate, is the answer. That is the
 *   one a finishing house actually wants, and it is the one a CRF encoder cannot give: H.264 at CRF 20
 *   has no bitrate until it has been encoded.
 * - PCM, whose figure is arithmetic: samples per second times channels times sixteen bits.
 *
 * Anything else — a CRF preset, a stream copy, FLAC, an image — answers with nothing, and the SUMMARY
 * says so rather than inventing a figure.
 */

/** Everything the estimate is worked out from, passed whole so the arithmetic can be read on its own. */
export interface SizeEstimateInput {
  /** How long the finished output runs, in seconds. */
  seconds: number
  /** Whether a picture and a sound are written at all; a stream that is not written costs nothing. */
  picture: boolean
  sound: boolean
  videoCodec: EncodingPreset['videoCodec']
  /** A bitrate the job named, as the window writes it: `8M`, `750k`, `200000`. */
  videoBitrate?: string
  proresProfile?: EncodingPreset['proresProfile']
  /** The frame the ProRes estimate is scaled from, which is what its bitrate is quoted against. */
  width?: number
  height?: number
  fps?: number
  audioCodec: EncodingPreset['audioCodec']
  audioBitrate?: string
  audioChannels?: number
  audioSampleRate?: number
}

/** `8M` is eight million bits a second and `320k` is three hundred and twenty thousand. */
export const bitsPerSecond = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const match = /^\s*([0-9]*\.?[0-9]+)\s*([kmg]?)\s*$/i.exec(value)
  if (!match) return undefined
  const scale = { '': 1, k: 1e3, m: 1e6, g: 1e9 }[match[2].toLowerCase()] ?? 1
  const rate = Number(match[1]) * scale
  return Number.isFinite(rate) && rate > 0 ? rate : undefined
}

/**
 * What each ProRes profile writes, in bits a second, at 1920x1080 and 29.97 fps.
 *
 * The published targets for the family. They are a rate per frame AREA rather than a constant, so the
 * figure below is scaled by the frame's own area and rate — which is exactly how the specification
 * describes it and why an estimate for ProRes is worth having and an estimate for CRF is not.
 */
const PRORES_TARGET_AT_1080P30: Record<NonNullable<EncodingPreset['proresProfile']>, number> = {
  proxy: 45e6, lt: 102e6, standard: 147e6, hq: 220e6, '4444': 330e6, '4444xq': 500e6,
}

/** The picture's rate, or nothing where it has no fixed one. */
const pictureBitsPerSecond = (input: SizeEstimateInput): number | undefined => {
  if (!input.picture) return 0
  if (input.videoCodec === 'copy') return undefined
  const named = bitsPerSecond(input.videoBitrate)
  if (named) return named
  if (input.videoCodec !== 'prores') return undefined
  const target = PRORES_TARGET_AT_1080P30[input.proresProfile ?? 'standard']
  const area = (input.width ?? 1920) * (input.height ?? 1080)
  const fps = input.fps && input.fps > 0 ? input.fps : 29.97
  return target * (area / (1920 * 1080)) * (fps / 29.97)
}

/** The sound's rate, or nothing where it has no fixed one. */
const soundBitsPerSecond = (input: SizeEstimateInput): number | undefined => {
  if (!input.sound) return 0
  // PCM is arithmetic rather than a setting: 48 kHz of sixteen-bit stereo is 1.536 Mb/s exactly.
  if (input.audioCodec === 'pcm') return (input.audioSampleRate || 48000) * (input.audioChannels || 2) * 16
  if (input.audioCodec === 'copy') return undefined
  if (input.audioCodec === 'flac') return undefined
  return bitsPerSecond(input.audioBitrate)
}

/**
 * The size in bytes, or nothing where either stream that IS written has no fixed rate.
 *
 * A stream nobody asked for contributes nothing rather than making the whole answer unknown — an
 * audio-only export of a WAV is a size — but a stream that is written and cannot be worked out makes the
 * total a guess, and a guess is worse than the word UNKNOWN.
 */
export const estimateOutputBytes = (input: SizeEstimateInput): number | undefined => {
  if (!(input.seconds > 0)) return undefined
  const video = pictureBitsPerSecond(input)
  const audio = soundBitsPerSecond(input)
  if (video === undefined || audio === undefined) return undefined
  const total = video + audio
  if (total <= 0) return undefined
  // The muxer's own overhead, which is a couple of per cent on a normal file rather than a figure worth
  // being clever about.
  return Math.round((total / 8) * input.seconds * 1.02)
}

/** A size in the units a reader thinks in: kB, MB, GB, one decimal past the first unit. */
export const sizeLabel = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++ }
  return `${unit === 0 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}
