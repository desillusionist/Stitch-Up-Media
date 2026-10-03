import { ClipSpeed, QueueTask } from '../types'
import { RateInput, rateOf, rateValue } from './frameRate'

/**
 * Per-clip playback speed, in ONE place.
 *
 * A clip's speed decides two things and they are the same thing: the filter chain that retimes the
 * picture (`setpts`) and the sound (`atempo`, or `asetrate` when the pitch is let go), and the length
 * the clip takes on the timeline, which is the trimmed source length divided by the speed. Every
 * reader — the encoder, the monitor, the thumbnails, the filmstrip and the inspector's own fields —
 * works the mapping out here, so a preview and the file it previews cannot disagree about where a
 * frame falls.
 *
 * The whole of the mapping, stated once: a clip covering source seconds `[sourceIn, sourceIn + used]`
 * occupies timeline seconds `[start, start + used/speed)`, and timeline instant `t` is source instant
 * `sourceIn + (t - start) * speed`. At the default speed that is the identity it has always been, and
 * a clip with no record of its own leaves the export byte-identical to a job saved before speed
 * existed.
 */

/** The slowest a clip may be run. Ten times slower is far past anything a frame-length preview can show. */
export const MIN_CLIP_SPEED = 0.1
/** The fastest a clip may be run, matching the top of the monitor's own playback-rate ceiling. */
export const MAX_CLIP_SPEED = 16

/** The clip's own speed: no retiming, frames as they are. */
export const DEFAULT_CLIP_SPEED: ClipSpeed = { speed: 1, interpolation: 'sampling', maintainPitch: true }

/** The rates the inspector's own list offers, which is where a reader lands without typing. */
export const CLIP_SPEED_CHOICES = [0.25, 0.5, 1, 1.5, 2, 4, 8] as const

/** A speed held to the range the model accepts. Nonsense reads as the clip's own speed rather than as zero. */
export const clampClipSpeed = (value: unknown): number => {
  const rate = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(rate) || rate <= 0) return 1
  // Rounded to SIX decimals rather than three, and that digit is load-bearing: DURATION and SPEED are one
  // relationship, so a one-frame step of the length is a speed change of `trimmed / duration^2 / rate`.
  // For a long clip that is smaller than a thousandth, and at three decimals it rounded straight back to
  // the speed it started from — so the length could not be moved a frame at all. The worst case was a
  // 7m49s source at 30 fps, where the wheel and the arrows went dead below 2.654x (38% of the source),
  // and a 2m59s one at 24 fps below 1.468x: exactly the two boundaries the report was made with. Six
  // decimals keeps a frame step surviving out to a source of many hours, and it is still a figure a
  // reader can look at.
  return Math.min(MAX_CLIP_SPEED, Math.max(MIN_CLIP_SPEED, Math.round(rate * 1e6) / 1e6))
}

/**
 * The speed a clip carries, by the same keying as its trim, its fit and its crop.
 *
 * A clip with no record is the default, not a record that happens to do nothing: this returning
 * nothing is how "nothing chosen" is carried everywhere the speed is read, which is what keeps the
 * export of an untouched clip exactly what it was.
 */
export const speedFor = (task: Pick<QueueTask, 'sourceSpeed'>, sourcePath: string | undefined, index: number): ClipSpeed => {
  const record = task.sourceSpeed?.[`${sourcePath}#${index}`] ?? (sourcePath ? task.sourceSpeed?.[sourcePath] : undefined)
  if (!record) return DEFAULT_CLIP_SPEED
  return {
    speed: clampClipSpeed(record.speed),
    interpolation: record.interpolation === 'blending' ? 'blending' : 'sampling',
    maintainPitch: record.maintainPitch !== false,
  }
}

/** True when a clip's record would actually retime it, which is what decides whether a filter is written. */
export const retimes = (speed: number): boolean => Math.abs(clampClipSpeed(speed) - 1) > 1e-9

/**
 * The timeline length a trimmed source length takes at a speed — the LINK between the two figures.
 *
 * This is the whole of the relationship the inspector lets a reader edit from either end: a clip at 2x
 * of ten trimmed source seconds is five seconds of output, and the trimmed length it needs for a chosen
 * output length is the same division read backwards.
 */
export const clipDurationFor = (trimmedSeconds: number, speed: number): number => {
  const rate = clampClipSpeed(speed)
  return trimmedSeconds > 0 ? trimmedSeconds / rate : 0
}

/** The source length a chosen timeline length needs, which is the same relationship read backwards. */
export const trimmedForDuration = (durationSeconds: number, speed: number): number => {
  const rate = clampClipSpeed(speed)
  return durationSeconds > 0 ? durationSeconds * rate : 0
}

/**
 * The source seconds one timeline second consumes, with a clip's INTERPRETED rate and its speed folded in.
 *
 * A clip's frames can be read at a rate of their own — a 24p clip handed to a 30 fps timeline, or a run of
 * images given a rate — and that reinterpretation retimes the clip exactly as a speed does: `N` frames at
 * `fps_clip` last `N / fps_clip`, so the source-seconds-per-timeline-second is `speed × fps_clip / native`.
 * At the source's own rate the ratio is one and this is the plain speed it has always been, which is what
 * keeps an untouched clip untouched. It is the ONE figure the encoder's `setpts`, the monitor's seek and the
 * timeline's length all read, so a preview and the file it previews cannot disagree about where a frame sits.
 */
