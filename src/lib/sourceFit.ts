import { CropFractions, FitMode, FrameSize } from './outputFrame'
import { SourceCrop, SourceFit } from '../types'

/**
 * Per-clip output framing: how one clip is scaled, and where the result sits.
 *
 * Two separate decisions, which is the whole shape of this model. The FIT decides SCALE ONLY: the
 * default is `contain`, the whole picture inside the frame, and FIT TO WIDTH or FIT TO HEIGHT fix one
 * axis to the frame's and let the other follow from the picture's own aspect, so nothing is ever
 * stretched. The OFFSET then decides POSITION: where the scaled picture sits on the output canvas, as
 * fractions of that canvas, with 0, 0 centred.
 *
 * The offset is NOT clamped, and that is deliberate rather than merely permitted. A picture may be
 * moved until it is partly or wholly off the canvas, and where it does not cover the canvas the
 * background shows: bars are what a position produces. The model before this had one clamped axis
 * whose whole job was to keep the frame COVERED, which made a position impossible to express and cost
 * the freedom to place a letterboxed picture where it reads best.
 *
 * Every figure here is derived from the placement rather than from ffmpeg's own aspect handling,
 * because the same figures have to describe the exported frame AND the filter chain that makes it AND
 * a thumbnail of it. Rounding is to even pixels, which is the only size the encoders accept.
 */

/** Centred: where a picture sits until it is moved. */
export const DEFAULT_FIT_OFFSET: { x: number; y: number } = { x: 0, y: 0 }

/** An offset with nonsense in it read as nothing, so a bad record cannot place a picture anywhere. */
export const normaliseFitOffset = (offset: { x?: unknown; y?: unknown } | undefined): { x: number; y: number } => ({
  x: typeof offset?.x === 'number' && Number.isFinite(offset.x) ? offset.x : 0,
  y: typeof offset?.y === 'number' && Number.isFinite(offset.y) ? offset.y : 0,
})

/**
 * What a record SAYS, without working anything out: a pair if it already is one, and centred if it is
 * the single number this used to be. For the callers that are about to overwrite the record anyway —
 * a fit being switched, a menu being used — where the old number's meaning needs sizes nobody there
 * has. `fitOffsetFor` is the reader that works it out.
 */
export const storedFitOffset = (fit: SourceFit | undefined): { x: number; y: number } => {
  const raw = fit?.offset as unknown
  return raw && typeof raw === 'object' ? normaliseFitOffset(raw as { x?: unknown; y?: unknown }) : { ...DEFAULT_FIT_OFFSET }
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)
/** Even, and able to be negative: a position may be off either edge of the canvas. */
const evenSigned = (value: number) => Math.round(value / 2) * 2

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

/**
 * The offset a fit really stands for, given the sizes it is being applied to.
 *
 * The record's own shape is `{ x, y }` and that is all anything writes. What is ALSO read is the
 * single number this used to be — a place along the one axis a fit left over, counted in the slack
 * that axis had — because jobs written by the older model are still on disk and their pan can be
 * worked out exactly rather than thrown away: the picture used to sit at `-offset * slack` on that
 * axis, centred is `-slack / 2`, and the difference between the two is what the new offset means.
 * Where the old fit left no slack the number did nothing at all, so it reads as centred, which is
 * what it looked like.
 */
export const fitOffsetWithin = (fit: SourceFit | undefined, size: FrameSize, frame: FrameSize): { x: number; y: number } => {
  const raw = fit?.offset as unknown
  if (raw && typeof raw === 'object') return normaliseFitOffset(raw as { x?: unknown; y?: unknown })
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ...DEFAULT_FIT_OFFSET }
  const mode = fit?.mode ?? 'contain'
  if (mode === 'contain') return { ...DEFAULT_FIT_OFFSET }
  const axis: 'width' | 'height' = mode === 'width' ? 'height' : 'width'
  const slack = size[axis] - frame[axis]
  if (!(slack > 0) || !(frame[axis] > 0)) return { ...DEFAULT_FIT_OFFSET }
  const moved = ((0.5 - Math.max(0, Math.min(1, raw))) * slack) / frame[axis]
  return axis === 'height' ? { x: 0, y: moved } : { x: moved, y: 0 }
}

