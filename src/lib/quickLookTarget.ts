import { QueueTask } from '../types'
import { mediaKind } from './mediaKind'
import { isStillFrameJob, sequenceFor, sourceFps, stillSecondsFor } from './timelineModel'

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
  /** A generated clip this call had to build; the caller may want to persist it. */
  regeneratedPreview?: { sourceTarget: string; path: string }
  /**
   * A timed clip was needed for this still but could not be built, so the request
   * degraded to the still frame itself. The editor says so rather than pretending
   * the frame is footage.
   */
  previewUnavailable?: boolean
}

/** Separates a source path from the build parameters in a preview cache key. */
const PREVIEW_SPEC = '\u0000'

/**
 * The cache key a generated clip is stored under.
 *
 * A generated clip is a real file rendered at a rate and, for a still, a length, so
 * those parameters belong in the key. A still's clip used to be neither cached nor
 * keyed at all, which is why the frame-accurate helper rebuilt one on every single
 * open, and why the in/out points it reported on close were stored against a file name
 * the next open could never produce again.
 */
export const previewKey = (sourcePath: string, spec?: string): string =>
  spec ? `${sourcePath}${PREVIEW_SPEC}${spec}` : sourcePath

/**
 * The version of the format a generated clip is written in, and part of every key one is kept under.
 *
 * Bumped when the CONTENTS of a clip change for a reason its rate and its length do not show. A job
 * that has already been queued still names the clip that was built the old way, and a key that does
 * not carry the version goes on pointing at it forever — which for a clip a decoder cannot read means
 * the error goes on being reported for a file nothing has any reason to rebuild.
 *
 * 2: a still exported from a JPEG was written as yuvj420p, because `-pix_fmt yuv420p` is a request the
 *     encoder may take as meaning "full range", and yuvj420p IS yuv420p at full range. Chromium's
 *     decoder has no entry for it, so such a clip did not play at all and said so as an unsupported
 *     pixel format. Written at limited range now, and every clip written the old way is built again.
 */
export const PREVIEW_FORMAT_VERSION = 2

/**
 * What identifies an image sequence's generated clip, at the rate it was built at.
 *
 * The frame count belongs in it as well as the rate, because the clip's LENGTH comes from the two
 * together: a clip built from a shorter sequence is a different length at the same rate, and playing
 * it would drift from the timeline rather than merely look stale.
 */
const sequenceSpec = (rate: number, frameCount: number): string => `seq:v${PREVIEW_FORMAT_VERSION}:${rate}:${frameCount}`

/** The same for a still's clip, whose length is a choice rather than a count of frames. */
const stillSpec = (rate: number, seconds: number): string => `still:v${PREVIEW_FORMAT_VERSION}:${rate}:${seconds}`

/**
 * The keys a generated clip is held under, for a sequence and for a still.
 *
 * The one place each spec is spelled out. The queue files a clip when a source is imported and the
 * editor looks one up when it draws that clip, and while the two spelled the key separately they
 * disagreed: the queue wrote the bare source path while every reader asked for the rate and the frame
 * count with it, so the lookup always missed and every open rebuilt the whole sequence.
 */
export const sequencePreviewKey = (sourcePath: string, rate: number, frameCount: number): string =>
  previewKey(sourcePath, sequenceSpec(rate, frameCount))

export const stillPreviewKey = (sourcePath: string, rate: number, seconds: number): string =>
  previewKey(sourcePath, stillSpec(rate, seconds))

/** The logical source a cache key belongs to. */
export const sourceOfPreviewKey = (key: string): string => key.split(PREVIEW_SPEC)[0]

/**
 * The logical source a generated clip belongs to, or null when it is not one of ours.
 *
 * The native helper reports the file it was given, which for a still or a sequence is a
 * generated clip rather than the media the user picked, so the two have to be tied back
 * together or the trim would be filed against an ephemeral file name.
 */
export const sourceOfPreview = (previews: Record<string, string> | undefined, previewPath: string): string | null => {
  const entry = Object.entries(previews || {}).find(([, preview]) => preview === previewPath)
  return entry ? sourceOfPreviewKey(entry[0]) : null
}

/** Drops every generated clip recorded for a source, whatever it was built at. */
export const dropPreviewsFor = (previews: Record<string, string>, sourcePath: string): void => {
  Object.keys(previews).forEach((key) => { if (sourceOfPreviewKey(key) === sourcePath) delete previews[key] })
}

