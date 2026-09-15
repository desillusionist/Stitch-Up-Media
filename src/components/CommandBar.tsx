import React from 'react'
import { Settings } from 'lucide-react'

interface Props {
  onOpen: () => void
  onConvert: () => void
  onAdvanced: () => void
  onToggleTheme: () => void
  isQueueRunning: boolean
  theme: string
  canStartQueue: boolean
  stats?: { ready: number; skip: number; done: number }
  statusFilters?: { ready: boolean; skip: boolean; done: boolean }
  onToggleStatus?: (status: 'ready' | 'skip' | 'done') => void
}

export const CommandBar: React.FC<Props> = ({ onOpen, onAdvanced, stats = { ready: 0, skip: 0, done: 0 }, statusFilters = { ready: true, skip: true, done: true }, onToggleStatus }) => (
  <nav className="command-bar" aria-label="Command bar">
    <button onClick={onOpen} title="Add media files">+ ADD MEDIA</button>
    <span className="command-bar-spacer" /><span className="queue-status-stats"><button type="button" className={statusFilters.ready ? "queue-stat-toggle active" : "queue-stat-toggle"} onClick={() => onToggleStatus?.("ready")}>{stats.ready} READY</button><span className="queue-stat-divider" aria-hidden="true">•</span><button type="button" className={statusFilters.skip ? "queue-stat-toggle active" : "queue-stat-toggle"} onClick={() => onToggleStatus?.("skip")}>{stats.skip} SKIP</button><span className="queue-stat-divider" aria-hidden="true">•</span><button type="button" className={statusFilters.done ? "queue-stat-toggle active" : "queue-stat-toggle"} onClick={() => onToggleStatus?.("done")}>{stats.done} DONE</button></span><span className="command-bar-spacer" />
    <button onClick={onAdvanced} title="Settings"><Settings size={14} /> SETTINGS</button>
  </nav>
)