/** The same, for a caller that has the source rather than the size the fit scales it to. */
export const fitOffsetFor = (fit: SourceFit | undefined, source: FrameSize, frame: FrameSize): { x: number; y: number } =>
  fitOffsetWithin(fit, fittedSize(source, frame, fit?.mode ?? 'contain'), frame)

export interface FitPlacement {
  /** The picture's box after scaling, in frame pixels. */
  size: FrameSize
  /** Where that box's top-left corner sits on the canvas, in frame pixels. May be off the canvas. */
  at: { x: number; y: number }
}

/**
 * Where the scaled picture sits on the output canvas.
 *
 * Centred and then moved, so the offset is a displacement from the middle rather than from an edge:
 * 0, 0 is exactly where the picture sat before there was a position at all, and a frame whose size
 * changes does not move a picture that has not been moved. With no fit given the answer is `contain`,
 * which is what the encoder did before there was a choice, so the default case goes through the same
 * arithmetic as the chosen ones rather than down a separate path that could drift from it.
 */
export const fitPlacement = (input: { source: FrameSize; frame: FrameSize; fit?: SourceFit }): FitPlacement | null => {
  const { source, frame } = input
  if (!(source.width > 0) || !(source.height > 0) || !(frame.width > 0) || !(frame.height > 0)) return null
  const size = fittedSize(source, frame, input.fit?.mode ?? 'contain')
  if (!(size.width > 0) || !(size.height > 0)) return null
  const offset = fitOffsetWithin(input.fit, size, frame)
  return {
    size,
    at: {
      x: evenSigned((frame.width - size.width) / 2 + offset.x * frame.width),
      y: evenSigned((frame.height - size.height) / 2 + offset.y * frame.height),
    },
  }
}

/**
 * The filter chain that places one clip on the output canvas.
 *
 * Scale by both figures rather than by `force_original_aspect_ratio`, so the box the chain works on is
 * the box this arithmetic worked out. What follows depends on whether the scaled picture is still
 * inside the canvas. Inside it, `pad` places it and fills what it does not cover, which is the
 * letterbox and pillarbox case and needs no crop at all. Over an edge, `pad` cannot be used — it
 * refuses an output smaller than its input, and it SILENTLY CENTRES the input when handed a negative
 * offset rather than putting it off the canvas — so the part of the picture that IS on the canvas is
 * cropped out of it first and then padded into place at its own corner, which is the crop side of the
 * same operation and needs no negative offset anywhere. And where the position leaves no part of the
 * picture on the canvas at all, the answer is a canvas of nothing but background: a sliver is cropped
 * out, painted over with the background colour, and then padded, so the picture contributes no pixel
 * to the result rather than a two-pixel smudge in a corner.
 */
export const fitFilters = (input: { source: FrameSize; frame: FrameSize; fit?: SourceFit }): string[] | null => {
  const placement = fitPlacement(input)
  if (!placement) return null
  const { frame } = input
  const { size, at } = placement
  const filters = [`scale=${size.width}:${size.height}`]
  // The part of the picture that is on the canvas, and where that part belongs on it. Both are even,
  // because the size and the position are, which is why no rounding is needed on the way through.
  const visibleAt = { x: Math.max(0, at.x), y: Math.max(0, at.y) }
  const from = { x: Math.min(Math.max(0, -at.x), size.width), y: Math.min(Math.max(0, -at.y), size.height) }
  const visible = {
    width: Math.min(size.width - from.x, frame.width - visibleAt.x),
    height: Math.min(size.height - from.y, frame.height - visibleAt.y),
  }
  if (visible.width < 2 || visible.height < 2) {
    filters.push('crop=2:2:0:0', 'drawbox=x=0:y=0:w=2:h=2:color=black:t=fill', `pad=${frame.width}:${frame.height}:0:0:color=black`)
  } else {
    if (from.x > 0 || from.y > 0 || visible.width !== size.width || visible.height !== size.height) {
      filters.push(`crop=${visible.width}:${visible.height}:${from.x}:${from.y}`)
    }
    if (visibleAt.x > 0 || visibleAt.y > 0 || visible.width !== frame.width || visible.height !== frame.height) {
      filters.push(`pad=${frame.width}:${frame.height}:${visibleAt.x}:${visibleAt.y}:color=black`)
    }
  }
  filters.push('setsar=1')
  return filters
}

