export interface ByteRange {
  start: number
  end: number
}

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/

/**
 * Resolves a single HTTP Range header against a known file size.
 *
 * Kept pure and separate from the stream plumbing so it can be tested directly.
 * Returns null when the request cannot be satisfied, which the caller turns into
 * a 416. Only single ranges are supported, which is all a media element sends.
 */
export const resolveByteRange = (header: string | null | undefined, size: number): ByteRange | null => {
  if (!header || size <= 0) return null
  const match = RANGE_PATTERN.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  if (rawStart === '') {
    // Suffix form: the final N bytes of the file.
    const suffixLength = Number(rawEnd)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null
  return { start, end }
}

const MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska',
  webm: 'video/webm', avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', aiff: 'audio/aiff',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp',
}

export const mimeTypeFor = (filePath: string): string => {
  const extension = filePath.split('.').pop()?.toLowerCase() || ''
  return MIME_TYPES[extension] || 'application/octet-stream'
}
