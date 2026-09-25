/** Shuttle ladders, following the J/K/L convention used by editing software. */
export const FORWARD_RATES = [1, 2, 4, 8]
/**
 * Reverse reaches 8x too, but it is driven by seeking rather than the decoder, so
 * above 4x the clock outruns the picture and frames are visibly skipped. That is
 * what a shuttle is expected to look like at the top of its ladder.
 */
export const BACKWARD_RATES = [-1, -2, -4, -8]

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

/**
 * The first rung a tap of the forward key reaches, which is not the ladder's own bottom.
 *
 * A tap of K is a request to watch FORWARD rather than to stop, and the ordinary speed is already one key
 * away (L, or PLAY itself), so the fast-forward is what it asks for: the second rung, not the first.
 */
export const TAP_FORWARD_RATE = FORWARD_RATES[1]

/**
 * The rate a tap of the forward key moves the transport to.
 *
 * From rest it lands on the second rung; already forwarding, it climbs the ladder the same way a repeat of
 * L does, so repeated taps speed up. A reverse rate is a tap away from forward, so it starts the climb
 * afresh rather than continuing a ladder it was not on.
 */
export const nextTapRate = (current: number): number =>
  current > 0 ? nextShuttleRate(current, 1) : TAP_FORWARD_RATE
