import React, { useEffect, useRef, useState } from 'react'
import { AppSettings, EditJobPatch, EncodingPreset, QueueTask, SequenceInput } from '../types'
import { deriveOutputFilename } from '../lib/outputNaming'
import { resolveQuickLookRequest } from '../lib/quickLookTarget'
import { mediaUrl } from '../lib/mediaUrl'

const tabs = ['EXPORT', 'VIDEO', 'AUDIO', 'EFFECTS', 'CAPTIONS'] as const
type Tab = typeof tabs[number]

const CONTAINERS: Array<EncodingPreset['container']> = ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'flac', 'png', 'jpg', 'gif']
const VIDEO_CODECS: Array<EncodingPreset['videoCodec']> = ['copy', 'h264', 'hevc', 'prores', 'vp9', 'av1', 'png', 'mjpeg']
const AUDIO_CODECS: Array<EncodingPreset['audioCodec']> = ['copy', 'aac', 'mp3', 'opus', 'pcm', 'flac']
const AUDIO_CONTAINERS: Array<EncodingPreset['container']> = ['mp3', 'wav', 'm4a', 'flac']
const IMAGE_CONTAINERS: Array<EncodingPreset['container']> = ['png', 'jpg']
const RESOLUTIONS: Array<EncodingPreset['resolution']> = ['source', '4k', '1080p', '720p']

/** The fields this window owns. Everything else on a task belongs to the queue. */
const editableSlice = (task: QueueTask) => ({
  preset: task.preset,
  outputFilename: task.outputFilename,
  outputFilenameManuallySet: task.outputFilenameManuallySet ?? false,
})

const sliceSignature = (task: QueueTask) => JSON.stringify(editableSlice(task))
const isDirty = (draft: QueueTask, baseline: QueueTask) => sliceSignature(draft) !== sliceSignature(baseline)

const sequenceFor = (task: QueueTask, sourcePath: string | undefined): SequenceInput | undefined => {
  if (!sourcePath) return undefined
  return task.sequenceInputs?.[sourcePath] || (task.sequenceInput?.firstFrame === sourcePath ? task.sequenceInput : undefined)
}

/**
 * Interpreter rate for a source. An image sequence's own fps wins, matching the
 * `displayFps` rule the native frame-accurate preview already uses, so the two
 * report identical frame numbers for the same media.
 */
const sourceFps = (task: QueueTask, sourcePath: string | undefined, sequence: SequenceInput | undefined): number => {
  if (sequence && sequence.fps > 0) return sequence.fps
  const metadataFps = sourcePath ? task.sourceMetadata?.[sourcePath]?.fps : undefined
  if (metadataFps && metadataFps > 0) return metadataFps
  const streamFps = task.sourceInfo?.videoStreams?.[0]?.fps
  if (streamFps && streamFps > 0) return streamFps
  if (task.preset.fps && task.preset.fps > 0) return task.preset.fps
  return 25
}

/** A sequence derives its duration from frame count and interpreted fps, as the native preview does. */
const sourceDuration = (task: QueueTask, sourcePath: string | undefined, sequence: SequenceInput | undefined): number => {
  if (sequence && sequence.fps > 0 && sequence.frameCount > 0) return sequence.frameCount / sequence.fps
  const metadataDuration = sourcePath ? task.sourceMetadata?.[sourcePath]?.duration : undefined
  if (metadataDuration && metadataDuration > 0) return metadataDuration
  return task.sourceInfo?.duration ?? 0
}

const trimFor = (task: QueueTask, sourcePath: string | undefined, index: number) =>
  task.trimPoints?.[`${sourcePath}#${index}`] || (sourcePath ? task.trimPoints?.[sourcePath] : undefined)

