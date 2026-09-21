import { EncodingPreset } from '../types'

export interface FrameSize {
  width: number
  height: number
}

/** The pixel box a named resolution asks the encoder for. */
export const resolutionBox = (resolution: EncodingPreset['resolution']): FrameSize | undefined => {
  if (resolution === '4k') return { width: 3840, height: 2160 }
  if (resolution === '1080p') return { width: 1920, height: 1080 }
  if (resolution === '720p') return { width: 1280, height: 720 }
  return undefined
}

/** The encoder refuses an odd frame size, so it rounds down; the monitor draws the same. */
const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2)

/**
 * The frame the encoder will actually produce, which is what the monitor should outline.
 *
 * An exact width and height is applied as it stands, which stretches the picture to that
 * shape. A named resolution is a canvas: the picture is fitted inside it keeping its shape and
 * then padded out to it, so the finished frame really is that resolution whatever the picture
 * is. This used to be the fitted size instead, which is why asking for 4K on a portrait source
 * quietly produced a portrait frame of the source's own shape rather than a 4K one.
 *
 * `natural` is the source's own pixel size, which is only known once the media has loaded, so
 * with neither an exact size nor a box this returns undefined until then rather than guessing.
 */
export const outputFrameSize = (input: { natural?: FrameSize; exact?: FrameSize; box?: FrameSize }): FrameSize | undefined => {
  if (input.exact) return { width: even(input.exact.width), height: even(input.exact.height) }
  if (input.box) return input.box
  if (!input.natural) return undefined
  return { width: even(input.natural.width), height: even(input.natural.height) }
}

/** The largest box of a given aspect that fits inside the space available, in pixels. */
export const fitFrame = (available: FrameSize, aspect: number): FrameSize | null => {
  if (available.width <= 0 || available.height <= 0 || !Number.isFinite(aspect) || aspect <= 0) return null
  const width = Math.min(available.width, available.height * aspect)
  return { width, height: width / aspect }
}

/** How a frame is fitted into the space available. */
export type FitMode = 'contain' | 'width' | 'height'

/**
 * The box a frame occupies when fitted into a space.
 *
 * `contain` is the whole frame inside it. `width` and `height` fill that one dimension and let
 * the other overflow, which is what a monitor's fit-to-width and fit-to-height mean: the part
 * that will not fit is clipped by the panel rather than shrunk until it behaves like `contain`.
 */
export const fitFrameBy = (available: FrameSize, aspect: number, mode: FitMode = 'contain'): FrameSize | null => {
  if (available.width <= 0 || available.height <= 0 || !Number.isFinite(aspect) || aspect <= 0) return null
  if (mode === 'width') return { width: available.width, height: available.width / aspect }
  if (mode === 'height') return { width: available.height * aspect, height: available.height }
  return fitFrame(available, aspect)
}

/**
 * The pixel size a ratio gives at a base, rounded to an even pair.
 *
 * A named resolution is a SHORT SIDE, which is what makes it meaningful for a portrait
 * frame: 1080p is 1920x1080 landscape and 1080x1920 upright, not a 1920-wide slot.
 */
export const aspectSize = (ratio: number, shortSide: number): FrameSize => {
  const base = Math.max(2, shortSide)
  const width = ratio >= 1 ? base * ratio : base
  const height = ratio >= 1 ? base : base / ratio
  return { width: even(width), height: even(height) }
}

/** The short side a named resolution stands for. */
export const resolutionShortSide = (resolution: EncodingPreset['resolution']): number => {
  if (resolution === '4k') return 2160
  if (resolution === '720p') return 720
  return 1080
}

/**
 * The exact-size pair the editor's W/H fields work from.
 *
 * The preset's own pair is used when it has one; otherwise the frame the encoder is already
 * producing, so the fields start from the shape the user can see and an edit to one edge
 * keeps the other rather than leaving the size half set.
 */
