import { EncodingPreset } from '../types'

/**
 * How many bits a sample is stored in, read off the format's own name rather than assumed.
 *
 * A pixel format says its own depth: `yuv420p` is eight bits a sample, `yuv420p10le` is ten, `yuv444p12le`
 * is twelve, and the packed RGB formats say it in their name (`rgb24` is eight a channel, `rgb48be` is
 * sixteen). Nothing here is a guess about the file — it is a reading of the string the probe returned.
 *
 * It exists for two reasons. A SOURCE's depth is a fact about the file, which the window shows and never
 * offers a control for, because re-encoding a source at its own depth is not a choice. And ProRes's depth
 * is decided by its PROFILE rather than by any setting, so it is derived rather than asked for.
 *
 * The names are a TABLE rather than a clever reading of the string, because the shallow formats say their
 * depth only BY OMISSION — `yuv420p` is eight bits a sample and so is `nv12`, whose trailing `12` is the
 * CHROMA layout rather than a depth. A rule that guessed from the digits would call an nv12 frame twelve
 * bits, which is exactly the kind of reading that looks like a measurement and is not one.
 */
const PIXEL_DEPTHS: Record<string, 8 | 10 | 12 | 16> = {
  // Eight bits a sample, the delivery formats and the ones an eight-bit pipeline works in.
  yuv420p: 8, yuv422p: 8, yuv444p: 8, yuvj420p: 8, yuvj422p: 8, yuvj444p: 8,
  yuva420p: 8, yuva422p: 8, yuva444p: 8,
  nv12: 8, nv21: 8, gray: 8, gray8: 8, pal8: 8,
  rgb24: 8, bgr24: 8, rgba: 8, bgra: 8, argb: 8, abgr: 8,
  // Ten, which is what ProRes is and what a graded frame is held in.
  yuv420p10le: 10, yuv422p10le: 10, yuv444p10le: 10, yuva444p10le: 10,
  // Twelve, the 4444 family's own.
  yuv420p12le: 12, yuv444p12le: 12,
  // Sixteen, which is a frame on its way into a compositor rather than one a player opens.
  gray16le: 16, gray16be: 16, rgb48be: 16, rgba64le: 16,
}

export const pixelDepth = (pixelFormat: string | undefined): 8 | 10 | 12 | 16 | undefined => {
  if (!pixelFormat) return undefined
  return PIXEL_DEPTHS[pixelFormat.trim().toLowerCase()]
}

/** The channel layout a pixel format carries, as the word a reader would use for it. */
export const pixelDepthLabel = (pixelFormat: string | undefined): string | undefined => {
  const bits = pixelDepth(pixelFormat)
  if (bits === undefined || !pixelFormat) return undefined
  return `${bits}-BIT // ${pixelFormat.toUpperCase()}`
}

/**
 * ProRes's depth, which its PROFILE decides and nothing else.
 *
 * The 422 family is ten bits a sample and the 4444 family is twelve with an alpha plane beside it — see
 * the encoder's own pixel formats, `yuv422p10le`, `yuv444p10le` and `yuva444p10le`. There is no eight-bit
 * ProRes and no sixteen-bit one, which is why the width is DERIVED here instead of being offered as a
 * control: a depth selector beside ProRes could only ever be a control that lies about what it does.
 */
export const proresDepth = (profile: EncodingPreset['proresProfile']): 10 | 12 =>
  (profile === '4444' || profile === '4444xq' ? 12 : 10)

/** Whether a ProRes profile carries an alpha plane, which is the 4444 family and nothing else. */
export const proresHasAlpha = (profile: EncodingPreset['proresProfile']): boolean =>
  profile === '4444' || profile === '4444xq'

/** The label a ProRes profile's depth is shown by: `10-BIT`, `12-BIT + ALPHA`. */
export const proresDepthLabel = (profile: EncodingPreset['proresProfile']): string =>
  `${proresDepth(profile)}-BIT${proresHasAlpha(profile) ? ' + ALPHA' : ''}`
