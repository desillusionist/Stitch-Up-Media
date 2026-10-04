import React, { useState, useEffect, useRef } from 'react'
import { Header } from './components/Header'
import { QueueList } from './components/QueueList'
import { PresetModal } from './components/PresetModal'
import { StitchModal } from './components/StitchModal'
import { MultiAudioModal } from './components/MultiAudioModal'
import { SettingsModal } from './components/SettingsModal'
import { CommandBar } from './components/CommandBar'
import { QueueTask, EncodingPreset, AppSettings, EditJobPatch } from './types'
import { withSourceTiming } from './lib/sourceTiming'
import { DEFAULT_PRESETS } from './constants/presets'
import { detectSequences, isImagePath } from './lib/detectSequences'
import { deriveOutputFilename } from './lib/outputNaming'
import { mediaKind } from './lib/mediaKind'
import { removeSourceFromTask, clipRecordsFor, withSourceList } from './lib/sourceRemoval'
import { resolveQuickLookRequest, dropPreviewsFor, sequencePreviewKey, sourceOfPreview, sourceOfPreviewKey } from './lib/quickLookTarget'
import { clipKey, legacyClipId, matchClipIdsToPaths, matchClipNumbersToPaths, materializeClipIds, materializeClipNumbers, moveAlong, moveClipIds, newClipId, nextClipNumber } from './lib/clipIds'

/**
 * The rate a still image is given when it is exported as video.
 *
 * Falls back to the sequence rate and then to 25, so the timeline, the monitor and
 * the encoder always have one number to agree on.
 */
export const stillImageFps = (settings: AppSettings): number => {
  if (settings.defaultImageFps && settings.defaultImageFps > 0) return settings.defaultImageFps
  if (settings.sequenceFps && settings.sequenceFps > 0) return settings.sequenceFps
  return 25
}

/**
 * The per-source rate record for the still images among a set of imported files.
 *
 * Recorded at import so a still exported through a video preset is encoded at the
 * rate the settings asked for, rather than at whatever ffmpeg's image demuxer
 * happens to default to, and so PROPERTIES has something to edit per clip.
 * A frame belonging to an interpreted sequence is skipped, because that sequence
 * carries its own rate and it wins over this record anyway.
 */
const stillFpsMetadata = (
  filePaths: string[],
  sequenceFrame: string | undefined,
  settings: AppSettings,
): Record<string, { fps: number }> | undefined => {
  const fps = stillImageFps(settings)
  const entries = filePaths
    .filter((filePath) => mediaKind(filePath) === 'image' && filePath !== sequenceFrame)
    .map((filePath) => [filePath, { fps }] as const)
  return entries.length ? Object.fromEntries(entries) : undefined
}

/**
 * Records a generated clip against the source it was built for.
 *
 * Keyed by source and the parameters it was built at, so the file name stays stable
 * between opens: that is what lets the frame-accurate helper remember its in/out points
 * instead of generating new footage every time. Any clip for the same source built at
 * other parameters is dropped with it.
 */
const rememberPreview = (task: QueueTask, sourceKey: string, previewPath: string): QueueTask => {
  const previews = { ...(task.imageSequencePreviews || {}) }
  dropPreviewsFor(previews, sourceOfPreviewKey(sourceKey))
  previews[sourceKey] = previewPath
  return { ...task, imageSequencePreviews: previews }
}

/**
 * Deliberately field-scoped rather than a wholesale replace: the editor holds a
 * snapshot taken when it opened while the queue keeps mutating progress, status,
 * speed and eta, so replacing the whole object would clobber live encoding state.
 *
 * The editor's own source list is taken FIRST, because it is the one edit that moves every other clip's
 * place. The ids come with it where it was reordered, so each clip's records stay filed under the clip
 * itself rather than being re-keyed onto the places the survivors now occupy.
 */
const applyEditJobPatch = (task: QueueTask, patch: EditJobPatch): QueueTask => {
  // The editor's own source list is taken FIRST, because it is the one edit that moves every other
  // clip's place: the re-keying it does is what the per-clip maps below are then filed against. It is
  // only carried when the window changed the list, so a patch that never knew about a reorder made in
  // the queue cannot overwrite it.
  const listed = patch.sourcePaths?.length
    ? (withSourceList(task, patch.sourcePaths, patch.additionalAudioTracks ?? [], patch.clipIds) ?? task)
    : task
  const next: QueueTask = {
    ...listed,
    preset: patch.preset,
    outputFilename: patch.outputFilename,
    outputFilenameManuallySet: patch.outputFilenameManuallySet,
    transitions: patch.transitions,
    // Whole, like the transitions: the window owns every clip's fit and every lane's mute, so an
    // emptied map is a decision about the job rather than a field left out of the patch.
    sourceFit: patch.sourceFit,
    sourceCrop: patch.sourceCrop,
    sourceSpeed: patch.sourceSpeed,
    sourceFps: patch.sourceFps,
    // The window's own trims, whole like the transitions: trimming a clip is an edit this window makes, so an
    // empty map is a decision about the job rather than a field left out of the patch.
    trimPoints: patch.trimPoints,
    mutedLanes: patch.mutedLanes,
    // The ids come with the list when the window reordered it, because only they can say which of two
    // copies of one file moved where. The numbers come with them, so `CLIP n` stays on its clip too.
    clipIds: patch.clipIds ?? listed.clipIds,
    clipNumbers: patch.clipNumbers ?? listed.clipNumbers,
    status: task.status === 'done' ? 'pending' : task.status,
  }
  if (!patch.sourceTiming) return next
  // Timing the window set in its PROPERTIES lands on the task's own record for that
  // source, which is where the timeline and the encoder look, and it invalidates any clip
  // that was generated at the previous values.
  return Object.entries(patch.sourceTiming).reduce(
    (current, [sourcePath, override]) => withSourceTiming(current, sourcePath, override),
    next,
  )
}

/**
 * Everything the EDIT JOB window renders. Live progress fields are deliberately
 * excluded, so encoding ticks cannot push refreshes into the child window.
 */
const editJobSignature = (task: QueueTask) => JSON.stringify([
  task.type, task.status, task.sourcePaths, task.additionalAudioTracks, task.preset,
  task.outputFilename, task.outputFilenameManuallySet, task.sourceBaseName, task.outputDirectory,
  task.trimPoints, task.sourceMetadata, task.sourceInfo, task.sequenceInput, task.sequenceInputs,
  task.imageSequencePreviews, task.quickLookSourceIndex, task.stillImageDuration, task.transitions,
  task.sourceFit, task.sourceCrop, task.sourceSpeed, task.sourceFps, task.clipIds, task.clipNumbers, task.mutedLanes,
])