export const clipRetime = (speed: number, clipRate: RateInput, nativeRate: RateInput): number => {
  const rate = clampClipSpeed(speed)
  const native = rateValue(rateOf(nativeRate))
  return native > 0 ? rate * (rateValue(rateOf(clipRate)) / native) : rate
}

/**
 * The factors an `atempo` chain runs at, none outside what the filter accepts.
 *
 * `atempo` takes one factor between 0.5 and 2, so a speed past either end is a chain of them: 4x is
 * `atempo=2,atempo=2`, and a quarter speed is `atempo=0.5,atempo=0.5`. Splitting the factor rather
 * than the time is what keeps the chain's product exactly the speed — the leftover factor is the
 * last link and is not rounded to a rung.
 */
export const atempoChain = (speed: number, min = 0.5, max = 2): number[] => {
  let remaining = clampClipSpeed(speed)
  const factors: number[] = []
  while (remaining > max + 1e-9) { factors.push(max); remaining /= max }
  while (remaining < min - 1e-9) { factors.push(min); remaining /= min }
  factors.push(Math.round(remaining * 1e6) / 1e6)
  return factors
}

/**
 * The audio half of a clip's retiming.
 *
 * Pitch kept is the default and is `atempo`, which changes the tempo and nothing else. Pitch let go is
 * `asetrate` followed by a resample back to the working rate: the sample rate is what a pitch IS, so
 * shifting it and resampling the result is the tape's own behaviour — the sound rises with the speed.
 * Either way the sound comes out the length the picture does, which is why the two halves are written
 * from the one figure.
 */
export const speedAudioFilters = (speed: number, maintainPitch: boolean, sampleRate = 48000): string[] => {
  const rate = clampClipSpeed(speed)
  if (!retimes(rate)) return []
  if (maintainPitch) return atempoChain(rate).map((factor) => `atempo=${factor}`)
  const shifted = Math.round(sampleRate * rate)
  return [`asetrate=${shifted}`, `aresample=${sampleRate}`]
}

/**
 * The picture half of a clip's retiming.
 *
 * `setpts` is the whole of the speed: dividing presentation timestamps by it moves every frame to
 * where it falls at the new rate. `blending` then averages the neighbours the speed left a gap
 * between, at the rate the output is written; `sampling`, the default, keeps whichever frame the
 * output instant lands on, because the `fps` filter the normalizer already appends does exactly that.
 * The pair is empty at the clip's own speed, which is what keeps an untouched export untouched.
 */
export const speedVideoFilters = (speed: number, interpolation: ClipSpeed['interpolation'], outputFps = 0): string[] => {
  const rate = clampClipSpeed(speed)
  if (!retimes(rate)) return []
  const filters = [`setpts=(PTS-STARTPTS)/${rate}`]
  if (interpolation === 'blending' && outputFps > 0) filters.push(`minterpolate=fps=${Math.round(outputFps)}:mi_mode=blend`)
  return filters
}

/**
 * The speed the inspector reads a clip's own rate by.
 *
 * The same spelling the monitor's speed selector uses, so a reader sees one way of writing a rate
 * wherever the app says one. Trailing zeroes are trimmed rather than forced: `2x` rather than `2.0x`,
 * which is the shape `speedLabel` already has.
 */
export const clipSpeedLabel = (speed: number): string => `${clampClipSpeed(speed)}x`

/**
 * One clip's place on the timeline, as the timing mapping needs it.
 *
 * Stated here rather than taken from the segment so this module need not know the model: a segment, a
 * lane's worth of them, and a hand-made one in a harness are all this shape.
 */
export interface ClipSpan {
  /** Where the clip starts on the consolidated timeline, in seconds. */
  start: number
  /** How long it occupies, in TIMELINE seconds. */
  duration: number
  /** Where in the source its run begins. */
  sourceIn: number
  /** Its playback rate, where 1 is the source's own. */
  speed: number
}

/**
 * The SOURCE instant a timeline instant falls on, for one clip.
 *
 * This is the whole of the preview mapping, in the one place the monitor and any reader of it can
 * agree on: a clip covers source seconds `[sourceIn, sourceIn + duration*speed)` across timeline
 * seconds `[start, start + duration)`, so an instant inside it is `speed` source seconds in for every
 * one of the timeline's. At the clip's own speed it is the plain offset it has always been, which is
 * what keeps an untouched preview untouched.
 */
export const sourceTimeAt = (timelineSeconds: number, clip: ClipSpan): number => {
  const rate = clip.speed > 0 ? clip.speed : 1
  const offset = Math.max(0, Math.min(clip.duration, timelineSeconds - clip.start))
  return clip.sourceIn + offset * rate
}

/** Its inverse: the TIMELINE instant a source instant falls on, which is what reading the element's clock gives back. */
export const timelineTimeAt = (sourceSeconds: number, clip: ClipSpan): number => {
  const rate = clip.speed > 0 ? clip.speed : 1
  return clip.start + Math.max(0, sourceSeconds - clip.sourceIn) / rate
}
