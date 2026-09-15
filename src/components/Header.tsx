import React from 'react'

interface HeaderProps {
  isQueueRunning: boolean
  onToggleQueue: () => void
  onAddFiles: () => void
  onOpenStitcher: () => void
  onOpenMultiTrack: () => void
  onOpenSettings: () => void
  onClearDone: () => void
  taskCount: number
  canStartQueue?: boolean
}

export const Header: React.FC<HeaderProps> = ({ isQueueRunning, onToggleQueue, taskCount, canStartQueue }) => (
  <header className="queue-titlebar app-drag-region">
    <div className="queue-window-title">
      <strong className="panel-kicker">STITCH UP MEDIA // QUEUE</strong>
      <span className="queue-count-badge">{taskCount} ITEMS</span>
    </div>
    {canStartQueue && (
      <button className="queue-titlebar-start app-no-drag" onClick={onToggleQueue} title="Start or pause the queue">
        {isQueueRunning ? 'PAUSE QUEUE' : 'START QUEUE'}
      </button>
    )}
  </header>
)
