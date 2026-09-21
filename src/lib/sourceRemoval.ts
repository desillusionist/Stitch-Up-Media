import { QueueTask } from '../types'
import { mediaKind } from './mediaKind'
import { rekeyClipMap } from './timelineModel'

/**
 * The mode a job's remaining sources and tracks make it.
 *
 * Taking a source out can change what a job IS, not merely what it contains: the only visual of a
 * combo leaving two tracks behind it makes a stitch of those tracks, and a track leaving a job with
 * its one visual makes a plain transcode. The rule is stated once, here, and the same one decides
 * what a job is when it is first built.
 */
export const inferredMode = (sourcePaths: string[], tracks: Array<{ path: string }> = []): QueueTask['type'] => {
  const hasVideo = sourcePaths.some((path) => mediaKind(path) !== 'audio')
  const hasAudio = tracks.length > 0 || sourcePaths.some((path) => mediaKind(path) === 'audio')
  if (hasVideo && hasAudio) return sourcePaths.filter((path) => mediaKind(path) !== 'audio').length > 1 ? 'combo' : 'multitrack'
  if (hasAudio && !hasVideo) return sourcePaths.length > 1 ? 'stitch' : 'transcode'
  if (sourcePaths.length > 1) return 'stitch'
  return 'transcode'
}

/**
 * One job with one of its sources taken out, or null when that would leave nothing to encode.
 *
 * Everything keyed by a clip's PLACE in the job — its trim, its transitions, its fit, its crop — has
 * to be re-keyed to the place the clip now has, or the records stay on whatever moved into the index
 * they were filed under. That is why they are rebuilt from the surviving entries rather than filtered:
 * a filter would keep `"a.mp4#2"` meaning the clip that is now `"a.mp4#1"`.
 *
 * A job whose visuals are all gone but which still has tracks has those tracks promoted to sources,
 * because a job cannot carry tracks with nothing to play them against — the same rule the mode
 * inference above then reads.
 *
 * Null rather than the job unchanged when there is nothing left is the point of the last check: a
 * removal that cannot happen must not look as though it did. The caller drops the job, which is the
 * honest outcome of taking the last thing to encode out of it.
 */
export const removeSourceFromTask = (item: QueueTask, sourcePath: string, sourceIndex?: number): QueueTask | null => {
  const remainingEntries = item.sourcePaths
    .map((path, index) => ({ path, index }))
    .filter(({ path, index }) => sourceIndex == null ? path !== sourcePath : index !== sourceIndex)
  let sourcePaths = remainingEntries.map(({ path }) => path)
  let additionalAudioTracks = (item.additionalAudioTracks || []).filter((track) => track.path !== sourcePath)
  const sequenceStillPresent = sourcePaths.includes(sourcePath)
  const removedSequence = item.sequenceInput?.firstFrame === sourcePath && !sequenceStillPresent
  const sequenceInputs = item.sequenceInputs
    ? Object.fromEntries(Object.entries(item.sequenceInputs).filter(([key]) => key !== sourcePath || sequenceStillPresent))
    : item.sequenceInputs
  const remainingPreviews = item.imageSequencePreviews
    ? Object.fromEntries(Object.entries(item.imageSequencePreviews).filter(([key]) => key !== sourcePath || sequenceStillPresent))
    : item.imageSequencePreviews
  const nextTrimPoints = Object.fromEntries(remainingEntries.map(({ path, index: oldIndex }, newIndex) => {
    return [`${path}#${newIndex}`, item.trimPoints?.[`${path}#${oldIndex}`] || item.trimPoints?.[path]]
  }).filter(([, point]) => Boolean(point)))
  const nextFits = Object.fromEntries(remainingEntries.map(({ path, index: oldIndex }, newIndex) => {
    return [`${path}#${newIndex}`, item.sourceFit?.[`${path}#${oldIndex}`] || item.sourceFit?.[path]]
  }).filter(([, fit]) => Boolean(fit)))
  const nextCrops = Object.fromEntries(remainingEntries.map(({ path, index: oldIndex }, newIndex) => {
    return [`${path}#${newIndex}`, item.sourceCrop?.[`${path}#${oldIndex}`] || item.sourceCrop?.[path]]
  }).filter(([, region]) => Boolean(region)))
  const hasVisual = sourcePaths.some((path) => mediaKind(path) !== 'audio')
  if (!hasVisual && additionalAudioTracks.length) {
    sourcePaths = [...sourcePaths, ...additionalAudioTracks.map((track) => track.path)]
    additionalAudioTracks = []
  }
  if (!sourcePaths.length) return null
  return {
    ...item,
    sourcePaths,
    additionalAudioTracks: additionalAudioTracks.length ? additionalAudioTracks : undefined,
    trimPoints: nextTrimPoints,
    transitions: rekeyClipMap(item.transitions, item.sourcePaths, remainingEntries.map(({ path }) => path)),
    sourceFit: Object.keys(nextFits).length ? nextFits : undefined,
    sourceCrop: Object.keys(nextCrops).length ? nextCrops : undefined,
    imageSequencePreviews: removedSequence ? undefined : remainingPreviews,
    sequenceInput: removedSequence ? undefined : item.sequenceInput,
    sequenceInputs,
    type: inferredMode(sourcePaths, additionalAudioTracks),
    status: item.status === 'done' ? 'pending' : item.status,
  }
}
