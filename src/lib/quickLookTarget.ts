import { QueueTask } from '../types'
import { mediaKind } from './mediaKind'
import { isStillFrameJob, sourceFps } from './timelineModel'

/** The subset of the preload bridge this helper needs. */
export interface QuickLookBridge {
  pathExists?: (filePath: string) => Promise<boolean>
  createImageSequencePreview?: (paths: string[], options?: { fps?: number; stillSeconds?: number; duration?: number }) => Promise<string | null>
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
  /**
   * A timed clip was needed for this still but could not be built, so the request
   * degraded to the still frame itself. The editor says so rather than pretending
   * the frame is footage.
   */
  previewUnavailable?: boolean
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

  // Only an interpreted sequence is cached: its length comes from the frames, so a
  // cached clip stays valid. A timed still's clip is only valid for the length it
  // was built at, and the cache is keyed by source alone, so it is rebuilt every
  // time rather than being handed over at the wrong length.
  let existingPreview = sourceTarget && sequence ? task.imageSequencePreviews?.[sourceTarget] : undefined
  let regeneratedPreview: QuickLookRequest['regeneratedPreview']
  if (sourceTarget && needsPreview && (!existingPreview || !(await bridge?.pathExists?.(existingPreview)))) {
    // A generated clip is rendered at a rate, so it has to be built at the rate every
    // other part of the app is showing. The one rule for that rate lives in the timeline
    // model, and it is the same number the helper stamps its frames with.
    const rate = sourceFps(task, sourceTarget)
    const created = timedStill && !sequence
      ? await bridge?.createImageSequencePreview?.([sourceTarget], { fps: rate, stillSeconds: Math.max(0.1, task.stillImageDuration || 10) })
      : await bridge?.createImageSequencePreview?.(sequence?.files?.length ? sequence.files : [sequence?.firstFrame || sourceTarget], {
        fps: rate,
        // The clip has to be exactly as long as the timeline believes the sequence is,
        // or the playhead and the picture drift apart across it. The concat demuxer on
        // its own emits a frame past the last one.
        duration: sequence && sequence.frameCount > 0 && rate > 0 ? sequence.frameCount / rate : undefined,
      })
    if (created) {
      existingPreview = created
      // Only sequences are worth caching, for the reason above.
      if (!timedStill || sequence) regeneratedPreview = { sourceTarget, path: created }
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

  // A clip that could not be generated is handed over as a still rather than as
  // footage. The helper builds a video asset from an image, clamps its length to one
  // second and draws nothing, which read as a broken preview instead of a failure.
  // Anything that needed a clip has an image to fall back on: either the still itself
  // or an image sequence's first frame, which is what the target resolves to.
  const previewUnavailable = needsPreview && !existingPreview
  return {
    target,
    sourceIndex,
    stillMode: standaloneImage ? (!timedStill || previewUnavailable) : previewUnavailable,
    trimIn: points?.in,
    trimOut: points?.out,
    sequenceFps: sequence?.fps,
    sequenceFrameCount: sequence?.frameCount,
    regeneratedPreview,
    previewUnavailable: previewUnavailable || undefined,
  }
}