/**
 * What a placement looks like to a cache.
 *
 * Everything that changes the picture belongs in it: the mode, the position — quantised, so a drag
 * that is still moving does not ask for a new set of thumbnails at every pixel — and the two boxes.
 * Frames cached under one placement must never be served for another. The position is written in the
 * CONVERTED form, so a record from the older model and its equivalent pair share a signature rather
 * than asking for the same thumbnails twice.
 */
export const fitSignature = (input: { source?: FrameSize; frame?: FrameSize; fit?: SourceFit; crop?: CropFractions }): string => {
  const box = (size?: FrameSize) => (size && size.width > 0 && size.height > 0 ? `${size.width}x${size.height}` : '-')
  // Quantised to a thousandth of the frame, so a crop box or a picture being dragged does not ask for
  // a new strip at every pixel of the drag.
  const region = input.crop
    ? [input.crop.left, input.crop.top, input.crop.right, input.crop.bottom].map((edge) => (Number.isFinite(edge) ? edge.toFixed(3) : '0')).join(',')
    : 'full'
  if (!input.fit) return `contain@${box(input.frame)}|${region}`
  const offset = input.source && input.frame
    ? fitOffsetFor(input.fit, input.source, input.frame)
    : storedFitOffset(input.fit)
  const at = [offset.x, offset.y].map((value) => (Math.round(value * 1000) / 1000).toFixed(3)).join(',')
  return `${input.fit.mode}@${at}@${box(input.source)}>${box(input.frame)}|${region}`
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
 * Both stages of a clip as one drawing instruction: where the WHOLE source sits, and where the part
 * the crop keeps sits upon the canvas.
 *
 * The crop and the fit are two stages, and the monitor, the strips and the encoder must agree about
 * both. The fit is only ever asked about the region the crop KEPT, since that is what it is placing;
 * but what is drawn is the whole source — a crop is a box over a picture, not a smaller picture — so
 * the source's own box is worked back from the kept region's own: the region's corner is at the
 * placement's corner, and the rest of the source lies beyond it by exactly what the crop cut off.
 *
 * Everything is in the frame's own pixels, including negative positions, which is what lets a moved
 * clip spill past the canvas the way the export's own
 * position of it will.
 */
export const placedSource = (input: { source: FrameSize; frame: FrameSize; crop?: CropFractions; fit?: SourceFit }): { placement: FitPlacement; source: { x: number; y: number; width: number; height: number } } | null => {
  const kept = croppedSize(input.source, input.crop)
  if (!(kept.width > 0) || !(kept.height > 0)) return null
  const placement = fitPlacement({ source: kept, frame: input.frame, fit: input.fit })
  if (!placement) return null
  // Frame pixels per source pixel, per axis: the fit's box is rounded to an even pair, so taking one
  // axis's factor for both would put the kept region a fraction of a pixel off the box the export
  // really scales it to.
  const scaleX = placement.size.width / kept.width
  const scaleY = placement.size.height / kept.height
  const region = cropRegion(input.crop)
  const width = input.source.width * scaleX
  const height = input.source.height * scaleY
  return {
    placement,
    source: { x: placement.at.x - region.x * width, y: placement.at.y - region.y * height, width, height },
  }
}

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
