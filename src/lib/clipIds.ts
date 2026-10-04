/**
 * A clip's IDENTITY, which is its own and not its place.
 *
 * A per-clip record — a trim, a fade, a fit, a crop, a speed, a rate — used to be filed under the clip's
 * PATH and its PLACE in the job (`path#index`). That made a clip's identity its position, so every move,
 * removal or split had to RE-WRITE every record onto the place the clip had landed on, and every one of
 * those re-writes was a chance to miss one. The two bugs it produced were both of that shape: removing one
 * of two copies of a file removed the first, and dragging one past the other moved nothing, because a path
 * cannot tell two copies apart and a place is not an identity.
 *
 * A clip now carries an id. It is stored beside the sources it names — `clipIds`, one per occurrence in
 * `sourcePaths` order — and it TRAVELS with the clip: a reorder permutes the two lists together, a removal
 * drops the one id, a split carries it into the new job. Nothing is re-keyed, because nothing was ever
 * keyed by the thing that moved.
 *
 * A job saved before ids existed has none, and it does not need migrating on disk: the fallback id for a
 * clip is exactly the key its records already have (`path#index`), so every legacy record resolves as it
 * did. The list is MATERIALIZED — those keys written down as ids — before the job's list is first changed,
 * so that a removal which shifts the places does not shift the ids with them.
 */

/** The source list and its ids, which is all an id lookup needs — a partial job is fine. */
export type ClipIdSource = { sourcePaths?: string[]; clipIds?: string[]; clipNumbers?: number[] }

/** The key a clip's records had before ids existed, and the id a legacy clip falls back to. */
export const legacyClipId = (sourcePath: string, index: number): string => `${sourcePath}#${index}`

/** The id at a place in the job's source list, falling back to the legacy key for a job that has none. */
export const clipIdAt = (task: ClipIdSource, index: number): string =>
  task.clipIds?.[index] ?? legacyClipId(task.sourcePaths?.[index] ?? '', index)

/**
 * The id list a job should carry, writing down the legacy keys for a job that has none yet.
 *
 * Called before ANY change to the list, because every change moves places: a removal shifts the clips after
 * it, and an id left implicit would shift with the place it was hiding behind. Written down, the id stays
 * on the clip however far the clip moves.
 */
export const materializeClipIds = (task: ClipIdSource): string[] =>
  (task.sourcePaths ?? []).map((sourcePath, index) => task.clipIds?.[index] ?? legacyClipId(sourcePath, index))

let clipCounter = 0

/**
 * An id for a clip that never had one: OPAQUE, so that two segments of one file are two clips.
 *
 * Deliberately not derived from the path — a path-derived id would collide for a file imported twice, which
 * is the very case ids exist to tell apart. The counter keeps ids unique within a session's own generation
 * and the time and randomness keep them unique across them.
 */
export const newClipId = (): string =>
  `clip-${Date.now().toString(36)}-${(clipCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** The ids for a run of sources being added to a job, one opaque id each. */
export const newClipIds = (count: number): string[] => Array.from({ length: Math.max(0, count) }, () => newClipId())

/**
 * The key one clip's records are filed under.
 *
 * The id at that place in the SOURCE LIST, when the place really is the source list's — the main lane's
 * clips are the sources, so their key is their id. An added audio track is NOT in `sourcePaths`, and has
 * an id of its own on the track rather than in this list, so it keeps the legacy key it always had.
 */
export const clipKey = (
  task: ClipIdSource,
  sourcePath: string | undefined,
  index: number,
): string => (sourcePath != null && task.sourcePaths?.[index] === sourcePath ? clipIdAt(task, index) : legacyClipId(sourcePath ?? '', index))

/**
 * How many times a clip's file has appeared up to and including a place: the ordinal a clip is SHOWN by.
 *
 * Counted from a list, so it is a position; `materializeClipNumbers` is the one place that turns it into
 * something that travels.
 */
export const clipRankAt = (paths: string[], sourcePath: string, index: number): number =>
  paths.slice(0, index + 1).filter((candidate) => candidate === sourcePath).length

/**
 * The numbers a job should carry, writing down the ranks for a job that has none yet.
 *
 * Written down at the same moment the ids are, and for the same reason: a rank is counted from the LIST, so
 * a job that was never reordered shows the right number without storing one — and the first change writes
 * the numbers down so that the clips keep them however far they move.
 */
export const materializeClipNumbers = (task: ClipIdSource): number[] =>
  (task.sourcePaths ?? []).map((sourcePath, index) => task.clipNumbers?.[index] ?? clipRankAt(task.sourcePaths ?? [], sourcePath, index))

/** The number one clip is shown by: what it was given, or the rank it holds where it currently sits. */
export const clipNumberAt = (task: ClipIdSource, index: number): number =>
  task.clipNumbers?.[index] ?? clipRankAt(task.sourcePaths ?? [], task.sourcePaths?.[index] ?? '', index)

/**
 * What a clip is CALLED when its file appears in the job more than once: `COPY 1`, `COPY 2`.
 *
 * A file imported once needs no label — the name is the file's own — so this answers with nothing, and
 * every surface that names a clip (`COPY n // name`) falls back to the plain name. The figure is the clip's
 * travel-along NUMBER rather than its rank, so a reorder carries the label with the clip it names.
 *
 * `COPY` rather than `CLIP` because a clip is already what every item on the timeline is called; the label's
 * job is to tell two imports of ONE file apart, which is what a copy is.
 */
