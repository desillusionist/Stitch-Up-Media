import React, { useRef, useState } from 'react'

/**
 * A number field that can be emptied, and whose figure follows the wheel.
 *
 * A field bound straight to a number cannot be cleared, and that is not a nicety: deleting the last
 * digit leaves an empty string, the handler turns that into whatever an empty string means to it — a
 * zero, or nothing at all — and the number that comes back fills the box again. So the last digit
 * can never be got rid of in order to type a new value, which is the whole reason anyone selects a
 * field's contents and presses delete.
 *
 * This holds the TEXT while the field is being typed in, so what it shows is exactly what was typed,
 * including nothing, and hands a number over only when there really is one. Leaving the field drops
 * the text, so the field falls back to the value as it stands and can never keep a half-typed figure
 * on screen after the user has moved on.
 *
 * Neither the bounds nor the step are enforced on what is TYPED: an out-of-range figure is handed over
 * as typed and the caller decides what to do with it, because the callers disagree about that —
 * clamping a crop edge, refusing a zero frame, or lifting an override altogether. `onClear` exists for
 * the last of those, where a blank field is a meaning rather than a mistake. They ARE enforced on the
 * wheel and the arrow keys, which are gestures about a figure rather than about the text in it.
 *
 * The text gives way to a value that arrives from somewhere else — an undo, or a drag of the crop box
 * on the preview — because otherwise a field being typed in would go on showing what was typed while
 * the value underneath it had already been changed by something the user could not see. A figure the
 * field's own entry produced keeps the text, including one the caller clamped: typing the third digit
 * of a number that the caller then reduces must not wipe the digits still under the caret.
 *
 * THE WHEEL MOVES THE FIGURE, WHEREVER THE POINTER IS IN THE BOX AND WHATEVER HAS FOCUS. A number
 * input's own wheel-stepper only answers while the field is focused, so a reader wheeling over a list
 * of settings either scrolled the list out from under the figure or — with focus in the field — crept
 * the figure while the list refused to move. Neither is what a wheel over a value means here, so the
 * wheel is read directly: one notch is one step, the step is the field's own, and the bounds are held.
 * The event is cancelled, so the box the field sits in does not scroll out from under it.
 */

/**
 * How many pixels this platform reports for one notch of a wheel, which is NOT a hundred.
 *
 * A hundred is the figure the wider web quotes and the one this used to divide by, and it is the whole
 * reason a wheel over a value field did nothing while the same wheel scrolled the drawer: no ordinary
 * notch arrives as a hundred pixels here. The timeline's own scrub and zoom easings ease against
 * `|deltaY|` directly — see `scrubByWheel` and `zoomedBy` — so a deliberate notch is a handful of
 * pixels on this platform, and this is the handful. A line or a page (deltaMode 1 or 2) is a notch as
 * it stands and is not divided at all.
 */
