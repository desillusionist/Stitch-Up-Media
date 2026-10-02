import { EncodingPreset, MediaProbeInfo, MediaStreamInfo } from '../types'

/**
 * What a sound IS, and what the export will make of it.
 *
 * Two questions an editor asks about a sound and had nowhere to ask: what the file's own audio is made of —
 * its rate, its sample size, its channels — and how many channels the export is to write. The first is a fact
 * about a file that the MEDIA INFO inspector, the monitor's own line, the timeline's clip line and the AUDIO
 * tab all want the same answer to; the second is a choice, and it lives beside that answer because a reader
 * comparing the two is the whole reason either is shown.
 *
 * Everything here is READ OFF a probe rather than assumed. A lossy file has no bits per sample and a wav may
 * not name a layout at all, so each figure is either present or absent, and an absent one is left out of the
 * line instead of standing in as a zero: `0 BIT` would be a claim about the file rather than a gap in it.
 */

/** The first audio stream of a probe — the one the facts are read from. */
export const audioStreamOf = (info: MediaProbeInfo | undefined): MediaStreamInfo | undefined => info?.audioStreams?.[0]

/** `48000` shown as `48`, `44100` as `44.1` — the rate in kHz, with no trailing zero. */
export const kilohertz = (sampleRate: number): string => `${Math.round(sampleRate / 100) / 10}`

/**
 * How a stream's channels read: the layout it names, or the count when it names none.
 *
 * A layout is the better answer where there is one, because `5.1` says which speakers and `6 CH` says only how
 * many. Where a file names none — which a great many wavs do not — the count is all there is, and one and two
 * are spelled out because that is how a reader thinks of them.
 */
export const channelFacts = (stream: MediaStreamInfo | undefined): string | null => {
  if (!stream) return null
  if (stream.channelLayout) return stream.channelLayout.toUpperCase()
  if (stream.channels === 1) return 'MONO'
  if (stream.channels === 2) return 'STEREO'
  if (stream.channels && stream.channels > 0) return `${stream.channels} CH`
  return null
}

/**
 * What the sound is: `48 KHZ · 16 BIT · STEREO`.
 *
 * The order is the one a reader compares two files by — rate, then sample size, then channels — and each part
 * is left out when the file does not carry it, so a lossy file reads `48 KHZ · MONO` rather than `48 KHZ ·
 * 0 BIT · MONO`.
 */
export const audioFacts = (info: MediaProbeInfo | undefined): string | null => {
  const stream = audioStreamOf(info)
  if (!stream) return null
  const parts = [
    stream.sampleRate ? `${kilohertz(stream.sampleRate)} KHZ` : null,
    stream.bitDepth ? `${stream.bitDepth} BIT` : null,
    channelFacts(stream),
  ]
  const line = parts.filter(Boolean).join(' | ')
  return line || null
}

/** How the file is written: `AAC · 320K`. Its own line, because it is about the codec rather than the sound. */
export const audioCodecFacts = (info: MediaProbeInfo | undefined): string | null => {
  const stream = audioStreamOf(info)
  if (!stream) return null
  const line = [stream.codec ? stream.codec.toUpperCase() : null, stream.bitrate ? stream.bitrate.toUpperCase() : null].filter(Boolean).join(' | ')
  return line || null
}

/** Whether a probe is of something with sound in it, which is what the facts above are about. */
export const probeHasAudio = (info: MediaProbeInfo | undefined): boolean => Boolean(info?.audioStreams?.length)

/**
 * The channel layouts the export may be asked for, in the order the editor offers them.
 *
 * Two, and that cap is deliberate rather than a shortcut: the drawing path lays the stream it writes out as
 * mono or stereo, and the two halves of one split cannot be laid out differently — so a 5.1 export would be a
 * different pipeline, not another figure here. A 5.1 SOURCE is therefore folded down, which is the honest
 * thing to offer rather than a control that would need a graph of its own.
 */
