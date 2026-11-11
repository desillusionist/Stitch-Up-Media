import React, { useEffect, useRef, useState } from 'react'

/** Which jobs a press on START QUEUE starts. */
export type StartScope = 'ready' | 'selected'

interface HeaderProps {
  isQueueRunning: boolean
  /**
   * Start or pause the queue. The scope is which jobs the press covers — every job marked READY, or only the ones
   * the reader has selected — and a pause ignores it.
   */
  onToggleQueue: (scope?: StartScope) => void
  onAddFiles?: () => void
  onOpenStitcher?: () => void
  onOpenMultiTrack?: () => void
  onOpenSettings?: () => void
  onClearDone?: () => void
  taskCount: number
  canStartQueue?: boolean
}

// The five handlers above are kept in the interface (the window passes them) though this bar draws none of them: the
// ADD MEDIA and SETTINGS controls moved to the command bar, and nothing here needs a second copy of either.

/**
 * The window's title bar, with START QUEUE and the scope it starts with.
 *
 * THE SCOPE IS A CHOICE, NOT A MODE: the button starts the queue at whatever was last chosen, and the caret opens
 * the two answers beside it. That keeps one press doing the obvious thing — a queue of jobs marked READY — while
 * making "only these three" a single extra click rather than a hidden state. The choice is remembered for the
 * session, because a reader working through a batch makes it once.
 */
export const Header: React.FC<HeaderProps> = ({ isQueueRunning, onToggleQueue, taskCount, canStartQueue }) => {
  const [scope, setScope] = useState<StartScope>('ready')
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  // THE MENU CHOOSES; IT DOES NOT START. A selector that fired the queue as a side effect of being read would
  // start jobs the reader was only telling it about — the press belongs to START QUEUE.
  const choose = (next: StartScope) => {
    setScope(next)
    setMenuOpen(false)
  }

  return (
    <header className="queue-titlebar app-drag-region">
      <div className="queue-window-title">
        <strong className="panel-kicker">STITCH UP MEDIA // QUEUE</strong>
        <span className="queue-count-badge">{taskCount} ITEMS</span>
      </div>
      {canStartQueue && (
        <div className="queue-start-split app-no-drag" ref={wrapRef}>
          {isQueueRunning
            ? <button className="queue-titlebar-start" onClick={() => onToggleQueue(scope)} title="Pause the queue">PAUSE QUEUE</button>
            : <>
              <button
                className="queue-titlebar-start"
                onClick={() => onToggleQueue(scope)}
                title={scope === 'selected' ? 'Start the selected jobs' : "Start every job marked READY"}
              >START QUEUE</button>
              <button
                className="queue-titlebar-start-caret"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Choose which jobs START QUEUE starts"
                title="Choose which jobs START QUEUE starts"
                onClick={() => setMenuOpen((open) => !open)}
              >{'▾'}</button>
            </>}
          {menuOpen && (
            <div className="queue-start-menu" role="menu" aria-label="Which jobs to start">
              <button role="menuitemradio" aria-checked={scope === 'ready'} className={scope === 'ready' ? 'is-on' : ''} onClick={() => choose('ready')}>MARKED 'READY'</button>
              <button role="menuitemradio" aria-checked={scope === 'selected'} className={scope === 'selected' ? 'is-on' : ''} onClick={() => choose('selected')}>SELECTED ONLY</button>
            </div>
          )}
        </div>
      )}
    </header>
  )
}
