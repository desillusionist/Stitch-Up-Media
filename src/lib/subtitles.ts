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
  return tag ? tag.toLowerCase() : undefined
}

export const mediaBaseName = (filePath: string): string => (filePath.split('/').pop() || filePath).replace(/\.[^.]+$/, '')

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
  const base = mediaBaseName(sourcePath).toLowerCase()
  const matches = candidates.filter((candidate) => {
    if (!isSubtitlePath(candidate)) return false
    if (!candidate.startsWith(directory)) return false
    return subtitleBaseName(candidate).toLowerCase() === base
  })
  const rank = (filePath: string) => {
    const format = subtitleFormatOf(filePath) || 'srt'
    const byFormat = SUBTITLE_PRIORITY.indexOf(format)
    // A file named exactly for the clip wins over one with a language tag, and the tag itself orders the rest.
    const exact = subtitleBaseName(filePath).toLowerCase() === (filePath.split('/').pop() || '').replace(/\.[^.]+$/, '').toLowerCase() ? 0 : 1
    return exact * 10 + (byFormat < 0 ? 9 : byFormat)
  }
  return [...new Set(matches)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
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
    track.cues.forEach((cue, index) => {
      const onTimeline = placeCue(cue, window)
      if (onTimeline) placed.push({ ...onTimeline, sourcePath: window.sourcePath, index })
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
