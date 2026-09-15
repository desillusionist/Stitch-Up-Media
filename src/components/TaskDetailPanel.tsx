import React, { useState } from 'react'
import { QueueTask } from '../types'

interface Props {
  task: QueueTask | null
  onOpenPresetPicker: (task: QueueTask) => void
  onChangeOutputName: (task: QueueTask) => void
  onConvert: () => void
}
const Row: React.FC<{ label: string; value: string; onClick?: () => void; disabled?: boolean }> = ({ label, value, onClick, disabled }) => <button disabled={disabled} onClick={onClick} className="detail-row"><span>{label}</span><strong>{value}</strong><b>{disabled ? '—' : '>'}</b></button>
const Section: React.FC<{ title: string; children: React.ReactNode; open?: boolean }> = ({ title, children, open = false }) => <details className="detail-section" open={open}><summary>{title}<span>&gt;</span></summary><div className="detail-section-body">{children}</div></details>
export const TaskDetailPanel: React.FC<Props> = ({ task, onOpenPresetPicker, onChangeOutputName, onConvert }) => {
  const [previewMode, setPreviewMode] = useState<'single' | 'duplex'>('single')
  if (!task) return <section className="detail-workspace"><div className="detail-empty"><div className="pixel-media">◼◼<br />◼◼</div><h2>SELECT A QUEUE ITEM</h2><p>Choose a task from the queue rail to inspect its settings.</p></div></section>
  const info = task.sourceInfo
  const status = task.status === 'done' ? 'DONE.' : task.status === 'encoding' ? `ENCODING ${task.progress}%` : task.status === 'error' ? 'ERROR.' : task.status === 'paused' ? 'PAUSED.' : 'READY.'
  return <section className="detail-workspace" aria-label="Task detail">
    <div className="preview-panel"><div className="panel-kicker">PREVIEW // {previewMode.toUpperCase()}</div><div className="preview-screen"><span>{task.status === 'done' ? 'OUTPUT READY' : task.sourcePaths[0]?.split('/').pop() || 'NO MEDIA'}</span><i>▶</i></div><div className="preview-controls"><button onClick={() => setPreviewMode('single')} className={previewMode === 'single' ? 'active' : ''}>SINGLE</button><button onClick={() => setPreviewMode('duplex')} className={previewMode === 'duplex' ? 'active' : ''}>DUPLEX</button><input type="range" min="0" max="100" defaultValue="0" aria-label="Preview scrubber" /></div></div>
    <div className="detail-heading"><div><span className="panel-kicker">TASK DETAIL // {task.type.toUpperCase()}</span><h1>{task.sourcePaths[0]?.split('/').pop() || 'UNTITLED MEDIA'}</h1></div><button className="primary-retro" onClick={onConvert}>[C] CONVERT</button></div>
    <div className="detail-grid"><div className="detail-card"><div className="panel-kicker">INPUT MEDIA INFO</div><Row label="FORMAT" value={info?.format || 'PROBE ON START'} disabled={!info} /><Row label="DURATION" value={info?.duration ? `${Math.round(info.duration)} SEC` : '—'} disabled={!info} /><Row label="SIZE" value={info?.size ? `${(info.size / 1048576).toFixed(1)} MB` : '—'} disabled={!info} /></div><div className="detail-card"><div className="panel-kicker">OUTPUT</div><Row label="NAME" value={task.outputFilename} onClick={() => onChangeOutputName(task)} /><Row label="PRESET" value={task.preset.name} onClick={() => onOpenPresetPicker(task)} /><Row label="CONTAINER" value={task.preset.container.toUpperCase()} onClick={() => onOpenPresetPicker(task)} /></div></div>
    <Section title="TRIM + FADE"><div className="disabled-note">NOT CONFIGURED FOR THIS TASK — PRECISE TRIM WILL FORCE RE-ENCODE.</div></Section>
    <Section title="VIDEO" open><Row label="CODEC" value={task.preset.videoCodec.toUpperCase()} onClick={() => onOpenPresetPicker(task)} /><Row label="BITRATE" value={task.preset.videoBitrate || 'SOURCE'} onClick={() => onOpenPresetPicker(task)} /><Row label="RESOLUTION" value={task.preset.width && task.preset.height ? `${task.preset.width}×${task.preset.height}` : task.preset.resolution.toUpperCase()} onClick={() => onOpenPresetPicker(task)} /><Row label="FRAME RATE" value={task.preset.fps ? `${task.preset.fps} FPS` : 'SOURCE'} onClick={() => onOpenPresetPicker(task)} /></Section>
    <Section title="AUDIO TRACKS"><div className="disabled-note">{task.preset.audioEnabled === false ? 'AUDIO DISABLED' : 'SOURCE AUDIO / ADD TRACK IN MULTI-TRACK MODE'}</div></Section>
    <Section title="METADATA + OVERLAYS"><div className="disabled-note">&gt; ADVANCED METADATA AND OVERLAYS READY FOR CONFIGURATION</div></Section>
    <div className="status-panel"><div><span className="panel-kicker">STATUS</span><strong>{status}</strong></div><span>{task.progress || 0}%</span><div className="dither-progress"><i style={{ width: `${task.progress || 0}%` }} /></div></div>
  </section>
}
