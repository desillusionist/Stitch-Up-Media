import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileVideo, FileAudio, FileImage, Film, Layers, CheckCircle2, AlertCircle, Clock, Loader2, Folder, ExternalLink } from 'lucide-react'
import { QueueTask } from '../types'
import { sourceFps, stillSecondsFor } from '../lib/timelineModel'
import { clipIdAt, clipKey, copyLabelFor } from '../lib/clipIds'
import { placeholderNamesInOrder } from '../lib/placeholder'
import { sequenceLabel } from '../lib/sequenceLabel'
import { outputBriefDetails, presetSummary } from '../lib/presetSummary'
import { NumberField } from './NumberField'

const AUDIO_EXT = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'oga', 'aiff', 'aif', 'flac']
const isAudioInput = (task: QueueTask) => {
  const info = task.sourceInfo
  if (info?.audioStreams?.length && !info?.videoStreams?.length) return true
  const ext = task.sourcePaths[0]?.split('.').pop()?.toLowerCase()
  return ext ? AUDIO_EXT.includes(ext) : false
}

const JobIcon = ({ task }: { task: QueueTask }) => {
  const cls = 'w-5 h-5'
  switch (task.type) {
    case 'combo': return <Film className={cls} />
    case 'stitch': return <Layers className={cls} style={{ transform: 'rotate(-90deg)' }} />
    case 'multitrack': return <Layers className={cls} />
    default: return isAudioInput(task) ? <FileAudio className={cls} /> : <FileVideo className={cls} />
  }
}

