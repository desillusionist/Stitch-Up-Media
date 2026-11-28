/**
 * Subtitles: what one is, where it belongs, and what the export can do with it.
 *
 * THE ONE DECISION THAT SHAPES THE REST: a subtitle belongs to a SOURCE, not to a job. A STITCH of three clips can
 * carry three subtitle files, and a CUES list keyed by the job would have nowhere to say which clip a cue came from.
 * Keyed by source path, every reader — the card's icon, the CC lane, the encoder's own map — asks the same question
 * and gets the same answer.
 *
 * The cues are held as PARSED TEXT rather than as a reference to the file: the editor has to show and change them, and
 * a caption whose words only exist on disk is a caption the editor cannot edit. The file is still the record of where
 * it came from, and the path is still what the card reveals in Finder.
 */

/** The formats read and written. SRT and VTT are the two this app edits; the others are read and converted. */
export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa'

export const SUBTITLE_EXTENSIONS: SubtitleFormat[] = ['srt', 'vtt', 'ass', 'ssa']

/** The order formats are preferred in when a clip has several candidates beside it: SRT first, as asked for. */
export const SUBTITLE_PRIORITY: SubtitleFormat[] = ['srt', 'vtt', 'ass', 'ssa']

/** Whether a path names a subtitle rather than media — the test the import uses before adding it as a source. */
export const subtitleFormatOf = (filePath: string): SubtitleFormat | null => {
  const extension = (filePath.split('.').pop() || '').toLowerCase()
  return (SUBTITLE_EXTENSIONS as string[]).includes(extension) ? (extension as SubtitleFormat) : null
}

export const isSubtitlePath = (filePath: string): boolean => subtitleFormatOf(filePath) !== null

