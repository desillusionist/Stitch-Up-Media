import React from 'react'
import { EditorSelect } from './EditorSelect'
import { YOUTUBE_HEIGHTS } from '../lib/youtubeOptions'

/**
 * The link dialog, drawn in the window's own language.
 *
 * It exists as a component rather than as markup inside the queue window for one reason: a dialog that is only ever
 * built inline is a dialog nobody can measure, and this one was drawn with buttons that did not fit their own text
 * and a footer whose two buttons did not line up. `check-queue` mounts it and reads the boxes it actually drew.
 *
 * The layout is two labelled rows and a footer: the fields take the width, the footer's two buttons are sized to
 * their own text and share one baseline, and the primary one is filled with the accent the way the app's other
 * primary action is (START QUEUE), with the cancel beside it outlined and mute.
 */
export interface YouTubeState {
  open: boolean
  url: string
  directory: string
  busy: boolean
  percent: number | null
  error: string | null
  /** The largest height to take, or 0 for the best there is. */
  height: number
  /** Ask for H.264 + AAC, which is what macOS can preview. On by default — see `formatSelector`. */
  previewSafe: boolean
}

export const YouTubeDialog: React.FC<{
  state: YouTubeState
  onChange: (next: Partial<YouTubeState>) => void
  onChooseDirectory: () => void
  onDownload: () => void
  onCancel: () => void
}> = ({ state, onChange, onChooseDirectory, onDownload, onCancel }) => {
  if (!state.open) return null
  return (
    <div className="drop-chooser" role="dialog" aria-modal="true" aria-label="Download a YouTube video">
      <div className="drop-chooser-box youtube-dialog">
        <span className="panel-kicker">ADD MEDIA // DOWNLOAD</span>
        <h2>FETCH A VIDEO</h2>
        <label className="youtube-field">
          <span>LINK</span>
          <input
            type="url"
            autoFocus
            className="youtube-input"
            placeholder="https://www.youtube.com/watch?v=…"
            value={state.url}
            disabled={state.busy}
            onChange={(event) => onChange({ url: event.target.value, error: null })}
            onKeyDown={(event) => { if (event.key === 'Enter') onDownload() }}
          />
        </label>
        <div className="youtube-row">
          <div className="youtube-field youtube-quality">
            <span>QUALITY</span>
            <EditorSelect
              value={String(state.height)}
              options={YOUTUBE_HEIGHTS.map((height) => ({ value: String(height), label: height === 0 ? 'BEST AVAILABLE' : `${height}P` }))}
              disabled={state.busy}
              ariaLabel="Download quality"
              onChange={(next) => onChange({ height: Number(next) || 0 })}
            />
          </div>
          <label className="youtube-switch">
            <input type="checkbox" checked={state.previewSafe} disabled={state.busy} onChange={(event) => onChange({ previewSafe: event.target.checked })} />
            <span>MACOS PREVIEW</span>
          </label>
        </div>
        <p className="youtube-hint">
          {state.previewSafe
            ? 'H.264 + AAC, which Finder’s Quick Look and this app’s own preview can play. YouTube only offers H.264 up to 1080p; above that the best available is taken.'
            : 'The best codecs YouTube has — usually VP9 or AV1, which play in this app’s monitor but NOT in Finder’s Quick Look.'}
        </p>
        <div className="youtube-field">
          <span>DOWNLOAD TO</span>
          <div className="youtube-destination">
            <span className="youtube-path" title={state.directory}>{state.directory || 'Downloads'}</span>
            <button className="youtube-choose" disabled={state.busy} onClick={onChooseDirectory}>CHOOSE…</button>
          </div>
        </div>
        {state.busy && (
          <div className="youtube-progress">
            <span>{state.percent == null ? 'STARTING…' : `DOWNLOADING ${Math.round(state.percent)}%`}</span>
            <div className="youtube-progress-bar"><div className="youtube-progress-fill" style={{ width: `${state.percent ?? 0}%` }} /></div>
          </div>
        )}
        {state.error && <p className="youtube-error">{state.error}</p>}
        <div className="youtube-actions">
          <button className="youtube-cancel" disabled={state.busy} onClick={onCancel}>CANCEL</button>
          <button className="youtube-download" disabled={state.busy || !state.url.trim()} onClick={onDownload}>{state.busy ? 'DOWNLOADING…' : 'DOWNLOAD'}</button>
        </div>
      </div>
    </div>
  )
}
