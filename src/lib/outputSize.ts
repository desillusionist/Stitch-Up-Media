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
  /** The PNG encoder's own work setting, 0 to 9. Absent means the encoder's default. */
  pngCompression?: number
  /** The JPEG encoder's own quality, 1 to 31 with the lower figure the better picture. */
  jpegQuality?: number
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
 * What a still picture costs a frame, per codec, as a pair of brackets: a flat frame and a photograph.
 *
 * These are MEASURED, on this machine's own encoders, over four frames — a landscape photograph, a
 * synthetic detailed pattern, an animated gradient and a test pattern — because the honest answer for a
 * codec that compresses WHAT IT IS GIVEN is the span it lands in, never a single number. The first figure
 * is the flattest frame measured and the second the photograph; a frame lying between them lands between.
 *
 * THEY ARE KEYED BY THE SETTING where the setting moves them, because it does — a PNG's own work level
 * changes the file by up to twenty times, and a JPEG's quality by up to four, and a figure that ignored
 * them would be a figure that never moved when the reader moved the control beside it.
 */
const PNG_LEVEL_FACTORS: Array<[number, number]> = [
  [1.0034, 1.0036], // 0: stored, so the frame is its own samples and nothing more
  [0.0054, 0.2793], // 1
  [0.0052, 0.2703], // 2
  [0.0052, 0.2567], // 3
  [0.0016, 0.2499], // 4
  [0.0016, 0.2413], // 5
  [0.0016, 0.2324], // 6
  [0.0016, 0.2289], // 7
  [0.0016, 0.2237], // 8
  [0.0014, 0.2215], // 9
]
/** The encoder's own PNG setting, measured rather than assumed: it behaves as level 6. */
const PNG_DEFAULT_FACTOR: [number, number] = [0.0016, 0.2324]

/** JPEG quality 1 to 31, in bytes per output pixel. A lower figure is a better picture and a bigger file. */
const JPEG_QUALITY_FACTORS: Array<[number, number]> = [
  [0.0123, 0.1392], [0.0123, 0.1392], [0.0119, 0.1073], [0.0116, 0.0915], [0.0113, 0.0819],
  [0.0111, 0.0735], [0.0108, 0.0678], [0.0107, 0.0631], [0.0105, 0.0600], [0.0105, 0.0571],
  [0.0103, 0.0546], [0.0101, 0.0526], [0.0100, 0.0510], [0.0100, 0.0494], [0.0099, 0.0479],
  [0.0098, 0.0466], [0.0097, 0.0456], [0.0097, 0.0446], [0.0096, 0.0436], [0.0095, 0.0428],
  [0.0095, 0.0422], [0.0095, 0.0415], [0.0095, 0.0409], [0.0094, 0.0403], [0.0094, 0.0399],
  [0.0093, 0.0394], [0.0092, 0.0390], [0.0092, 0.0386], [0.0092, 0.0383], [0.0091, 0.0378],
  [0.0091, 0.0375],
]
/** The encoder's own JPEG quality, measured: it behaves as six on the frames measured. */
const JPEG_DEFAULT_FACTOR: [number, number] = [0.0113, 0.0735]

/**
 * The animated format's own, in bytes per output pixel, measured for a single frame.
 *
 * It has no setting to key on — the palette and the LZW pass are the encoder's own — so it is one bracket.
 * A RUN of frames measured a little better than the bracket's low end and an animation better still, because
 * what the frames of one picture have in common is what a frame-sequence and a GIF both spend one frame's
 * worth of it on; the bracket is left where the single frame measured it, which is the conservative end.
 */
const GIF_FACTOR: [number, number] = [0.0407, 0.3676]

/**
 * What a DELIVERY codec costs a frame, in bits per pixel per frame, at the quality this app's encoder is
 * told to write.
 *
 * CRF has no bitrate until the encode has happened, so the honest answer is the span the encoder's own
 * output lands in across content — and these are MEASURED, on this machine's encoders, with the very
 * settings the engine passes (a frame at 1280x720 and 30 fps, four seconds long):
 *
 *   codec                     animated gradient    dense moving detail
 *   H.264 (crf 20, medium)          0.0090 bpp            0.1495 bpp
 *   H.265 (crf 23, medium)          0.0014 bpp            0.1315 bpp
 *   VP9   (its own default)         0.0010 bpp            0.1180 bpp
 *   AV1   (its own default)         0.0010 bpp            0.1078 bpp
 *
 * A near-static picture sits BELOW the low end — a test pattern measured 0.0004 bpp at every one of them
 * — so this brackets moving footage rather than everything a file could hold. It is still a RANGE rather
 * than a number, which is the whole point: a figure drawn here as measured would be read as a promise.
 *
 * Bit depth is deliberately NOT multiplied in. Measured at the same CRF, ten bits a sample came out at
 * 0.1490 bpp against eight bits' 0.1495: the depth spends the same rate on a different picture rather
 * than making a larger file, and the difference is far inside the bracket already.
 */
