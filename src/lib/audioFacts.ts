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
  const line = parts.filter(Boolean).join(' · ')
  return line || null
}

/** How the file is written: `AAC · 320K`. Its own line, because it is about the codec rather than the sound. */
export const audioCodecFacts = (info: MediaProbeInfo | undefined): string | null => {
  const stream = audioStreamOf(info)
  if (!stream) return null
  const line = [stream.codec ? stream.codec.toUpperCase() : null, stream.bitrate ? stream.bitrate.toUpperCase() : null].filter(Boolean).join(' · ')
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
