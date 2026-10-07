import { EncodingPreset } from '../types'

/**
 * How an export lays its SOUND out: one stream per lane, or one stream with the lanes summed.
 *
 * A COMBO/MULTI-TRACK plays several audio lanes at once, and until now the encoder always wrote them as
 * separate streams — `-map 1:a`, `-map 2:a`, each with its own language. That is what a container with several
 * tracks is FOR, and it stays the default. What is added here is the other answer: MIXDOWN, which sums the
 * lanes into one consolidated stream.
 *
 * TWO THINGS ABOUT IT ARE NOT OBVIOUS, and both are why this lives in a module rather than at the two call
 * sites that need it.
 *
 * The CONTAINER can refuse the separate answer. wav, flac and mp3 take ONE audio stream and refuse a second
 * — measured on this machine's ffmpeg, mapping two streams into any of the three writes no file at all
 * ("Nothing was written into output file, because at least one of its streams received no packets"). So a
 * multi-track job exported to one of those formats FAILED before this, and the same rule that offers the
 * reader a choice is what turns that failure into a file.
 *
 * The two answers are only different when there is more than one lane at once. A SEQUENCED set of tracks is
 * already one concatenated stream, and a DRAWING builds its own mix from the lanes — so in both cases this
 * setting has nothing to say and the control says why rather than offering a choice that cannot change the
 * file.
 */

/**
 * The containers that hold more than one audio stream, each one MEASURED by muxing two `-map`ped streams into
 * it and reading the count back. `m4a` is here because it IS an mp4; the three not here take a single track.
 */
export const MULTI_STREAM_CONTAINERS: Array<EncodingPreset['container']> = ['mp4', 'mov', 'mkv', 'webm', 'm4a']

/** Whether a container can hold one stream per lane, or is summed whatever the reader asked for. */
export const containerHoldsStreams = (container: EncodingPreset['container']): boolean =>
  MULTI_STREAM_CONTAINERS.includes(container)

export type AudioLayout = 'separate' | 'mixdown'

/**
 * The layout the ENCODER writes.
 *
 * `undefined` on the preset means what this path has always done — a stream per lane — kept wherever the
 * container can hold them, and resolved to MIXDOWN where it cannot, so the export is written instead of
 * refused. An explicit MIXDOWN is honoured everywhere; an explicit SEPARATE is overruled by a container that
 * cannot hold it, because the alternative is a job that fails.
 */
export const resolvedAudioLayout = (preset: Pick<EncodingPreset, 'container' | 'audioLayout'>): AudioLayout => {
  if (preset.audioLayout === 'mixdown') return 'mixdown'
  return containerHoldsStreams(preset.container) ? 'separate' : 'mixdown'
}

/** The two layouts, as the control offers them. */
export const AUDIO_LAYOUTS: Array<{ value: AudioLayout; name: string }> = [
  { value: 'separate', name: 'SEPARATE TRACKS' },
  { value: 'mixdown', name: 'MIXDOWN' },
]

/**
 * What the control shows, and why it is or is not choosable.
 *
 * `value` is the layout the export will ACTUALLY use, not the field as stored: a job that asked for SEPARATE
 * and was then pointed at a wav container reads MIXDOWN, because that is what it will get. `locked` is for the
 * cases where the setting cannot change the file at all — a sequenced set of tracks is one stream already, and
 * a drawing builds its own mix — where the whole control is refused rather than one of its two answers.
 */
export const audioLayoutState = (
  preset: Pick<EncodingPreset, 'container' | 'audioLayout'>,
  options: { sequenced: boolean; drawing: boolean },
): { value: AudioLayout; locked: boolean; separateBlocked: string | null } => {
  if (options.drawing) return { value: 'mixdown', locked: true, separateBlocked: 'A DRAWING SUMMS THE LANES ITSELF.' }
  if (options.sequenced) return { value: 'mixdown', locked: true, separateBlocked: 'THE TRACKS ARE SEQUENCED, SO THEY ALREADY FORM ONE STREAM.' }
  if (!containerHoldsStreams(preset.container)) return { value: 'mixdown', locked: false, separateBlocked: 'THIS FORMAT CARRIES ONE AUDIO TRACK.' }
  return { value: resolvedAudioLayout(preset), locked: false, separateBlocked: null }
}

/**
 * Whether the export really SUMS several lanes, which is the ONLY case a clipping guard has anything to catch.
 *
 * A MIXDOWN adds the lanes together, so two loud ones can reach above full scale; a SEPARATE layout writes each
 * lane on its own stream and nothing is added to anything. A SEQUENCED set is CONCATENATED rather than summed —
 * one lane after another, never together — so nothing is added to anything there either; and a DRAWING does sum,
 * but through its own graph rather than the encoder's `amix`, which is the code path the guard sits on. So the
 * guard is offered only for an UNLOCKED MIXDOWN: the one place the encoder's `amix` is what meets the ceiling.
 */
export const sumsAudioLanes = (state: Pick<ReturnType<typeof audioLayoutState>, 'value' | 'locked'>): boolean =>
  state.value === 'mixdown' && !state.locked

/**
 * The opt-in guard dropped AFTER the sum, so a mix that would reach above full scale is caught at it.
 *
 * `level=disabled` is the whole point of the filter here: `alimiter`'s auto-level is ON by default and can
 * re-level the output, which is exactly the rescaling this guard must NOT do to a mix that is already inside
 * the scale. `limit=1.0` is full scale, named rather than left to the default so the ceiling is written down.
 * `latency=1` compensates the limiter's own lookahead: without it the guard delays the summed stream by its
 * attack — MEASURED as 5 ms, a quarter of a frame at 25 fps — which would drift the whole soundtrack away from
 * the picture it belongs to. With it the impulse stays where it was and the peaks are still caught at 1.0.
 */
export const CLIPPING_GUARD_FILTER = 'alimiter=level=disabled:limit=1.0:latency=1'
