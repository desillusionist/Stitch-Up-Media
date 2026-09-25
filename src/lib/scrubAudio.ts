/**
 * How a scrub drives the sound.
 *
 * The sound is driven by RATE, not by seeking it on every tick of the wheel. Seeking an audio element per tick
 * is a seek-thrash: the decoder is torn down and restarted faster than it can start, so a scrub over a still or
 * the black tail produced a jog rather than a sound. Setting `playbackRate` and letting `currentTime` advance
 * naturally has no such seam — the element simply plays faster or slower — and a rate that tracks the wheel's
 * own speed is what makes the sound speed up and slow down WITH the scroll rather than with a fixed figure.
 *
 * The element cannot play backwards (there is no negative `playbackRate`), so a backward scrub keeps the
 * magnitude and lets the playhead correct with an occasional seek; it stays AUDIBLE, which is the point, and
 * never falls silent.
 */

/** The slowest and fastest the sound is driven to, so a very slow drag does not stop and a flick does not scream. */
export const SCRUB_RATE_MIN = 0.5
export const SCRUB_RATE_MAX = 8

/**
 * How much of a new wheel velocity is taken each tick.
 *
 * A raw per-tick velocity is spiky — wheel events arrive at uneven intervals, and two in the same millisecond
 * make an enormous figure — so the rate is a running average that moves TOWARDS the reading rather than
 * snapping to it. It still reaches the reading within a few ticks, so a flick is heard as a flick.
 */
export const SCRUB_RATE_SMOOTHING = 0.75

/** How far past the last rate a reading must be to count as movement at all. */
const NEGLIGIBLE_VELOCITY = 0.0

/**
 * The rate to drive the sound at, given the wheel's velocity and the rate already running.
 *
 * Velocity is in timeline-seconds per wall-second, so `1` is the sound's own speed: a wheel moving one second
 * of timeline per second plays at exactly 1x, a flick of five seconds per second plays at 5x. Only the
 * MAGNITUDE is used — a backward drag plays forward at the same magnitude, because that is all a media
 * element can do — and a reading of nothing leaves the last rate in place rather than decaying the sound to a
 * stop while the reader's hand is still on the wheel.
 */
export const scrubRateFor = (velocity: number, previous: number): number => {
  const magnitude = Math.abs(velocity)
  if (!Number.isFinite(magnitude) || magnitude <= NEGLIGIBLE_VELOCITY) return previous
  const smoothed = previous + (magnitude - previous) * SCRUB_RATE_SMOOTHING
  return Math.max(SCRUB_RATE_MIN, Math.min(SCRUB_RATE_MAX, smoothed))
}