export const AUDIO_CHANNELS: Array<{ value: 0 | 1 | 2; name: string }> = [
  { value: 0, name: 'SOURCE' },
  { value: 1, name: 'MONO' },
  { value: 2, name: 'STEREO' },
]

/** A stored figure held to what the export can actually write. Zero means "whatever the source is". */
export const clampAudioChannels = (value: unknown): 0 | 1 | 2 => {
  const channels = Number(value)
  return channels === 1 ? 1 : channels === 2 ? 2 : 0
}

/**
 * How many channels the export is to write, or nothing where the preset says nothing.
 *
 * Nothing is not the same as two: every path that owns the output layout already has an answer of its own —
 * a stitch follows the widest source it was given, a drawing follows its own graph — and a preset that has not
 * been asked says nothing rather than saying stereo, which is what keeps a job saved before this control off
 * the list encoding exactly as it did.
 */
export const outputChannels = (preset: Pick<EncodingPreset, 'audioChannels'>): 1 | 2 | undefined =>
  preset.audioChannels === 1 || preset.audioChannels === 2 ? preset.audioChannels : undefined

/** The ffmpeg layout name for a channel count, which is what `aformat` and the drawing's graph both take. */
export const channelLayoutFor = (channels: number): string => (channels === 1 ? 'mono' : 'stereo')

/**
 * The bitrates the export is offered, in the order the editor offers them.
 *
 * The ordinary rungs of a lossy encoder's ladder, and nothing cleverer: a figure between two of them is a
 * CUSTOM entry and not a rung, because a list that sprouted a value per typed figure would stop being a list.
 */
export const AUDIO_BITRATES = [96, 128, 160, 192, 256, 320]

/**
 * The rung a stored bitrate is, or nothing where it is not one.
 *
 * Tolerant of how the figure was written — `320`, `320k` and `320K` are the same rung — because the value has
 * been a free field for longer than it has been a list, so a job saved then carries whatever was typed. What
 * it is NOT is a guess: a figure that is not on the ladder is what CUSTOM is for.
 */
export const bitrateOptionOf = (stored: string | undefined): number | null => {
  if (!stored) return null
  const kbps = Math.round(Number(String(stored).trim().replace(/k(?:bps)?$/i, '')))
  return Number.isFinite(kbps) && AUDIO_BITRATES.includes(kbps) ? kbps : null
}

/** A bitrate as the encoder takes it and as the select stores it: `320k`. */
export const bitrateValue = (kbps: number): string => `${kbps}k`

/**
 * Whether a bitrate applies at all.
 *
 * A lossless codec has no bitrate to set — it writes what the samples are — so the control is hidden for one
 * rather than left to be typed into and ignored. `copy` is here for the same reason: the stream is not being
 * encoded at all.
 */
export const LOSSLESS_AUDIO_CODECS = ['pcm', 'flac', 'copy']
export const bitrateApplies = (codec: string): boolean => !LOSSLESS_AUDIO_CODECS.includes(codec)

/**
 * The depths a sound codec is offered, in bits a sample — and none at all where it has none to store.
 *
 * The lossless two do: a PCM sample IS a number of bits, and FLAC stores the same samples compressed. The
 * lossy ones have no depth to offer, because an MP3 or an AAC holds a transform rather than samples — a
 * depth beside one would be a control with nothing behind it, which is worse than a control not drawn.
 * `copy` is neither: it writes whatever the source had, so there is nothing to choose.
 *
 * The ladders are MEASURED rather than assumed, on this machine's own encoders, and `verify-codecs` is
 * where that happens: a WAV takes eight, sixteen, twenty-four and thirty-two — eight being UNSIGNED, which
 * is the one oddity of the family — and FLAC is written at sixteen or twenty-four through its SAMPLE
 * FORMAT rather than through a figure of its own.
 */
export const audioDepthsFor = (codec: string): number[] =>
  codec === 'pcm' ? [8, 16, 24, 32] : codec === 'flac' ? [16, 24] : []

/** The depth a lossless codec is written at when the job names none, which is what this app has always written. */
export const DEFAULT_AUDIO_DEPTH = 16
