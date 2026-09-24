import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

/** One entry in an `EditorSelect`: the value that is stored, and what is written on it. */
export interface EditorSelectOption {
  value: string
  label: string
  disabled?: boolean
}

/**
 * The EDIT JOB window's own dropdown.
 *
 * The platform's `<select>` can be styled while it is CLOSED and not once it is opened: the list that drops
 * out of one is drawn by the operating system, so a themed border sits over a menu with the system's own
 * blue highlight and none of the window's type or colour. There is no CSS that reaches it — the closed state
 * is an element and the open state is not. So the list is drawn here instead: a button showing the current
 * value, and, on open, a listbox of buttons that the stylesheet owns end to end.
 *
 * It behaves like the control it replaces, which is the part that is easy to lose: arrow keys move the
 * active entry and Enter takes it, Home and End jump to the ends, Escape closes, the menu closes on a click
 * outside or on a scroll (a fixed panel would otherwise be left behind by the sidebar scrolling under it),
 * and the trigger keeps the focus throughout so the keyboard never lands on a menu item that disappears.
 * The list is ALWAYS in the DOM and merely hidden while closed, so its entries are reachable by name rather
 * than only by the sequence of keystrokes it takes to reveal them.
 */
export const EditorSelect: React.FC<{
  value: string
  options: EditorSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  title?: string
  ariaLabel?: string
  className?: string
}> = ({ value, options, onChange, disabled, title, ariaLabel, className }) => {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const baseId = useId().replace(/:/g, '')

  const selected = Math.max(0, options.findIndex((option) => option.value === value))
  const current = options.find((option) => option.value === value) ?? options[0]

  /**
   * Where the list goes, measured off the trigger when it opens.
   *
   * Fixed rather than absolute, because the sidebar scrolls and would clip a list hanging below its last
   * field. It opens downward when there is room and upward when there is not, using the trigger's own edges
   * so no measurement of the list is needed, and the height is capped to what is actually left of the window.
   */
  const position = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const margin = 8
    const below = window.innerHeight - rect.bottom
    const openUp = below < 180 && rect.top > 180
    setPlace({
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin)),
      width: rect.width,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 2 } : { top: rect.bottom + 2 }),
      maxHeight: Math.max(120, (openUp ? rect.top : below) - 10),
    })
  }, [])

  useLayoutEffect(() => { if (open) position() }, [open, position])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    // A fixed list does not follow the scrolling it was placed over, so it closes rather than drifting.
    const onMove = () => setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  const openMenu = () => {
    if (disabled) return
    setActive(selected)
    position()
    setOpen(true)
  }

  const commit = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  /** Steps the active entry, skipping any that are disabled, and wrapping at the ends. */
  const step = (delta: number) => {
    setActive((index) => {
      if (!options.length) return index
      let next = index
      for (let taken = 0; taken < options.length; taken++) {
        next = (next + delta + options.length) % options.length
        if (!options[next].disabled) break
      }
      return next
    })
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); step(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1) }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0) }
    else if (event.key === 'End') { event.preventDefault(); setActive(options.length - 1) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); commit(active) }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    else if (event.key === 'Tab') setOpen(false)
  }

  return <div className={`editor-select${className ? ` ${className}` : ''}`} ref={wrapRef}>
    <button
      type="button"
      ref={triggerRef}
      className="editor-select-trigger"
      data-value={value}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-activedescendant={open ? `${baseId}-${active}` : undefined}
      onClick={() => (open ? setOpen(false) : openMenu())}
      onKeyDown={onKeyDown}
    >
      <span className="editor-select-value">{current?.label ?? ''}</span>
      <span className="editor-select-caret" aria-hidden="true">v</span>
    </button>
    <div
      className="editor-select-menu"
      role="listbox"
      hidden={!open}
      style={place ?? undefined}
      aria-label={ariaLabel}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          id={`${baseId}-${index}`}
          role="option"
          className={`editor-select-option${index === active && open ? ' is-active' : ''}${option.value === value ? ' is-selected' : ''}`}
          data-value={option.value}
          disabled={option.disabled}
          aria-selected={option.value === value}
          onMouseEnter={() => setActive(index)}
          onClick={() => commit(index)}
        >{option.label}</button>
      ))}
    </div>
  </div>
}
