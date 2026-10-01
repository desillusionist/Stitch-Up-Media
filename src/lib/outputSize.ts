import { EncodingPreset } from '../types'

/**
 * How big the file is going to be, in the range the question has an answer in.
 *
 * A size is only a NUMBER for an encoder that writes at a fixed rate. Everything else is bracketed, and
 * saying so is the whole point of this module: a figure that looks measured but is not is worse than the
 * word UNKNOWN, because it is read as an answer.
 *
 * Three kinds of answer, and the SUMMARY says which one it is showing:
 *
 * - EXACT — arithmetic rather than a setting. PCM is the only one this app can write: samples per second,
 *   times channels, times the sixteen bits a sample is stored in.
 * - CLOSE — a fixed-rate encoder, which is a bitrate the job named or the target a ProRes profile is
 *   specified at. Accurate to a few per cent, and honest about the muxer's own per-cent on top.
 * - ROUGH — an encoder whose output depends on the PICTURE rather than on a setting. PNG, JPEG and GIF
 *   all compress whatever they are given, so the figure is a RANGE and is drawn as one.
 *
 * THE PICTURE IS SIZED FROM THE OUTPUT, never from the source: the source is re-encoded, so the clip's own
 * dimensions and codec never enter it. What enters is the frame the encoder writes and the count of
 * frames it writes — one for a single frame, and the assembled count for a run or a movie. See
 * `framesFrom`.
 */

export type SizeConfidence =
  /** Arithmetic. The figure IS the answer. */
  | 'exact'
  /** A fixed-rate encoder. Accurate to a few per cent. */
  | 'close'
  /** A content-dependent encoder. A range, never a number. */
  | 'rough'

export interface SizeEstimate {
  /** The point estimate: the one figure for `exact` and `close`, and the LOW end of a range for `rough`. */
  bytes: number
  /** The HIGH end, present only where the figure is a range. */
  high?: number
  confidence: SizeConfidence
}

/** Everything the estimate is worked out from, passed whole so the arithmetic can be read on its own. */
export interface SizeEstimateInput {
  /** How long the assembled output runs, in seconds. Zero for a single frame. */
  seconds: number
  /** How many frames the output writes: one for a single frame, the assembled count for anything timed. */
  frames: number
  /** Whether a picture and a sound are written at all; a stream that is not written costs nothing. */
  picture: boolean
  sound: boolean
  videoCodec: EncodingPreset['videoCodec']
  /** A bitrate the job named, as the window writes it: `8M`, `750k`, `200000`. */
  videoBitrate?: string
  proresProfile?: EncodingPreset['proresProfile']
  /** The OUTPUT frame, which is what the picture is sized from — never the source's own size. */
  width?: number
  height?: number
  /** The rate the output is written at. */
  fps?: number
  /** Whether the picture is written with an alpha channel, which is one more sample a pixel. */
  alpha?: boolean
  /** The picture's own sample depth per channel, where the format has a choice. */
  bitDepth?: 8 | 16
  audioCodec: EncodingPreset['audioCodec']
  audioBitrate?: string
  audioChannels?: number
  audioSampleRate?: number
  /** The bytes an attached still adds, where the job carries one and its size is known. */
  coverArtBytes?: number
  /** Whether the output is wrapped in a container at all. A numbered run of files is not. */
  containerized: boolean
}

/** The frames a timed output writes, which is the assembled length at the rate it is written. */
export const framesFrom = (seconds: number, fps: number): number => Math.max(1, Math.round(Math.max(0, seconds) * (fps > 0 ? fps : 30)))

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
 * figure is scaled by the output frame's own area and rate — which is exactly how the specification
 * describes it, and why an estimate for ProRes is worth having while an estimate for a CRF encoder is not.
 * Bit depth is already in the profile these figures belong to, so nothing further is multiplied for it.
 */
