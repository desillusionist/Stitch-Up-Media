import { placeholderKind } from './placeholder'

export type MediaKind = 'audio' | 'image' | 'video'

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp']

/**
 * Classifies a path by extension. Extracted from the queue so the EDIT JOB
 * window classifies sources identically when choosing a preview target.
 *
 * A PLACEHOLDER has no extension to read, so its own scheme answers first: a silence is sound and a blank is
 * picture, and the whole app has to agree about that before anything downstream can treat them as clips.
 */
export const mediaKind = (filePath: string): MediaKind => {
  const placeholder = placeholderKind(filePath)
  if (placeholder) return placeholder
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  return 'video'
}
