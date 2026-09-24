/**
 * The speeds the monitor can be previewed at.
 *
 * PREVIEW ONLY, and that distinction is the whole of this module: a speed here changes how fast the picture
 * is WATCHED, never how fast it is written. An export at an altered speed is a different render — `setpts` on
 * the picture and `atempo` on the sound, so the pitch survives — and nothing here reaches ffmpeg. This is the
 * monitor's playbackRate and nothing else's business.
 *
 * It is also independent of the J/K/L shuttle, which ramps on its own ladder: the shuttle says how fast the
 * transport is being driven right now, this says what speed the viewer wants to watch at, and the two
 * multiply. A speed of 0.5x with no shuttle is a half-speed preview; a shuttle of 2x at 1x is the ramp.
 */
export const PREVIEW_SPEEDS = [0.5, 1, 1.5, 2, 3] as const

export type PreviewSpeed = (typeof PREVIEW_SPEEDS)[number]

/** Ordinary speed, which is what the monitor opens at. */
export const DEFAULT_PREVIEW_SPEED: PreviewSpeed = 1

/** The slowest and fastest the element is asked for, so a multiplication of the two controls stays sane. */
export const MIN_PLAYBACK_RATE = 0.05
export const MAX_PLAYBACK_RATE = 16

/**
 * A speed held to the list the monitor offers.
 *
 * A stored or typed figure is not trusted: anything that is not one of the offered speeds is answered with
 * the ordinary one rather than handed to a media element as a rate it would refuse or clamp in its own way.
 */
export const clampPreviewSpeed = (value: unknown): PreviewSpeed => {
  const rate = typeof value === 'number' ? value : Number(value)
  return (PREVIEW_SPEEDS as readonly number[]).includes(rate) ? (rate as PreviewSpeed) : DEFAULT_PREVIEW_SPEED
}

/**
 * The rate a media element is asked for: the shuttle's own rate, times the speed being watched at.
 *
 * The two are separate controls and they compose, which is why this is one function rather than a figure
 * written in two places. Reverse has no native rate, so a reverse shuttle is the element's ordinary 1x with
 * the speed applied — the picture is stepped to paint reverse, and the speed is what changes how far each
 * step goes.
 */
export const playbackRateFor = (shuttleRate: number, speed: number): number => {
  const shuttle = shuttleRate > 0 ? Math.min(MAX_PLAYBACK_RATE, shuttleRate) : 1
  const watched = speed > 0 && Number.isFinite(speed) ? speed : DEFAULT_PREVIEW_SPEED
  return Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, shuttle * watched))
}

/** The label a speed is shown by: `1×`, `1.5×`, `0.5×`. */
export const speedLabel = (rate: number): string => `${rate}\u00d7`
