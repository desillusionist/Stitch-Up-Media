/**
 * Undo and redo over whole snapshots of an editable draft.
 *
 * A stack of states rather than of changes, because that is what the callers have: every control in
 * the editor writes a complete new draft, so the draft from before a write IS the previous state and
 * stepping back is a plain assignment. Nothing has to know how to invert a change, which is what
 * makes this usable by controls that were never written with undo in mind.
 *
 * Two rules carry the behaviour, and both are the sort that look like details until they are wrong.
 * A change that changes nothing is not recorded — a crop dragged against an edge it is already at, or
 * a fit switched on twice, would otherwise leave a stack of identical states, and one step back would
 * look like nothing happened at all. And a new change clears the redo stack, because the edits that
 * were undone are not ahead of a branch that has since gone another way.
 */

export interface DraftHistory<T> {
  /** States before the present one, oldest first. */
  past: T[]
  /** States that were stepped back from, newest first. */
  future: T[]
}

/** How many edits back a window can step. A cap rather than a count, so a drag cannot grow it. */
export const HISTORY_LIMIT = 60

export const emptyHistory = <T>(): DraftHistory<T> => ({ past: [], future: [] })

/**
 * Whether two values of a draft field are the same one.
 *
 * Compared by identity, except for the records a draft carries — the crops, fits, trims, mutes and
 * timings — which every caller builds anew whether or not it is changing anything, so identity says
 * nothing about them. Those are compared by content, which for records of a handful of numbers is
 * cheap enough to do on every edit.
 */
export const sameField = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/**
 * The history that results from a change, or null when the change changes nothing.
 *
 * Null is the signal to the caller that it should write the draft anyway — a write of the same value
 * is harmless — but must not remember it.
 */
export const recordChange = <T extends object>(history: DraftHistory<T>, before: T, changes: Partial<T>): DraftHistory<T> | null => {
  const keys = Object.keys(changes) as Array<keyof T>
  const differs = keys.some((key) => !sameField(before[key], changes[key]))
  if (!differs) return null
  const past = [...history.past, before]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { past, future: [] }
}

/**
 * The history after a GESTURE — a drag — has ended, which is one step however many moves it took.
 *
 * A drag writes the draft on every pointer move, because that is what makes the picture follow the
 * pointer. Recorded one step per move, a single drag took dozens of presses to walk back, and the
 * press that put it back was a twitch rather than the drag. The rule is stated here rather than at
 * each of the gestures: the draft's state BEFORE the drag is the step, and everything the drag wrote
 * is what it steps back from. `recordChange` answers with nothing at all for a drag that came back to
 * where it started, so a gesture that changed nothing leaves no step behind.
 */
export const endGesture = <T extends object>(history: DraftHistory<T>, before: T, after: T): DraftHistory<T> | null =>
  recordChange(history, before, after)

/**
 * One step back or forward, as the history to keep and the state to show — or null at either end.
 *
 * The step itself is not recorded in either direction, so a run of undos followed by a run of redos
 * comes back to where it started rather than to a stack of its own making.
 */
export const stepHistory = <T>(history: DraftHistory<T>, current: T, direction: 'undo' | 'redo'): { history: DraftHistory<T>; state: T } | null => {
  const past = [...history.past]
  const future = [...history.future]
  const state = direction === 'undo' ? past.pop() : future.pop()
  if (state === undefined) return null
  if (direction === 'undo') future.push(current)
  else past.push(current)
  return { history: { past, future }, state }
}
