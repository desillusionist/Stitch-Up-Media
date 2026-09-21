/**
 * Audio waveforms for the timeline, on the QUICK LOOK helper's own rules.
 *
 * The helper reads a file's audio down to a fixed number of buckets and keeps the ROOT MEAN SQUARE
 * of each, normalised against the loudest bucket in that file. Drawing puts a row of two-pixel bars
 * on a four-pixel stride either side of a centre line, each bar the loudest bucket it covers, so
 * what is drawn is the shape of the audio rather than a sample of it. Both halves live here so the
 * main process that reads the file and the timeline that draws it cannot disagree about what a
 * bucket is, and so the arithmetic can be asserted without an audio file to hand.
 */

/** How many buckets a file's audio is read into, as the helper reads it. */
export const WAVEFORM_PEAKS = 2000

/** The bar the helper draws with, and the gap beside it. */
export const WAVEFORM_BAR = 2
export const WAVEFORM_STRIDE = 4

/**
 * The loudest bucket's worth of a set of peaks, as the file's own scale.
 *
 * Normalising to the loudest bucket is what makes a quiet file visible at all; the alternative, a
 * fixed scale, draws silence for anything recorded low.
 */
export const normalisePeaks = (peaks: number[]): number[] => {
  const loudest = peaks.reduce((max, peak) => (Number.isFinite(peak) && peak > max ? peak : max), 0)
  if (loudest <= 0) return peaks.map(() => 0)
  return peaks.map((peak) => (Number.isFinite(peak) && peak > 0 ? Math.min(1, peak / loudest) : 0))
}

/**
 * Peaks from raw mono float samples: the root mean square of each bucket.
 *
 * Root mean square rather than a peak sample, so one clipped sample does not draw a bar as tall as
 * a passage played loudly all the way through.
 */
export const peaksFromSamples = (samples: Float32Array, buckets: number = WAVEFORM_PEAKS): number[] => {
  const count = Math.max(1, Math.round(buckets))
  const total = samples.length
  if (total <= 0) return Array.from({ length: count }, () => 0)
  const sumSquares = new Float64Array(count)
  const counts = new Float64Array(count)
  for (let index = 0; index < total; index++) {
    const bucket = Math.min(count - 1, Math.floor((index / total) * count))
    const sample = samples[index]
    sumSquares[bucket] += sample * sample
    counts[bucket] += 1
  }
  const peaks = Array.from({ length: count }, (_, bucket) => (counts[bucket] > 0 ? Math.sqrt(sumSquares[bucket] / counts[bucket]) : 0))
  return normalisePeaks(peaks)
}

/** The slice of a waveform a trimmed clip shows, as the helper maps a point to its time. */
export const peaksForTrim = (peaks: number[], inSec: number, outSec: number, sourceDuration: number): number[] => {
  if (!peaks.length) return []
  const span = Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : 0
  if (span <= 0) return peaks
  const from = Math.max(0, Math.min(peaks.length - 1, Math.floor((Math.max(0, inSec) / span) * peaks.length)))
  const to = Math.max(from + 1, Math.min(peaks.length, Math.ceil((Math.max(0, outSec) / span) * peaks.length)))
  return peaks.slice(from, to)
}

/**
 * The waveform as one path, which is one element however long the clip is.
 *
 * Every bar is a vertical stroke on the centre line, so the whole drawing is a single path data
 * string: a lane zoomed until it is thousands of pixels wide draws thousands of bars, and thousands
 * of elements would make the timeline crawl. The bars are capped at the number of buckets there
 * are, past which several bars would be reading the same bucket and the drawing would only be
 * magnified rather than more detailed — the same reason a strip of frames is capped by the clip.
 */
export const waveformPath = (input: { peaks: number[]; width: number; height: number }): string => {
  const { peaks } = input
  const width = Number.isFinite(input.width) ? input.width : 0
  const height = Number.isFinite(input.height) ? input.height : 0
  if (!peaks.length || width <= 0 || height <= 0) return ''
  const stride = Math.max(WAVEFORM_STRIDE, width / peaks.length)
  const bars = Math.max(1, Math.floor(width / stride))
  const midY = height / 2
  // Nine tenths of the half-height, so the loudest bar stops short of the clip's own edge.
  const half = Math.max(1, (midY - 3) * 0.9)
  const drawn: string[] = []
  for (let bar = 0; bar < bars; bar++) {
    const from = Math.floor((bar / bars) * peaks.length)
    const to = Math.max(from + 1, Math.floor(((bar + 1) / bars) * peaks.length))
    let loudest = 0
    for (let bucket = from; bucket < Math.min(to, peaks.length); bucket++) {
      if (peaks[bucket] > loudest) loudest = peaks[bucket]
    }
    const reach = Math.max(1, Math.min(1, loudest) * half)
    const x = bar * stride + WAVEFORM_BAR / 2
    drawn.push(`M${x.toFixed(2)} ${(midY - reach).toFixed(2)}L${x.toFixed(2)} ${(midY + reach).toFixed(2)}`)
  }
  return drawn.join('')
}
