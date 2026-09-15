export type MediaKind = 'audio' | 'image' | 'video'

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp']

/**
 * Classifies a path by extension. Extracted from the queue so the EDIT JOB
 * window classifies sources identically when choosing a preview target.
 */
export const mediaKind = (filePath: string): MediaKind => {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  return 'video'
}
