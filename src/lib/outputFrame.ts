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
