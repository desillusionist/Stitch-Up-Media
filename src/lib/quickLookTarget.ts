import { QueueTask } from '../types'
import { mediaKind } from './mediaKind'
import { isStillFrameJob } from './timelineModel'

/** The subset of the preload bridge this helper needs. */
export interface QuickLookBridge {
  pathExists?: (filePath: string) => Promise<boolean>
  createImageSequencePreview?: (paths: string[], options?: { fps?: number; stillSeconds?: number }) => Promise<string | null>
}

export interface QuickLookRequest {
  target: string
  sourceIndex: number
  /** The native helper draws a single frame instead of a transport for standalone images. */
  stillMode: boolean
  trimIn?: number
  trimOut?: number
  sequenceFps?: number
  sequenceFrameCount?: number
  /** A sequence thumbnail this call had to regenerate; the caller may want to persist it. */
  regeneratedPreview?: { sourceTarget: string; path: string }
}

/**
 * Resolves which media the native frame-accurate preview should open, and with
 * which trim points.
 *
 * Shared by the queue rail and the EDIT JOB window so the two can never drift on
 * image-sequence handling, still-frame detection, or trim-point lookup. Passing
 * `sourceIndex` previews that specific source; without it the queue's original
 * rule stands and a finished task previews its output instead.
 */
export const resolveQuickLookRequest = async (
  task: QueueTask,
  bridge: QuickLookBridge | undefined,
  options: { sourceIndex?: number; preferOutput?: boolean; preferTimedStill?: boolean } = {},
): Promise<QuickLookRequest | null> => {
  const explicitIndex = options.sourceIndex != null || task.quickLookSourceIndex != null
  const sourceIndex = options.sourceIndex ?? task.quickLookSourceIndex ?? 0
  const sourceTarget = explicitIndex ? (task.sourcePaths[sourceIndex] || task.sourcePaths[0]) : task.sourcePaths[0]

  const sequence = sourceTarget
    ? task.sequenceInputs?.[sourceTarget] || (task.sequenceInput?.firstFrame === sourceTarget ? task.sequenceInput : undefined)
    : undefined

  const standaloneImage = sourceTarget != null
    && mediaKind(sourceTarget) === 'image'
    && !task.sequenceInputs?.[sourceTarget]
    && task.sequenceInput?.firstFrame !== sourceTarget
  // A still that will become a timed clip needs real footage to trim against, so
  // it is played through a generated clip rather than a single frame. A still that
  // stays a single frame keeps the lite helper instead.
  const timedStill = options.preferTimedStill === true && standaloneImage && !isStillFrameJob(task)
  // Only consult a generated preview when one is actually wanted. A still that has
  // gone back to single-frame output must target its own frame again, or the lite
  // helper is handed a video file and quietly shows nothing.
  const needsPreview = Boolean(sequence) || timedStill

  let existingPreview = sourceTarget && needsPreview ? task.imageSequencePreviews?.[sourceTarget] : undefined
  let regeneratedPreview: QuickLookRequest['regeneratedPreview']
  if (sourceTarget && needsPreview && (!existingPreview || !(await bridge?.pathExists?.(existingPreview)))) {
    const created = timedStill && !sequence
      ? await bridge?.createImageSequencePreview?.([sourceTarget], { fps: 25, stillSeconds: Math.max(0.1, task.stillImageDuration || 10) })
      : await bridge?.createImageSequencePreview?.(sequence?.files?.length ? sequence.files : [sequence?.firstFrame || sourceTarget])
    if (created) {
      existingPreview = created
      regeneratedPreview = { sourceTarget, path: created }
    }
  }

  const wantsOutput = options.preferOutput === true || (!explicitIndex && task.status === 'done')
  const target = existingPreview || (wantsOutput ? `${task.outputDirectory}/${task.outputFilename}` : sourceTarget)
  if (!target) return null

  // Trim points belong to the logical source occurrence, not the temporary preview.
  const sourceKey = `${sourceTarget}#${sourceIndex}`
  const points = task.trimPoints?.[sourceKey]
    || task.trimPoints?.[sourceTarget ?? '']
    || task.trimPoints?.[`${target}#${sourceIndex}`]
    || task.trimPoints?.[target]

  return {
    target,
    sourceIndex,
    stillMode: standaloneImage && !timedStill,
    trimIn: points?.in,
    trimOut: points?.out,
    sequenceFps: sequence?.fps,
    sequenceFrameCount: sequence?.frameCount,
    regeneratedPreview,
  }
}
