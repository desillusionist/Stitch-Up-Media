/**
 * The ADD BLANK / ADD SILENCE placeholders: sources that are not files.
 *
 * A placeholder is a source with nothing behind it — a stretch of flat colour, or of silence — so it is named
 * by a SCHEME rather than by a path, and everything that reads a source has to know one when it sees one. It
 * is kept as a source rather than as a field beside the list because that is what the rest of the app already
 * understands: it takes a trim like a clip, it is joined like a clip, it is re-keyed and pruned like a clip,
 * and two of them on one job are two clips rather than one thing said twice.
 *
 * Its IDENTITY is in the path — the kind, a unique id, and (for a blank) the fill colour. That is what lets a
 * blank's colour be PER CLIP without a new per-clip record to thread through every transit point the app has:
 * changing the colour is changing that clip's own source, which every list-shadowing rule already carries.
 * And because the path is what a job stores, a placeholder needs no cache file to lose: nothing is generated
 * at all until the encoder asks ffmpeg for a flat colour of the length the clip was stretched to.
 */

export type PlaceholderKind = 'video' | 'audio'

/** The scheme that marks a source as a placeholder rather than a file. */
const SCHEME = 'placeholder:'

/** The colour a blank falls back to, which is black. */
export const DEFAULT_BLANK_FILL = '000000'

/**
 * How long a placeholder SOURCE runs.
 *
 * A placeholder has no material to run out of, so this is the ceiling on how far a clip may be stretched and
 * not a fact about anything — the clip's own length is its trim window, which is where a reader sets it. Ten
 * hours is beyond any single join and short enough that every figure drawn against it stays sane.
 */
export const PLACEHOLDER_SOURCE_SECONDS = 36000

/**
 * The length a freshly placed placeholder lands at, before it is stretched on the timeline.
 *
 * Also the fallback the model gives a placeholder with no trim of its own, so a clip can never answer with
 * the whole ten-hour ceiling just because a record went missing.
 */
export const DEFAULT_PLACEHOLDER_SECONDS = 5

/** A colour as the six hex digits the path carries, from anything a picker or a person may hand over. */
export const normaliseFill = (fill: string | undefined): string => {
  const hex = (fill ?? '').trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : DEFAULT_BLANK_FILL
}

/** The colour a blank's picture is painted, in the `#rrggbb` shape a colour input reads. */
export const fillCss = (fill: string | undefined): string => `#${normaliseFill(fill)}`

/** A fresh placeholder source, unique so two on one job are two clips with their own records. */
export const makePlaceholderPath = (kind: PlaceholderKind, fill: string = DEFAULT_BLANK_FILL): string => {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return kind === 'video' ? `${SCHEME}video:${id}:${normaliseFill(fill)}` : `${SCHEME}audio:${id}`
}

/** Whether a source is a placeholder, and of which kind, or nothing at all for a real file. */
export const placeholderKind = (sourcePath: string | undefined): PlaceholderKind | null => {
  if (!sourcePath || !sourcePath.startsWith(SCHEME)) return null
  return sourcePath.startsWith(`${SCHEME}video:`) ? 'video' : sourcePath.startsWith(`${SCHEME}audio:`) ? 'audio' : null
}

/** A source is a placeholder of SOME kind, which is the question most callers actually have. */
export const isPlaceholder = (sourcePath: string | undefined): boolean => placeholderKind(sourcePath) != null

/** The colour a blank is painted: the six hex digits in its path, or black. Nothing for a silence. */
export const placeholderFill = (sourcePath: string | undefined): string | null => {
  if (placeholderKind(sourcePath) !== 'video') return null
  const parts = (sourcePath as string).split(':')
  return normaliseFill(parts[3])
}

/** The same placeholder in another colour: the same kind and id, a new fill. */
export const withPlaceholderFill = (sourcePath: string, fill: string): string => {
  const parts = sourcePath.split(':')
  if (parts[1] !== 'video') return sourcePath
  return `${SCHEME}video:${parts[2]}:${normaliseFill(fill)}`
}

/** What a placeholder is CALLED, numbered among its own kind so a job can carry several. */
export const placeholderName = (kind: PlaceholderKind, ordinal: number): string =>
  `${kind === 'video' ? 'BLANK' : 'SILENCE'} ${ordinal}`

/**
 * What each placeholder in a run of sources is called, in the ORDER given, or nothing for a real file.
 *
 * The numbering runs across the whole run and counts each kind on its own, so the QUEUE card and the timeline
 * — one keying by position, the other by clip id — name the same blank the same way rather than one of them
 * showing a scheme where a file name would go.
 */
export const placeholderNamesInOrder = (sourcePaths: string[]): Array<string | null> => {
  const counts = { video: 0, audio: 0 }
  return sourcePaths.map((sourcePath) => {
    const kind = placeholderKind(sourcePath)
    if (!kind) return null
    counts[kind] += 1
    return placeholderName(kind, counts[kind])
  })
}
