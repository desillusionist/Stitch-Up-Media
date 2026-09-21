import { FitMode, FrameSize } from './outputFrame'
import { SourceFit } from '../types'

/**
 * Per-clip output fit: how one clip is placed in the output frame when it does not simply fit.
 *
 * The default is `contain` — the whole picture inside the frame, with the shortfall filled in —
 * which is what every clip did before this existed, so a clip with no fit of its own renders
 * exactly as it always has.
 *
 * FIT TO WIDTH fixes the clip's width to the frame's and lets the height do what it likes; FIT TO
 * HEIGHT does the same the other way up. One axis is therefore always exact, and the other either
 * overflows — and is cropped, with `offset` choosing which part of it stays — or falls short, and
 * is then filled in. Nothing is ever stretched: the shape is held by scaling the picture's own
 * aspect, so the only choices left are which part to keep and what colour the gap is.
 *
 * Every figure here is derived from the placement rather than from ffmpeg's own aspect handling,
 * because the same figures have to describe the exported frame AND the filter chain that makes it
 * AND a thumbnail of it. Rounding is to even pixels, which is the only size the encoders accept.
 */

/** Centred: where a clip that does not fit sits unless it is moved. */
export const DEFAULT_FIT_OFFSET = 0.5

/** The offset as a place between the clip's two extremes, with nonsense falling back to centred. */
export const clampFitOffset = (offset: number): number =>
  Number.isFinite(offset) ? Math.max(0, Math.min(1, offset)) : DEFAULT_FIT_OFFSET

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)

/**
 * The clip's own box once its shape is held and one axis is fixed to the frame's.
 *
 * `width` fixes the width, `height` the height, and `contain` fixes whichever axis runs out
 * first. The other side follows from the clip's own aspect, rounded to an even pair.
 */
export const fittedSize = (source: FrameSize, frame: FrameSize, mode: FitMode): FrameSize => {
  if (!(frame.width > 0) || !(frame.height > 0)) return { width: 0, height: 0 }
  const ratio = source.width > 0 && source.height > 0 ? source.width / source.height : frame.width / frame.height
  if (mode === 'width') return { width: frame.width, height: even(frame.width / ratio) }
  if (mode === 'height') return { width: even(frame.height * ratio), height: frame.height }
  // Whichever axis runs out first decides, so the pair always fits inside the frame and touches
  // it on the axis that ran out.
  const byWidth = { width: frame.width, height: even(frame.width / ratio) }
  return byWidth.height <= frame.height ? byWidth : { width: even(frame.height * ratio), height: frame.height }
}

export interface FitPlacement {
  /** The clip's box after scaling, in frame pixels. */
  size: FrameSize
  /** The part of it the frame keeps, in the clip's own scaled pixels. */
  kept: { x: number; y: number; width: number; height: number }
  /** Where the clip falls short of the frame, which is filled in; null when it covers it. */
  pad: { x: number; y: number } | null
  /**
   * The axis with something to spare, and so something to choose. It is the axis the offset
   * moves along, and the only axis the reposition dragger is ever active on.
   */
  overflow: 'width' | 'height' | null
}

/**
 * Where a clip sits inside the output frame, and what is kept or filled in to get there.
 *
 * With no fit given the answer is `contain`, which is what the encoder did before there was a
 * choice, so the default case goes through the same arithmetic as the chosen ones rather than
 * down a separate path that could drift from it.
 */
export const fitPlacement = (input: { source: FrameSize; frame: FrameSize; fit?: SourceFit }): FitPlacement | null => {
  const { source, frame } = input
  if (!(source.width > 0) || !(source.height > 0) || !(frame.width > 0) || !(frame.height > 0)) return null
  const mode: FitMode = input.fit?.mode ?? 'contain'
  const size = fittedSize(source, frame, mode)
  if (!(size.width > 0) || !(size.height > 0)) return null
  const axis: 'width' | 'height' = mode === 'width' ? 'height' : 'width'
  const slack = size[axis] - frame[axis]
  if (mode !== 'contain' && slack > 0) {
    // The clip covers the frame on this axis, so the frame chooses which part of it stays. The
    // start is clamped by the offset's own range, which is what keeps the frame fully covered:
    // no position it can take leaves a gap at either end.
    const start = Math.round(clampFitOffset(input.fit?.offset ?? DEFAULT_FIT_OFFSET) * slack)
    return {
      size,
      kept: axis === 'height'
        ? { x: 0, y: start, width: frame.width, height: frame.height }
        : { x: start, y: 0, width: frame.width, height: frame.height },
      pad: null,
      overflow: axis,
    }
  }
  // It falls short, so the frame is filled in around it. Nothing is chosen here: a gap is not
  // something to drag, and centring is the only place a letterbox or pillarbox belongs.
  return {
    size,
    kept: { x: 0, y: 0, width: size.width, height: size.height },
    pad: { x: Math.round((frame.width - size.width) / 2), y: Math.round((frame.height - size.height) / 2) },
    overflow: null,
  }
}

/**
 * The filter chain that places one clip in the output frame.
 *
 * Scale first, and by both figures rather than by `force_original_aspect_ratio`, so the box the
 * chain works on is the box this arithmetic worked out; then the crop that keeps the frame
 * covered, or the pad that fills it in; then `setsar=1`, because a clip whose samples are not
 * square would otherwise be concat'ed into the output with the wrong shape.
 */
export const fitFilters = (input: { source: FrameSize; frame: FrameSize; fit?: SourceFit }): string[] | null => {
  const placement = fitPlacement(input)
  if (!placement) return null
  const { size, kept, pad } = placement
  const filters = [`scale=${size.width}:${size.height}`]
  if (kept.width !== size.width || kept.height !== size.height || kept.x !== 0 || kept.y !== 0) {
    filters.push(`crop=${kept.width}:${kept.height}:${kept.x}:${kept.y}`)
  }
  // Only when there is really a gap to fill: a clip whose box already is the frame would
  // otherwise carry a pad of nothing, which is one more filter on every frame for no reason.
  if (pad && (size.width !== input.frame.width || size.height !== input.frame.height)) {
    filters.push(`pad=${input.frame.width}:${input.frame.height}:${pad.x}:${pad.y}:color=black`)
  }
  filters.push('setsar=1')
  return filters
}

/**
 * What a placement looks like to a cache.
 *
 * Everything that changes the picture belongs in it: the mode, the offset — quantised, so a drag
 * that is still moving does not ask for a new set of thumbnails at every pixel — and the two
 * boxes. Frames cached under one placement must never be served for another.
 */
export const fitSignature = (input: { source?: FrameSize; frame?: FrameSize; fit?: SourceFit }): string => {
  const box = (size?: FrameSize) => (size && size.width > 0 && size.height > 0 ? `${size.width}x${size.height}` : '-')
  if (!input.fit) return `contain@${box(input.frame)}`
  const offset = Math.round(clampFitOffset(input.fit.offset) * 100) / 100
  return `${input.fit.mode}@${offset.toFixed(2)}@${box(input.source)}>${box(input.frame)}`
}
