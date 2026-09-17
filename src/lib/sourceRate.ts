import { QueueTask } from '../types'
import { dropPreviewsFor } from './quickLookTarget'

/**
 * Records a source's frame rate, and throws away anything built at the old one.
 *
 * A generated preview clip is a real file rendered at a rate, so changing the rate
 * makes it stale. Keeping it is what left the frame-accurate helper showing footage at
 * the rate the user had just replaced, and the editor's own monitor playing a clip
 * whose frame grid no longer matched the rate displayed beside it.
 *
 * Called from both places a rate can be changed: the queue's MEDIA INFO and the EDIT
 * JOB's, so the two cannot drift.
 */
export const withSourceRate = (task: QueueTask, sourcePath: string, fps: number): QueueTask => {
  if (!Number.isFinite(fps) || fps <= 0) return task
  // An interpreted sequence derives its length from its frame count over its rate, so
  // the rate moves the duration with it.
  const reflow = (sequence: QueueTask['sequenceInput']): QueueTask['sequenceInput'] =>
    sequence ? { ...sequence, fps, duration: sequence.frameCount / fps } : sequence
  const previews = { ...(task.imageSequencePreviews || {}) }
  // A generated clip is keyed partly by the rate it was rendered at, and partly by the
  // length a still was given, so every clip for this source is now stale.
  dropPreviewsFor(previews, sourcePath)
  return {
    ...task,
    sourceMetadata: {
      ...(task.sourceMetadata || {}),
      [sourcePath]: { ...(task.sourceMetadata?.[sourcePath] || {}), fps },
    },
    sequenceInput: task.sequenceInput?.firstFrame === sourcePath ? reflow(task.sequenceInput) : task.sequenceInput,
    sequenceInputs: task.sequenceInputs?.[sourcePath]
      ? { ...task.sequenceInputs, [sourcePath]: reflow(task.sequenceInputs[sourcePath]) as NonNullable<QueueTask['sequenceInput']> }
      : task.sequenceInputs,
    imageSequencePreviews: Object.keys(previews).length ? previews : undefined,
    status: task.status === 'done' ? 'pending' : task.status,
  }
}
