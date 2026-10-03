import { QueueTask } from '../types'
import { mediaKind } from './mediaKind'
import { rekeyClipMap } from './timelineModel'

/** The tracks a job carries, in the form the editor hands them over. */
type SourceTracks = NonNullable<QueueTask['additionalAudioTracks']>

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
  const nextSpeeds = Object.fromEntries(remainingEntries.map(({ path, index: oldIndex }, newIndex) => {
    return [`${path}#${newIndex}`, item.sourceSpeed?.[`${path}#${oldIndex}`] || item.sourceSpeed?.[path]]
  }).filter(([, speed]) => Boolean(speed)))
  const nextRates = Object.fromEntries(remainingEntries.map(({ path, index: oldIndex }, newIndex) => {
    return [`${path}#${newIndex}`, item.sourceFps?.[`${path}#${oldIndex}`] || item.sourceFps?.[path]]
  }).filter(([, rate]) => Boolean(rate)))
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
    sourceSpeed: Object.keys(nextSpeeds).length ? nextSpeeds : undefined,
    sourceFps: Object.keys(nextRates).length ? nextRates : undefined,
    imageSequencePreviews: removedSequence ? undefined : remainingPreviews,
    sequenceInput: removedSequence ? undefined : item.sequenceInput,
    sequenceInputs,
    type: inferredMode(sourcePaths, additionalAudioTracks),
    status: item.status === 'done' ? 'pending' : item.status,
  }
}

/**
 * One job with the source and track list an editor is showing, or null when there would be nothing to
 * encode.
 *
 * The same work as the single removal above, for the whole list rather than for one source out of it:
 * the editor owns the list while it is open, so what arrives is the list it shows — with sources gone,
 * possibly in another order. The removals are worked out here, from the end backwards, so each older
 * index is still valid as its neighbours go: that is what lets the single removal do the re-keying
 * for us, and every clip's trim, fade, fit and crop follow their clip onto the place it now has.
 *
 * An ORDER is the one thing a removal cannot express. Reordering moves no clip in or out of the job,
 * so it is carried by re-keying the same records across the two orders — which is the helper trims
 * and transitions are already re-keyed with, and by the same rule of matching occurrences in order,
 * so a job holding one file twice keeps each copy's own records.
 *
 * A track has no place in the list and nothing filed against one, so a track the editor took out
 * simply goes; the mode is then re-read from what is left, exactly as a removal re-reads it.
 */
export const withSourceList = (item: QueueTask, sourcePaths: string[], tracks: SourceTracks = []): QueueTask | null => {
  const goneFrom: number[] = []
  const stillWanted = [...sourcePaths]
  item.sourcePaths.forEach((sourcePath, index) => {
    const at = stillWanted.indexOf(sourcePath)
    if (at >= 0) stillWanted.splice(at, 1)
    else goneFrom.push(index)
  })
  let next: QueueTask | null = item
  goneFrom.sort((earlier, later) => later - earlier).forEach((index) => {
    if (next) next = removeSourceFromTask(next, next.sourcePaths[index], index)
  })
  if (!next || !next.sourcePaths.length) return null
  const ordered = JSON.stringify(next.sourcePaths) === JSON.stringify(sourcePaths)
    ? next
    : {
        ...next,
        sourcePaths,
        trimPoints: rekeyClipMap(next.trimPoints, next.sourcePaths, sourcePaths),
        transitions: rekeyClipMap(next.transitions, next.sourcePaths, sourcePaths),
        sourceFit: rekeyClipMap(next.sourceFit, next.sourcePaths, sourcePaths),
        sourceCrop: rekeyClipMap(next.sourceCrop, next.sourcePaths, sourcePaths),
        sourceSpeed: rekeyClipMap(next.sourceSpeed, next.sourcePaths, sourcePaths),
        sourceFps: rekeyClipMap(next.sourceFps, next.sourcePaths, sourcePaths),
      }
  return { ...ordered, additionalAudioTracks: tracks.length ? tracks : undefined, type: inferredMode(sourcePaths, tracks) }
}