/** Same timecode shape the native preview prints: HH:MM:SS.FF */
const timecode = (seconds: number, fps: number) => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const rate = fps > 0 ? Math.round(fps) : 25
  const totalFrames = Math.round(safeSeconds * rate)
  const frames = totalFrames % rate
  const whole = Math.floor(totalFrames / rate)
  return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(frames).padStart(2, '0')}`
}

const frameStamp = (seconds: number, fps: number) => `FRAME ${String(Math.max(0, Math.round(seconds * fps))).padStart(6, '0')}`

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
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [activeSourceIndex, setActiveSourceIndex] = useState(0)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [incomingConflict, setIncomingConflict] = useState<QueueTask | null>(null)
  const [mediaTarget, setMediaTarget] = useState<{ path: string; stillMode: boolean } | null>(null)
  const [mediaDuration, setMediaDuration] = useState(0)
  const [mediaError, setMediaError] = useState<string | null>(null)
  // Mirrors of the editable state so the IPC listener can decide without stale closures.
  const draftRef = useRef<QueueTask | null>(null)
  const baselineRef = useRef<QueueTask | null>(null)
  const mediaRef = useRef<HTMLVideoElement | null>(null)
  // Read by media-event handlers so they never capture stale trim bounds.
  const boundsRef = useRef({ inPoint: 0, outPoint: 0 })

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

  const activeSource = draft?.sourcePaths[activeSourceIndex] || draft?.sourcePaths[0]
  const activeSequence = draft ? sequenceFor(draft, activeSource) : undefined
  const probedDuration = draft ? sourceDuration(draft, activeSource, activeSequence) : 0
  const fps = draft ? sourceFps(draft, activeSource, activeSequence) : 25
  const activeTrim = draft ? trimFor(draft, activeSource, activeSourceIndex) : undefined
  const inPoint = Math.max(0, activeTrim?.in ?? 0)
  // The element's own length is trusted when probing has not happened yet, so the
  // transport still works on a task that has never been encoded.
  const effectiveDuration = probedDuration > 0 ? probedDuration : mediaDuration
  const outPoint = activeTrim?.out && activeTrim.out > inPoint ? activeTrim.out : effectiveDuration
  boundsRef.current = { inPoint, outPoint }

  // Only inputs that change *what* is loaded are dependencies, so unrelated draft
  // edits (a bitrate keystroke, say) never reload the media.
  const targetSignature = draft ? JSON.stringify([
    draft.id, activeSourceIndex, draft.status, draft.sourcePaths, draft.sequenceInput,
    draft.sequenceInputs, draft.imageSequencePreviews, draft.outputDirectory, draft.outputFilename,
  ]) : ''

  useEffect(() => {
    let cancelled = false
    const task = draftRef.current
    if (!task) {
      setMediaTarget(null)
      return
    }
    void resolveQuickLookRequest(task, window.electronAPI, { sourceIndex: activeSourceIndex }).then((request) => {
      if (cancelled) return
      setMediaTarget(request ? { path: request.target, stillMode: request.stillMode } : null)
    })
    return () => { cancelled = true }
  }, [targetSignature])

  // A new clip opens paused at its in point.
  useEffect(() => {
    setPlaying(false)
    setMediaError(null)
    setMediaDuration(0)
    const start = boundsRef.current.inPoint
    setPlayhead(start)
    const element = mediaRef.current
    if (element) element.pause()
  }, [mediaTarget?.path])

  // Playback is driven by the media element, so the playhead shows real time.
  useEffect(() => {
    const element = mediaRef.current
    if (!element || mediaTarget?.stillMode) return
    if (playing) void element.play().catch(() => setPlaying(false))
    else element.pause()
  }, [playing, mediaTarget?.path, mediaTarget?.stillMode])

  // Mirror the element clock into the playhead, and halt at the out point the way
  // the native preview stops at its out handle.
  useEffect(() => {
    const element = mediaRef.current
    if (!element || mediaTarget?.stillMode) return
    const sync = () => {
      const { inPoint: lower, outPoint: upper } = boundsRef.current
      if (upper > lower && element.currentTime >= upper) {
        element.pause()
        element.currentTime = upper
        setPlaying(false)
        setPlayhead(upper)
        return
      }
      setPlayhead(element.currentTime)
    }
    const onLoaded = () => {
      setMediaError(null)
      setMediaDuration(Number.isFinite(element.duration) ? element.duration : 0)
      const { inPoint: lower } = boundsRef.current
      if (lower > 0 && element.currentTime < lower) element.currentTime = lower
      sync()
    }
    const onError = () => { setMediaError('UNABLE TO DECODE THIS SOURCE'); setPlaying(false) }
    const onEnded = () => setPlaying(false)
    element.addEventListener('timeupdate', sync)
    element.addEventListener('seeked', sync)
    element.addEventListener('loadedmetadata', onLoaded)
    element.addEventListener('error', onError)
    element.addEventListener('ended', onEnded)
    return () => {
      element.removeEventListener('timeupdate', sync)
      element.removeEventListener('seeked', sync)
      element.removeEventListener('loadedmetadata', onLoaded)
      element.removeEventListener('error', onError)
      element.removeEventListener('ended', onEnded)
    }
  }, [mediaTarget?.path, mediaTarget?.stillMode])

  if (!draft) return <div className="edit-job-shell"><div className="editor-loading">WAITING FOR QUEUE ITEM...</div></div>

  const updateDraft = (changes: Partial<QueueTask>) => {
    const next = { ...draft, ...changes }
    draftRef.current = next
    setDraft(next)
  }
  const updatePreset = (changes: Partial<EncodingPreset>) => updateDraft({ preset: { ...draft.preset, ...changes } })

  const changeContainer = (container: EncodingPreset['container']) => {
    // Renaming follows the same rule as the queue's preset picker, so a container
    // swap keeps the suffix and only moves the extension.
    updateDraft({
      preset: { ...draft.preset, container },
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

  const stamp = (seconds: number) => settings?.timestampDisplayMode === 'framestamp'
    ? frameStamp(seconds, fps)
    : timecode(seconds, fps)

  const openPreview = async (preferOutput = false) => {
    const request = await resolveQuickLookRequest(draft, window.electronAPI, { sourceIndex: activeSourceIndex, preferOutput })
    if (!request) return
    void window.electronAPI?.quickLook(request.target, draft.id, request.trimIn, request.trimOut, request.sourceIndex, request.stillMode, settings?.screenshotDirectory, settings?.timestampDisplayMode || 'timestamp', request.sequenceFps, request.sequenceFrameCount)
  }

  const dirty = isDirty(draft, baseline ?? draft)
  const container = draft.preset.container
  const audioOnly = AUDIO_CONTAINERS.includes(container)
  const isImageContainer = IMAGE_CONTAINERS.includes(container)
  const isGif = container === 'gif'
  const audioDisabled = audioOnly || isGif || isImageContainer
  const videoReason = audioOnly ? 'THIS CONTAINER CARRIES AUDIO ONLY.' : isGif ? 'GIF OUTPUT FORCES THE GIF ENCODER AND DROPS AUDIO.' : undefined
  const audioReason = audioOnly ? undefined : isGif ? 'GIF OUTPUT CARRIES NO AUDIO.' : isImageContainer ? 'IMAGE OUTPUT CARRIES NO AUDIO TRACK.' : undefined

  const clipDurations = draft.sourcePaths.map((source, index) => sourceDuration(draft, source, sequenceFor(draft, source)) || (index === activeSourceIndex ? mediaDuration : 0))
  const totalDuration = clipDurations.reduce((sum, value) => sum + value, 0) || effectiveDuration
  const boundedPlayhead = Math.max(inPoint, Math.min(outPoint, playhead))
  const step = 1 / Math.max(1, fps)
  const playable = !mediaTarget?.stillMode && outPoint > inPoint
  const rulerTicks = Array.from({ length: 5 }, (_, index) => (totalDuration * index) / 4)
  const resolutionLabel = draft.sourceInfo?.videoStreams?.[0]?.resolution
    || draft.sourceMetadata?.[activeSource ?? '']?.resolution
    || (draft.preset.width && draft.preset.height ? `${draft.preset.width}×${draft.preset.height}` : 'SOURCE')

  // Scrubbing and frame stepping drive the element itself, so a paused frame shows.
  const seekTo = (seconds: number) => {
    const bounded = Math.max(inPoint, Math.min(outPoint > inPoint ? outPoint : Number.MAX_SAFE_INTEGER, seconds))
    setPlayhead(bounded)
    const element = mediaRef.current
    if (element && !mediaTarget?.stillMode && Number.isFinite(bounded)) element.currentTime = bounded
  }

  return <div className="edit-job-shell">
    <header className="editor-header">
      <div><span className="panel-kicker">STITCH UP MEDIA // EDIT JOB</span><h1>{sourceName(activeSource)}</h1></div>
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
          <div className="panel-kicker">PREVIEW // FRAME ACCURATE</div>
          <div className="editor-screen">
            {mediaError
              ? <span className="editor-screen-message">{mediaError}</span>
              : mediaTarget?.stillMode
                ? <img className="editor-still" src={mediaUrl(mediaTarget.path)} alt={sourceName(mediaTarget.path)} onError={() => setMediaError('UNABLE TO DECODE THIS SOURCE')} />
                : mediaTarget
                  ? <video ref={mediaRef} className="editor-video" src={mediaUrl(mediaTarget.path)} preload="metadata" playsInline onContextMenu={(event) => event.preventDefault()} />
                  : <span className="editor-screen-message">NO MEDIA SELECTED</span>}
            {!mediaError && <small>{sourceName(mediaTarget?.path) || sourceName(activeSource)} • {resolutionLabel}{effectiveDuration > 0 ? ` • ${Math.round(fps)} FPS • ${stamp(effectiveDuration)}` : ''}</small>}
            {!mediaError && <b>{playing ? '\u25b6 PLAYING' : '\u25a0 PAUSED'}</b>}
          </div>
          <div className="transport">
            <button disabled={!playable} onClick={() => { setPlaying(false); seekTo(boundedPlayhead - step) }} title={playable ? undefined : 'NOTHING PLAYABLE HERE YET.'}>[|&lt;] FRAME</button>
            <button disabled={!playable} onClick={() => setPlaying(!playing)} title={playable ? undefined : 'NOTHING PLAYABLE HERE YET.'}>[{playing ? '||' : '\u25b6'}] PLAY</button>
            <button disabled={!playable} onClick={() => { setPlaying(false); seekTo(boundedPlayhead + step) }} title={playable ? undefined : 'NOTHING PLAYABLE HERE YET.'}>[&gt;|] FRAME</button>
            <span>{stamp(boundedPlayhead)} / {stamp(outPoint)}</span>
            <input type="range" min={inPoint} max={outPoint > inPoint ? outPoint : 1} step={step} value={outPoint > inPoint ? boundedPlayhead : inPoint} disabled={!playable} onChange={(event) => { setPlaying(false); seekTo(Number(event.target.value)) }} aria-label="Frame-accurate playhead" />
          </div>
          <div className="editor-preview-actions">
            <button onClick={() => void openPreview(false)}>OPEN FRAME-ACCURATE PREVIEW</button>
            {draft.status === 'done' && <button onClick={() => void openPreview(true)}>PREVIEW OUTPUT</button>}
          </div>
          <div className="editor-note">
            {activeTrim
              ? `> TRIMMED ${stamp(activeTrim.in)} → ${stamp(activeTrim.out)}. PRESS I / O IN THE NATIVE PREVIEW TO MOVE THE IN AND OUT POINTS.`
              : '> PLAYBACK IS LIMITED TO THE TRIM RANGE. USE THE NATIVE PREVIEW TO SET IN AND OUT POINTS; THEY COME BACK TO THE QUEUE.'}
          </div>
        </section>

        <section className="timeline-panel">
          <div className="panel-kicker">TIMELINE // {draft.type.toUpperCase()}</div>
          <div className="timeline-ruler">{rulerTicks.map((seconds) => <span key={seconds}>{totalDuration > 0 ? stamp(seconds) : '--:--:--.--'}</span>)}</div>
          <div className="timeline-track">
            <label>VIDEO 1</label>
            {draft.sourcePaths.map((source, index) => {
              const trim = trimFor(draft, source, index)
              const duration = clipDurations[index]
              const detail = trim
                ? `${stamp(trim.in)} → ${stamp(trim.out)} // TRIMMED`
                : duration > 0 ? stamp(duration) : `CLIP ${index + 1}`
              return <button
                key={`${source}-${index}`}
                className={`timeline-clip${index === activeSourceIndex ? ' is-active' : ''}${trim ? ' is-trimmed' : ''}`}
                style={{ flexGrow: Math.max(duration, 0) || 1 }}
                onClick={() => { setActiveSourceIndex(index); setPlayhead(0); setPlaying(false) }}
                title={`Inspect ${sourceName(source)}`}
              >
                <span className="timeline-clip-name">{sourceName(source)}</span>
                <small>{detail}</small>
              </button>
            })}
          </div>
          {(draft.type === 'multitrack' || draft.type === 'combo') && <div className="timeline-track">
            <label>TRACKS</label>
            <div className="timeline-audio">{draft.additionalAudioTracks?.length ? draft.additionalAudioTracks.map((track) => track.language.toUpperCase()).join(' + ') : 'EMBEDDED AUDIO ONLY'}</div>
          </div>}
          <div className="timeline-track"><label>CAPTIONS</label><div className="timeline-caption">NOT WIRED TO THE ENCODER YET</div></div>
          {draft.sourcePaths.length > 1 && <div className="editor-note">&gt; SELECT A CLIP TO INSPECT IT. REORDERING SOURCES STAYS IN THE QUEUE RAIL, WHERE THE ORDER IS AUTHORITATIVE.</div>}
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
          <span>{totalDuration > 0 ? `TIMELINE ${stamp(totalDuration)}` : 'TIMELINE LENGTH UNKNOWN — PROBE ON START'}</span>
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
              }
              void window.electronAPI?.applyEditJob(patch)
            }} disabled={!dirty} title={dirty ? undefined : 'NO CHANGES TO APPLY.'}>OK / APPLY</button></>}
        </div>
      </aside>
    </div>
  </div>
}
