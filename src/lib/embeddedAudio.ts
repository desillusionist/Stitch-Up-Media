/**
 * A clip's EMBEDDED sound, and the in-place controls for it.
 *
 * A video that carries a soundtrack carries it AS PART OF THE CLIP: the picture and its sound are one
 * source, and a trim of the clip is a trim of both. This module is the two things a reader can say about
 * that sound without taking it out — drop a stream, and set its level — plus the one way it IS taken out
 * (`EXTRACT AUDIO TO TRACK`), which is recorded as a TRACK claiming the stream rather than as a flag on
 * the clip. That is deliberate: a claim can be withdrawn by deleting the track, so extraction needs no
 * undo of its own and can never leave a clip silently missing a stream it never gave away.
 *
 * Every record here is keyed by the clip's OWN ID, like the trim, the fit and the crop, so it travels with
 * the clip through a move, a reorder, a split or a duplicate.
 */
import { AudioTrackItem, EmbeddedAudioStream, QueueTask } from '../types'

/** The streams a clip was told about, or none where it was never touched. */
export const embeddedStreamsFor = (task: Pick<QueueTask, 'embeddedAudio'>, clipId: string): EmbeddedAudioStream[] =>
  task.embeddedAudio?.[clipId] ?? []

/** One stream's record, defaulted to enabled at unity gain — which is what an untouched clip carries. */
export const embeddedStreamState = (
  task: Pick<QueueTask, 'embeddedAudio'>,
  clipId: string,
  index: number,
): EmbeddedAudioStream => embeddedStreamsFor(task, clipId).find((entry) => entry.index === index) ?? { index }

/** The track that has EXTRACTED a clip's embedded stream, if any. */
export const extractedBy = (
  task: Pick<QueueTask, 'additionalAudioTracks'>,
  clipId: string,
  path: string,
  index: number,
): AudioTrackItem | undefined =>
  (task.additionalAudioTracks || []).find((track) => track.sourceClipId === clipId && track.streamIndex === index && track.path === path)

/**
 * Whether a clip's embedded stream is carried by the CLIP at all.
 *
 * Two ways it is not: the reader muted it, or a track has extracted it. The second is read from the track
 * list rather than stored, which is what makes deleting that track re-enable the clip's own mapping.
 */
export const embeddedStreamEnabled = (
  task: Pick<QueueTask, 'embeddedAudio' | 'additionalAudioTracks'>,
  clipId: string,
  path: string,
  index: number,
): boolean => !extractedBy(task, clipId, path, index) && !embeddedStreamState(task, clipId, index).muted

/** The level a clip's embedded stream is carried at, in dB, 0 at unity. */
export const embeddedGainDb = (task: Pick<QueueTask, 'embeddedAudio'>, clipId: string, index: number): number =>
  embeddedStreamState(task, clipId, index).gainDb ?? 0

/**
 * Whether a clip carries no sound at all: every stream dropped, whether by a mute or by an extraction.
 *
 * This is the question the clip's own green indicator and the monitor's element both ask, so the drawn
 * state and what is heard cannot disagree.
 */
export const clipAudioDropped = (
  task: Pick<QueueTask, 'embeddedAudio' | 'additionalAudioTracks'>,
  clipId: string,
  path: string,
  streamCount: number,
): boolean => {
  if (streamCount <= 0) return false
  for (let index = 0; index < streamCount; index += 1) {
    if (embeddedStreamEnabled(task, clipId, path, index)) return false
  }
  return true
}

/**
 * The streams the export must MAP for a clip: enabled, and in index order.
 *
 * An explicit list rather than `0:a` (every stream) or `0:a:0` (the first) — a job that asked for one of
 * three streams is not a job that asked for the others, and ffmpeg's own default would have taken exactly
 * the wrong one of them without saying so.
 */
export const enabledEmbeddedStreams = (
  task: Pick<QueueTask, 'embeddedAudio' | 'additionalAudioTracks'>,
  clipId: string,
  path: string,
  streamCount: number,
): EmbeddedAudioStream[] => {
  const enabled: EmbeddedAudioStream[] = []
  for (let index = 0; index < streamCount; index += 1) {
    if (embeddedStreamEnabled(task, clipId, path, index)) enabled.push(embeddedStreamState(task, clipId, index))
  }
  return enabled
}

/**
 * Whether in-place embedded-audio controls are offered for a job at all.
 *
 * A CONVERT and a MULTI-TRACK map their ONE visual straight through, so the clip's own streams are the
 * streams the export writes and a control on them is a control on the output. A STITCH and a COMBO JOIN
 * their visuals — each is normalized into a single stream before it is concatenated — so a clip's
 * streams are no longer separately addressable by the time the file is written, and the controls are
 * withheld rather than offered and ignored.
 */
export const embeddedAudioEditable = (task: Pick<QueueTask, 'type'>): boolean =>
  task.type === 'transcode' || task.type === 'multitrack'

/**
 * Whether a clip's embedded sound has been DECIDED about: a control set, or a stream extracted out of it.
 *
 * An untouched clip is handed to ffmpeg's own stream selection exactly as it always was, so this is the
 * question the encoder asks before it switches to naming each stream one at a time. It is true the moment a
 * reader mutes one, sets a level, or takes a stream out, and false again once those are all removed — which
 * is what keeps a job that never touched its sound byte-identical to one saved before this existed.
 */
export const embeddedAudioCustomised = (
  task: Pick<QueueTask, 'embeddedAudio' | 'additionalAudioTracks'>,
  clipId: string,
  path: string,
): boolean =>
  Boolean(task.embeddedAudio?.[clipId]) || (task.additionalAudioTracks || []).some((track) => track.sourceClipId === clipId && track.path === path)

/** dB to a linear gain, which is what `volume=` and an element's own `volume` both take. */
export const gainForDb = (db: number): number => (Number.isFinite(db) ? Math.pow(10, db / 20) : 1)
