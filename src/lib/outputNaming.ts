import { EncodingPreset, QueueTask } from '../types'

/**
 * Suffixes emitted by the built-in presets and the custom preset editor.
 * Stripping them recovers the user's original base name, which is what makes
 * re-deriving a filename after a preset change idempotent rather than additive.
 */
const PRESET_SUFFIX_PATTERN = /_(?:1080p_H264_VBR8M|4K_HEVC_VBR22|ProRes422HQ|720p_H264_VBR750k|Source_Remux|PNG_Sequence|JPG_Sequence|PNG|JPG|GIF_(?:Regular|Loop|Bounce)|Audio_[A-Za-z0-9_]+|Custom_[A-Za-z0-9_]+)(?:_[A-Za-z0-9_]+)*$/

type NameSource = Pick<QueueTask, 'outputFilename' | 'sourceBaseName' | 'outputFilenameManuallySet'>

export const withoutExtension = (filename: string) =>
  filename.substring(0, filename.lastIndexOf('.')) || filename

/** Swaps only the extension, leaving the rest of the name byte-for-byte intact. */
export const withExtension = (filename: string, container: string) => `${withoutExtension(filename)}.${container}`

export const stableBaseName = (task: NameSource) =>
  task.sourceBaseName || withoutExtension(task.outputFilename).replace(PRESET_SUFFIX_PATTERN, '')

/**
 * Single source of truth for output naming, shared by the queue's preset picker
 * and the EDIT JOB window so both produce byte-identical filenames.
 *
 * A manually renamed output keeps its name and only tracks the container change;
 * otherwise the preset suffix is re-derived from the stable base name.
 */
export const deriveOutputFilename = (
  task: NameSource,
  preset: EncodingPreset,
  container: string = preset.container,
) =>
  task.outputFilenameManuallySet
    ? `${withoutExtension(task.outputFilename)}.${container}`
    : `${stableBaseName(task)}_${preset.suffix || preset.id}.${container}`