export const exactSizeFields = (exact: Partial<FrameSize>, effective?: FrameSize): FrameSize | undefined => {
  const width = exact.width ?? effective?.width
  const height = exact.height ?? effective?.height
  return width && height ? { width, height } : undefined
}

/**
 * The pair after one edge is edited.
 *
 * Both edges are always produced, because the encoder reads an exact size only when it has
 * both: a lone width is ignored outright, which is what made editing one field look like
 * nothing happened. While the proportion is locked the other edge follows from the pair's
 * own ratio, so the frame's shape is kept; unlocked, the other edge stands as it was.
 */
export const resizeExact = (current: FrameSize, edge: keyof FrameSize, value: number, lockProportion: boolean): FrameSize => {
  const rounded = Math.max(2, Math.round(value))
  if (!lockProportion) {
    return edge === 'width' ? { width: rounded, height: current.height } : { width: current.width, height: rounded }
  }
  const ratio = current.width > 0 && current.height > 0 ? current.height / current.width : 1
  return edge === 'width'
    ? { width: rounded, height: Math.max(2, Math.round(rounded * ratio)) }
    : { width: Math.max(2, Math.round(rounded / ratio)), height: rounded }
}

/**
 * The least of the picture, per axis, that a crop always leaves. It is the one guarantee the filter
 * needs: an encoder rejects an empty frame outright, and everything else about how far a crop may
 * reach is a matter of what the user asked for.
 */
export const MIN_KEPT = 0.1

/**
 * How far one edge may reach in on its own, with the edge opposite it reaching the same way.
 *
 * Kept as a figure in its own right because it is what the controls are labelled with and what a
 * READER of the code means by "as far as a crop can go": both edges at this leaves exactly MIN_KEPT.
 * It is not, and must not become, a cap on how far ONE edge can travel: a box being MOVED along an
 * axis has an edge going out exactly as far as the other comes in, and a cap each would hold it
 * within a tenth of the picture's middle — which is the bug this distinction was drawn to fix.
 */
export const MAX_CROP = 0.45

export interface CropFractions {
  left: number
  top: number
  right: number
  bottom: number
}

/** True when a crop would actually remove something. */
export const hasCrop = (crop: CropFractions | undefined): boolean =>
  Boolean(crop && (crop.left > 0 || crop.top > 0 || crop.right > 0 || crop.bottom > 0))

/**
 * Keeps a crop inside the frame, so the filter can never be handed an empty picture.
 *
 * Each axis is capped on its own, by what the two edges of it take TOGETHER, which is the only
 * figure that decides whether anything is left. Tying the two edges together was the first attempt
 * at this and capped the total at MAX_CROP, which made any crop needing more than that impossible:
 * pulling a 16:9 source to 9:16 needs roughly 68% off the width and instead produced a lopsided
 * crop. Capping only the TOTAL still leaves at least MIN_KEPT of the picture, so the guarantee that
 * nothing is empty is kept, while how far each edge separately reaches is left to the user.
 */
export const clampCrop = (crop: CropFractions): CropFractions => {
  const [left, right] = clampAxis(crop.left, crop.right)
  const [top, bottom] = clampAxis(crop.top, crop.bottom)
  return { left, top, right, bottom }
}

const clampEdge = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))

/**
 * One axis, kept inside the picture and keeping at least MIN_KEPT of it.
 *
 * The cap is on the TOTAL the two edges take, not on each of them, and the difference is a matter of
 * what a crop is FOR. Capping each edge at MAX_CROP means the whole middle band of the picture is
 * unreachable: a crop that keeps only a third of a portrait's height could then be moved only a
 * tenth of the way up or down it, and could never be put at the top or the bottom at all — where a
 * crop of a ninth of it, moved to the top, takes a tenth off the top and NONE off the bottom.
 *
 * Whatever the total overshoots by is taken off both ends evenly, so a crop that was centred stays
 * centred and one that was not keeps its balance; where an end has less to give than its share, the
 * other end gives the rest. Both edges at MAX_CROP still pass through unchanged, which is what makes
 * this a widening of the old rule rather than a different one.
 */