interface TaskCardProps {
  task: QueueTask
  selected?: boolean
  onSelectTask: (task: QueueTask, shiftKey?: boolean, additive?: boolean) => void
  onOpenEditor: (task: QueueTask) => void
  onAddToExisting: (task: QueueTask, files: string[]) => void
  onAddSource: (task: QueueTask) => void
  onRemoveSource: (task: QueueTask, sourcePath: string, sourceIndex?: number) => void
  onReorderSources: (task: QueueTask, sourcePaths: string[], from: number, to: number) => void
  onReorderTracks: (task: QueueTask, tracks: NonNullable<QueueTask['additionalAudioTracks']>) => void
  onReplaceSource: (task: QueueTask, sourcePath: string, sourceIndex: number) => void
  /**
   * The same for an added AUDIO track, whose row is not a place in the source list.
   *
   * A track is named by its own ID rather than by its path: an EXTRACTED track's path IS the visual it came
   * out of, so a row told apart by the path alone could not say which of the two the reader clicked.
   */
  onReplaceTrack?: (task: QueueTask, trackId: string) => void
  onChangeJobType: (task: QueueTask, type: QueueTask['type']) => void
  onChangeComboMode?: (task: QueueTask, mode: 'multitrack' | 'stitch') => void
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
  onJobDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  onJobDrop: (event: React.DragEvent<HTMLDivElement>) => void
  missingSources?: string[]
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  selected,
  onSelectTask,
  onOpenEditor,
  onAddToExisting,
  onAddSource,
  onRemoveSource,
  onReorderSources,
  onReorderTracks,
  onReplaceSource,
  onReplaceTrack,
  onChangeJobType,
  onChangeComboMode,
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
  onJobDragStart,
  onJobDrop,
  missingSources = [],
}) => {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const expand = () => setExpanded(true)
    const collapse = () => setExpanded(false)
    const toggle = (event: Event) => {
      const ids = (event as CustomEvent<{ ids: string[]; expanded: boolean }>).detail
      if (selected && ids.ids.includes(task.id)) setExpanded(ids.expanded)
    }
    window.addEventListener('queue-expand-all', expand)
    window.addEventListener('queue-collapse-all', collapse)
    window.addEventListener('queue-toggle-sources', toggle)
    return () => { window.removeEventListener('queue-expand-all', expand); window.removeEventListener('queue-collapse-all', collapse); window.removeEventListener('queue-toggle-sources', toggle) }
  }, [selected, task.id])
  const [dropMode, setDropMode] = useState(false)
  const [contextMenu, setContextMenu] = useState<{x:number;y:number} | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [draggedSourceIndex, setDraggedSourceIndex] = useState<number | null>(null)
  const [sourceDurations, setSourceDurations] = useState<Record<string, number>>({})
  const [trackDurations, setTrackDurations] = useState<Record<string, number>>({})
  const [sourceMetadata, setSourceMetadata] = useState<Record<string, { resolution?: string; fps?: number; duration?: number; format?: string }>>({})
  const [trackMetadata, setTrackMetadata] = useState<Record<string, { sampleRate?: number; format?: string }>>({})
  const [croppedSources, setCroppedSources] = useState<Set<number>>(new Set())
  /** Whether the OUTPUT's own name is too long for its column, which is what starts it crawling. */
  const [outputCropped, setOutputCropped] = useState(false)
  /** The same for an added AUDIO TRACK's name, keyed by the track's id. */
  const [croppedTracks, setCroppedTracks] = useState<Set<string>>(new Set())
  useEffect(() => {
    const measure = () => {
      const cropped = new Set<number>()
      // Scoped to the SOURCES' own rows: the output's name wears `source-name` too, and so does an added
      // track's — measured by its own id below — and either one left in would shift the indices the source
      // rows are keyed by.
      document.querySelectorAll<HTMLElement>(`[data-task-id="${task.id}"] .queue-sources .source-name:not(.source-track-name)`).forEach((element, index) => {
        if (element.scrollWidth > element.clientWidth + 1) cropped.add(index)
      })
      setCroppedSources(cropped)
      // An added track's name is measured by its own id, which is what its row is keyed by.
      const tracks = new Set<string>()
      document.querySelectorAll<HTMLElement>(`[data-task-id="${task.id}"] .queue-sources .source-track-name`).forEach((element) => {
        const id = element.dataset.trackId
        if (id && element.scrollWidth > element.clientWidth + 1) tracks.add(id)
      })
      setCroppedTracks(tracks)
      const output = document.querySelector<HTMLElement>(`[data-task-id="${task.id}"] .queue-output .source-name`)
      setOutputCropped(Boolean(output && output.scrollWidth > output.clientWidth + 1))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [task.id, task.sourcePaths, task.additionalAudioTracks, task.outputFilename, expanded])
  useEffect(() => {
    let cancelled = false
    void Promise.all(task.sourcePaths.map(async (source, index) => {
      try { const info = await window.electronAPI?.probeMedia(source); return [`${source}#${index}`, Number((info as any)?.duration || 0)] as const } catch { return [`${source}#${index}`, 0] as const }
    })).then((entries) => { if (!cancelled) setSourceDurations(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [task.sourcePaths])
  useEffect(() => {
    let cancelled = false
    void Promise.all(task.sourcePaths.map(async (source, index) => {
      try {
        const info: any = await window.electronAPI?.probeMedia(source)
        const stream = info?.videoStreams?.[0] || info?.audioStreams?.[0]
        return [`${source}#${index}`, { resolution: stream?.resolution, fps: stream?.fps, duration: Number(info?.duration || 0), format: String(info?.format || '').split(',')[0] }] as const
      } catch { return [`${source}#${index}`, {}] as const }
    })).then((entries) => { if (!cancelled) setSourceMetadata(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [task.sourcePaths])
  useEffect(() => {
    let cancelled = false
    void Promise.all((task.additionalAudioTracks || []).map(async (track) => {
      try { const info = await window.electronAPI?.probeMedia(track.path); return [track.id, Number((info as any)?.duration || 0)] as const } catch { return [track.id, 0] as const }
    })).then((entries) => { if (!cancelled) setTrackDurations(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [task.additionalAudioTracks])
  useEffect(() => {
    let cancelled = false
    void Promise.all((task.additionalAudioTracks || []).map(async (track) => {
      try { const info: any = await window.electronAPI?.probeMedia(track.path); return [track.id, { format: String(info?.format || '').split(',')[0], sampleRate: info?.audioStreams?.[0]?.sampleRate }] as const } catch { return [track.id, {}] as const }
    })).then((entries) => { if (!cancelled) setTrackMetadata(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [task.additionalAudioTracks])
  const [mediaInfos, setMediaInfos] = useState<Array<{ id: string; info: any; source: string; x: number; y: number }>>([])
  useEffect(() => {
    if (!mediaInfos.length) return
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setMediaInfos((current) => current.slice(0, -1)) }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [mediaInfos])
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const rect = contextMenuRef.current.getBoundingClientRect()
    const margin = 8
    const x = Math.max(margin, Math.min(contextMenu.x, window.innerWidth - rect.width - margin))
    const y = Math.max(margin, Math.min(contextMenu.y, window.innerHeight - rect.height - margin))
    if (x !== contextMenu.x || y !== contextMenu.y) setContextMenu({ x, y })
  }, [contextMenu])
  useEffect(() => {
    const closeFromOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (!(target instanceof Element && target.closest('.job-context-menu'))) setContextMenu(null)
    }
    document.addEventListener('mousedown', closeFromOutside, true)
    document.addEventListener('contextmenu', closeFromOutside, true)
    return () => {
      document.removeEventListener('mousedown', closeFromOutside, true)
      document.removeEventListener('contextmenu', closeFromOutside, true)
    }
  }, [])
  const fileName = task.sourcePaths[0]?.split('/').pop() || 'Unknown'
  const audioCount = task.additionalAudioTracks?.length || 0
  // What each placeholder is CALLED, numbered across the whole job so the card names a blank the same way the
  // EDIT JOB's timeline does — `BLANK 1`, not a scheme where a file name would go.
  const placeholderNames = placeholderNamesInOrder([...task.sourcePaths, ...(task.additionalAudioTracks || []).map((track) => track.path)])
  const sequenceFor = (source: string) => task.sequenceInputs?.[source] || (task.sequenceInput?.firstFrame === source ? task.sequenceInput : undefined)
  const isImageSource = (source: string) => /\.(jpg|jpeg|png|gif|webp|tif|tiff|bmp|heic|heif|avif)$/i.test(source)
  const formatFps = (fps?: number | string) => {
    const value = Number(fps)
    if (!Number.isFinite(value) || value <= 0) return ''
    return Math.abs(value - Math.round(value)) < 0.01 ? String(Math.round(value)) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  }
  const sourceLabel = (source: string, index: number) => {
    const placeholder = placeholderNames[index]
    if (placeholder) return placeholder
    const sequence = sequenceFor(source)
    // Named by the shared rule, so a clip reads the same here as it does in the EDIT JOB's
    // timeline and its monitor.
    const base = sequence ? sequenceLabel(sequence) : (source.split(/[\\/]/).pop() || '')
    // `COPY n` when the file appears more than once: a copy of a source is what the label names, so it travels
    // with the clip exactly as its id and its records do.
    const copy = copyLabelFor(task, index, source)
    return copy ? `${copy} // ${base}` : base
  }
  /** What an added AUDIO TRACK is called, numbered among every placeholder the job carries. */
  const trackLabel = (track: NonNullable<QueueTask['additionalAudioTracks']>[number], index: number) =>
    placeholderNames[task.sourcePaths.length + index] ?? track.path.split(/[\\/]/).pop() ?? ''
  const jobTitle = task.type === 'transcode' ? sourceLabel(task.sourcePaths[0] || fileName, 0) : task.type === 'stitch' ? `STITCH UP (${task.sourcePaths.length} clips)` : task.type === 'multitrack' ? `MULTI-TRACK (${audioCount} audio)` : 'COMBO'
  const sourceBriefDetails = (source: string, index: number) => {
    const sequence = sequenceFor(source)
    const metadata = sourceMetadata[`${source}#${index}`] || task.sourceMetadata?.[source]
    const standaloneStill = isImageSource(source) && !sequence
    // A still has no rate of its own, so it reports the one it will be rendered at, which
    // is the same number the EDIT JOB's clip line and PROPERTIES show. A probe of a JPEG
    // can carry a rate of its own, so it is deliberately not consulted here.
    const fps = sequence?.fps || (standaloneStill ? sourceFps(task, source) : metadata?.fps)
    // A still's clip has a length as well as a rate, and both are settable from PROPERTIES,
    // so the brief line reports the length it will actually contribute.
    const stillLength = standaloneStill ? stillSecondsFor(task, source) : undefined
    const point = trimFor(source, index)
    const totalFrames = sequence?.frameCount || 0
    const trimmedFrames = sequence && fps ? Math.max(0, Math.min(totalFrames, Math.round((point ? point.out - point.in : (sequence.duration || 0)) * fps))) : 0
    const frameText = sequence && totalFrames > 0 ? `${trimmedFrames} of ${totalFrames}` : undefined
    return [metadata?.resolution, metadata?.format?.toUpperCase(), fps ? `${formatFps(fps)} FPS` : undefined, stillLength ? `${stillLength}s CLIP` : undefined, frameText].filter(Boolean).join(' · ')
  }
  const mediaInfoFor = (info: any, source: string) => {
    const sequence = sequenceFor(source)
    const base = { ...(info || {}), sourcePath: source, sequence: sequence ? { ...sequence } : undefined }
    if (!sequence || !info?.videoStreams?.length) return base
    return { ...base, videoStreams: info.videoStreams.map((stream: any, index: number) => index === 0 ? { ...stream, fps: sequence.fps } : stream) }
  }
  const trimFor = (source: string, index: number) => task.trimPoints?.[clipKey(task, source, index)] || task.trimPoints?.[source]
  const configuredStillDuration = Math.max(0.1, Number(task.stillImageDuration || 10))
  const isStillOutput = task.preset.imageOutputMode === 'still' || task.preset.outputMode === 'audio'
  const trimmedAudioDurationForDisplay = (track: NonNullable<QueueTask['additionalAudioTracks']>[number]) => { const point = task.trimPoints?.[`${track.path}#0`] || task.trimPoints?.[track.path]; const full = trackDurations[track.id] || 0; return point ? Math.max(0, Math.min(full - point.in, point.out - point.in)) : full }
  const longestAudioDurationForDisplay = (task.additionalAudioTracks || []).reduce((max, track) => Math.max(max, trimmedAudioDurationForDisplay(track)), 0)
  const isCoverAudioTask = (task.type === 'multitrack' || task.type === 'combo') && task.sourcePaths.length === 1 && isImageSource(task.sourcePaths[0]) && longestAudioDurationForDisplay > 0
  const segmentText = (source: string, index: number) => {
    const point = trimFor(source, index)
    const sequence = sequenceFor(source)
    const standaloneStill = isImageSource(source) && !sequence
    if (standaloneStill && !point) {
      return formatDuration(isStillOutput ? 0 : (isCoverAudioTask ? longestAudioDurationForDisplay : configuredStillDuration))
    }
    return formatDuration(point ? Math.max(0, point.out - point.in) : sequence?.duration || sourceMetadata[`${source}#${index}`]?.duration || sourceDurations[`${source}#${index}`] || 0)
  }
  const sourceSegmentDurations = task.sourcePaths.map((source, index) => {
    const point = trimFor(source, index)
    const sequence = sequenceFor(source)
    const standaloneStill = isImageSource(source) && !sequence
    const stillOutput = task.preset.imageOutputMode === 'still' || task.preset.outputMode === 'audio'
    if (point) return Math.max(0, point.out - point.in)
    if (sequence?.duration) return sequence.duration
    // Standalone stills have no intrinsic runtime. JPEG/image2 may report a bogus one-frame duration.
    if (standaloneStill) return stillOutput ? 0 : (isCoverAudioTask ? longestAudioDurationForDisplay : configuredStillDuration)
    return Number(sourceMetadata[`${source}#${index}`]?.duration || sourceDurations[`${source}#${index}`] || 0)
  })
  const trackSegmentDuration = (track: NonNullable<QueueTask['additionalAudioTracks']>[number]) => {
    const point = task.trimPoints?.[`${track.path}#0`] || task.trimPoints?.[track.path]
    return point ? Math.max(0, point.out - point.in) : (trackDurations[track.id] || 0)
  }
  const videoTotal = sourceSegmentDurations.reduce((sum, duration) => sum + duration, 0)
  const trackTotal = (task.additionalAudioTracks || []).reduce((sum, track) => sum + trackSegmentDuration(track), 0)
  const longestAudio = (task.additionalAudioTracks || []).reduce((max, track) => Math.max(max, trackSegmentDuration(track)), 0)
  const totalTrimmedDuration = task.type === 'multitrack' || (task.type === 'combo' && (task.comboMode || 'multitrack') === 'multitrack')
    ? Math.max(videoTotal, longestAudio)
    : task.type === 'combo'
      ? Math.max(videoTotal, trackTotal)
      : videoTotal

  const formatBytes = (bytes?: number) => {
    if (!bytes || !Number.isFinite(bytes)) return ''
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
    const mb = kb / 1024
    if (mb < 1024) return `${mb.toFixed(1)} MB`
    return `${(mb / 1024).toFixed(1)} GB`
  }

  const formatDuration = (seconds?: number) => {
    if (seconds == null || !Number.isFinite(seconds)) return ''
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  const openContextMenu = (event: React.MouseEvent) => {
    const menuWidth = 220
    const menuHeight = 300
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    })
  }

  return (
    <div draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-stitch-job', task.id); onJobDragStart(event) }} onClick={(event) => { setContextMenu(null); onSelectTask(task, event.shiftKey, event.metaKey || event.ctrlKey) }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openContextMenu(event) }} onDoubleClick={(event) => { event.stopPropagation(); onOpenEditor(task) }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); if (event.dataTransfer.types.includes('application/x-stitch-job')) return; window.dispatchEvent(new Event('queue-card-drag-enter')); if (task.status !== 'encoding') setDropMode(true) }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDropMode(false) }} onDrop={async (event) => { event.preventDefault(); event.stopPropagation(); if (event.dataTransfer.types.includes('application/x-stitch-job')) { onJobDrop(event); return } window.dispatchEvent(new Event('queue-card-drag-drop')); const files = (await Promise.all(Array.from(event.dataTransfer.files).map((file) => { try { return window.electronAPI?.getPathForFile(file) || (file as File & { path?: string }).path } catch { return (file as File & { path?: string }).path } }))).filter((path): path is string => Boolean(path)); if (files.length) onAddToExisting(task, files); else onJobDrop(event); setDropMode(false) }}
    data-task-id={task.id}
    className={`queue-card group relative bg-mac-card hover:bg-mac-cardHover/70 border border-white/5 rounded-xl p-4 transition-all shadow-sm ${selected ? 'queue-card-selected' : ''} ${dropMode ? 'queue-card-drop-active' : ''} ${contextMenu ? 'queue-card-context-active' : ''}`}>
      <div className="queue-card-main">
        <div className="flex items-start gap-3">
          <div aria-hidden="true" className="p-2.5 rounded-lg bg-white/5 text-neutral-300 flex-shrink-0">
            <JobIcon task={task} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2"><button className="queue-chevron" onClick={(event) => { event.stopPropagation(); setExpanded(!expanded) }} aria-label={expanded ? 'Collapse item' : 'Expand item'}><span className={expanded ? 'queue-chevron-glyph queue-chevron-expanded' : 'queue-chevron-glyph'}>&gt;</span></button>
              <h3 className="filename-input text-sm font-medium text-white truncate max-w-md" title={fileName}>
                {jobTitle}{task.type === 'combo' && <> {((task.comboMode || 'multitrack') === 'multitrack' ? <Layers size={13} aria-label="Vertical stacking" /> : <Layers size={13} style={{ transform: 'rotate(-90deg)' }} aria-label="Horizontal stacking" />)} ({task.sourcePaths.length} clips / {audioCount} audio)</>}
              </h3>
              {task.sequenceInput?.hasGaps && <div className="sequence-gap-warning">Sequence has {task.sequenceInput.missing.length} missing frames (gaps).</div>}
              {/* The PRESET, in the card's top-right corner and ABOVE the panel's top divider. It rides in this
                  row rather than in a column of its own beside the card, because a column shortens everything
                  below it — which is what used to stop the panel's dividers short of the right edge. */}
              <div className="preset-controls ml-auto flex-shrink-0 flex items-end">
                <button
                  onClick={(event) => { event.stopPropagation(); onOpenPresetPicker(task) }}
                  // A preset that has stopped describing the job is one whose NAME says nothing about the
                  // output, so the CUSTOM badge is the one place the figures themselves are worth showing.
                  title={task.preset.name === 'CUSTOM' ? presetSummary(task.preset).join('\n') : undefined}
                  className="px-3 py-1 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 hover:border-mac-accent/40 transition-all flex items-center space-x-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-mac-accent" />
                  <span>{task.preset.name}</span>
                </button>
              </div>
            </div>

            {/* Technical Metadata info badge */}
            <div className="flex items-center space-x-3 text-xs text-neutral-400 mt-1">
              {task.sourceInfo?.videoStreams?.[0]?.resolution && (
                <span>{task.sourceInfo.videoStreams[0].resolution}</span>
              )}
              {task.sourceInfo?.videoStreams?.[0]?.fps && (
                <span>{formatFps(task.sourceInfo.videoStreams[0].fps)} fps</span>
              )}
              {task.sourceInfo?.duration ? (
                <span>{formatDuration(task.sourceInfo.duration)}</span>
              ) : null}
              {task.sourceInfo?.size ? (
                <span>{formatBytes(task.sourceInfo.size)}</span>
              ) : null}
            </div>

            {expanded && <div className="queue-sources"><div className="source-heading"><span className="panel-kicker">{task.type === 'multitrack' || task.type === 'combo' ? 'VIDEO / SEQUENCE' : 'SOURCES'}</span><button className="source-add" aria-label="Add sources" onClick={(event) => { event.stopPropagation(); onAddSource(task) }}>[+]</button></div>{task.sourcePaths.map((source, sourceIndex) => <div className="source-row" key={clipIdAt(task, sourceIndex)} draggable onDragStart={(event) => { event.stopPropagation(); setDraggedSourceIndex(sourceIndex); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation() }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (draggedSourceIndex != null && draggedSourceIndex !== sourceIndex) { const next = [...task.sourcePaths]; const [moved] = next.splice(draggedSourceIndex, 1); next.splice(sourceIndex, 0, moved); onReorderSources(task, next, draggedSourceIndex, sourceIndex) } setDraggedSourceIndex(null) }} onDragEnd={() => setDraggedSourceIndex(null)}><span className="source-file-cell"><button className="source-media-icon" title="Quick Look" onClick={(event) => { event.stopPropagation(); onQuickLook({ ...task, quickLookSourceIndex: sourceIndex }) }}>{['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'oga', 'aiff', 'aif'].includes(source.match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '') ? <FileAudio size={12} /> : ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'bmp'].includes(source.match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '') ? <FileImage size={12} /> : <FileVideo size={12} />}</button><button className="source-info-button" title="Media Info" aria-label="Media Info" onClick={(event) => { event.stopPropagation(); const sequence = sequenceFor(source); void Promise.all([window.electronAPI?.probeMedia(source) || Promise.resolve(undefined), sequence?.files?.length ? (window.electronAPI?.getPathsTotalSize?.(sequence.files) || Promise.resolve(undefined)) : Promise.resolve(undefined)]).then(([info, totalSize]) => { const merged = mediaInfoFor(info, source); if (merged.sequence && typeof totalSize === 'number') { merged.sequence = { ...merged.sequence, totalSize }; merged.size = totalSize }; setMediaInfos((current) => [...current, { id: `${task.id}-${Date.now()}-${Math.random()}`, info: merged, source, x: 24 + current.length * 24, y: 64 + current.length * 24 }]) }).catch(() => setMediaInfos((current) => [...current, { id: `${task.id}-${Date.now()}`, info: { error: 'Unable to read media metadata', sourcePath: source }, source, x: 24, y: 64 }])) }}>{'i'}</button><button className={`source-name filename-input ${croppedSources.has(sourceIndex) ? 'source-name-cropped' : ''}${missingSources.includes(source) ? ' source-missing' : ''}`} title="Click to replace media" onClick={(event) => { event.stopPropagation(); onReplaceSource(task, source, sourceIndex) }}><span className="source-name-track"><span>{sourceLabel(source, sourceIndex)}</span><span className="source-name-copy" aria-hidden="true">{sourceLabel(source, sourceIndex)}</span></span></button>{sourceBriefDetails(source, sourceIndex) && <span className="source-brief-details" title={sequenceFor(source) ? 'Frame rate can be changed in Media Info (i)' : undefined}>{sourceBriefDetails(source, sourceIndex)}</span>}</span><span className="source-segment-time source-duration-column">{segmentText(source, sourceIndex)}</span><button className="source-remove" onClick={(event) => { event.stopPropagation(); onRemoveSource(task, source, sourceIndex) }}>×</button></div>)}{(task.type === 'multitrack' || task.type === 'combo') && <><button className="panel-kicker queue-track-label combo-mode-switcher" onClick={(event) => { event.stopPropagation(); if (task.type === 'combo') onChangeComboMode?.(task, (task.comboMode || 'multitrack') === 'multitrack' ? 'stitch' : 'multitrack') }}>{task.type === 'combo' ? ((task.comboMode || 'multitrack') === 'multitrack' ? 'MULTI-TRACK' : 'STITCH TRACKS') : 'MULTI-TRACK'}</button>{(task.additionalAudioTracks || []).map((track, trackIndex) => <div className="source-row" key={track.id} draggable onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData('application/x-stitch-track', track.id); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation() }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const draggedId = event.dataTransfer.getData('application/x-stitch-track'); if (!draggedId || draggedId === track.id) return; const current = [...(task.additionalAudioTracks || [])]; const from = current.findIndex((candidate) => candidate.id === draggedId); const to = current.findIndex((candidate) => candidate.id === track.id); if (from >= 0 && to >= 0) { const [moved] = current.splice(from, 1); current.splice(to, 0, moved); onReorderTracks(task, current) } }}><span className="source-file-cell"><button className="source-media-icon" title="Quick Look" onClick={(event) => { event.stopPropagation(); onQuickLook({ ...task, sourcePaths: [track.path], additionalAudioTracks: undefined, quickLookSourceIndex: 0 }) }}><FileAudio size={12} /></button><button className="source-info-button" title="Media Info" aria-label="Media Info" onClick={(event) => { event.stopPropagation(); void (window.electronAPI?.probeMedia(track.path) || Promise.resolve(undefined)).then((info) => setMediaInfos((current) => [...current, { id: `${task.id}-${track.id}-${Date.now()}`, info: mediaInfoFor(info, track.path), source: track.path, x: 24 + current.length * 24, y: 64 + current.length * 24 }])) }}>{'i'}</button><button className={`source-name filename-input source-track-name${croppedTracks.has(track.id) ? ' source-name-cropped' : ''}`} data-track-id={track.id} title="Click to replace media" onClick={(event) => { event.stopPropagation(); onReplaceTrack?.(task, track.id) }}><span className="source-name-track"><span>{trackLabel(track, trackIndex)}</span><span className="source-name-copy" aria-hidden="true">{trackLabel(track, trackIndex)}</span></span></button><span className="source-brief-details">{[trackMetadata[track.id]?.format?.toUpperCase(), trackMetadata[track.id]?.sampleRate ? `${trackMetadata[track.id].sampleRate} HZ` : undefined].filter(Boolean).join(" · ")}</span></span><span className="source-duration-column">{formatDuration(isCoverAudioTask ? trackSegmentDuration(track) : trackSegmentDuration(track)) || "0:00"}</span><button className="source-remove" onClick={(event) => { event.stopPropagation(); onRemoveSource(task, track.path) }}>×</button></div>)}</>}<div className="source-total"><span className="panel-kicker source-file-cell">TOTAL DURATION</span><span className="source-duration-column">{formatDuration(totalTrimmedDuration) || '0:00'}</span><span /></div></div>}
            {/* The export's OWN row, always shown so the output is readable with the card collapsed too. It is
                laid out as a SOURCE row — the same file cell, the same 280px details column hanging from the same
                divider — so its metadata lines up under the sources' rather than floating beside the name. */}
            <div className="queue-output">
              <div className="source-row queue-output-row">
                <span className="source-file-cell">
                  <span className="panel-kicker queue-output-label">OUTPUT:</span>
                  <span className="queue-output-folder" title={task.outputDirectory} aria-hidden="true"><Folder size={12} /></span>
                  <button className={`source-name filename-output${outputCropped ? ' source-name-cropped' : ''}`} title={task.outputDirectory} onClick={() => onChangeOutputName(task)}><span className="source-name-track"><span>{task.outputFilename}</span><span className="source-name-copy" aria-hidden="true">{task.outputFilename}</span></span></button>
                  <span className="source-brief-details">{outputBriefDetails(task.preset)}</span>
                </span>
                {task.status === 'done' && <button className="source-remove" onClick={() => onRevealOutput(task)} title="Show in Finder" aria-label="Show in Finder"><ExternalLink size={12} /></button>}
              </div>
            </div>
          </div>
        </div>

        {/* The card's STATUS, at its bottom-right so it stands UNDER the panel's last divider — where the
            sources end — rather than beside the sources' first one at the top. */}
        <div className="queue-card-status flex items-center justify-end space-x-1 text-xs">
          {task.skipped && (
            <span className="text-neutral-400 flex items-center space-x-1">
              <Clock className="w-3 h-3" />
              <span>SKIP</span>
            </span>
          )}
          {!task.skipped && task.status === 'pending' && (
            <span className="text-neutral-400 flex items-center space-x-1">
              <Clock className="w-3 h-3" />
              <span>READY</span>
            </span>
          )}
          {task.status === 'encoding' && (
            <span className="text-mac-accent flex items-center space-x-1 font-medium">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Encoding {task.progress}%</span>
            </span>
          )}
          {task.status === 'done' && (
            <span className="text-mac-success flex items-center space-x-1 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Complete</span>
            </span>
          )}
          {task.status === 'error' && (
            <span className="text-mac-danger flex items-center space-x-1 font-medium">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Failed</span>
            </span>
          )}
        </div>

      </div>

      {/* Real-time Progress Bar */}
      {task.status === 'encoding' && (
        <div className="mt-3 pt-2 border-t border-white/5">
          <div className="dither-progress" role="progressbar" aria-valuenow={task.progress} aria-valuemin={0} aria-valuemax={100} title={`${task.progress}% encoded`}><i style={{ width: `${Math.max(0, Math.min(100, task.progress || 0))}%` }} /></div>
          <div className="flex justify-between text-[11px] text-neutral-400 mt-1.5 font-mono">
            <span>{task.currentTimemark ? `At: ${task.currentTimemark}` : 'Starting...'}</span>
            <span>{task.fps ? `${Math.round(task.fps)} fps` : ''}</span>
          </div>
        </div>
      )}

      {task.errorMessage && (
        <div className="mt-2 text-xs text-mac-danger bg-mac-danger/10 p-2 rounded-lg font-mono truncate">
          {task.errorMessage}
        </div>
      )}
      {mediaInfos.map((item) => createPortal(<div key={item.id} className="media-info-popover" role="dialog" aria-label="Media Info" style={{ left: item.x, top: item.y, transform: 'none' }} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => { event.stopPropagation(); const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(event.currentTarget); selection?.removeAllRanges(); selection?.addRange(range) }}><div className="media-info-drag-handle" onMouseDown={(event) => { event.preventDefault(); const startX = event.clientX; const startY = event.clientY; const originalX = item.x; const originalY = item.y; const move = (moveEvent: MouseEvent) => setMediaInfos((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, x: originalX + moveEvent.clientX - startX, y: originalY + moveEvent.clientY - startY } : candidate)); const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up) }}>MEDIA INFO</div><button className="media-info-close" onClick={() => setMediaInfos((current) => current.filter((candidate) => candidate.id !== item.id))} aria-label="Close Media Info">×</button><strong>{item.source.split('/').pop()}</strong><section><b>GENERAL</b><span>Source: {item.info.error ? item.info.error : item.info.sourcePath || item.source.split('/').pop()}</span><span>Format: {item.info.sourcePath ? (item.info.sourcePath.split('.').pop() || 'Unknown').toUpperCase() : (item.info.format || 'Unknown').split(',')[0].trim().toUpperCase()}</span><span>Data Size: {item.info.size ? formatBytes(Number(item.info.size)) : 'Unknown'}</span><span>Bitrate: {item.info.bitrate ? `${Math.round(Number(item.info.bitrate) / 1000)} kbit/s` : 'Unknown'}</span></section>{(() => {
        const isImg = /\.(jpg|jpeg|png|gif|webp|tif|tiff|bmp|heic|heif|avif)$/i.test(item.source)
        const seq = item.info.sequence
        const vstream = item.info.videoStreams?.[0]
        const dims = vstream?.resolution || item.info.resolution
        const format = (item.info.sourcePath?.split('.').pop() || item.info.format || 'Unknown').toString().split(',')[0].toUpperCase()
        if (isImg) {
          const width = Number(seq?.pattern?.match(/%0(\d+)d/)?.[1] || 1)
          const lastName = seq?.files?.[seq.files.length - 1]?.split(/[\\/]/).pop() || ''
          const lastNum = lastName.match(/(\d+)(?=\.[^.]+$)/)?.[1] || String(seq?.startNumber ?? '')
          return (<section><b>{seq ? 'IMAGE SEQUENCE' : 'IMAGE DETAILS'}</b><span>Dimensions: {dims || 'Unknown'}</span><span>Format: {format}</span><span>DPI: {item.info.dpi || 'Unknown'}</span><span>Color Profile: {item.info.colorProfile || item.info.pixelFormat || 'Unknown'}</span>{seq && <span>Range: {String(seq.startNumber).padStart(width, '0')}–{lastNum.padStart(width, '0')}</span>}{seq && <span>Frames: {seq.frameCount}{seq.hasGaps ? ` (${seq.missing?.length || 0} missing)` : ''}</span>}{seq && (() => { const presets = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60]; const current = Number(seq.fps ?? 24); return <span>Frame Rate: <select className="mi-fps-select" value={String(current)} onChange={(event) => { const fps = Number(event.target.value); onChangeSourceTiming(task, item.source, { fps }); setMediaInfos((cur) => cur.map((entry) => entry.id === item.id ? { ...entry, info: { ...entry.info, sequence: { ...entry.info.sequence, fps, duration: seq.frameCount / fps } } } : entry)) }}>{presets.map((rate) => <option key={rate} value={String(rate)}>{rate}</option>)}{!presets.includes(current) && <option value={String(current)}>{current} (custom)</option>}</select> fps</span> })()}{!seq && (() => { const presets = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60]; const current = Number(task.sourceMetadata?.[item.source]?.fps || task.preset.fps || 25); const seconds = stillSecondsFor(task, item.source); return <><span>Frame Rate: <select className="mi-fps-select" value={String(current)} onChange={(event) => onChangeSourceTiming(task, item.source, { fps: Number(event.target.value) })}>{presets.map((rate) => <option key={rate} value={String(rate)}>{rate}</option>)}{!presets.includes(current) && <option value={String(current)}>{current} (custom)</option>}</select> fps</span><span>Clip Length: <NumberField className="mi-fps-select" min={0.1} step={0.1} value={seconds} onValue={(value) => { if (value > 0) onChangeSourceTiming(task, item.source, { seconds: value }) }} /> s</span></> })()}{seq && <span>Duration: {seq.duration ? formatDuration(seq.duration) : 'Unknown'}</span>}{seq && <span>Total Size: {seq.totalSize ? formatBytes(Number(seq.totalSize)) : 'Unknown'}</span>}</section>)
        }
        if (item.info.videoStreams?.length > 0) return (<section><b>VIDEO DETAILS</b><span>Resolution: {vstream?.resolution || 'Unknown'}</span><span>Codec: {vstream?.codec || 'Unknown'}</span><span>Frame Rate: {vstream?.fps ? `${formatFps(vstream.fps)} fps` : 'Unknown'}</span><span>Data Rate: {vstream?.bitrate || 'Unknown'}</span></section>)
        return null
      })()}{item.info.audioStreams?.length > 0 && <section><b>AUDIO DETAILS</b><span>Codec: {item.info.audioStreams[0].codec || 'Unknown'}</span><span>Language: {item.info.audioStreams[0].language || 'Unknown'}</span><span>Channels: {item.info.audioStreams[0].channels || 'Unknown'}</span><span>Sample Rate: {item.info.audioStreams[0].sampleRate ? `${item.info.audioStreams[0].sampleRate} Hz` : 'Unknown'}</span><span>Data Rate: {item.info.audioStreams[0].bitrate || 'Unknown'}</span></section>}</div>, document.body))}
      {contextMenu && <div ref={contextMenuRef} className="job-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}><div className="context-menu-group"><button onClick={() => { onEncodeSelected(); setContextMenu(null) }}>ENCODE SELECTED</button></div><div className="context-menu-group"><span>EXPORT MODE</span><button onClick={() => { onChangeJobType(task, 'transcode'); setContextMenu(null) }}>CONVERT</button><button onClick={() => { onChangeJobType(task, 'stitch'); setContextMenu(null) }}>STITCH UP</button><button onClick={() => { onChangeJobType(task, 'multitrack'); setContextMenu(null) }}>MULTI-TRACK</button><button onClick={() => { onChangeJobType(task, 'combo'); setContextMenu(null) }}>COMBO</button></div><div className="context-menu-group"><span>JOB</span><button onClick={() => { onOpenEditor(task); setContextMenu(null) }}>JOB EDIT</button><button onClick={() => { onDuplicateTask(task); setContextMenu(null) }}>DUPLICATE</button><button onClick={() => { onSkipTask(task); setContextMenu(null) }}>{task.skipped || task.status === 'done' || task.status === 'error' ? 'RESET STATUS' : 'SKIP'}</button><button onClick={() => { onRemoveTask(task.id); setContextMenu(null) }}>REMOVE</button></div><div className="context-menu-group"><span>SELECTION</span><button onClick={() => { onSelectAll(); setContextMenu(null) }}>SELECT ALL</button><button onClick={() => { onExpandAll(); setContextMenu(null) }}>EXPAND ALL</button><button onClick={() => { onCollapseAll(); setContextMenu(null) }}>COLLAPSE ALL</button></div></div>}
    </div>
  )
}