export const copyLabelFor = (task: ClipIdSource, index: number, sourcePath?: string): string | undefined => {
  const paths = task.sourcePaths ?? []
  const path = sourcePath ?? paths[index]
  if (path == null) return undefined
  // The index has to be this path's own place in the job's list: an audio track's clip carries an index into
  // its LANE, not into `sourcePaths`, so a label read from it would count the wrong file's copies.
  if (paths[index] !== path) return undefined
  return paths.filter((candidate) => candidate === path).length > 1 ? `COPY ${clipNumberAt(task, index)}` : undefined
}

/** The number the next added clip of a file takes: one past the highest its copies already carry. */
export const nextClipNumber = (task: ClipIdSource, sourcePath: string): number => {
  const numbers = materializeClipNumbers(task)
  const paths = task.sourcePaths ?? []
  const used = paths.map((path, index) => (path === sourcePath ? numbers[index] : 0))
  return 1 + (used.length ? Math.max(0, ...used) : 0)
}

/** One list with an item MOVED, which is the same splice the paths take — used for ids and for numbers. */
export const moveAlong = <T,>(list: T[], from: number, to: number): T[] => {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** One list with the item at a place DROPPED. */
export const dropAlong = <T,>(list: T[], index: number): T[] => list.filter((_, position) => position !== index)

/** The id list after a clip is MOVED from one place to another, which is a splice of the list itself. */
export const moveClipIds = (ids: string[], from: number, to: number): string[] => {
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return ids
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** The id list after the clip at a place is dropped. */
export const removeClipId = (ids: string[], index: number): string[] =>
  ids.filter((_, position) => position !== index)

/**
 * The ids for a requested source ORDER, matched by path with occurrences taken in order.
 *
 * The one list operation ids still need for a reorder that arrives as bare paths rather than as an id list:
 * each id is handed to the occurrence of its path in the new order. It cannot tell two copies of one file
 * apart — an id list is what can, and the editor sends one when it reorders — so this is the fallback for a
 * list that came from somewhere that only knew the paths.
 */
export const matchClipIdsToPaths = (fromPaths: string[], fromIds: string[], requestedPaths: string[]): string[] => {
  const pool = new Map<string, string[]>()
  fromPaths.forEach((path, index) => {
    const list = pool.get(path)
    if (list) list.push(fromIds[index])
    else pool.set(path, [fromIds[index]])
  })
  return requestedPaths.map((path, index) => pool.get(path)?.shift() ?? legacyClipId(path, index))
}

/** The numbers for a requested source order, matched by path with occurrences taken in order. */
export const matchClipNumbersToPaths = (fromPaths: string[], fromNumbers: number[], requestedPaths: string[]): number[] => {
  const pool = new Map<string, number[]>()
  const highest = new Map<string, number>()
  fromPaths.forEach((path, index) => {
    const list = pool.get(path)
    if (list) list.push(fromNumbers[index])
    else pool.set(path, [fromNumbers[index]])
    highest.set(path, Math.max(highest.get(path) ?? 0, fromNumbers[index]))
  })
  return requestedPaths.map((path) => {
    const reused = pool.get(path)?.shift()
    if (reused !== undefined) return reused
    const next = (highest.get(path) ?? 0) + 1
    highest.set(path, next)
    return next
  })
}