const PRORES_TARGET_AT_1080P30: Record<NonNullable<EncodingPreset['proresProfile']>, number> = {
  proxy: 45e6, lt: 102e6, standard: 147e6, hq: 220e6, '4444': 330e6, '4444xq': 500e6,
}

/**
 * What a still picture costs a frame, as a bracket in one of two bases.
 *
 * `raw` is a share of the SAMPLES the frame has — which is what a lossless encoder compresses, so the
 * bracket is how well it does on flat content and on detailed content. `pixel` is bytes per output pixel
 * directly, which is what a codec that throws the samples away is better described by.
 *
 * These are brackets, not measurements: this app has no way to look at the picture it is about to write
 * without writing it, so the honest answer is the span. See the presentation in `estimateLabel`.
 */
const IMAGE_BRACKETS: Partial<Record<EncodingPreset['videoCodec'], { low: number; high: number; basis: 'raw' | 'pixel' }>> = {
  // A PNG is lossless, so its size is the picture's: a flat drawing lands near a third of the samples and
  // a detailed frame near two thirds.
  png: { low: 0.3, high: 0.6, basis: 'raw' },
  // A JPEG at the encoder's own quality, from a smooth frame to a detailed one.
  mjpeg: { low: 0.2, high: 0.9, basis: 'pixel' },
  // A GIF: an eight-bit palette, LZW over it, and inter-frame deltas on top — the widest of the three.
  gif: { low: 0.15, high: 0.7, basis: 'pixel' },
}

/** A stream's own bracket, in bytes. */
interface Talk { low: number; high: number; confidence: SizeConfidence }

const ORDER: SizeConfidence[] = ['exact', 'close', 'rough']
const worstOf = (list: SizeConfidence[]): SizeConfidence =>
  list.reduce<SizeConfidence>((worst, next) => (ORDER.indexOf(next) > ORDER.indexOf(worst) ? next : worst), 'exact')

/** A fixed-rate answer, in bytes, with the muxer's own few per cent added later rather than here. */
const fixedBytes = (bitsPerSecondValue: number, seconds: number, confidence: SizeConfidence): Talk => {
  const bytes = Math.round((bitsPerSecondValue / 8) * Math.max(0, seconds))
  return { low: bytes, high: bytes, confidence }
}

const pictureSize = (input: SizeEstimateInput): Talk | undefined => {
  if (!input.picture) return { low: 0, high: 0, confidence: 'exact' }
  // A passthrough writes whatever the source was; there is no figure to work out from a preset.
  if (input.videoCodec === 'copy') return undefined
  // A bitrate the job named wins over everything, whichever codec it is: it is what the encoder is told.
  const named = bitsPerSecond(input.videoBitrate)
  if (named) return fixedBytes(named, input.seconds, 'close')
  const area = (input.width ?? 1920) * (input.height ?? 1080)
  const fps = input.fps && input.fps > 0 ? input.fps : 29.97
  if (input.videoCodec === 'prores') {
    const target = PRORES_TARGET_AT_1080P30[input.proresProfile ?? 'standard']
    return fixedBytes(target * (area / (1920 * 1080)) * (fps / 29.97), input.seconds, 'close')
  }
  // Everything else the app writes as pictures is a still codec, whose size is the PICTURE's rather than a
  // setting — so the figure is the frame's own samples, bracketed, times the frames written.
  const bracket = IMAGE_BRACKETS[input.videoCodec]
  if (!bracket) return undefined
  const channels = 3 + (input.alpha ? 1 : 0)
  const samples = area * channels * ((input.bitDepth ?? 8) / 8)
  const perFrame = bracket.basis === 'raw'
    ? { low: samples * bracket.low, high: samples * bracket.high }
    : { low: area * bracket.low, high: area * bracket.high }
  const frames = Math.max(1, Math.round(input.frames))
  return { low: Math.round(perFrame.low * frames), high: Math.round(perFrame.high * frames), confidence: 'rough' }
}