const clampAxis = (near: number, far: number): [number, number] => {
  let a = clampEdge(near)
  let b = clampEdge(far)
  let excess = a + b - (1 - MIN_KEPT)
  if (excess <= 0) return [a, b]
  const half = Math.min(excess / 2, a, b)
  a -= half
  b -= half
  excess -= half * 2
  if (excess > 0) {
    const fromA = Math.min(a, excess)
    a -= fromA
    excess -= fromA
  }
  if (excess > 0) b -= Math.min(b, excess)
  return [a, b]
}

/**
 * The crop filter, as fractions of the frame so it needs no knowledge of the resolution.
 *
 * It goes first in the chain: everything downstream then works on what was kept, which is
 * what makes cropping to an output shape a crop followed by a fit rather than two
 * unrelated operations. The smallest side is floored at two pixels because the encoders
 * reject a smaller frame than that outright.
 *
 * The commas inside the arguments are escaped, because an unescaped comma separates one
 * filter from the next and would split this one in half.
 */
export const cropFilter = (crop: CropFractions): string => {
  const safe = clampCrop(crop)
  const keepWidth = 1 - safe.left - safe.right
  const keepHeight = 1 - safe.top - safe.bottom
  return `crop=max(2\\,iw*${keepWidth.toFixed(6)}):max(2\\,ih*${keepHeight.toFixed(6)}):iw*${safe.left.toFixed(6)}:ih*${safe.top.toFixed(6)}`
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The four bands a kept rect leaves behind inside the box it was taken from.
 *
 * The monitor dims these instead of shading everything outside the kept rect with one
 * enormous spread shadow. A spread shadow also covers the output frame outline and jumps
 * across the whole stage rather than the picture, which read as a mistake; a band is only
 * ever what the crop actually removes from the picture, so nothing else is tinted.
 */
export const cropBands = (box: Rect, kept: Rect): Rect[] => {
  const keptRight = kept.left + kept.width
  const keptBottom = kept.top + kept.height
  const boxRight = box.left + box.width
  const boxBottom = box.top + box.height
  return [
    { left: box.left, top: box.top, width: Math.max(0, kept.left - box.left), height: box.height },
    { left: keptRight, top: box.top, width: Math.max(0, boxRight - keptRight), height: box.height },
    { left: kept.left, top: box.top, width: kept.width, height: Math.max(0, kept.top - box.top) },
    { left: kept.left, top: keptBottom, width: kept.width, height: Math.max(0, boxBottom - keptBottom) },
  ]
}

/** The crop's four edges as whole pixels of a frame, which is the other way to read them. */
export const cropPixels = (crop: CropFractions, size: FrameSize): CropFractions => ({
  left: Math.round(crop.left * size.width),
  top: Math.round(crop.top * size.height),
  right: Math.round(crop.right * size.width),
  bottom: Math.round(crop.bottom * size.height),
})

/** The inverse of cropPixels: the fractions that same pair of pixel edges stands for. */
export const cropFractions = (pixels: CropFractions, size: FrameSize): CropFractions => ({
  left: size.width > 0 ? pixels.left / size.width : 0,
  top: size.height > 0 ? pixels.top / size.height : 0,
  right: size.width > 0 ? pixels.right / size.width : 0,
  bottom: size.height > 0 ? pixels.bottom / size.height : 0,
})

/**
 * The shape of the region a crop keeps, in a picture of a given shape.
 *
 * This is the figure the proportion list matches against, so a crop that happens to keep
 * 16:9 can be shown as 16:9 rather than as four unrelated numbers.
 */
export const keptAspect = (crop: CropFractions, pictureAspect: number): number | undefined => {
  const keptWidth = 1 - crop.left - crop.right
  const keptHeight = 1 - crop.top - crop.bottom
  if (!Number.isFinite(pictureAspect) || pictureAspect <= 0 || keptWidth <= 0 || keptHeight <= 0) return undefined
  return (pictureAspect * keptWidth) / keptHeight
}

/**
 * The crop that makes the kept region a given shape, centred in a picture of a given shape.
 *
 * Only the longer dimension is trimmed, so the kept region is the largest of that shape that
 * fits and no edge is cut twice; the trims are then clamped, which is what keeps an extreme
 * request from asking for an empty picture.
 */
export const cropForProportion = (pictureAspect: number, ratio: number): CropFractions => {
  const empty = { left: 0, top: 0, right: 0, bottom: 0 }
  if (!Number.isFinite(pictureAspect) || pictureAspect <= 0 || !Number.isFinite(ratio) || ratio <= 0) return empty
  if (pictureAspect > ratio) {
    const trim = (1 - ratio / pictureAspect) / 2
    return clampCrop({ left: trim, top: 0, right: trim, bottom: 0 })
  }
  const trim = (1 - pictureAspect / ratio) / 2
  return clampCrop({ left: 0, top: trim, right: 0, bottom: trim })
}

/**
 * A crop of the same shape, inset by a share of its own size about its own centre.
 *
 * Scaling both axes by the same factor preserves the region's shape, so this is how a crop of a
 * given shape is made visibly smaller without ceasing to be that shape: a tenth off each axis of a
 * 16:9 region leaves a 16:9 region. It is what the crop switch turns on — an inset the user can see
 * and grab — and it is also how the lock's own shape is seeded.
 */
export const insetCrop = (crop: CropFractions, scale: number): CropFractions => {
  const safe = clampCrop(crop)
  const keptWidth = 1 - safe.left - safe.right
  const keptHeight = 1 - safe.top - safe.bottom
  if (!(keptWidth > 0) || !(keptHeight > 0) || !(scale > 0)) return safe
  const width = keptWidth * scale
  const height = keptHeight * scale
  const centreX = (safe.left + (1 - safe.right)) / 2
  const centreY = (safe.top + (1 - safe.bottom)) / 2
  return clampCrop({
    left: centreX - width / 2,
    top: centreY - height / 2,
    right: 1 - (centreX + width / 2),
    bottom: 1 - (centreY + height / 2),
  })
}

/**
 * Re-holds a crop's shape at one axis's extent, about the region's own centre.
 *
 * Dragging an edge changes the extent of one axis, which is what would break a shape that is
 * being held; this puts the shape back by moving only the OTHER axis, symmetrically about the
 * centre, so the edited edge stays where the pointer put it. `fixed` names the axis the edit set.
 *
 * The shape is in pixels while the crop is in fractions, so the picture's own shape relates the
 * two: a kept width of `kw` needs a kept height of `pictureAspect * kw / ratio` to keep `ratio`.
 */
export const holdCropShape = (crop: CropFractions, ratio: number, pictureAspect: number, fixed: 'width' | 'height'): CropFractions => {
  const safe = clampCrop(crop)
  if (!(ratio > 0) || !(pictureAspect > 0)) return safe
  const keptWidth = 1 - safe.left - safe.right
  const keptHeight = 1 - safe.top - safe.bottom
  if (!(keptWidth > 0) || !(keptHeight > 0)) return safe
  const width = fixed === 'width' ? keptWidth : (ratio * keptHeight) / pictureAspect
  const height = fixed === 'width' ? (pictureAspect * keptWidth) / ratio : keptHeight
  const centreX = (safe.left + (1 - safe.right)) / 2
  const centreY = (safe.top + (1 - safe.bottom)) / 2
  return clampCrop({
    left: centreX - width / 2,
    top: centreY - height / 2,
    right: 1 - (centreX + width / 2),
    bottom: 1 - (centreY + height / 2),
  })
}

/**
 * Slides a crop across the picture without changing its size.
 *
 * Both edges of an axis move together, which is what keeps the region the same shape, and the travel
 * is bounded by the picture's own edges: the box can be put anywhere from hard against one edge to
 * hard against the other, and the region it keeps is the same size everywhere in between. It was
 * bounded by MAX_CROP instead, which allowed it a tenth of the picture's middle and no more, so a
 * crop of a third of the height could not be moved to the top or the bottom of it — the size of the
 * region has nothing to do with how far along the axis it may sit, and only the latter is at stake
 * here.
 */
export const shiftCrop = (crop: CropFractions, dx: number, dy: number): CropFractions => {
  const safe = clampCrop(crop)
  const rightwards = Math.max(-safe.left, Math.min(dx, safe.right))
  const downwards = Math.max(-safe.top, Math.min(dy, safe.bottom))
  return {
    left: safe.left + rightwards,
    top: safe.top + downwards,
    right: safe.right - rightwards,
    bottom: safe.bottom - downwards,
  }
}

/** The four corners a crop can be resized from. */
export type CropCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

/**
 * Resizes a crop from one corner, holding a shape and keeping the opposite corner still.
 *
 * The shape held is `ratio` when one is given, which is the proportion chosen in the list;
 * without one the region's own shape is held, so a corner drag is proportional by default.
 * With `free` set the corner follows the pointer on both axes at once, which is what the list's
 * NONE offers. The dragged corner follows the pointer only as far as the bounds allow, so the
 * pointer and the corner agree rather than the pointer and the box fighting.
 *
 * `ratio` is in pixels while the crop is in fractions, so the two are related by the picture's
 * own shape: a width fraction of dx keeps the shape when the height fraction is c x dx.
 */
export const resizeCorner = (input: {
  crop: CropFractions
  picture: FrameSize
  corner: CropCorner
  /** The pointer, as fractions of the picture. */
  point: { x: number; y: number }
  /** The pixel shape to hold. Without one, the region's own shape is held. */
  ratio?: number
  /** Ignore the shape entirely and let the corner follow the pointer on both axes. */
  free?: boolean
}): CropFractions => {
  const { crop, picture, corner, point } = input
  const keptWidth = 1 - crop.left - crop.right
  const keptHeight = 1 - crop.top - crop.bottom
  if (picture.width <= 0 || picture.height <= 0 || keptWidth <= 0 || keptHeight <= 0) return crop
  // The corner held still is the one opposite the one being dragged.
  const leftSide = corner === 'topLeft' || corner === 'bottomLeft'
  const topSide = corner === 'topLeft' || corner === 'topRight'
  const anchorX = leftSide ? 1 - crop.right : crop.left
  const anchorY = topSide ? 1 - crop.bottom : crop.top
  const spaceX = leftSide ? anchorX : 1 - anchorX
  const spaceY = topSide ? anchorY : 1 - anchorY
  const rawX = Math.abs(point.x - anchorX)
  const rawY = Math.abs(point.y - anchorY)
  const within = (space: number, raw: number) => Math.max(Math.max(0, space - MAX_CROP), Math.min(space, raw))
  let dx: number
  let dy: number
  if (input.free) {
    dx = within(spaceX, rawX)
    dy = within(spaceY, rawY)
  } else {
    const target = input.ratio && input.ratio > 0 ? input.ratio : (keptWidth * picture.width) / (keptHeight * picture.height)
    const c = picture.width / (target * picture.height)
    // The bound that keeps the dragged edge inside the picture and within MAX_CROP, expressed in
    // width fractions so the shape can be held exactly rather than clamped out of true afterwards.
    const low = Math.max(0, spaceX - MAX_CROP, (spaceY - MAX_CROP) / c)
    const high = Math.min(spaceX, spaceY / c)
    const wanted = Math.min(rawX, rawY / c)
    dx = high < low ? high : Math.max(low, Math.min(high, wanted))
    dy = c * dx
  }
  return clampCrop({
    left: leftSide ? anchorX - dx : crop.left,
    top: topSide ? anchorY - dy : crop.top,
    right: leftSide ? crop.right : 1 - (anchorX + dx),
    bottom: topSide ? crop.bottom : 1 - (anchorY + dy),
  })
}
