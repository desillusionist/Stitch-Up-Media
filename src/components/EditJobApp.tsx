import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AppSettings, EditJobPatch, EncodingPreset, QueueTask, TransitionType } from '../types'
import { deriveOutputFilename } from '../lib/outputNaming'
import { mediaKind } from '../lib/mediaKind'
import { applyContainerChange, IMAGE_CONTAINERS } from '../lib/containerSwitch'
import { resolveQuickLookRequest } from '../lib/quickLookTarget'
import { mediaUrl } from '../lib/mediaUrl'
import { buildTimeline, frameStamp, isStillFrameJob, maxFadeAtBoundary, sequenceFor, sourceDuration, sourceFps, SourceTiming, timecode, TimelineLane, TimelineModel, TimelineSegment } from '../lib/timelineModel'
import { useConsolidatedPlayback } from '../hooks/useConsolidatedPlayback'

const tabs = ['EXPORT', 'VIDEO', 'AUDIO', 'EFFECTS', 'CAPTIONS'] as const
type Tab = typeof tabs[number]

const CONTAINERS: Array<EncodingPreset['container']> = ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'flac', 'png', 'jpg', 'gif']
const VIDEO_CODECS: Array<EncodingPreset['videoCodec']> = ['copy', 'h264', 'hevc', 'prores', 'vp9', 'av1', 'png', 'mjpeg']
const AUDIO_CODECS: Array<EncodingPreset['audioCodec']> = ['copy', 'aac', 'mp3', 'opus', 'pcm', 'flac']
const AUDIO_CONTAINERS: Array<EncodingPreset['container']> = ['mp3', 'wav', 'm4a', 'flac']
const RESOLUTIONS: Array<EncodingPreset['resolution']> = ['source', '4k', '1080p', '720p']

/** Lane label column width. Mirrored in CSS and in the playhead offset. */
const LANE_LABEL_WIDTH = 102
const ZOOM_MIN = 1
const ZOOM_MAX = 8
/** K plus J/L held this long becomes slow motion; a shorter press steps a frame. */
const TAP_THRESHOLD_MS = 250
const SLOW_MOTION_RATE = 0.5

/** The fields this window owns. Everything else on a task belongs to the queue. */
const editableSlice = (task: QueueTask) => ({
  preset: task.preset,
  outputFilename: task.outputFilename,
  outputFilenameManuallySet: task.outputFilenameManuallySet ?? false,
  transitions: task.transitions,
})

const sliceSignature = (task: QueueTask) => JSON.stringify(editableSlice(task))
const isDirty = (draft: QueueTask, baseline: QueueTask) => sliceSignature(draft) !== sliceSignature(baseline)

const sourceName = (filePath?: string) => filePath?.split('/').pop() || 'UNTITLED'

const EditorRow: React.FC<{ label: string; value: React.ReactNode; reason?: string }> = ({ label, value, reason }) => (
  <div className="editor-row" title={reason}><span>{label}</span><strong>{value}</strong></div>
)

const EditorField: React.FC<{ label: string; hint?: string; reason?: string; children: React.ReactNode }> = ({ label, hint, reason, children }) => (
  <label className="editor-field" title={reason}><span>{label}{hint ? <em>{hint}</em> : null}</span>{children}</label>
)

const EditorToggle: React.FC<{ label: string; checked: boolean; onChange?: (checked: boolean) => void; reason?: string }> = ({ label, checked, onChange, reason }) => (
  <label className={`editor-toggle${onChange ? '' : ' is-locked'}`} title={reason}>
    <span>{label}</span>
    <input type="checkbox" checked={checked} disabled={!onChange} onChange={(event) => onChange?.(event.target.checked)} />
  </label>
)

