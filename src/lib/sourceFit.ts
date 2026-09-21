import { CropFractions, FitMode, FrameSize } from './outputFrame'
import { SourceCrop, SourceFit } from '../types'

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
export const fitSignature = (input: { source?: FrameSize; frame?: FrameSize; fit?: SourceFit; crop?: CropFractions }): string => {
  const box = (size?: FrameSize) => (size && size.width > 0 && size.height > 0 ? `${size.width}x${size.height}` : '-')
  // Quantised to a tenth of a per cent, so a crop box being dragged does not ask for a new strip at
  // every pixel of the drag — the same reason the fit's offset is quantised.
  const region = input.crop
    ? [input.crop.left, input.crop.top, input.crop.right, input.crop.bottom].map((edge) => (Number.isFinite(edge) ? edge.toFixed(3) : '0')).join(',')
    : 'full'
  if (!input.fit) return `contain@${box(input.frame)}|${region}`
  const offset = Math.round(clampFitOffset(input.fit.offset) * 100) / 100
  return `${input.fit.mode}@${offset.toFixed(2)}@${box(input.source)}>${box(input.frame)}|${region}`
}

/**
 * The region a clip's crop keeps, in whole pixels of the source.
 *
 * Both stages of a clip are worked out from this: the crop is taken at exactly these pixels, and the
 * fit is then worked out from exactly this size, so the crop and the fit cannot disagree about what
 * the clip is by a pixel — which they would if one used the probe's dimensions and the other the
 * cropped ones.
 */
export const croppedSize = (source: FrameSize, crop?: CropFractions): FrameSize => {
  if (!(source.width > 0) || !(source.height > 0)) return { width: 0, height: 0 }
  const region = cropRegion(crop)
  return { width: Math.max(2, Math.round(source.width * region.w)), height: Math.max(2, Math.round(source.height * region.h)) }
}

/** A crop as a region of the source in fractions: where it starts, and how much it keeps. */
export const cropRegion = (crop?: CropFractions): { x: number; y: number; w: number; h: number } => {
  if (!crop) return { x: 0, y: 0, w: 1, h: 1 }
  const left = clampFraction(crop.left)
  const top = clampFraction(crop.top)
  const right = clampFraction(crop.right)
  const bottom = clampFraction(crop.bottom)
  return {
    x: left,
    y: top,
    w: Math.max(0.001, 1 - left - right),
    h: Math.max(0.001, 1 - top - bottom),
  }
}

const clampFraction = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(0.999, value)) : 0)

/** The region a crop control's four edges stand for, which is what the task stores. */
export const sourceCropOf = (crop: CropFractions): SourceCrop => {
  const region = cropRegion(crop)
  return { x: round6(region.x), y: round6(region.y), w: round6(region.w), h: round6(region.h) }
}

/** The same region in the left/top/right/bottom form the editor's crop controls work in. */
export const cropFractionsOf = (region: SourceCrop): CropFractions => ({
  left: Math.max(0, region.x),
  top: Math.max(0, region.y),
  right: Math.max(0, 1 - region.x - region.w),
  bottom: Math.max(0, 1 - region.y - region.h),
})

const round6 = (value: number) => Math.round(value * 1e6) / 1e6

/**
 * The whole chain for one clip, as the encoder, the thumbnails and the monitor all read it.
 *
 * Crop first, in the source's own space: it decides WHAT of the clip is kept, and it is stored
 * normalised to the source, so a change of resolution or aspect ratio never invalidates it. Then the
 * fit, in the frame's space: it decides HOW the kept region sits in the output. The two cannot fight,
 * because the second only ever sees what the first kept.
 */
export const clipFilters = (input: { source: FrameSize; frame: FrameSize; crop?: CropFractions; fit?: SourceFit }): string[] | null => {
  const filters: string[] = []
  const region = cropRegion(input.crop)
  const kept = croppedSize(input.source, input.crop)
  if (input.source.width > 0 && input.source.height > 0 && (region.x > 0 || region.y > 0 || region.w < 1 || region.h < 1)) {
    // Pixel figures rather than expressions, so the crop lands where the arithmetic above says and
    // the fit is handed the size that was really kept.
    const x = Math.max(0, Math.round(input.source.width * region.x))
    const y = Math.max(0, Math.round(input.source.height * region.y))
    filters.push(`crop=${kept.width}:${kept.height}:${x}:${y}`)
  }
  const placement = fitFilters({ source: kept, frame: input.frame, fit: input.fit })
  if (!placement) return filters.length ? filters : null
  return [...filters, ...placement]
}
