import React from 'react'
import { Upload, Plus } from 'lucide-react'
import { QueueTask } from '../types'
import { TaskCard } from './TaskCard'

interface QueueListProps {
  tasks: QueueTask[]
  onSelectTask: (task: QueueTask, shiftKey?: boolean) => void
  onOpenEditor: (task: QueueTask) => void
  onAddToExisting: (task: QueueTask, files: string[]) => void
  onAddSource: (task: QueueTask) => void
  onRemoveSource: (task: QueueTask, sourcePath: string, sourceIndex?: number) => void
  onReorderSources: (task: QueueTask, sourcePaths: string[]) => void
  onReorderTracks: (task: QueueTask, tracks: NonNullable<QueueTask['additionalAudioTracks']>) => void
  onReorderTasks: (tasks: QueueTask[]) => void
  onReplaceSource: (task: QueueTask, sourcePath: string) => void
  onChangeJobType: (task: QueueTask, type: QueueTask['type']) => void
  onChangeComboMode?: (task: QueueTask, mode: 'multitrack' | 'stitch') => void
  selectedTaskIds?: string[]
  onOpenPresetPicker: (task: QueueTask) => void
  onRemoveTask: (taskId: string) => void
  onRevealOutput: (task: QueueTask) => void
  onQuickLook: (task: QueueTask) => void
  onChangeSourceTiming: (task: QueueTask, sourceKey: string, override: { fps?: number; seconds?: number }) => void
  onChangeOutputName: (task: QueueTask) => void
  onDuplicateTask: (task: QueueTask) => void
  onSkipTask: (task: QueueTask) => void
  onSelectAll: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
  onEncodeSelected: () => void
  onAddFiles: () => void
  onFileDrop: (filePaths: string[], type?: 'transcode' | 'stitch' | 'multitrack' | 'combo') => void
  missingSources?: string[]
}