const DELIVERY_BPP: Partial<Record<EncodingPreset['videoCodec'], { low: number; high: number }>> = {
  h264: { low: 0.009, high: 0.1495 },
  hevc: { low: 0.0014, high: 0.1315 },
  vp9: { low: 0.001, high: 0.118 },
  av1: { low: 0.001, high: 0.1078 },
}

/**
 * What a lossy sound codec writes when the job names no bitrate, MEASURED rather than assumed.
 *
 * A ten-second stereo 48 kHz tone came out of this machine at 128,000 b/s from libmp3lame, 128,108 from
 * the native AAC encoder, and 116,740 from libopus — so a job that names no figure still gets an answer
 * instead of UNKNOWN. Libopus is a variable-rate encoder, so its figure is an average rather than a
 * ceiling, which is what the estimate is marked as.
 */
const AUDIO_DEFAULT_BITRATE: Partial<Record<EncodingPreset['audioCodec'], number>> = {
  mp3: 128000, aac: 128000, opus: 117000,
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
    // No depth multiplier: the profile's own data rate already includes its native depth.
    return fixedBytes(target * (area / (1920 * 1080)) * (fps / 29.97), input.seconds, 'close')
  }
  // A delivery codec: the measured span its own encoder lands in across content, at the quality this app
  // asks it for. Bits a second is bits per pixel per frame times the frame's pixels times its rate.
  const delivery = DELIVERY_BPP[input.videoCodec]
  if (delivery) {
    const at = (bpp: number) => Math.round((bpp * area * fps / 8) * Math.max(0, input.seconds))
    return { low: at(delivery.low), high: at(delivery.high), confidence: 'rough' }
  }
  // Everything else the app writes as pictures is a still codec, whose size is the PICTURE's rather than a
  // setting — the brackets above are what it costs, keyed by the setting where one moves it.
  const frames = Math.max(1, Math.round(input.frames))
  const channels = 3 + (input.alpha ? 1 : 0)
  const pick = (table: Array<[number, number]>, value: number | undefined, low: number, high: number, fallback: [number, number]) =>
    value === undefined ? fallback : (table[Math.max(low, Math.min(high, Math.round(value)))] ?? fallback)
  if (input.videoCodec === 'png') {
    const [flat, photo] = pick(PNG_LEVEL_FACTORS, input.pngCompression, 0, 9, PNG_DEFAULT_FACTOR)
    const samples = area * channels * ((input.bitDepth ?? 8) / 8)
    return { low: Math.round(samples * flat * frames), high: Math.round(samples * photo * frames), confidence: 'rough' }
  }
  if (input.videoCodec === 'mjpeg') {
    const quality = input.jpegQuality === undefined ? undefined : Math.max(1, Math.min(31, Math.round(input.jpegQuality)))
    const [flat, photo] = quality === undefined ? JPEG_DEFAULT_FACTOR : (JPEG_QUALITY_FACTORS[quality - 1] ?? JPEG_DEFAULT_FACTOR)
    return { low: Math.round(area * flat * frames), high: Math.round(area * photo * frames), confidence: 'rough' }
  }
  if (input.videoCodec === 'gif') {
    return { low: Math.round(area * GIF_FACTOR[0] * frames), high: Math.round(area * GIF_FACTOR[1] * frames), confidence: 'rough' }
  }
  return undefined
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
  if (named) return fixedBytes(named, seconds, 'close')
  // The encoder's OWN default, which is a figure rather than a guess — measured above — so a job that names
  // no bitrate is still answerable. It is marked as the estimate it is.
  const fallback = AUDIO_DEFAULT_BITRATE[input.audioCodec]
  return fallback ? fixedBytes(fallback, seconds, 'close') : undefined
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
