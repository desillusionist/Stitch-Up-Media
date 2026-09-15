import React, { useEffect, useRef, useState } from 'react'
import { EditJobPatch, EncodingPreset, QueueTask } from '../types'
import { deriveOutputFilename } from '../lib/outputNaming'

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

const pad = (value: number) => String(Math.max(0, Math.floor(value))).padStart(2, '0')

const formatTimecode = (seconds: number, fps: number) => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const rate = fps > 0 ? Math.round(fps) : 25
  const totalFrames = Math.floor(safeSeconds * rate)
  const totalSeconds = Math.floor(totalFrames / rate)
  return `${pad(totalSeconds / 3600)}:${pad((totalSeconds % 3600) / 60)}:${pad(totalSeconds % 60)}:${pad(totalFrames % rate)}`
}

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
  const [tab, setTab] = useState<Tab>('EXPORT')
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [incomingConflict, setIncomingConflict] = useState<QueueTask | null>(null)
  // Mirrors of the editable state so the IPC listener can decide without stale closures.
  const draftRef = useRef<QueueTask | null>(null)
  const baselineRef = useRef<QueueTask | null>(null)

  const commit = (nextBaseline: QueueTask | null, nextDraft: QueueTask | null) => {
    baselineRef.current = nextBaseline
    draftRef.current = nextDraft
    setBaseline(nextBaseline)
    setDraft(nextDraft)
  }

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onEditJobTask((incoming) => {
      const currentDraft = draftRef.current
      const currentBaseline = baselineRef.current
      // Never silently destroy unsaved edits; surface the change and let the user choose.
      if (currentDraft && currentBaseline && isDirty(currentDraft, currentBaseline)
        && sliceSignature(incoming) !== sliceSignature(currentBaseline)) {
        setIncomingConflict(incoming)
        return
      }
      setIncomingConflict(null)
      setPlayhead(0)
      setPlaying(false)
      baselineRef.current = incoming
      draftRef.current = incoming
      setBaseline(incoming)
      setDraft(incoming)
    })
    return () => unsubscribe?.()
  }, [])

  // The playhead is driven by real probe duration, not a decorative counter.
  const duration = draft?.sourceInfo?.duration ?? draft?.sequenceInput?.duration ?? 0
  const fps = draft?.preset.fps || draft?.sourceInfo?.videoStreams?.[0]?.fps || 25

  useEffect(() => {
    if (!playing || duration <= 0) return
    const step = 1 / Math.max(1, Math.round(fps))
    const timer = window.setInterval(() => {
      setPlayhead((current) => (current + step >= duration ? 0 : current + step))
    }, 1000 / Math.max(1, Math.round(fps)))
    return () => window.clearInterval(timer)
  }, [playing, duration, fps])

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

  const dirty = isDirty(draft, baseline ?? draft)
  const container = draft.preset.container
  const audioOnly = AUDIO_CONTAINERS.includes(container)
  const isImageContainer = IMAGE_CONTAINERS.includes(container)
  const isGif = container === 'gif'
  const audioDisabled = audioOnly || isGif || isImageContainer
  const videoReason = audioOnly ? 'THIS CONTAINER CARRIES AUDIO ONLY.' : isGif ? 'GIF OUTPUT FORCES THE GIF ENCODER AND DROPS AUDIO.' : undefined
  const audioReason = audioOnly ? undefined : isGif ? 'GIF OUTPUT CARRIES NO AUDIO.' : isImageContainer ? 'IMAGE OUTPUT CARRIES NO AUDIO TRACK.' : undefined
  const trimFor = (filePath: string, index: number) => draft.trimPoints?.[`${filePath}#${index}`] || draft.trimPoints?.[filePath]

  const apply = () => {
    const patch: EditJobPatch = {
      id: draft.id,
      preset: draft.preset,
      outputFilename: draft.outputFilename,
      outputFilenameManuallySet: draft.outputFilenameManuallySet,
    }
    void window.electronAPI?.applyEditJob(patch)
  }

  const reloadFromQueue = () => {
    if (!incomingConflict) return
    setIncomingConflict(null)
    setPlayhead(0)
    setPlaying(false)
    commit(incomingConflict, incomingConflict)
  }

  return <div className="edit-job-shell">
    <header className="editor-header">
      <div><span className="panel-kicker">STITCH UP MEDIA // EDIT JOB</span><h1>{sourceName(draft.sourcePaths[0])}</h1></div>
      <span className="job-mark">{draft.type === 'stitch' ? 'STITCH UP' : draft.type === 'multitrack' ? 'MULTI-TRACK' : draft.type === 'combo' ? 'COMBO' : 'CONVERT'}</span>
    </header>

    {incomingConflict && <div className="editor-conflict" role="alert">
      <div><span className="panel-kicker">QUEUE CHANGED WHILE YOU WERE EDITING</span><p>Your unsaved edits are still here. Reloading discards them and takes the queue&apos;s version.</p></div>
      <div className="editor-conflict-actions">
        <button onClick={() => setIncomingConflict(null)}>KEEP MY EDITS</button>
        <button className="primary-retro" onClick={reloadFromQueue}>RELOAD FROM QUEUE</button>
      </div>
    </div>}

    <div className="editor-body">
      <main className="editor-main">
        <section className="editor-preview">
          <div className="panel-kicker">PREVIEW // FRAME ACCURATE</div>
          <div className="editor-screen"><span>{sourceName(draft.sourcePaths[0])}</span><b>{playing ? '\u25b6 PLAYING' : '\u25a0 PAUSED'}</b></div>
          <div className="transport">
            <button disabled={duration <= 0} onClick={() => setPlayhead(Math.max(0, playhead - 1 / Math.max(1, fps)))} title={duration <= 0 ? 'SOURCE DURATION UNKNOWN — PROBE ON START.' : undefined}>[|&lt;] FRAME</button>
            <button disabled={duration <= 0} onClick={() => setPlaying(!playing)} title={duration <= 0 ? 'SOURCE DURATION UNKNOWN — PROBE ON START.' : undefined}>[{playing ? '||' : '\u25b6'}] PLAY</button>
            <button disabled={duration <= 0} onClick={() => setPlayhead(Math.min(duration, playhead + 1 / Math.max(1, fps)))} title={duration <= 0 ? 'SOURCE DURATION UNKNOWN — PROBE ON START.' : undefined}>[&gt;|] FRAME</button>
            <span>{formatTimecode(playhead, fps)} / {formatTimecode(duration, fps)}</span>
            <input type="range" min="0" max={duration || 1} step={duration > 0 ? 1 / Math.max(1, Math.round(fps)) : 1} value={duration > 0 ? Math.min(playhead, duration) : 0} disabled={duration <= 0} onChange={(event) => setPlayhead(Number(event.target.value))} aria-label="Frame-accurate playhead" />
          </div>
          <div className="editor-note">&gt; FRAME RENDERING IS NOT WIRED TO THIS WINDOW YET — THE PLAYHEAD TRACKS REAL SOURCE DURATION.</div>
        </section>

        <section className="timeline-panel">
          <div className="panel-kicker">TIMELINE // {draft.type.toUpperCase()}</div>
          <div className="timeline-ruler">00:00 &nbsp;&nbsp;&nbsp;&nbsp; 00:10 &nbsp;&nbsp;&nbsp;&nbsp; 00:20 &nbsp;&nbsp;&nbsp;&nbsp; 00:30</div>
          <div className="timeline-track">
            <label>VIDEO 1</label>
            {draft.sourcePaths.map((source, index) => {
              const trim = trimFor(source, index)
              const metadata = draft.sourceMetadata?.[source]
              const detail = trim ? `${formatTimecode(trim.in, fps)} — ${formatTimecode(trim.out, fps)} // TRIMMED` : metadata?.duration ? `${formatTimecode(metadata.duration, fps)} // SOURCE` : index === 0 ? '00:00 — SOURCE' : `CLIP ${index + 1} // JUNCTION >`
              return <div className="timeline-clip" key={`${source}-${index}`}>{sourceName(source)}<small>{detail}</small></div>
            })}
          </div>
          {(draft.type === 'multitrack' || draft.type === 'combo') && <div className="timeline-track">
            <label>TRACKS</label>
            <div className="timeline-audio">{draft.additionalAudioTracks?.length ? draft.additionalAudioTracks.map((track) => track.language.toUpperCase()).join(' + ') : 'EMBEDDED AUDIO ONLY'}</div>
          </div>}
          <div className="timeline-track"><label>CAPTIONS</label><div className="timeline-caption">NOT WIRED TO THE ENCODER YET</div></div>
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
            <EditorRow label="EXACT SIZE" value={draft.preset.width && draft.preset.height ? `${draft.preset.width}\u00d7${draft.preset.height} \u2014 OVERRIDES NAMED RESOLUTION` : 'NOT SET'} />
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
          <span>{duration > 0 ? `DURATION ${formatTimecode(duration, fps)}` : 'DURATION UNKNOWN — PROBE ON START'}</span>
          <span>{dirty ? 'UNSAVED CHANGES' : 'NO CHANGES'}</span>
        </div>

        <div className="editor-actions">
          {confirmingDiscard
            ? <><span className="editor-confirm">DISCARD UNSAVED CHANGES?</span><button onClick={() => setConfirmingDiscard(false)}>KEEP EDITING</button><button className="editor-danger" onClick={() => void window.electronAPI?.cancelEditJob()}>DISCARD</button></>
            : <><button onClick={() => (dirty ? setConfirmingDiscard(true) : void window.electronAPI?.cancelEditJob())}>CANCEL</button><button className="primary-retro" onClick={apply} disabled={!dirty} title={dirty ? undefined : 'NO CHANGES TO APPLY.'}>OK / APPLY</button></>}
        </div>
      </aside>
    </div>
  </div>
}
