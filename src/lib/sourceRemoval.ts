import { QueueTask } from '../types'
import { mediaKind } from './mediaKind'
import { legacyClipId, matchClipIdsToPaths, materializeClipIds, materializeClipNumbers } from './clipIds'

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
 * The per-clip records a SINGLE clip keeps when a job is split into one job per source.
 *
 * A split takes each clip into a job of its own, so the clip's own records have to come with it — under its
 * own id, which is the key they are filed under and which the new job's one-source list still resolves. The
 * job-wide fallbacks (a record filed against the path alone) are carried too, because those are decisions
 * about the FILE rather than about the clip and went with it before ids existed.
 */
export const clipRecordsFor = (item: QueueTask, key: string, path: string): Pick<QueueTask, 'trimPoints' | 'transitions' | 'sourceFit' | 'sourceCrop' | 'sourceSpeed' | 'sourceFps'> => {
  const pick = <T,>(map: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!map) return undefined
    const kept: Record<string, T> = {}
    if (map[key] !== undefined) kept[key] = map[key]
    if (map[path] !== undefined) kept[path] = map[path]
    return Object.keys(kept).length ? kept : undefined
  }
  return {
    trimPoints: pick(item.trimPoints),
    transitions: pick(item.transitions),
    sourceFit: pick(item.sourceFit),
    sourceCrop: pick(item.sourceCrop),
    sourceSpeed: pick(item.sourceSpeed),
    sourceFps: pick(item.sourceFps),
  }
}

/**
 * One job with one of its sources taken out, or null when that would leave nothing to encode.
 *
 * Nothing keyed by a clip is re-written here any more, and that is the whole of the change ids made: a
 * clip's trim, its transitions, its fit, its crop, its speed and its rate are filed under the clip's OWN
 * id, and an id does not move when the clip does. Taking a clip out drops one id from the list and leaves
 * every record exactly where it was — where the surviving clips still find it, because they kept their
 * ids. The old rule rebuilt each map onto the places the survivors now hold, which was the same operation
 * wearing a disguise and got a file imported twice wrong.
 *
 * A job whose visuals are all gone but which still has tracks has those tracks promoted to sources, and
 * a promoted track is given the legacy key it already had (`path#0`) as its id, so its own trim and speed
 * follow it out of the track list and into the source list rather than being left behind.
 *
 * Null rather than the job unchanged when there is nothing left is the point of the last check: a
 * removal that cannot happen must not look as though it did.
 */
export const removeSourceFromTask = (item: QueueTask, sourcePath: string, sourceIndex?: number): QueueTask | null => {
  const ids = materializeClipIds(item)
  const numbers = materializeClipNumbers(item)
  const remainingEntries = item.sourcePaths
    .map((path, index) => ({ path, index }))
    .filter(({ path, index }) => sourceIndex == null ? path !== sourcePath : index !== sourceIndex)
  let sourcePaths = remainingEntries.map(({ path }) => path)
  let clipIds = remainingEntries.map(({ index }) => ids[index])
  let clipNumbers = remainingEntries.map(({ index }) => numbers[index])
  let additionalAudioTracks = (item.additionalAudioTracks || []).filter((track) => track.path !== sourcePath)
  const sequenceStillPresent = sourcePaths.includes(sourcePath)
  const removedSequence = item.sequenceInput?.firstFrame === sourcePath && !sequenceStillPresent
  const sequenceInputs = item.sequenceInputs
    ? Object.fromEntries(Object.entries(item.sequenceInputs).filter(([key]) => key !== sourcePath || sequenceStillPresent))
    : item.sequenceInputs
  const remainingPreviews = item.imageSequencePreviews
    ? Object.fromEntries(Object.entries(item.imageSequencePreviews).filter(([key]) => key !== sourcePath || sequenceStillPresent))
    : item.imageSequencePreviews
  const hasVisual = sourcePaths.some((path) => mediaKind(path) !== 'audio')
  if (!hasVisual && additionalAudioTracks.length) {
    const promoted = additionalAudioTracks.map((track) => track.path)
    sourcePaths = [...sourcePaths, ...promoted]
    clipIds = [...clipIds, ...promoted.map((path) => legacyClipId(path, 0))]
    clipNumbers = [...clipNumbers, ...promoted.map(() => 1)]
    additionalAudioTracks = []
  }
  if (!sourcePaths.length) return null
  // The records of the clip that went go with it, while every job-wide fallback (a record filed against the
  // PATH alone) stays: an id that is no longer in the list cannot be looked up, so its records would only
  // linger as dead weight. A key that was never an id is a decision about the FILE and is kept.
  const knownIds = new Set(ids)
  const survivingIds = new Set(clipIds)
  const prune = <T,>(map: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!map) return undefined
    const kept: Record<string, T> = {}
    for (const [key, value] of Object.entries(map)) {
      if (!knownIds.has(key) || survivingIds.has(key)) kept[key] = value
    }
    return Object.keys(kept).length ? kept : undefined
  }
  return {
    ...item,
    sourcePaths,
    clipIds,
    clipNumbers,
    additionalAudioTracks: additionalAudioTracks.length ? additionalAudioTracks : undefined,
    trimPoints: prune(item.trimPoints),
    transitions: prune(item.transitions),
    sourceFit: prune(item.sourceFit),
    sourceCrop: prune(item.sourceCrop),
    sourceSpeed: prune(item.sourceSpeed),
    sourceFps: prune(item.sourceFps),
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
 * The same work as the single removal above, for the whole list rather than for one source out of it: the
 * editor owns the list while it is open, so what arrives is the list it shows — with sources gone,
 * possibly in another order. The removals are worked out here from the end backwards, so each older index
 * is still valid as its neighbours go.
 *
 * An ORDER comes with the ids when the editor sends them (`clipIds`, alongside the paths), because only
 * the ids can say which of two copies of one file moved where. A call that arrives with paths alone has
 * its ids matched to them by occurrence, which is right for distinct files and the best that can be done
 * for copies — see `matchClipIdsToPaths`.
 */
export const withSourceList = (item: QueueTask, sourcePaths: string[], tracks: SourceTracks = [], clipIds?: string[]): QueueTask | null => {
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
  const keeping = clipIds && clipIds.length === sourcePaths.length
    ? clipIds
    : matchClipIdsToPaths(next.sourcePaths, materializeClipIds(next), sourcePaths)
  // The numbers move with the ids they belong to, so a clip's `CLIP n` is the one it was given.
  const fromIds = materializeClipIds(next)
  const fromNumbers = materializeClipNumbers(next)
  const keepingNumbers = keeping.map((id, index) => {
    const at = fromIds.indexOf(id)
    return at >= 0 ? fromNumbers[at] : index + 1
  })
  const sameOrder = JSON.stringify(next.sourcePaths) === JSON.stringify(sourcePaths)
  const ordered = sameOrder ? next : { ...next, sourcePaths, clipIds: keeping, clipNumbers: keepingNumbers }
  return { ...ordered, additionalAudioTracks: tracks.length ? tracks : undefined, type: inferredMode(sourcePaths, tracks) }
}
