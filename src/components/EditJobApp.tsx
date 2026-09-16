import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AppSettings, EditJobPatch, EncodingPreset, QueueTask } from '../types'
import { deriveOutputFilename } from '../lib/outputNaming'
import { resolveQuickLookRequest } from '../lib/quickLookTarget'
import { mediaUrl } from '../lib/mediaUrl'
import { buildTimeline, frameStamp, sourceDuration, sourceFps, SourceTiming, timecode, TimelineLane, TimelineModel, TimelineSegment } from '../lib/timelineModel'
import { useConsolidatedPlayback } from '../hooks/useConsolidatedPlayback'

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
  const [mediaTarget, setMediaTarget] = useState<{ path: string; stillMode: boolean; sourcePath: string } | null>(null)
  // Mirrors of the editable state so the IPC listener can decide without stale closures.
  const draftRef = useRef<QueueTask | null>(null)
  const baselineRef = useRef<QueueTask | null>(null)
  const audioElementsRef = useRef<Record<string, HTMLAudioElement | null>>({})
  const [probedTiming, setProbedTiming] = useState<Record<string, SourceTiming>>({})
  // Paths already handed to the prober. A failed probe is not retried, so the
  // effect cannot loop on an unreadable file.
  const probedPathsRef = useRef<Set<string>>(new Set())

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
    draft.preset.fps, draft.stillImageDuration,
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

  const playback = useConsolidatedPlayback(
    model ?? { lanes: [], duration: 0, unusedVideoSources: [] },
    audioElementsRef,
    { playable: Boolean(model && model.duration > 0) },
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
      setMediaTarget(request ? { path: request.target, stillMode: request.stillMode, sourcePath: task.sourcePaths[focusedSourceIndex] || task.sourcePaths[0] || '' } : null)
    })
    return () => { cancelled = true }
  }, [timelineSignature, focusedSourceIndex])

  if (!draft || !model) return <div className="edit-job-shell"><div className="editor-loading">WAITING FOR QUEUE ITEM...</div></div>

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

  const mainLane = model.lanes[0]
  const audioLanes = model.lanes.filter((lane) => !lane.embedded && lane.segments.length > 0)
  const sequenceSources = new Set([...Object.keys(draft.sequenceInputs || {}), ...(draft.sequenceInput ? [draft.sequenceInput.firstFrame] : [])])
  const stillMode = mediaTarget?.stillMode === true && (mainLane?.segments.length ?? 0) <= 1
  const playable = !stillMode && model.duration > 0
  const fps = sourceFps(draft, playback.segment?.sourcePath ?? focusedSource, undefined, resolveTiming)
  const stamp = (seconds: number) => settings?.timestampDisplayMode === 'framestamp' ? frameStamp(seconds, fps) : timecode(seconds, fps)
  const segmentDetail = (segment: TimelineSegment) => {
    const parts = [stamp(segment.duration)]
    if (segment.trimmed) parts.push('TRIMMED')
    if (segment.sequence) parts.push(`SEQ ${segment.sequence.frames}F @ ${segment.sequence.fps}FPS`)
    if (segment.still) parts.push('STILL')
    return parts.join(' // ')
  }
  const clipTitle = (segment: TimelineSegment) => {
    const kind = segment.sequence
      ? `image sequence, ${segment.sequence.frames} frames at ${segment.sequence.fps} fps`
      : segment.still ? 'still image' : 'media'
    return `${sourceName(segment.sourcePath)} — ${kind}, ${stamp(segment.duration)}${segment.trimmed ? ', trimmed' : ''}`
  }
  const duration = model.duration

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
    const request = await resolveQuickLookRequest(draft, window.electronAPI, { sourceIndex: focusedSourceIndex })
    if (!request) return
    void window.electronAPI?.quickLook(request.target, draft.id, request.trimIn, request.trimOut, request.sourceIndex, request.stillMode, settings?.screenshotDirectory, settings?.timestampDisplayMode || 'timestamp', request.sequenceFps, request.sequenceFrameCount)
  }

  const laneGap = (lane: TimelineLane) => Math.max(0, duration - lane.duration)
  const activeSegmentKey = playback.segment?.key
  const playheadFraction = duration > 0 ? Math.max(0, Math.min(1, playback.position / duration)) : 0
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
              : stillMode && mediaTarget
                ? <img className="editor-still" src={mediaUrl(mediaTarget.path)} alt={sourceName(mediaTarget.path)} />
                : elementUrl
                  ? <video
                    ref={playback.videoRef}
                    className="editor-video"
                    src={elementUrl}
                    preload="metadata"
                    playsInline
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
          <div className="editor-note">&gt; SCRUB ANYWHERE, OR CLICK A LANE BELOW TO JUMP. IN AND OUT POINTS ARE SET IN THE NATIVE PREVIEW AND COME BACK TO THE QUEUE.</div>
        </section>

        <section className="timeline-panel">
          <div className="panel-kicker">TIMELINE // {draft.type.toUpperCase()}</div>
          <div className="timeline-ruler">{Array.from({ length: 5 }, (_, index) => (duration * index) / 4).map((seconds) => <span key={seconds}>{duration > 0 ? stamp(seconds) : '--:--:--.--'}</span>)}</div>
          <div className="timeline-lanes">
            {model.lanes.map((lane) => (
              <div className="timeline-lane" key={lane.id}>
                <label>{lane.label}</label>
                <div className={`timeline-lane-track${lane.kind === 'audio' ? ' is-audio' : ''}`} onClick={seekFraction} title="Click to jump to this point">
                  {lane.segments.map((segment) => (
                    <div
                      key={segment.key}
                      className={`timeline-clip${segment.trimmed ? ' is-trimmed' : ''}${segment.key === activeSegmentKey ? ' is-active' : ''}`}
                      style={{ flexGrow: Math.max(segment.duration, 0.001) }}
                      title={clipTitle(segment)}
                    >
                      <span className="timeline-clip-name">{sourceName(segment.sourcePath)}</span>
                      <small>{segmentDetail(segment)}</small>
                    </div>
                  ))}
                  {laneGap(lane) > 0 && <div className="timeline-fill" style={{ flexGrow: laneGap(lane) }} title="No media on this lane" />}
                </div>
              </div>
            ))}
            <div className="timeline-playhead" style={{ left: `calc(74px + ${playheadFraction} * (100% - 74px))` }} aria-hidden="true" />
          </div>
          {model.unusedVideoSources.length > 0 && <div className="editor-note">&gt; {model.unusedVideoSources.length} EXTRA VIDEO SOURCE(S) ({model.unusedVideoSources.map(sourceName).join(', ')}) ARE NOT USED: COMBO DISPATCHES TO THE MULTI-TRACK ENCODER PATH, WHICH MAPS ONE VIDEO STREAM. SPLIT INTO A STITCH JOB TO CONCATENATE THEM.</div>}
          <div className="editor-note">&gt; LANE WIDTHS ARE THE REAL TRIMMED DURATIONS. AUDIO TRACKS PLAY ALONGSIDE THE VIDEO FROM ZERO, SO THE OUTPUT RUNS TO {duration > 0 ? stamp(duration) : 'AN UNKNOWN LENGTH'}.</div>
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
          <span>{duration > 0 ? `ASSEMBLED ${stamp(duration)} ACROSS ${model.lanes.length} LANE(S)` : 'LENGTH UNKNOWN — PROBE ON START'}</span>
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

    {audioLanes.map((lane) => {
      const laneSegment = lane.segments[0]
      const url = laneSegment ? sourceUrlFor(laneSegment) : null
      return url ? <audio
        key={lane.id}
        ref={(element) => { audioElementsRef.current[lane.id] = element }}
        src={url}
        preload="auto"
      /> : null
    })}
  </div>
}
