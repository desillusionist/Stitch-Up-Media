import { QueueTask } from '../types'
import { mediaKind } from './mediaKind'

/** The subset of the preload bridge this helper needs. */
export interface QuickLookBridge {
  pathExists?: (filePath: string) => Promise<boolean>
  createImageSequencePreview?: (paths: string[]) => Promise<string | null>
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
  options: { sourceIndex?: number; preferOutput?: boolean } = {},
): Promise<QuickLookRequest | null> => {
  const explicitIndex = options.sourceIndex != null || task.quickLookSourceIndex != null
  const sourceIndex = options.sourceIndex ?? task.quickLookSourceIndex ?? 0
  const sourceTarget = explicitIndex ? (task.sourcePaths[sourceIndex] || task.sourcePaths[0]) : task.sourcePaths[0]

  const sequence = sourceTarget
    ? task.sequenceInputs?.[sourceTarget] || (task.sequenceInput?.firstFrame === sourceTarget ? task.sequenceInput : undefined)
    : undefined

  let existingPreview = sourceTarget ? task.imageSequencePreviews?.[sourceTarget] : undefined
  let regeneratedPreview: QuickLookRequest['regeneratedPreview']
  if (sourceTarget && sequence && (!existingPreview || !(await bridge?.pathExists?.(existingPreview)))) {
    const created = await bridge?.createImageSequencePreview?.(sequence.files?.length ? sequence.files : [sequence.firstFrame])
    if (created) {
      existingPreview = created
      regeneratedPreview = { sourceTarget, path: created }
    }
  }

  const wantsOutput = options.preferOutput === true || (!explicitIndex && task.status === 'done')
  const target = existingPreview || (wantsOutput ? `${task.outputDirectory}/${task.outputFilename}` : sourceTarget)
  if (!target) return null

  // Trim points belong to the logical source occurrence, not the temporary sequence preview.
  const sourceKey = `${sourceTarget}#${sourceIndex}`
  const points = task.trimPoints?.[sourceKey]
    || task.trimPoints?.[sourceTarget ?? '']
    || task.trimPoints?.[`${target}#${sourceIndex}`]
    || task.trimPoints?.[target]

  const stillMode = sourceTarget != null
    && mediaKind(sourceTarget) === 'image'
    && !task.sequenceInputs?.[sourceTarget]
    && task.sequenceInput?.firstFrame !== sourceTarget

  return {
    target,
    sourceIndex,
    stillMode,
    trimIn: points?.in,
    trimOut: points?.out,
    sequenceFps: sequence?.fps,
    sequenceFrameCount: sequence?.frameCount,
    regeneratedPreview,
  }
}
