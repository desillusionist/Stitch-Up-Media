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
 * How far a crop may reach in from EACH edge. An edge may reach this far on both sides, so the
 * smallest sliver a crop can leave is 1 - 2 x this, a tenth of the picture.
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
 * Each edge is capped on its own rather than against the edge opposite it. The two were tied
 * together before, which capped the TOTAL horizontal or vertical crop at MAX_CROP and so made
 * any crop needing more than that impossible: pulling a 16:9 source to 9:16 needs roughly 68%
 * off the width, and instead of a centred vertical crop it produced a lopsided one. Capping
 * each edge independently still leaves at least a tenth of the picture, since 2 x MAX_CROP is
 * only nine tenths, so the guarantee that nothing is empty is kept.
 */
export const clampCrop = (crop: CropFractions): CropFractions => ({
  left: clampEdge(crop.left),
  top: clampEdge(crop.top),
  right: clampEdge(crop.right),
  bottom: clampEdge(crop.bottom),
})

const clampEdge = (value: number): number => Math.max(0, Math.min(MAX_CROP, Number.isFinite(value) ? value : 0))

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
 * Slides a crop across the picture without changing its size.
 *
 * Both edges of an axis move together, which is what keeps the region the same shape. The
 * move stops when either edge would leave the picture or pass MAX_CROP, so a box that already
 * reaches the cap on both sides of an axis cannot move along it at all.
 */
export const shiftCrop = (crop: CropFractions, dx: number, dy: number): CropFractions => {
  const rightwards = Math.max(-Math.min(crop.left, MAX_CROP - crop.right), Math.min(dx, Math.min(crop.right, MAX_CROP - crop.left)))
  const downwards = Math.max(-Math.min(crop.top, MAX_CROP - crop.bottom), Math.min(dy, Math.min(crop.bottom, MAX_CROP - crop.top)))
  return {
    left: crop.left + rightwards,
    top: crop.top + downwards,
    right: crop.right - rightwards,
    bottom: crop.bottom - downwards,
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