/** `film.mp4` → `film`, and `film.en.srt` → `film` too: a language tag is not part of the name it belongs to. */
export const subtitleBaseName = (filePath: string): string => {
  const name = filePath.split('/').pop() || filePath
  const withoutExtension = name.replace(/\.[^.]+$/, '')
  return withoutExtension.replace(/\.[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/i, '')
}

/** The language a subtitle's name carries (`film.en.srt` → `en`), which is what a muxer stamps on its stream. */
export const languageOfSubtitle = (filePath: string): string | undefined => {
  const name = (filePath.split('/').pop() || '').replace(/\.[^.]+$/, '')
  const tag = /\.[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/i.exec(name)?.[0]?.slice(1)
  // The PRIMARY subtag, because a stream's language is a language rather than a locale: `en-en` and `pt-BR` are how
  // yt-dlp names YouTube's translated tracks, and `en-en` is not a tag any player reads as English.
  return tag ? tag.split(/[-_]/)[0].toLowerCase() : undefined
}

export const mediaBaseName = (filePath: string): string => (filePath.split('/').pop() || filePath).replace(/\.[^.]+$/, '')

/**
 * A media base with THIS APP'S OWN additions taken off: `Me at the zoo [640x360]` → `Me at the zoo`, and
 * `Me at the zoo [1920x1080] (2)` → `Me at the zoo`.
 *
 * A download is renamed for the specs it turned out to have, and a re-download of the same specs gets a copy
 * number. Both are things this app adds to a name, so both are things a reader's subtitle — `Me at the zoo.en.srt`,
 * which yt-dlp wrote before the rename — must be allowed to ignore. Measured: without this, a download with
 * captions attached none at all, because `Title [640x360].mp4` and `Title.en.srt` share no base name.
 *
 * The bracket must hold a SPEC rather than any word, so a film really called `Holiday [2019].mp4` does not take
 * `Holiday.srt` from a different film beside it.
 */
const withoutSpecSuffix = (base: string): string => base
  .replace(/\s\(\d+\)$/, '')
  .replace(/\s\[\d+x\d+\]$/i, '')
  .replace(/\s\[\d+kHz(?:\s[\d.]+k)?\]$/i, '')

/** The base name a subtitle is matched against, from either side of the pair and in one spelling. */
const matchBase = (base: string): string => withoutSpecSuffix(base).toLowerCase()

/**
 * The subtitle files that belong to a media file, best first.
 *
 * "Same name in the same folder" is the rule a reader already expects from every player: `film.mp4` takes `film.srt`,
 * and `film.en.srt` counts as the same name with a language tag. The folder must match exactly — a subtitle in
 * another directory belongs to another copy of the film. SRT wins over the others because that is what a reader is
 * most likely to have meant, and because it is the format this app edits without conversion.
 */
export const subtitlesForSource = (sourcePath: string, candidates: string[]): string[] => {
  const directory = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1)
  const base = matchBase(mediaBaseName(sourcePath))
  const matches = candidates.filter((candidate) => {
    if (!isSubtitlePath(candidate)) return false
    if (!candidate.startsWith(directory)) return false
    return matchBase(subtitleBaseName(candidate)) === base
  })
  const rank = (filePath: string) => {
    const format = subtitleFormatOf(filePath) || 'srt'
    const byFormat = SUBTITLE_PRIORITY.indexOf(format)
    // A file named exactly for the clip wins over one with a language tag, and the tag itself orders the rest.
    const exact = subtitleBaseName(filePath).toLowerCase() === (filePath.split('/').pop() || '').replace(/\.[^.]+$/, '').toLowerCase() ? 0 : 1
    // A COMPOUND tag is a translation rather than the track the video speaks. `en` is the original auto-generating
    // English track; `en-en` ("English from English") and `en-de` ("English from German") are YouTube's own
    // translations, and the original is what a reader means when both arrive beside one download. Read off the
    // NAME rather than off `languageOfSubtitle`, which answers a stream's primary subtag and so cannot tell them apart.
    const rawName = (filePath.split('/').pop() || '').replace(/\.[^.]+$/, '')
    const compound = /\.[a-z]{2,3}[-_][A-Za-z]{2,4}$/i.test(rawName) ? 1 : 0
    return exact * 100 + (byFormat < 0 ? 9 : byFormat) * 10 + compound
  }
  return [...new Set(matches)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/**
 * The subtitle files that have to FOLLOW a media file when it is renamed, as `from`/`to` pairs.
 *
 * Renaming a media file without its sidecars is not a cosmetic change: a subtitle is found by its name, by this
 * app and by every player, so `Title.en.srt` stops belonging to `Title [1920x1080].mp4` the moment the video
 * is renamed. The pairs are worked out here rather than where the rename happens because the rule is about
 * SUBTITLE NAMES, and it is the same rule `subtitlesForSource` matches them with.
 *
 * Only files that begin with the old base and a dot are moved, so a second copy's sidecar (`Title 2.srt`) and an
 * unrelated film's (`Holiday.srt`) are left exactly where they are. The caller owns the filesystem: an existing
 * destination is not overwritten here.
 */
export const subtitleSidecarsFor = (oldMedia: string, newMedia: string, candidates: string[]): Array<{ from: string; to: string }> => {
  const oldSlash = oldMedia.lastIndexOf('/')
  const newSlash = newMedia.lastIndexOf('/')
  const directory = oldMedia.slice(0, oldSlash + 1)
  // A rename that crosses directories is not this rule's business.
  if (!directory || directory !== newMedia.slice(0, newSlash + 1)) return []
  const oldBase = mediaBaseName(oldMedia)
  const newBase = mediaBaseName(newMedia)
  if (!oldBase || !newBase || oldBase === newBase) return []
  return candidates.flatMap((candidate) => {
    if (!isSubtitlePath(candidate) || !candidate.startsWith(directory)) return []
    const name = candidate.slice(directory.length)
    // `.` and not any prefix: `Title 2.en.srt` is another copy's subtitle, not this one's.
    if (!name.startsWith(`${oldBase}.`)) return []
    return [{ from: candidate, to: `${directory}${newBase}${name.slice(oldBase.length)}` }]
  })
}

/** One caption. Times are SECONDS, the same unit the timeline and the monitor work in. */
export interface SubtitleCue {
  start: number
  end: number
  text: string
}

/** A subtitle attached to a source, and the file it came from. */
export interface SubtitleTrack {
  path: string
  format: SubtitleFormat
  /** The prober's own language tag when the file has one (`en`, `de`), which is what a muxer writes into the stream. */
  language?: string
  cues: SubtitleCue[]
}

/** `00:01:02,500` (SRT) or `00:01:02.500` (VTT) as seconds. Nonsense reads as zero rather than as NaN. */
export const parseSubtitleTime = (value: string): number => {
  const match = /(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(value.trim())
  if (!match) return 0
  const [, hours, minutes, seconds, fraction] = match
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(fraction.padEnd(3, '0')) / 1000
}

/** Seconds as `00:01:02,500` — SRT's spelling, which VTT also reads and this app writes. */
export const formatSubtitleTime = (seconds: number): string => {
  const total = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const whole = Math.floor(rest)
  const millis = Math.round((rest - whole) * 1000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

/**
 * SRT or WebVTT as cues.
 *
 * One reader for both, because the two differ only in their separator (`,` in SRT, `.` in VTT), whether a block is
 * numbered, and a `WEBVTT` header. Anything that is neither a time line nor a header is the cue's text, which is what
 * keeps a caption's own line breaks intact — the one thing a naive splitter loses.
 */
export const parseSubtitles = (text: string, format: SubtitleFormat): SubtitleCue[] => {
  // ASS/SSA is a different shape entirely: `Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Text`.
  if (format === 'ass' || format === 'ssa') {
    return text.split('\n')
      // NINE fields before the text — layer, start, end, style, name, three margins and effect — and the text after them,
      // which may contain commas of its own. Counting fields is what keeps a leading comma out of the caption, which is
      // what the first attempt did.
      .map((line) => /^Dialogue:\s*([^,]*),([^,]+),([^,]+),(?:[^,]*,){6}(.*)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => ({
        // Group 1 is the LAYER: the times are the second and third fields, not the first two.
        start: parseSubtitleTime(match[2]),
        end: parseSubtitleTime(match[3]),
        text: match[4].replace(/\\N/gi, '\n').replace(/\{[^}]*\}/g, '').trim(),
      }))
  }
  const cues: SubtitleCue[] = []
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0 && line.trim() !== 'WEBVTT')
    if (!lines.length) continue
    const timeIndex = lines.findIndex((line) => line.includes('-->'))
    if (timeIndex < 0) continue
    const [from, to] = lines[timeIndex].split('-->')
    const cue: SubtitleCue = {
      start: parseSubtitleTime(from),
      end: parseSubtitleTime(to),
      text: lines.slice(timeIndex + 1).join('\n').trim(),
    }
    if (cue.end < cue.start) cue.end = cue.start
    cues.push(cue)
  }
  return cues.sort((a, b) => a.start - b.start)
}

/** Cues as SRT — the format this app writes, because every player and every muxer reads it. */
export const toSrt = (cues: SubtitleCue[]): string =>
  [...cues]
    .sort((a, b) => a.start - b.start)
    .map((cue, index) => `${index + 1}\n${formatSubtitleTime(cue.start)} --> ${formatSubtitleTime(cue.end)}\n${cue.text.trim()}\n`)
    .join('\n')

/** A cue with both times inside the file and one after the other. The editor's own rule, in one place. */
export const normaliseCue = (cue: SubtitleCue, duration: number): SubtitleCue => {
  const limit = Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER
  const start = Math.max(0, Math.min(limit, Number.isFinite(cue.start) ? cue.start : 0))
  const end = Math.max(start, Math.min(limit, Number.isFinite(cue.end) ? cue.end : start))
  return { start, end, text: cue.text }
}

/** The cue showing at an instant, which is what the monitor burns while the playhead is there. */
export const cueAt = (cues: SubtitleCue[], seconds: number): SubtitleCue | null =>
  cues.find((cue) => seconds >= cue.start && seconds <= cue.end) ?? null

/**
 * What a typed figure in a caption's own time field means, or nothing where it is not a time at all.
 *
 * `parseSubtitleTime` answers zero for nonsense, which is right when reading a file — a malformed line should
 * not take the whole read down — and wrong for a field: a typo there would move the caption to the start of
 * the film. So this refuses what it cannot read, and the field then keeps the figure it had. A bare number is
 * SECONDS, because that is the shortest way to nudge a caption and the one every good subtitle editor takes.
 */
export const readSubtitleTime = (value: string): number | null => {
  const text = value.trim()
  if (!text) return null
  const bare = Number(text)
  if (Number.isFinite(bare)) return Math.max(0, bare)
  return /(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.test(text) ? parseSubtitleTime(text) : null
}

/** A cue with one edge moved. The other edge holds, and the cue cannot be turned inside out. */
export const moveCueEdge = (cue: SubtitleCue, edge: 'start' | 'end', seconds: number, duration: number): SubtitleCue =>
  normaliseCue(
    edge === 'start'
      ? { ...cue, start: Math.min(seconds, cue.end) }
      : { ...cue, end: Math.max(seconds, cue.start) },
    duration,
  )

/** A cue moved along its lane: both edges shift, its length holds, and it stays inside the file. */
export const shiftCue = (cue: SubtitleCue, delta: number, duration: number): SubtitleCue => {
  const limit = Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER
  const length = Math.max(0, cue.end - cue.start)
  const start = Math.max(0, Math.min(Math.max(0, limit - length), cue.start + (Number.isFinite(delta) ? delta : 0)))
  return { start, end: start + length, text: cue.text }
}

/**
 * How a caption looks in the MONITOR.
 *
 * Held on the job rather than in the app's settings because it is a decision about what is being edited, and
 * because a burn-in would use the same record one day. It is NOT written into the file: the export is a soft
 * subtitle stream, so its type and colour belong to the player. The editor says so where the controls are.
 *
 * The size is a PERCENTAGE of the picture's height rather than a pixel count, so a caption keeps its place and
 * its proportion when the preview is zoomed and when the same job is watched in a different window — a fixed
 * number of pixels would grow against a zoomed-out picture and shrink against a zoomed-in one.
 */
export interface CaptionStyle {
  font: 'sans' | 'serif' | 'mono' | 'crt'
  /** Per cent of the picture's height. */
  size: number
  color: 'white' | 'amber' | 'green' | 'cyan'
  /** Whether the words sit on a dark box rather than straight on the picture. */
  background: boolean
  bold: boolean
  /** Which edge of the words sits on the X figure: their left, their middle, or their right. */
  align: 'left' | 'center' | 'right'
  /** Where that edge sits across the picture, in per cent. */
  x: number
  /** Where the BOTTOM of the words sits down the picture, in per cent: 100 is the bottom edge. */
  y: number
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = { font: 'sans', size: 6, color: 'white', background: true, bold: false, align: 'center', x: 50, y: 92 }

/** The fonts offered, as the stacks the monitor draws with. A choice is a name, not a font file. */
export const CAPTION_FONTS: Array<{ value: CaptionStyle['font']; label: string; stack: string }> = [
  { value: 'sans', label: 'SANS', stack: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif' },
  { value: 'serif', label: 'SERIF', stack: 'Georgia, "Times New Roman", serif' },
  { value: 'mono', label: 'MONO', stack: '"SF Mono", Menlo, Consolas, monospace' },
  { value: 'crt', label: 'TERMINAL', stack: '"Doto", monospace' },
]

/** The colours offered, in the app's own palette so the monitor cannot pick a shade the rest of it never uses. */
export const CAPTION_COLORS: Array<{ value: CaptionStyle['color']; label: string; css: string }> = [
  { value: 'white', label: 'WHITE', css: '#ffffff' },
  { value: 'amber', label: 'AMBER', css: '#ffb84d' },
  { value: 'green', label: 'GREEN', css: '#7dff75' },
  { value: 'cyan', label: 'CYAN', css: '#63e6e2' },
]

/** The size held to what the monitor can read: below two per cent is a smudge, above twenty is a headline. */
export const clampCaptionSize = (value: number): number =>
  Math.max(2, Math.min(20, Number.isFinite(value) ? value : DEFAULT_CAPTION_STYLE.size))

/** An X or Y held inside the picture, in per cent. */
export const clampCaptionPosition = (value: number, fallback: number): number =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : fallback))

/** A font choice's stack, falling back to sans for a record that names one this build no longer offers. */
export const captionFontStack = (font: CaptionStyle['font']): string =>
  (CAPTION_FONTS.find((choice) => choice.value === font) ?? CAPTION_FONTS[0]).stack

/** A colour choice's CSS value, falling back to white for the same reason. */
export const captionColorValue = (color: CaptionStyle['color']): string =>
  (CAPTION_COLORS.find((choice) => choice.value === color) ?? CAPTION_COLORS[0]).css

/**
 * A caption style as an ASS STYLE LINE, for a DRAWN-in caption.
 *
 * The monitor draws captions in CSS; the encoder draws them with libass, and the two do not share a units system.
 * libass lays a caption out on a 384×288 script, so a size that is a percentage of the picture is that percentage of
 * 288 here — six per cent is FontSize 17, which renders at six per cent of the frame's height. The colours are ASS's
 * `&HAABBGGRR` (blue and red the way round the name says), and the box behind the words is `BorderStyle=4` with a
 * half-transparent black back colour, which is the closest thing libass has to the monitor's own box.
 *
 * X, Y and the alignment are NOT here: they differ per cue (the same style at a different place), and libass places
 * a line with an override tag — see `toAss`.
 */
export const burnInStyle = (style: CaptionStyle): string => {
  const colours: Record<CaptionStyle['color'], string> = {
    white: '&H00FFFFFF&',
    amber: '&H004DB8FF&',
    green: '&H0075FF7D&',
    cyan: '&H00E2E663&',
  }
  // libass resolves these by NAME on this machine, and a name with a SPACE cannot be passed through a `-vf` string
  // without the option parser splitting it — so the sans face is Arial rather than Helvetica Neue, and every value
  // here is one word.
  const fonts: Record<CaptionStyle['font'], string> = { sans: 'Arial', serif: 'Georgia', mono: 'Menlo', crt: 'Menlo' }
  const size = Math.max(6, Math.round(288 * clampCaptionSize(style.size) / 100))
  return [
    'Default',
    fonts[style.font] ?? fonts.sans,
    String(size),
    colours[style.color] ?? colours.white,
    '&H000000FF&',
    '&H00000000&',
    style.background ? '&H80000000&' : '&HFF000000&',
    style.bold ? '-1' : '0', '0', '0', '0', '100', '100', '0', '0',
    style.background ? '4' : '1', '1', '0', '2', '0', '0', '0', '1',
  ].join(',')
}

/** Seconds as ASS's `H:MM:SS.cc`, which counts hundredths rather than milliseconds. */
const assTime = (seconds: number): string => {
  const total = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const whole = Math.floor(rest)
  const hundredths = Math.min(99, Math.round((rest - whole) * 100))
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`
}

/**
 * Cues as an ASS file, with each line PLACED by the style's own X/Y and alignment.
 *
 * A `force_style` string can carry the look but not a position: libass positions with margins, which cannot put a
 * centred line anywhere but the middle. An ASS EVENT can, with `\an` (which corner of the line is the anchor) and
 * `\pos` (where that anchor is). The script is 384×288 — the size libass's own SRT conversion uses — so the style's
 * figures read as the same shares of the picture the monitor draws them at. Braces and backslashes are escaped, or a
 * caption containing one would be read as an override tag.
 */
export const toAss = (cues: SubtitleCue[], style: CaptionStyle): string => {
  const x = clampCaptionPosition(style.x, DEFAULT_CAPTION_STYLE.x) * 3.84
  const y = clampCaptionPosition(style.y, DEFAULT_CAPTION_STYLE.y) * 2.88
  const an = style.align === 'left' ? 1 : style.align === 'right' ? 3 : 2
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 384',
    'PlayResY: 288',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${burnInStyle(style)}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  ;[...cues].sort((a, b) => a.start - b.start).forEach((cue) => {
    // Braces open an override block and a bare newline ends the event, so both are escaped the way Aegisub does.
    const text = cue.text.replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N')
    lines.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,{\\an${an}\\pos(${x.toFixed(0)},${y.toFixed(0)})}${text}`)
  })
  return lines.join('\n') + '\n'
}

/**
 * The video filter that draws a cue file into the picture.
 *
 * `subtitles` reads the file ITSELF, which is what makes burning possible without a second input: the encoder's
 * stream indices are the whole reason the soft stream is muxed in a second pass, and this filter steps around
 * them entirely. The path is this app's own temp file, whose name is a task id — no quotes, commas or colons to
 * escape.
 */
export const burnInFilter = (assPath: string): string => `subtitles=filename='${assPath}'`

/**
 * Where one clip sits on the assembled timeline, in the terms a cue has to be moved by.
 *
 * A cue's times are SOURCE seconds — they are the file's own, which is why a trim can cut a caption in half —
 * and the timeline's are its own. The two are related by the clip's window into its source and the rate it is
 * played at, which is `sourceUsedSeconds / duration` rather than the speed field: that ratio is what the
 * timeline and the encoder both folded the clip's speed AND its interpreted rate into, so a caption follows
 * a retimed clip by the same figure the picture does.
 */
export interface CueWindow {
  sourcePath: string
  /** Where the clip begins on the assembled timeline, in seconds. */
  start: number
  /** Where in the source it begins. */
  sourceIn: number
  /** How much of the source it keeps, in source seconds. Zero where the length is not known yet. */
  sourceUsedSeconds: number
  /** Its length on the timeline, in seconds. */
  duration: number
}

/** A cue as it falls on the assembled timeline, and which cue of which track it came from. */
export interface PlacedCue extends SubtitleCue {
  sourcePath: string
  /** Its place in its own track's list, which is what the editor's own selection is keyed by. */
  index: number
  /** Where the clip it was placed on begins on the timeline. */
  windowStart: number
  /** Where that clip's window opens in the source. */
  sourceIn: number
  /** SOURCE seconds per TIMELINE second — what turns a dragged edge's instant back into a cue's own time. */
  speed: number
}

/**
 * One cue moved onto the timeline, or nothing where the clip's window does not reach it.
 *
 * A caption that straddles the clip's in point is CUT rather than dropped: its words are still on screen for
 * the part of it that was kept, which is what a player does with a trimmed clip too. A caption wholly outside
 * the window belongs to footage this job does not use, so it is not drawn and not written.
 */
export const placeCue = (cue: SubtitleCue, window: CueWindow): SubtitleCue | null => {
  const kept = window.sourceUsedSeconds > 0 ? window.sourceUsedSeconds : Number.MAX_SAFE_INTEGER
  const rate = window.sourceUsedSeconds > 0 && window.duration > 0 ? window.sourceUsedSeconds / window.duration : 1
  const from = Math.max(cue.start, window.sourceIn)
  const to = Math.min(cue.end, window.sourceIn + kept)
  if (!(to > from) || rate <= 0) return null
  return {
    start: window.start + (from - window.sourceIn) / rate,
    end: window.start + (to - window.sourceIn) / rate,
    text: cue.text,
  }
}

/**
 * Every cue of every track, placed on the timeline the clips build.
 *
 * One function for the lane that draws them and the encoder that writes them, so what the editor shows is
 * what the file contains. A source that appears twice contributes its captions to both its places, because
 * the two clips really do show it twice; a clip the job does not use contributes nothing at all.
 */
export const cuesOnTimeline = (subtitles: Record<string, SubtitleTrack> | undefined, windows: CueWindow[]): PlacedCue[] => {
  if (!subtitles) return []
  const placed: PlacedCue[] = []
  windows.forEach((window) => {
    const track = subtitles[window.sourcePath]
    if (!track) return
    const speed = window.sourceUsedSeconds > 0 && window.duration > 0 ? window.sourceUsedSeconds / window.duration : 1
    track.cues.forEach((cue, index) => {
      const onTimeline = placeCue(cue, window)
      if (onTimeline) placed.push({ ...onTimeline, sourcePath: window.sourcePath, index, windowStart: window.start, sourceIn: window.sourceIn, speed })
    })
  })
  return placed.sort((a, b) => a.start - b.start || a.end - b.end)
}

/**
 * The subtitle codec a container takes, or null where it takes none.
 *
 * MEASURED BY MARKET, not by taste: mp4 and mov take `mov_text` (the only subtitle codec MP4 has ever had), mkv takes
 * `srt` as it is, and webm takes `webvtt`. An audio-only container takes none, and writing a claim it cannot keep is
 * worse than writing nothing — the log says which container refused.
 */
export const subtitleCodecFor = (container: string): 'mov_text' | 'srt' | 'webvtt' | null => {
  if (container === 'mp4' || container === 'mov' || container === 'm4a') return 'mov_text'
  if (container === 'mkv') return 'srt'
  if (container === 'webm') return 'webvtt'
  return null
}
