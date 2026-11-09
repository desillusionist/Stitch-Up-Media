import { EncodingPreset, QueueTask } from '../types'

/**
 * The suffix EVERY derived output name carries.
 *
 * One name per export, whatever the preset says: a file is named for what it IS — the source's own name and the one
 * thing this app did to it — rather than for the codec, bitrate and resolution of the moment. The old derived names
 * encoded all of that (`JapaneseFashionVloger_Audio_MP3_320k.mp4`), so changing a preset renamed the file, changing it
 * back renamed it again, and two exports of the same source were told apart by a suffix nobody chose. The MODE is no
 * longer in the name either (`_stitched`, `_combo`): the card says what the job is, and a name is the reader's.
 *
 * A name TYPED by hand is kept exactly as typed; only its extension follows the container.
 */
export const EXPORT_SUFFIX = '_export'

/**
 * Suffixes this app has produced, stripped so a name can be derived again rather than appended to.
 *
 * `_export` is the current one. The rest are what earlier versions wrote — the preset suffixes and the mode ones —
 * and they stay here so a job saved then re-derives to the same `X_export` a new one would, instead of carrying its
 * old tail forever. Nothing matches on these names any more; this is migration, not naming.
 */
const STRIPPED_SUFFIX_PATTERN = /(?:_export|_stitched|_combo|_(?:1080p_H264_VBR8M|4K_HEVC_VBR22|ProRes422HQ|720p_H264_VBR750k|Source_Remux|PNG_Sequence|JPG_Sequence|PNG|JPG|GIF_(?:Regular|Loop|Bounce)|Audio_[A-Za-z0-9_]+|Custom_[A-Za-z0-9_]+))(?:_[A-Za-z0-9_]+)*$/

type NameSource = Pick<QueueTask, 'outputFilename' | 'sourceBaseName' | 'outputFilenameManuallySet'>

export const withoutExtension = (filename: string) =>
  filename.substring(0, filename.lastIndexOf('.')) || filename

/** Swaps only the extension, leaving the rest of the name byte-for-byte intact. */
export const withExtension = (filename: string, container: string) => `${withoutExtension(filename)}.${container}`

export const stableBaseName = (task: NameSource) =>
  task.sourceBaseName || withoutExtension(task.outputFilename).replace(STRIPPED_SUFFIX_PATTERN, '')

/**
 * The one shape a derived name has: the source's base, the suffix, and the container's own extension.
 *
 * Every place that names a job calls this — the import, the preset picker, the container change, the split and the
 * merge — so "what an export is called" is decided once. The fallbacks in front of it (`'merged'`, `'output'`) are
 * only for a job with no source at all.
 */
export const exportName = (base: string, container: string) => `${base}${EXPORT_SUFFIX}.${container}`

/**
 * Single source of truth for output naming, shared by the queue's preset picker
 * and the EDIT JOB window so both produce byte-identical filenames.
 *
 * `base_export.<container>`, always. A manually renamed output keeps its name and only tracks the container change.
 */
export const deriveOutputFilename = (
  task: NameSource,
  preset: EncodingPreset,
  container: string = preset.container,
) =>
  task.outputFilenameManuallySet
    ? `${withoutExtension(task.outputFilename)}.${container}`
    : exportName(stableBaseName(task), container)
