import { QueueTask } from '../types'
import { mediaKind } from './mediaKind'
import { dropPreviewsFor } from './quickLookTarget'

/**
 * Per-source timing the user can set from either window's MEDIA INFO inspector.
 *
 * A rate, and for a still image a clip length. Both windows write it here, so a job
 * cannot end up with the editor showing one number and the queue showing another.
 */
export interface SourceTimingOverride {
  /** The rate a still is rendered at, or an interpreted sequence's rate. */
  fps?: number
  /** How long a still image's clip should be, in seconds. */
  seconds?: number
}

export type SourceTimingMap = Record<string, SourceTimingOverride>

const positive = (value: number | undefined): number | undefined =>
  value != null && Number.isFinite(value) && value > 0 ? value : undefined

/**
 * Records a source's timing, and throws away anything built at the old values.
 *
 * A generated clip is a real file rendered at a rate and, for a still, a length, so
 * either one changing makes it stale. Keeping it is what left the frame-accurate helper
 * showing footage at the parameters the user had just replaced, or at the old length.
 *
 * Called from both windows. A change that changes nothing is a no-op, so applying an
 * unchanged inspector cannot throw away the clip that was just built.
 */
export const withSourceTiming = (task: QueueTask, sourcePath: string, override: SourceTimingOverride): QueueTask => {
  const fps = positive(override.fps)
  const seconds = positive(override.seconds)
  if (fps === undefined && seconds === undefined) return task
  const sequence = task.sequenceInputs?.[sourcePath] || (task.sequenceInput?.firstFrame === sourcePath ? task.sequenceInput : undefined)
  const recorded = task.sourceMetadata?.[sourcePath]
  // A still's length is not part of the sequence rule: an interpreted sequence derives its
  // own length from its frames, so only its rate is settable.
  const wantsSeconds = seconds !== undefined && !sequence && mediaKind(sourcePath) === 'image'
  const fpsSettled = fps === undefined || (recorded?.fps === fps && (!sequence || sequence.fps === fps))
  const secondsSettled = !wantsSeconds || recorded?.duration === seconds
  if (fpsSettled && secondsSettled) return task

  const previews = { ...(task.imageSequencePreviews || {}) }
  dropPreviewsFor(previews, sourcePath)
  const reflow = (input: QueueTask['sequenceInput']): QueueTask['sequenceInput'] =>
    input && fps !== undefined ? { ...input, fps, duration: input.frameCount / fps } : input
  return {
    ...task,
    sourceMetadata: {
      ...(task.sourceMetadata || {}),
      [sourcePath]: {
        ...(recorded || {}),
        ...(fps !== undefined ? { fps } : {}),
        ...(wantsSeconds ? { duration: seconds } : {}),
      },
    },
    sequenceInput: task.sequenceInput?.firstFrame === sourcePath ? reflow(task.sequenceInput) : task.sequenceInput,
    sequenceInputs: task.sequenceInputs?.[sourcePath]
      ? { ...task.sequenceInputs, [sourcePath]: reflow(task.sequenceInputs[sourcePath]) as NonNullable<QueueTask['sequenceInput']> }
      : task.sequenceInputs,
    imageSequencePreviews: Object.keys(previews).length ? previews : undefined,
    status: task.status === 'done' ? 'pending' : task.status,
  }
}

/**
 * Everything this task has recorded per source, in the shape the EDIT JOB window sends
 * back. Only what can actually be set is sent, so a sequence's derived length is not
 * mistaken for a choice.
 */
export const sourceTimingOverrides = (task: QueueTask): SourceTimingMap | undefined => {
  const overrides: SourceTimingMap = {}
  const record = (sourcePath: string) => (overrides[sourcePath] = overrides[sourcePath] || {})
  Object.entries(task.sourceMetadata || {}).forEach(([sourcePath, metadata]) => {
    if (metadata.fps && metadata.fps > 0) record(sourcePath).fps = metadata.fps
  })
  Object.entries(task.sequenceInputs || {}).forEach(([sourcePath, sequence]) => {
    if (sequence.fps > 0) record(sourcePath).fps = sequence.fps
  })
  if (task.sequenceInput?.firstFrame && task.sequenceInput.fps > 0) record(task.sequenceInput.firstFrame).fps = task.sequenceInput.fps
  task.sourcePaths.forEach((sourcePath) => {
    const recorded = task.sourceMetadata?.[sourcePath]?.duration
    const isSequence = Boolean(task.sequenceInputs?.[sourcePath]) || task.sequenceInput?.firstFrame === sourcePath
    if (recorded && recorded > 0 && !isSequence && mediaKind(sourcePath) === 'image') record(sourcePath).seconds = recorded
  })
  return Object.keys(overrides).length ? overrides : undefined
}
