import React, { useRef, useState } from 'react'

/**
 * A number field that can be emptied.
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
 * Neither the bounds nor the step are enforced here: an out-of-range figure is handed over as typed
 * and the caller decides what to do with it, because the callers disagree about that — clamping a
 * crop edge, refusing a zero frame, or lifting an override altogether. `onClear` exists for the last
 * of those, where a blank field is a meaning rather than a mistake.
 *
 * The text gives way to a value that arrives from somewhere else — an undo, or a drag of the crop box
 * on the preview — because otherwise a field being typed in would go on showing what was typed while
 * the value underneath it had already been changed by something the user could not see. A figure the
 * field's own entry produced keeps the text, including one the caller clamped: typing the third digit
 * of a number that the caller then reduces must not wipe the digits still under the caret.
 */
export const NumberField: React.FC<{
  /** The figure as it stands, or nothing at all where a blank field means something. */
  value: number | undefined
  /** Called with each entry that is a number. A blank entry calls nothing. */
  onValue: (value: number) => void
  /** Called when the field is left blank, for a caller where blank is a meaning. */
  onClear?: () => void
  min?: number
  max?: number
  step?: number
  className?: string
  title?: string
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}> = ({ value, onValue, onClear, min, max, step, className, title, placeholder, disabled, ariaLabel }) => {
  const [text, setText] = useState<string | null>(null)
  const [seen, setSeen] = useState(value)
  /** Whether the last change to the value was this field's own entry, which has yet to be seen here. */
  const ownEntry = useRef(false)
  if (seen !== value) {
    setSeen(value)
    // An entry of this field's own keeps its text, whatever the caller made of the figure; anything
    // else is a change from outside, and the text being typed cannot outlive the value it was
    // typing into.
    if (!ownEntry.current) setText(null)
    ownEntry.current = false
  }
  const shown = text ?? (value === undefined ? '' : String(value))
  return <input
    type="number"
    className={className}
    title={title}
    placeholder={placeholder}
    disabled={disabled}
    min={min}
    max={max}
    step={step}
    value={shown}
    aria-label={ariaLabel}
    onChange={(event) => {
      const raw = event.target.value
      setText(raw)
      const parsed = Number(raw)
      if (raw.trim() !== '' && Number.isFinite(parsed)) { ownEntry.current = true; onValue(parsed) }
    }}
    onBlur={(event) => {
      const raw = event.target.value
      setText(null)
      if (raw.trim() === '') onClear?.()
    }}
  />
}
