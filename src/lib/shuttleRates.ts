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
 * The rungs a forward ACCELERATE lands on, which are the shuttle's own four.
 *
 * The step is the next rung ABOVE wherever the transport already is, not the bottom of the ladder, and that is
 * the whole of why L ramps from the speed the selector or the wheel set rather than jumping back to 1x.
 */
export const FORWARD_ACCELERATE_RUNGS = FORWARD_RATES

/**
 * The rate one tap of the forward key moves to: the next rung above the current one, topping out at the last.
 *
 * A current value that sits between rungs — a wheel at 1.5x — lands on the next rung above it (2x), so the
 * speed the wheel set is the base the climb starts from.
 */
export const nextForwardRung = (current: number): number => {
  const at = Number.isFinite(current) ? current : 0
  return FORWARD_ACCELERATE_RUNGS.find((rung) => rung > at) ?? FORWARD_ACCELERATE_RUNGS[FORWARD_ACCELERATE_RUNGS.length - 1]
}