/**
 * The generated clip a task already has for a source, at the rate the timeline is working in.
 *
 * The counterpart of `previewKey` for READING rather than writing, and the reason it exists is that
 * the editor needs to know where a sequence's picture is without asking anybody: a clip that has been
 * built is on disk and its path is recorded on the task, so a window that opens on a job whose clips
 * are all built has everything it needs in front of it. Asking first is one IPC round trip per
 * source, and it shows up as the monitor saying PREPARING on every open for a clip that is not being
 * prepared at all.
 *
 * The rate is part of the key because the clip was rendered at one: a clip built at another rate is a
 * different length from the one the timeline expects, so it is not this source's clip and must not be
 * drawn as one — playing a sequence at the wrong speed for a moment is worse than saying PREPARING.
 * Nothing is returned for a source that is not an image sequence, because nothing else has a
 * generated clip: its own file is its picture.
 */
export const rememberedPreviewFor = (task: QueueTask, sourcePath: string | undefined, rate: number): string | undefined => {
  if (!sourcePath) return undefined
  const sequence = sequenceFor(task, sourcePath)
  if (!sequence) return undefined
  return task.imageSequencePreviews?.[sequencePreviewKey(sourcePath, rate, sequence.frameCount)]
}

/**
 * Resolves which media the native frame-accurate preview should open, and with
 * which trim points.
 *
 * Shared by the queue rail and the EDIT JOB window so the two can never drift on
 * image-sequence handling, still-frame detection, or trim-point lookup. Passing
 * `sourceIndex` previews that specific source; without it the queue's original
 * rule stands and a finished task previews its output instead.
 *
 * `sourcePath` names a source outright, which is what an AUDIO TRACK needs: a multi-track job keeps
 * its tracks in `additionalAudioTracks` rather than in `sourcePaths`, so no index into `sourcePaths`
 * can name one — and an index that misses resolves to the first entry, which is how a preview asked
 * for from an audio clip came back showing the job's first video.
 */
export const resolveQuickLookRequest = async (
  task: QueueTask,
  bridge: QuickLookBridge | undefined,
  options: { sourceIndex?: number; sourcePath?: string; preferOutput?: boolean; preferTimedStill?: boolean } = {},
): Promise<QuickLookRequest | null> => {
  const explicitIndex = options.sourceIndex != null || options.sourcePath != null || task.quickLookSourceIndex != null
  const sourceIndex = options.sourceIndex ?? task.quickLookSourceIndex ?? 0
  const sourceTarget = options.sourcePath ?? (explicitIndex ? (task.sourcePaths[sourceIndex] || task.sourcePaths[0]) : task.sourcePaths[0])

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

  const rate = sourceTarget ? sourceFps(task, sourceTarget) : 0
  const stillSeconds = stillSecondsFor(task, sourceTarget)
  // A generated clip is identified by what decides its contents, not by its source alone.
  // A sequence's clip carries its rate and frame count, because a clip built at another
  // rate is a different length from the one the timeline expects and would play the
  // sequence at the wrong speed rather than merely looking stale. A still's carries its
  // rate and length, since those are choices. Before this, a sequence imported when the
  // settings said 25 kept playing at 25 after the rate was changed to 30.
  const spec = sequence
    ? sequenceSpec(rate, sequence.frameCount)
    : timedStill ? stillSpec(rate, stillSeconds) : undefined
  const cacheKey = sourceTarget ? previewKey(sourceTarget, spec) : undefined
  let existingPreview = cacheKey ? task.imageSequencePreviews?.[cacheKey] : undefined
  let regeneratedPreview: QuickLookRequest['regeneratedPreview']
  if (cacheKey && needsPreview && (!existingPreview || !(await bridge?.pathExists?.(existingPreview)))) {
    // A generated clip is rendered at a rate, so it has to be built at the rate every
    // other part of the app is showing. The one rule for that rate lives in the timeline
    // model, and it is the same number the helper stamps its frames with.
    const created = timedStill && !sequence
      ? await bridge?.createImageSequencePreview?.([sourceTarget as string], { fps: rate, stillSeconds })
      : await bridge?.createImageSequencePreview?.(sequence?.files?.length ? sequence.files : [sequence?.firstFrame || sourceTarget], {
        fps: rate,
        // The clip has to be exactly as long as the timeline believes the sequence is,
        // or the playhead and the picture drift apart across it. The concat demuxer on
        // its own emits a frame past the last one.
        duration: sequence && sequence.frameCount > 0 && rate > 0 ? sequence.frameCount / rate : undefined,
      })
    if (created) {
      existingPreview = created
      // Reported for every kind of clip now, so a caller can persist it. Persisting is
      // what keeps the clip's path stable between opens, which is what lets the in/out
      // points reported on close be filed against the source they belong to.
      regeneratedPreview = { sourceTarget: cacheKey, path: created }
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