const WHEEL_NOTCH_PIXELS = 3
export const NumberField: React.FC<{
  /** The figure as it stands, or nothing at all where a blank field means something. */
  value: number | undefined
  /** Called with each entry that is a number. A blank entry calls nothing. */
  onValue: (value: number) => void
  /** Called when the field is left blank, for a caller where blank is a meaning. */
  onClear?: () => void
  /** The bounds the wheel and the arrow keys stop at, not a rule about what may be typed. */
  min?: number
  max?: number
  /** How far one notch or one arrow key moves the figure. Absent is one. */
  step?: number
  /**
   * How the figure is WRITTEN when it is not being typed into, for a field whose figure is not a number
   * a reader would type — a length the window shows as a timecode, say.
   *
   * A formatted field is a text input rather than a number one, because a spinner cannot show
   * `00:00:12.00` and would offer to step a figure that is not on screen. The wheel and the arrow keys
   * still work: they move the VALUE by `step` and the field writes the new figure back out.
   */
  format?: (value: number) => string
  /** The figure a typed entry means, or nothing where it is not a figure yet. Required with `format`. */
  parse?: (text: string) => number | null
  className?: string
  title?: string
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}> = ({ value, onValue, onClear, min, max, step, format, parse, className, title, placeholder, disabled, ariaLabel }) => {
  const [text, setText] = useState<string | null>(null)
  const [seen, setSeen] = useState(value)
  /** Whether the last change to the value was this field's own entry, which has yet to be seen here. */
  const ownEntry = useRef(false)
  /**
   * How much of a trackpad's pixel stream has not yet added up to a step.
   *
   * A mouse notch arrives as one line and is one step; a trackpad sends a stream of small pixel deltas,
   * and stepping on each of them would race the figure through a dozen values in one flick. The
   * remainder is carried, so a slow drag moves the figure one step at a time and a fast one moves it
   * faster without skipping the intermediate figures entirely.
   */
  const wheelRemainder = useRef(0)
  if (seen !== value) {
    setSeen(value)
    // An entry of this field's own keeps its text, whatever the caller made of the figure; anything
    // else is a change from outside, and the text being typed cannot outlive the value it was
    // typing into.
    if (!ownEntry.current) setText(null)
    ownEntry.current = false
  }
  const shown = text ?? (value === undefined ? '' : format ? format(value) : String(value))

  /**
   * The figure moved by whole steps, held to the bounds.
   *
   * Rounded by SIGNIFICANT FIGURES rather than by decimal places, so that 1.1 - 0.2 is 0.9 and not
   * 0.9000000000000001 while the EQ's own step of a ten-millionth survives: a figure that cannot be
   * compared exactly is a figure the "no change" check below cannot see, and rounding to fixed
   * decimals would swallow the small steps outright.
   */
  const stepBy = (direction: 1 | -1, times = 1) => {
    const current = typeof value === 'number' && Number.isFinite(value) ? value : 0
    const by = typeof step === 'number' && Number.isFinite(step) && step > 0 ? step : 1
    let next = current + direction * by * times
    if (typeof min === 'number') next = Math.max(min, next)
    if (typeof max === 'number') next = Math.min(max, next)
    next = Number(next.toPrecision(12))
    // A gesture at a bound is not a change, and handing one over would put a step on the undo stack
    // that undoes nothing.
    if (next !== current) { setText(null); ownEntry.current = false; onValue(next) }
  }

  /**
   * The wheel, bound by hand rather than through React, so that it can be cancelled.
   *
   * React's own listener may be registered passively, and a passive listener's `preventDefault` is a
   * no-op with a warning — which would leave the box scrolling on the very gesture this is for. A
   * native listener with `passive: false` is the only way to be sure of it. The ref is a fresh arrow
   * on every render, so React detaches and reattaches it each time, which is what keeps the handler
   * closing over the CURRENT step, bounds and figure rather than the ones from its first render.
   */
  const unbound = useRef<(() => void) | null>(null)
  const bindWheel = (element: HTMLInputElement | null) => {
    unbound.current?.()
    unbound.current = null
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (disabled) return
      event.preventDefault()
      // A line or a page of wheel is a notch as it stands; a pixel delta is divided by the handful of
      // pixels one notch actually is on this platform. The remainder is carried, so a slow drag still
      // steps one at a time and a fast flick moves faster without skipping the figures in between.
      const perNotch = event.deltaMode === 0 ? WHEEL_NOTCH_PIXELS : 1
      wheelRemainder.current += -event.deltaY / perNotch
      const steps = Math.trunc(wheelRemainder.current)
      if (steps === 0) return
      wheelRemainder.current -= steps
      stepBy(steps > 0 ? 1 : -1, 1)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    unbound.current = () => element.removeEventListener('wheel', onWheel)
  }

  return <input
    ref={bindWheel}
    type={format ? 'text' : 'number'}
    className={className}
    title={title}
    placeholder={placeholder}
    disabled={disabled}
    min={min}
    max={max}
    step={step}
    value={shown}
    aria-label={ariaLabel}
    onFocus={(event) => {
      // A FORMATTED field is replaced rather than appended to. Typing into `00:00:12.00` with the caret
      // at its start builds `500:00:12.00` on the first keystroke, which parses as five hours and sends
      // the figure somewhere the reader never asked for — the misbehaviour a timecode field was reported
      // with. Selecting what is there makes the first keystroke the new figure. It is deferred a tick
      // because the click that focused the field would otherwise place the caret again and drop the
      // selection; a plain number field is left alone, where appending a digit is what a reader means.
      if (!format) return
      const field = event.currentTarget
      window.setTimeout(() => field.select(), 0)
    }}
    onChange={(event) => {
      const raw = event.target.value
      setText(raw)
      const parsed = parse ? parse(raw) : (raw.trim() === '' ? null : Number(raw))
      if (parsed !== null && Number.isFinite(parsed)) { ownEntry.current = true; onValue(parsed) }
    }}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      // Read here rather than left to the platform's own stepper, so the bounds are a real stop and the
      // caret does not jump to the field's start or end instead of the figure moving.
      event.preventDefault()
      stepBy(event.key === 'ArrowUp' ? 1 : -1)
    }}
    onBlur={(event) => {
      const raw = event.target.value
      setText(null)
      if (raw.trim() === '') onClear?.()
    }}
  />
}
