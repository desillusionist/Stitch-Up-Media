/**
 * Frame rates as EXACT RATIONAL numbers, in one place.
 *
 * A rate is a count of frames over a count of seconds, and the two commonest rates in the world are not
 * whole numbers: 30000/1001 is what a reader calls 29.97 and 24000/1001 is 23.976. Held as a `float`, the
 * two stop dividing evenly — 30000/1001 rounded to a decimal drifts a fraction of a frame a minute, and a
 * long reel's last frame lands on a different number depending on how many times it has been rounded on
 * the way. Held as `num/den` and multiplied out at the last moment, a frame index is exact however long
 * the reel is. That exactness is the whole point of this module, so NOTHING here round-trips a rate
 * through a decimal except the label a reader sees.
 *
 * A number is still accepted anywhere a rate is, because most rates ARE whole numbers and a probe reports
 * one: `rateOf` turns a figure into the rational it means, snapping the three NTSC rates to their exact
 * `.../1001` forms so a probed 29.97 and a chosen 29.97 are the same rate and not two a thousandth apart.
 */

/** A frame rate as an exact rational: `num` frames in `den` seconds. */
export interface FrameRate {
  num: number
  den: number
}

/** A rate in either spelling: the rational, or the figure a caller happens to have. */
export type RateInput = FrameRate | number

/** The divisor the NTSC rates are built on, which is why they are not whole numbers. */
const NTSC = 1001

/** How close a probed figure has to be to a preset to BE that preset rather than a decimal of its own. */
const SNAP = 0.01

const gcd = (a: number, b: number): number => {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) { const t = y; y = x % y; x = t }
  return x || 1
}

/** A rate, reduced and with the sign on the numerator. Nonsense reads as 25, which is what a missing rate has always meant. */
export const makeRate = (num: number, den: number): FrameRate => {
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return { num: 25, den: 1 }
  const divisor = gcd(num, den)
  return { num: Math.round(num / divisor), den: Math.round(den / divisor) }
}

/** The exact rational a figure means, snapping the NTSC rates so a probe and a choice agree. */
export const rateOf = (input: RateInput): FrameRate => {
  if (typeof input !== 'number') return makeRate(input.num, input.den)
  const value = input
  if (!Number.isFinite(value) || value <= 0) return { num: 25, den: 1 }
  for (const preset of RATE_PRESETS) {
    const known = rateValue(preset.rate)
    if (Math.abs(value - known) <= SNAP) return preset.rate
  }
  if (Number.isInteger(value)) return { num: value, den: 1 }
  // A typed decimal is the rational it is written as, at a thousandth: 23.5 is 47/2 once reduced, and
  // 47.95 is 959/20 — exact for what was typed, rather than an approximation of it.
  return makeRate(Math.round(value * 1000), 1000)
}

/** The figure a rate stands for, for a label or an ffmpeg argument. Never the stored truth. */
export const rateValue = (input: RateInput): number => {
  const rate = typeof input === 'number' ? rateOf(input) : input
  return rate.den > 0 ? rate.num / rate.den : 25
}

/** Whether two rates are the same rate, however each was spelled. */
export const ratesEqual = (a: RateInput, b: RateInput): boolean => {
  const left = rateOf(a)
  const right = rateOf(b)
  return left.num * right.den === right.num * left.den
}

/**
 * The whole frames a length holds, exact and half-up.
 *
 * The multiplication is done in whole numbers before the division, so 30000/1001 of an hour is the same
 * count however the machine rounds floats.
 */
export const frameCount = (seconds: number, input: RateInput): number => {
  const rate = rateOf(input)
  if (!Number.isFinite(seconds)) return 0
  const scaled = (seconds * rate.num) / rate.den
  return Math.max(0, Math.round(scaled + (scaled < 0 ? -1e-9 : 1e-9)))
}

/** The frame a length FALLS ON, which is the floor rather than the nearest — what a preview seeks to. */
export const frameFloor = (seconds: number, input: RateInput): number => {
  const rate = rateOf(input)
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.max(0, Math.floor((seconds * rate.num) / rate.den + 1e-9))
}

/** The instant a frame begins at, which is the exact inverse of `frameFloor`. */
export const secondsForFrames = (frames: number, input: RateInput): number => {
  const rate = rateOf(input)
  return frames > 0 && rate.num > 0 ? (frames * rate.den) / rate.num : 0
}

/** The seconds one frame lasts, which is the rate read the other way. */
export const secondsPerFrame = (input: RateInput): number => {
  const rate = rateOf(input)
  return rate.num > 0 ? rate.den / rate.num : 1 / 25
}

/** The rates the window offers by name, in the order they are drawn. */
export const RATE_PRESETS: ReadonlyArray<{ rate: FrameRate; label: string }> = [
  { rate: makeRate(24000, NTSC), label: '23.976' },
  { rate: makeRate(24, 1), label: '24' },
  { rate: makeRate(25, 1), label: '25' },
  { rate: makeRate(30000, NTSC), label: '29.97' },
  { rate: makeRate(30, 1), label: '30' },
  { rate: makeRate(50, 1), label: '50' },
  { rate: makeRate(60000, NTSC), label: '59.94' },
  { rate: makeRate(60, 1), label: '60' },
]

/** The rate a job writes at when nothing names one, matching what the app has always fallen back to. */
export const DEFAULT_RATE: FrameRate = makeRate(30, 1)

/**
 * How a rate is written for a reader: the familiar three-decimal for the NTSC rates, the whole number for
 * the rest, and — for a rate that is neither — as much of its decimal as it takes to tell it apart from
 * the numbers beside it, trimmed rather than padded.
 */
export const rateLabel = (input: RateInput): string => {
  const rate = rateOf(input)
  for (const preset of RATE_PRESETS) if (ratesEqual(preset.rate, rate)) return preset.label
  if (rate.den === 1) return String(rate.num)
  return String(Number((rate.num / rate.den).toFixed(3)))
}

/** The rational itself, as `num/den`, for a tooltip that would rather be exact than familiar. */
export const rateRationalLabel = (input: RateInput): string => {
  const rate = rateOf(input)
  return `${rate.num}/${rate.den}`
}

/** Whether a rate is one of the presets, which is what decides whether a custom field is also drawn. */
export const rateIsPreset = (input: RateInput): boolean => RATE_PRESETS.some((preset) => ratesEqual(preset.rate, input))
