import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The media types the app will accept from Finder.
 *
 * THIS IS THE SAME LIST `expand-media-paths` ACCEPTS, and it has to be: Finder puts the app in the
 * "Open With…" list for whatever is declared here, so declaring something the importer then refuses
 * would offer the reader a file the app answers with "NO COMPATIBLE MEDIA". `check-open-files.cjs`
 * compares the two, because they live in different files and would otherwise drift apart silently.
 */
export const OPEN_WITH_EXTENSIONS = [
  'mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm',
  'wav', 'mp3', 'aac', 'm4a', 'flac',
  'jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic',
] as const

const OPEN_WITH_EXTENSION_SET = new Set<string>(OPEN_WITH_EXTENSIONS)

const isFileOnDisk = (candidate: string) => {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

/**
 * What one handed-over entry names, as an absolute path, or null when it names nothing openable.
 *
 * `open-file` delivers a PATH, while a second launch's argv carries whatever Finder typed on the command
 * line — which for a media file is sometimes a `file://` URL. Both are accepted; a relative path, a flag,
 * a filesystem root, or the app's own path is not, or every launch would open the app bundle as a job.
 */
export const openFilePathOf = (entry: string): string | null => {
  if (typeof entry !== 'string' || entry.length === 0 || entry.includes('\0')) return null
  let candidate = entry
  if (candidate.startsWith('file://')) {
    try {
      candidate = fileURLToPath(candidate)
    } catch {
      return null
    }
  }
  return path.isAbsolute(candidate) && candidate !== path.parse(candidate).root ? candidate : null
}

/**
 * The media files among a launch's arguments, deduplicated, in the order they were handed over.
 *
 * The predicate is injectable so the filter can be exercised without files on disk.
 */
export const openFilePaths = (entries: string[], isFile: (candidate: string) => boolean = isFileOnDisk): string[] => {
  const files: string[] = []
  for (const entry of entries) {
    const candidate = openFilePathOf(entry)
    if (!candidate || files.includes(candidate)) continue
    if (!OPEN_WITH_EXTENSION_SET.has(path.extname(candidate).slice(1).toLowerCase())) continue
    if (!isFile(candidate)) continue
    files.push(candidate)
  }
  return files
}

export interface OpenFileBuffer {
  /** Adds what Finder handed over; answers with the files it had not already been holding. */
  push: (entries: string[]) => string[]
  /** Takes everything waiting, leaving the buffer empty. */
  drain: () => string[]
}

/**
 * Files waiting to be put in front of the reader.
 *
 * macOS can hand a file over DURING LAUNCH, before any window exists, and a file opened while the app
 * runs can arrive before the renderer has subscribed. Holding them here means neither is lost, and
 * DRAINING on the way out means a window that mounts again — a reload — cannot put a confirmation back
 * in front of the reader for files they already dealt with.
 */
export const createOpenFileBuffer = (isFile: (candidate: string) => boolean = isFileOnDisk): OpenFileBuffer => {
  let pending: string[] = []
  return {
    push: (entries) => {
      const fresh = openFilePaths(entries, isFile).filter((file) => !pending.includes(file))
      pending = [...pending, ...fresh]
      return fresh
    },
    drain: () => {
      const files = pending
      pending = []
      return files
    },
  }
}