export const App: React.FC = () => {
  const [tasks, setTasks] = useState<QueueTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string>()
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [statusFilters, setStatusFilters] = useState({ ready: true, skip: true, done: true })
  const [pendingFiles, setPendingFiles] = useState<string[] | null>(null)
  const [sequenceChoice, setSequenceChoice] = useState<{ frames: number; resolve: (whole: boolean) => void } | null>(null)
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null)
  const [theme, setTheme] = useState<'retro' | 'modern'>('retro')
  const [isQueueRunning, setIsQueueRunning] = useState(false)
  const [activeTaskForPreset, setActiveTaskForPreset] = useState<QueueTask | null>(null)
  const [isCustomOpen, setIsCustomOpen] = useState(false)
  const [isStitchOpen, setIsStitchOpen] = useState(false)
  const [isMultiAudioOpen, setIsMultiAudioOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editJobTaskIdRef = useRef<string | null>(null)
  const editJobSignatureRef = useRef('')
  const lastDeletedTasksRef = useRef<QueueTask[]>([])
  const taskHistoryPastRef = useRef<QueueTask[][]>([])
  const taskHistoryFutureRef = useRef<QueueTask[][]>([])
  const previousTasksRef = useRef<QueueTask[] | null>(null)
  /** The queue as it stands, for the listeners that are bound once and cannot close over it. */
  const tasksRef = useRef<QueueTask[]>([])
  tasksRef.current = tasks
  const selectionAnchorRef = useRef<string | undefined>(undefined)
  const applyingHistoryRef = useRef(false)
  const missingSourcesRef = useRef<Set<string>>(new Set())
  const [missingSources, setMissingSources] = useState<string[]>([])
  const [settings, setSettings] = useState<AppSettings>({
    maxConcurrentTasks: 2,
    useHardwareAcceleration: true,
    notifyOnCompletion: true,
    saveTempNextToSource: true,
    pauseOnHighLoad: false,
    sequenceFps: 24,
    defaultImageFps: 25,
    screenshotDirectory: undefined,
    defaultImageDuration: 10,
    timestampDisplayMode: 'timestamp',
  })
  const hydratedRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    void window.electronAPI?.loadAppState().then((saved) => {
      if (cancelled) return
      if (saved) {
        setTasks(Array.isArray(saved.tasks) ? saved.tasks : [])
        if (saved.settings) setSettings((current) => ({ ...current, ...saved.settings }))
      }
      hydratedRef.current = true
    }).catch(() => { hydratedRef.current = true })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!hydratedRef.current) return
    const timer = window.setTimeout(() => {
      void window.electronAPI?.saveAppState({ tasks, settings })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [tasks, settings])
  useEffect(() => {
    if (previousTasksRef.current === null) {
      previousTasksRef.current = tasks
      return
    }
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false
      previousTasksRef.current = tasks
      return
    }
    if (JSON.stringify(previousTasksRef.current) !== JSON.stringify(tasks)) {
      const encodingTransition = previousTasksRef.current.some((task) => task.status === 'encoding') || tasks.some((task) => task.status === 'encoding')
      if (encodingTransition) {
        previousTasksRef.current = tasks
        return
      }
      taskHistoryPastRef.current.push(previousTasksRef.current)
      if (taskHistoryPastRef.current.length > 100) taskHistoryPastRef.current.shift()
      taskHistoryFutureRef.current = []
      previousTasksRef.current = tasks
    }
  }, [tasks])
  const handleUndo = () => {
    const previous = taskHistoryPastRef.current.pop()
    if (!previous) return
    taskHistoryFutureRef.current.push(tasks)
    applyingHistoryRef.current = true
    setTasks(previous)
  }
  const handleRedo = () => {
    const next = taskHistoryFutureRef.current.pop()
    if (!next) return
    taskHistoryPastRef.current.push(tasks)
    applyingHistoryRef.current = true
    setTasks(next)
  }

  useEffect(() => {
    const checkMissing = async () => {
      if (!window.electronAPI?.pathExists) return
      const paths = Array.from(new Set(tasks.flatMap((task) => [...task.sourcePaths, ...(task.additionalAudioTracks || []).map((track) => track.path)])))
      const missing = new Set<string>()
      await Promise.all(paths.map(async (filePath) => { if (!(await window.electronAPI!.pathExists(filePath))) missing.add(filePath) }))
      const newlyMissing = [...missing].filter((filePath) => !missingSourcesRef.current.has(filePath))
      missingSourcesRef.current = missing
      setMissingSources([...missing])
      if (newlyMissing.length) setNotice({ title: 'SOURCE FILE NOT FOUND', message: `${newlyMissing.map((filePath) => filePath.split(/[\\/]/).pop()).join('\n')}\n\nThe file may have been deleted, renamed, or moved in Finder.` })
    }
    void checkMissing()
    const timer = window.setInterval(() => { void checkMissing() }, 2500)
    return () => window.clearInterval(timer)
  }, [tasks])

  const handleOpenEditJob = (task: QueueTask) => {
    editJobTaskIdRef.current = task.id
    editJobSignatureRef.current = editJobSignature(task)
    void window.electronAPI?.openEditJob(task)
  }

  // Push editable-field changes to an open EDIT JOB window so it never applies
  // edits on top of a stale snapshot. Only fires when those fields actually move,
  // so encoding progress ticks cannot spam the child window.
  useEffect(() => {
    const openTaskId = editJobTaskIdRef.current
    if (!openTaskId) return
    const task = tasks.find((candidate) => candidate.id === openTaskId)
    if (!task) return
    const signature = editJobSignature(task)
    if (signature === editJobSignatureRef.current) return
    editJobSignatureRef.current = signature
    void window.electronAPI?.syncEditJobTask(task)
  }, [tasks])

  // Load initial settings and set up IPC event listeners
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getSettings().then((s) => {
        // Merged rather than replaced: the main process's copy is a partial record, so a
        // wholesale replace dropped whichever settings it does not carry.
        if (s) setSettings((current) => ({ ...current, ...s }))
      })
      // A setting changed in another window arrives here so that this window — the one that owns the
      // app-state file — writes it. The state change alone is what saves it, since that is what the
      // saver below watches.
      const unsubscribeSettings = window.electronAPI.onSettingsChanged((changed) => {
        setSettings((current) => ({ ...current, ...changed }))
      })

      const unsubscribeEditor = window.electronAPI.onEditJobApplied((patch) => {
        setTasks((prev) => prev.map((task) => task.id === patch.id ? applyEditJobPatch(task, patch) : task))
      })

      const unsubscribeProgress = window.electronAPI.onProgress((taskId, progressData) => {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: 'encoding',
                  progress: progressData.percent,
                  fps: progressData.currentFps,
                  currentTimemark: progressData.timemark,
                }
              : t
          )
        )
      })

      const unsubscribeComplete = window.electronAPI.onTaskCompleted((taskId) => {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'done', progress: 100 } : t))
        )
      })

      const unsubscribeFinished = window.electronAPI.onQueueFinished(() => setIsQueueRunning(false))
      const unsubscribePoints = window.electronAPI.onQuickLookPoints((taskId, reportedPath, start, end, sourceIndex) => {
        setTasks((prev) => prev.map((task) => {
          if (task.id !== taskId) return task
          // The helper reports the file it was handed, which for a still or a sequence is
          // a generated clip. In/out points belong to the media the user picked, so the
          // clip is tied back to its source; filing them against the clip would lose them
          // the moment it was rebuilt.
          const originalSource = sourceOfPreview(task.imageSequencePreviews, reportedPath) || reportedPath
          return { ...task, trimPoints: { ...(task.trimPoints || {}), [clipKey(task, originalSource, sourceIndex)]: { in: start, out: end } } }
        }))
      })
      // A clip built in the EDIT JOB window is persisted here the moment it exists, rather
      // than only when that window is applied: the trim points that come back on close have
      // to find it, and the next open should find it too instead of building another.
      const unsubscribePreview = window.electronAPI.onSequencePreviewReady((taskId, sourceKey, previewPath) => {
        setTasks((prev) => prev.map((task) => task.id === taskId ? rememberPreview(task, sourceKey, previewPath) : task))
      })
      // Per-source timing changed in the EDIT JOB's PROPERTIES. Applied here at once rather
      // than waiting for that window to be applied, so its monitor, this card and the
      // frame-accurate helper are never showing different numbers for the same clip.
      const unsubscribeTiming = window.electronAPI.onSourceTiming((taskId, sourceKey, override) => {
        setTasks((prev) => prev.map((task) => {
          if (task.id !== taskId) return task
          const wasDone = task.status === 'done'
          const next = withSourceTiming(task, sourceKey, override)
          return wasDone && next !== task ? { ...next, progress: 0 } : next
        }))
      })
      // The EDIT JOB window asked for one of the sources to be taken out of the job. The queue owns
      // the job, so the removal happens here and the job is sent back to the window, which is the
      // same route every other change to a job's sources takes.
      const unsubscribeRemoveSource = window.electronAPI.onEditJobRemoveSource(({ taskId, sourcePath, sourceIndex }) => {
        const task = tasksRef.current.find((candidate) => candidate.id === taskId)
        if (task) handleRemoveSource(task, sourcePath, sourceIndex)
      })
      const unsubscribeError = window.electronAPI.onTaskError((taskId, error) => {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'error', errorMessage: error } : t))
        )
      })

      return () => {
        unsubscribeEditor()
        unsubscribeSettings()
        unsubscribeProgress()
        unsubscribeComplete()
        unsubscribeError()
        unsubscribeFinished()
        unsubscribePoints()
        unsubscribePreview()
        unsubscribeTiming()
        unsubscribeRemoveSource()
      }
    }
  }, [])

  const askSequenceChoice = (frames: number) => new Promise<boolean>((resolve) => setSequenceChoice({ frames, resolve }))

  // Create a queue task from a selected job type.
  const addFilesToQueue = async (filePaths: string[], jobType: 'transcode' | 'stitch' | 'multitrack' | 'combo' = 'transcode', skipSequenceResolution = false) => {
    if (filePaths.length === 0) return
    const expandedPaths = window.electronAPI?.expandMediaPaths
      ? await window.electronAPI.expandMediaPaths(filePaths)
      : filePaths
    if (expandedPaths.length === 0) {
      window.alert('No compatible media files were found in the dropped item.')
      return
    }
    filePaths = expandedPaths
    const droppedPath = filePaths[0]
    const originallySinglePath = filePaths.length === 1
    const droppedName = droppedPath.split(/[\\/]/).pop() || ''
    const hasTrailingNumber = /\d+\D*\.[^.]+$/.test(droppedName)
    if (!skipSequenceResolution && filePaths.length === 1 && isImagePath(droppedPath) && hasTrailingNumber && window.electronAPI?.listSiblingFiles) {
      try {
        const siblings = await window.electronAPI.listSiblingFiles(droppedPath)
        const siblingSequences = detectSequences(siblings, { minFrames: 2 })
        if (siblingSequences.some((sequence) => sequence.files.includes(droppedPath))) filePaths = siblings
      } catch {
        // A failed sibling read means this remains a normal single still.
      }
    }
    const detectedSequences = skipSequenceResolution ? [] : detectSequences(filePaths)
    const sequenceCandidates = detectedSequences[0]?.frames || []
    let detectedSequence: typeof detectedSequences[number] | undefined = detectedSequences[0]
    let imageSequencePreview: string | null = null
    let sequenceFps: number | undefined
    let sequenceTotalSize: number | undefined
    if (detectedSequence) {
      const wantsSequence = await askSequenceChoice(detectedSequence.frameCount)
      if (wantsSequence) {
        // window.prompt() is not supported in Electron's renderer. Use the
        // remembered FPS as the default; validation still gates encoding.
        sequenceFps = settings.sequenceFps && settings.sequenceFps > 0 ? settings.sequenceFps : 24
        sequenceTotalSize = await window.electronAPI?.getPathsTotalSize?.(sequenceCandidates)
        imageSequencePreview = await window.electronAPI?.createImageSequencePreview(sequenceCandidates, { fps: sequenceFps, duration: detectedSequence.frameCount / sequenceFps }) || null
      } else {
        // A single picked/dropped frame means exactly that frame, not all siblings.
        // Multi-file and folder imports intentionally retain all selected frames.
        detectedSequence = undefined
        if (originallySinglePath) filePaths = [droppedPath]
      }
    }
    // A detected image sequence is one video-like source. Do not fall through
    // to the ordinary multi-file CONVERT fan-out, or every frame becomes its
    // own queue job and the sequence disappears.
    if (jobType === 'transcode' && filePaths.length > 1 && !detectedSequence) {
      filePaths.forEach((filePath) => void addFilesToQueue([filePath], 'transcode', true))
      return
    }
    const videoCount = detectedSequence ? 1 : filePaths.filter((path) => mediaKind(path) !== 'audio').length
    const audioCount = filePaths.filter((path) => mediaKind(path) === 'audio').length
    const effectiveType: QueueTask['type'] = videoCount === 0 && audioCount > 1 ? 'stitch' : jobType === 'multitrack' && audioCount > 0 && videoCount > 0 ? (videoCount > 1 ? 'combo' : 'multitrack') : jobType
    const first = filePaths[0]
    const dir = first.substring(0, first.lastIndexOf('/'))
    const originalName = first.split('/').pop() || 'media'
    const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName
    const preset = DEFAULT_PRESETS[0]
    const suffix = preset.suffix ? `_${preset.suffix}` : ''
    const task: QueueTask = {
      id: Math.random().toString(36).substring(7), type: effectiveType, sourcePaths: detectedSequence && sequenceFps ? [detectedSequence.firstFrame] : effectiveType === 'stitch' && videoCount === 0 ? filePaths : effectiveType === 'stitch' || effectiveType === 'combo' || jobType === 'multitrack' ? filePaths.filter((path) => mediaKind(path) !== 'audio') : [first],
      outputDirectory: settings.defaultOutputDir || dir, outputFilename: `${baseName}${effectiveType === 'stitch' ? '_stitched' : effectiveType === 'combo' ? '_combo' : suffix}.${preset.container}`,
      preset, status: 'pending', progress: 0, sourceBaseName: baseName, stillImageDuration: mediaKind(first) === 'image' ? Math.max(0.1, settings.defaultImageDuration || 10) : undefined,
      additionalAudioTracks: (effectiveType === 'multitrack' || effectiveType === 'combo') ? filePaths.filter((path) => mediaKind(path) === 'audio').map((path, index) => ({ id: `${Date.now()}-${index}`, path, language: 'und' })) : undefined,
      imageSequencePreviews: imageSequencePreview && detectedSequence && sequenceFps
        // Filed under the key the editor will look it up by, which carries the rate and the frame
        // count the clip was built at. Written under the bare path instead, it was never found, and
        // every open rebuilt the whole sequence.
        ? { [sequencePreviewKey(detectedSequence.firstFrame, sequenceFps, detectedSequence.frameCount)]: imageSequencePreview }
        : undefined,
      sourceMetadata: stillFpsMetadata(filePaths, detectedSequence?.firstFrame, settings),
      sequenceInput: detectedSequence && sequenceFps ? { ...detectedSequence, fps: sequenceFps, duration: detectedSequence.frameCount / sequenceFps, totalSize: sequenceTotalSize } : undefined,
      sequenceInputs: detectedSequence && sequenceFps ? { [detectedSequence.firstFrame]: { ...detectedSequence, fps: sequenceFps, duration: detectedSequence.frameCount / sequenceFps } } : undefined,
    }
    setTasks((prev) => [...prev, task])
    setSelectedTaskId(task.id)
  }

  const handlePickFiles = async () => {
    void window.electronAPI?.diagnosticLog('file picker button clicked')
    if (window.electronAPI) {
      try {
        const files = await window.electronAPI.selectFiles()
        if (files.length > 0) setPendingFiles(files)
        return
      } catch (error) {
        console.error('Electron file picker failed:', error)
      }
    }
    fileInputRef.current?.click()
  }
  const handleFallbackFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    void window.electronAPI?.diagnosticLog('fallback picker changed', { count: event.target.files?.length || 0 })
    const files = Array.from(event.target.files || [])
      .map((file) => (file as File & { path?: string }).path)
      .filter((filePath): filePath is string => Boolean(filePath))
    if (files.length > 0) setPendingFiles(files)
    event.target.value = ''
  }

  const handleToggleQueue = () => {
    if (!isQueueRunning) {
      // Start processing pending tasks
      const pendingTasks = tasks.filter((t) => t.status === 'pending')
      const incompatible = pendingTasks.filter((t) => Boolean(validateModeSources(t.type, t.sourcePaths, t.additionalAudioTracks || [])))
      const encodable = pendingTasks.filter((t) => !incompatible.includes(t))
      encodable.forEach((t) => { window.electronAPI?.startTask(t) })
      if (incompatible.length) window.alert('Some jobs were not started because their current mode is incompatible with their sources.')
      window.electronAPI?.setQueueRunning(true)
      setIsQueueRunning(true)
    } else {
      window.electronAPI?.setQueueRunning(false)
      setIsQueueRunning(false)
    }
  }

  const handleEncodeSelected = () => {
    const selected = tasks.filter((task) => selectedTaskIds.includes(task.id) && task.status === 'pending' && !task.skipped)
    const incompatible = selected.filter((t) => Boolean(validateModeSources(t.type, t.sourcePaths, t.additionalAudioTracks || [])))
    const encodable = selected.filter((t) => !incompatible.includes(t))
    if (encodable.length) void window.electronAPI?.startSelectedTasks(encodable)
    if (incompatible.length) window.alert('Some selected jobs were not started because their current mode is incompatible with their sources.')
  }

  const handleAddStitchTask = (partial: Partial<QueueTask>) => {
    const firstClip = partial.sourcePaths?.[0] || ''
    const dir = firstClip.substring(0, firstClip.lastIndexOf('/')) || '/tmp'

    const newTask: QueueTask = {
      id: Math.random().toString(36).substring(7),
      type: 'stitch',
      sourcePaths: partial.sourcePaths || [],
      outputDirectory: settings.defaultOutputDir || dir,
      outputFilename: partial.outputFilename || 'stitched_output.mp4',
      preset: partial.preset || DEFAULT_PRESETS[0],
      status: 'pending',
      progress: 0,
    }

    setTasks((prev) => [...prev, newTask])
    setSelectedTaskId(newTask.id)
  }

  const handleAddMultiAudioTask = (partial: Partial<QueueTask>) => {
    const firstClip = partial.sourcePaths?.[0] || ''
    const dir = firstClip.substring(0, firstClip.lastIndexOf('/')) || '/tmp'

    const newTask: QueueTask = {
      id: Math.random().toString(36).substring(7),
      type: 'multitrack',
      sourcePaths: partial.sourcePaths || [],
      additionalAudioTracks: partial.additionalAudioTracks || [],
      outputDirectory: settings.defaultOutputDir || dir,
      outputFilename: partial.outputFilename || 'multitrack_video.mp4',
      preset: partial.preset || DEFAULT_PRESETS[0],
      status: 'pending',
      progress: 0,
    }

    setTasks((prev) => [...prev, newTask])
  }

  const handleRemoveTask = (taskId: string) => {
    window.electronAPI?.cancelTask(taskId)
    setTasks((prev) => {
      const removed = prev.filter((t) => t.id === taskId)
      if (removed.length) lastDeletedTasksRef.current = removed
      return prev.filter((t) => t.id !== taskId)
    })
    if (selectedTaskId === taskId) setSelectedTaskId(undefined)
    setSelectedTaskIds((ids) => ids.filter((id) => id !== taskId))
  }

  const handleClearDone = () => {
  }
  const handleDuplicateTask = (task: QueueTask) => {
    const duplicate = { ...task, id: Math.random().toString(36).substring(7), status: 'pending' as const, progress: 0, errorMessage: undefined }
    setTasks((prev) => [...prev, duplicate])
    setSelectedTaskId(duplicate.id)
  }
  const handleSkipTask = (task: QueueTask) => {
    setTasks((prev) => prev.map((item) => item.id === task.id
      ? item.skipped || item.status === 'done' || item.status === 'error'
        ? { ...item, status: 'pending' as const, skipped: false, errorMessage: undefined, progress: 0 }
        : { ...item, status: 'paused' as const, skipped: true }
      : item))
  }
  const handleSelectAll = () => setSelectedTaskIds(tasks.map((task) => task.id))
  const handleExpandAll = () => window.dispatchEvent(new Event('queue-expand-all'))
  const handleCollapseAll = () => window.dispatchEvent(new Event('queue-collapse-all'))


  /**
   * Timing changed from the queue's PROPERTIES. The same rule the EDIT JOB applies, so a
   * rate or a still's length set in either window leaves the task in the same state:
   * recorded against the source, the sequence's length re-derived, and any clip generated
   * at the old values thrown away rather than handed to the frame-accurate helper.
   */
  const handleChangeSourceTiming = (task: QueueTask, sourceKey: string, override: { fps?: number; seconds?: number }) => {
    setTasks((prev) => prev.map((item) => {
      if (item.id !== task.id) return item
      const wasDone = item.status === 'done'
      const next = withSourceTiming(item, sourceKey, override)
      return wasDone && next !== item ? { ...next, progress: 0 } : next
    }))
  }

  const handleChangeOutputName = async (task: QueueTask) => {
    const selected = await window.electronAPI?.selectOutputFilename(`${task.outputDirectory}/${task.outputFilename}`, task.preset.container)
    if (!selected) return
    const slash = selected.lastIndexOf('/')
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, outputDirectory: selected.substring(0, slash), outputFilename: selected.substring(slash + 1), outputFilenameManuallySet: true } : t))
  }
  const handleQuickLook = async (task: QueueTask) => {
    // A still that will become a timed clip opens in the advanced helper as a
    // generated clip, matching what the EDIT JOB window does.
    const request = await resolveQuickLookRequest(task, window.electronAPI, { preferTimedStill: true })
    if (!request) return
    if (request.regeneratedPreview) {
      const { sourceTarget, path: previewPath } = request.regeneratedPreview
      setTasks((current) => current.map((item) => item.id === task.id ? rememberPreview(item, sourceTarget, previewPath) : item))
    }
    void window.electronAPI?.quickLook(request.target, task.id, request.trimIn, request.trimOut, request.sourceIndex, request.stillMode, settings.screenshotDirectory, settings.timestampDisplayMode || 'timestamp', request.sequenceFps, request.sequenceFrameCount)
  }
  const handleRevealOutput = (task: QueueTask) => {
    if (window.electronAPI) {
      window.electronAPI.showItemInFolder(`${task.outputDirectory}/${task.outputFilename}`)
    }
  }

  const validateModeSources = (type: QueueTask['type'], sourcePaths: string[], tracks: { path: string }[] = []) => {
    const sequenceTask = tasks.find((task) => task.sourcePaths === sourcePaths || task.sourcePaths[0] === sourcePaths[0])
    if (sequenceTask?.sequenceInput && (!sequenceTask.sequenceInput.fps || sequenceTask.sequenceInput.fps <= 0)) return 'IMAGE SEQUENCE requires an interpretation FPS before encoding.'
    const videos = sourcePaths.filter((path) => mediaKind(path) !== 'audio')
    const audios = [...sourcePaths.filter((path) => mediaKind(path) === 'audio'), ...tracks.map((track) => track.path)]
    if (type === 'transcode' && (sourcePaths.length !== 1 || tracks.length > 0)) return 'CONVERT requires exactly one source and no added audio tracks.'
    const audioOnlyStitch = videos.length === 0 && sourcePaths.length >= 2 && tracks.length === 0
    if (type === 'stitch' && !audioOnlyStitch && (videos.length < 2 || audios.length > 0)) return 'STITCH UP requires at least two video/image sources and no audio tracks, or multiple audio sources.'
    if (type === 'multitrack' && (videos.length !== 1 || audios.length < 1)) return 'MULTI-TRACK requires exactly one video/image source and at least one audio track.'
    if (type === 'combo' && (videos.length < 1 || audios.length < 1)) return 'COMBO requires at least one video/image source and at least one audio track.'
    return null
  }
  const handleSelectTask = (task: QueueTask, shiftKey = false, additive = false) => {
    const anchorId = selectionAnchorRef.current || selectedTaskId || task.id
    if (!shiftKey && !additive) selectionAnchorRef.current = task.id
    setSelectedTaskId(task.id)
    setSelectedTaskIds((current) => {
      if (shiftKey) {
        const anchorIndex = tasks.findIndex((item) => item.id === anchorId)
        const targetIndex = tasks.findIndex((item) => item.id === task.id)
        if (anchorIndex < 0 || targetIndex < 0) return [task.id]
        const start = Math.min(anchorIndex, targetIndex)
        const end = Math.max(anchorIndex, targetIndex)
        const range = tasks.slice(start, end + 1).map((item) => item.id)
        return additive ? Array.from(new Set([...current, ...range])) : range
      }
      if (additive) return current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]
      return [task.id]
    })
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || tasks.length === 0) return
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
      const index = Math.max(0, tasks.findIndex((task) => task.id === selectedTaskId))
      const nextIndex = Math.min(tasks.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
      handleSelectTask(tasks[nextIndex], event.shiftKey, false)
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tasks, selectedTaskId])
  useEffect(() => {
    const onQueueKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const isUndo = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z'
      const isRedo = (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z'
      if (isUndo) { event.preventDefault(); handleUndo(); return }
      if (isRedo) { event.preventDefault(); handleRedo(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelectedTaskIds(tasks.map((task) => task.id))
        setSelectedTaskId(tasks[tasks.length - 1]?.id)
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const ids = selectedTaskIds.length ? selectedTaskIds : (selectedTaskId ? [selectedTaskId] : [])
        if (ids.length) {
          event.preventDefault()
          window.dispatchEvent(new CustomEvent('queue-toggle-sources', { detail: { ids, expanded: event.key === 'ArrowRight' } }))
        }
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setSelectedTaskIds([])
        setSelectedTaskId(undefined)
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const ids = selectedTaskIds.length ? selectedTaskIds : (selectedTaskId ? [selectedTaskId] : [])
      if (!ids.length) return
      event.preventDefault()
      const removed = tasks.filter((task) => ids.includes(task.id))
      if (removed.length) lastDeletedTasksRef.current = removed
      ids.forEach((id) => window.electronAPI?.cancelTask(id))
      setTasks((prev) => prev.filter((task) => !ids.includes(task.id)))
      setSelectedTaskIds([])
      setSelectedTaskId(undefined)
    }
    window.addEventListener('keydown', onQueueKey)
    return () => window.removeEventListener('keydown', onQueueKey)
  }, [tasks, selectedTaskId, selectedTaskIds])
  const handleChangeJobType = (task: QueueTask, type: QueueTask['type']) => {
    const ids = selectedTaskIds.length > 1 && selectedTaskIds.includes(task.id) ? selectedTaskIds : [task.id]
    setTasks((prev) => {
      const chosen = prev.filter((item) => ids.includes(item.id))
      if (type === 'transcode' && chosen.some((item) => item.type !== 'transcode')) {
        const split = chosen.flatMap((item) => {
          const ids = materializeClipIds(item)
          const itemNumbers = materializeClipNumbers(item)
          const trackPaths = (item.additionalAudioTracks || []).map((track) => track.path)
          return [...item.sourcePaths, ...trackPaths].map((sourcePath, index) => {
            // A source keeps its own id, and a promoted track keeps the legacy key its records already have.
            const key = index < item.sourcePaths.length ? ids[index] : legacyClipId(sourcePath, 0)
            const number = index < item.sourcePaths.length ? itemNumbers[index] : 1
            return {
              ...item, id: `${item.id}-${index}-${Date.now()}`, type: 'transcode' as const,
              sourcePaths: [sourcePath], clipIds: [key], clipNumbers: [number], additionalAudioTracks: undefined,
              ...clipRecordsFor(item, key, sourcePath),
              outputFilename: `${sourcePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'output'}_${item.preset.suffix || item.preset.id}.${item.preset.container}`,
              status: 'pending' as const, progress: 0,
            }
          })
        })
        setSelectedTaskIds(split.map((item) => item.id)); setSelectedTaskId(split[0]?.id); return [...prev.filter((item) => !ids.includes(item.id)), ...split]
      }
      if (type === 'stitch' && chosen.length === 1 && (chosen[0].type === 'combo' || chosen[0].type === 'multitrack')) {
        const item = chosen[0]
        const visual = item.sourcePaths.filter((source) => mediaKind(source) !== 'audio')
        const audio = (item.additionalAudioTracks || []).map((track) => track.path)
        const makeJob = (paths: string[], suffix: string, index: number) => ({ ...item, id: `${item.id}-stitch-${index}-${Date.now()}`, type: 'stitch' as const, sourcePaths: paths, clipIds: matchClipIdsToPaths(item.sourcePaths, materializeClipIds(item), paths), clipNumbers: matchClipNumbersToPaths(item.sourcePaths, materializeClipNumbers(item), paths), additionalAudioTracks: undefined, trimPoints: undefined, transitions: undefined, sourceFit: undefined, sourceCrop: undefined, sourceSpeed: undefined, sourceFps: undefined, outputFilename: `${item.sourceBaseName || suffix}_${suffix}.${item.preset.container}`, status: 'pending' as const, progress: 0 })
        const split = [visual.length > 0 ? makeJob(visual, 'video', 0) : null, audio.length > 0 ? makeJob(audio, 'audio', 1) : null].filter(Boolean) as QueueTask[]
        setSelectedTaskIds(split.map((job) => job.id)); setSelectedTaskId(split[0]?.id); return [...prev.filter((candidate) => candidate.id !== item.id), ...split]
      }
      if (ids.length > 1 && type !== 'transcode') {
        const base = chosen[0]
        const allSources = chosen.flatMap((item) => item.sourcePaths)
        const allTracks = chosen.flatMap((item) => item.additionalAudioTracks || [])
        const wantsTracks = type === 'multitrack' || type === 'combo'
        // The encoder takes its video from sourcePaths[0] and muxes only
        // additionalAudioTracks, so an audio source left in sourcePaths would be
        // listed as a video input and then silently dropped from the output.
        const visualSources = allSources.filter((source) => mediaKind(source) !== 'audio')
        const audioSources = allSources.filter((source) => mediaKind(source) === 'audio')
        const mergedPaths = wantsTracks && visualSources.length ? visualSources : allSources
        const merged = {
          ...base,
          type,
          comboMode: type === 'combo' ? 'multitrack' as const : undefined,
          sourcePaths: mergedPaths,
          // The ids are matched across the jobs being merged, so a clip keeps its own records through the
          // merge — though the fades and fits below are dropped because a reshuffled list is a new set of CUTS.
          clipIds: matchClipIdsToPaths(chosen.flatMap((item) => item.sourcePaths), chosen.flatMap((item) => materializeClipIds(item)), mergedPaths),
          clipNumbers: matchClipNumbersToPaths(chosen.flatMap((item) => item.sourcePaths), chosen.flatMap((item) => materializeClipNumbers(item)), mergedPaths),
          additionalAudioTracks: wantsTracks
            ? [...allTracks, ...audioSources.map((source, index) => ({ id: `${base.id}-audio-source-${index}-${Date.now()}`, path: source, language: 'und' }))]
            : undefined,
          // Clips are reshuffled here, so index-scoped fades and fits can no longer be trusted.
          transitions: undefined,
          sourceFit: undefined,
          sourceSpeed: undefined, sourceFps: undefined,
          status: 'pending' as const,
          progress: 0,
          outputFilename: `${base.sourceBaseName || 'merged'}_${type === 'stitch' ? 'stitched' : 'multitrack'}.${base.preset.container}`,
        }
        setSelectedTaskIds([merged.id]); setSelectedTaskId(merged.id); return [...prev.filter((item) => !ids.includes(item.id)), merged]
      }
      return prev.map((item) => {
        if (item.id !== task.id) return item
        const itemIds = materializeClipIds(item)
        const itemNumbers = materializeClipNumbers(item)
        if (type === 'multitrack' || type === 'combo') {
          const visualSources = item.sourcePaths.filter((source) => mediaKind(source) !== 'audio')
          const audioSources = item.sourcePaths.filter((source) => mediaKind(source) === 'audio')
          const existingTracks = item.additionalAudioTracks || []
          const addedTracks = audioSources.map((source, index) => ({ id: `${item.id}-audio-source-${index}-${Date.now()}`, path: source, language: 'und' }))
          return { ...item, type, comboMode: type === 'combo' ? 'multitrack' as const : undefined, sourcePaths: visualSources, clipIds: matchClipIdsToPaths(item.sourcePaths, itemIds, visualSources), clipNumbers: matchClipNumbersToPaths(item.sourcePaths, itemNumbers, visualSources), additionalAudioTracks: [...existingTracks, ...addedTracks], trimPoints: undefined, transitions: undefined, sourceFit: undefined, sourceCrop: undefined, sourceSpeed: undefined, sourceFps: undefined, status: 'pending' as const, progress: 0 }
        }
        if (type === 'stitch') {
          const fallbackAudio = item.sourcePaths.length ? item.sourcePaths : (item.additionalAudioTracks || []).map((track) => track.path)
          return { ...item, type, sourcePaths: fallbackAudio, clipIds: item.sourcePaths.length ? itemIds : fallbackAudio.map((path) => legacyClipId(path, 0)), clipNumbers: item.sourcePaths.length ? itemNumbers : fallbackAudio.map(() => 1), additionalAudioTracks: undefined, trimPoints: undefined, transitions: undefined, sourceFit: undefined, sourceCrop: undefined, sourceSpeed: undefined, sourceFps: undefined, status: 'pending' as const, progress: 0 }
        }
        const fallbackSource = item.sourcePaths[0] || item.additionalAudioTracks?.[0]?.path
        const nextPaths = fallbackSource ? [fallbackSource] : item.sourcePaths
        return { ...item, type: 'transcode', comboMode: undefined, sourcePaths: nextPaths, clipIds: matchClipIdsToPaths(item.sourcePaths, itemIds, nextPaths), clipNumbers: matchClipNumbersToPaths(item.sourcePaths, itemNumbers, nextPaths), additionalAudioTracks: undefined, trimPoints: undefined, transitions: undefined, sourceFit: undefined, sourceCrop: undefined, sourceSpeed: undefined, sourceFps: undefined, status: 'pending' as const, progress: 0 }
      })
    })
  }
  const handleChangeComboMode = (task: QueueTask, mode: 'multitrack' | 'stitch') => {
    setTasks((prev) => prev.map((item) => item.id === task.id ? { ...item, comboMode: mode, status: item.status === 'done' ? 'pending' : item.status, progress: 0 } : item))
  }
  const handleAddToExisting = async (task: QueueTask, filePaths: string[]) => {
    const expandedPaths = window.electronAPI?.expandMediaPaths
      ? await window.electronAPI.expandMediaPaths(filePaths)
      : filePaths
    if (expandedPaths.length === 0) {
      window.alert('No compatible media files were found in the dropped item.')
      return
    }
    filePaths = expandedPaths
    const originallySelectedExistingPath = filePaths[0]
    const originallySingleExistingSource = filePaths.length === 1
    if (originallySingleExistingSource && isImagePath(filePaths[0]) && /\d+\D*\.[^.]+$/.test(filePaths[0].split(/[\\/]/).pop() || '') && window.electronAPI?.listSiblingFiles) {
      try {
        const siblings = await window.electronAPI.listSiblingFiles(filePaths[0])
        if (detectSequences(siblings, { minFrames: 2 }).some((sequence) => sequence.files.includes(filePaths[0]))) filePaths = siblings
      } catch {}
    }
    const incomingDetected = detectSequences(filePaths)
    const incomingSequence = incomingDetected[0]
    let incomingSequencePreview: string | null = null
    let incomingSequenceInput: QueueTask['sequenceInput'] | undefined
    if (incomingSequence) {
      const wholeSequence = await askSequenceChoice(incomingSequence.frameCount)
      if (wholeSequence) {
        const fps = settings.sequenceFps && settings.sequenceFps > 0 ? settings.sequenceFps : 24
        const totalSize = await window.electronAPI?.getPathsTotalSize?.(incomingSequence.frames)
        incomingSequencePreview = await window.electronAPI?.createImageSequencePreview(incomingSequence.frames, { fps, duration: incomingSequence.frameCount / fps }) || null
        incomingSequenceInput = { ...incomingSequence, fps, duration: incomingSequence.frameCount / fps, totalSize }
        filePaths = filePaths.filter((filePath) => !incomingSequence.files.includes(filePath))
        filePaths = [incomingSequence.firstFrame, ...filePaths]
      } else if (originallySingleExistingSource) {
        filePaths = [originallySelectedExistingPath]
      }
    }
    setTasks((prev) => prev.map((item) => {
      if (item.id !== task.id || item.status === 'encoding') return item
      const incomingVideos = filePaths.filter((filePath) => mediaKind(filePath) !== 'audio')
      const incomingAudios = filePaths.filter((filePath) => mediaKind(filePath) === 'audio')
      const existingVideos = item.sourcePaths.filter((source) => mediaKind(source) !== 'audio')
      const existingAudioPaths = item.sourcePaths.filter((source) => mediaKind(source) === 'audio')
      const videoSources = [...existingVideos, ...incomingVideos]
      const tracks = [...existingAudioPaths.map((path, index) => ({ id: `${item.id}-source-audio-${index}`, path, language: 'und' })), ...(item.additionalAudioTracks || []).filter((track) => !existingAudioPaths.includes(track.path)), ...incomingAudios.map((path, index) => ({ id: `${Date.now()}-${index}`, path, language: 'und' }))]
      const allAudioSources = [...existingAudioPaths, ...incomingAudios]
      const nextType: QueueTask['type'] = videoSources.length === 0 ? (allAudioSources.length > 1 ? 'stitch' : 'transcode') : tracks.length ? (videoSources.length > 1 ? 'combo' : 'multitrack') : (videoSources.length > 1 ? 'stitch' : 'transcode')
      const stableNextType = item.type === 'multitrack' && videoSources.length === 1 && tracks.length > 0 ? 'multitrack' as const : nextType
      const sequenceKey = incomingSequenceInput?.firstFrame || incomingVideos[0]
      const incomingStillFps = stillFpsMetadata(incomingVideos, sequenceKey, settings)
      const sourceMetadata = incomingStillFps ? { ...(item.sourceMetadata || {}), ...incomingStillFps } : item.sourceMetadata
      const resetCompleted = item.status === 'done' || item.skipped
      const nextPaths = videoSources.length ? videoSources : allAudioSources
      return { ...item, type: stableNextType, comboMode: stableNextType === 'combo' ? (item.comboMode || 'multitrack') : undefined, sourcePaths: nextPaths, clipIds: matchClipIdsToPaths(item.sourcePaths, materializeClipIds(item), nextPaths), clipNumbers: matchClipNumbersToPaths(item.sourcePaths, materializeClipNumbers(item), nextPaths), additionalAudioTracks: videoSources.length && tracks.length ? tracks : undefined, imageSequencePreviews: incomingSequencePreview && sequenceKey && incomingSequenceInput ? { ...(item.imageSequencePreviews || {}), [sequencePreviewKey(sequenceKey, incomingSequenceInput.fps, incomingSequenceInput.frameCount)]: incomingSequencePreview } : item.imageSequencePreviews, sequenceInput: item.sequenceInput || incomingSequenceInput, sequenceInputs: incomingSequenceInput && sequenceKey ? { ...(item.sequenceInputs || {}), [sequenceKey]: incomingSequenceInput } : item.sequenceInputs, sourceMetadata, status: resetCompleted ? 'pending' : item.status, skipped: resetCompleted ? false : item.skipped, progress: 0 }
    }))
  }
  const handleAddSource = async (task: QueueTask) => {
    const files = await window.electronAPI?.selectFiles()
    if (files?.length) handleAddToExisting(task, files)
  }
  const handleReplaceSource = async (task: QueueTask, sourcePath: string, sourceIndex?: number) => {
    const files = await window.electronAPI?.selectFiles()
    if (!files?.length) return
    setTasks((prev) => prev.map((item) => {
      if (item.id !== task.id) return item
      // By PLACE rather than by path: two segments of one file are two clips, and a filter on the path took
      // both of them out and left one behind. The replacement is a DIFFERENT file, so it gets an id of its
      // own — its records are its own and none of the old clip's follow it.
      const at = sourceIndex ?? item.sourcePaths.indexOf(sourcePath)
      if (at < 0 || at >= item.sourcePaths.length) return item
      const sourcePaths = [...item.sourcePaths]
      const clipIds = materializeClipIds(item)
      const clipNumbers = materializeClipNumbers(item)
      sourcePaths[at] = files[0]
      clipIds[at] = newClipId()
      clipNumbers[at] = nextClipNumber(item, files[0])
      return { ...item, sourcePaths, clipIds, clipNumbers, status: 'pending' as const, progress: 0 }
    }))
    if (files.length > 1) handleAddToExisting(task, files.slice(1))
  }
  const handleReorderSources = (task: QueueTask, sourcePaths: string[], from?: number, to?: number) => {
    setTasks((prev) => prev.map((item) => {
      if (item.id !== task.id) return item
      // The move is applied to the ID LIST, which is the same splice the paths took, so each id stays with
      // its clip and nothing else has to move: trims, fades, fits, crops, speeds and rates are filed under
      // ids, and the ids went where the clips went. A legacy job's ids are written down first, or they would
      // shift with the places they were standing in for.
      const clipIds = from != null && to != null ? moveClipIds(materializeClipIds(item), from, to) : item.clipIds
      // The number travels the same way, so `CLIP 1` stays on the clip it named.
      const clipNumbers = from != null && to != null ? moveAlong(materializeClipNumbers(item), from, to) : item.clipNumbers
      return { ...item, sourcePaths, clipIds, clipNumbers, status: item.status === 'done' ? 'pending' as const : item.status }
    }))
  }
  const handleReorderTracks = (task: QueueTask, tracks: NonNullable<QueueTask['additionalAudioTracks']>) => {
    setTasks((prev) => prev.map((item) => item.id === task.id ? { ...item, additionalAudioTracks: tracks, status: item.status === 'done' ? 'pending' as const : item.status } : item))
  }
  const handleReorderTasks = (nextTasks: QueueTask[]) => setTasks(nextTasks)
  /**
   * Takes a source out of a job, from the queue's card or from the editor's timeline.
   *
   * A removal that would leave the job with nothing to encode takes the JOB out instead, and the
   * editor window is closed with it: leaving a window open on a job that no longer exists is worse
   * than the removal looking drastic.
   */
  const handleRemoveSource = (task: QueueTask, sourcePath: string, sourceIndex?: number) => {
    const changed = removeSourceFromTask(task, sourcePath, sourceIndex)
    if (!changed) {
      setTasks((prev) => prev.filter((item) => item.id !== task.id))
      if (editJobTaskIdRef.current === task.id) void window.electronAPI?.cancelEditJob()
      return
    }
    setTasks((prev) => prev.map((item) => item.id === task.id ? changed : item))
  }
  const handleApplyPreset = (newPreset: EncodingPreset) => {
    if (!activeTaskForPreset) return
    const targetIds = selectedTaskIds.length > 1 ? selectedTaskIds : [activeTaskForPreset.id]
    setTasks((prev) =>
      prev.map((t) => {
        if (targetIds.includes(t.id)) {
          return {
            ...t,
            preset: newPreset,
            status: t.status === 'done' ? 'pending' : t.status,
            outputFilename: deriveOutputFilename(t, newPreset),
          }
        }
        return t
      })
    )
  }


  useEffect(() => {
    const unsubscribe = window.electronAPI?.onQuickLookTrimmed((taskId, trimmedPath) => {
      setTasks((current) => current.map((task) => task.id === taskId
        ? { ...task, sourcePaths: [...task.sourcePaths, trimmedPath], status: 'pending', progress: 0, errorMessage: undefined }
        : task))
    })
    return () => unsubscribe?.()
  }, [])

  return (
    <div data-theme={theme === 'modern' ? 'modern' : undefined} className="h-screen w-screen flex flex-col bg-mac-bg text-neutral-100 font-sans overflow-hidden">
      <input ref={fileInputRef} type="file" multiple accept="video/*,audio/*,image/*,.mkv,.avi,.flv,.m4a,.flac,.jpg,.jpeg,.png,.tif,.tiff,.heic" onChange={handleFallbackFileChange} className="hidden" aria-hidden="true" />
      <Header
        isQueueRunning={isQueueRunning}
        onToggleQueue={handleToggleQueue}
        onAddFiles={handlePickFiles}
        onOpenStitcher={() => setIsStitchOpen(true)}
        onOpenMultiTrack={() => setIsMultiAudioOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onClearDone={handleClearDone}
        taskCount={tasks.length}
        canStartQueue={tasks.some((task) => task.status === 'pending')}
      />

      <div className="flex flex-1 min-h-0 min-w-0">
        <QueueList
        tasks={tasks.filter((task) => { const status = task.status === 'done' ? 'done' : task.skipped ? 'skip' : 'ready'; return statusFilters[status] })}
        missingSources={missingSources}
        selectedTaskIds={selectedTaskIds}
        onSelectTask={handleSelectTask}
        onOpenEditor={handleOpenEditJob}
        onAddToExisting={handleAddToExisting}
        onAddSource={handleAddSource}
        onRemoveSource={handleRemoveSource}
        onReorderSources={handleReorderSources}
        onReorderTracks={handleReorderTracks}
        onReorderTasks={handleReorderTasks}
        onReplaceSource={handleReplaceSource}
        onChangeJobType={handleChangeJobType}
        onChangeComboMode={handleChangeComboMode}
        onOpenPresetPicker={(t) => {
          if (selectedTaskIds.length <= 1 || !selectedTaskIds.includes(t.id)) { setSelectedTaskIds([t.id]); selectionAnchorRef.current = t.id }
          setSelectedTaskId(t.id)
          setActiveTaskForPreset(t)
        }}
        onRemoveTask={handleRemoveTask}
        onRevealOutput={handleRevealOutput}
        onQuickLook={handleQuickLook}
        onChangeSourceTiming={handleChangeSourceTiming}
        onChangeOutputName={handleChangeOutputName}
        onDuplicateTask={handleDuplicateTask}
        onSkipTask={handleSkipTask}
        onSelectAll={handleSelectAll}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        onEncodeSelected={handleEncodeSelected}
        onAddFiles={handlePickFiles}
        onFileDrop={addFilesToQueue}
        />
        </div>
      {sequenceChoice && <div className="drop-chooser sequence-choice-dialog" role="dialog" aria-label="Choose image import mode"><div className="drop-chooser-box"><span className="panel-kicker">IMPORT // IMAGE INTERPRETATION</span><h2>WHAT SHOULD THIS BECOME?</h2><div className="drop-chooser-grid"><button onClick={() => { sequenceChoice.resolve(true); setSequenceChoice(null) }}><span>SEQUENCE</span><small>{sequenceChoice.frames} FRAMES / TIMELINE SOURCE</small></button><button onClick={() => { sequenceChoice.resolve(false); setSequenceChoice(null) }}><span>IMAGE</span><small>IMPORT ONLY THE SELECTED IMAGE(S)</small></button></div><button className="chooser-cancel" onClick={() => { sequenceChoice.resolve(false); setSequenceChoice(null) }}>CANCEL</button></div></div>}
      {pendingFiles && <div className="drop-chooser" role="dialog" aria-label="Choose job type"><div className="drop-chooser-box"><span className="panel-kicker">ADD MEDIA // SELECT JOB TYPE</span><h2>WHAT SHOULD THIS BECOME?</h2><div className="drop-chooser-grid"><button onClick={() => { addFilesToQueue(pendingFiles, 'transcode'); setPendingFiles(null) }}><span>CONVERT</span><small>ONE SOURCE / TRANSCODE</small></button><button onClick={() => { addFilesToQueue(pendingFiles, 'stitch'); setPendingFiles(null) }}><span>STITCH UP</span><small>{pendingFiles.length} CLIP(S) IN ORDER</small></button><button onClick={() => { addFilesToQueue(pendingFiles, 'multitrack'); setPendingFiles(null) }}><span>MULTI-TRACK</span><small>VIDEO + AUDIO TRACKS</small></button><button onClick={() => { addFilesToQueue(pendingFiles, 'combo'); setPendingFiles(null) }}><span>COMBO</span><small>VIDEO + AUDIO IN ONE JOB</small></button></div><button className="chooser-cancel" onClick={() => setPendingFiles(null)}>CANCEL</button></div></div>}
      {/* Preset Modal */}
      {activeTaskForPreset && (
        <PresetModal
          isOpen={!isCustomOpen}
          currentPreset={activeTaskForPreset.preset}
          jobType={activeTaskForPreset.type}
          inputKind={activeTaskForPreset.sequenceInput || Object.keys(activeTaskForPreset.sequenceInputs || {}).length > 0 ? 'sequence' : activeTaskForPreset.sourcePaths.some((path) => isImagePath(path)) ? 'image' : 'video'}
          onSelectPreset={handleApplyPreset}
          onClose={() => setActiveTaskForPreset(null)}
          onOpenCustom={() => {
            if (activeTaskForPreset) handleOpenEditJob(activeTaskForPreset)
            setIsCustomOpen(false)
            setActiveTaskForPreset(null)
          }}
        />
      )}

      {/* Multi-clip Stitching Concat Modal */}
      <StitchModal
        isOpen={isStitchOpen}
        onClose={() => setIsStitchOpen(false)}
        onAddStitchTask={handleAddStitchTask}
      />

      {/* Multi-Track Audio Muxer Modal */}
      <MultiAudioModal
        isOpen={isMultiAudioOpen}
        onClose={() => setIsMultiAudioOpen(false)}
        onAddMultiAudioTask={handleAddMultiAudioTask}
      />

      {notice && <div className="retro-notice-overlay" role="alertdialog" aria-modal="true"><div className="retro-notice"><span className="panel-kicker">STITCH UP MEDIA // NOTICE</span><h2>{notice.title}</h2><p>{notice.message.split('\n').map((line, index) => <React.Fragment key={`${line}-${index}`}>{index > 0 && <br />}{line}</React.Fragment>)}</p><button onClick={() => setNotice(null)}>OK</button></div></div>}
      {/* Settings Modal */}
      <CommandBar statusFilters={statusFilters} onToggleStatus={(status) => setStatusFilters((current) => ({ ...current, [status]: !current[status] }))} stats={{ ready: tasks.filter((task) => task.status === 'pending').length, skip: tasks.filter((task) => task.skipped || task.status === 'paused').length, done: tasks.filter((task) => task.status === 'done').length }} canStartQueue={tasks.some((task) => task.status === 'pending')} onOpen={handlePickFiles} onConvert={handleToggleQueue} onAdvanced={() => setIsSettingsOpen(true)} onToggleTheme={() => setTheme((current) => current === 'retro' ? 'modern' : 'retro')} theme={theme} isQueueRunning={isQueueRunning} />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={(newSettings) => {
          setSettings(newSettings)
          window.electronAPI?.saveSettings(newSettings)
        }}
      />
    </div>
  )
}

export default App