const soundSize = (input: SizeEstimateInput): Talk | undefined => {
  if (!input.sound) return { low: 0, high: 0, confidence: 'exact' }
  const rate = input.audioSampleRate || 48000
  const channels = input.audioChannels || 2
  const seconds = Math.max(0, input.seconds)
  if (input.audioCodec === 'pcm') {
    // Arithmetic rather than a setting: 48 kHz of sixteen-bit stereo is 1.536 Mb/s exactly.
    const bytes = Math.round((rate * channels * 16 / 8) * seconds)
    return { low: bytes, high: bytes, confidence: 'exact' }
  }
  if (input.audioCodec === 'copy') return undefined
  if (input.audioCodec === 'flac') {
    // Lossless audio compresses to about half of the PCM figure, and how much depends on the sound rather
    // than on the setting — so a range, narrower than a picture's because audio varies less.
    const pcm = (rate * channels * 16 / 8) * seconds
    return { low: Math.round(pcm * 0.45), high: Math.round(pcm * 0.65), confidence: 'rough' }
  }
  const named = bitsPerSecond(input.audioBitrate)
  return named ? fixedBytes(named, seconds, 'close') : undefined
}

/**
 * The size in the range it has an answer in, or nothing at all where a stream that IS written has no rate
 * to work one out from.
 *
 * A stream nobody asked for contributes nothing rather than making the whole answer unknown — a sound-only
 * export of a WAV is a size — but a stream that is written and cannot be worked out makes the total a
 * guess, and the word UNKNOWN is a better answer than a guess. See `estimateLabel` for how the three
 * confidences are drawn.
 */
export const estimateOutputSize = (input: SizeEstimateInput): SizeEstimate | undefined => {
  const picture = pictureSize(input)
  const sound = soundSize(input)
  if (picture === undefined || sound === undefined) return undefined
  const art = Math.max(0, Math.round(input.coverArtBytes ?? 0))
  // A muxer's own overhead is a per cent on a normal file, and a numbered run of image files has no
  // container to pay it to.
  const scale = input.containerized ? 1.01 : 1
  const low = picture.low + sound.low + art
  const high = picture.high + sound.high + art
  if (high <= 0) return undefined
  return {
    bytes: Math.round(low * scale),
    ...(high > low ? { high: Math.round(high * scale) } : {}),
    confidence: worstOf([picture.confidence, sound.confidence]),
  }
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

/**
 * A RANGE, drawn in ONE unit so the two ends can be read against each other.
 *
 * A bracket that runs from three hundred kilobytes to a megabyte and a half is written `0.3-1.5 MB`
 * rather than `311 kB-1.5 MB`: the two ends are the same quantity, and a reader comparing them should not
 * have to convert one in their head to do it. The unit is the LARGER end's, which is the one that decides
 * the order of magnitude.
 */
const rangeLabel = (low: number, high: number): string => {
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let value = high
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++ }
  const at = (bytes: number) => (unit === 0 ? String(Math.round(bytes)) : String(Math.round((bytes / 1000 ** unit) * 10) / 10))
  return `~ ${at(low)}-${at(high)} ${units[unit]}`
}

/**
 * The estimate as the SUMMARY draws it, which is where the confidence has to be visible.
 *
 * An exact figure is written plainly, because it IS the answer. A fixed-rate one is marked with a tilde
 * equals, because it is the encoder's target rather than a measurement of the file. A content-dependent
 * one is written as the RANGE it is, which is the only honest way to draw a bracket — a single number
 * there would be read as measured, and nothing measured it.
 */
export const estimateLabel = (estimate: SizeEstimate | undefined): string => {
  if (!estimate) return 'UNKNOWN'
  if (estimate.confidence === 'rough' && estimate.high !== undefined && estimate.high > estimate.bytes) {
    return rangeLabel(estimate.bytes, estimate.high)
  }
  if (estimate.confidence === 'close') return `≈ ${sizeLabel(estimate.bytes)}`
  return sizeLabel(estimate.bytes)
}
