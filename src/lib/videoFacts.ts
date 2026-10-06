import { MediaProbeInfo, MediaStreamInfo } from '../types'

/**
 * What a PICTURE is, on the same terms the sound's facts are read on.
 *
 * The editor's inspector could say what a file's SOUND was encoded with — `AUDIO CODEC` reads `AAC | 320K` —
 * and had nothing at all to say about its picture, which is the half a reader is looking at. This is that
 * missing line's own module, and the mirror of `audioCodecFacts`: the container is named by the FORMAT row and
 * the samples by the DEPTH row, and neither of those says how the picture is WRITTEN.
 *
 * Read off a probe rather than assumed. A stream whose container records no bitrate leaves it out rather than
 * standing in a zero, which is the same rule the sound's line follows.
 */

/** The first video stream of a probe — the one the picture's facts are read from. */
export const videoStreamOf = (info: MediaProbeInfo | undefined): MediaStreamInfo | undefined => info?.videoStreams?.[0]

/** How the picture is written: `H264 | 12500K`. Its own line, as the sound's codec is. */
export const videoCodecFacts = (info: MediaProbeInfo | undefined): string | null => {
  const stream = videoStreamOf(info)
  if (!stream) return null
  const line = [stream.codec ? stream.codec.toUpperCase() : null, stream.bitrate ? stream.bitrate.toUpperCase() : null].filter(Boolean).join(' | ')
  return line || null
}
