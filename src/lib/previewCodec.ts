/**
 * What the app's own webview can play, and what it has to be given a proxy for.
 *
 * The monitor and the filmstrip hand a source to a `<video>`, and that element is Chromium's decoder: it knows
 * the codecs a browser knows and nothing else. A Resolume DXV, a Hap, a ProRes, a DNxHD, or anything in a
 * Matroska wrapper is read perfectly well by FFMPEG — which is why the encoder never had a problem with them,
 * and VLC and HandBrake play them — and by nothing in the webview at all, so the monitors showed a black frame
 * while the export would have worked. This is the one place that decides whether a file may be handed to an
 * element, and it is shared so the window and the main process cannot disagree about it.
 *
 * The lists are deliberately SHORT, and they are a list of what is KNOWN GOOD rather than of what is known bad:
 * a codec or container not named here is given a proxy, which costs one transcode and always plays, where
 * guessing wrong the other way costs a monitor that says UNABLE TO DECODE.
 *
 * On HEVC: it is named good because Chromium decodes it through the platform decoder on macOS, which is the
 * only platform this app ships to. It is the first entry to strike from this list if a machine ever reports
 * otherwise, and the decode-error notice is what would say so.
 */
export const WEBVIEW_VIDEO_CODECS: readonly string[] = ['h264', 'avc1', 'hevc', 'h265', 'vp8', 'vp9', 'vp09', 'av01', 'av1']
export const WEBVIEW_VIDEO_CONTAINERS: readonly string[] = ['mp4', 'm4v', 'mov', 'webm']

/** Strips the punctuation a codec name carries: `avc1.64001f` is `avc1`, `vp09` is `vp09`. */
const bare = (value: string): string => value.trim().toLowerCase().split('.')[0]

export interface PreviewCodecFacts {
  /** The file's extension, without the dot. */
  container?: string
  /** The video codec of each video stream, as the probe names it. */
  videoCodecs?: readonly string[]
}

/**
 * Whether a `<video>` can be pointed straight at this file.
 *
 * A source with NO video stream is answered `true`: there is nothing for the element to fail to decode, and
 * the sound is played by an `<audio>` element, which has the same decoder question answered already elsewhere.
 */
export const webviewPlaysVideo = (facts: PreviewCodecFacts): boolean => {
  const codecs = (facts.videoCodecs ?? []).map(bare).filter(Boolean)
  if (!codecs.length) return true
  const container = bare(facts.container ?? '')
  if (container && !WEBVIEW_VIDEO_CONTAINERS.includes(container)) return false
  return codecs.every((codec) => WEBVIEW_VIDEO_CODECS.includes(codec))
}

/**
 * The cache key a proxy is filed under, and the version of the format it was written in.
 *
 * The same shape the sequence and still clips use, so a proxy is dropped by the same `dropPreviewsFor` when
 * its source's timing changes and is looked up by the same `rememberedPreviewFor`-style read. The version is
 * part of it because a proxy written by an older build is a different file for the same source.
 */
export const PREVIEW_PROXY_SPEC = 'proxy:v1'

export const previewProxySpec = (): string => PREVIEW_PROXY_SPEC
