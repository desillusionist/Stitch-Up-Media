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
 * shape. A named resolution is a box the source is fitted inside with its aspect kept, so
 * the finished frame is the source's own shape, scaled until it touches the box. With
 * neither, the source's shape is the output's, and only the even-size rounding applies.
 *
 * `natural` is the source's own pixel size, which is only known once the media has loaded,
 * so this returns undefined until then rather than guessing a frame.
 */
export const outputFrameSize = (input: { natural?: FrameSize; exact?: FrameSize; box?: FrameSize }): FrameSize | undefined => {
  if (input.exact) return { width: even(input.exact.width), height: even(input.exact.height) }
  if (!input.natural) return input.box
  if (!input.box) return { width: even(input.natural.width), height: even(input.natural.height) }
  const scale = Math.min(input.box.width / input.natural.width, input.box.height / input.natural.height)
  return { width: even(input.natural.width * scale), height: even(input.natural.height * scale) }
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

/** How far a crop may reach in from each edge before there is nothing left to encode. */
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

/** Keeps a crop inside the frame, so the filter can never be handed an empty picture. */
export const clampCrop = (crop: CropFractions): CropFractions => ({
  left: Math.max(0, Math.min(MAX_CROP, crop.left)),
  top: Math.max(0, Math.min(MAX_CROP, crop.top)),
  right: Math.max(0, Math.min(MAX_CROP - Math.min(MAX_CROP, crop.left), crop.right)),
  bottom: Math.max(0, Math.min(MAX_CROP - Math.min(MAX_CROP, crop.top), crop.bottom)),
})

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