export const QueueList: React.FC<QueueListProps> = ({
  tasks,
  onSelectTask,
  onOpenEditor,
  onAddToExisting,
  onAddSource,
  onRemoveSource,
  onReorderSources,
  onReorderTracks,
  onReorderTasks,
  onReplaceSource,
  onChangeJobType,
  onChangeComboMode,
  selectedTaskIds,
  onOpenPresetPicker,
  onRemoveTask,
  onRevealOutput,
  onQuickLook,
  onChangeSourceTiming,
  onChangeOutputName,
  onDuplicateTask,
  onSkipTask,
  onSelectAll,
  onExpandAll,
  onCollapseAll,
  onEncodeSelected,
  onAddFiles,
  onFileDrop,
  missingSources,
}) => {
  const [droppedFiles, setDroppedFiles] = React.useState<string[] | null>(null)
  const [dropTray, setDropTray] = React.useState(false)
  const [hoveredDropType, setHoveredDropType] = React.useState<string | null>(null)
  const cardDragLockRef = React.useRef(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('application/x-stitch-job')) { setDropTray(false); setDroppedFiles(null); setHoveredDropType(null); return }
    if ((e.target as HTMLElement).closest('.queue-card')) { cardDragLockRef.current = true; setDropTray(false); return }
    if (cardDragLockRef.current) cardDragLockRef.current = false
    setDropTray(true)
  }

  React.useEffect(() => {
    const lockToCard = () => { cardDragLockRef.current = true; setDropTray(false) }
    const unlockAfterCardDrop = () => { cardDragLockRef.current = false; setDropTray(false) }
    window.addEventListener('queue-card-drag-enter', lockToCard)
    window.addEventListener('queue-card-drag-drop', unlockAfterCardDrop)
    return () => {
      window.removeEventListener('queue-card-drag-enter', lockToCard)
      window.removeEventListener('queue-card-drag-drop', unlockAfterCardDrop)
    }
  }, [])
  React.useEffect(() => {
    const dismissDropTray = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      cardDragLockRef.current = false
            setDropTray(false)
      setDroppedFiles(null)
      setHoveredDropType(null)
    }
    window.addEventListener('keydown', dismissDropTray)
    return () => window.removeEventListener('keydown', dismissDropTray)
  }, [])

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('application/x-stitch-job')) { setDropTray(false); return }
    if (e.currentTarget === e.target) { cardDragLockRef.current = false; setDropTray(false) }
  }

  const handleDrop = async (e: React.DragEvent, selectedType?: 'transcode' | 'stitch' | 'multitrack' | 'combo') => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('application/x-stitch-job')) { setDropTray(false); setDroppedFiles(null); setHoveredDropType(null); return }
    cardDragLockRef.current = false
        setDropTray(false)
    setHoveredDropType(null)
    const dropped = Array.from(e.dataTransfer.files)
    const files = (await Promise.all(dropped.map((file) => {
      try { return window.electronAPI?.getPathForFile(file) || (file as File & { path?: string }).path }
      catch { return (file as File & { path?: string }).path }
    }))).filter((filePath): filePath is string => Boolean(filePath))
    if (files.length > 0) {
      onFileDrop(files, selectedType || 'transcode')
      setDroppedFiles(null)
    }
  }

  const chooseDropType = (type: 'transcode' | 'stitch' | 'multitrack' | 'combo') => {
    if (droppedFiles) onFileDrop(droppedFiles, type)
    setDroppedFiles(null)
  }
  return (
    <main
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDoubleClick={onAddFiles}
      className="queue-rail overflow-y-auto p-4"
    >
      {(dropTray || droppedFiles) && <div className="drop-chooser drop-tray" role="dialog" aria-label="Choose export mode"><div className="drop-chooser-box"><span className="panel-kicker">MEDIA DROP // EXPORT MODE</span><div className="drop-chooser-grid drop-tray-grid"><button className={hoveredDropType === 'transcode' ? 'drop-target-hover' : ''} onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType('transcode') }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType('transcode') }} onDragLeave={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType(null) }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void handleDrop(event, 'transcode') }} onClick={() => droppedFiles && chooseDropType('transcode')}><span>CONVERT</span><small>ONE SOURCE / TRANSCODE</small></button><button className={hoveredDropType === 'stitch' ? 'drop-target-hover' : ''} onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType('stitch') }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType('stitch') }} onDragLeave={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType(null) }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void handleDrop(event, 'stitch') }} onClick={() => droppedFiles && chooseDropType('stitch')}><span>STITCH UP</span><small>SEQUENCE / CLIPS</small></button><button className={hoveredDropType === 'multitrack' ? 'drop-target-hover' : ''} onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType('multitrack') }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType('multitrack') }} onDragLeave={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType(null) }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void handleDrop(event, 'multitrack') }} onClick={() => droppedFiles && chooseDropType('multitrack')}><span>MULTI-TRACK</span><small>VIDEO + AUDIO TRACKS</small></button><button className={hoveredDropType === 'combo' ? 'drop-target-hover' : ''} onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType('combo') }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType('combo') }} onDragLeave={(event) => { event.preventDefault(); event.stopPropagation(); setHoveredDropType(null) }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void handleDrop(event, 'combo') }} onClick={() => droppedFiles && chooseDropType('combo')}><span>COMBO</span><small>VIDEO + SEQUENCE + AUDIO</small></button></div></div></div>}
      {tasks.length === 0 ? (
        <div className="h-full min-h-[400px] flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-neutral-400 mb-4">
            <Upload className="w-8 h-8 stroke-[1.5]" />
          </div>
          <h2 className="text-base font-semibold text-white mb-1">Queue is Empty</h2>
          <p className="text-xs text-neutral-400 max-w-sm mb-6">
            Drag and drop videos or sequences here, or choose files to configure your encoding queue.
          </p>
          <button
            onClick={onAddFiles}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-mac-accent text-white text-xs font-semibold hover:bg-mac-accentHover transition-colors shadow-lg shadow-blue-500/10"
          >
            <Plus className="w-4 h-4" />
            <span>Select Media Files</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3 w-full">
          {tasks.map((task, taskIndex) => (
            <TaskCard
              key={task.id}
              task={task}
          missingSources={missingSources}
              selected={selectedTaskIds?.includes(task.id)}
              onSelectTask={onSelectTask}
              onOpenEditor={onOpenEditor}
              onAddToExisting={onAddToExisting}
              onAddSource={onAddSource}
              onRemoveSource={onRemoveSource}
              onReorderSources={onReorderSources}
              onReorderTracks={onReorderTracks}
              onJobDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-stitch-job', task.id) }}
              onJobDrop={(event) => { event.preventDefault(); const draggedId = event.dataTransfer.getData('application/x-stitch-job'); if (!draggedId || draggedId === task.id) return; const from = tasks.findIndex((candidate) => candidate.id === draggedId); if (from < 0) return; const next = [...tasks]; const [moved] = next.splice(from, 1); next.splice(taskIndex, 0, moved); onReorderTasks(next) }}
              onReplaceSource={onReplaceSource}
              onChangeJobType={onChangeJobType}
              onChangeComboMode={onChangeComboMode}
              onOpenPresetPicker={onOpenPresetPicker}
              onRemoveTask={onRemoveTask}
              onRevealOutput={onRevealOutput}
              onQuickLook={onQuickLook}
              onChangeSourceTiming={onChangeSourceTiming}
              onChangeOutputName={onChangeOutputName}
              onDuplicateTask={onDuplicateTask}
              onSkipTask={onSkipTask}
              onSelectAll={onSelectAll}
              onExpandAll={onExpandAll}
              onCollapseAll={onCollapseAll}
              onEncodeSelected={onEncodeSelected}
            />
          ))}
        </div>
      )}
    </main>
  )
}
