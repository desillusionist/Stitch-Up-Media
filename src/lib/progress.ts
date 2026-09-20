/** Seconds from ffmpeg's `HH:MM:SS.ss` timemark, or null when it is not a time yet. */
export const timemarkSeconds = (timemark: string | undefined): number | null => {
  if (!timemark) return null
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(timemark.trim())
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

/**
 * How far through the output ffmpeg has reached.
 *
 * fluent-ffmpeg's own `percent` is documented as "may not be available depending on
 * input", and for a concat or a mix of several inputs it never arrives: the progress bar
 * then sat empty for the whole encode while the timemark advanced, which is exactly what
 * the queue's cards were doing. The position ffmpeg reports, measured against the length
 * the job will actually have, is always available and is the same figure the timeline
 * shows.
 */
export const progressPercent = (input: { timemark?: string; expectedSeconds: number; fallback?: number }): number => {
  const reached = timemarkSeconds(input.timemark)
  if (reached != null && input.expectedSeconds > 0) {
    return Math.max(0, Math.min(100, Math.round((reached / input.expectedSeconds) * 100)))
  }
  const fallback = input.fallback
  if (fallback != null && Number.isFinite(fallback)) return Math.max(0, Math.min(100, Math.round(fallback)))
  return 0
}
