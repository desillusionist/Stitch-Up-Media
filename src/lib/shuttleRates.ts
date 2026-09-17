/** Shuttle ladders, following the J/K/L convention used by editing software. */
export const FORWARD_RATES = [1, 2, 4, 8]
/** Reverse is driven by seeks rather than the decoder, so it stops lower. */
export const BACKWARD_RATES = [-1, -2, -4]

/**
 * The next rate in the pressed direction.
 *
 * Pressing the same key again steps up its own ladder, which is what makes
 * repeated presses speed up. Pressing the opposite key starts that direction from
 * the bottom of its ladder rather than continuing the other one.
 *
 * Latching lives in the caller: because a released key does not reset the rate,
 * repeated presses actually reach the higher rungs.
 */
export const nextShuttleRate = (current: number, direction: 1 | -1): number => {
  const ladder = direction > 0 ? FORWARD_RATES : BACKWARD_RATES
  const index = ladder.indexOf(current)
  return index >= 0 ? ladder[Math.min(index + 1, ladder.length - 1)] : ladder[0]
}