export const EditJobApp: React.FC = () => {
  const [baseline, setBaseline] = useState<QueueTask | null>(null)
  const [draft, setDraft] = useState<QueueTask | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [tab, setTab] = useState<Tab>('EXPORT')
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [incomingConflict, setIncomingConflict] = useState<QueueTask | null>(null)
  // Where the resolved preview target points, which is not always the stored
  // source path: sequences play through a generated preview file.
  const [mediaTarget, setMediaTarget] = useState<{ path: string; sourcePath: string } | null>(null)
  // Mirrors of the editable state so the IPC listener can decide without stale closures.
  const draftRef = useRef<QueueTask | null>(null)
  const baselineRef = useRef<QueueTask | null>(null)
  const audioElementsRef = useRef<Record<string, HTMLAudioElement | null>>({})
  const [probedTiming, setProbedTiming] = useState<Record<string, SourceTiming>>({})
  // Paths already handed to the prober. A failed probe is not retried, so the
  // effect cannot loop on an unreadable file.
  const probedPathsRef = useRef<Set<string>>(new Set())
  // Horizontal scale only: lane widths stay proportional to real durations.
  const [zoom, setZoom] = useState(1)
  /** Boundary whose transition editor is open, by index of the clip it follows. */
  const [openBoundary, setOpenBoundary] = useState<number | null>(null)
  // Monitoring state only. Never written to the task, so muting can never be
  // mistaken for a mix-down decision.
  const [muted, setMuted] = useState<Record<string, boolean>>({})
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const timelineInnerRef = useRef<HTMLDivElement>(null)

  const commit = (nextBaseline: QueueTask | null, nextDraft: QueueTask | null) => {
    baselineRef.current = nextBaseline
    draftRef.current = nextDraft
    setBaseline(nextBaseline)
    setDraft(nextDraft)
  }

  useEffect(() => {
    void window.electronAPI?.getSettings().then((loaded) => { if (loaded) setSettings(loaded) })
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onEditJobTask((incoming) => {
      const currentDraft = draftRef.current
      const currentBaseline = baselineRef.current
      if (!currentDraft || !currentBaseline) {
        setIncomingConflict(null)
        baselineRef.current = incoming
        draftRef.current = incoming
        setBaseline(incoming)
        setDraft(incoming)
        return
      }
      const userDirty = sliceSignature(currentDraft) !== sliceSignature(currentBaseline)
      // Only the fields this window owns can conflict; trim points, probe results
      // and source order arrive from the queue and should just be adopted.
      if (userDirty && JSON.stringify(editableSlice(incoming)) !== JSON.stringify(editableSlice(currentBaseline))) {
        setIncomingConflict(incoming)
      }
      const merged = userDirty ? { ...incoming, ...editableSlice(currentDraft) } : incoming
      baselineRef.current = incoming
      draftRef.current = merged
      setBaseline(incoming)
      setDraft(merged)
    })
    return () => unsubscribe?.()
  }, [])

  // Rebuilding is cheap but churns identities, so it is keyed to the inputs that
  // actually change the timeline.
  const timelineSignature = draft ? JSON.stringify([
    draft.type, draft.sourcePaths, draft.additionalAudioTracks, draft.trimPoints,
    draft.sourceMetadata, draft.sequenceInput, draft.sequenceInputs, draft.sourceInfo,
    draft.preset.fps, draft.stillImageDuration, draft.transitions,
  ]) : ''

  // Nothing in the app ever populates `sourceInfo` or `sourceMetadata`, so a source
  // without intrinsic timing (audio tracks especially) has to be probed before it
  // can be drawn or played at its real length.
  const candidateSources = draft ? Array.from(new Set([
    ...(draft.type === 'stitch' ? draft.sourcePaths : draft.sourcePaths.slice(0, 1)),
    ...(draft.additionalAudioTracks || []).map((track) => track.path),
  ])) : []
  const probeSignature = candidateSources.join('\u0000')

  useEffect(() => {
    const task = draftRef.current
    if (!task) return
    const missing = candidateSources.filter((sourcePath) => !probedPathsRef.current.has(sourcePath) && sourceDuration(task, sourcePath) <= 0)
    if (!missing.length) return
    missing.forEach((sourcePath) => probedPathsRef.current.add(sourcePath))
    let cancelled = false
    void Promise.all(missing.map(async (sourcePath) => {
      try {
        const info = await window.electronAPI?.probeMedia(sourcePath)
        return [sourcePath, { duration: info?.duration ?? 0, fps: info?.videoStreams?.[0]?.fps }] as const
      } catch {
        return [sourcePath, { duration: 0 }] as const
      }
    })).then((entries) => {
      if (!cancelled) setProbedTiming((current) => ({ ...current, ...Object.fromEntries(entries) }))
    })
    return () => { cancelled = true }
  }, [probeSignature])

  const resolveTiming = (sourcePath: string): SourceTiming | undefined => probedTiming[sourcePath]
  const model: TimelineModel | null = useMemo(
    () => (draft ? buildTimeline(draft, { resolveTiming }) : null),
    [timelineSignature, probedTiming],
  )
  // Frame rate of the primary source, for stepping and reverse. Kept separate from
  // the displayed rate because the hook is created before a segment is known.
  const primaryFps = draft ? sourceFps(draft, draft.sourcePaths[0], undefined, resolveTiming) : 25

  const playback = useConsolidatedPlayback(
    model ?? { lanes: [], duration: 0, unusedVideoSources: [] },
    audioElementsRef,
    { playable: Boolean(model && model.duration > 0), fps: primaryFps },
  )

  const focusedSourceIndex = playback.segmentIndex
  const focusedSource = draft ? (draft.sourcePaths[focusedSourceIndex] || draft.sourcePaths[0]) : undefined

  // Sequence frames and standalone images cannot be decoded by a video element, so
  // the target is resolved to a generated preview for whichever source is in focus.
  useEffect(() => {
    let cancelled = false
    const task = draftRef.current
    if (!task) { setMediaTarget(null); return }
    void resolveQuickLookRequest(task, window.electronAPI, { sourceIndex: focusedSourceIndex }).then((request) => {
      if (cancelled) return
      setMediaTarget(request ? { path: request.target, sourcePath: task.sourcePaths[focusedSourceIndex] || task.sourcePaths[0] || '' } : null)
    })
    return () => { cancelled = true }
  }, [timelineSignature, focusedSourceIndex])

  const timelineDuration = model?.duration ?? 0
  const playheadFraction = timelineDuration > 0 ? Math.max(0, Math.min(1, playback.position / timelineDuration)) : 0
  const audioLaneIds = (model?.lanes ?? []).filter((lane) => !lane.embedded).map((lane) => lane.id).join('|')
  const fps = draft ? sourceFps(draft, playback.segment?.sourcePath ?? draft.sourcePaths[0], undefined, resolveTiming) : 25
  // A lone image that is not an interpreted sequence, which is what a container
  // change can turn into a single frame or into a timed clip.
  const singleFrameSource = Boolean(draft && draft.sourcePaths.length === 1 && mediaKind(draft.sourcePaths[0]) === 'image' && !sequenceFor(draft, draft.sourcePaths[0]))
  const playbackRef = useRef(playback)
  playbackRef.current = playback
  const stepFpsRef = useRef(fps)
  stepFpsRef.current = Math.max(1, fps)

  // The monitor fades through black exactly where the encoder will, since both
  // read the same applied fade on the segment.
  const activeSegment = playback.segment
  const segmentLocalTime = activeSegment ? playback.position - activeSegment.start : 0
  const previewGain = (() => {
    if (!activeSegment) return 1
    let gain = 1
    if (activeSegment.fadeIn && segmentLocalTime < activeSegment.fadeIn) gain = Math.min(gain, Math.max(0, segmentLocalTime / activeSegment.fadeIn))
    if (activeSegment.fadeOut && segmentLocalTime > activeSegment.duration - activeSegment.fadeOut) gain = Math.min(gain, Math.max(0, (activeSegment.duration - segmentLocalTime) / activeSegment.fadeOut))
    return Math.max(0, Math.min(1, gain))
  })()

  /**
   * One keyboard layer for the transport. Only genuine text entry is ignored: a
   * focused range slider stays live, because placing the playhead leaves focus on
   * the scrubber, and treating that as typing swallowed every shortcut.
   */
  const heldKeysRef = useRef({ k: false })
  const slowMotionRef = useRef(false)
  const tapTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const clearTap = () => {
      if (tapTimerRef.current != null) { window.clearTimeout(tapTimerRef.current); tapTimerRef.current = null }
    }
    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      if (!element) return false
      if (element.isContentEditable) return true
      const tag = element.tagName
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (tag !== 'INPUT') return false
      const type = (element as HTMLInputElement).type
      return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'].includes(type)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      const code = event.code
      if (code === 'Space' || event.key === ' ') {
        event.preventDefault()
        playbackRef.current.toggle()
        return
      }
      // Bound by physical key rather than by character. On a non-Latin layout the
      // letter keys report a different character, which is why Space worked while
      // these did nothing.
      if (code === 'KeyK') {
        event.preventDefault()
        if (!event.repeat) { heldKeysRef.current.k = true; playbackRef.current.pause() }
        return
      }
      if ((code !== 'KeyJ' && code !== 'KeyL') || event.repeat) return
      event.preventDefault()
      const direction: 1 | -1 = code === 'KeyL' ? 1 : -1
      if (heldKeysRef.current.k) {
        clearTap()
        tapTimerRef.current = window.setTimeout(() => {
          tapTimerRef.current = null
          slowMotionRef.current = true
          playbackRef.current.setShuttleRate(direction * SLOW_MOTION_RATE)
        }, TAP_THRESHOLD_MS)
        return
      }
      playbackRef.current.shuttle(direction)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const code = event.code
      if (code === 'KeyK') { heldKeysRef.current.k = false; return }
      if (code !== 'KeyJ' && code !== 'KeyL') return
      const direction: 1 | -1 = code === 'KeyL' ? 1 : -1
      if (tapTimerRef.current != null) {
        // Released before the threshold, so it was a tap: step one whole frame.
        clearTap()
        playbackRef.current.step(direction / stepFpsRef.current)
        return
      }
      if (slowMotionRef.current) { slowMotionRef.current = false; playbackRef.current.setShuttleRate(0); return }
      // Otherwise the shuttle latches and keeps running after release, so repeated
      // presses of the same key ramp the speed, and only K or Space stops it.
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      clearTap()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // Mutes are applied to the elements directly and never reach the task. The
  // segment key is a dependency because the video element remounts around stills.
  useEffect(() => {
    const video = playback.videoRef.current
    if (video) {
      video.muted = Boolean(muted.main)
      video.volume = previewGain
    }
    audioLaneIds.split('|').filter(Boolean).forEach((laneId) => {
      const element = audioElementsRef.current[laneId]
      if (element) element.muted = Boolean(muted[laneId])
    })
  }, [muted, audioLaneIds, playback.videoRef, playback.segment?.key, previewGain])

  // Keep the playhead in view while zoomed in and playing.
  useEffect(() => {
    if (!playback.playing) return
    const scroller = timelineScrollRef.current
    const inner = timelineInnerRef.current
    if (!scroller || !inner) return
    const x = LANE_LABEL_WIDTH + playheadFraction * Math.max(0, inner.clientWidth - LANE_LABEL_WIDTH)
    if (x < scroller.scrollLeft + 48 || x > scroller.scrollLeft + scroller.clientWidth - 48) {
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2)
    }
  }, [playback.playing, playheadFraction])

  if (!draft || !model) return <div className="edit-job-shell"><div className="editor-loading">WAITING FOR QUEUE ITEM...</div></div>

  const updateDraft = (changes: Partial<QueueTask>) => {
    const next = { ...draft, ...changes }
    draftRef.current = next
    setDraft(next)
  }
  const updatePreset = (changes: Partial<EncodingPreset>) => updateDraft({ preset: { ...draft.preset, ...changes } })

  const changeContainer = (container: EncodingPreset['container']) => {
    updateDraft({
      preset: applyContainerChange(draft.preset, container, singleFrameSource),
      outputFilename: deriveOutputFilename(draft, draft.preset, container),
    })
  }

  const changeResolution = (resolution: EncodingPreset['resolution']) => {
    // Exact width/height take precedence over a named resolution in the encoder,
    // so a named choice would otherwise be a silent no-op.
    updatePreset({ resolution, width: undefined, height: undefined })
  }

  const changeFps = (value: string) => {
    const parsed = Number(value)
    updatePreset({ fps: value.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 ? undefined : Math.round(parsed) })
  }

  /** Transitions are keyed by the clip BEFORE the boundary, like trim points. */
  const setBoundaryTransition = (index: number, type: TransitionType, duration = 0.5) => {
    const next = { ...(draft.transitions || {}) }
    const key = `${draft.sourcePaths[index]}#${index}`
    if (type === 'none') delete next[key]
    else next[key] = { type, duration }
    updateDraft({ transitions: Object.keys(next).length ? next : undefined })
  }

  const audioLanes = model.lanes.filter((lane) => !lane.embedded && lane.segments.length > 0)
  const sequenceSources = new Set([...Object.keys(draft.sequenceInputs || {}), ...(draft.sequenceInput ? [draft.sequenceInput.firstFrame] : [])])
  const playable = model.duration > 0
  const stamp = (seconds: number) => settings?.timestampDisplayMode === 'framestamp' ? frameStamp(seconds, fps) : timecode(seconds, fps)
  const segmentDetail = (segment: TimelineSegment) => {
    const parts = [stamp(segment.duration)]
    if (segment.trimmed) parts.push('TRIMMED')
    if (segment.sequence) parts.push(`SEQ ${segment.sequence.frames}F @ ${segment.sequence.fps}FPS`)
    if (segment.still) parts.push('STILL')
    if (segment.fadeIn) parts.push(`FADE IN ${segment.fadeIn.toFixed(2)}s`)
    if (segment.fadeOut) parts.push(`FADE OUT ${segment.fadeOut.toFixed(2)}s`)
    return parts.join(' // ')
  }
  const clipTitle = (segment: TimelineSegment) => {
    const kind = segment.sequence
      ? `image sequence, ${segment.sequence.frames} frames at ${segment.sequence.fps} fps`
      : segment.still ? 'still image' : 'media'
    return `${sourceName(segment.sourcePath)} — ${kind}, ${stamp(segment.duration)}${segment.trimmed ? ', trimmed' : ''}`
  }
  const duration = model.duration

  // Transitions only exist between concatenated clips, so only STITCH has them.
  const stitchSegments = model.lanes[0]?.segments ?? []
  const showBoundaries = draft.type === 'stitch' && stitchSegments.length > 1
  // A single frame in and a single frame out has nothing to time.
  const stillFrameJob = isStillFrameJob(draft)
  const selectedBoundary = openBoundary != null && stitchSegments[openBoundary] && stitchSegments[openBoundary + 1]
    ? (() => {
      const transition = draft.transitions?.[`${stitchSegments[openBoundary].sourcePath}#${openBoundary}`]
      return {
        index: openBoundary,
        source: stitchSegments[openBoundary].sourcePath,
        fade: transition && transition.type === 'fade' && transition.duration > 0 ? transition.duration : 0,
        maxFade: maxFadeAtBoundary(stitchSegments[openBoundary].duration, stitchSegments[openBoundary + 1].duration),
      }
    })()
    : null

  /**
   * A sequence frame cannot be handed to a video element, so it plays through the
   * resolved preview. Returning null keeps the element idle until that preview
   * exists, rather than letting it fail on a PNG.
   */
  const sourceUrlFor = (segment: TimelineSegment | undefined): string | null => {
    if (!segment) return null
    if (sequenceSources.has(segment.sourcePath)) {
      return mediaTarget?.sourcePath === segment.sourcePath ? mediaUrl(mediaTarget.path) : null
    }
    return mediaUrl(segment.sourcePath)
  }
  const elementUrl = sourceUrlFor(playback.segment)

  const seekFraction = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || duration <= 0) return
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    playback.seek(fraction * duration)
  }

  /**
   * Opens the native trimmer seeded with the source's existing in/out points. The
   * helper reports the filmstrip range back on close, so opening it without the
   * current points would overwrite existing trim with the full source range.
   */
  const openNativePreview = async () => {
    // A still that becomes a timed clip is opened in the advanced helper as a
    // generated clip, so its filmstrip and trimming behave like real footage.
    const request = await resolveQuickLookRequest(draft, window.electronAPI, { sourceIndex: focusedSourceIndex, preferTimedStill: true })
    if (!request) return
    void window.electronAPI?.quickLook(request.target, draft.id, request.trimIn, request.trimOut, request.sourceIndex, request.stillMode, settings?.screenshotDirectory, settings?.timestampDisplayMode || 'timestamp', request.sequenceFps, request.sequenceFrameCount)
  }

  const laneGap = (lane: TimelineLane) => Math.max(0, duration - lane.duration)
  const activeSegmentKey = playback.segment?.key
  const resolutionLabel = draft.sourceInfo?.videoStreams?.[0]?.resolution
    || draft.sourceMetadata?.[focusedSource ?? '']?.resolution
    || (draft.preset.width && draft.preset.height ? `${draft.preset.width}×${draft.preset.height}` : 'SOURCE')

  const dirty = isDirty(draft, baseline ?? draft)
  const container = draft.preset.container
  const audioOnly = AUDIO_CONTAINERS.includes(container)
  const isImageContainer = IMAGE_CONTAINERS.includes(container)
  const isGif = container === 'gif'
  const audioDisabled = audioOnly || isGif || isImageContainer
  const videoReason = audioOnly ? 'THIS CONTAINER CARRIES AUDIO ONLY.' : isGif ? 'GIF OUTPUT FORCES THE GIF ENCODER AND DROPS AUDIO.' : undefined
  const audioReason = audioOnly ? undefined : isGif ? 'GIF OUTPUT CARRIES NO AUDIO.' : isImageContainer ? 'IMAGE OUTPUT CARRIES NO AUDIO TRACK.' : undefined

  return <div className="edit-job-shell">
    <header className="editor-header">
      <div><span className="panel-kicker">STITCH UP MEDIA // EDIT JOB</span><h1>{sourceName(focusedSource)}</h1></div>
      <span className="job-mark">{draft.type === 'stitch' ? 'STITCH UP' : draft.type === 'multitrack' ? 'MULTI-TRACK' : draft.type === 'combo' ? 'COMBO' : 'CONVERT'}</span>
    </header>

    {incomingConflict && <div className="editor-conflict" role="alert">
      <div><span className="panel-kicker">QUEUE CHANGED SETTINGS YOU ARE EDITING</span><p>Your unsaved edits are still here. Reloading discards them and takes the queue&apos;s version.</p></div>
      <div className="editor-conflict-actions">
        <button onClick={() => setIncomingConflict(null)}>KEEP MY EDITS</button>
        <button className="primary-retro" onClick={() => { const next = incomingConflict; setIncomingConflict(null); commit(next, next) }}>RELOAD FROM QUEUE</button>
      </div>
    </div>}

    <div className="editor-body">
      <main className="editor-main">
        <section className="editor-preview">
          <div className="panel-kicker">PREVIEW // ASSEMBLED OUTPUT</div>
          <div className="editor-screen">
            {playback.error
              ? <span className="editor-screen-message">{playback.error}</span>
              : stillFrameJob
                ? <img className="editor-still" src={mediaUrl(draft.sourcePaths[0])} alt={sourceName(draft.sourcePaths[0])} />
                : playback.segment?.still
                  ? <img className="editor-still" style={{ opacity: previewGain }} src={mediaUrl(playback.segment.sourcePath)} alt={sourceName(playback.segment.sourcePath)} />
                  : elementUrl
                    ? <video
                      ref={playback.attachVideo}
                      className="editor-video"
                      src={elementUrl}
                      preload="metadata"
                      playsInline
                      style={{ opacity: previewGain }}
                      onContextMenu={(event) => event.preventDefault()}
                      onClick={() => playback.toggle()}
                    />
                    : <span className="editor-screen-message">{duration > 0 ? 'PREPARING THIS SEGMENT...' : 'NO PLAYABLE MEDIA'}</span>}
            <small>{sourceName(focusedSource)} • {resolutionLabel}{duration > 0 ? ` • ${Math.round(fps)} FPS • ${stamp(duration)}` : ''}</small>
            <b>{playback.playing ? '\u25b6 PLAYING' : '\u25a0 PAUSED'}</b>
          </div>
          <div className="transport">
            <button disabled={!playable} onClick={() => playback.step(-1 / Math.max(1, fps))} title={playable ? undefined : 'NOTHING PLAYABLE HERE YET.'}>[|&lt;] FRAME</button>
            <button disabled={!playable} onClick={playback.toggle} title={playable ? undefined : 'NOTHING PLAYABLE HERE YET.'}>[{playback.playing ? '||' : '\u25b6'}] PLAY</button>
            <button disabled={!playable} onClick={() => playback.step(1 / Math.max(1, fps))} title={playable ? undefined : 'NOTHING PLAYABLE HERE YET.'}>[&gt;|] FRAME</button>
            <span className={`transport-rate${playback.shuttleRate < 0 ? ' is-reverse' : playback.shuttleRate > 1 ? ' is-fast' : ''}`}>
              {playback.shuttleRate > 0 ? `\u25b6 ${playback.shuttleRate}\u00d7` : playback.shuttleRate < 0 ? `\u25c0 ${Math.abs(playback.shuttleRate)}\u00d7` : playback.playing ? '\u25b6 1\u00d7' : '\u275a\u275a'}
            </span>
            <span>{stamp(playback.position)} / {stamp(duration)}</span>
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 1}
              step={fps > 0 ? 1 / fps : 0.01}
              value={duration > 0 ? playback.position : 0}
              disabled={!playable}
              onChange={(event) => playback.seek(Number(event.target.value))}
              aria-label="Playhead across the assembled output"
            />
          </div>
          <div className="editor-preview-actions">
            <button onClick={() => void openNativePreview()} disabled={!mediaTarget}>OPEN FRAME-ACCURATE PREVIEW</button>
          </div>
          <div className="editor-note">&gt; SPACE PLAYS. J / L SHUTTLE (PRESS AGAIN TO SPEED UP), K STOPS, K+J / K+L IS SLOW, AND A QUICK TAP STEPS ONE FRAME. IN AND OUT POINTS COME FROM THE NATIVE PREVIEW.</div>
        </section>

        <section className="timeline-panel">
          {stillFrameJob ? <>
            <div className="panel-kicker">TIMELINE // SINGLE FRAME</div>
            <div className="editor-note">&gt; THIS JOB MAPS ONE FRAME TO ONE FRAME, SO THERE IS NOTHING TO TIME. CHANGE THE FORMAT IN EXPORT SETTINGS TO TREAT THE IMAGE AS A {Math.round(draft.stillImageDuration || 10)}s CLIP.</div>
          </> : <>
          <div className="timeline-head">
            <div className="panel-kicker">TIMELINE // {draft.type.toUpperCase()}</div>
            <div className="timeline-zoom">
              <span className="panel-kicker">ZOOM</span>
              <button onClick={() => setZoom((current) => Math.max(ZOOM_MIN, current / 2))} disabled={zoom <= ZOOM_MIN} aria-label="Zoom timeline out" title="Zoom out">−</button>
              <span className="timeline-zoom-value">{zoom}×</span>
              <button onClick={() => setZoom((current) => Math.min(ZOOM_MAX, current * 2))} disabled={zoom >= ZOOM_MAX} aria-label="Zoom timeline in" title="Zoom in">+</button>
              <button onClick={() => setZoom(1)} disabled={zoom === 1} title="Fit the whole timeline">FIT</button>
            </div>
          </div>
          <div className="timeline-lanes" ref={timelineScrollRef}>
            <div className="timeline-lanes-inner" ref={timelineInnerRef} style={{ width: `${zoom * 100}%` }}>
              <div className="timeline-ruler">
                {Array.from({ length: 5 }, (_, index) => index / 4).map((fraction) => (
                  <span key={fraction} style={{ left: `${fraction * 100}%`, transform: fraction === 0 ? 'none' : fraction === 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                    {duration > 0 ? stamp(duration * fraction) : '--:--:--.--'}
                  </span>
                ))}
              </div>
              {model.lanes.map((lane) => (
                <div className="timeline-lane" key={lane.id}>
                  <div className="timeline-lane-head">
                    <button
                      className={`lane-mute${muted[lane.id] ? ' is-muted' : ''}`}
                      onClick={() => setMuted((current) => ({ ...current, [lane.id]: !current[lane.id] }))}
                      aria-pressed={Boolean(muted[lane.id])}
                      title={lane.embedded ? 'Mute this stream while monitoring. The export still carries it.' : 'Mute this track while monitoring. This is not a mix-down change.'}
                    >M</button>
                    <span>{lane.label}</span>
                  </div>
                  <div className={`timeline-lane-track${lane.kind === 'audio' ? ' is-audio' : ''}`} onClick={seekFraction} title="Click to jump to this point">
                    {lane.segments.map((segment, index) => (
                      <div
                        key={segment.key}
                        className={`timeline-clip${segment.trimmed ? ' is-trimmed' : ''}${segment.key === activeSegmentKey ? ' is-active' : ''}`}
                        style={{ flexGrow: Math.max(segment.duration, 0.001) }}
                        title={clipTitle(segment)}
                      >
                        <span className="timeline-clip-name">{sourceName(segment.sourcePath)}</span>
                        <small>{segmentDetail(segment)}</small>
                        {segment.fadeIn ? <span className="clip-fade clip-fade-in" style={{ width: `${Math.min(100, (segment.fadeIn / Math.max(segment.duration, 0.001)) * 100)}%` }} aria-hidden="true" /> : null}
                        {segment.fadeOut ? <span className="clip-fade clip-fade-out" style={{ width: `${Math.min(100, (segment.fadeOut / Math.max(segment.duration, 0.001)) * 100)}%` }} aria-hidden="true" /> : null}
                        {/* Anchored to the clip's own trailing edge, so the marker sits
                            on the cut by construction rather than by arithmetic. */}
                        {showBoundaries && lane.id === 'main' && index < lane.segments.length - 1 && (
                          <button
                            className={`boundary-add${(draft.transitions?.[`${segment.sourcePath}#${index}`]?.duration ?? 0) > 0 ? ' is-active' : ''}${openBoundary === index ? ' is-open' : ''}`}
                            onClick={(event) => { event.stopPropagation(); setOpenBoundary(openBoundary === index ? null : index) }}
                            aria-label={`Add a transition after ${sourceName(segment.sourcePath)}`}
                            title={`Transition after ${sourceName(segment.sourcePath)}`}
                          />
                        )}
                      </div>
                    ))}
                    {laneGap(lane) > 0 && <div className="timeline-fill" style={{ flexGrow: laneGap(lane) }} title="No media on this lane" />}
                  </div>
                </div>
              ))}
              <div className="timeline-playhead" style={{ left: `calc(${LANE_LABEL_WIDTH}px + ${playheadFraction} * (100% - ${LANE_LABEL_WIDTH}px))` }} aria-hidden="true" />
            </div>
          </div>
          {selectedBoundary && (
            <div className="boundary-editor">
              <span className="boundary-title">CUT {selectedBoundary.index + 1}\u2192{selectedBoundary.index + 2}</span>
              <div className="boundary-options">
                <button className={selectedBoundary.fade > 0 ? '' : 'is-selected'} onClick={() => setBoundaryTransition(selectedBoundary.index, 'none')} disabled={selectedBoundary.maxFade <= 0}>NONE</button>
                <button className={selectedBoundary.fade > 0 ? 'is-selected' : ''} onClick={() => setBoundaryTransition(selectedBoundary.index, 'fade', selectedBoundary.fade || Math.min(0.5, selectedBoundary.maxFade) || 0.25)} disabled={selectedBoundary.maxFade <= 0}>FADE</button>
                <button disabled title="Crossfade overlaps the clips and needs the encoder rework planned next.">CROSSFADE</button>
              </div>
              {selectedBoundary.fade > 0 && (
                <div className="boundary-duration">
                  <button onClick={() => setBoundaryTransition(selectedBoundary.index, 'fade', Math.max(0.25, selectedBoundary.fade - 0.25))} disabled={selectedBoundary.fade <= 0.25} aria-label="Shorter fade">−</button>
                  <span className="boundary-duration-value">{selectedBoundary.fade.toFixed(2)}s</span>
                  <button onClick={() => setBoundaryTransition(selectedBoundary.index, 'fade', Math.min(selectedBoundary.maxFade, selectedBoundary.fade + 0.25))} disabled={selectedBoundary.fade >= selectedBoundary.maxFade} aria-label="Longer fade">+</button>
                  <small>MAX {selectedBoundary.maxFade.toFixed(2)}s</small>
                </div>
              )}
              <button className="boundary-close" onClick={() => setOpenBoundary(null)} aria-label="Close transition editor">×</button>
            </div>
          )}
          {model.unusedVideoSources.length > 0 && <div className="editor-note">&gt; {model.unusedVideoSources.length} EXTRA VIDEO SOURCE(S) ({model.unusedVideoSources.map(sourceName).join(', ')}) ARE NOT USED: COMBO DISPATCHES TO THE MULTI-TRACK ENCODER PATH, WHICH MAPS ONE VIDEO STREAM. SPLIT INTO A STITCH JOB TO CONCATENATE THEM.</div>}
          {showBoundaries && <div className="editor-note">&gt; PRESS [+] ON A CUT TO ADD A FADE. FADES ARE APPLIED BY THE ENCODER ON BOTH SIDES OF THE CUT, AND THE MONITOR FADES WITH THEM.</div>}
          <div className="editor-note">&gt; LANE WIDTHS ARE THE REAL TRIMMED DURATIONS. AUDIO TRACKS PLAY ALONGSIDE THE VIDEO FROM ZERO, SO THE OUTPUT RUNS TO {duration > 0 ? stamp(duration) : 'AN UNKNOWN LENGTH'}.</div>
          </>}
        </section>
      </main>

      <aside className="export-sidebar">
        <div className="export-title">EXPORT SETTINGS</div>
        <div className="export-tabs">{tabs.map((name) => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</div>
        <div className="export-content">
          {tab === 'EXPORT' && <>
            <EditorField label="FORMAT"><select value={container} onChange={(event) => changeContainer(event.target.value as EncodingPreset['container'])}>{CONTAINERS.map((name) => <option key={name} value={name}>{name.toUpperCase()}</option>)}</select></EditorField>
            <EditorField label="VIDEO CODEC" reason={videoReason}><select value={draft.preset.videoCodec} disabled={audioOnly || isGif} onChange={(event) => updatePreset({ videoCodec: event.target.value as EncodingPreset['videoCodec'] })}>{VIDEO_CODECS.map((name) => <option key={name} value={name}>{name.toUpperCase()}</option>)}</select></EditorField>
            <EditorField label="OUTPUT NAME"><input type="text" className="editor-input" value={draft.outputFilename} onChange={(event) => updateDraft({ outputFilename: event.target.value, outputFilenameManuallySet: true })} /></EditorField>
            <EditorRow label="PRESET" value={draft.preset.name} />
            <EditorToggle label="EXPORT VIDEO" checked={draft.preset.outputMode !== 'audio'} onChange={(checked) => updatePreset({ outputMode: checked ? undefined : 'audio' })} />
            <EditorToggle label="EXPORT AUDIO" checked={draft.preset.audioEnabled !== false} onChange={audioDisabled ? undefined : (checked) => updatePreset({ audioEnabled: checked })} reason={audioReason} />
            <EditorToggle label="EXPORT CAPTIONS" checked={false} reason="CAPTION OUTPUT HAS NO BACKING FIELD YET." />
          </>}

          {tab === 'VIDEO' && <>
            <EditorField label="RESOLUTION" reason={videoReason}><select value={draft.preset.resolution} disabled={audioOnly || isGif} onChange={(event) => changeResolution(event.target.value as EncodingPreset['resolution'])}>{RESOLUTIONS.map((name) => <option key={name} value={name}>{name.toUpperCase()}</option>)}</select></EditorField>
            <EditorRow label="EXACT SIZE" value={draft.preset.width && draft.preset.height ? `${draft.preset.width}×${draft.preset.height} — OVERRIDES NAMED RESOLUTION` : 'NOT SET'} />
            {draft.preset.width && draft.preset.height ? <button className="editor-inline-action" onClick={() => updatePreset({ width: undefined, height: undefined })}>CLEAR EXACT SIZE</button> : null}
            <EditorField label="FPS" hint="BLANK = SOURCE" reason={audioOnly ? 'THIS CONTAINER CARRIES AUDIO ONLY.' : undefined}><input type="number" min="1" className="editor-input" value={draft.preset.fps ?? ''} disabled={audioOnly} onChange={(event) => changeFps(event.target.value)} /></EditorField>
            <EditorField label="QUALITY" hint="BITRATE, E.G. 8M" reason={videoReason}><input type="text" className="editor-input" value={draft.preset.videoBitrate ?? ''} placeholder="SOURCE" disabled={audioOnly || isGif || draft.preset.videoCodec === 'copy'} onChange={(event) => updatePreset({ videoBitrate: event.target.value.trim() || undefined })} /></EditorField>
            <div className="editor-note">&gt; BITRATE IS IGNORED WHILE THE VIDEO CODEC IS SET TO COPY. ADVANCED CONTROLS OPEN IN CUSTOM PRESET.</div>
          </>}

          {tab === 'AUDIO' && <>
            <EditorField label="CODEC" reason={audioReason}><select value={draft.preset.audioCodec} disabled={audioDisabled} onChange={(event) => updatePreset({ audioCodec: event.target.value as EncodingPreset['audioCodec'] })}>{AUDIO_CODECS.map((name) => <option key={name} value={name}>{name.toUpperCase()}</option>)}</select></EditorField>
            <EditorField label="BITRATE" hint="E.G. 320K" reason={audioReason}><input type="text" className="editor-input" value={draft.preset.audioBitrate ?? ''} placeholder="SOURCE" disabled={audioDisabled || draft.preset.audioCodec === 'copy' || draft.preset.audioCodec === 'pcm'} onChange={(event) => updatePreset({ audioBitrate: event.target.value.trim() || undefined })} /></EditorField>
            <EditorField label="SAMPLE RATE" reason={audioReason}><select value={draft.preset.audioSampleRate ?? 0} disabled={audioDisabled} onChange={(event) => updatePreset({ audioSampleRate: Number(event.target.value) || undefined })}><option value={0}>SOURCE</option><option value={44100}>44.1 KHZ</option><option value={48000}>48 KHZ</option><option value={96000}>96 KHZ</option></select></EditorField>
            <EditorRow label="TRACKS" value={draft.additionalAudioTracks?.length ? `${draft.additionalAudioTracks.length + 1} (EMBEDDED + ${draft.additionalAudioTracks.length})` : '1 EMBEDDED'} />
            <div className="editor-note">&gt; ADDING AND REORDERING TRACKS ARRIVES WITH THE TRACK EDITOR.</div>
          </>}

          {tab === 'EFFECTS' && <>
            <EditorToggle label="TIMESTAMP BURN-IN" checked={false} reason="BURN-IN HAS NO BACKING FIELD AND IS NOT IMPLEMENTED BY THE ENCODER." />
            <EditorToggle label="FRAMESTAMP BURN-IN" checked={false} reason="BURN-IN HAS NO BACKING FIELD AND IS NOT IMPLEMENTED BY THE ENCODER." />
            <EditorToggle label="IMAGE OVERLAY / WATERMARK" checked={false} reason="BURN-IN HAS NO BACKING FIELD AND IS NOT IMPLEMENTED BY THE ENCODER." />
            <div className="editor-note">&gt; THESE CONTROLS ARE SHOWN DISABLED BECAUSE THE ENCODER HAS NOTHING TO DRIVE YET. WIRING THEM WOULD FORCE A RE-ENCODE.</div>
          </>}

          {tab === 'CAPTIONS' && <>
            <EditorField label="MODE" reason="CAPTIONS ARE NOT WIRED TO THE ENCODER YET."><select value="embedded" disabled onChange={() => undefined}><option value="embedded">EMBEDDED</option><option value="sidecar">SIDECAR SRT</option><option value="burn-in">BURN-IN</option></select></EditorField>
            <div className="editor-note">&gt; CAPTION MODE HAS NO BACKING FIELD YET, SO NOTHING IS SENT BACK ON APPLY.</div>
          </>}
        </div>

        <div className="export-summary">
          <span className="panel-kicker">SUMMARY</span>
          <strong>{draft.outputFilename}</strong>
          <span>{stillFrameJob ? 'SINGLE FRAME OUTPUT — NO TIMELINE' : duration > 0 ? `ASSEMBLED ${stamp(duration)} ACROSS ${model.lanes.length} LANE(S)` : 'LENGTH UNKNOWN — PROBE ON START'}</span>
          <span>{dirty ? 'UNSAVED CHANGES' : 'NO CHANGES'}</span>
        </div>

        <div className="editor-actions">
          {confirmingDiscard
            ? <><span className="editor-confirm">DISCARD UNSAVED CHANGES?</span><button onClick={() => setConfirmingDiscard(false)}>KEEP EDITING</button><button className="editor-danger" onClick={() => void window.electronAPI?.cancelEditJob()}>DISCARD</button></>
            : <><button onClick={() => (dirty ? setConfirmingDiscard(true) : void window.electronAPI?.cancelEditJob())}>CANCEL</button><button className="primary-retro" onClick={() => {
              const patch: EditJobPatch = {
                id: draft.id,
                preset: draft.preset,
                outputFilename: draft.outputFilename,
                outputFilenameManuallySet: draft.outputFilenameManuallySet,
                transitions: draft.transitions,
              }
              void window.electronAPI?.applyEditJob(patch)
            }} disabled={!dirty} title={dirty ? undefined : 'NO CHANGES TO APPLY.'}>OK / APPLY</button></>}
        </div>
      </aside>
    </div>

    {audioLanes.map((lane) => {
      const laneSegment = lane.segments[0]
      const url = laneSegment ? sourceUrlFor(laneSegment) : null
      return url ? <audio
        key={lane.id}
        ref={(element) => { audioElementsRef.current[lane.id] = element; if (element) element.muted = Boolean(muted[lane.id]) }}
        src={url}
        preload="auto"
      /> : null
    })}
  </div>
}
