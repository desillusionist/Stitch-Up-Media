import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, Lock, RotateCcw, Unlink, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import { AppSettings, ClipSpeed, EditJobPatch, EncodingPreset, EmbeddedAudioStream, Insets, MediaProbeInfo, MediaStreamInfo, QueueTask, SourceCrop, SourceFit, TransitionType } from '../types'
import { deriveOutputFilename } from '../lib/outputNaming'
import { mediaKind } from '../lib/mediaKind'
import { outputCarriesPicture, outputTakesArt } from '../lib/outputKind'
import { DEFAULT_EQ_STYLE, DEFAULT_TUNE, DRAWING_STILL_SETTLE_MS, DRAWING_THEMES, EQ_AMPLITUDE_SCALES, EQ_FREQUENCY_SCALES, EQ_MAX_BARS, EQ_MAX_GAP, EQ_MAX_SENSITIVITY, EQ_MIN_BARS, EQ_MIN_SENSITIVITY, EQ_PEAK_DECAY_MAX, EQ_PEAK_DECAY_MIN, EQ_SEGMENT_GAP_MAX, SCOPE_DRAWS, SCOPE_MAX_ZOOM, SCOPE_MIN_ZOOM, SPECTRUM_MAX_SATURATION, SPECTRUM_MIN_SATURATION, SPECTRUM_SCALES, VISUALIZATION_BACKGROUND, VISUALIZATION_BACKGROUNDS, VISUALIZATIONS, WAVE_CHANNELS, WAVE_SCALES, WAVE_WEIGHTS, clampEqBars, clampEqGap, clampEqSensitivity, clampPeakDecay, clampSaturation, clampScopePersist, clampScopeZoom, clampSegmentGap, drawingColorOf, drawingPictureFor, drawingTuneOf, eqStyleOf, isBarsTemplate, isSpectrumTemplate, isWaveTemplate, templateFor, themeFor, visualizationBackgroundKind, visualizationProgressLine } from '../lib/visualization'
import { speedLabel, steppedPreviewSpeed } from '../lib/previewSpeed'
import { DEFAULT_CLIP_SPEED, MAX_CLIP_SPEED, MIN_CLIP_SPEED, clampClipSpeed, clipSpeedLabel, sourceTimeAt, speedFor } from '../lib/clipSpeed'
import { addedClipNumbers, clipIdAt, clipKey, copyLabelFor, materializeClipIds, materializeClipNumbers, moveAlong, newClipId, newClipIds, newTrackId, nextClipNumber, trackKey } from '../lib/clipIds'
import { MIN_TRIM_SECONDS, TrimWindow, dragTrimWindow, trimWindowOf, windowIsWholeSource } from '../lib/clipTrim'
import { AUDIO_BITRATES, AUDIO_CHANNELS, audioCodecFacts, audioDepthsFor, audioFacts, bitrateApplies, bitrateOptionOf, bitrateValue, clampAudioChannels, probeHasAudio } from '../lib/audioFacts'
import { applyContainerChange, applyImageOutputChoice, AUDIO_CONTAINERS, defaultImageOutputChoiceValue, FRAME_CONTAINERS, IMAGE_CONTAINERS, imageOutputChoicesFor, imageOutputChoiceValue, PICTURE_CONTAINERS } from '../lib/containerSwitch'
import { applyAudioChoice, applyCodecChoice, audioChoiceValue, audioChoicesFor, codecChoiceValue, codecChoicesFor, defaultAudioChoiceValue, defaultCodecChoiceValue } from '../lib/codecChoices'
import { FrameRate, RATE_PRESETS, frameCount, makeRate, rateLabel, rateOf, rateRationalLabel, ratesEqual, rateValue } from '../lib/frameRate'
import { codecTakesRate, estimateLabel, estimateOutputSize, framesFrom } from '../lib/outputSize'
import { rememberedPreviewFor, resolveQuickLookRequest, rememberedProxyFor } from '../lib/quickLookTarget'
import { webviewPlaysVideo } from '../lib/previewCodec'
import { mediaUrl } from '../lib/mediaUrl'
import { EditorSelect } from './EditorSelect'
import { buildTimeline, canApplyClipFit, canApplyClipSpeed, clipIndexOf, clipRangeLabel, clipRateFor, clipSummary, clipsConcatenate, edgeFade, effectiveCropFor, EMPTY_AUDIO_LANE_ID, firstVisualSource, frameNumber, frameStamp, HEAD_FADE_KEY, isStillFrameJob, MAIN_LANE_ID, matchSourceSource, maxEdgeFade, maxFadeAtBoundary, nativeRateFor, nearestInsertPosition, nothingToTime, outputRangeLabel, secondsFromTimecode, sequenceFor, sourceDuration, sourceFitFor, sourceFps, SourceTiming, stampPair, stillSecondsFor, STITCHED_AUDIO_LANE_ID, TAIL_FADE_KEY, taskHasFootage, timecode, TimelineLane, TimelineModel, TimelineSegment, trackEdgeFade, trackEdgeFadeKey, usesAllSource } from '../lib/timelineModel'
import { removeSourceFromTask, inferredMode } from '../lib/sourceRemoval'
import { clipAudioDropped, embeddedAudioEditable, embeddedGainDb, embeddedStreamEnabled, embeddedStreamsFor, extractedBy, gainForDb } from '../lib/embeddedAudio'
import { presetSummary } from '../lib/presetSummary'
import { pixelDepthLabel, proresDepthLabel } from '../lib/pixelDepth'
import { sequenceLabel } from '../lib/sequenceLabel'
import { computeFilmstrip, FILMSTRIP_CLIP_HEIGHT, FILMSTRIP_SETTLE_MS, frameKey, thumbnailSignature } from '../lib/filmstrip'
import { WAVEFORM_BAR, peaksForTrim, waveformPath } from '../lib/waveform'
import { cropBands, cropFractions, cropForProportion, cropPixels, exactSizeFields, hasCrop, holdCropShape, insetCrop, keptAspect, outputFrameSize, resizeCorner, shiftCrop, resolutionBox, aspectSize, resolutionShortSide, resizeExact, clampCrop, MIN_KEPT, CropCorner, CropFractions } from '../lib/outputFrame'
import { DEFAULT_PREVIEW_ZOOM, MAX_PREVIEW_ZOOM, MIN_PREVIEW_ZOOM, PREVIEW_ZOOM_STEPS, PreviewZoom, clampPan, clampPreviewZoom, isPresetZoom, panSlack, zoomedRaster } from '../lib/previewZoom'
import { ZOOM_MAX, ZOOM_MIN, clampZoom, fitZoom, laneWidthFor, rulerTicks, secondsAt, zoomedBy } from '../lib/timelineScale'

/** The edge opposite each of the four, which is what bounds how far one of them may reach in. */
const OPPOSITE_EDGE: Record<keyof CropFractions, keyof CropFractions> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }

/** The output shapes offered as buttons. The frame is the encoder's canvas, not a hint. */
const ASPECTS: Array<{ label: string; ratio: number }> = [
  { label: '16:9', ratio: 16 / 9 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '1:1', ratio: 1 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '9:16', ratio: 9 / 16 },
]
const ASPECT_TOLERANCE = 0.01
/**
 * The shape list's entry for a crop that is holding no shape at all.
 *
 * It replaced an entry called NONE, which cleared the crop outright and so read as the crop being
 * switched off — but switching the crop off is the switch's own job, and a user who wants their own
 * freeform region had no way to say so. FREEFORM says exactly that and changes nothing about the
 * region: it is the entry that lets a corner drag follow the pointer on both axes at once.
 */
const FREEFORM = 'FREEFORM'
/**
 * The shape list's entry that means no crop at all.
 *
 * The list is also the switch now. There used to be a checkbox to turn the crop on and a question to
 * turn it off, and a question was right while the control that asked it could not say what the answer
 * would be — but a list with NONE in it can: choosing NONE IS the decision, so it needs no confirming.
 */
const NO_CROP = 'NONE'
import { sourceTimingOverrides, SourceTimingOverride, withSourceTiming } from '../lib/sourceTiming'
import { DEFAULT_FIT_OFFSET, cropFractionsOf, fitOffsetWithin, hasInsets, innerBox, insetsOf, normaliseInsets, placedSource, sourceCropOf, storedFitOffset } from '../lib/sourceFit'
import { useConsolidatedPlayback } from '../hooks/useConsolidatedPlayback'
import { scrollToKeepVisible, skimmerOffset } from '../lib/timelinePan'
import { placeMenu } from '../lib/menuPlacement'
import { emptyHistory, DraftHistory, endGesture, recordChange, stepHistory as stepBack } from '../lib/draftHistory'
import { NumberField } from './NumberField'

const tabs = ['EXPORT', 'VIDEO', 'IMAGE', 'AUDIO', 'EFFECTS', 'CAPTIONS'] as const
type Tab = typeof tabs[number]

const CONTAINERS: Array<EncodingPreset['container']> = ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'flac', 'png', 'jpg', 'gif']
const RESOLUTIONS: Array<EncodingPreset['resolution']> = ['source', '4k', '1080p', '720p']
/**
 * The PNG encoder's own work setting, 0 to 9.
 *
 * It trades the TIME spent writing the file against its SIZE and never a pixel — a PNG is lossless at
 * every setting. Measured against this machine's own ffmpeg, a 320x240 test frame came out at 231,431
 * bytes at 0 and 12,663 at 9, which is the whole of what the control is for.
 */
const PNG_COMPRESSION_CHOICES = [0, 1, 3, 6, 9] as const
/** The samples a channel is stored in, for the formats that have a choice at all. */
const IMAGE_BIT_DEPTHS = [8, 16] as const
/**
 * The JPEG encoder's quality, in ffmpeg's own `-q:v` figures — which run DOWNWARDS: a lower figure is a
 * better picture and a larger file. Measured here, the same 320x240 frame was 9,374 bytes at 2 and 3,319
 * at 31. It is the one image setting that trades size against the PICTURE rather than against time.
 */
const JPEG_QUALITY_CHOICES = [2, 5, 10, 20, 31] as const
/**
 * The codecs that have a RATE to set at all.
 *
 * The delivery ones do: H.264, H.265, VP9, AV1 and MPEG-4 are all rate-controlled, whether the rate is a
 * bitrate the job names or a quality the encoder turns into one. What is left out is not being coy about
 * it — ProRes is a family of FIXED rates whose profile decides the figure, and DXV, Hap, QuickTime
 * Animation, PNG and GIF are intra-only with no rate control of any kind. A bitrate box beside any of them
 * would be an offer the encoder silently ignores, which is worse than a control that is not drawn.
 */
/** K plus J/L held this long becomes slow motion; a shorter press steps a frame. */
const TAP_THRESHOLD_MS = 250
const SLOW_MOTION_RATE = 0.5

/**
 * The fields this window owns. Everything else on a task belongs to the queue.
 */
const editableSlice = (task: QueueTask) => ({
  preset: task.preset,
  outputFilename: task.outputFilename,
  outputFilenameManuallySet: task.outputFilenameManuallySet ?? false,
  transitions: task.transitions,
  // The trims are this window's too: a clip trimmed on the timeline is a change like any other, and
  // leaving them out of the slice would make the window call itself clean the moment a trim was the
  // first thing touched.
  trimPoints: task.trimPoints,
  // The framing the window owns, exactly as it owns the transitions: a crop, a fit or a mute set on
  // its own is a change like any other, and leaving these out of the slice made the window call
  // itself clean the moment one of them was the first thing touched — so APPLY and OK stayed
  // disabled and the change could not be committed at all.
  sourceFit: task.sourceFit,
  sourceCrop: task.sourceCrop,
  sourceSpeed: task.sourceSpeed,
  sourceFps: task.sourceFps,
  mutedLanes: task.mutedLanes,
  // A clip's own embedded-sound controls are this window's too: which streams the export carries and at
  // what level is a change like any other, so leaving them out made the window call itself clean the
  // moment one was the first thing touched.
  embeddedAudio: task.embeddedAudio,
  // Per-source timing is editable from PROPERTIES, so the window owns it too.
  sourceMetadata: task.sourceMetadata,
  sequenceInput: task.sequenceInput,
  sequenceInputs: task.sequenceInputs,
})

const sliceSignature = (task: QueueTask) => JSON.stringify(editableSlice(task))
const isDirty = (draft: QueueTask, baseline: QueueTask) => sliceSignature(draft) !== sliceSignature(baseline)

/**
 * A three-way merge of the clip trims, so a trim the QUEUE made lands even on a window with unsaved edits.
 *
 * The trims sit in `editableSlice` — a lane trim is a change like any other — which also made the window's
 * own trims win over any incoming list. That is how a QUICK LOOK edit made IN this window stopped reaching
 * the timeline: the helper reported its in/out points, the queue filed them, and the push arrived while the
 * window was dirty (it usually is, if the timeline was just trimmed) where the window's own trims were kept
 * and the helper's were dropped. The baseline is the common ancestor, so each key can be told apart: one the
 * queue touched takes the queue's value, one only the window touched keeps the window's, and one BOTH
 * touched takes the queue's, the helper being the newer gesture. The window's own trims for other clips
 * survive, which is why this is a merge rather than a replacement in either direction.
 */
const mergeTrims = (
  baseline: QueueTask['trimPoints'],
  windowTrims: QueueTask['trimPoints'],
  incoming: QueueTask['trimPoints'],
): QueueTask['trimPoints'] => {
  const base = baseline ?? {}
  const draft = windowTrims ?? {}
  const theirs = incoming ?? {}
  const merged: NonNullable<QueueTask['trimPoints']> = {}
  const keys = new Set([...Object.keys(base), ...Object.keys(draft), ...Object.keys(theirs)])
  keys.forEach((key) => {
    const changedByQueue = JSON.stringify(theirs[key] ?? null) !== JSON.stringify(base[key] ?? null)
    const chosen = changedByQueue ? theirs[key] : draft[key]
    if (chosen !== undefined) merged[key] = chosen
  })
  return Object.keys(merged).length ? merged : undefined
}

/**
 * Whether the window itself has taken a source out of the job, or a track with it.
 *
 * The source list is the queue's, and the window adopts the queue's version of it — with every clip's
 * records re-keyed to their new places — whenever the queue changes it. What this reports is the
 * window's OWN change to that list, which has to survive until the window applies: the queue
 * confirming the list the window started from is not an edit of its own arriving, and must not take
 * the removal back.
 */
const sourceListMoved = (draft: QueueTask, baseline: QueueTask) =>
  JSON.stringify(draft.sourcePaths) !== JSON.stringify(baseline.sourcePaths)
  || JSON.stringify(draft.additionalAudioTracks ?? []) !== JSON.stringify(baseline.additionalAudioTracks ?? [])
  // And the ids, because a swap of two copies of one file leaves the PATH list identical and only the ids
  // show that the list moved.
  || JSON.stringify(draft.clipIds ?? []) !== JSON.stringify(baseline.clipIds ?? [])
  || JSON.stringify(draft.clipNumbers ?? []) !== JSON.stringify(baseline.clipNumbers ?? [])

/**
 * Whether the window has unsaved edits: the slice the queue is compared on, plus the source list.
 *
 * The list is deliberately not part of that slice — the queue owns it, and a change to it arriving
 * from there is adopted rather than announced as a clash. It IS an edit the window made, though, so
 * APPLY and OK have something to send and CANCEL has something to discard.
 */
const windowDirty = (draft: QueueTask, baseline: QueueTask) => isDirty(draft, baseline) || sourceListMoved(draft, baseline)

/**
 * What a right-click on the timeline was on.
 *
 * A clip offers the two things that are about the clip itself: its frame-accurate preview and
 * its properties. A lane head offers the two ways to draw its clips, since that is a property
 * of the lane rather than of any one clip in it.
 */
type TimelineMenu =
  | { kind: 'clip'; x: number; y: number; sourceIndex: number | null; mainIndex: number | null; laneId: string; segmentIndex: number; sourcePath: string; label: string; fitKey: string; visual: boolean; fitReason?: string; confirming?: boolean; duplicating?: boolean; extracting?: boolean; multi?: boolean }
  | { kind: 'lane'; x: number; y: number; laneId: string; label: string }
  /** The TIMELINE kicker's own menu: which unit the window shows lengths in. */
  | { kind: 'stamp'; x: number; y: number }

/**
 * A clip the window has copied: its source and the records that describe it, ready to be placed again.
 *
 * The records are resolved at COPY time rather than read back at paste time, so what is pasted is the clip
 * as it was when it was copied — an edit made in between does not follow it into the paste.
 */
type CopiedClip = {
  sourcePath: string
  trimPoints?: { in: number; out: number }
  sourceFit?: SourceFit
  sourceCrop?: SourceCrop
  sourceSpeed?: ClipSpeed
  sourceFps?: FrameRate
}

const sourceName = (filePath?: string) => filePath?.split('/').pop() || 'UNTITLED'

/**
 * What one embedded stream is CALLED: its place among the sound streams, and its own name where it has one.
 *
 * The language is only worth printing where it says something (`und` is ffmpeg's "unnamed"), and the title
 * wins where the container carries one, because that is the name a reader gave the track.
 */
const embeddedStreamLabel = (stream: MediaStreamInfo, index: number): string => {
  const title = (stream.title || '').trim()
  const language = (stream.language || '').toLowerCase()
  const named = title || (language && language !== 'und' ? language.toUpperCase() : '')
  return `STREAM ${index + 1}${named ? ` // ${named}` : ''}`
}

/**
 * The timeline's scale.
 *
 * A component of its own because it is the one part of the timeline that has to re-render when the
 * TIMELINE is scrolled, and only what it draws should. It reads the stretch of lane that is on screen
 * and asks the scale for the marks in that stretch, so a close zoom on a long job draws a hundred marks
 * rather than the tens of thousands the whole drawing would hold — of which the same hundred are ever
 * visible. Keeping that state upstairs would redraw every lane and every strip on every scroll event,
 * which is the whole window sixty times a second.
 *
 * The labels are passed in rather than made here, because what a mark SAYS is the window's business:
 * frames or timecodes, decided by a setting this component has no opinion about.
 */
const TimelineRuler: React.FC<{
  duration: number
  zoom: number
  fps: number
  label: (seconds: number) => string
  scroller: React.RefObject<HTMLDivElement | null>
  onWheel: (event: React.WheelEvent<HTMLElement>) => void
}> = ({ duration, zoom, fps, label, scroller, onWheel }) => {
  const [visible, setVisible] = useState({ from: 0, to: 0 })
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    // Half a viewport either side of what is shown, so a mark is drawn before it is scrolled onto the
    // screen rather than a moment after.
    const read = () => setVisible({
      from: secondsAt(Math.max(0, element.scrollLeft - element.clientWidth / 2), zoom),
      to: secondsAt(element.scrollLeft + element.clientWidth * 1.5, zoom),
    })
    read()
    element.addEventListener('scroll', read, { passive: true })
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', read)
      observer.disconnect()
    }
  }, [scroller, zoom])

  const ticks = rulerTicks(duration, zoom, visible, fps)
  return <div className="timeline-ruler" onWheel={onWheel}>
    {duration > 0
      ? ticks.map((tick) => (
        <span
          key={tick.time}
          className={`ruler-tick${tick.major ? ' is-major' : ''}`}
          style={{ left: `${laneWidthFor(tick.time, zoom)}px`, transform: tick.time >= duration ? 'translateX(-100%)' : 'none' }}
        >
          {tick.major ? label(tick.time) : null}
        </span>
      ))
      : <span className="ruler-tick is-major" style={{ left: 0 }}>--:--:--.--</span>}
  </div>
}

const EditorRow: React.FC<{ label: string; value: React.ReactNode; reason?: string }> = ({ label, value, reason }) => (
  <div className="editor-row" title={reason}><span>{label}</span><strong>{value}</strong></div>
)

/**
 * One side of the trim's two-up view: the frame a clip shows at a given SOURCE second.
 *
 * A SECOND element, mounted only for the drag: a `<video>` seeked to the edge second for footage, the
 * picture itself for a still, and the generated clip for a sequence — the same target the filmstrip and
 * the monitor already resolve. Its box is the OUTPUT's own aspect ratio, so each pane is shaped like the
 * export and the two read side by side; the media is contained in it, so a clip of another shape is
 * letterboxed rather than stretched.
 */
const TrimPairPane: React.FC<{
  label: string
  sourcePath: string
  still: boolean
  videoUrl: string | null
  seekTo: number
  aspect: string
}> = ({ label, sourcePath, still, videoUrl, seekTo, aspect }) => (
  <div className="editor-trim-pane" style={{ aspectRatio: aspect }} aria-hidden="true">
    <span className="editor-trim-pane-label">{label}</span>
    {still
      ? <img className="editor-trim-pane-media" src={mediaUrl(sourcePath)} alt="" draggable={false} />
      : videoUrl
        ? <video
          className="editor-trim-pane-media"
          src={videoUrl}
          preload="auto"
          muted
          playsInline
          ref={(element) => { if (element) { try { element.currentTime = seekTo } catch { /* the seek lands on metadata */ } } }}
          onLoadedMetadata={(event) => { try { event.currentTarget.currentTime = seekTo } catch { /* nothing to seek yet */ } }}
        />
        : <span className="editor-trim-pane-none">NO FRAME</span>}
  </div>
)

/**
 * One editable setting: its name, an optional reading of the figure beside it, and a way back.
 *
 * The RESET sits at the end of the name row and takes that field, and only that field, back to what an
 * untouched job has: the codec a container opens on, no bitrate, the clip's own speed. It is drawn only
 * when there is something to put back — a reset that is always there is a button whose press mostly does
 * nothing — and it is prevented from reaching the label, whose own click would otherwise hand the press
 * to the control underneath.
 */
const EditorField: React.FC<{ label: string; hint?: string; reason?: string; canReset?: boolean; onReset?: () => void; children: React.ReactNode }> = ({ label, hint, reason, canReset, onReset, children }) => (
  <label
    className="editor-field"
    title={reason}
    // A FIELD'S OWN BOX IS NOT A HANDLE FOR ANYTHING INSIDE IT. A `<button>` is a LABELABLE element, so a
    // click anywhere on a field's `<label>` — its heading, the padding around it, or the dotted rule drawn
    // under it, all of which ARE the label's own box — makes the browser forward a synthetic click to the
    // FIRST labelable thing inside it. That is the RESET button wherever a field has one, and the dropdown's
    // trigger otherwise; so a click on a heading either put the setting back or opened its menu, and neither
    // is what clicking the NAME of a field means. The forwarding is cancelled for every click that did not
    // land on a control the reader was aiming at, which leaves the controls themselves working.
    onClick={(event) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, .editor-select-trigger')) return
      event.preventDefault()
    }}
  >
    <span>
      {label}
      {hint ? <em>{hint}</em> : null}
      {onReset && canReset ? <button
        type="button"
        className="field-reset"
        aria-label={`Reset ${label.toLowerCase()} to its default`}
        title="Put this back to what an untouched job has"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); onReset() }}
      ><RotateCcw size={11} /></button> : null}
    </span>
    {children}
  </label>
)

/**
 * The FRAMING section's explanations, which used to be paragraphs under the controls.
 *
 * They are the same words: what changed is that they are one gesture away rather than permanently in
 * the way of the two fields they are about.
 */
const INSETS_HELP = 'The margin this clip leaves around itself: the box its fit scales it into. The picture is centred in the box, and the OFFSET slides it from there. All four at 0 is the whole frame, which is what the clip is given until it is inset. The figures are per cent of the output frame, so they mean the same at any resolution.'
const OFFSET_HELP = 'Where the picture sits on the output canvas. 0 and 0 is centred, which is where it sits until it is moved. The figures are the output frame\'s own, so they mean the same at any resolution, and they are not held in: a picture moved past an edge is clipped by the frame, and one that leaves a gap is filled with the background. The monitor\'s dragger writes the same two figures.'
const CROP_HELP = 'What part of the SOURCE this clip keeps, in the source\'s own terms, so a change of output size or shape never invalidates it. The shape list centres the region on a named shape; FREEFORM holds no shape at all, so a corner follows the pointer on both axes and the region keeps whatever shape it has. It is taken before any scaling, so cropping to a shape is a crop then a fit. Drag the edges on the preview, or set the four figures here.'

/**
 * A group of settings that can be folded away, with its own heading acting as the disclosure.
 *
 * The sidebar holds more settings than fit on a screen, and the ones that matter for a given job are
 * rarely all of them: folding is what lets a reader see the shape of the settings rather than a run
 * of fields. It is a way of LOOKING at them, so it is kept per group and out of the export entirely.
 *
 * The whole heading is the target rather than a caret beside it, because a caret to hit is a caret to
 * miss — and a group that needs a switch as well as a disclosure puts BOTH in this one row, so there
 * is never a heading that only repeats the row beneath it.
 */
const EditorGroup: React.FC<{ id: string; label: string; hint?: string; reason?: string; collapsed: boolean; onToggle: (id: string) => void; actions?: React.ReactNode; children: React.ReactNode }> = ({ id, label, hint, reason, collapsed, onToggle, actions, children }) => (
  <section className={`editor-group${collapsed ? ' is-collapsed' : ''}`}>
    <div className="editor-group-head">
      {/* The heading is NAME // SUBLABEL. The name and the sublabel are separate spans so only the
          name can answer a hover, and the separator's spacing comes from the name button's own gap
          plus the space the sublabel starts with rather than from a space inside an inline run, which
          a flex row trims away. */}
      <button type="button" className="editor-group-name" onClick={() => onToggle(id)} title={reason} aria-expanded={!collapsed}>
        <span className="editor-group-label">{label}</span>
        {hint ? <span className="editor-group-hint">{'// '}{hint}</span> : null}
      </button>
      {actions ? <div className="editor-group-actions">{actions}</div> : null}
      <button type="button" className="editor-group-mark" onClick={() => onToggle(id)} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand this section' : 'Collapse this section'}>{collapsed ? '+' : '-'}</button>
    </div>
    {collapsed ? null : <div className="editor-group-body">{children}</div>}
  </section>
)

/**
 * The explanation of a setting, behind a mark rather than in the way.
 *
 * These paragraphs were always on screen, and there are enough of them that the settings they
 * explain had become the minority of the sidebar. The mark reveals the same words on hover, on
 * focus and on a click, so the explanation is one gesture away rather than one paragraph closer.
 */
const EditorInfo: React.FC<{ text: string }> = ({ text }) => {
  const [open, setOpen] = useState(false)
  return <span className="editor-info">
    <button
      type="button"
      className="editor-info-mark"
      aria-label="What this setting does"
      aria-expanded={open}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen(true)}
    >i</button>
    {open ? <span className="editor-info-pop" role="tooltip">{text}</span> : null}
  </span>
}

/**
 * Reports what a media element was handed, and whether it failed on it.
 *
 * A decode failure is a fact about a FILE and a guess about where it came from, and the message the
 * decoder prints names neither: "Unsupported pixel format: -1" says which format was wrong and not
 * which file it was wrong about, so finding the culprit becomes a matter of correlating timings.
 * This names it — the element's kind, the source it was given, and the code the element reports —
 * and writes it to the app's own log, beside the decoder's complaint rather than in a console that
 * nobody is reading.
 *
 * Instrumentation rather than a fix: the fix is not handing an element something it cannot decode.
 * But a wrong guess about WHICH file is being decoded costs more than this line does, and this is the
 * line that ends the guessing.
 */
const logMediaElement = (element: HTMLMediaElement | HTMLImageElement | null, kind: string) => {
  if (!element) return
  const marked = element as (HTMLMediaElement | HTMLImageElement) & { __stitchWatched?: boolean; __stitchLogged?: string }
  if (!marked.__stitchWatched) {
    marked.__stitchWatched = true
    element.addEventListener('error', () => {
      const media = element as HTMLMediaElement
      void window.electronAPI?.diagnosticLog('[media-error]', {
        kind,
        src: element.currentSrc || element.getAttribute('src') || '',
        code: media.error?.code,
        message: media.error?.message,
      })
    })
  }
  // Once per source, so a re-render does not fill the log with the same line.
  const src = element.currentSrc || element.getAttribute('src') || ''
  if (src && src !== marked.__stitchLogged) {
    marked.__stitchLogged = src
    void window.electronAPI?.diagnosticLog('[media-src]', { kind, src })
  }
}

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
  /** The clip the window has copied, waiting to be pasted at the skimmer's nearest [+]. */
  const [copiedClip, setCopiedClip] = useState<CopiedClip | null>(null)
  /** Read by the mount-time key handler, which cannot close over a value rebuilt on every render. */
  const copiedClipRef = useRef<CopiedClip | null>(null)
  copiedClipRef.current = copiedClip
  /**
   * The first sound added to a job, held while the window asks how its tracks should relate.
   *
   * A job that has no tracks is about to gain a second axis of arrangement — stacked, or sequenced end to
   * end — and that is the reader's choice rather than the job's. The files are held until it is made.
   */
  const [audioChoice, setAudioChoice] = useState<{ position: number; visuals: string[]; audios: string[] } | null>(null)
  const [incomingConflict, setIncomingConflict] = useState<QueueTask | null>(null)
  // Resolved preview targets, keyed by the source they belong to. The target is not
  // always the stored path: an image sequence plays through a generated clip. They
  // are all resolved up front rather than when the playhead reaches one, because
  // resolving takes IPC and, for a sequence with no cached clip, a whole ffmpeg run.
  // Doing that on arrival is what made the skimmer stumble at the start of every
  // sequence segment while the monitor said PREPARING THIS SEGMENT.
  const [mediaTargets, setMediaTargets] = useState<Record<string, { path: string; previewUnavailable?: boolean }>>({})
  /** Set when a still could not be turned into a clip, so the monitor is not lying. */
  const [previewNotice, setPreviewNotice] = useState<string | null>(null)
  /**
   * The clip whose PROPERTIES inspector is open, by the lane it is on and its place in that lane.
   *
   * Not an index into `sourcePaths`: an audio track is not one of those, so a menu opened on one could
   * only name the job's first video — and the inspector then described a file the user had not asked
   * about.
   */
  /**
   * The clip the editor is pointed at: what a click on the timeline selects, and what the inspector
   * describes.
   *
   * Not an index into `sourcePaths`: an audio track is not one of those, so a menu opened on one could
   * only name the job's first video — and the inspector then described a file the user had not asked
   * about. It is a SELECTION rather than the moment the inspector was opened, so changing what is
   * selected changes what is described.
   */
  const [selected, setSelected] = useState<{ laneId: string; clipKey: string } | null>(null)
  /**
   * The clips in hand TOGETHER, by their own keys — the anchor plus whatever Shift has added.
   *
   * A group is a set of KEYS rather than of places, so it survives a reorder the way every other per-clip
   * record does. `selected` stays the ANCHOR: the inspector and the context menu describe it, and a Shift
   * click measures its range from it.
   */
  const [multiSelected, setMultiSelected] = useState<string[]>([])
  /** Read by the mount-time key handler, which cannot close over a value rebuilt on every render. */
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const multiSelectedRef = useRef(multiSelected)
  multiSelectedRef.current = multiSelected
  const mainLaneIdRef = useRef<string | undefined>(undefined)
  // The mount-time key handler reaches the clip commands through these, so it always runs the LATEST render's
  // closures rather than the ones in force when it was bound.
  const openRemoveConfirmRef = useRef<() => boolean>(() => false)
  const copySelectedClipRef = useRef<() => boolean>(() => false)
  const pasteCopiedClipRef = useRef<() => boolean>(() => false)
  const splitSelectedRef = useRef<() => boolean>(() => false)
  /** Whether the PROPERTIES inspector is showing. It describes whatever is selected. */
  const [inspectorOpen, setInspectorOpen] = useState(false)
  /** The figure typed into the inspector's CUSTOM FPS field, held while it is open; null is the field shut. */
  const [fpsCustomText, setFpsCustomText] = useState<string | null>(null)
  /** The same for the ENCODING tab's own CUSTOM FPS, which names the OUTPUT rate rather than a clip's. */
  const [outFpsCustomText, setOutFpsCustomText] = useState<string | null>(null)
  // Mirrors of the editable state so the IPC listener can decide without stale closures.
  const draftRef = useRef<QueueTask | null>(null)
  const baselineRef = useRef<QueueTask | null>(null)
  const audioElementsRef = useRef<Record<string, HTMLAudioElement | null>>({})
  /**
   * The still frame the monitor is showing, when it is showing one.
   *
   * A ref OBJECT rather than a callback, because there is nothing to do when it is handed over: the
   * frame is logged from an effect, and an object ref can never be reattached or re-run.
   */
  const stillFrameRef = useRef<HTMLImageElement | null>(null)
  const [probedTiming, setProbedTiming] = useState<Record<string, SourceTiming>>({})
  /**
   * The whole probe of each source, kept for the lines that DESCRIBE a file rather than time it.
   *
   * The effect below has always read a probe to decide whether a source has sound and how long it is, and it
   * then threw everything else away. The audio facts — the rate, the sample size, the channels — are in the
   * same answer, and four places want them: the PROPERTIES inspector, the line under the monitor, the AUDIO
   * tab, and a clip's own line in the simple view. Reading them off a second probe would be a second ffprobe
   * per source for facts the window already had.
   */
  const [sourceProbes, setSourceProbes] = useState<Record<string, MediaProbeInfo>>({})
  /** Sources whose target has been resolved, keyed by source and rate. A generated
   *  clip belongs to a rate, so a rate change is a different target entirely. */
  const resolvedTargetsRef = useRef<Record<string, true>>({})
  // Paths already handed to the prober. A failed probe is not retried, so the
  // effect cannot loop on an unreadable file.
  const probedPathsRef = useRef<Set<string>>(new Set())
  // Horizontal scale only, and it is the only thing that decides how wide a lane is drawn: see
  // src/lib/timelineScale.ts. A window resize changes how much of the timeline is on screen.
  const [zoom, setZoom] = useState(1)
  /** Keeps the exact size's proportions while one of the two fields is edited. */
  const [lockProportion, setLockProportion] = useState(false)
  /** Lanes drawn as strips of frames rather than as a plain clip panel, by lane id. */
  const [filmstripLanes, setFilmstripLanes] = useState<Record<string, boolean>>({})
  /**
   * The lane area's observer, bound by the callback ref below. The lane's width is read rather
   * than assumed: the strip is laid out from it, so a window resize must move it exactly as a
   * zoom does, and a width read only once would go stale the moment the window changed.
   */
  /** Every fetched frame, by source and the key its picture belongs to, so zooming reuses them. */
  const [frameImages, setFrameImages] = useState<Record<string, Record<string, string>>>({})
  /** Frames already asked for and not yet answered, so none is asked for twice. */
  const framesPendingRef = useRef<Record<string, true>>({})
  /** Each source's own shape and rate, which is what the strip's geometry is worked out from. */
  const [sourceShape, setSourceShape] = useState<Record<string, { width: number; height: number; fps: number }>>({})
  /** The media's own pixel size, as the element reports it once it has loaded. */
  const [naturalSize, setNaturalSize] = useState<{ key: string | undefined; width: number; height: number } | null>(null)
  /** Where a right-click on the timeline opened its menu, and what it was on. */
  const [timelineMenu, setTimelineMenu] = useState<TimelineMenu | null>(null)
  /**
   * Whether the INSETS and OFFSET fields read as per cent of the output frame or as pixels of it.
   *
   * ONE switch for both, because they are two halves of one answer: what box the picture is given and
   * where it sits in the frame are read together, and a reader who thinks in pixels of the frame
   * thinks in pixels of it for both. Two switches meant finding the same control twice.
   */
  const [framingUnit, setFramingUnit] = useState<'%' | 'px'>('%')
  /**
   * Which sidebar groups are folded away, from the settings.
   *
   * A group is open unless it is named here, so a group added later arrives visible and nothing is
   * hidden from a reader who has never folded anything — except FRAMING, which starts folded because
   * it is the advanced one: it is per clip rather than per job, and a job with one clip rarely needs
   * it. Once the settings have been written the list is the list, that default included.
   */
  const collapsedSections = settings?.collapsedSections ?? ['framing']
  const toggleSection = (id: string) => {
    const next = collapsedSections.includes(id)
      ? collapsedSections.filter((name) => name !== id)
      : [...collapsedSections, id]
    // Written to the settings rather than kept in this window, so folding survives a re-launch the way
    // every other preference does. The window is a separate renderer, so the change is sent on and the
    // queue window — which owns the file — is told to write it.
    const nextSettings = { ...(settings ?? ({} as AppSettings)), collapsedSections: next }
    setSettings(nextSettings)
    void window.electronAPI?.saveSettings(nextSettings)
  }
  /**
   * The crop's own controls: which entry the shape list is showing, and the clear-crop question.
   *
   * The shape list's entry is a CHOICE rather than a reading of the region — FREEFORM says "no shape
   * is being held", and that is something the user says, not something the numbers can be interrogated
   * for, since a region that happens to keep 16:9 looks exactly like one that was shaped to 16:9. It is
   * held against the clip being edited, so it starts from that clip's own region.
   */
  const [cropShapeChoice, setCropShapeChoice] = useState<{ key: string; value: string } | null>(null)
  /** The clear-crop question, and whether the answer is "every clip". */
  /** The right-click menu, and where on screen it ended up once its own height was known. */
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuAt, setMenuAt] = useState({ x: 0, y: 0 })
  /**
   * How the monitor sizes the output frame and the picture.
   *
   * A viewer setting and nothing more: it is not the clip's own fit into the output, which is a
   * different control with a deliberately different name, and it never reaches the export.
   */
  const [previewZoom, setPreviewZoom] = useState<PreviewZoom>(DEFAULT_PREVIEW_ZOOM)
  /** Whether the zoom in force was asked for as CUSTOM, which keeps its own field open. */
  const [zoomCustom, setZoomCustom] = useState(false)
  const [zoomText, setZoomText] = useState('100')
  /** How far the drawing has been panned inside the monitor. View only, and clamped to its slack. */
  const [pan, setPan] = useState({ x: 0, y: 0 })
  /**
   * Whether the crop box is being dragged, moved or resized right now.
   *
   * The shade outside the crop is drawn as the black the export will letterbox with, and it lifts to
   * see-through for exactly as long as a gesture is choosing where the crop goes. It is a fact about
   * the POINTER rather than about the crop, so it lives here and not in the record.
   */
  const [cropDragging, setCropDragging] = useState(false)
  /** Read while dragging, so a crop can still be dragged while the picture is panned. */
  const panRef = useRef({ x: 0, y: 0 })
  /** When a pan last ended, so the click it ends with is not also read as a click on the media. */
  const pannedAtRef = useRef(0)
  /**
   * Undo and redo for the edits made in this window.
   *
   * A stack of whole drafts rather than of the changes: every control in here writes through
   * `updateDraft`, so a snapshot taken before each write IS the previous state, and stepping back is
   * a plain `setDraft`. Only the draft moves — never the baseline — so undoing back past the last
   * APPLY leaves the window unsaved again, which is exactly what it is.
   *
   * Held in a ref because the key handler is bound once, at the window, and cannot close over a
   * function that is rebuilt on every render.
   */
  const historyRef = useRef<DraftHistory<QueueTask>>(emptyHistory())
  /**
   * The drag in progress, as the draft was before it began, or nothing when no drag is running.
   *
   * A drag writes the draft on every pointer move, because that is what makes the picture follow the
   * pointer. Remembered one step per move, a single drag took dozens of presses to walk back — each of
   * them a twitch rather than the drag. While this is set the writes are made without being remembered,
   * and the one step the gesture earned is recorded when it ends. See `endGesture`.
   */
  const gestureRef = useRef<QueueTask | null>(null)
  const undoRedoRef = useRef<{ undo: () => void; redo: () => void }>({ undo: () => undefined, redo: () => undefined })
  /** Boundary whose transition editor is open: the LANE it sits on and the clip it follows, or a lane edge. */
  const [openBoundary, setOpenBoundary] = useState<{ laneId: string; at: number | 'head' | 'tail' } | null>(null)
  /** The clip whose edge is being dragged on the timeline, and the window that drag is proposing. */
  const [trimDragKey, setTrimDragKey] = useState<string | null>(null)
  /**
   * The neighbour shown beside the clip being trimmed, and the edge of it the cut meets.
   *
   * While a handle is down the monitor becomes a SPLIT view: the clip being trimmed keeps the main pane
   * (its landing frame, moved by the drag itself) and this is the clip it is being cut against — the
   * PREVIOUS clip's LAST frame for an IN handle, the NEXT clip's FIRST for an OUT — drawn in a second
   * pane on the side the handle is on. Only the `at` second of that neighbour changes with the drag; the
   * neighbour does not.
   */
  const [trimNeighbour, setTrimNeighbour] = useState<{ side: 'left' | 'right'; segment: TimelineSegment; at: number } | null>(null)
  const [trimPreview, setTrimPreview] = useState<TrimWindow | null>(null)
  const trimPreviewRef = useRef<TrimWindow | null>(null)
  /** The OTHER clips a grouped trim is moving, keyed like the primary, so each shows its own drawer. */
  const [trimGroup, setTrimGroup] = useState<Record<string, TrimWindow>>({})
  const trimGroupRef = useRef<Record<string, TrimWindow>>({})
  /** The main-lane clip being dragged to another place, so a drop can name where it came from. */
  const [draggingClipIndex, setDraggingClipIndex] = useState<number | null>(null)
  /**
   * Which lanes are muted, by lane id. It belongs to the task rather than to this window: a muted
   * lane is one the export does not carry, so it is written into the draft with the rest of the
   * settings and sent on APPLY. It also silences the monitor, which is what makes a mute something
   * you can check by ear before you commit it.
   */
  const muted = useMemo(() => draft?.mutedLanes ?? {}, [draft?.mutedLanes])
  /** Whether each source carries an audio stream, which is what a clip's own hairline reports. */
  const [sourceAudio, setSourceAudio] = useState<Record<string, boolean>>({})
  /**
   * Whether each source has a picture at all, probed with the same call that reads its audio.
   *
   * A path is not a picture. An audio track has no frame to show, no frame to extract and no
   * waveform-shaped tile, and everything that assumes otherwise — asking ffmpeg for a frame, pointing
   * a <video> at it — fails in ways that read as a broken file rather than as a wrong question.
   * `undefined` means not known yet, which is treated as "assume a picture" so nothing flashes.
   */
  const [sourceVideo, setSourceVideo] = useState<Record<string, boolean>>({})
  /**
   * The size of the FIRST picture in the job, which is the one MATCH SOURCE follows.
   *
   * The output frame's own shape comes from this while that setting is on, and from the clip under the
   * playhead while it is off. Which is to say: with it on the frame is a fact about the JOB, and with
   * it off it is a fact about the clip — see where the frame is worked out.
   */
  const [firstSourceSize, setFirstSourceSize] = useState<{ width: number; height: number } | undefined>(undefined)
  /**
   * The pixel size of the picture MATCH SOURCE would take the frame from: the clip in hand, or the
   * job's first with none in hand.
   *
   * It is a fact about a file, so it is read once per file and held, rather than asked for at the
   * moment the button is pressed: a button that had to wait for an ffprobe before it could fill a
   * field would fill it a moment after the click, which reads as the click having missed.
   */
  const [matchSourceSize, setMatchSourceSize] = useState<{ width: number; height: number } | undefined>(undefined)
  /** The source the monitor is showing, so its audio can be drawn as a waveform when it has no picture. */
  const [monitorSource, setMonitorSource] = useState<string | null>(null)
  /** Each source's audio as peaks, read once per file, for a lane drawn as a waveform. */
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({})
  const waveformsAskedRef = useRef<Set<string>>(new Set())
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const timelineInnerRef = useRef<HTMLDivElement>(null)

  /**
   * Places the menu once it has been drawn, because its own height is what decides whether it fits.
   *
   * Above the early return with the state it reads, and that is not a nicety: a hook called after a
   * return that some renders take and others do not is a hook called a different number of times on
   * different renders, which React throws on and the window comes up blank.
   */
  useLayoutEffect(() => {
    const element = menuRef.current
    if (!timelineMenu || !element) return
    const rect = element.getBoundingClientRect()
    setMenuAt(placeMenu({
      point: { x: timelineMenu.x, y: timelineMenu.y },
      size: { width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }))
  }, [timelineMenu])

  const commit = (nextBaseline: QueueTask | null, nextDraft: QueueTask | null) => {
    baselineRef.current = nextBaseline
    draftRef.current = nextDraft
    setBaseline(nextBaseline)
    setDraft(nextDraft)
  }

  useEffect(() => {
    void window.electronAPI?.getSettings().then((loaded) => { if (loaded) setSettings(loaded) })
  }, [])

  /**
   * The unit the whole window shows lengths in, from the TIMELINE kicker's own menu.
   *
   * A setting of the APP rather than of this job — the queue's own Quick Look reads the same figure — so it
   * is written back through `saveSettings` as well as held here, and every surface that stamps a time (this
   * window's ruler, its clips, its monitor and its transport) follows at once because they all read it.
   */
  const setTimestampMode = (mode: 'timestamp' | 'framestamp') => {
    if (!settings) return
    const next = { ...settings, timestampDisplayMode: mode }
    setSettings(next)
    void window.electronAPI?.saveSettings(next)
  }

  /**
   * Adopts a job into the window.
   *
   * The baseline becomes the queue's own copy and the draft is that copy with whichever edits this window owns
   * kept on top, so a job arriving twice — once pushed and once pulled — is adopted the same way twice.
   */
  const adoptTask = useCallback((incoming: QueueTask) => {
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
    const userDirty = windowDirty(currentDraft, currentBaseline)
    // Only the fields this window owns can conflict; probe results and source order arrive from the
    // queue and should just be adopted.
    if (userDirty && JSON.stringify(editableSlice(incoming)) !== JSON.stringify(editableSlice(currentBaseline))) {
      setIncomingConflict(incoming)
    }
    // A change to the SOURCE LIST moves every clip's place in the job, and a transition, a fit and
    // a crop are all keyed by that place. The queue re-keys them as it takes a source out, and the
    // queue's version is the right one: the window's copy was filed against the places the clips
    // had a moment ago, so keeping it would leave a record sitting on whatever moved into an index
    // and would leave the removed clip's record behind with nothing to be about.
    const clipsMoved = JSON.stringify(incoming.sourcePaths) !== JSON.stringify(currentBaseline.sourcePaths)
      || JSON.stringify(incoming.additionalAudioTracks ?? []) !== JSON.stringify(currentBaseline.additionalAudioTracks ?? [])
    // ...unless the move is the WINDOW's own. A list this window edited is kept with the records it
    // re-keyed to match, so the queue confirming the list the window started from cannot put the
    // sources back. The queue's list is still the one everything else is taken from.
    const mine = sourceListMoved(currentDraft, currentBaseline)
    const kept = editableSlice(currentDraft)
    const merged = !userDirty
      ? incoming
      : {
          ...incoming,
          ...(clipsMoved && !mine
            ? { ...kept, transitions: incoming.transitions, sourceFit: incoming.sourceFit, sourceCrop: incoming.sourceCrop, sourceSpeed: incoming.sourceSpeed, sourceFps: incoming.sourceFps, trimPoints: incoming.trimPoints, clipIds: incoming.clipIds, clipNumbers: incoming.clipNumbers, embeddedAudio: incoming.embeddedAudio }
            // The window keeps its own edits, but the TRIMS are merged rather than taken whole: a QUICK LOOK
            // edit made in this window comes back from the queue and has to land on the clip even though
            // the window is dirty — see `mergeTrims`.
            : { ...kept, trimPoints: mergeTrims(currentBaseline.trimPoints, currentDraft.trimPoints, incoming.trimPoints) }),
          ...(mine
            ? { sourcePaths: currentDraft.sourcePaths, additionalAudioTracks: currentDraft.additionalAudioTracks, trimPoints: currentDraft.trimPoints, clipIds: currentDraft.clipIds, clipNumbers: currentDraft.clipNumbers, type: currentDraft.type }
            : {}),
        }
    baselineRef.current = incoming
    draftRef.current = merged
    setBaseline(incoming)
    setDraft(merged)
  }, [])

  /**
   * The handshake, from the window's side. The job arrives by PUSH and by PULL, and either alone is enough.
   *
   * The push alone is a race: the main process sends the job once, on `did-finish-load`, and that event fires
   * before React has mounted and subscribed — so on a FRESH window the send lands on nobody and the editor sits
   * on its WAITING line for good. It is intermittent and it lands on re-entry because re-entering an OPEN
   * window re-sends to a live listener, while re-entering a CLOSED one builds a new window and races afresh.
   *
   * So the window PULLS too: on mount, and again whenever it is focused. The main process still holds the job
   * it last opened or synced, so the pull is authoritative and a push and a pull of the same job are the same
   * adoption. Both halves are logged, so the handshake can be read at runtime rather than inferred from timing.
   */
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onEditJobTask((incoming) => {
      void window.electronAPI?.diagnosticLog('[edit-job] job pushed', { id: incoming?.id })
      adoptTask(incoming)
    })
    const pull = () => {
      void window.electronAPI?.getEditJobTask().then((task) => {
        void window.electronAPI?.diagnosticLog('[edit-job] job pulled', { hasTask: Boolean(task), id: task?.id })
        if (task) adoptTask(task)
      }).catch((error: unknown) => {
        void window.electronAPI?.diagnosticLog('[edit-job] pull failed', { error: String(error) })
      })
    }
    pull()
    window.addEventListener('focus', pull)
    return () => {
      unsubscribe?.()
      window.removeEventListener('focus', pull)
    }
  }, [adoptTask])

  // Rebuilding is cheap but churns identities, so it is keyed to the inputs that
  // actually change the timeline.
  const timelineSignature = draft ? JSON.stringify([
    draft.type, draft.comboMode, draft.sourcePaths, draft.additionalAudioTracks, draft.trimPoints,
    draft.sourceMetadata, draft.sequenceInput, draft.sequenceInputs, draft.sourceInfo,
    draft.preset.fps, draft.preset.fpsRate, draft.stillImageDuration, draft.transitions, draft.sourceSpeed, draft.sourceFps, draft.clipIds, draft.clipNumbers, draft.mutedLanes, draft.embeddedAudio,
  ]) : ''

  // Nothing in the app ever populates `sourceInfo` or `sourceMetadata`, so a source without intrinsic
  // timing — an audio track especially — has to be probed before it can be drawn or played at its real
  // length. This is the list that gets probed and no more: a multi-track job maps one video stream, so
  // only the first source is a candidate for it, and every added track is one.
  const candidateSources = draft ? Array.from(new Set([
    ...(draft.type === 'stitch' ? draft.sourcePaths : draft.sourcePaths.slice(0, 1)),
    ...(draft.additionalAudioTracks || []).map((track) => track.path),
  ])) : []
  const probeSignature = candidateSources.join('\u0000')

  /**
   * One probe per source per window, however many things ask for it.
   *
   * The window wants several facts about the same file — what it is made of, how long it is, and the
   * shape a strip is laid out from — and each of those used to ask separately, so a still in a lane
   * drawn as a filmstrip was read three times on the way in. The answers are facts about a file that
   * does not change while a window is open, so a second ask waits on the first and shares its answer.
   * What is still decided per asker is WHETHER to ask at all, which is where the cost of a probe is
   * actually spent: the strips only want a shape for a lane showing one.
   */
  const probeCacheRef = useRef(new Map<string, Promise<MediaProbeInfo | undefined>>())
  const probeSource = useCallback((sourcePath: string) => {
    const cache = probeCacheRef.current
    const existing = cache.get(sourcePath)
    if (existing) return existing
    const request = Promise.resolve(window.electronAPI?.probeMedia(sourcePath)).catch(() => undefined)
    cache.set(sourcePath, request)
    return request
  }, [])

  // What each source is: how long it is, what rate it carries, and whether it has audio or a picture.
  //
  // ONE probe per source. The questions used to be asked by two effects — a length for a source without
  // intrinsic timing, then the streams for every source — so a track with neither recorded was read
  // twice on the way into a window, and a probe is an ffprobe. One call answers all of it, which is why
  // there is now one effect: the answers arrive together or not at all.
  //
  // Each half is still asked for on its own terms, though, and marked on its own terms: a source whose
  // length is not known must not be left unprobed because its streams were, and one whose streams are
  // known must not be re-read for a length somebody else already settled.
  useEffect(() => {
    const task = draftRef.current
    if (!task) return
    const marked = probedPathsRef.current
    const wantedTiming = candidateSources.filter((sourcePath) => !marked.has(`timing:${sourcePath}`) && sourceDuration(task, sourcePath) <= 0)
    const wantedStreams = candidateSources.filter((sourcePath) => sourceAudio[sourcePath] === undefined && !marked.has(`streams:${sourcePath}`))
    const wanted = [...new Set([...wantedTiming, ...wantedStreams])]
    if (!wanted.length) return
    wantedTiming.forEach((sourcePath) => marked.add(`timing:${sourcePath}`))
    wantedStreams.forEach((sourcePath) => marked.add(`streams:${sourcePath}`))
    const timing = new Set(wantedTiming)
    let cancelled = false
    void Promise.all(wanted.map(async (sourcePath) => {
      try {
        return [sourcePath, await probeSource(sourcePath)] as const
      } catch {
        return [sourcePath, undefined] as const
      }
    })).then((entries) => {
      if (cancelled) return
      setProbedTiming((current) => ({
        ...current,
        // Only the sources that were being read FOR their length, so a probe made for something else
        // does not become the timing of a source that already had one.
        ...Object.fromEntries(entries.filter(([sourcePath]) => timing.has(sourcePath)).map(([sourcePath, info]) => [sourcePath, { duration: info?.duration ?? 0, fps: info?.videoStreams?.[0]?.fps }])),
      }))
      setSourceAudio((current) => ({ ...current, ...Object.fromEntries(entries.map(([sourcePath, info]) => [sourcePath, Boolean(info?.audioStreams?.length)])) }))
      setSourceVideo((current) => ({ ...current, ...Object.fromEntries(entries.map(([sourcePath, info]) => [sourcePath, Boolean(info?.videoStreams?.length)])) }))
      // The whole answer, kept for the lines that describe a file rather than time it — see `sourceProbes`.
      setSourceProbes((current) => ({
        ...current,
        ...Object.fromEntries(entries.filter(([, info]) => Boolean(info)).map(([sourcePath, info]) => [sourcePath, info as MediaProbeInfo])),
      }))
    })
    return () => { cancelled = true }
  }, [probeSignature])

  const resolveTiming = (sourcePath: string): SourceTiming | undefined => probedTiming[sourcePath]
  const model: TimelineModel | null = useMemo(
    () => (draft ? buildTimeline(draft, { resolveTiming }) : null),
    [timelineSignature, probedTiming],
  )
  // The audio every lane the timeline or the monitor is drawing as a waveform, read once per file. It
  // is the file's audio rather than the clip's, so a trim or a zoom needs no new reading: what is drawn
  // of it changes, what it is does not. It waits until something is actually drawing one — a file that
  // is only ever drawn as a clip of frames never needs decoding for its peaks.
  useEffect(() => {
    const bridge = window.electronAPI
    if (!bridge?.waveformFor || !model) return
    const wanted = new Set<string>()
    model.lanes.forEach((lane) => {
      if (lane.kind !== 'audio') return
      // The lane drawn as a waveform needs its peaks. So does the lane the MONITOR is showing, because
      // a clip with no picture has a waveform instead of a frame — and that is the monitor's own
      // playhead rather than any tile, so it is asked for by source.
      const shown = monitorSource != null && lane.segments.some((segment) => segment.sourcePath === monitorSource)
      if (!filmstripLanes[lane.id] && !shown) return
      lane.segments.forEach((segment) => { wanted.add(segment.sourcePath) })
    })
    const missing = [...wanted].filter((sourcePath) => !waveformsAskedRef.current.has(sourcePath))
    if (!missing.length) return
    missing.forEach((sourcePath) => waveformsAskedRef.current.add(sourcePath))
    let cancelled = false
    void Promise.all(missing.map(async (sourcePath) => [sourcePath, (await bridge.waveformFor(sourcePath)) ?? []] as const)).then((entries) => {
      if (!cancelled) setWaveforms((current) => ({ ...current, ...Object.fromEntries(entries) }))
    })
    return () => { cancelled = true }
  }, [filmstripLanes, timelineSignature, model, monitorSource])
  // Frame rate of the primary source, for stepping and reverse. Kept separate from
  // the displayed rate because the hook is created before a segment is known.
  const primaryFps = draft ? sourceFps(draft, draft.sourcePaths[0], undefined, resolveTiming) : 25

  /**
   * The level the monitor's element plays a clip's embedded sound at, by the same rules the export writes.
   *
   * A preview cannot demux one stream of a multi-stream file — Chromium exposes no `audioTracks` — so the
   * element plays the file's DEFAULT stream and no other. This answers for that one, which is also the one
   * a reader hears: it is muted when the lane is muted or that default stream has been dropped (by a mute
   * or by being EXTRACTED to a track), and levelled by that stream's own gain. A segment that is a track's
   * own clip is not answered for here: its file plays through that lane's own element, not this one.
   */
  const monitorLevelFor = (segment: TimelineSegment): { gain: number; muted: boolean } => {
    const task = draftRef.current
    if (!task || !embeddedAudioEditable(task)) return { gain: 1, muted: false }
    const at = materializeClipIds(task).indexOf(segment.key)
    if (at < 0) return { gain: 1, muted: false }
    const path = segment.sourcePath
    const count = sourceProbes[path]?.audioStreams?.length ?? 0
    if (count === 0) return { gain: 1, muted: false }
    const clipId = materializeClipIds(task)[at]
    const laneMuted = Boolean(task.mutedLanes?.[MAIN_LANE_ID])
    const defaultEnabled = embeddedStreamEnabled(task, clipId, path, 0)
    return { gain: defaultEnabled ? gainForDb(embeddedGainDb(task, clipId, 0)) : 1, muted: laneMuted || !defaultEnabled }
  }

  /**
   * The level and mute of a lane's OWN element — an added track, or a sound-only main lane.
   *
   * A track's level is the track's (`gainDb`, keyed by its stable id and written per stream by the export);
   * a sound-only main lane's is its clip's own embedded level. Either way the monitor is applying the very
   * figure the encoder writes for that stream, so a track sounds in the preview as it will in the file.
   */
  const laneLevelFor = (laneId: string): { gain: number; muted: boolean } => {
    const task = draftRef.current
    if (!task) return { gain: 1, muted: false }
    const track = (task.additionalAudioTracks || []).find((candidate) => candidate.id === laneId)
    if (track) return { gain: gainForDb(track.gainDb ?? 0), muted: Boolean(task.mutedLanes?.[track.id]) }
    if (laneId === MAIN_LANE_ID) {
      const path = task.sourcePaths[0]
      const laneMuted = Boolean(task.mutedLanes?.[MAIN_LANE_ID])
      if (!path || mediaKind(path) !== 'audio') return { gain: 1, muted: laneMuted }
      const clipId = clipKey(task, path, 0)
      return {
        gain: gainForDb(embeddedGainDb(task, clipId, 0)),
        muted: laneMuted || clipAudioDropped(task, clipId, path, sourceProbes[path]?.audioStreams?.length ?? 0),
      }
    }
    return { gain: 1, muted: Boolean(task.mutedLanes?.[laneId]) }
  }

  const playback = useConsolidatedPlayback(
    model ?? { lanes: [], duration: 0, unusedVideoSources: [] },
    audioElementsRef,
    { playable: Boolean(model && model.duration > 0), fps: primaryFps, levelFor: monitorLevelFor, laneLevelFor },
  )

  const focusedSourceIndex = playback.segmentIndex
  // The source the monitor is showing, so the waveform fetch above knows to read its audio: a clip
  // with no picture is drawn from decoded peaks, and the one the monitor is on changes with the
  // playhead while the lanes are drawn all at once.
  const playingSource = playback.segment?.sourcePath ?? null
  useEffect(() => { setMonitorSource(playingSource) }, [playingSource])
  // The frame the encoder will produce, worked out before the strip's own layout and fetching
  // rather than beside the monitor, because a tile is the shape of the frame: a frame the strips
  // saw late would be a strip laid out for a shape that is no longer the output's. It needs nothing
  // but the task and the media's own size, and both are known by this point in the render.
  const playingNatural = naturalSize && naturalSize.key === playback.segment?.sourcePath ? naturalSize : undefined
  /**
   * Whether the output frame follows the source, which is what MATCH SOURCE means.
   *
   * Read here rather than beside the buttons that set it, because the frame itself is worked out here:
   * a frame that lagged the control which chose it would show the shape the user had just replaced.
   */
  const matchSource = Boolean(draft && !draft.preset.width && !draft.preset.height && draft.preset.resolution === 'source')
  const matchSourceClip = draft ? firstVisualSource(draft) : undefined
  // The first picture's own size, read once while the frame is following the source. It is a fact about
  // the file, so it is asked for once rather than at every change of clip.
  useEffect(() => {
    if (!matchSource || !matchSourceClip) { setFirstSourceSize(undefined); return }
    let cancelled = false
    void (async () => {
      try {
        const info = await window.electronAPI?.probeMedia(matchSourceClip)
        const resolution = info?.videoStreams?.[0]?.resolution?.split('x').map(Number)
        if (!cancelled && resolution && resolution[0] > 0 && resolution[1] > 0) setFirstSourceSize({ width: resolution[0], height: resolution[1] })
      } catch {
        // The playing clip's own size stands in, which is what the frame used before this.
      }
    })()
    return () => { cancelled = true }
  }, [matchSource, matchSourceClip])
  /**
   * The picture MATCH SOURCE would follow right now, which is the clip in hand rather than the job's
   * first — see the helper, where that rule is stated.
   */
  const matchSourceTarget = draft ? matchSourceSource(draft, playback.segment?.sourcePath) : undefined
  // Its own size, read once per source. This is what fills EXACT SIZE and what the button reports
  // itself against, so it is held rather than asked for at the press.
  useEffect(() => {
    if (!matchSourceTarget) { setMatchSourceSize(undefined); return }
    let cancelled = false
    void probeSource(matchSourceTarget).then((info) => {
      if (cancelled) return
      const resolution = info?.videoStreams?.[0]?.resolution?.split('x').map(Number)
      setMatchSourceSize(resolution && resolution[0] > 0 && resolution[1] > 0 ? { width: resolution[0], height: resolution[1] } : undefined)
    })
    return () => { cancelled = true }
  }, [matchSourceTarget, probeSource])
  const outputFrame = draft ? outputFrameSize({
    // MATCH SOURCE follows the FIRST picture in the job, not the clip under the playhead. Following the
    // playhead made the output's shape a question of where the playhead was: crossing a cut re-shaped
    // the frame, re-laid every strip out and moved the monitor's outline. Until the first clip's size
    // has been read the playing one stands in, so the frame is drawn rather than absent.
    natural: matchSource ? firstSourceSize ?? playingNatural : playingNatural,
    exact: draft.preset.width && draft.preset.height ? { width: draft.preset.width, height: draft.preset.height } : undefined,
    box: resolutionBox(draft.preset.resolution),
  }) : undefined
  /** The shape a thumbnail is drawn in, which is the output frame's rather than the clip's. */
  const frameAspect = outputFrame ? outputFrame.width / outputFrame.height : 16 / 9
  const focusedSource = draft ? (draft.sourcePaths[focusedSourceIndex] || draft.sourcePaths[0]) : undefined
  /**
   * The source the window is DESCRIBING: the clip the PROPERTIES inspector is on where it is open, and the one
   * under the playhead otherwise.
   *
   * Derived here, above the early return, because the probe that fills `sourceProbes` is an effect and no hook
   * can live past that return — which is the shape of the fault that once made this window come up blank with
   * nothing on it but its traffic lights. The inspector's own source is the same answer worked out again below,
   * from the same two things.
   */
  const describedSource = (() => {
    const lane = inspectorOpen && selected ? model?.lanes.find((candidate) => candidate.id === selected.laneId) : undefined
    return lane?.segments.find((segment) => segment.key === selected?.clipKey)?.sourcePath ?? focusedSource ?? null
  })()
  /**
   * The facts about that source, which is not always a source a lane was built from: in a stitch or a combo the
   * inspector can be opened on any clip, and the one under the playhead moves with playback. A probe is shared
   * and remembered, so where the effect above has already asked this costs no second ffprobe.
   */
  const describedProbesRef = useRef(new Set<string>())
  useEffect(() => {
    if (!describedSource || describedProbesRef.current.has(describedSource)) return
    describedProbesRef.current.add(describedSource)
    let cancelled = false
    void probeSource(describedSource).then((info) => {
      if (!cancelled && info) setSourceProbes((current) => (current[describedSource] ? current : { ...current, [describedSource]: info }))
    })
    return () => { cancelled = true }
  }, [describedSource])
  // A sequence is named after its whole range rather than the one frame that stands in
  // for it, the same way the queue's cards name it.
  const focusedSequence = draft && focusedSource ? sequenceFor(draft, focusedSource) : undefined
  const focusedLabel = focusedSequence ? sequenceLabel(focusedSequence) : sourceName(focusedSource)
  // What the monitor's own line calls the clip it is showing: `COPY n` when the file appears more than once,
  // so the monitor names the same clip the timeline and the inspector do.
  const focusedCopyLabel = draft ? copyLabelFor(draft, focusedSourceIndex) : undefined

  // An image sequence's generated clip is resolved here, once per rate, in the background. Nothing on
  // the playback path waits for it: the window draws the clip the queue remembers for it, and only
  // falls back to an unresolved state while a clip is being built for the first time.
  //
  // Only sequences are asked about. Every other source's target is the file itself — there is nothing
  // to build and nothing to resolve — so asking was a round trip per source, and a source whose rate
  // arrives with its probe was asked about twice, once at the default rate and once at its own.
  useEffect(() => {
    const task = draftRef.current
    if (!task) { setMediaTargets({}); return }
    const wanted = new Map<string, string>()
    Array.from(new Set([...task.sourcePaths, ...(task.additionalAudioTracks || []).map((track) => track.path)])).forEach((sourcePath) => {
      const sequence = sequenceFor(task, sourcePath)
      if (sequence) {
        const rate = sourceFps(task, sourcePath, sequence, resolveTiming)
        wanted.set(`${sourcePath}\u0000${rate}`, sourcePath)
        return
      }
      // A source the webview cannot decode needs a PROXY resolved before the monitor can draw it. Nothing is
      // resolved for one it CAN decode: its own file is the target and there is nothing to build.
      if (needsProxyFor(sourcePath)) wanted.set(`${sourcePath}\u0000proxy`, sourcePath)
    })
    if (!wanted.size) return
    const missing = [...wanted.keys()].filter((key) => resolvedTargetsRef.current[key] === undefined)
    if (!missing.length) return
    let cancelled = false
    void Promise.all(missing.map(async (key) => {
      const sourcePath = wanted.get(key) as string
      const request = await resolveQuickLookRequest(task, window.electronAPI, { sourceIndex: Math.max(0, task.sourcePaths.indexOf(sourcePath)), needsPreviewProxy: needsProxyFor(sourcePath) })
      return [key, sourcePath, request] as const
    })).then((entries) => {
      if (cancelled) return
      const resolved: Record<string, { path: string; previewUnavailable?: boolean }> = {}
      entries.forEach(([key, sourcePath, request]) => {
        if (!request) return
        // A clip this call had to build is reported back like the helper's own, so a rebuild forced by
        // a clip that had genuinely gone missing is paid once rather than again on every open — and so
        // the next open finds it without asking, which is the whole point of remembering it at all.
        if (request.regeneratedPreview) {
          const { sourceTarget, path: previewPath } = request.regeneratedPreview
          void window.electronAPI?.rememberPreview(task.id, sourceTarget, previewPath)
        }
        // Only a success is remembered, so a target that could not be built is tried
        // again the next time the task changes rather than being given up on.
        resolvedTargetsRef.current[key] = true
        resolved[sourcePath] = { path: request.target, previewUnavailable: request.previewUnavailable }
      })
      setMediaTargets((current) => ({ ...current, ...resolved }))
    })
    return () => { cancelled = true }
  }, [timelineSignature, probedTiming, sourceProbes])

  // The lane area's width, watched rather than assumed. A ResizeObserver rather than a window
  // resize listener, because the lane also changes when the window is merely re-laid out.
  /**
   * Binds the lane-width observer when the timeline mounts, and measures it.
   *
   * A callback ref rather than an effect, because the timeline does not exist until a queue item
   * A callback ref rather than an effect, because the timeline does not exist until a queue item
   * has arrived: an effect with no dependencies ran while the window was still saying WAITING FOR
   * QUEUE ITEM, found no element, and never ran again.
   *
   * Nothing is measured here, and that is the point of the timeline's geometry: a lane's width is
   * the zoom's business, not the window's. The element is kept so that FIT can ask how much lane is
   * visible when it is pressed, and so the skimmer can be followed — both of which read the box at
   * the moment they need it rather than being told about every change to it.
   */
  const attachLanes = useCallback((element: HTMLDivElement | null) => {
    timelineScrollRef.current = element
  }, [])

  // Each strip source's own shape and rate, once. These are facts about the file, so they are
  // fetched once rather than per layout, and they are what the tile geometry comes from.
  const shapeSignature = Object.keys(filmstripLanes).filter((id) => filmstripLanes[id]).length
  useEffect(() => {
    if (!shapeSignature) return
    const sources = new Set<string>()
    model?.lanes.forEach((lane) => {
      if (!filmstripLanes[lane.id]) return
      lane.segments.forEach((segment) => { sources.add(segment.sourcePath) })
    })
    const missing = [...sources].filter((sourcePath) => sourceShape[sourcePath] === undefined && !probedPathsRef.current.has(`shape:${sourcePath}`))
    if (!missing.length) return
    missing.forEach((sourcePath) => probedPathsRef.current.add(`shape:${sourcePath}`))
    let cancelled = false
    void Promise.all(missing.map(async (sourcePath) => {
      const info = await probeSource(sourcePath)
      const resolution = info?.videoStreams?.[0]?.resolution?.split('x').map(Number)
      // A source with no video stream has no shape to record. That is what stops a strip being laid
      // out for it at all — and with it, every frame being asked of a file that has none.
      if (!resolution || !(resolution[0] > 0) || !(resolution[1] > 0)) return [sourcePath, undefined] as const
      return [sourcePath, {
        width: resolution[0],
        height: resolution[1],
        fps: info?.videoStreams?.[0]?.fps && info.videoStreams[0].fps > 0 ? info.videoStreams[0].fps : 30,
      }] as const
    })).then((entries) => {
      if (cancelled || !entries.length) return
      const shapes = entries.filter((entry): entry is readonly [string, { width: number; height: number; fps: number }] => entry[1] !== undefined)
      if (!shapes.length) return
      setSourceShape((current) => ({ ...current, ...Object.fromEntries(shapes) }))
    })
    return () => { cancelled = true }
  }, [filmstripLanes, timelineSignature, shapeSignature])

  /**
   * The strip's layout for a clip, from the lane as it is right now.
   *
   * A tile is the shape of the OUTPUT frame, so every strip in a job has the same tile shape
   * whatever its clips are: the frames line up across clips, and a clip that will be letterboxed
   * shows the letterbox it will get. Everything comes from the CURRENT lane width, so a zoom or a
   * resize re-lays the strip out rather than serving one laid out for a width that no longer
   * exists.
   */
  /**
   * The rate a clip's strip counts its frames at.
   *
   * For an image sequence that is the rate the timeline is WORKING IN, not the rate probing its first
   * frame invents. An image has no rate of its own and ffprobe names one anyway — 25, usually — which
   * disagreed with the 24 the sequence is played at, so the strip counted ten seconds as 250 frames
   * instead of 240 and its last tiles sampled frames the sequence does not have. Everything that
   * counts frames has to count them the same way, which is what `sourceFps` is for.
   */
  const stripFpsFor = (segment: TimelineSegment): number => {
    const sequence = draft ? sequenceFor(draft, segment.sourcePath) : undefined
    if (draft && sequence) return sourceFps(draft, segment.sourcePath, sequence, resolveTiming)
    return sourceShape[segment.sourcePath]?.fps ?? 30
  }
  const planFor = (segment: TimelineSegment) => {
    const shape = sourceShape[segment.sourcePath]
    if (!shape || segment.duration <= 0) return undefined
    // The lane's width is the clip's TIMELINE length at the timeline's rate, which is a function of
    // the zoom alone: nothing here is read from the window, so a resize cannot re-lay a strip out.
    // The SAMPLES are the source run the clip uses, so a sped clip's tiles show the frames its export
    // will: the strip packs the same frames into a shorter lane rather than sampling a shorter run.
    return computeFilmstrip({
      laneWidth: laneWidthFor(segment.duration, zoom),
      thumbHeight: FILMSTRIP_CLIP_HEIGHT,
      outAspect: frameAspect,
      fps: stripFpsFor(segment),
      inSec: segment.sourceIn,
      outSec: segment.sourceIn + segment.sourceUsedSeconds,
    })
  }
  /**
   * The key a thumbnail is held under: the source frame, and everything that decides its picture.
   *
   * Built from the same names the main process builds it from, so a picture asked for under one
   * placement is never served for another — which is what toggling a fit or dragging the offset
   * would otherwise do, leaving a clip's tiles showing a frame that its export no longer matches.
   */
  const signatureFor = (segment: TimelineSegment) => {
    const shape = sourceShape[segment.sourcePath]
    return thumbnailSignature({
      source: { width: shape?.width ?? 16, height: shape?.height ?? 9 },
      frame: outputFrame ?? { width: 1920, height: 1080 },
      fit: draft ? sourceFitFor(draft, segment.sourcePath, clipIndexOf(segment)) : undefined,
      // The crop of THAT clip, not the job's: the signature has to change when the clip's own crop
      // does, which is what regenerates its strip and nothing else's.
      crop: draft ? effectiveCropFor(draft, segment.sourcePath, clipIndexOf(segment)) : undefined,
    })
  }
  const keyFor = (segment: TimelineSegment, frame: number) => frameKey(frame, signatureFor(segment))
  /**
   * Where a still's one picture sits inside a tile.
   *
   * A still has no frames to extract — seeking into a single-frame file yields nothing — so its
   * strip is drawn from the file itself. The tile is the shape of the output frame, so the picture
   * is placed in it by the same fit arithmetic as everything else and clipped by the tile, which
   * is what makes a still's tiles agree with the still's own export.
   */
  const stillTileStyle = (segment: TimelineSegment, plan: { thumbWidth: number; thumbHeight?: number }) => {
    const shape = sourceShape[segment.sourcePath]
    if (!shape || !outputFrame) return undefined
    // The still goes through the same two stages as any other clip — the clip's own crop, then its
    // fit — so its tiles show what the export will show rather than the whole file as it happens to
    // be shaped. Drawn from the whole picture's box, so the crop box over it still means something.
    const placed = placedSource({
      source: { width: shape.width, height: shape.height },
      frame: outputFrame,
      crop: draft ? effectiveCropFor(draft, segment.sourcePath, clipIndexOf(segment)) : undefined,
      fit: draft ? sourceFitFor(draft, segment.sourcePath, clipIndexOf(segment)) : undefined,
    })
    if (!placed) return undefined
    const scale = plan.thumbWidth / outputFrame.width
    return {
      position: 'absolute' as const,
      left: placed.source.x * scale,
      top: placed.source.y * scale,
      width: placed.source.width * scale,
      height: placed.source.height * scale,
      maxWidth: 'none' as const,
      maxHeight: 'none' as const,
    }
  }
  /**
   * The file a segment's picture is read from: a generated clip for an image sequence, the source
   * itself for everything else.
   *
   * Read off the task rather than waited for. A sequence needs a clip built and the queue remembers
   * where it is, so a clip that exists can be drawn straight away — asking over IPC whether it still
   * exists first is a round trip whose only visible effect is the monitor saying PREPARING on every
   * open, for a clip that is not being prepared at all. Everything that is not a sequence needs no
   * resolution whatsoever: its own file IS the target.
   *
   * The remembered clip's key carries the rate and frame count it was built at, so a clip built at
   * another rate is not this source's clip and is not drawn as one; it would play the sequence at the
   * wrong speed until the right one was resolved, which is worse than a moment of PREPARING.
   */
  const pictureSourceFor = (segment: TimelineSegment | undefined): string | null => {
    if (!segment) return null
    const resolved = mediaTargets[segment.sourcePath]
    if (resolved) return resolved.path
    if (!draft) return segment.sourcePath
    const sequence = sequenceFor(draft, segment.sourcePath)
    if (!sequence) {
      // A source a `<video>` cannot decode — a DXV, a Hap, a ProRes — plays through a PROXY, and until one is
      // resolved the monitor must say PREPARING rather than hand the element a file it will refuse to open.
      if (needsProxyFor(segment.sourcePath)) return rememberedProxyFor(draft, segment.sourcePath) ?? null
      return segment.sourcePath
    }
    const rate = sourceFps(draft, segment.sourcePath, sequence, resolveTiming)
    return rememberedPreviewFor(draft, segment.sourcePath, rate) ?? null
  }
  /**
   * Whether a source has to be played through a proxy because the app's own webview cannot decode it.
   *
   * Read off the probe the window already has rather than asked of main, which would be a round trip per
   * source for a fact in hand. Answered `false` for a source not yet probed: its own file is the target until
   * the probe says otherwise, and guessing would only cost the moment the probe takes to arrive.
   */
  const needsProxyFor = (sourcePath: string): boolean => {
    const probe = sourceProbes[sourcePath]
    if (!probe) return false
    const container = sourcePath.split('.').pop() || ''
    return !webviewPlaysVideo({ container, videoCodecs: (probe.videoStreams || []).map((stream) => stream.codec) })
  }
  /**
   * A frame already fetched.
   *
   * Held against the SOURCE rather than against the file it was read from. For a sequence those are
   * two different things — the file is a generated clip, and a clip gets rebuilt under a new name —
   * and keying on the name means the pictures taken for the old one are invisible to the new, for a
   * picture that has not changed. The source is what the frame index means, so the source is what it
   * is filed under.
   */
  const frameImageFor = (segment: TimelineSegment, frame: number) =>
    frameImages[segment.sourcePath]?.[keyFor(segment, frame)]

  /**
   * Fetches the frames the visible strips are showing and do not have yet.
   *
   * Keyed by absolute source frame, so a zoom or a resize asks mostly for frames already here
   * and only the in-between ones are extracted. Nothing is cleared while that happens: a tile
   * whose frame has not arrived yet simply draws nothing until it does, and the tiles around it
   * keep theirs, so the strip fills in rather than flashing empty.
   *
   * The fetching waits for the layout to settle, and only the fetching. A drag of the window edge
   * re-lays the strips out on every frame, and each of those layouts names slightly different
   * frames; extracting for all of them would put an ffmpeg behind each frame of the drag. So the
   * request goes out once the width has stopped moving, while the strip itself keeps up with the
   * drag the whole time.
   */
  const laneZoom = zoom
  useEffect(() => {
    const bridge = window.electronAPI
    if (!bridge?.framesAt || !model || !outputFrame) return
    // Grouped by the source AND the signature, not by the source alone: the same file can appear
    // twice in a job with a different fit on each, and those are different pictures.
    const wanted = new Map<string, { target: string; cacheId: string; signature: string; jobs: Array<{ time: number; key: string }>; fps: number; source: { width: number; height: number }; fit?: SourceFit; crop?: CropFractions }>()
    model.lanes.forEach((lane) => {
      if (!filmstripLanes[lane.id]) return
      lane.segments.forEach((segment) => {
        const plan = planFor(segment)
        const shape = sourceShape[segment.sourcePath]
        const target = pictureSourceFor(segment)
        // A still has no frames to sample: its one picture repeated is its strip, and it is drawn
        // straight from the file rather than extracted.
        if (!plan || !shape || !target || segment.still) return
        // A clip with no picture has no frames to ask for. Its strip is its waveform, drawn from the
        // decoded peaks rather than from anything ffmpeg would be asked to extract.
        if (sourceVideo[segment.sourcePath] === false) return
        const signature = signatureFor(segment)
        const cacheId = segment.sourcePath
        const fit = draft ? sourceFitFor(draft, segment.sourcePath, clipIndexOf(segment)) : undefined
        // The clip's own crop, which the chain crops with before it fits: a strip is a picture of the
        // output, and the output is cropped.
        const crop = draft ? effectiveCropFor(draft, segment.sourcePath, clipIndexOf(segment)) : undefined
        const source = { width: shape.width, height: shape.height }
        const id = `${cacheId}#${signature}`
        const entry = wanted.get(id) ?? { target, cacheId, signature, jobs: [], fps: stripFpsFor(segment), source, fit, crop }
        plan.times.forEach((time, cell) => {
          const key = keyFor(segment, plan.frames[cell])
          if (frameImages[cacheId]?.[key]) return
          if (framesPendingRef.current[`${cacheId}#${key}`]) return
          entry.jobs.push({ time, key })
        })
        if (entry.jobs.length) wanted.set(id, entry)
      })
    })
    if (!wanted.size) return
    // Everything asked for, so that the marks can be released when the answer comes back.
    const asked = [...wanted].flatMap(([, { cacheId, jobs }]) => jobs.map(({ key }) => `${cacheId}#${key}`))
    const timer = window.setTimeout(() => {
      asked.forEach((key) => { framesPendingRef.current[key] = true })
      void Promise.all([...wanted].map(async ([, { target, cacheId, signature, jobs, fps, source, fit, crop }]) => {
        const images = await bridge.framesAt(target, {
          times: jobs.map((job) => job.time),
          fps,
          signature,
          cacheId,
          frame: outputFrame,
          source,
          fit,
          crop,
        })
        return [cacheId, jobs, images] as const
      })).then((entries) => {
        // Released whether or not a later layout has moved on: a mark left behind is a frame that
        // is never asked for again, so those tiles would stay blank for good. The pictures are
        // stored on the same terms — a key names a source frame and the shape it was drawn at,
        // neither of which a resize changes — so work already done is never thrown away.
        asked.forEach((key) => { delete framesPendingRef.current[key] })
        setFrameImages((current) => {
          const next = { ...current }
          let arrived = false
          entries.forEach(([cacheId, jobs, images]) => {
            const store = { ...(next[cacheId] ?? {}) }
            jobs.forEach(({ key }, position) => {
              const image = images[position]
              if (image) { store[key] = image; arrived = true }
            })
            next[cacheId] = store
          })
          return arrived ? next : current
        })
      })
    }, FILMSTRIP_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [filmstripLanes, laneZoom, mediaTargets, sourceShape, sourceVideo, timelineSignature, frameImages, draft?.preset.crop, draft?.imageSequencePreviews, outputFrame, draft?.sourceFit])

  // The window's own close button asks what CANCEL asks, rather than throwing unsaved edits away
  // quietly. The main process turns its close into this message and holds the window open until it is
  // answered, which is what makes the question one the user has to face rather than a notice.
  useEffect(() => {
    const subscribe = window.electronAPI?.onEditJobCloseRequested
    if (!subscribe) return
    return subscribe(() => {
      const task = draftRef.current
      // Nothing to lose and nothing to ask about: a window that has not been handed a task yet has no
      // edits to discard.
      if (!task) { void window.electronAPI?.cancelEditJob(); return }
      if (windowDirty(task, baselineRef.current ?? task)) setConfirmingDiscard(true)
      else void window.electronAPI?.cancelEditJob()
    })
  }, [])
  // A context menu closes on the next press anywhere, or on Escape.
  useEffect(() => {
    if (!timelineMenu) return
    const close = (event: Event) => {
      const target = event.target as Node | null
      if (target instanceof Element && target.closest('.timeline-menu')) return
      setTimelineMenu(null)
    }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') setTimelineMenu(null) }
    document.addEventListener('mousedown', close, true)
    document.addEventListener('contextmenu', close, true)
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('mousedown', close, true)
      document.removeEventListener('contextmenu', close, true)
      document.removeEventListener('keydown', keydown, true)
    }
  }, [timelineMenu])

  const timelineDuration = model?.duration ?? 0
  const playheadFraction = timelineDuration > 0 ? Math.max(0, Math.min(1, playback.position / timelineDuration)) : 0
  const audioLaneIds = (model?.lanes ?? []).filter((lane) => lane.kind === 'audio' || !lane.embedded).map((lane) => lane.id).join('|')
  /** Read by the lane refs below, which are made once and so must not close over a value that changes. */
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  /**
   * The ref each audio lane's element is given: one per lane, created once and never changed.
   *
   * Stable for the reason the monitor's video ref had to be. A ref written during render is a new
   * function every time, so React detaches and reattaches it on every render — and the monitor
   * re-renders on every animation frame while it plays. These handlers do no mount work, so the churn
   * itself cost little; what it cost was the assumption that a ref runs once. It does not, and a
   * handler that may be run sixty times a second must not assume it is.
   *
   * A lane's callback is kept once it is made, so adding a lane to a job does not hand a new function
   * to the lanes that were already there. The guard inside is the second layer: an element that is
   * already held is not a change, and being handed it again is answered with nothing.
   */
  const audioLaneCallbacksRef = useRef<Record<string, (element: HTMLAudioElement | null) => void>>({})
  const audioLaneRefs = audioLaneCallbacksRef.current
  audioLaneIds.split('|').filter(Boolean).forEach((laneId) => {
    if (audioLaneRefs[laneId]) return
    audioLaneRefs[laneId] = (element) => {
      if (audioElementsRef.current[laneId] === element) return
      audioElementsRef.current[laneId] = element
      if (element) element.muted = Boolean(mutedRef.current[laneId])
    }
  })
  /**
   * The media elements the monitor is showing, named in the app's log with whatever the decoder says
   * about them.
   *
   * In an effect rather than in a ref, and that is the whole of it: a ref written during render is a
   * new function every render, so a ref that logs is a logger that runs on every render — and one that,
   * on the monitor's video, also sought the element on every render. A logger that runs once per
   * element was the same hazard wearing a hat, so it moved here, where React runs it after the commit
   * that mounted whatever the playhead is on.
   */
  useEffect(() => {
    logMediaElement(playback.videoRef.current, 'monitor-video')
    logMediaElement(stillFrameRef.current, 'monitor-still')
  }, [playback.segment?.key, playback.videoRef])
  const fps = draft ? sourceFps(draft, playback.segment?.sourcePath ?? draft.sourcePaths[0], undefined, resolveTiming) : 25
  /** The same rate as the exact rational, for every stamp and scale the window prints: a 29.97 source's
   * frames are counted at 30000/1001 rather than at the 30 a decimal would round to. */
  const sourceRateValue = rateOf(fps)
  /**
   * The rate a job writes at when it names none: the PRIMARY source's own, read once per job.
   *
   * Snapshot rather than live-bound: the memo is keyed on the JOB and not on the timeline, so retiming or
   * removing the clip it was read from cannot move the output rate out from under a job that never chose
   * one. That is the whole of the difference between "the first clip's rate" and "whatever the first clip
   * is now", and it is the difference the OUTPUT FRAME totals depend on.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defaultOutputRate = useMemo<FrameRate>(() => (draft ? rateOf(sourceFps(draft, draft.sourcePaths[0], undefined, resolveTiming)) : rateOf(30)), [draft?.id])
  /** The rate the export is written at: the job's own where it names one, and the snapshot where it does not. */
  const outputRate = rateOf(draft?.preset.fpsRate ?? draft?.preset.fps ?? defaultOutputRate)
  const playbackRef = useRef(playback)
  playbackRef.current = playback
  const stepFpsRef = useRef(fps)
  stepFpsRef.current = Math.max(1, fps)
  /** The colour input behind the drawing's swatch: the square is the button, and this is what it clicks. */
  const colourInputRef = useRef<HTMLInputElement | null>(null)

  // The stage the picture sits in, and the picture's own pixel size. Together they place the
  // output frame outline, which is drawn around the picture rather than guessed at.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageObserverRef = useRef<ResizeObserver | null>(null)
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null)

  const measureNatural = (event: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>) => {
    const element = event.currentTarget
    const width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth
    const height = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight
    // Keyed by the SOURCE rather than by the clip. The element holds one file, and every clip cut from that
    // file is the same picture; keying it by the segment made the size belong to whichever clip happened to
    // be loaded, so a second copy of one file — which does not reload the element, so never fires this again
    // — read as a picture whose size was unknown and had no framing to edit. The source is what the element
    // really loaded, so that is what the measurement is filed under.
    if (width > 0 && height > 0) setNaturalSize({ key: playback.segment?.sourcePath, width, height })
  }

  // The stage only exists once a queue item has arrived: until then the editor returns a
  // placeholder and there is no element to measure. A callback ref binds the observer the
  // moment that element mounts. The effect this replaced ran once against the placeholder,
  // found no element and never ran again, so the size stayed null forever and the output
  // frame and the crop box had no geometry to draw with.
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    stageObserverRef.current?.disconnect()
    stageObserverRef.current = null
    stageRef.current = element
    if (!element) return
    const measure = () => setStageSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    stageObserverRef.current = observer
  }, [])

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

  /** Clip edges on the main lane, for the arrow keys to walk between. */
  const clipEdges = useMemo(() => {
    const segments = model?.lanes[0]?.segments ?? []
    return segments.map((segment) => ({ start: segment.start, end: segment.start + segment.duration }))
  }, [timelineSignature, probedTiming])
  const clipEdgesRef = useRef(clipEdges)
  clipEdgesRef.current = clipEdges

  /**
   * One keyboard layer for the transport. Only genuine text entry is ignored: a
   * focused range slider stays live, because placing the playhead leaves focus on
   * the scrubber, and treating that as typing swallowed every shortcut.
   *
   * LEFT and RIGHT STEP ONE FRAME, which is the transport's own FRAME buttons under another name — a
   * precision nudge, not a shuttle. The shuttle keeps its own two letters, J and L, so the arrows can mean the
   * one thing a reader reaching for a frame most wants; holding an arrow repeats the step, which is how a
   * reader walks a dozen frames without letting go. UP and DOWN still move to the edges of the clip under the
   * playhead, and pressing again walks to the neighbouring clip's edge, which is the frame-accurate helper's
   * jump-to-start and jump-to-end widened to a timeline with many clips.
   */
  const heldKeysRef = useRef({ k: false })
  const slowMotionRef = useRef(false)
  const tapTimerRef = useRef<number | null>(null)

  const jumpToClipEdge = (direction: 1 | -1) => {
    const edges = clipEdgesRef.current
    const at = playbackRef.current.position
    if (direction > 0) {
      const next = edges.find((edge) => edge.end > at + 0.001)
      if (next) playbackRef.current.seek(next.end)
      return
    }
    const previous = [...edges].reverse().find((edge) => edge.start < at - 0.001)
    if (previous) playbackRef.current.seek(previous.start)
  }

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
      const code = event.code
      // Undo and redo, before the text-entry guard: an edit made by dragging the crop box or the
      // window's own controls leaves the caret wherever it was, and a shortcut that only works when
      // nothing is focused is a shortcut that mostly does not work. A field being typed in yields to
      // the value that arrives, so undoing does not leave a stale figure on screen.
      if ((event.metaKey || event.ctrlKey) && code === 'KeyZ') {
        event.preventDefault()
        if (event.shiftKey) undoRedoRef.current.redo()
        else undoRedoRef.current.undo()
        return
      }
      if (isTyping(event.target)) return
      // DELETE removes the selected MAIN-LANE clip, after asking. It asks in the SAME question the clip's own
      // REMOVE SOURCE shows, at the clip's own box — one confirmation for both ways of asking rather than two
      // that say different things. A selection on an added audio lane is left to its own menu.
      if (code === 'Delete' || code === 'Backspace') {
        if (openRemoveConfirmRef.current()) { event.preventDefault(); return }
      }
      // COPY and PASTE the clip in hand. C takes it, records and all; V places it at the [+] nearest the
      // skimmer, so the paste lands where the playhead is pointing rather than always at one end.
      if ((event.metaKey || event.ctrlKey) && (code === 'KeyC' || code === 'KeyV')) {
        const handled = code === 'KeyC' ? copySelectedClipRef.current() : pasteCopiedClipRef.current()
        if (handled) { event.preventDefault(); return }
      }
      // A bare C CUTS the selected clip in two at the skimmer — a split, not a copy. Bound by PHYSICAL key
      // (`KeyC`) like J/K/L, so a non-Latin layout whose C key types another letter still cuts.
      if (code === 'KeyC' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (splitSelectedRef.current()) { event.preventDefault(); return }
      }
      if (code === 'Space' || event.key === ' ') {
        event.preventDefault()
        playbackRef.current.toggle()
        return
      }
      if (code === 'ArrowUp' || code === 'ArrowDown') {
        event.preventDefault()
        jumpToClipEdge(code === 'ArrowDown' ? 1 : -1)
        return
      }
      // The arrows are the FRAME buttons: one whole frame each way, held and repeated like any other key. They
      // are not a shuttle, so nothing here ramps or latches — J and L do that, and a reader who wants it will
      // reach for them.
      if (code === 'ArrowLeft' || code === 'ArrowRight') {
        event.preventDefault()
        playbackRef.current.step((code === 'ArrowRight' ? 1 : -1) / stepFpsRef.current)
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
      // L ACCELERATES: from rest it plays, already running it steps the shared speed value up (2x, then 4x, then
      // 8x, from whatever the selector or the wheel set — see `accelerate`). J keeps the reverse shuttle.
      if (code === 'KeyL') { playbackRef.current.accelerate(); return }
      playbackRef.current.shuttle(-1)
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
      // presses of the same key ramp the speed, and only SPACE stops it — K is a forward tap now, not a stop.
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      clearTap()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  /**
   * Wheel over the SCALE magnifies, rather than scrubbing as the same wheel does over the lanes.
   *
   * The scale is the one part of the timeline that is about the timeline's own scale, so a wheel there
   * is read as being about that and nothing else. Stopping the event is what keeps it from reaching the
   * lanes' scrub, which is the handler below it and would otherwise move the playhead as well.
   */
  const zoomByWheel = (event: React.WheelEvent<HTMLElement>) => {
    if (event.deltaY === 0) return
    event.stopPropagation()
    setZoom((current) => zoomedBy(current, event.deltaY))
  }

  /**
   * Wheel over the timeline scrubs the playhead, as the helper's strip does: a
   * fraction of a frame per tick, eased with tanh so a flick travels much further
   * than a nudge, and the sign inverted to match the helper's convention.
   *
   * It is a SCRUB rather than a seek, which matters only while the transport is running: a plain seek leaves
   * the auto-advance clock writing the playhead too, and the two fight at every cut — the skimmer loops on the
   * joint and the slaved audio is re-seeked on every tick. The scrub stands the clock down until the wheel
   * falls idle, so one writer at a time. See `scrubBy`.
   */
  const scrubByWheel = (event: React.WheelEvent<HTMLElement>) => {
    // Shift and the horizontal axis are left to the browser, so a zoomed-in timeline
    // can still be panned. The helper never needed that: its strip always showed the
    // whole clip.
    if (event.shiftKey || event.deltaY === 0) return
    const eased = Math.tanh(Math.abs(event.deltaY) / 6)
    const step = (1 / Math.max(1, stepFpsRef.current)) * (0.35 + 1.65 * eased)
    playback.scrubBy(event.deltaY < 0 ? step : -step)
  }

  /**
   * Wheel over the MONITOR changes the SPEED being watched at, as the selector beside it does.
   *
   * It replaces a wheel-scrub, and that is no loss: the seek bar under the transport is the monitor's own
   * scrubber, and the timeline's lanes still scrub on the wheel, so the one gesture that had no home was this
   * one. The ladder is climbed and STOPS at its ends rather than wrapping, and it is the same ladder the
   * selector offers, so the two can never disagree about what a rung is.
   */
  const speedByWheel = (event: React.WheelEvent<HTMLElement>) => {
    if (event.deltaY === 0) return
    playback.setSpeed(steppedPreviewSpeed(playback.speed, event.deltaY < 0 ? 1 : -1))
  }

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

  /**
   * Keeps the skimmer in view.
   *
   * A zoomed timeline is wider than its window, so it is followed whichever way the
   * skimmer moved: playback, a wheel scrub, an arrow-key step or a click. It pans only
   * once the skimmer crosses a margin, so a scrub does not re-centre on every tick.
   */
  useEffect(() => {
    const scroller = timelineScrollRef.current
    const inner = timelineInnerRef.current
    if (!scroller || !inner) return
    const next = scrollToKeepVisible({
      offset: skimmerOffset(playheadFraction, inner.clientWidth),
      scrollLeft: scroller.scrollLeft,
      viewportWidth: scroller.clientWidth,
      contentWidth: scroller.scrollWidth,
    })
    if (next != null) scroller.scrollLeft = next
  }, [playheadFraction, zoom])

  /**
   * Whether this job's export shows a drawing of its own sound, and what that drawing is made from.
   *
   * Read here rather than beside the settings that offer it because the MONITOR needs it too, and the
   * monitor is drawn long before those settings are. It comes from one function either way, so the two
   * cannot disagree about what is being drawn — see `drawingPictureFor`.
   */
  const drawingPicture = useMemo(() => (draft ? drawingPictureFor(draft) : { offersPicture: false, draws: false, sources: [], still: null }), [draft])
  /**
   * The still of that drawing, which is what the monitor shows instead of the app's own green line.
   *
   * Regenerated when the style changes, and DELAYED while it does: a colour is typed a character at a
   * time and a frame is an ffmpeg run, so the field would otherwise start one per keystroke. The delay is
   * on the fetch only — the monitor keeps the still it has until the next one arrives, so the picture does
   * not blink out while it is being redrawn.
   */
  const [drawingStill, setDrawingStill] = useState<string | null>(null)
  const drawingBackground = draft ? visualizationBackgroundKind(draft.preset) : 'colour'
  // Whether the drawing being judged is a PICTURE with the sweeping line on it. Only a picture takes one — a
  // drawing that moves is its own progress — and only the preset decides whether it is on.
  const drawingLine = Boolean(draft && templateFor(draft.preset.visualization).kind === 'picture' && visualizationProgressLine(draft.preset))
  /**
   * The palette and every knob the chosen template reads, resolved once.
   *
   * One object because it answers three questions with the same figures: what the monitor's still is drawn
   * with, when that still has to be redrawn, and — through the encoder's own `drawingTuneOf` — what the
   * export will be drawn with. Naming them here instead is how a knob the editor draws becomes a knob the
   * export ignores.
   */
  const drawingTune = draft ? drawingTuneOf(draft.preset) : DEFAULT_TUNE
  /**
   * The EQ's knobs, resolved the same way and for the same reason — and the reason a bar count can differ
   * between one template and another: a template's own default is what an unset field falls back to, so the
   * LED EQ's field reads the sixteen it will draw with rather than the sixty-four the plain bars default to.
   */
  const eqStyle = draft ? eqStyleOf(draft.preset) : DEFAULT_EQ_STYLE
  /** The chosen drawing, resolved once, so the knob rows below and the monitor agree on which set applies. */
  const drawingTemplate = templateFor(draft?.preset.visualization)
  /**
   * The colour the drawing will actually be made in: the job's own where it named one, and the theme's
   * otherwise. The swatch shows THIS rather than the stored value, so a job that has named no colour shows the
   * green it will be drawn in instead of an empty field.
   */
  const drawingColour = draft ? drawingColorOf(draft.preset) : VISUALIZATION_BACKGROUND
  const drawingStillKey = JSON.stringify([
    drawingPicture.draws ? drawingPicture.sources : [],
    draft?.preset.visualization ?? 'waveform',
    // The whole resolved tune, so the theme, the weight, the mirror, the spectrum's scale and saturation,
    // the segments and the scope's own three all redraw the still without any of them being named here.
    drawingTune,
    draft?.preset.visualizationColor ?? '',
    drawingLine,
    // The EQ's own knobs are part of the design too, so a change to one redraws the still. They are named
    // whether or not the template is a bar drawing, which costs one redraw if they are set and then left behind.
    draft?.preset.eqBars ?? '',
    draft?.preset.eqGap ?? '',
    draft?.preset.eqAmplitude ?? '',
    draft?.preset.eqFrequency ?? '',
    draft?.preset.eqSensitivity ?? '',
    drawingBackground,
    draft?.preset.visualizationBackgroundColor ?? '',
    drawingBackground === 'image' ? draft?.preset.visualizationBackgroundImage ?? '' : '',
    drawingBackground === 'still' ? drawingPicture.still ?? '' : '',
  ])
  useEffect(() => {
    const bridge = window.electronAPI
    if (!drawingPicture.draws || !drawingPicture.sources.length || !bridge?.visualizationStill) { setDrawingStill(null); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void bridge.visualizationStill({
        sources: drawingPicture.sources,
        template: draft?.preset.visualization ?? 'waveform',
        color: draft?.preset.visualizationColor,
        background: drawingBackground,
        backgroundColor: draft?.preset.visualizationBackgroundColor,
        backgroundImage: drawingBackground === 'image' ? draft?.preset.visualizationBackgroundImage : drawingPicture.still ?? undefined,
        progressLine: drawingLine,
        // The EQ's knobs RESOLVED rather than as they are stored, so the request carries the figures the export
        // will actually draw with — the defaults included. The export resolves them from the preset by the same
        // function, so the design judged here and the design written cannot disagree about an unset knob.
        ...(draft ? eqStyleOf(draft.preset) : {}),
        // The palette and the knobs, resolved rather than raw — the same object the key above is built from,
        // and the same one the encoder resolves from the preset, so the design judged here is the design
        // written. Its field names are the request's own, which is the point of naming them together.
        ...drawingTune,
        ...(outputFrame ? { width: outputFrame.width, height: outputFrame.height } : {}),
        fps: draft?.preset.fps ?? 30,
      }).then((url) => { if (!cancelled) setDrawingStill(url) }).catch(() => { if (!cancelled) setDrawingStill(null) })
    }, DRAWING_STILL_SETTLE_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
    // The key is the request in one string, so this runs when the DESIGN changes and not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingStillKey])

  if (!draft || !model) return <div className="edit-job-shell"><div className="editor-loading">WAITING FOR QUEUE ITEM...</div></div>

  /**
   * The draft as it stands right now.
   *
   * The state behind `draft` only catches up on the next render, so a handler that
   * reads it directly loses whatever another handler set a moment earlier. That is
   * how setting a fade on one cut could quietly drop the fade just set on another.
   */
  const latest = () => draftRef.current ?? draft

  /**
   * Writes a change to the draft, remembering what it was before.
   *
   * The rule about what is worth remembering is `recordChange`'s, which returns nothing for a write
   * that writes the same values: those go to the draft like any other write, they are simply not a
   * step anyone would want to take back to.
   */
  const updateDraft = (changes: Partial<QueueTask>) => {
    const current = latest()
    // A gesture is remembered once, when it ends, rather than once per move: see `gestureRef`.
    if (!gestureRef.current) {
      const history = recordChange(historyRef.current, current, changes)
      if (history) historyRef.current = history
    }
    const next = { ...current, ...changes }
    draftRef.current = next
    setDraft(next)
  }
  /** Starts treating the writes that follow as one step, from the draft as it stands now. */
  const beginGesture = () => { if (!gestureRef.current) gestureRef.current = latest() }
  /** Ends it, remembering the whole gesture as the single step it was. */
  const finishGesture = () => {
    const before = gestureRef.current
    gestureRef.current = null
    if (!before) return
    const history = endGesture(historyRef.current, before, latest())
    if (history) historyRef.current = history
  }
  /** Steps the draft back or forward one edit, if there is one to step to. */
  const stepHistory = (direction: 'undo' | 'redo') => {
    // A step taken mid-drag would leave the gesture holding a state it is no longer the one before.
    gestureRef.current = null
    const moved = stepBack(historyRef.current, latest(), direction)
    if (!moved) return
    historyRef.current = moved.history
    draftRef.current = moved.state
    setDraft(moved.state)
  }
  undoRedoRef.current = { undo: () => stepHistory('undo'), redo: () => stepHistory('redo') }
  const updatePreset = (changes: Partial<EncodingPreset>) => updateDraft({ preset: { ...latest().preset, ...changes } })

  const changeContainer = (container: EncodingPreset['container']) => {
    const current = latest()
    updateDraft({
      preset: applyContainerChange(current.preset, container),
      outputFilename: deriveOutputFilename(current, current.preset, container),
    })
  }

  const changeResolution = (resolution: EncodingPreset['resolution']) => {
    // Exact width/height take precedence over a named resolution in the encoder,
    // so a named choice would otherwise be a silent no-op.
    updatePreset({ resolution, width: undefined, height: undefined })
  }

  /**
   * Sets the output frame's shape by giving the encoder an exact size for it.
   *
   * A named resolution is a short side, so the ratio decides the rest: 1080p at 4:3 is
   * 1440x1080 and at 9:16 is 1080x1920. Changing the size clears the named resolution's
   * effect in the encoder, which is why the sidebar says so.
   */
  const applyAspect = (ratio: number) => {
    const current = latest()
    const base = current.preset.width && current.preset.height
      ? Math.min(current.preset.width, current.preset.height)
      : resolutionShortSide(current.preset.resolution)
    const size = aspectSize(ratio, base)
    updatePreset({ width: size.width, height: size.height })
  }

  /** The ratio the current exact size stands for, if it is one of the offered shapes. */
  const exactAspect = draft.preset.width && draft.preset.height ? draft.preset.width / draft.preset.height : null
  const activeAspect = exactAspect ? ASPECTS.find((candidate) => Math.abs(candidate.ratio - exactAspect) < ASPECT_TOLERANCE)?.label : undefined
  /**
   * Matches the output frame to the picture in hand.
   *
   * The frame takes that clip's SHAPE *and* its exact pixel size, so the two things the button does
   * are one statement: what is exported is what the clip is, rather than merely the same shape as it.
   * The shape follows from the size, which is why setting the size is the whole of the work — the
   * ratio row reports it a moment later.
   *
   * The size is the one already read for the button, or the playing clip's own as the element
   * reported it. With neither known yet the source is probed, which is why this can take a moment
   * rather than being instant; a job with no picture in it has nothing to match and does nothing.
   */
  const applyMatchSource = () => {
    const target = matchSourceSource(latest(), playback.segment?.sourcePath)
    if (!target) return
    const known = target === playback.segment?.sourcePath && picture ? picture : matchSourceSize
    if (known) { updatePreset({ width: known.width, height: known.height, resolution: 'source' }); return }
    void probeSource(target).then((info) => {
      const resolution = info?.videoStreams?.[0]?.resolution?.split('x').map(Number)
      if (resolution && resolution[0] > 0 && resolution[1] > 0) updatePreset({ width: resolution[0], height: resolution[1], resolution: 'source' })
    })
  }
  /**
   * Whether the frame already IS the picture in hand, which is what the button reports itself against.
   *
   * Read from the size rather than from the mode that set it: what the button promises is the frame,
   * and a frame that happens to have been reached another way is still the frame it promises.
   */
  const matchSourceChosen = Boolean(draft.preset.width && draft.preset.height && matchSourceSize
    && draft.preset.width === matchSourceSize.width && draft.preset.height === matchSourceSize.height)

  /**
   * The cuts on the main lane, where a transition can sit.
   *
   * Transitions only exist between concatenated clips, which is the main lane of a
   * stitch and of a combo that concatenates its visuals. A multi-track job maps a
   * single video stream, so it has no cut to offer.
   */
  const mainLane = model.lanes[0]
  mainLaneIdRef.current = mainLane?.id
  const cuts = (mainLane?.segments ?? []).slice(0, -1).map((clip, index) => ({ index, sourcePath: clip.sourcePath }))

  // PROPERTIES reads the source under the playhead, which is the one the inspector was
  // opened on. A source with an intrinsic rate shows it; a still or a sequence, whose
  // rate is a choice rather than a fact about the file, can have it changed here.
  const inspectedSegment = selected ? model?.lanes.find((lane) => lane.id === selected.laneId)?.segments.find((segment) => segment.key === selected.clipKey) : undefined
  const inspectedSource = inspectedSegment?.sourcePath
  // Whether the inspector is describing a clip on the SOURCE list (the main lane) rather than an added
  // track: an embedded-audio control belongs to the video it is part of, not to a track of its own.
  const inspectedOnMainLane = Boolean(selected && mainLane && selected.laneId === mainLane.id)
  const inspectedSequence = inspectedSource ? sequenceFor(draft, inspectedSource) : undefined
  const inspectedFps = inspectedSource ? sourceFps(draft, inspectedSource, undefined, resolveTiming) : 0
  const inspectedProbe = inspectedSource ? probedTiming[inspectedSource] : undefined
  /** The SOURCE's own pixel format, which its depth is read off — a fact about the file, never a control. */
  const inspectedPixelFormat = inspectedSource ? sourceProbes[inspectedSource]?.videoStreams?.[0]?.pixelFormat : undefined
  /** The whole probe of the same source, for the lines that describe the file rather than time it. */
  const inspectedInfo = inspectedSource ? sourceProbes[inspectedSource] : undefined
  const inspectedAudioFacts = audioFacts(inspectedInfo)
  const inspectedAudioCodec = audioCodecFacts(inspectedInfo)
  /**
   * The clip the inspector is describing, as the key its speed is filed under.
   *
   * The same keying the trim, the fit and the crop use, taken from the segment itself — a segment knows
   * its own place by the key it was built with — so the speed follows its clip through a reorder the
   * way everything else filed per clip does.
   */
  const inspectedClipIndex = inspectedSegment ? clipIndexOf(inspectedSegment) : 0
  // The clip's copy label, `COPY n`, when its file appears in the job more than once — so PROPERTIES names
  // the same clip the timeline box and the monitor do rather than naming a file twice over.
  const inspectedCopyLabel = draft && inspectedSource ? copyLabelFor(draft, inspectedClipIndex, inspectedSource) : undefined
  const inspectedCanSpeed = Boolean(draft && inspectedSource && canApplyClipSpeed(draft, inspectedSource))
  // The SPEED the reader SET, not the segment's own `speed`, which now carries the interpreted rate folded
  // in as a retime. The two fields must show the figures that were chosen; the composition happens where
  // the length is worked out, not in what a reader is shown to be editing.
  const inspectedSpeed: ClipSpeed = inspectedSource ? speedFor(latest(), inspectedSource, inspectedClipIndex) : DEFAULT_CLIP_SPEED
  /** The rate this clip's frames are read at, and its source's own — both rationals, for the pair of fields. */
  const inspectedNativeRate = inspectedSource ? nativeRateFor(draft, inspectedSource, undefined, resolveTiming) : rateOf(30)
  const inspectedRate = inspectedSource ? clipRateFor(draft, inspectedSource, inspectedClipIndex, inspectedNativeRate) : inspectedNativeRate
  /**
   * Whether the clip being described has a picture and a sound, which is what each retiming option needs.
   *
   * Interpolation fills the frames a speed leaves out, so it is a question with no answer about a clip
   * that has no frames — asked of the same rule the timeline uses to tell a picture from a track, so the
   * two cannot disagree about what a clip is. The pitch rides a SOUND, which only a probe can answer for
   * a video that may or may not carry one; `undefined` — a source not yet read — counts as having one, so
   * the switch is offered a moment before the probe lands rather than flickering out and back.
   */
  const inspectedHasPicture = Boolean(inspectedSource) && mediaKind(inspectedSource as string) !== 'audio'
  const inspectedHasSound = inspectedSource ? sourceAudio[inspectedSource] !== false : false

  /** Transitions are keyed by the clip BEFORE the boundary, like trim points, and by the edge. */
  const applyTransition = (key: string, type: TransitionType, duration = 0.5) => {
    const next = { ...(latest().transitions || {}) }
    if (type === 'none') delete next[key]
    else next[key] = { type, duration }
    updateDraft({ transitions: Object.keys(next).length ? next : undefined })
  }
  /**
   * Sets one clip's output fit, or takes it away.
   *
   * The two fits are exclusive, because each one fixes a different axis to the frame's: a clip
   * cannot have both its width and its height pinned to a frame whose shape is its own choice.
   * Turning the one that is on off leaves the clip with no entry at all, which is the default
   * fit — not an entry that happens to do nothing, which would then read as "chosen".
   */
  /**
   * Mutes or unmutes a lane, which decides whether the export carries that audio.
   *
   * An unmuted lane is left out of the map rather than stored as a false, so a job that has never
   * been muted carries nothing extra in its record and a lane that is added back is unmuted.
   */
  const setLaneMuted = (laneId: string, next: boolean) => {
    const map = { ...(latest().mutedLanes ?? {}) }
    if (next) map[laneId] = true
    else delete map[laneId]
    updateDraft({ mutedLanes: Object.keys(map).length ? map : undefined })
  }

  /**
   * Sets one added track's own LEVEL, in dB.
   *
   * The track IS the record — it is a field of the track rather than a map beside it — so it travels with the
   * track through a reorder, a removal or a change of mode, and the export and the monitor both read it there.
   * Unity leaves no field, so an untouched track is exactly the track it was.
   */
  const setTrackGain = (trackId: string, gainDb: number) => {
    const current = latest()
    const tracks = (current.additionalAudioTracks || []).map((track) => {
      if (track.id !== trackId) return track
      const next = { ...track }
      if (!Number.isFinite(gainDb) || Math.abs(gainDb) <= 1e-9) delete next.gainDb
      else next.gainDb = Math.max(-60, Math.min(24, gainDb))
      return next
    })
    updateDraft({ additionalAudioTracks: tracks })
  }

  /**
   * Writes one clip's embedded-stream record: a mute, a level, both, or neither.
   *
   * A stream put back to enabled-at-unity leaves no entry, and a clip with none of its own leaves no
   * record at all, so an untouched clip stays byte-identical to one saved before this existed. Keyed by
   * the clip's own id, so the record travels with the clip through a move, a split or a duplicate.
   */
  const writeEmbeddedStream = (clipId: string, index: number, next: Partial<EmbeddedAudioStream>) => {
    const current = latest()
    const streams = embeddedStreamsFor(current, clipId)
    const merged = { ...(streams.find((entry) => entry.index === index) ?? { index }), ...next }
    const record: EmbeddedAudioStream = { index }
    if (merged.muted) record.muted = true
    if (merged.gainDb !== undefined && Math.abs(merged.gainDb) > 1e-6) record.gainDb = merged.gainDb
    const kept = streams.filter((entry) => entry.index !== index)
    const nextStreams = [...kept, ...(Object.keys(record).length > 1 ? [record] : [])].sort((earlier, later) => earlier.index - later.index)
    const map = { ...(current.embeddedAudio ?? {}) }
    if (nextStreams.length) map[clipId] = nextStreams
    else delete map[clipId]
    updateDraft({ embeddedAudio: Object.keys(map).length ? map : undefined })
  }

  /**
   * Takes one or more of a clip's embedded streams OUT of the picture and onto lanes of their own.
   *
   * The new track NAMES the stream it came from (`streamIndex`) and its clip (`sourceClipId`) rather than
   * copying the file, so the source is never altered and nothing double-plays: the export maps that stream
   * from the track's own input, while the picture's own mapping — read through `enabledEmbeddedStreams` —
   * drops it. The track starts where the picture's window does, so it is in sync by default and only then
   * trims and moves on its own, which is what a J/L cut needs. Deleting the track is the way back: the
   * clip's mapping re-enables itself, because the extraction was never a flag stored on the clip.
   */
  const extractAudioToTrack = (clipId: string, path: string, indices: number[]) => {
    const current = latest()
    const at = materializeClipIds(current).indexOf(clipId)
    if (at < 0 || current.sourcePaths[at] !== path || !indices.length || !embeddedAudioEditable(current)) return
    const clipTrim = current.trimPoints?.[clipId]
    const tracks = [...(current.additionalAudioTracks ?? [])]
    const trimPoints = { ...(current.trimPoints ?? {}) }
    const mutedLanes = { ...(current.mutedLanes ?? {}) }
    indices.forEach((streamIndex) => {
      if (extractedBy(current, clipId, path, streamIndex)) return
      // The clip's own LEVEL and MUTE travel with the stream, so the mix is unchanged at the moment of
      // extraction and only a later edit to the track changes it — the acceptance this is built to.
      const gainDb = embeddedGainDb(current, clipId, streamIndex)
      const wasMuted = Boolean(embeddedStreamsFor(current, clipId).find((entry) => entry.index === streamIndex)?.muted)
      const track = { id: newTrackId(), path, language: 'und', streamIndex, sourceClipId: clipId, ...(gainDb ? { gainDb } : {}) }
      tracks.push(track)
      if (wasMuted) mutedLanes[track.id] = true
      // The extracted run begins where the picture's own window does, so the two are in sync until the
      // track is trimmed on its own — which is exactly the J/L cut it is for.
      if (clipTrim && (clipTrim.in > 0 || clipTrim.out > clipTrim.in)) trimPoints[trackKey(current, track)] = { in: clipTrim.in, out: clipTrim.out }
    })
    updateDraft({
      ...withListType(current, current.sourcePaths, tracks),
      trimPoints: Object.keys(trimPoints).length ? trimPoints : undefined,
      mutedLanes: Object.keys(mutedLanes).length ? mutedLanes : undefined,
    })
  }
  /**
   * Sets one clip's scale, or takes it away, keeping whatever position it carries.
   *
   * The two are separate decisions now, and the position is the user's own: a fit switched off is a
   * change of SCALE, not a reason to move the picture back to the middle, so a clip that has been
   * placed stays where it was placed. A clip that has never been placed leaves no record behind at all
   * rather than a `contain` fit that means nothing.
   */
  const setSourceFit = (key: string, mode: SourceFit['mode'] | null) => {
    const next = { ...(latest().sourceFit || {}) }
    const existing = next[key]
    const offset = storedFitOffset(existing)
    const insets = insetsOf(existing)
    // The record carries a SCALE, a POSITION and MARGINS, and it is kept while it carries any of them:
    // a fit switched off is a change of scale, not a reason to throw the other two away. A clip that
    // has never carried one leaves no record behind at all rather than a `contain` fit meaning nothing.
    const record = (fitMode: SourceFit['mode']): SourceFit => (hasInsets(insets) ? { mode: fitMode, offset, insets } : { mode: fitMode, offset })
    const decided = offset.x !== 0 || offset.y !== 0 || hasInsets(insets)
    if (mode === null) {
      if (decided) next[key] = record('contain')
      else delete next[key]
    } else {
      next[key] = record(mode)
    }
    updateDraft({ sourceFit: Object.keys(next).length ? next : undefined })
  }
  /**
   * Places the clip on the canvas, by the figures in the OFFSET sub-section.
   *
   * The same write the monitor's dragger makes, against the same key, so the two are one value seen
   * twice rather than two values that have to be kept in step. It is per clip because a fit is, and it
   * changes nothing about the export beyond where that one clip sits: nothing is clamped, so X and Y
   * go as far in either direction as they are asked to, and the background shows where the picture
   * does not reach. A clip with no fit of its own gets a `contain` one, which changes its scale not at
   * all — the position is a decision a clip can have on its own.
   */
  const setFitOffset = (xPercent: number, yPercent: number) => {
    if (!activeFitKey) return
    const insets = insetsOf(activeFit)
    updateDraft({
      sourceFit: {
        ...(latest().sourceFit ?? {}),
        [activeFitKey]: {
          mode: activeFit?.mode ?? 'contain',
          offset: { x: xPercent / 100, y: yPercent / 100 },
          // The margins are carried over: this control moves the picture, and the box it is sized
          // into is the other control's business.
          ...(hasInsets(insets) ? { insets } : {}),
        },
      },
    })
  }
  /**
   * Insets the clip, by the figures in the INSETS sub-section.
   *
   * The margins live on the clip's fit record because they are part of the same decision — how the
   * clip is placed in the output — and because such a record already follows its clip through a
   * reorder. They size the box the fit scales the clip into; they do NOT move it, so the position is
   * carried across untouched and a picture that has been dragged stays where it was put while the box
   * shrinks around it. A clip with no fit of its own gets a `contain` one, which changes its scale not
   * at all: a margin is a decision a clip can have on its own.
   */
  const setInsets = (edges: Partial<Insets>) => {
    if (!activeFitKey) return
    const insets = normaliseInsets({ ...insetsOf(activeFit), ...edges })
    updateDraft({
      sourceFit: {
        ...(latest().sourceFit ?? {}),
        [activeFitKey]: {
          mode: activeFit?.mode ?? 'contain',
          offset: { ...storedFitOffset(activeFit) },
          ...(hasInsets(insets) ? { insets } : {}),
        },
      },
    })
  }
  const setBoundaryTransition = (index: number, type: TransitionType, duration = 0.5) => {
    const cut = cuts.find((candidate) => candidate.index === index)
    if (!cut) return
    applyTransition(clipKey(latest(), cut.sourcePath, index), type, duration)
  }
  /** The head and tail of the timeline, which cut from and to black. */
  const setEdgeTransition = (edge: 'head' | 'tail', type: TransitionType, duration = 0.5) =>
    applyTransition(edge === 'head' ? HEAD_FADE_KEY : TAIL_FADE_KEY, type, duration)

  /**
   * Puts a main-lane clip at another place in the job, which is a reorder of its three lists together.
   *
   * The paths carry the order; the ids and the numbers are spliced the SAME way, so each clip keeps its
   * identity and its `COPY n` however far it moves. Nothing else moves, because every per-clip record is
   * already filed under the id that travelled — that is what ids are for.
   */
  const reorderClip = (from: number, to: number) => {
    const current = latest()
    if (from === to || from < 0 || to < 0 || from >= current.sourcePaths.length || to >= current.sourcePaths.length) return
    updateDraft({
      sourcePaths: moveAlong(current.sourcePaths, from, to),
      clipIds: moveAlong(materializeClipIds(current), from, to),
      clipNumbers: moveAlong(materializeClipNumbers(current), from, to),
    })
  }

  /**
   * Takes ONE clip out of the job, which is what both the menu's REMOVE SOURCE and the Delete key answer to.
   *
   * The job is rebuilt without that place, so the surviving clips keep their records. A job left with nothing
   * at all to encode cannot be held in a draft, so that one is the queue's to do — and it takes the job with it.
   */
  const removeClipAt = (sourcePath: string, sourceIndex: number | null) => {
    const task = draftRef.current ?? latest()
    const without = removeSourceFromTask(task, sourcePath, sourceIndex ?? undefined)
    if (without) updateDraft(without)
    else if (sourceIndex != null) void window.electronAPI?.removeEditJobSource(task.id, sourcePath, sourceIndex)
  }

  /**
   * The mode a list makes a job, with the list itself — so the window's title and timeline follow at once.
   *
   * A job's TYPE is a reading of its lists rather than a field with a life of its own: adding a second
   * visual to a CONVERT is a STITCH, adding a track to it is a MULTI-TRACK, and the window has to say so
   * before APPLY rather than leaving a stale heading over a list that no longer matches. The queue re-reads
   * the same rule when the patch lands, so the two cannot disagree — see `inferredMode`.
   */
  const withListType = (
    item: QueueTask,
    sourcePaths: string[],
    tracks: QueueTask['additionalAudioTracks'],
    mode?: QueueTask['comboMode'],
  ): Partial<QueueTask> => {
    const list = tracks && tracks.length ? tracks : undefined
    const type = inferredMode(sourcePaths, list ?? [])
    // `comboMode` is kept for a MULTI-TRACK as well as a COMBO: it is a question about how the TRACKS
    // relate to each other, not about how many visuals they play under.
    const carriesTracks = type === 'combo' || type === 'multitrack'
    return {
      sourcePaths,
      additionalAudioTracks: list,
      type,
      comboMode: carriesTracks ? (mode ?? item.comboMode ?? 'multitrack') : undefined,
    }
  }

  /** Where a run of files lands: visuals spliced into the join at the place, audio appended as tracks. */
  const applyInsert = (position: number, visuals: string[], audios: string[], mode?: QueueTask['comboMode']) => {
    const current = latest()
    const at = Math.max(0, Math.min(position, current.sourcePaths.length))
    const ids = materializeClipIds(current)
    const numbers = materializeClipNumbers(current)
    const sourcePaths = [...current.sourcePaths.slice(0, at), ...visuals, ...current.sourcePaths.slice(at)]
    const tracks = [...(current.additionalAudioTracks || []), ...audios.map((path) => ({ id: newTrackId(), path, language: 'und' }))]
    updateDraft({
      ...withListType(current, sourcePaths, tracks, mode),
      clipIds: [...ids.slice(0, at), ...newClipIds(visuals.length), ...ids.slice(at)],
      clipNumbers: [...numbers.slice(0, at), ...addedClipNumbers(current, visuals), ...numbers.slice(at)],
    })
  }

  /**
   * Adds one or more sources AT a place in the join, from the [+] panel's ADD SOURCE.
   *
   * A source lands on the lane it BELONGS to rather than the one the [+] stood on: an added track is not in
   * `sourcePaths` at all, so an AUDIO file goes to the track list and everything else splices into the join.
   * Without that, an audio file added from the video lane's [+] landed in `sourcePaths`, where the
   * multi-track encoder never reads it — a source that was added and then silently not used.
   *
   * THE FIRST SOUND ASKS HOW THE TRACKS RELATE. A job with no tracks is about to gain a second axis of
   * arrangement — stacked, or sequenced end to end — which is the reader's choice rather than the job's, so
   * it is asked before anything is inserted. The answer is `comboMode`.
   */
  const insertSources = async (position: number) => {
    const files = await window.electronAPI?.selectFiles()
    if (!files?.length) return
    const visuals = files.filter((file) => mediaKind(file) !== 'audio')
    const audios = files.filter((file) => mediaKind(file) === 'audio')
    if (audios.length && !(latest().additionalAudioTracks || []).length) {
      setAudioChoice({ position, visuals, audios })
      return
    }
    applyInsert(position, visuals, audios)
  }

  /**
   * Adds sources from an added audio lane's [+] panel: audio becomes another track, a picture joins the
   * join. The same first-sound question is asked here, this being the other [+] that can put the first track
   * on a job.
   */
  const insertTrackSources = async (position: number) => {
    const files = await window.electronAPI?.selectFiles()
    if (!files?.length) return
    const current = latest()
    const visuals = files.filter((file) => mediaKind(file) !== 'audio')
    const audios = files.filter((file) => mediaKind(file) === 'audio')
    if (audios.length && !(current.additionalAudioTracks || []).length) {
      setAudioChoice({ position: current.sourcePaths.length, visuals, audios })
      return
    }
    // A track goes at the lane's own place in the TRACK list; a picture is appended to the join.
    const tracks = [...(current.additionalAudioTracks || [])]
    const at = Math.max(0, Math.min(position, tracks.length))
    tracks.splice(at, 0, ...audios.map((path) => ({ id: newTrackId(), path, language: 'und' })))
    const sourcePaths = [...current.sourcePaths, ...visuals]
    updateDraft({
      ...withListType(current, sourcePaths, tracks),
      clipIds: [...materializeClipIds(current), ...newClipIds(visuals.length)],
      clipNumbers: [...materializeClipNumbers(current), ...addedClipNumbers(current, visuals)],
    })
  }

  /**
   * The clip at a place, as the thing that would be placed again: its source and its own resolved records.
   *
   * Resolved HERE, at the moment of copying, so an edit made after the copy does not follow it into the paste.
   */
  const capturedClipAt = (task: QueueTask, index: number): CopiedClip => {
    const sourcePath = task.sourcePaths[index]
    const key = clipKey(task, sourcePath, index)
    return {
      sourcePath,
      trimPoints: task.trimPoints?.[key],
      sourceFit: task.sourceFit?.[key],
      sourceCrop: task.sourceCrop?.[key],
      sourceSpeed: task.sourceSpeed?.[key],
      sourceFps: task.sourceFps?.[key],
    }
  }

  /**
   * Places a copy of a clip at a position in the join, with its records filed under the copy's OWN id.
   *
   * The source, the opaque id and the next copy number for its file go in at the same place, so the clips
   * already in the job keep their records exactly where they were; the records the copy carries are written
   * under the new id, which is what makes the duplicate a duplicate rather than a bare second import.
   */
  const insertClipCopy = (clip: CopiedClip, position: number) => {
    const current = latest()
    const at = Math.max(0, Math.min(position, current.sourcePaths.length))
    const ids = materializeClipIds(current)
    const numbers = materializeClipNumbers(current)
    const newId = newClipId()
    const number = addedClipNumbers(current, [clip.sourcePath])[0]
    const withCopy = <T,>(value: T | undefined, map?: Record<string, T>): Record<string, T> | undefined =>
      value !== undefined ? { ...(map ?? {}), [newId]: value } : map
    const sourcePaths = [...current.sourcePaths.slice(0, at), clip.sourcePath, ...current.sourcePaths.slice(at)]
    updateDraft({
      ...withListType(current, sourcePaths, current.additionalAudioTracks),
      clipIds: [...ids.slice(0, at), newId, ...ids.slice(at)],
      clipNumbers: [...numbers.slice(0, at), number, ...numbers.slice(at)],
      trimPoints: withCopy(clip.trimPoints, current.trimPoints),
      sourceFit: withCopy(clip.sourceFit, current.sourceFit),
      sourceCrop: withCopy(clip.sourceCrop, current.sourceCrop),
      sourceSpeed: withCopy(clip.sourceSpeed, current.sourceSpeed),
      sourceFps: withCopy(clip.sourceFps, current.sourceFps),
    })
  }

  /** Duplicates a clip to a place: right after itself, or at the end of the join. */
  const duplicateClipTo = (index: number, position: 'after' | 'end') => {
    const current = latest()
    if (index < 0 || index >= current.sourcePaths.length) return
    insertClipCopy(capturedClipAt(current, index), position === 'after' ? index + 1 : current.sourcePaths.length)
  }

  /**
   * Cuts the selected main-lane clip in two at the skimmer, which is a split of the clip's SOURCE WINDOW.
   *
   * The FIRST half keeps the clip's own id, so every record it carries stays on it; the SECOND is a new clip
   * with an id and a copy number of its own, and the records that describe the clip — its fit, its crop, its
   * speed, its rate and its own sound — are copied onto it, because the two halves ARE the one clip still.
   * The two windows are written explicitly (`[in, at]` and `[at, out]`), so neither half is the whole source
   * and the join reads as one continuous run. A fade at the ORIGINAL clip's tail moves to the second half,
   * since the boundary it fades into is now that half's, and the new interior cut starts with none.
   *
   * The skimmer has to be strictly INSIDE the clip: a cut at either edge is not a cut, and a frame's worth of
   * guard is what keeps one from making an empty half.
   */
  const splitSelectedClip = (): boolean => {
    const sel = selectedRef.current
    const task = draftRef.current
    if (!sel || !task || !model || sel.laneId !== mainLaneIdRef.current) return false
    const lane = model.lanes.find((candidate) => candidate.id === sel.laneId)
    const segment = lane?.segments.find((candidate) => candidate.key === sel.clipKey)
    if (!segment) return false
    const index = materializeClipIds(task).indexOf(sel.clipKey)
    if (index < 0 || index >= task.sourcePaths.length) return false
    const retime = segment.duration > 0 && segment.sourceUsedSeconds > 0 ? segment.sourceUsedSeconds / segment.duration : 1
    const out = segment.sourceIn + segment.sourceUsedSeconds
    const inside = Math.max(0, Math.min(segment.duration, playback.position - segment.start))
    const at = segment.sourceIn + inside * retime
    const min = Math.max(MIN_TRIM_SECONDS, 1 / Math.max(1, rateValue(segment.nativeRate ?? rateOf(30))))
    if (at <= segment.sourceIn + min || at >= out - min) return false
    const oldId = segment.key
    const newId = newClipId()
    const number = nextClipNumber(task, segment.sourcePath)
    const ids = materializeClipIds(task)
    const numbers = materializeClipNumbers(task)
    const sourcePaths = [...task.sourcePaths.slice(0, index + 1), segment.sourcePath, ...task.sourcePaths.slice(index + 1)]
    const withRecord = <T,>(map?: Record<string, T>): Record<string, T> | undefined => {
      const value = map?.[oldId]
      return value === undefined ? map : { ...(map ?? {}), [newId]: value }
    }
    const trimPoints = { ...(task.trimPoints ?? {}) }
    trimPoints[oldId] = { in: segment.sourceIn, out: at }
    trimPoints[newId] = { in: at, out: out }
    const transitions = { ...(task.transitions ?? {}) }
    if (transitions[oldId] !== undefined) { transitions[newId] = transitions[oldId]; delete transitions[oldId] }
    else delete transitions[newId]
    updateDraft({
      ...withListType(task, sourcePaths, task.additionalAudioTracks),
      clipIds: [...ids.slice(0, index + 1), newId, ...ids.slice(index + 1)],
      clipNumbers: [...numbers.slice(0, index + 1), number, ...numbers.slice(index + 1)],
      trimPoints,
      sourceFit: withRecord(task.sourceFit),
      sourceCrop: withRecord(task.sourceCrop),
      sourceSpeed: withRecord(task.sourceSpeed),
      sourceFps: withRecord(task.sourceFps),
      embeddedAudio: withRecord(task.embeddedAudio),
      transitions: Object.keys(transitions).length ? transitions : undefined,
    })
    return true
  }

  /**
   * Takes a clip's trim away, leaving it the whole of its source again.
   *
   * The record IS the decision, so there is nothing to reset to but the absence of one: the key is deleted
   * and the map is left undefined when it becomes empty, exactly as an untouched clip is. Every list, strip
   * and monitor reads that one record, so the clip is back to its full length everywhere at once.
   */
  /**
   * RESET TRIM for the whole selection: every clip in hand goes back to the whole of its source at once.
   *
   * The record IS the decision, so there is nothing to reset to but the absence of one: the keys are deleted
   * and the map is left undefined when it becomes empty, exactly as an untouched clip is.
   */
  const resetTrimSelected = () => {
    const current = latest()
    const keys = multiSelectedRef.current.length ? multiSelectedRef.current : (selectedRef.current ? [selectedRef.current.clipKey] : [])
    if (!keys.length) return
    const next = { ...(current.trimPoints || {}) }
    let changed = false
    keys.forEach((key) => { if (next[key] !== undefined) { delete next[key]; changed = true } })
    if (changed) updateDraft({ trimPoints: Object.keys(next).length ? next : undefined })
  }

  /**
   * Takes the whole SELECTION out of the job: main-lane clips from the source list, added tracks from the
   * track list, each by its own id.
   *
   * The main-lane clips are removed from the END backwards, so an earlier index is still valid as its
   * neighbours go — the same order `withSourceList` uses. A removal that would leave nothing to encode is
   * left to the queue, which owns taking the job away, exactly as a single removal is.
   */
  const removeSelectedClips = (): boolean => {
    const current = draftRef.current
    if (!current) return false
    const keys = multiSelectedRef.current.length ? multiSelectedRef.current : (selectedRef.current ? [selectedRef.current.clipKey] : [])
    if (!keys.length) return false
    const ids = materializeClipIds(current)
    const trackIds = new Set((current.additionalAudioTracks || []).map((track) => track.id))
    const mainIndices = keys.map((key) => ids.indexOf(key)).filter((index) => index >= 0).sort((earlier, later) => later - earlier)
    const chosenTracks = keys.filter((key) => trackIds.has(key))
    let next: QueueTask | null = current
    mainIndices.forEach((index) => { if (next) next = removeSourceFromTask(next, next.sourcePaths[index], index) })
    if (next && chosenTracks.length) {
      const tracks = (next.additionalAudioTracks || []).filter((track) => !chosenTracks.includes(track.id))
      next = { ...next, additionalAudioTracks: tracks.length ? tracks : undefined, type: inferredMode(next.sourcePaths, tracks) }
    }
    if (next) { updateDraft(next); setMultiSelected([]); return true }
    if (mainIndices.length) void window.electronAPI?.removeEditJobSource(current.id, current.sourcePaths[mainIndices[0]], mainIndices[0])
    return true
  }

  /**
   * Moves the whole SELECTED run of main-lane clips to a place in the join, keeping their own order.
   *
   * The clips in hand are lifted out together and put back as one block, so a drag of a group reorders the
   * group rather than the one clip under the pointer; the paths, the ids and the numbers are reordered the
   * same way, so each clip keeps its records and its `COPY n`.
   */
  const moveSelectionTo = (targetIndex: number) => {
    const current = latest()
    const keys = multiSelectedRef.current
    if (keys.length < 2) return
    const ids = materializeClipIds(current)
    const numbers = materializeClipNumbers(current)
    const paths = current.sourcePaths
    const chosen = ids.map((id, index) => ({ id, index })).filter((entry) => keys.includes(entry.id))
    if (chosen.length < 2) return
    const chosenSet = new Set(chosen.map((entry) => entry.index))
    const rest = paths.map((_, index) => index).filter((index) => !chosenSet.has(index))
    const at = Math.max(0, Math.min(targetIndex, rest.length))
    const order = [...rest.slice(0, at), ...chosen.map((entry) => entry.index), ...rest.slice(at)]
    updateDraft({ sourcePaths: order.map((index) => paths[index]), clipIds: order.map((index) => ids[index]), clipNumbers: order.map((index) => numbers[index]) })
  }

  /**
   * Puts a DIFFERENT file in a clip's place, which is a new clip rather than a re-trim of the old one.
   *
   * The place is kept and the file is replaced, so the join reads the same; the clip is given a NEW id and
   * the next copy number for the file that arrived, so none of the old clip's trims, fits, crops, speeds or
   * rates follow a file they were never about. The job-wide fallbacks (records filed against the old PATH)
   * are left where they are, because those are decisions about a source that may still be elsewhere in the
   * job — dropping them here would reach into a different clip.
   */
  const replaceClipAt = async (index: number | null) => {
    if (index == null) return
    const files = await window.electronAPI?.selectFiles()
    if (!files?.length) return
    const current = latest()
    if (index < 0 || index >= current.sourcePaths.length) return
    const sourcePaths = [...current.sourcePaths]
    const ids = materializeClipIds(current)
    const numbers = materializeClipNumbers(current)
    sourcePaths[index] = files[0]
    ids[index] = newClipId()
    numbers[index] = nextClipNumber(current, files[0])
    updateDraft({ ...withListType(current, sourcePaths, current.additionalAudioTracks), clipIds: ids, clipNumbers: numbers })
  }

  /**
   * Opens the clip's REMOVE question for the SELECTED clip, which is what the Delete key asks.
   *
   * The same question the clip's own right-click menu shows, at the clip's own box — one confirmation for
   * both ways of asking, rather than two that say different things. It answers whether it got that far, so a
   * Delete with nothing selected falls through to whatever else the key does.
   */
  const openRemoveConfirm = (): boolean => {
    const sel = selectedRef.current
    const task = draftRef.current
    const keys = multiSelectedRef.current
    if (!task) return false
    // A GROUP removal asks about the selection rather than about one clip, and names how many are going.
    if (keys.length > 1) {
      const row = [...document.querySelectorAll<HTMLElement>('.timeline-clip')].find((node) => node.dataset.clipKey === keys[0])
      const rect = row?.getBoundingClientRect()
      setTimelineMenu({
        kind: 'clip',
        x: rect ? Math.max(8, Math.min(window.innerWidth - 220, rect.left)) : 40,
        y: rect ? Math.min(window.innerHeight - 170, rect.bottom + 6) : 120,
        sourcePath: '', sourceIndex: null, mainIndex: null,
        laneId: sel?.laneId ?? '', segmentIndex: 0, label: `${keys.length} CLIPS`, fitKey: keys[0],
        visual: true, confirming: true, multi: true,
      })
      return true
    }
    if (!sel || sel.laneId !== mainLaneIdRef.current) return false
    const index = materializeClipIds(task).indexOf(sel.clipKey)
    if (index < 0 || index >= task.sourcePaths.length) return false
    const row = [...document.querySelectorAll<HTMLElement>('.timeline-clip')].find((node) => node.dataset.clipKey === sel.clipKey)
    const rect = row?.getBoundingClientRect()
    setTimelineMenu({
      kind: 'clip',
      x: rect ? Math.max(8, Math.min(window.innerWidth - 220, rect.left)) : 40,
      y: rect ? Math.min(window.innerHeight - 170, rect.bottom + 6) : 120,
      sourcePath: task.sourcePaths[index],
      sourceIndex: index,
      mainIndex: index,
      laneId: sel.laneId,
      segmentIndex: index,
      label: sourceName(task.sourcePaths[index]),
      fitKey: sel.clipKey,
      visual: true,
      fitReason: canApplyClipFit(task.preset) ? undefined : 'THIS JOB ENCODES NO PICTURE, SO THERE IS NOTHING TO FIT.',
      confirming: true,
    })
    return true
  }

  /** Takes the selected main-lane clip into the window's clipboard, records and all. */
  const copySelectedClip = (): boolean => {
    const sel = selectedRef.current
    const task = draftRef.current
    if (!sel || !task || sel.laneId !== mainLaneIdRef.current) return false
    const index = materializeClipIds(task).indexOf(sel.clipKey)
    if (index < 0 || index >= task.sourcePaths.length) return false
    setCopiedClip(capturedClipAt(task, index))
    return true
  }

  /**
   * Places the copied clip at the [+] nearest the skimmer, which is the one the paste goes to.
   *
   * The boundaries are the timeline's own [+] markers — the head at zero, every cut, the tail at the end —
   * and the nearest to the playhead wins, so the pasted clip lands where the skimmer is pointing rather than
   * always at one end.
   */
  const pasteCopiedClip = (): boolean => {
    const clip = copiedClipRef.current
    if (!clip) return false
    const lane = model.lanes[0]
    const boundaries = lane ? [0, ...lane.segments.map((segment) => segment.start + segment.duration)] : [0]
    insertClipCopy(clip, nearestInsertPosition(boundaries, playback.position))
    return true
  }

  // The mount-time key handler calls these through refs, so it reaches the LATEST render's closures rather
  // than the ones the window had when the handler was bound.
  openRemoveConfirmRef.current = openRemoveConfirm
  copySelectedClipRef.current = copySelectedClip
  pasteCopiedClipRef.current = pasteCopiedClip
  splitSelectedRef.current = splitSelectedClip

  /**
   * Writes one clip's trim window, dropping the record entirely when the window keeps the whole source.
   *
   * A window that says "everything" is not a decision, so an untouched clip leaves no record behind — the
   * same rule the speed, the fit and the crop follow.
   */
  const writeTrims = (entries: Array<{ key: string; window: TrimWindow; full: number }>) => {
    const next = { ...(latest().trimPoints || {}) }
    entries.forEach(({ key, window, full }) => {
      if (windowIsWholeSource(window, full)) delete next[key]
      else next[key] = { in: window.in, out: window.out }
    })
    updateDraft({ trimPoints: Object.keys(next).length ? next : undefined })
  }

  /**
   * Drags one edge of a clip's source window.
   *
   * The pointer's travel on the TIMELINE is a run of source once it is multiplied by the clip's retime, and
   * the window is worked out from where the drag STARTED rather than step by step, so it cannot drift as the
   * clip reflows under it. The WINDOW is not written until the release — the timeline is a gapless
   * concatenation, so a live write would move the very clip the pointer is trimming, and the drag is one step
   * back either way — but the MONITOR follows the edge being dragged: the source second the cut will land on is
   * turned back into a timeline second by that same retime and the playhead is put there, so the frame the cut
   * lands on is what is on screen while the handle is down.
   */
  const beginTrimDrag = (event: React.PointerEvent, segment: TimelineSegment, edge: 'in' | 'out', lane: TimelineLane) => {
    event.preventDefault()
    event.stopPropagation()
    const retime = segment.duration > 0 && segment.sourceUsedSeconds > 0 ? segment.sourceUsedSeconds / segment.duration : 1
    const min = Math.max(MIN_TRIM_SECONDS, 1 / Math.max(1, rateValue(segment.nativeRate ?? rateOf(30))))
    const pxPerSecond = Math.max(1e-6, laneWidthFor(1, zoom))
    const startX = event.clientX
    const from = trimWindowOf(segment.sourceIn, segment.sourceUsedSeconds)
    const key = segment.key
    // The clip this one is joined to on the side being dragged, and the edge of it the cut meets: the
    // neighbour's LAST frame for an IN handle (its out point), its FIRST for an OUT handle (its in point).
    // Shown beside the cut while the handle is down, so the frame the join lands between is on screen.
    //
    // A SOUND lane gets none of this: the two-up view is about judging a CUT in the picture, and there is no
    // frame at the end of a track to judge one against — the live seek still moves the playhead, so where the
    // audio cut lands is still shown, just not as a picture.
    const laneIndex = lane.segments.findIndex((candidate) => candidate.key === key)
    const neighbour = lane.kind === 'video'
      ? (edge === 'in' ? lane.segments[laneIndex - 1] : lane.segments[laneIndex + 1])
      : undefined
    setTrimNeighbour(neighbour ? {
      side: edge === 'in' ? 'left' : 'right',
      segment: neighbour,
      at: edge === 'in' ? neighbour.sourceIn + neighbour.sourceUsedSeconds : neighbour.sourceIn,
    } : null)
    /** Where on the TIMELINE the dragged edge's source second sits, within the clip as it stands now. */
    const edgePosition = (window: TrimWindow) => {
      const source = edge === 'in' ? window.in : window.out
      const raw = segment.start + (source - segment.sourceIn) / Math.max(1e-6, retime)
      return Math.max(segment.start, Math.min(segment.start + segment.duration - 1e-3, raw))
    }
    trimPreviewRef.current = from
    setTrimDragKey(key)
    setTrimPreview(from)
    // The clips this drag moves TOGETHER: every selected clip that can be trimmed, when more than one is in
    // hand. Each takes the SAME timeline delta on the SAME edge, so a video clip and an audio track trimmed
    // together land their cuts on one instant — the synchronized trim, written in one step.
    const selectedKeys = multiSelected.includes(key) && multiSelected.length > 1 ? multiSelected : [key]
    const members = selectedKeys.map((memberKey) => {
      const member = model?.lanes.flatMap((candidate) => candidate.segments).find((candidate) => candidate.key === memberKey)
      if (!member) return null
      const memberFull = sourceDuration(latest(), member.sourcePath, undefined, resolveTiming)
      if (!(memberFull > 0)) return null
      const memberRetime = member.duration > 0 && member.sourceUsedSeconds > 0 ? member.sourceUsedSeconds / member.duration : 1
      return { key: memberKey, from: trimWindowOf(member.sourceIn, member.sourceUsedSeconds), full: memberFull, retime: memberRetime }
    }).filter((member): member is { key: string; from: TrimWindow; full: number; retime: number } => member !== null)
    const atStart: Record<string, TrimWindow> = {}
    members.forEach((member) => { atStart[member.key] = member.from })
    trimGroupRef.current = atStart
    setTrimGroup({ ...atStart })
    const move = (moveEvent: PointerEvent) => {
      const deltaTimeline = (moveEvent.clientX - startX) / pxPerSecond
      const next: Record<string, TrimWindow> = {}
      members.forEach((member) => { next[member.key] = dragTrimWindow(member.from, edge, deltaTimeline * member.retime, member.full, min) })
      trimPreviewRef.current = next[key]
      trimGroupRef.current = next
      setTrimPreview(next[key])
      setTrimGroup({ ...next })
      playback.seek(edgePosition(next[key]))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const finalPreviews = trimGroupRef.current
      trimPreviewRef.current = null
      trimGroupRef.current = {}
      setTrimDragKey(null)
      setTrimPreview(null)
      setTrimGroup({})
      setTrimNeighbour(null)
      const entries = members.map((member) => ({ key: member.key, window: finalPreviews[member.key], full: member.full })).filter((entry) => Boolean(entry.window))
      if (entries.length) writeTrims(entries)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * Records a source's timing from PROPERTIES: its rate, and for a still the length of
   * the clip made from it.
   *
   * Written to the draft so this window's monitor and timeline update at once, and sent to
   * the queue immediately so its card and its Quick Look helper show the same numbers. The
   * baseline moves with it, otherwise the queue's own confirmation of this change would
   * arrive looking like a conflicting edit from somewhere else.
   */
  const setSourceTiming = (sourcePath: string, override: SourceTimingOverride) => {
    const current = latest()
    const next = withSourceTiming(current, sourcePath, override)
    if (next === current) return
    const nextBaseline = baselineRef.current ? withSourceTiming(baselineRef.current, sourcePath, override) : null
    baselineRef.current = nextBaseline
    draftRef.current = next
    setBaseline(nextBaseline)
    setDraft(next)
    void window.electronAPI?.applySourceTiming(draft.id, sourcePath, override)
  }

  /**
   * Records one clip's speed, from the PROPERTIES inspector.
   *
   * Written to the draft like every other per-clip decision, so the monitor, the strips and the
   * timeline all follow it at once and APPLY is what carries it to the queue. A record that does
   * nothing — the clip's own speed, sampled, pitch kept — is REMOVED rather than stored, which is what
   * keeps an untouched clip off the job's record and its export exactly what it was.
   *
   * The duration and the speed are one relationship and this is the only writer of either: choosing a
   * speed leaves the trim alone and the timeline length follows, and the inspector's DURATION field
   * asks for the same speed worked out backwards from the length the reader typed.
   */
  const setClipSpeed = (sourcePath: string, index: number, next: Partial<ClipSpeed>): void => {
    const current = speedFor(latest(), sourcePath, index)
    const speed = clampClipSpeed(next.speed ?? current.speed)
    const interpolation = (next.interpolation ?? current.interpolation) === 'blending' ? 'blending' : 'sampling'
    const maintainPitch = (next.maintainPitch ?? current.maintainPitch) !== false
    const map = { ...(latest().sourceSpeed ?? {}) }
    const key = clipKey(latest(), sourcePath, index)
    if (speed === 1 && interpolation === 'sampling' && maintainPitch) delete map[key]
    else map[key] = { speed, interpolation, maintainPitch }
    updateDraft({ sourceSpeed: Object.keys(map).length ? map : undefined })
  }

  /**
   * Records one clip's INTERPRETED rate, from the PROPERTIES inspector.
   *
   * The rate the clip's frames are READ at, which is the source's own until a reader gives it another — and
   * giving it another retimes the clip exactly as a speed does, by `fps_clip / native`. A record equal to
   * the source's own does nothing and is REMOVED rather than stored, so a clip left alone stays off the
   * job's record and its export exactly what it was. Written to the draft like every other clip decision,
   * so the monitor, the strips and the timeline all follow it at once and APPLY carries it to the queue.
   */
  const setClipRate = (sourcePath: string, index: number, next: FrameRate | undefined): void => {
    const native = nativeRateFor(latest(), sourcePath, undefined, resolveTiming)
    const map = { ...(latest().sourceFps ?? {}) }
    const key = clipKey(latest(), sourcePath, index)
    if (!next || ratesEqual(next, native)) delete map[key]
    else map[key] = makeRate(next.num, next.den)
    updateDraft({ sourceFps: Object.keys(map).length ? map : undefined })
  }

  /**
   * The lanes that need an element of their own to be heard.
   *
   * Every added track, and — because a job can be nothing but audio — a main lane that IS audio. Such a
   * lane has no picture for the video element to ride on, so its own <audio> is the only thing that can
   * play it. The transport can slave one element to one segment, so a lane of several joined tracks is
   * left out rather than played in part.
   *
   * The same test is made in the transport, which is what drives these elements; the two have to agree,
   * or an element is rendered that nothing plays or played that nothing rendered.
   */
  const audioLanes = model.lanes.filter((lane) => {
    if (!lane.segments.length) return false
    if (!lane.embedded) return true
    return lane.kind === 'audio' && lane.segments.length === 1
  })
  const playable = model.duration > 0
  const stamp = (seconds: number) => timestampMode === 'framestamp' ? frameStamp(seconds, sourceRateValue) : timecode(seconds, sourceRateValue)
  /**
   * What a mark on the scale says.
   *
   * The bare number in framestamp mode: a stamp carries the word FRAME because it is read on its own, and
   * a column of labels all saying it would be nine words too many. The live readout in the gutter is the
   * one that says it, because it is the one that is read on its own.
   */
  const scaleLabel = (seconds: number) => timestampMode === 'framestamp' ? frameNumber(seconds, sourceRateValue) : timecode(seconds, sourceRateValue)
  /** The unit the window is showing lengths in, which is a setting rather than a fact about any clip. */
  const timestampMode: 'framestamp' | 'timestamp' = settings?.timestampDisplayMode === 'framestamp' ? 'framestamp' : 'timestamp'
  const segmentDetail = (segment: TimelineSegment) => {
    const parts = [stamp(segment.duration)]
    // TRIMMED only when the trim takes something away: a clip that uses the whole of its source is the
    // source, and the line inside a clip's box has the same rule as its tooltip does.
    const total = sourceDuration(draft, segment.sourcePath, undefined, resolveTiming)
    if (segment.trimmed && !usesAllSource(segment, total)) parts.push('TRIMMED')
    if (segment.sequence) parts.push(`SEQ ${segment.sequence.frames}F @ ${segment.sequence.fps}FPS`)
    // A still has no rate of its own, so the one it will be rendered at belongs in the
    // clip's own line rather than being left to the monitor to mention.
    if (segment.still) parts.push(`STILL @ ${Math.round(sourceFps(draft, segment.sourcePath, undefined, resolveTiming))}FPS`)
    // The clip's speed and its interpreted rate, where it has either: the line already says the TIMELINE
    // length it takes, and the two figures are what turn the source run into that length. They are told
    // APART — a rate of the clip's own reads `FPS`, and only a speed the reader set reads `SPEED`, whose
    // figure is the retime with the rate divided back out — because `segment.speed` carries both folded in.
    const rateRatio = segment.rate && segment.nativeRate ? rateValue(segment.rate) / Math.max(1e-9, rateValue(segment.nativeRate)) : 1
    if (segment.rate && segment.nativeRate && !ratesEqual(segment.rate, segment.nativeRate)) parts.push(`FPS ${rateLabel(segment.rate)}`)
    const speedSetting = segment.speed / rateRatio
    if (Math.abs(speedSetting - 1) > 1e-9) parts.push(`SPEED ${clipSpeedLabel(speedSetting)}`)
    if (segment.fadeIn) parts.push(`FADE IN ${segment.fadeIn.toFixed(2)}s`)
    if (segment.fadeOut) parts.push(`FADE OUT ${segment.fadeOut.toFixed(2)}s`)
    // What the source's own sound IS, for a clip that is nothing but sound: the line already says how long the
    // clip is, and the facts about the file it came from are the other half of what a reader wants off the
    // same line. A clip with a picture adds nothing here — the strip shows it, and this line is the width of a
    // clip's box.
    const sound = sourceAudio[segment.sourcePath] && !sourceVideo[segment.sourcePath] ? audioFacts(sourceProbes[segment.sourcePath]) : null
    if (sound) parts.push(sound)
    return parts.join(' // ')
  }
  const segmentLabel = (segment: TimelineSegment) => {
    const sequence = draft ? sequenceFor(draft, segment.sourcePath) : undefined
    return sequence ? sequenceLabel(sequence) : sourceName(segment.sourcePath)
  }
  // What a clip's box calls it: `COPY n // name` when the file appears in the job more than once, so two
  // segments of one file are told apart on the timeline rather than only inside the inspector.
  const segmentName = (segment: TimelineSegment) => {
    const copy = draft ? copyLabelFor(draft, clipIndexOf(segment), segment.sourcePath) : undefined
    return copy ? `${copy} // ${segmentLabel(segment)}` : segmentLabel(segment)
  }
  const clipTitle = (segment: TimelineSegment) => `${segmentName(segment)} - ${clipSummary({
    // The SOURCE's whole length, which is what the clip is a piece of — the sequence's own length for
    // an image sequence, the still's chosen length for a still, and the probe's for anything else.
    totalSeconds: sourceDuration(draft, segment.sourcePath, undefined, resolveTiming),
    fps: segment.nativeRate ?? rateOf(sourceFps(draft, segment.sourcePath, undefined, resolveTiming)),
    // What the output takes from the source, which a speed does not change: it is the timeline length
    // that the speed divides, so the range this draws stays the run through the source itself.
    usedSeconds: segment.sourceUsedSeconds,
    sourceIn: segment.sourceIn,
    trimmed: segment.trimmed,
    mode: timestampMode,
  })}`
  /**
   * Where the right-click menu was asked for, and where it ended up.
   *
   * The asked-for point is what the handler knows; the menu's own height is only known once it has
   * been drawn, and it varies with the state it is in, so the placement is worked out in a layout
   * effect from the measured element. Before that the menu is drawn at the pointer, which is where it
   * would be anyway in the common case, so there is nothing to see of the adjustment.
   */
  const menuPoint = (event: React.MouseEvent) => ({ x: event.clientX, y: event.clientY })
  /**
   * Points the editor at a clip: selects it, and brings the playhead onto a clip of the main lane.
   *
   * The window describes ONE clip. The inspector's PROPERTIES, the monitor's own line, its crop box and the
   * FRAMING controls all name the clip under the playhead, so selecting a clip without moving the playhead
   * left them describing whichever clip happened to be playing — which is why a SECOND copy of one file, which
   * is reached by moving to it, could be selected and framed and the framing would land on the first. Bringing
   * the playhead to the clip makes the selected, shown, described and framed clip the same one. A clip the
   * playhead already rests inside does not move it, so selecting the clip being watched disturbs nothing.
   */
  const selectClip = (laneId: string, clipKey: string, shift = false) => {
    const anchor = selectedRef.current
    if (shift && anchor) {
      // ON ONE LANE, Shift takes the whole RUN between the anchor and the clip clicked — the same gesture
      // a list uses. Across lanes there is no run to take, so the clip is added to (or dropped from) the set.
      const lane = model?.lanes.find((candidate) => candidate.id === laneId)
      const from = lane?.segments.findIndex((candidate) => candidate.key === anchor.clipKey) ?? -1
      const to = lane?.segments.findIndex((candidate) => candidate.key === clipKey) ?? -1
      if (lane && anchor.laneId === laneId && from >= 0 && to >= 0) {
        const [lo, hi] = from <= to ? [from, to] : [to, from]
        setMultiSelected(lane.segments.slice(lo, hi + 1).map((candidate) => candidate.key))
        return
      }
      setMultiSelected((current) => current.includes(clipKey) ? current.filter((candidate) => candidate !== clipKey) : [...current, clipKey])
      return
    }
    setSelected({ laneId, clipKey })
    setMultiSelected([clipKey])
    if (laneId !== mainLane?.id) return
    const segment = mainLane?.segments.find((candidate) => candidate.key === clipKey)
    if (!segment) return
    const inside = playback.position >= segment.start && playback.position < segment.start + segment.duration
    if (!inside) playback.seek(segment.start)
  }
  const openClipMenu = (event: React.MouseEvent, segment: TimelineSegment, laneId: string, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    const point = menuPoint(event)
    const mainIndex = laneId === model.lanes[0]?.id ? index : null
    // A right-click SELECTS as well as asks: both items in the menu describe this clip, and the
    // inspector goes on describing it until something else is selected. A right-click on a clip that is
    // ALREADY in a group keeps the group (so REMOVE/RESET can be asked of all of them at once) and only
    // moves the ANCHOR to the clip under the pointer.
    if (multiSelectedRef.current.includes(segment.key)) setSelected({ laneId, clipKey: segment.key })
    else selectClip(laneId, segment.key)
    setTimelineMenu({
      kind: 'clip',
      x: point.x,
      y: point.y,
      // The place in `sourcePaths` this clip owns, taken from the lane when the lane IS the source list. An
      // audio track is not in `sourcePaths` at all, so its clip names no index rather than a wrong one.
      sourceIndex: mainIndex,
      mainIndex,
      // The lane and the place in it, so a menu opened on a clip can name THAT clip: an audio track is
      // not in `sourcePaths` at all, and an index that misses it names the first video instead.
      laneId,
      segmentIndex: index,
      sourcePath: segment.sourcePath,
      label: segmentLabel(segment),
      fitKey: segment.key,
      // A fit places a picture in the frame. Every job with a picture offers it now, not only the ones
      // that concatenate: a single visual's fit is folded into that job's own command, so the choice
      // reaches the export wherever there is an export for it to reach. The jobs that do not encode a
      // picture at all keep the items, disabled and saying why, rather than hiding them — a missing
      // item is indistinguishable from an item the editor forgot.
      visual: model.lanes.find((lane) => lane.id === laneId)?.kind !== 'audio',
      fitReason: canApplyClipFit(draft.preset) ? undefined : 'THIS JOB ENCODES NO PICTURE, SO THERE IS NOTHING TO FIT.',
    })
  }
  const openLaneMenu = (event: React.MouseEvent, laneId: string, label: string) => {
    event.preventDefault()
    event.stopPropagation()
    const point = menuPoint(event)
    setTimelineMenu({ kind: 'lane', x: point.x, y: point.y, laneId, label })
  }
  const duration = model.duration
  /**
   * Where the picture stops, which is the end of the last clip on the visual lane.
   *
   * A multi-track output runs to its longest AUDIBLE track, so past this point the export is the black the
   * encoder pads with — and the monitor shows that rather than holding the last frame its element happens
   * to have decoded, which is not a frame the output contains.
   */
  const pictureEnd = (() => {
    const lane = model.lanes.find((candidate) => candidate.kind === 'video')
    const last = lane?.segments[lane.segments.length - 1]
    return last ? last.start + last.duration : 0
  })()
  /**
   * When the output outlasts its picture, and the black tail therefore applies.
   *
   * A LONE STILL is the exception, and it is the same exception the encoder makes: a single still under a
   * longer track is LOOPED for as long as the track runs, so its output is the whole of it and there is no
   * tail to draw. A still that is one of several visuals is concatenated like any other clip and does get
   * one. A track that is muted is not in the output at all, which is a question the encoder answers, not
   * this.
   */
  const visualLane = model.lanes.find((candidate) => candidate.kind === 'video')
  const loneStill = visualLane?.segments.length === 1 && Boolean(visualLane.segments[0].still)
  const inBlackTail = Boolean(visualLane && !loneStill && pictureEnd > 0 && duration > pictureEnd + 0.01 && playback.position >= pictureEnd - 0.001)

  const showBoundaries = cuts.length > 0
  // A single frame in and a single frame out has nothing to time.
  const stillFrameJob = isStillFrameJob(draft)
  // A single frame out of a source with a timeline of its own is NOT a job with nothing to time: the
  // frame written is the one under the playhead, so the timeline has to stay for the playhead to mean
  // anything. Only a lone still, which has no other frame to choose, gets no timeline.
  const nothingToTimeJob = nothingToTime(draft)
  // The lane the open [+] belongs to, and whether that lane is the job's own source lane. An added audio
  // track is a lane of its own whose single clip is not in `sourcePaths`; its [+] offers ADD SOURCE, but
  // a fade on it is drawn and NOT written by the encoder yet, so the fade items are offered disabled.
  const boundaryLane = openBoundary ? model.lanes.find((lane) => lane.id === openBoundary.laneId) : undefined
  const boundaryIsMainLane = Boolean(boundaryLane && boundaryLane.id === mainLane?.id)
  const selectedBoundary = (() => {
    if (openBoundary == null || !boundaryLane) return null
    const segments = boundaryLane.segments
    // A lane with nothing on it yet: the [+] offers only ADD SOURCE, which is the whole of what there is
    // to decide about an empty lane.
    if (!segments.length) return { kind: 'empty' as const }
    // An edge belongs to the lane rather than to a clip, so it is cut from or to black with
    // only the one clip to fit into: the whole clip, less whatever a boundary at the other end
    // of the same clip is already using. The MAIN lane's edges are the timeline's own; an added
    // track's are its clip's, keyed by that clip so one track's fade is not another's.
    if (openBoundary.at === 'head' || openBoundary.at === 'tail') {
      const clip = openBoundary.at === 'head' ? segments[0] : segments[segments.length - 1]
      if (!clip) return null
      const requested = boundaryIsMainLane ? edgeFade(draft, openBoundary.at) : trackEdgeFade(draft, clip.key, openBoundary.at)
      const neighbour = (openBoundary.at === 'head' ? clip.fadeOut : clip.fadeIn) || 0
      const maxFade = maxEdgeFade(clip.duration, neighbour)
      return { kind: 'edge' as const, edge: openBoundary.at, clipKey: clip.key, requested, fade: Math.min(requested, maxFade), maxFade }
    }
    const index = openBoundary.at
    const first = segments[index]
    const second = segments[index + 1]
    if (!first || !second) return null
    // A cut between SEQUENCED tracks is a place to insert, not a place to fade: the concat graph that joins
    // them writes no cross-fade, so the panel offers ADD SOURCE and says why a fade is not offered.
    if (!boundaryIsMainLane) return { kind: 'track-cut' as const, index }
    const transition = draft.transitions?.[first.key]
    const requested = transition && transition.type === 'fade' && transition.duration > 0 ? transition.duration : 0
    const maxFade = maxFadeAtBoundary(first.duration, second.duration)
    // The request and what will actually render are reported separately. A fade that
    // a neighbour's length currently clamps away still reads as set, instead of
    // looking like the editor had forgotten it.
    return { kind: 'cut' as const, index, source: first.sourcePath, requested, fade: Math.min(requested, maxFade), maxFade }
  })()

  /**
   * The media a segment plays through, as a URL.
   *
   * A sequence frame cannot be handed to a video element, so it plays through the clip that was
   * generated for it; everything else is its own file, handed over without asking anyone.
   */
  const sourceUrlFor = (segment: TimelineSegment | undefined): string | null => {
    const target = pictureSourceFor(segment)
    return target ? mediaUrl(target) : null
  }
  const monitorTarget = pictureSourceFor(playback.segment)
  const elementUrl = monitorTarget ? mediaUrl(monitorTarget) : null
  /**
   * Whether the clip the monitor is showing is sound with no picture.
   *
   * A path is not a picture, and an audio track has no frame to decode: handing its own path to a
   * <video> element is asking that element for a frame out of a file that has none, which is what
   * "Unsupported pixel format: -1" is. Such a clip's waveform is what it IS, so that is what is drawn.
   *
   * The extension answers immediately and the probe answers properly: a file named .wav has no picture
   * whatever it holds, and one named .mp4 might hold nothing but sound.
   */
  const monitorSourcePath = playback.segment?.sourcePath
  const monitorIsAudio = Boolean(monitorSourcePath && (mediaKind(monitorSourcePath) === 'audio' || sourceVideo[monitorSourcePath] === false))
  /**
   * The picture a job with only sound was given, where it was given an image of its own.
   *
   * Read here rather than beside the AUDIO tab's own control because the MONITOR is what shows it, and that is
   * drawn long before those settings are — and it is the same figure the encoder reads off the preset, so what
   * the monitor shows and what the export writes cannot be two different pictures.
   */
  // The picture source is only OFFERED for a job of nothing but sound — see `offersPicture` — so a preset that
  // still says `custom` on a job with footage is a leftover, and the encoder ignores it for the same reason.
  const photoPicture = draft.preset.audioPicture === 'custom' ? draft.preset.audioPictureImage ?? null : null
  /**
   * Whether what the monitor has to DRAW is a picture file rather than footage.
   *
   * Read from the TARGET rather than from what the timeline calls the segment, because the target is
   * what would be decoded and the two can disagree. A segment the timeline counts as footage whose
   * generated clip has not been built resolves to the source itself — and for a still that source is a
   * JPEG, so a <video> was handed an image and reported a pixel format it did not understand. Reading
   * the target closes every such disagreement at once, whichever branch let it happen.
   */
  const monitorShowsImage = Boolean(monitorTarget && mediaKind(monitorTarget) === 'image')

  /**
   * Jumps the playhead to the point that was clicked.
   *
   * Read against the timeline's own rate rather than as a share of the element's width, exactly as
   * the skimmer's drag is. The two disagreed before: a lane stretched to fill a panel wider than the
   * content — which is every timeline at a low zoom — made a share of the width a longer time than
   * the pixel under the pointer stood for, so a click landed nowhere near the clip it was on.
   */
  const seekFraction = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || duration <= 0) return
    const seconds = secondsAt(event.clientX - rect.left, zoom)
    playback.seek(Math.max(0, Math.min(1, seconds / duration)) * duration)
  }

  /**
   * Drags the skimmer.
   *
   * The playhead is a hairline, so it carries a wider transparent grab area of its own; the
   * drag reads its position against the inner timeline, which is the same space the playhead's
   * own `left` is expressed in. That keeps the pointer and the skimmer in step however far the
   * lane has been scrolled or zoomed, since the box is re-read on every move.
   */
  const beginSkimmerDrag = (event: React.PointerEvent) => {
    const inner = timelineInnerRef.current
    if (!inner || duration <= 0) return
    event.preventDefault()
    event.stopPropagation()
    const scrubTo = (clientX: number) => {
      const rect = inner.getBoundingClientRect()
      if (duration <= 0) return
      // Read off the timeline's rate rather than off the rendered width, so a point maps to its time
      // whatever the panel is doing — and a timeline shorter than the panel maps no further than
      // its own end rather than across the empty space beside it.
      const seconds = secondsAt(clientX - rect.left, zoom)
      // A scrub rather than a seek, so a drag that begins while the transport is running stands the
      // auto-advance clock down and takes the playhead itself until the pointer is let go.
      playback.scrub(Math.max(0, Math.min(1, seconds / duration)) * duration)
    }
    const move = (moveEvent: PointerEvent) => scrubTo(moveEvent.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      // The gesture is over the moment the pointer lifts, rather than on a wheel's idle timer: a drag that
      // stopped moving would otherwise keep the transport stood down for the length of the idle gap.
      playback.endScrub()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    scrubTo(event.clientX)
  }

  /**
   * Opens the native trimmer seeded with the source's existing in/out points. The
   * helper reports the filmstrip range back on close, so opening it without the
   * current points would overwrite existing trim with the full source range.
   */
  const openNativePreview = async (target?: { sourcePath: string; sourceIndex: number }) => {
    // A still that becomes a timed clip is opened in the advanced helper as a generated clip, so its
    // filmstrip and trimming behave like real footage. The source is named OUTRIGHT rather than by its
    // place in `sourcePaths`, because an audio track has no place there — and naming one that does not
    // exist resolves to the first video, which is the bug this signature closes.
    const request = await resolveQuickLookRequest(draft, window.electronAPI, {
      sourceIndex: target?.sourceIndex,
      sourcePath: target?.sourcePath,
      preferTimedStill: true,
    })
    if (!request) { setPreviewNotice('NO PREVIEW TARGET FOR THIS SOURCE.'); return }
    setPreviewNotice(request.previewUnavailable
      ? `COULD NOT BUILD A ${Math.round(draft.stillImageDuration || 10)}s CLIP FOR THIS STILL, SO THE FRAME IS SHOWN INSTEAD. THE FFMPEG ERROR IS IN THE LOG.`
      : null)
    // A generated clip belongs to the task, not to this window, so it is reported back
    // immediately rather than waiting to be applied. That is what lets the in/out points
    // that come back when the helper closes be filed against the source the user picked,
    // and what stops the next open building the same footage again.
    if (request.regeneratedPreview) {
      const { sourceTarget, path: previewPath } = request.regeneratedPreview
      void window.electronAPI?.rememberPreview(draft.id, sourceTarget, previewPath)
    }
    // A timed still is not an interpreted sequence, so the request carries no frame grid
    // for it and the helper would fall back to whatever rate the generated file happens
    // to report. Telling it the same rate and the WHOLE clip's length keeps its frame
    // stepping and its trim readout on the editor's own grid.
    //
    // The length must be the clip's, not the trimmed segment's: the helper normalises the
    // in/out handles by whatever total it is given, so a trimmed segment as the total put
    // the out handle at the end of the strip, which read as the clip being only as long as
    // the trim, and pulled the out point earlier on every open and close.
    const clip = playback.segment?.still ? playback.segment : undefined
    const helperFps = request.sequenceFps ?? (clip ? fps : undefined)
    const helperFrames = request.sequenceFrameCount ?? (clip ? Math.max(1, Math.round(stillSecondsFor(draft, clip.sourcePath) * fps)) : undefined)
    void window.electronAPI?.quickLook(request.target, draft.id, request.trimIn, request.trimOut, request.sourceIndex, request.stillMode, settings?.screenshotDirectory, settings?.timestampDisplayMode || 'timestamp', helperFps, helperFrames).then((result) => {
      // A source that had to be played through a proxy and could not be: said out loud rather than shown as a
      // window that opened on nothing.
      if (result?.proxyFailed) setPreviewNotice('COULD NOT BUILD A PREVIEW OF THIS SOURCE, SO NOTHING WAS SHOWN. THE FFMPEG ERROR IS IN THE LOG.')
    })
  }

  const laneGap = (lane: TimelineLane) => Math.max(0, duration - lane.duration)
  const activeSegmentKey = playback.segment?.key
  /**
   * What the monitor's own line says the source is: the shape of a picture, and the facts about the sound
   * where there is no picture.
   *
   * An audio file has no resolution at all, so that line used to read `SOURCE` — three words that describe
   * nothing about the file in hand — where `48 KHZ · 24 BIT · STEREO` is something a reader can act on. The
   * probe is the one this window already made, so nothing here is a second read of any file.
   */
  const focusedProbe = focusedSource ? sourceProbes[focusedSource] : undefined
  const focusedSoundLine = focusedProbe && !focusedProbe.videoStreams?.length ? audioFacts(focusedProbe) : null
  const resolutionLabel = focusedProbe?.videoStreams?.[0]?.resolution
    || draft.sourceInfo?.videoStreams?.[0]?.resolution
    || draft.sourceMetadata?.[focusedSource ?? '']?.resolution
    || (draft.preset.width && draft.preset.height ? `${draft.preset.width}x${draft.preset.height}` : 'SOURCE')

  const dirty = windowDirty(draft, baseline ?? draft)
  // A preset is only worth its name while it still describes the job. Once any of its own
  // fields is edited it no longer does, so it becomes CUSTOM: shown here as soon as an edit
  // lands, and written into the applied patch so the queue's badge agrees. Renaming an output
  // or setting a transition is not an encoding setting, so neither of those makes it custom.
  const presetEdited = JSON.stringify(draft.preset) !== JSON.stringify((baseline ?? draft).preset)
  /** The patch this window would send, built fresh so it never carries a stale snapshot. */
  /**
   * The instant in the SOURCE the playhead is over, which is what a single frame is taken at.
   *
   * The monitor's position is a TIMELINE second, and a clip's trim and speed are what turn one into the
   * other — the mapping `sourceTimeAt` exists for. A frame is written from the SOURCE, so a still taken
   * from a trimmed or sped clip has to be taken where that clip really is inside its file.
   */
  const stillFrameInstant = (): number | undefined => {
    if (draft.preset.imageOutputMode !== 'still') return undefined
    const segment = playback.segment
    if (!segment) return 0
    return Math.max(0, sourceTimeAt(playback.position, {
      start: segment.start, duration: segment.duration, sourceIn: segment.sourceIn, speed: segment.speed,
    }))
  }
  const buildPatch = (): EditJobPatch => {
    const at = stillFrameInstant()
    const preset = presetEdited ? { ...latest().preset, id: 'custom', name: 'CUSTOM' } : latest().preset
    return {
      id: latest().id,
      // A hand-tuned preset stops claiming to be the preset it started from, and a SINGLE FRAME carries
      // the instant it is taken at — stamped here rather than stored on the draft, so a moving playhead
      // is not an edit and does not fill the undo stack with them.
      preset: at === undefined ? preset : { ...preset, stillFrameAt: at },
      outputFilename: latest().outputFilename,
      outputFilenameManuallySet: latest().outputFilenameManuallySet,
      transitions: latest().transitions,
      // The trims, whole: the window owns every clip's window into its source, so an emptied map is a
      // decision about the job rather than a field left out of the patch.
      trimPoints: latest().trimPoints,
      sourceFit: latest().sourceFit,
      sourceCrop: latest().sourceCrop,
      sourceSpeed: latest().sourceSpeed,
      sourceFps: latest().sourceFps,
      mutedLanes: latest().mutedLanes,
      // The clip's own embedded-sound controls, whole like the trims: which streams reach the export, and
      // at what level, is a decision this window owns, so an emptied map is a decision about the job.
      embeddedAudio: latest().embeddedAudio,
      sourceTiming: sourceTimingOverrides(latest()),
      // The tracks' own mode, sent so the ask that decides it in this window reaches the queue; the queue's
      // own switcher writes the same field and pushes it back, so the two never disagree about it.
      comboMode: latest().comboMode,
      // Only when the window changed it: an untouched list is the queue's, and sending the window's
      // snapshot of it back would overwrite a reorder made in the queue while this window was open.
      ...(sourceListMoved(latest(), baselineRef.current ?? latest())
        ? { sourcePaths: latest().sourcePaths, additionalAudioTracks: latest().additionalAudioTracks, clipIds: latest().clipIds, clipNumbers: latest().clipNumbers }
        : {}),
    }
  }
  /**
   * Sends the edits, and closes only when asked to.
   *
   * APPLY keeps the window up so a setting can be changed and looked at again. What was just
   * applied becomes the new baseline either way, so the window stops calling it unsaved and the
   * queue's own confirmation of it is not mistaken for an edit made somewhere else.
   */
  const applyEdits = (close: boolean) => {
    const patch = buildPatch()
    void window.electronAPI?.applyEditJob(patch, close)
    const applied: QueueTask = { ...latest(), preset: patch.preset }
    commit(applied, applied)
  }
  // The picture's own box as drawn in the frame, which is what a crop selects from: the
  // generated frame the encoder writes may be a different shape, and a crop is of the source, not
  // of the canvas it is fitted to. Its pixel size is also what turns the crop's fractions into the
  // pixel figures the fields show when the unit is switched to px.
  const picture = naturalSize && naturalSize.key === playback.segment?.sourcePath ? naturalSize : undefined
  const naturalAspect = picture ? picture.width / picture.height : null
  /** The clip being shown, and the fit it carries, which is what places it in the frame. */
  const activeFitKey = playback.segment ? playback.segment.key : null
  const activeClipKey = activeFitKey
  /** Whether framing is per clip in this job, which is where a job's visuals are concatenated. */
  const perClipFraming = clipsConcatenate(draft)
  const activeSourceCrop = activeClipKey ? draft.sourceCrop?.[activeClipKey] : undefined
  const activeFit = activeFitKey && draft ? draft.sourceFit?.[activeFitKey] : undefined
  /** The margins the shown clip carries, which are the box its fit scales it into. */
  const activeInsets = insetsOf(activeFit)
  /** The crop the preset applies. Its edges are fractions of the picture, which is what makes them
   *  survive a resize; the pixel figures the fields show are read off `picture` just above. */
  const crop = perClipFraming && activeSourceCrop ? cropFractionsOf(activeSourceCrop) : draft.preset.crop
  // The crop's own pixel figures, read off the picture just above: the four fields show these when the
  // FRAMING switch is on px, and they are the source's pixels rather than the frame's.
  const cropPx = crop && picture ? cropPixels(crop, picture) : null
  /** The proportion list's value: no shape held, a shape the crop keeps, or the user's own. */
  const keptProportion = crop && naturalAspect ? keptAspect(crop, naturalAspect) : undefined
  const matchedProportion = keptProportion != null
    ? ASPECTS.find((candidate) => Math.abs(candidate.ratio - keptProportion) < ASPECT_TOLERANCE)?.label
    : undefined
  /**
   * Which entry the shape list is showing.
   *
   * A CHOICE rather than a reading of the region: FREEFORM says "no shape is being held", and that is
   * something the user says, not something the numbers can be interrogated for — a region that
   * happens to keep 16:9 looks exactly like one that was shaped to 16:9. The choice is held against
   * the clip being edited, so it starts from that clip's own region and does not follow the user from
   * one clip to the next.
   */
  const shapeKey = activeClipKey ?? ''
  const cropShape = !hasCrop(crop) ? NO_CROP : (cropShapeChoice?.key === shapeKey ? cropShapeChoice.value : matchedProportion ?? FREEFORM)
  /** The shape a corner drag holds: the chosen proportion, or nothing to hold the region's own. */
  const cropProportionRatio = ASPECTS.find((candidate) => candidate.label === cropShape)?.ratio
  // Whether the crop removes anything at all, which is what the switch reports. A crop of nothing
  // is a crop switched off, so zeroing the last figure unchecks the control; the record itself may
  // still exist, because for a clip in a job that has a crop of its own an entry is how a clip says
  // "none for me" (see setCrop) rather than "let the job's stand".
  const cropEnabled = hasCrop(crop)
  /** The output frame's shape, which is what the lock holds the crop to. Absent until it is known. */
  const lockRatio = draft.preset.cropLockToOutput && outputFrame ? outputFrame.width / outputFrame.height : undefined
  /** Writes a crop through to whichever record the controls are editing, with no reshaping. */
  const writeCrop = (next: CropFractions) => {
    if (perClipFraming && activeClipKey) {
      // Written even when it keeps the whole clip, because that is how a clip says "no crop" where
      // the job has one: an absent entry means *the job's crop stands*, not *nothing is cropped*.
      updateDraft({ sourceCrop: { ...(latest().sourceCrop ?? {}), [activeClipKey]: sourceCropOf(next) } })
      return
    }
    updatePreset({ crop: next })
  }
  /**
   * Sets the crop the controls are editing.
   *
   * Where a job's visuals are concatenated that is the CLIP's own crop, stored against it so it
   * follows the clip through a reorder; everywhere else it is the job's, which is the only crop a
   * single-visual job has. The two are the same controls and the same numbers, so the monitor's crop
   * box, the fields and the handles cannot disagree about which one is being edited.
   *
   * Every control that can change the region's SHAPE holds the output's shape itself while the lock
   * is on; this is the plain writer for the ones that cannot break it (a move) and the ones that are
   * handed a shape already (the lock's own click).
   */
  const setCrop = (next: CropFractions) => writeCrop(clampCrop(next))
  /**
   * The crop the switch turns on: a tenth off each axis, so it is there to be seen and dragged.
   * While the lock is on it is that same inset of the output's own shape, so switching the crop on
   * with the lock already set cannot produce a region the lock would immediately contradict.
   */
  const enableCrop = () => writeCrop(insetCrop(lockRatio && naturalAspect ? cropForProportion(naturalAspect, lockRatio) : { left: 0, top: 0, right: 0, bottom: 0 }, 0.8))
  /** Takes the crop away: nothing of the job's is left to stand in for this clip's. */
  const clearCrop = () => {
    if (perClipFraming && activeClipKey) {
      updateDraft({ sourceCrop: { ...(latest().sourceCrop ?? {}), [activeClipKey]: { x: 0, y: 0, w: 1, h: 1 } } })
      return
    }
    updatePreset({ crop: undefined })
  }
  /**
   * The lock's own click, which brings the clip being looked at into line at once: the preview then
   * shows what the lock is for, and every other clip conforms when it is next edited rather than
   * being rewritten behind the user's back.
   */
  const setCropLock = (locked: boolean) => {
    updatePreset({ cropLockToOutput: locked || undefined })
    if (!locked) return
    const ratio = outputFrame ? outputFrame.width / outputFrame.height : undefined
    if (ratio && naturalAspect) writeCrop(cropForProportion(naturalAspect, ratio))
  }
  /** Puts the crop being edited on every clip, which is what a job cropped as a whole wants. */
  const applyCropToAll = () => {
    const region = sourceCropOf(crop ?? { left: 0, top: 0, right: 0, bottom: 0 })
    const map: Record<string, SourceCrop> = {}
    draft.sourcePaths.forEach((sourcePath, index) => {
      if (mediaKind(sourcePath) !== 'audio') map[clipIdAt(draft, index)] = region
    })
    updateDraft({ sourceCrop: Object.keys(map).length ? map : undefined })
  }
  /**
   * Sets one crop edge from its field, in the unit the FRAMING section is currently showing.
   *
   * The switch is the section's, and its two readings are honest about different rectangles: per cent
   * means a share of the SOURCE for these four figures and a share of the OUTPUT FRAME for the insets
   * and the offset below, and so does a pixel — the figures are always stored as fractions either way,
   * so the switch changes only how a field is read and written. One edge moves at a time: the other
   * three are already settled, so only the edited one changes and the rest survive the unit's inverse.
   * While the lock is on, the axis that was NOT typed follows from the one that was, so the figure in
   * the field stays the one the user set and the region is nonetheless the output's shape.
   */
  const setCropEdge = (edge: keyof CropFractions, raw: number) => {
    if (!crop) return
    const next = framingUnit === 'px'
      ? (cropPx && picture ? cropFractions({ ...cropPx, [edge]: Math.max(0, Math.round(raw)) }, picture) : null)
      : { ...crop, [edge]: Math.max(0, Math.min(1, raw / 100)) }
    if (!next) return
    if (lockRatio && naturalAspect) { writeCrop(holdCropShape(next, lockRatio, naturalAspect, edge === 'left' || edge === 'right' ? 'width' : 'height')); return }
    setCrop(next)
  }
  /**
   * Sets the shape list: FREEFORM holds no shape at all and leaves the region where it is, and a
   * named shape centres the crop on it. Clearing the crop is the switch's business, not the list's.
   */
  const applyCropProportion = (label: string) => {
    // NONE is the way the crop is switched off now: the switch that used to do it is gone, and the
    // question it asked with it, because picking NONE is already the answer to that question.
    if (label === NO_CROP) {
      setCropShapeChoice(null)
      clearCrop()
      return
    }
    // FREEFORM on a clip with no crop has to MAKE one, or choosing it would do nothing at all: it is a
    // shape, and the switch that used to create the region is gone.
    if (label === FREEFORM && !hasCrop(crop)) {
      setCropShapeChoice({ key: shapeKey, value: label })
      enableCrop()
      return
    }
    setCropShapeChoice({ key: shapeKey, value: label })
    const option = ASPECTS.find((candidate) => candidate.label === label)
    if (!option || !naturalAspect) return
    setCrop(cropForProportion(naturalAspect, option.ratio))
  }
  /**
   * Runs a crop drag, and says so for as long as it lasts.
   *
   * Every crop gesture is the same shape — a move handler and an up handler on the window — so the
   * shade's lifting and settling is written once here rather than three times in the handlers, where it
   * would be three chances to forget the settling half.
   */
  const trackCropDrag = (move: (event: PointerEvent) => void) => {
    setCropDragging(true)
    // Three handlers funnel through here, which is why the gesture is opened and closed once, here,
    // rather than in each of them: one drag is one step back, whichever handle ran it.
    beginGesture()
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setCropDragging(false)
      finishGesture()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  /**
   * Drags one edge of the crop box. The pointer position is turned into a fraction of the
   * picture, which is the space the crop is stored in, so the same drag works whatever the
   * window size.
   */
  const beginCropDrag = (edge: 'left' | 'top' | 'right' | 'bottom', event: React.PointerEvent) => {
    if (!crop || !cropRect) return
    event.preventDefault()
    event.stopPropagation()
    const stage = stageRef.current?.getBoundingClientRect()
    if (!stage) return
    const horizontal = edge === 'left' || edge === 'right'
    // The two leading edges are measured from the picture's own origin; the two trailing ones
    // are stored as the distance in from the FAR edge. Reading a trailing edge as a leading one
    // is what made the right and bottom handles run backwards, slamming the crop to its limit on
    // the first twitch of the pointer and then having to be dragged the opposite way to undo it.
    const trailing = edge === 'right' || edge === 'bottom'
    const size = horizontal ? cropRect.box.width : cropRect.box.height
    // The picture's origin as it is DRAWN, which is where it sits inside the stage plus however
    // far the pan has moved it. Without the pan a crop dragged while zoomed in would read the
    // pointer against a picture that is no longer under it.
    const origin = (horizontal ? cropRect.originX : cropRect.originY) + (horizontal ? panRef.current.x : panRef.current.y)
    const coordinate = (moveEvent: PointerEvent) => (horizontal ? moveEvent.clientX - stage.left : moveEvent.clientY - stage.top)
    const move = (moveEvent: PointerEvent) => {
      const position = (coordinate(moveEvent) - origin) / Math.max(1, size)
      const value = Math.max(0, Math.min(1, trailing ? 1 - position : position))
      const next = { ...crop, [edge]: value }
      // An edge drag is the one gesture that changes a single axis by nature, so under the lock the
      // other axis is what follows: the edge stays under the pointer and the shape is still kept.
      if (lockRatio && naturalAspect) { writeCrop(holdCropShape(next, lockRatio, naturalAspect, horizontal ? 'width' : 'height')); return }
      setCrop(next)
    }
    trackCropDrag(move)
  }
  /**
   * Slides the whole crop box, which is what the move cursor over it invites. The pointer's
   * travel is read as a fraction of the picture, so the box keeps up with the cursor exactly
   * rather than drifting with the window size.
   */
  const beginCropMove = (event: React.PointerEvent) => {
    if (!crop || !cropRect) return
    event.preventDefault()
    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY }
    const from = crop
    const move = (moveEvent: PointerEvent) => {
      // A move changes no edge's size, so a shape being held is not at stake here: it goes through
      // the plain writer rather than the one that would re-shape it.
      writeCrop(clampCrop(shiftCrop(
        from,
        (moveEvent.clientX - start.x) / Math.max(1, cropRect.box.width),
        (moveEvent.clientY - start.y) / Math.max(1, cropRect.box.height),
      )))
    }
    trackCropDrag(move)
  }
  /**
   * Resizes from a corner, holding the shape chosen in the proportion list, or the region's own
   * shape when the list is on FREEFORM. The corner opposite the one dragged stays put.
   */
  const beginCropCorner = (corner: CropCorner, event: React.PointerEvent) => {
    if (!crop || !picture || !cropRect) return
    event.preventDefault()
    event.stopPropagation()
    const stage = stageRef.current?.getBoundingClientRect()
    if (!stage) return
    const from = crop
    // The lock's own shape takes precedence over the list's, since it is the constraint the user
    // asked for explicitly; without it the list's chosen shape is held.
    const ratio = lockRatio ?? cropProportionRatio
    // FREEFORM in the list means no shape is being held at all, so the corner is free. A locked crop is
    // never free: the whole point of the lock is that the corner keeps the output's proportions.
    const free = !lockRatio && cropShape === FREEFORM
    const move = (moveEvent: PointerEvent) => {
      writeCrop(clampCrop(resizeCorner({
        crop: from,
        picture,
        corner,
        ratio,
        free,
        point: {
          x: (moveEvent.clientX - stage.left - cropRect.originX - panRef.current.x) / Math.max(1, cropRect.box.width),
          y: (moveEvent.clientY - stage.top - cropRect.originY - panRef.current.y) / Math.max(1, cropRect.box.height),
        },
      })))
  }
  trackCropDrag(move)
}
  // The frame the encoder will produce was worked out above, where the hooks that lay the strips
  // out could see it; this is the box to outline it in, centred in the stage by the stylesheet too.
  const frameRect = outputFrame && stageSize ? zoomedRaster(outputFrame, previewZoom, stageSize) : null
  const frameOrigin = frameRect && stageSize
    ? { x: (stageSize.width - frameRect.width) / 2, y: (stageSize.height - frameRect.height) / 2 }
    : null
  /**
   * Where the clip sits inside the outlined frame.
   *
   * The monitor is showing the assembled output, so the picture is drawn where the encoder will
   * put it: the axis a fit pins is exact, what overflows it is cropped at the offset, and what
   * falls short is left as the frame's own background. The crop comes first, so it is the KEPT
   * region that is fitted and the whole source that is drawn around it — the removed part stays
   * visible past the frame, which is what keeps the crop box expandable.
   *
   * Until the frame's size is known — which needs the media loaded — the picture is simply centred
   * at the monitor's zoom.
   */
  const placed = picture && outputFrame ? placedSource({ source: picture, frame: outputFrame, crop, fit: activeFit }) : null
  const placement = placed?.placement ?? null
  const pictureBox = (() => {
    if (!picture || !stageSize) return null
    if (placed && frameRect && frameOrigin && outputFrame) {
      const scale = frameRect.width / Math.max(1, outputFrame.width)
      return {
        left: frameOrigin.x + placed.source.x * scale,
        top: frameOrigin.y + placed.source.y * scale,
        width: placed.source.width * scale,
        height: placed.source.height * scale,
      }
    }
    const size = zoomedRaster(picture, previewZoom, stageSize)
    return size ? { left: (stageSize.width - size.width) / 2, top: (stageSize.height - size.height) / 2, width: size.width, height: size.height } : null
  })()
  // Given its own box rather than stretched to the panel, so the crop box and the picture agree
  // exactly. Anchored rather than centred, because a fitted clip is not centred: the offset is
  // what decides where it goes, and this is where the encoder will put it. The figures are taken
  // against the frame's own corner, since the picture is drawn inside the frame's window.
  const mediaStyle = pictureBox && frameOrigin
    ? { position: 'absolute' as const, left: pictureBox.left - frameOrigin.x, top: pictureBox.top - frameOrigin.y, width: pictureBox.width, height: pictureBox.height, maxWidth: 'none' as const, maxHeight: 'none' as const }
    : null
  // What the crop removes, as bands rather than one huge spread shadow, so the output frame outline
  // and the parts of the stage the crop does not own stay readable.
  const cropRect = (() => {
    if (!crop || !pictureBox) return null
    // The picture's own box as drawn, which a fitted clip has moved inside the frame: reading it
    // from the drawing rather than from the centre is what keeps the crop box on the picture.
    const originX = pictureBox.left
    const originY = pictureBox.top
    return {
      left: originX + pictureBox.width * crop.left,
      top: originY + pictureBox.height * crop.top,
      width: pictureBox.width * (1 - crop.left - crop.right),
      height: pictureBox.height * (1 - crop.top - crop.bottom),
      box: { width: pictureBox.width, height: pictureBox.height },
      originX,
      originY,
    }
  })()
  const cropShade = cropRect
    ? cropBands(
      { left: cropRect.originX, top: cropRect.originY, width: cropRect.box.width, height: cropRect.box.height },
      { left: cropRect.left, top: cropRect.top, width: cropRect.width, height: cropRect.height },
    )
    : []
  /**
   * Whether the picture can be dragged around the canvas at all.
   *
   * It can whenever there is a picture and a canvas to place it on, which is every visual clip — the
   * position is a decision of its own now, not a leftover of a fit, so a clip that has no fit can
   * still be placed. What it writes is what makes it real: a position, and the fit's scale left alone.
   */
  const canPlacePicture = Boolean(activeFitKey && placement && frameRect && outputFrame)
  /**
   * Where the picture sits, as the output frame's own fractions.
   *
   * Read from the PLACEMENT rather than from the record, so a job written by the older single-axis
   * model reads as the position its pan really amounts to; dragging it then writes that position back
   * as a pair, which is how such a record turns into one of these.
   */
  const pictureOffset = placement && outputFrame ? fitOffsetWithin(activeFit, placement.size, outputFrame) : DEFAULT_FIT_OFFSET
  /**
   * The inner box the insets leave, in the monitor's own pixels.
   *
   * Scaled from the output frame's box as it is DRAWN rather than from the stage, so the box keeps its
   * place when the preview is zoomed or panned — it is a box on the frame, and it moves with it. It is
   * drawn so that the margins read as the background they are, and so that the box the picture is being
   * sized into can be seen while it is being set.
   */
  const insetBox = frameRect && frameOrigin && outputFrame
    ? (() => {
      const box = innerBox(outputFrame, activeInsets)
      const scaleX = frameRect.width / outputFrame.width
      const scaleY = frameRect.height / outputFrame.height
      return {
        left: frameOrigin.x + box.x * scaleX,
        top: frameOrigin.y + box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
      }
    })()
    : null
  /**
   * The waveform the monitor draws when the clip it is showing is sound rather than a picture.
   *
   * On the helper's own rules and over the clip's own trim — the same drawing the lane makes, at the
   * size of the output frame. It needs the frame's box, which is why it is worked out here beside it
   * rather than with the media URL: a <video> for a clip with no picture is exactly what is avoided.
   */
  const monitorWaveform = (() => {
    const segment = playback.segment
    if (!segment || !monitorIsAudio || !frameRect) return null
    const peaks = waveforms[segment.sourcePath]
    const total = sourceDuration(draft, segment.sourcePath, undefined, resolveTiming)
    const shown = peaks && peaks.length
      ? peaksForTrim(peaks, segment.sourceIn, segment.sourceIn + segment.duration, total)
      : []
    return { peaks: shown, width: Math.max(1, frameRect.width), height: Math.max(1, frameRect.height) }
  })()

  /** What the window says when there is nothing to draw in it yet. */
  const screenMessage = duration > 0 ? 'PREPARING THIS SEGMENT...' : 'NO PLAYABLE MEDIA'

  /**
   * What the monitor is drawing, as one box, and how far it can be moved inside the panel.
   *
   * The picture and the output frame outline can disagree in size, so the larger of the two is
   * what has to be reachable: a pan that could not reach the outline's edge would hide the very
   * thing the outline is there to show.
   */
  const drawnSize = {
    width: Math.max(pictureBox?.width ?? 0, frameRect?.width ?? 0),
    height: Math.max(pictureBox?.height ?? 0, frameRect?.height ?? 0),
  }
  const drawable = stageSize && panSlack(drawnSize.width, stageSize.width) + panSlack(drawnSize.height, stageSize.height) > 0
  const panX = stageSize ? clampPan(pan.x, drawnSize.width, stageSize.width) : 0
  const panY = stageSize ? clampPan(pan.y, drawnSize.height, stageSize.height) : 0
  // The pan the drag handlers need. A crop's edges are stored as fractions of the picture, so a
  // drag has to know where the picture is being drawn before it can turn a pointer into one.
  panRef.current = { x: panX, y: panY }

  /**
   * Drags the drawing around inside the monitor, when there is drawing to spare.
   *
   * View only: it moves the pixels inside the panel and reaches nothing else, so the export and
   * every clip's own fit stay exactly where they were. A press that never travels is left to
   * whatever it landed on, so the media still toggles playback on a plain click, and a press on
   * the crop box belongs to the crop.
   */
  const beginPan = (event: React.PointerEvent) => {
    const target = event.target as Element | null
    if (target?.closest('.editor-crop') || !drawable || !stageSize) return
    const start = { x: event.clientX, y: event.clientY }
    const from = { x: panX, y: panY }
    let moved = false
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x
      const dy = moveEvent.clientY - start.y
      // Three pixels of travel before anything moves: below that the press is a click, and the
      // media's own play toggle is waiting for it.
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      moved = true
      setPan({
        x: clampPan(from.x + dx, drawnSize.width, stageSize.width),
        y: clampPan(from.y + dy, drawnSize.height, stageSize.height),
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) pannedAtRef.current = Date.now()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  /** A plain click on the media still plays and pauses; the click a drag ends with does not. */
  const toggleFromClick = () => {
    if (Date.now() - pannedAtRef.current < 250) return
    playback.toggle()
  }

  /**
   * Moves the picture on the canvas, which is what the dragger is for.
   *
   * The travel is read against the frame as it is DRAWN, so the picture keeps up with the pointer
   * rather than drifting with the monitor's zoom, and it is written as a fraction of the frame, so the
   * same drag means the same thing whatever the output resolution. Nothing is clamped: a picture may
   * be moved until it is off the canvas, where the background shows, and a clamp would be the old
   * model's assumption that the frame must always be covered creeping back in. It is written to the
   * draft, so APPLY sends it, and the thumbnails follow it — the export follows it too, which is the
   * point of it not being view-only like the pan beside it.
   */
  const beginFitDrag = (event: React.PointerEvent) => {
    if (!canPlacePicture || !placement || !frameRect || !outputFrame || !activeFitKey) return
    // The whole drag is one step back, however many moves it takes to make it.
    beginGesture()
    const start = { x: event.clientX, y: event.clientY }
    const from = pictureOffset
    const mode = activeFit?.mode ?? 'contain'
    const insets = insetsOf(activeFit)
    let moved = false
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x
      const dy = moveEvent.clientY - start.y
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      moved = true
      updateDraft({
        sourceFit: {
          ...(latest().sourceFit ?? {}),
          [activeFitKey]: {
            mode,
            offset: { x: from.x + dx / Math.max(1, frameRect.width), y: from.y + dy / Math.max(1, frameRect.height) },
            // Carried over: dragging moves the picture, and the box it is sized into is the other
            // control's business. A drag must not quietly undo a margin.
            ...(hasInsets(insets) ? { insets } : {}),
          },
        },
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) pannedAtRef.current = Date.now()
      finishGesture()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * A drag in the monitor means one of two things, and what it is over decides which.
   *
   * On the picture it places the clip on the canvas — the gesture the position is for, and the one the
   * export follows. Anywhere else, when the view is larger than the panel, it pans the view, which
   * nothing but the monitor follows. A press on the crop box belongs to the crop in either case, and a
   * press that never travels is left to whatever it landed on, so the media still toggles playback on
   * a plain click.
   */
  const beginMonitorDrag = (event: React.PointerEvent) => {
    const target = event.target as Element | null
    if (target?.closest('.editor-crop')) return
    if (canPlacePicture && target?.closest('.editor-video, .editor-still, .editor-frame, .editor-crop-shade')) return beginFitDrag(event)
    beginPan(event)
  }

  /** The zoom list: the named scales, the three fits, and the user's own figure. */
  const zoomOption = zoomCustom
    ? 'custom'
    : previewZoom.kind === 'percent'
      ? (isPresetZoom(previewZoom.percent) ? String(previewZoom.percent) : 'custom')
      : previewZoom.kind
  const chooseZoom = (option: string) => {
    if (option === 'fit' || option === 'fitWidth' || option === 'fitHeight') {
      setZoomCustom(false)
      setPreviewZoom({ kind: option })
      return
    }
    if (option === 'custom') {
      // Opens on the zoom already in force, so the field starts from what is on screen.
      const percent = previewZoom.kind === 'percent' ? previewZoom.percent : 100
      setZoomCustom(true)
      setZoomText(String(percent))
      setPreviewZoom({ kind: 'percent', percent })
      return
    }
    setZoomCustom(false)
    setPreviewZoom({ kind: 'percent', percent: Number(option) })
  }
  const typeZoom = (text: string) => {
    setZoomText(text)
    const typed = Number(text)
    // A half-typed figure is not a zoom: "1" on the way to "137" is not one per cent.
    if (text.trim() === '' || !Number.isFinite(typed) || typed < MIN_PREVIEW_ZOOM) return
    setPreviewZoom({ kind: 'percent', percent: clampPreviewZoom(typed) })
  }
  // The exact-size fields. Empty means "not overridden": the placeholder shows the frame the
  // encoder is already writing, and editing either edge pins the pair to that starting point.
  const exactSize = exactSizeFields({ width: draft.preset.width, height: draft.preset.height }, outputFrame)
  const exactSet = Boolean(draft.preset.width && draft.preset.height)
  const setExactEdge = (edge: 'width' | 'height', value: number) => {
    if (!exactSize || !Number.isFinite(value) || value <= 0) return
    const next = resizeExact(exactSize, edge, value, lockProportion)
    updatePreset({ width: next.width, height: next.height })
  }
  const clearExactSize = () => updatePreset({ width: undefined, height: undefined })
  const container = draft.preset.container
  const audioOnly = AUDIO_CONTAINERS.includes(container)
  const isImageContainer = IMAGE_CONTAINERS.includes(container)
  const isGif = container === 'gif'
  // A container that carries a picture and no sound: a still, or the animated one. Nothing may be written
  // into it as a sound, so the export's audio toggle is drawn off and cannot be moved.
  const soundNeverPossible = PICTURE_CONTAINERS.includes(container)
  // A container whose output may be one file or a numbered run of frames, which is the choice IMAGE
  // OUTPUT makes. The animated one is in it: a GIF is one animation or a sequence of single frames.
  const framesPossible = FRAME_CONTAINERS.includes(container)
  // The tabs the window is SHOWING: IMAGE is offered only where the format writes frames at all, so a
  // movie container does not carry a tab whose every control would be about a picture nobody asked for.
  // The ACTIVE tab is what still applies, so changing the format away from an image one while IMAGE is
  // open falls back to EXPORT rather than leaving a tab whose controls are gone.
  const tabsShown = tabs.filter((name) => name !== 'IMAGE' || framesPossible)
  const activeTab: Tab = tabsShown.includes(tab) ? tab : 'EXPORT'
  const audioDisabled = soundNeverPossible
  const videoReason = audioOnly ? 'THIS CONTAINER CARRIES AUDIO ONLY.' : isGif ? 'GIF OUTPUT FORCES THE GIF ENCODER AND DROPS AUDIO.' : undefined
  const audioReason = audioOnly ? undefined : soundNeverPossible ? 'THIS FORMAT CARRIES NO AUDIO TRACK.' : undefined
  /**
   * Which of the two streams is switched off, and — because a file with neither in it is nothing — which
   * of them is therefore held on. Unchecking the picture makes the job a sound-only one, so the sound is
   * forced back on; unchecking the sound leaves the picture, and locks it there.
   */
  const streamOff = {
    video: !audioOnly && !soundNeverPossible && draft.preset.outputMode === 'audio',
    audio: !audioOnly && !soundNeverPossible && draft.preset.audioEnabled === false,
  }
  /**
   * What the job's own sources are made of, which is what decides whether a picture has to be supplied
   * for it at all.
   *
   * A job with any footage keeps its own picture, and a job whose visuals are an interpreted sequence is
   * footage too — its frames ARE the picture, however still each one is on its own. What is left is a job
   * of sound, or of a still with sound beside it, and that is the only kind these settings are about.
   */
  const visuals = draft.sourcePaths.map(mediaKind)
  const hasFootage = taskHasFootage(draft)
  const hasStill = visuals.includes('image')
  const jobSound = visuals.includes('audio') || Boolean(draft.additionalAudioTracks?.length)
  /**
   * Whether the EXPORT writes a sound, which is a different question from whether the source IS sound.
   *
   * A video carries an audio stream of its own, so a job extracting it — an MP4 or a MOV into an MP3, which
   * is what VID2AUD means — writes a sound whatever the source's own kind is. Reading this off the sources'
   * KINDS left every one of those estimates with nothing to size and no reason to size it, which is why
   * they all said UNKNOWN. The probe is the one this window already made. It is true for an added track as
   * well, which a still with sound beside it has and a bare picture does not.
   */
  const exportHasSound = Boolean(draft.additionalAudioTracks?.length) || draft.sourcePaths.some((source) => probeHasAudio(sourceProbes[source]))
  // The gate and the drawing both come from the one function the monitor reads too, so a job cannot be
  // shown one picture and given another.
  const offersPicture = drawingPicture.offersPicture || (jobSound && outputCarriesPicture(container) && !isImageContainer && !isGif && draft.preset.outputMode !== 'audio' && !hasFootage)
  /** What the export would show: what was chosen, or the job's own default of its still and then black. */
  const pictureSource = draft.preset.audioPicture ?? (hasStill ? 'still' : 'black')
  const artCoverOffered = outputTakesArt(container) && hasStill && !hasFootage
  const stillIntoWav = container === 'wav' && hasStill
  /**
   * What the finished file is going to weigh, in the range the question has an answer in.
   *
   * The PICTURE is sized from the OUTPUT frame and the assembled length — never from a source's own
   * dimensions or codec, because the source is re-encoded into one raster however many clips it took. A
   * single frame is ONE frame rather than the timeline's own length, which is what makes the figure differ
   * between SINGLE FRAME and a run. A fixed-rate encoder gets a tight estimate, PCM an exact one, and the
   * content-dependent encoders a range the SUMMARY draws as one. See `outputSize`.
   */
  const estimate = estimateOutputSize({
    seconds: duration,
    frames: stillFrameJob ? 1 : framesFrom(duration, rateValue(outputRate)),
    picture: !audioOnly && draft.preset.outputMode !== 'audio',
    sound: exportHasSound && !soundNeverPossible && draft.preset.audioEnabled !== false,
    videoCodec: draft.preset.videoCodec,
    videoBitrate: draft.preset.videoBitrate,
    proresProfile: draft.preset.proresProfile,
    width: outputFrame?.width ?? draft.preset.width,
    height: outputFrame?.height ?? draft.preset.height,
    fps: rateValue(outputRate),
    bitDepth: draft.preset.imageBitDepth,
    pngCompression: draft.preset.pngCompression,
    jpegQuality: draft.preset.jpegQuality,
    audioCodec: draft.preset.audioCodec,
    audioBitrate: draft.preset.audioBitrate,
    audioChannels: draft.preset.audioChannels,
    audioSampleRate: draft.preset.audioSampleRate,
    audioBitDepth: draft.preset.audioBitDepth,
    // A numbered run of image files has no container around it to pay a muxer's per cent to.
    containerized: !IMAGE_CONTAINERS.includes(container) && !(isGif && draft.preset.imageOutputMode === 'sequence'),
  })
  /** The drawing's own background, as the one choice the editor and the encoder share. */
  const backgroundKind = visualizationBackgroundKind(draft.preset)
  /**
   * The sound the AUDIO tab is about: the one under the playhead where that is a sound, and the job's first
   * sound otherwise. A job of one audio file gives the same answer either way.
   */
  const tabAudioSource = (focusedSource && probeHasAudio(sourceProbes[focusedSource]) ? focusedSource : null)
    ?? [...draft.sourcePaths, ...(draft.additionalAudioTracks ?? []).map((track) => track.path)].find((source) => probeHasAudio(sourceProbes[source]))
    ?? null
  const tabAudioProbe = tabAudioSource ? sourceProbes[tabAudioSource] : undefined
  const tabAudioFacts = audioFacts(tabAudioProbe)
  const tabAudioCodec = audioCodecFacts(tabAudioProbe)
  /**
   * A channel count as the preset stores it.
   *
   * SOURCE stores NOTHING rather than a figure, which is the only honest way to say it: every path that owns
   * the output layout has an answer of its own — a stitch follows the widest source it was given — and a two
   * written here would override that answer with one the user never chose.
   */
  const chooseAudioChannels = (value: string) => {
    const channels = clampAudioChannels(value)
    updatePreset({ audioChannels: channels === 1 || channels === 2 ? channels : undefined })
  }
  /** Picks the image a drawing sits on, and stores it on the preset the export reads. */
  const chooseBackgroundImage = async () => {
    const chosen = await window.electronAPI?.selectImage()
    if (chosen) updatePreset({ visualizationBackground: 'image', visualizationBackgroundImage: chosen })
  }
  const backgroundImageName = draft.preset.visualizationBackgroundImage?.split('/').pop() ?? ''
  /** Picks the picture a job with nothing but sound is shown — the export's whole picture, not a background. */
  const choosePictureImage = async () => {
    const chosen = await window.electronAPI?.selectImage()
    if (chosen) updatePreset({ audioPicture: 'custom', audioPictureImage: chosen })
  }
  const pictureImageName = draft.preset.audioPictureImage?.split('/').pop() ?? ''
  /**
   * The bitrate control's own three answers: SOURCE, a rung of the ladder, or a typed figure.
   *
   * CUSTOM is told apart from SOURCE by the key being PRESENT and empty rather than absent, which is the only
   * thing a stored string can say: an absent bitrate is a job that never chose one, and an empty one is a job
   * that chose to type its own and has not finished.
   */
  const bitrateRung = bitrateOptionOf(draft.preset.audioBitrate)
  const bitrateCustom = draft.preset.audioBitrate !== undefined && bitrateRung === null
  // The PNG work setting, read the way the bitrate ladder is: a rung of the offered list, or a figure of
  // the reader's own with a field of its own to type it in.
  const compressionRung = draft.preset.pngCompression !== undefined && (PNG_COMPRESSION_CHOICES as readonly number[]).includes(draft.preset.pngCompression)
  const compressionCustom = draft.preset.pngCompression !== undefined && !compressionRung
  /** The same reading for the JPEG quality ladder, which has a CUSTOM rung of its own. */
  const qualityRung = draft.preset.jpegQuality !== undefined && (JPEG_QUALITY_CHOICES as readonly number[]).includes(draft.preset.jpegQuality)
  const qualityCustom = draft.preset.jpegQuality !== undefined && !qualityRung
  /**
   * Which depth control the OUTPUT codec gets, if any.
   *
   * ProRes decides its own depth by profile, so it gets a reading. H.264 and H.265 genuinely support both
   * depths, so they get the choice. Everything else here has no such setting to offer.
   */
  const depthKind: 'profile' | 'choice' | null =
    draft.preset.videoCodec === 'prores' ? 'profile'
      : draft.preset.videoCodec === 'h264' || draft.preset.videoCodec === 'hevc' ? 'choice'
        : null
  /** Whether the OUTPUT codec has a bitrate to set at all, and what to say about it either way. */
  const ratePossible = !audioOnly && codecTakesRate(draft.preset.videoCodec)
  // A codec that HAS a rate gets a description of the figure; one that has not gets the reason it has not,
  // which is a different sentence and never the other way round — the tooltip on H.264 said there was no
  // bitrate to set, beside a box that takes one.
  const rateReason = ratePossible
    ? 'How many bits a second the picture is written at. A blank field leaves the codec its own default, which in a delivery codec is a quality rather than a rate — a CRF encoder has no bitrate until it has encoded.'
    : audioOnly ? 'THIS CONTAINER CARRIES AUDIO ONLY.'
      : draft.preset.videoCodec === 'copy' ? 'A BITRATE IS UNUSED WHILE THE PICTURE IS COPIED.'
        : draft.preset.videoCodec === 'prores' ? 'PRORES IS A FAMILY OF FIXED RATES: THE PROFILE DECIDES THE FIGURE, AND A BITRATE BESIDE IT WOULD BE AN OFFER THE ENCODER IGNORES.'
          : draft.preset.videoCodec === 'mjpeg' ? 'A JPEG IS SIZED BY ITS QUALITY RATHER THAN BY A RATE, WHICH IS THE IMAGE TAB.'
            : draft.preset.videoCodec === 'gif' ? 'A GIF IS SIZED BY ITS PALETTE AND ITS OWN ENCODER RATHER THAN BY A RATE.'
              : 'THIS CODEC WRITES AT A FIXED RATE OF ITS OWN, SO THERE IS NO BITRATE TO SET.'
  const bitrateValueForChoice = (choice: string) => {
    if (choice === 'custom') updatePreset({ audioBitrate: '' })
    else if (choice === '0') updatePreset({ audioBitrate: undefined })
    else updatePreset({ audioBitrate: bitrateValue(Number(choice)) })
  }

  return <div className="edit-job-shell">
    <header className="editor-header">
      {/* The job's own mode is part of the title now, after a second ` // `, rather than a boxed tag at the far
          end of the bar: the heading already names the window, and the mode belongs with it. */}
      <div><span className="panel-kicker">STITCH UP MEDIA // EDIT JOB // {draft.type === 'stitch' ? 'STITCH UP' : draft.type === 'multitrack' ? 'MULTI-TRACK' : draft.type === 'combo' ? ((draft.comboMode ?? 'multitrack') === 'stitch' ? 'COMBO (STITCH TRACKS)' : 'COMBO (MULTI-TRACK)') : 'CONVERT'}</span><h1>{sourceName(focusedSource)}</h1></div>
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
          <div className="editor-screen" onWheel={speedByWheel}>
            {/* The media sits in its own measured stage, so the output frame outline can
                be drawn around the picture rather than around the panel. The stage is also the
                pan surface: everything drawn lives in one layer inside it and moves together
                when a zoom has left more than the panel can show. */}
            <div className={`editor-stage${drawable ? ' is-pannable' : ''}${canPlacePicture ? ' is-placing' : ''}${cropDragging ? ' is-cropping' : ''}${trimNeighbour ? ' is-trimming' : ''}`} ref={attachStage} onPointerDown={beginMonitorDrag}>
              <div className="editor-stage-pan" style={{ transform: `translate(${panX}px, ${panY}px)` }}>
                {/* The frame's own window: the picture is drawn inside it and clipped by it, so
                    what the monitor shows is the output's own area and not the picture spilling
                    past it. A clip fitted to the width really is cropped at the frame's edges.

                    The MEDIA is mounted whether or not the frame's size is known yet, which is the
                    point of the `is-open` state: for a frame that follows the source there is no
                    resolution and no exact size to take the size from, so it can only come from the
                    media — and a monitor that waited for a size before mounting the media was
                    waiting for the media to tell it. Until then the picture fills the stage at its
                    own proportions, and the outline, the fit and the crop box appear with the size. */}
                <div className={`editor-frame-window${frameRect && frameOrigin ? '' : ' is-open'}`} style={frameRect && frameOrigin ? { left: frameOrigin.x, top: frameOrigin.y, width: frameRect.width, height: frameRect.height } : undefined}>
                  {inBlackTail && <div className="editor-tail" aria-hidden="true" />}
                  {/* What the crop removes, drawn INSIDE the frame's window so that window's own edge clips
                      it. A picture bigger than the frame is cropped by that edge, and the black standing for
                      what the crop took away belongs on the picture's side of it rather than spilled across
                      the panel the frame sits on. The figures are the pan layer's, so the frame's origin
                      comes off them — the media beside this is placed the same way, for the same reason. */}
                  {cropShade.map((band, index) => (
                    <div key={index} className="editor-crop-shade" style={{ left: band.left - (frameOrigin?.x ?? 0), top: band.top - (frameOrigin?.y ?? 0), width: band.width, height: band.height }} aria-hidden="true" />
                  ))}
                  {playback.error
                    ? <span className="editor-screen-message">{playback.error}</span>
                    : nothingToTimeJob
                      ? <img className="editor-still" draggable={false} style={{ ...mediaStyle }} src={mediaUrl(draft.sourcePaths[0])} alt={sourceName(draft.sourcePaths[0])} onLoad={measureNatural} ref={stillFrameRef} />
                      // A picture file is drawn as a picture, whichever branch the timeline took to get
                      // here — the segment's own flag is not consulted, because the target is what would
                      // be decoded and it is the target that decides how to decode it.
                      : monitorShowsImage
                        ? <img className="editor-still" draggable={false} style={{ ...mediaStyle, opacity: previewGain }} src={elementUrl ?? mediaUrl(playback.segment?.sourcePath ?? '')} alt={sourceName(playback.segment?.sourcePath ?? '')} onLoad={measureNatural} ref={stillFrameRef} />
                        // Sound with no picture: a waveform, never a <video>. The element would be
                        // asked for a frame out of a file that has none.
                        : monitorIsAudio
                          // The picture the job was GIVEN, where it was given an image of its own: the export's
                          // whole picture, so the monitor shows the image itself rather than anything drawn
                          // over it. It is laid out by the drawing's own rule — its shape kept, letterboxed —
                          // because that is what `stillFitFilters` does to it on the way out.
                          ? photoPicture
                            ? <img className="editor-still is-drawing" draggable={false} style={{ ...mediaStyle }} src={mediaUrl(photoPicture)} alt="CUSTOM PICTURE" />
                            // The export's own picture, when the job's picture IS a drawing: a still of the
                            // chosen template in the chosen colours, because the app's green line would be a
                            // drawing of a design nobody asked for. Until it arrives, and if it cannot be
                            // made, the waveform below stands in rather than the monitor going blank.
                            : drawingStill && drawingPicture.draws
                            ? <img className="editor-still is-drawing" draggable={false} style={{ ...mediaStyle }} src={drawingStill} alt="DRAWING THE SOUND" />
                            : monitorWaveform
                            ? <svg className="editor-waveform" width="100%" height="100%" viewBox={`0 0 ${monitorWaveform.width} ${monitorWaveform.height}`} preserveAspectRatio="none" aria-hidden="true">
                              <line x1="0" y1={monitorWaveform.height / 2} x2={monitorWaveform.width} y2={monitorWaveform.height / 2} stroke="var(--ui-border)" strokeWidth="1" />
                              {monitorWaveform.peaks.length
                                ? <path d={waveformPath({ peaks: monitorWaveform.peaks, width: monitorWaveform.width, height: monitorWaveform.height })} stroke="var(--crt-green)" strokeWidth={WAVEFORM_BAR} fill="none" />
                                : null}
                            </svg>
                            : <span className="editor-screen-message">{screenMessage}</span>
                          : elementUrl
                            ? <video
                              ref={playback.attachVideo}
                              className="editor-video"
                              src={elementUrl}
                              preload="metadata"
                              playsInline
                              style={{ ...mediaStyle, opacity: previewGain }}
                              onContextMenu={(event) => event.preventDefault()}
                              onLoadedMetadata={measureNatural}
                              onClick={toggleFromClick}
                            />
                            : <span className="editor-screen-message">{screenMessage}</span>}
                </div>
                {frameRect && <div className="editor-frame" style={{ width: frameRect.width, height: frameRect.height }} aria-hidden="true"><b>OUTPUT {outputFrame?.width}x{outputFrame?.height}</b></div>}
                {/* The box the clip's own margins leave inside the frame. The background the export
                    will fill them with is already what shows through — the window is the output's own
                    black — so this only says where the box IS: the picture is scaled into it and
                    centred in it, and the offset then slides it from there. */}
                {insetBox && hasInsets(activeInsets) && <div className="editor-insets" style={{ left: insetBox.left, top: insetBox.top, width: insetBox.width, height: insetBox.height }} aria-hidden="true" />}
                {cropRect && <div className="editor-crop" style={{ left: cropRect.left, top: cropRect.top, width: cropRect.width, height: cropRect.height }} onPointerDown={beginCropMove}>
                  {(['left', 'top', 'right', 'bottom'] as const).map((edge) => (
                    <span key={edge} className={`crop-handle is-${edge}`} onPointerDown={(event) => beginCropDrag(edge, event)} role="presentation" />
                  ))}
                  {(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const).map((corner) => (
                    <span key={corner} className={`crop-corner is-${corner}`} onPointerDown={(event) => beginCropCorner(corner, event)} role="presentation" />
                  ))}
                </div>}
              </div>
              {/* The TRIM'S TWO-UP VIEW: while a handle is down the monitor shows the two frames the cut
                  will join, side by side, filling the whole preview. Each pane is shaped to the OUTPUT's
                  own aspect ratio so both read as the export will frame them. The clip being trimmed is on
                  the side the handle is NOT, so an IN handle (cutting the head) has its neighbour — the
                  previous clip's LAST frame — on the left, and an OUT handle (cutting the tail) has the
                  next clip's FIRST on the right. The main element runs on behind, moved to the landing
                  frame by the drag itself, and the frame's own enclosure is hidden (see `is-trimming`). */}
              {trimNeighbour && (() => {
                const current = playback.segment
                const currentTarget = current ? pictureSourceFor(current) : null
                const currentHasPicture = Boolean(current) && sourceVideo[current!.sourcePath] !== false
                const neighbour = trimNeighbour.segment
                const neighbourTarget = pictureSourceFor(neighbour)
                const neighbourHasPicture = sourceVideo[neighbour.sourcePath] !== false
                const aspect = outputFrame ? `${outputFrame.width} / ${outputFrame.height}` : '16 / 9'
                const neighbourPane = <TrimPairPane
                  key="neighbour"
                  label={trimNeighbour.side === 'left' ? 'PREV LAST' : 'NEXT FIRST'}
                  sourcePath={neighbour.sourcePath}
                  still={Boolean(neighbour.still)}
                  videoUrl={neighbourHasPicture && neighbourTarget ? mediaUrl(neighbourTarget) : null}
                  seekTo={trimNeighbour.at}
                  aspect={aspect}
                />
                const currentPane = <TrimPairPane
                  key="current"
                  label="THIS CLIP"
                  sourcePath={current?.sourcePath ?? ''}
                  still={Boolean(current?.still)}
                  videoUrl={currentHasPicture && currentTarget ? mediaUrl(currentTarget) : null}
                  seekTo={current ? sourceTimeAt(playback.position, current) : 0}
                  aspect={aspect}
                />
                return <div className="editor-trim-pair">
                  {trimNeighbour.side === 'left' ? <>{neighbourPane}{currentPane}</> : <>{currentPane}{neighbourPane}</>}
                </div>
              })()}
            </div>
            <small>{focusedCopyLabel ? `${focusedCopyLabel} // ` : ''}{focusedLabel} | {focusedSoundLine ?? resolutionLabel}{duration > 0 ? ` | ${Math.round(fps)} FPS` : ''}</small>
            <small>{activeSegment ? `CLIP ${clipRangeLabel({ usedSeconds: activeSegment.sourceUsedSeconds, sourceIn: activeSegment.sourceIn, totalSeconds: sourceDuration(draft, activeSegment.sourcePath, undefined, resolveTiming), fps: activeSegment.nativeRate ?? rateOf(sourceFps(draft, activeSegment.sourcePath, undefined, resolveTiming)), mode: timestampMode })} | ${outputRangeLabel(duration, outputRate, timestampMode)}` : outputRangeLabel(duration, outputRate, timestampMode)}</small>
            {/* What the transport is doing. A single line, and the one place it is said: the pause glyph that
                used to sit among the buttons said the same thing a second time, next to a PLAY toggle that
                already carries the state. */}
            <b className="transport-state">{playback.playing ? '> PLAYING' : '|| PAUSED'}</b>
          </div>
          <div className="transport">
            <button disabled={!playable} onClick={() => playback.step(-1 / Math.max(1, fps))} title={playable ? undefined : 'NOTHING PLAYABLE HERE YET.'}>[|&lt;] FRAME</button>
            <button disabled={!playable} onClick={playback.toggle} title={playable ? undefined : 'NOTHING PLAYABLE HERE YET.'}>[{playback.playing ? '||' : '>'}] PLAY</button>
            <button disabled={!playable} onClick={() => playback.step(1 / Math.max(1, fps))} title={playable ? undefined : 'NOTHING PLAYABLE HERE YET.'}>[&gt;|] FRAME</button>
            <span className={`transport-rate${playback.shuttleRate < 0 ? ' is-reverse' : playback.shuttleRate > 1 || (playback.shuttleRate === 0 && playback.playing && playback.speed > 1) ? ' is-fast' : ''}`}>
              {/* The rate the transport is being driven at: the shuttle's own when one is running, and otherwise
                  the shared speed value the wheel and L both write. It is shown even when the transport is
                  IDLE, because it is the speed the monitor is WATCHED at rather than a state — the line above
                  already says PAUSED, and this is the figure the selector used to show beside it. */}
              {playback.shuttleRate > 0 ? `> ${playback.shuttleRate}x`
                : playback.shuttleRate < 0 ? `< ${Math.abs(playback.shuttleRate)}x`
                  : playback.playing ? `> ${speedLabel(playback.speed)}`
                    : speedLabel(playback.speed)}
            </span>
            {/* The speed the monitor is watched at was chosen here until this pass. It is a preview-only
                rate and a wheel over the monitor still steps it — see `speedByWheel` — so the readout on
                the line beside this comment is where the figure is, and the dropdown that used to sit here
                was a second control for a figure the transport already owns. */}
            <span className="transport-stamp">{stampPair(playback.position, duration, outputRate, timestampMode)}</span>
            {/* The scrubber, drawn like the timeline's own playhead rather than like the platform's: an inset
                groove with the played part in the accent and a THIN RECTANGULAR handle. The platform's is a
                round blue knob on a blue track, which was the one thing on this panel that was not of the
                window — see `.transport-scrub`. The share played is handed to the stylesheet as a figure,
                because a stylesheet cannot read a range input's value. Its wheel is the timeline's OWN
                gesture — the lanes' handler directly, so a flick forward runs forward and a nudge moves a
                fraction of a frame, and the two can never drift into different weights or directions. */}
            <input
              className="transport-scrub"
              style={{ '--played': `${duration > 0 ? Math.max(0, Math.min(100, (playback.position / duration) * 100)) : 0}%` } as React.CSSProperties}
              type="range"
              min={0}
              max={duration > 0 ? duration : 1}
              step={fps > 0 ? 1 / fps : 0.01}
              value={duration > 0 ? playback.position : 0}
              disabled={!playable}
              onWheel={scrubByWheel}
              onChange={(event) => playback.seek(Number(event.target.value))}
              aria-label="Playhead across the assembled output"
            />
          </div>
          <div className="editor-preview-actions">
            <span className="preview-divider" aria-hidden="true" />
            <div className="preview-zoom">
              <span>ZOOM</span>
              <EditorSelect
                value={zoomOption}
                options={[
                  ...PREVIEW_ZOOM_STEPS.map((step) => ({ value: String(step), label: `${step}%` })),
                  { value: 'fitWidth', label: 'FIT WIDTH' },
                  { value: 'fitHeight', label: 'FIT HEIGHT' },
                  { value: 'fit', label: 'FIT' },
                  { value: 'custom', label: 'CUSTOM...' },
                ]}
                onChange={chooseZoom}
                title="How large the monitor draws the output frame. The export is not affected, and neither is a clip's own fit."
                ariaLabel="Zoom the preview monitor"
              />
            </div>
            {zoomOption === 'custom' && <label className="mini-field preview-zoom-field">
              <input
                type="number"
                min={MIN_PREVIEW_ZOOM}
                max={MAX_PREVIEW_ZOOM}
                value={zoomText}
                onChange={(event) => typeZoom(event.target.value)}
                aria-label="Zoom percentage"
              />
              <span>%</span>
            </label>}
          </div>
          {inspectorOpen && inspectedSource && (
            <div className="media-inspector">
              {/* The drawer's own head. It is outside the scroller, so the × sits above the rows and
                  above the scroller's own bar rather than in the corner they are drawn in. */}
              <div className="inspector-head">
                <span className="inspector-title">PROPERTIES</span>
                <button className="inspector-close" onClick={() => setInspectorOpen(false)} aria-label="Close the properties inspector" title="Close">x</button>
              </div>
              <div className="inspector-scroll">
                <EditorRow label="SOURCE" value={inspectedCopyLabel ? `${inspectedCopyLabel} // ${inspectedSequence ? sequenceLabel(inspectedSequence) : sourceName(inspectedSource)}` : inspectedSequence ? sequenceLabel(inspectedSequence) : sourceName(inspectedSource)} />
                <EditorRow label="FORMAT" value={(inspectedSource.split('.').pop() || 'UNKNOWN').toUpperCase()} />
                {/* What the sound IS, which an inspector of an audio file had nothing to say about: the rate,
                    the sample size and the channels, and then how it is written. A lossy file has no sample
                    size and says so by leaving it out rather than by claiming zero bits. */}
                {inspectedAudioFacts && <EditorRow label="AUDIO" value={inspectedAudioFacts} reason="The file's own audio: its sample rate, its sample size, and its channel layout or count." />}
                {inspectedAudioCodec && <EditorRow label="AUDIO CODEC" value={inspectedAudioCodec} />}
                {/* The SOURCE's own depth, which is a fact about the file rather than a setting: nothing
                    here re-encodes a source at a depth it was not already in, and it moves no estimate,
                    because the source is re-encoded whatever it held. */}
                {inspectedPixelFormat && <EditorRow label="DEPTH" value={pixelDepthLabel(inspectedPixelFormat) ?? inspectedPixelFormat.toUpperCase()} reason="The samples the source's picture is stored in, read off its own pixel format. It is never a control — the export writes whatever its codec and depth say." />}
                {/* The clip's own run through its source, told in four figures rather than in one line.
                    SOURCE is the whole of the file, USED is the part the output takes, and START and END
                    are the two points inside the source that part runs between — which is what a reader
                    reaching for an in or an out point is looking for, and what one long line buried. */}
                {inspectedSegment ? <>
                  <EditorRow label="SOURCE" value={stamp(sourceDuration(draft, inspectedSegment.sourcePath, undefined, resolveTiming))} reason="The whole of the file this clip is a piece of, in the units the window is showing lengths in." />
                  <EditorRow label="USED" value={stamp(inspectedSegment.sourceUsedSeconds)} reason="How much of the source the output takes, which is the source length less whatever the trim cut off." />
                  <EditorRow label="START" value={stamp(inspectedSegment.sourceIn)} reason="Where inside the source that run begins: the clip's IN point." />
                  <EditorRow label="END" value={stamp(inspectedSegment.sourceIn + inspectedSegment.sourceUsedSeconds)} reason="Where inside the source that run ends: the clip's OUT point." />
                </> : <EditorRow label="SOURCE" value={inspectedProbe ? stamp(inspectedProbe.duration) : 'PROBING...'} />}
                {/* The rate the clip's frames are READ at, with the source's own beside it as the reference. ONE
                    editable figure: a rate of the clip's own does not replace the native one, it INTERPRETS the
                    clip by the ratio between them, retiming it exactly as a speed does. Offered wherever the
                    export can carry a retime, which is the same gate the speed uses, so a control is never drawn
                    for a clip whose file would ignore it. */}
                {inspectedSegment && inspectedCanSpeed && (() => {
                  const native = inspectedNativeRate
                  const clip = inspectedRate
                  const chosen = RATE_PRESETS.find((entry) => ratesEqual(entry.rate, clip))
                  return <EditorField
                    label="FPS"
                    hint={`SOURCE ${rateLabel(native)}`}
                    reason={`How many of this clip's frames are read each second. The source runs at ${rateLabel(native)} (${rateRationalLabel(native)}), shown beside this as the reference; a rate of the clip's own REINTERPRETS its frames, so the clip is retimed by the ratio between the two exactly as a speed retimes it — ${rateRationalLabel(clip)}. Left at the source's own rate, nothing is retimed.`}
                    canReset={!ratesEqual(clip, native)}
                    onReset={() => { setFpsCustomText(null); setClipRate(inspectedSource, inspectedClipIndex, undefined) }}
                  >
                    <EditorSelect
                      value={chosen ? `${chosen.rate.num}/${chosen.rate.den}` : 'custom'}
                      options={[
                        ...RATE_PRESETS.map((entry) => ({ value: `${entry.rate.num}/${entry.rate.den}`, label: `${entry.label} FPS` })),
                        { value: 'custom', label: chosen ? 'CUSTOM...' : `CUSTOM... (${rateLabel(clip)})` },
                      ]}
                      onChange={(next) => {
                        if (next === 'custom') { setFpsCustomText(String(Number(rateValue(clip).toFixed(3)))); return }
                        const [num, den] = next.split('/').map(Number)
                        setFpsCustomText(null)
                        setClipRate(inspectedSource, inspectedClipIndex, makeRate(num, den))
                      }}
                      ariaLabel="The rate this clip's frames are read at"
                    />
                  </EditorField>
                })()}
                {inspectedSegment && inspectedCanSpeed && fpsCustomText !== null && <EditorField label="CUSTOM FPS" reason="A rate of the clip's own, in frames a second. A decimal is kept as the exact rational it is written as and reduced — 23.5 becomes 47/2 rather than an approximation of it.">
                  <NumberField className="editor-input" min={1} max={240} step={0.001} value={Number(fpsCustomText) || undefined} onValue={(value) => { if (value > 0) { setFpsCustomText(String(value)); setClipRate(inspectedSource, inspectedClipIndex, rateOf(value)) } }} ariaLabel="A frame rate of the clip's own" />
                </EditorField>}
                {inspectedSegment && inspectedCanSpeed && (() => {
                  // SPEED and DURATION are one relationship read from either end: the source run the clip
                  // keeps is fixed by its trim, so a speed decides the timeline length and a length decides
                  // the speed. Both fields write the one record through the one writer, which is what keeps
                  // the two in step — and the timeline, the monitor and the strips all read that record, so
                  // a preview and the file it previews cannot disagree about how long the clip is.
                  const trimmedSeconds = inspectedSegment.sourceUsedSeconds
                  // The composition the pipeline states: `duration = (N / fps_clip) / speed`, and the field is
                  // read from the other end. The rate the clip is INTERPRETED at folds in beside the speed as
                  // the ratio to the source's own, so a clip read at half its source rate is half as long
                  // again, and typing a length back-solves the SPEED while the rate is held.
                  const fpsRatio = rateValue(inspectedRate) / Math.max(1e-9, rateValue(inspectedNativeRate))
                  const durationRate = outputRate
                  const applyDuration = (seconds: number) => {
                    if (seconds > 0) setClipSpeed(inspectedSource, inspectedClipIndex, { speed: trimmedSeconds / (seconds * fpsRatio) })
                  }
                  // The reading beside the length: the share of the source the clip keeps, which is the
                  // speed read the other way round — 100% at the clip's own speed, 50% at twice it. The
                  // figure ITSELF is the field's own, written as a timecode in the window's units, which
                  // is the shape a reader compares against the ruler. The two are read as one line, so the
                  // hint carries the dash that joins them and the row reads `00:00:12.00 - (100%)`.
                  const durationHint = timestampMode === 'framestamp'
                    ? 'IN FRAMES'
                    : `- (${Math.round(100 / Math.max(0.0001, inspectedSegment.speed))}%)`
                  return <>
                    <EditorField
                      label="SPEED"
                      hint={inspectedSpeed.speed === 1 ? 'SOURCE RATE' : `TRIM ${stamp(trimmedSeconds)}`}
                      reason="How fast this clip runs. The trim is what the clip keeps of its source; the speed is how quickly that run is played, so the clip's length in the output follows from the two together."
                      canReset={inspectedSpeed.speed !== 1}
                      onReset={() => setClipSpeed(inspectedSource, inspectedClipIndex, { speed: 1 })}
                    >
                      <NumberField
                        className="editor-input"
                        min={MIN_CLIP_SPEED}
                        max={MAX_CLIP_SPEED}
                        step={0.05}
                        value={inspectedSpeed.speed}
                        onValue={(entered) => setClipSpeed(inspectedSource, inspectedClipIndex, { speed: entered })}
                        ariaLabel="The speed this clip is played at"
                      />
                    </EditorField>
                    <EditorField
                      label="DURATION"
                      hint={durationHint}
                      reason="How long this clip occupies on the timeline, in the window's own units. It is the trimmed source length divided by the speed, so editing it here chooses the speed that length needs; one notch or one arrow key is one frame of it."
                      canReset={inspectedSpeed.speed !== 1}
                      onReset={() => setClipSpeed(inspectedSource, inspectedClipIndex, { speed: 1 })}
                    >
                      <NumberField
                        className="editor-input"
                        min={timestampMode === 'framestamp' ? 1 : 1 / rateValue(durationRate)}
                        step={1 / rateValue(durationRate)}
                        value={timestampMode === 'framestamp' ? Math.max(1, frameCount(inspectedSegment.duration, durationRate)) : inspectedSegment.duration}
                        onValue={(entered) => applyDuration(timestampMode === 'framestamp' ? entered / rateValue(durationRate) : entered)}
                        format={timestampMode === 'framestamp' ? undefined : (seconds) => timecode(seconds, durationRate)}
                        parse={timestampMode === 'framestamp' ? undefined : (text) => secondsFromTimecode(text, durationRate)}
                        ariaLabel="The length this clip occupies on the timeline"
                      />
                    </EditorField>
                    {inspectedSegment.speed !== 1 && inspectedHasPicture && <EditorField label="INTERPOLATION" hint="EXPORT" reason="What fills the frames a retime leaves out or repeats — a speed or a rate of the clip's own. SAMPLING keeps whichever source frame the output instant lands on, which is cheap and can judder; BLENDING averages the neighbours so a slowed clip reads as movement. It changes the picture only, and only in the written file. A clip with no picture has no frames to fill, so the choice is not offered for one.">
                      <EditorSelect
                        value={inspectedSpeed.interpolation}
                        options={[{ value: 'sampling', label: 'SAMPLING' }, { value: 'blending', label: 'BLENDING' }]}
                        onChange={(choice) => setClipSpeed(inspectedSource, inspectedClipIndex, { interpolation: choice === 'blending' ? 'blending' : 'sampling' })}
                        ariaLabel="What fills the frames a speed change leaves out"
                      />
                    </EditorField>}
                    {inspectedSegment.speed !== 1 && inspectedHasSound && <EditorToggle
                      label="MAINTAIN AUDIO PITCH"
                      checked={inspectedSpeed.maintainPitch !== false}
                      onChange={(checked) => setClipSpeed(inspectedSource, inspectedClipIndex, { maintainPitch: checked })}
                      reason="On, the sound is retimed with atempo and keeps its own pitch. Off, asetrate shifts the sample rate instead, so the pitch rises and falls with the speed the way a tape's does. A clip with no sound has no pitch to keep, so the switch is not offered for one."
                    />}
                  </>
                })()}
                {inspectedSegment?.still && (() => {
                  // The length is a CHOICE for a still, so it is a figure the window is asked for — and the
                  // window is showing lengths in frames or in time, so the field asks in whichever it is
                  // showing. What is stored is seconds either way; only the reading of it changes.
                  const seconds = stillSecondsFor(draft, inspectedSource)
                  const rate = Math.max(1, inspectedFps)
                  return <EditorField label="CLIP LENGTH" hint={timestampMode === 'framestamp' ? 'IN FRAMES' : 'IN SECONDS'}>{
                    timestampMode === 'framestamp'
                      ? <NumberField
                        className="editor-input"
                        min={1}
                        step={1}
                        value={Math.round(seconds * rate)}
                        onValue={(frames) => { if (frames > 0) setSourceTiming(inspectedSource, { seconds: frames / rate }) }}
                      />
                      : <NumberField
                        className="editor-input"
                        min={0.1}
                        step={0.1}
                        value={seconds}
                        onValue={(entered) => { if (entered > 0) setSourceTiming(inspectedSource, { seconds: entered }) }}
                      />
                  }</EditorField>
                })()}
                {/* A picture clip's OWN sound, which is part of the clip and travels with it: one row per
                    embedded stream, each droppable or levelled on its own. Offered only where the encoder can
                    honour it — a CONVERT or a MULTI-TRACK maps the clip straight through — and only for a clip
                    on the SOURCE list, since an added track's records are its own. The export writes exactly
                    the streams left enabled; a stream taken out to a track is not carried here as well. */}
                {inspectedOnMainLane && inspectedHasPicture && embeddedAudioEditable(draft) && (() => {
                  const streams = sourceProbes[inspectedSource]?.audioStreams ?? []
                  if (!streams.length) return null
                  const clipId = clipKey(draft, inspectedSource, inspectedClipIndex)
                  return <EditorGroup
                    id="embedded-audio"
                    label="EMBEDDED AUDIO"
                    hint={`${streams.length} STREAM${streams.length === 1 ? '' : 'S'}`}
                    reason="The sound this clip carries as part of itself. Each stream can be dropped from the export and the monitor, or given a level in dB. The export maps exactly the streams left enabled, one at a time, rather than ffmpeg's own choice of one or all."
                    collapsed={collapsedSections.includes('embedded-audio')}
                    onToggle={toggleSection}
                  >
                    {streams.map((stream, sourceIndex) => {
                      const streamIndex = stream.index ?? sourceIndex
                      const extracted = Boolean(extractedBy(draft, clipId, inspectedSource, streamIndex))
                      const muted = Boolean(embeddedStreamsFor(draft, clipId).find((entry) => entry.index === streamIndex)?.muted)
                      // An EXTRACTED stream is no longer the clip's to control: the picture does not carry it and
                      // a mute or a level set here would be inert. So it reads as a fact rather than a control,
                      // and the way back is stated. Its own track's lane carries the mute.
                      if (extracted) return <div className="embedded-stream is-extracted" key={streamIndex}>
                        <EditorRow label={embeddedStreamLabel(stream, streamIndex)} value="EXTRACTED" reason="This stream is on a track of its own, so the picture no longer carries it. Delete that track to put it back on the clip." />
                      </div>
                      return <div className="embedded-stream" key={streamIndex}>
                        <EditorToggle
                          label={embeddedStreamLabel(stream, streamIndex)}
                          checked={!muted}
                          onChange={(checked) => writeEmbeddedStream(clipId, streamIndex, { muted: !checked })}
                          reason={muted
                            ? 'Dropped from the export and the monitor. It is not mapped at all rather than written silent.'
                            : 'Carry this stream in the export and the monitor. Off, it is dropped from the mapping.'}
                        />
                        <EditorField label="LEVEL" hint="dB" reason="A level for this stream: 0 dB is unity. It is written as a `volume` filter on this stream's own export chain, so several streams of one clip can carry different levels.">
                          <NumberField className="editor-input" min={-60} max={24} step={0.5} value={embeddedGainDb(draft, clipId, streamIndex)} onValue={(value) => writeEmbeddedStream(clipId, streamIndex, { gainDb: value })} ariaLabel="The level of this embedded stream in dB" />
                        </EditorField>
                        <button className="embedded-extract" onClick={() => extractAudioToTrack(clipId, inspectedSource, [streamIndex])} title="Move this stream to a track of its own, so it can be trimmed and moved independently — a J/L cut.">EXTRACT TO TRACK</button>
                      </div>
                    })}
                    {streams.length > 1 && <div className="editor-note">&gt; THE MONITOR PLAYS THE FILE'S DEFAULT STREAM ONLY; EVERY STREAM ABOVE IS WRITTEN AS YOU SET IT. EXTRACT A STREAM TO A TRACK TO HEAR IT ON ITS OWN.</div>}
                  </EditorGroup>
                })()}
                {/* A SOUND clip's own LEVEL. A lone audio file's one stream IS the stream the export writes,
                    so a level on it is a level on the output — on the paths that carry that clip's own sound,
                    a CONVERT or a STITCH (each audio clip of a stitch is normalized on its own). It is keyed
                    by the clip's id like every other per-clip record, so it travels with the clip. */}
                {inspectedOnMainLane && !inspectedHasPicture && (draft.type === 'transcode' || draft.type === 'stitch') && (sourceProbes[inspectedSource]?.audioStreams?.length ?? 0) > 0 && (() => {
                  const clipId = clipKey(draft, inspectedSource, inspectedClipIndex)
                  return <EditorField label="LEVEL" hint="dB" reason="This clip's own level: 0 dB is unity. It is written as a `volume` filter on this clip's stream in the export, before anything is mixed, and the monitor applies the same gain.">
                    <NumberField className="editor-input" min={-60} max={24} step={0.5} value={embeddedGainDb(draft, clipId, 0)} onValue={(value) => writeEmbeddedStream(clipId, 0, { gainDb: value })} ariaLabel="This clip's level in dB" />
                  </EditorField>
                })()}
              </div>
            </div>
          )}
          {previewNotice && <div className="editor-note is-warning">&gt; {previewNotice}</div>}
          <div className="editor-note">&gt; SPACE PLAYS OR PAUSES, K STOPS. &lt;- / -&gt; STEP ONE FRAME; J SHUTTLES BACK AND L SPEEDS FORWARD (2x, 4x, 8x, FROM WHATEVER THE SPEED IS SET TO); K+J OR K+L IS SLOW MOTION. THE WHEEL OVER THE MONITOR CHANGES THE SPEED, AND OVER THE TIMELINE IT SCRUBS. IN / OUT POINTS COME FROM THE NATIVE PREVIEW. UNDO AND REDO ARE CMD+Z AND CMD+SHIFT+Z.</div>
        </section>

        <section className="timeline-panel">
          {nothingToTimeJob ? <>
            <div className="panel-kicker">TIMELINE // SINGLE FRAME</div>
            <div className="editor-note">&gt; THIS JOB MAPS ONE FRAME TO ONE FRAME, SO THERE IS NOTHING TO TIME. CHANGE THE FORMAT IN EXPORT SETTINGS TO TREAT THE IMAGE AS A {Math.round(draft.stillImageDuration || 10)}s CLIP.</div>
          </> : <>
          <div className="timeline-head">
            <div className="panel-kicker">TIMELINE // {draft.type.toUpperCase()}</div>
            <div className="timeline-zoom">
              <button onClick={() => setZoom((current) => clampZoom(current / 2))} disabled={zoom <= ZOOM_MIN} aria-label="Make the timeline shorter" title="Magnify out"><ZoomOut size={11} /></button>
              <span className="timeline-zoom-value">{Math.round(zoom * 100) / 100}x</span>
              <button onClick={() => setZoom((current) => clampZoom(current * 2))} disabled={zoom >= ZOOM_MAX} aria-label="Make the timeline longer" title="Magnify in"><ZoomIn size={11} /></button>
              <button
                onClick={() => {
                  // The viewport is read here and nowhere else: a fit is a decision, not a state the
                  // timeline lives in, so a later resize reveals more or less of it instead of
                  // re-deciding what the zoom should be.
                  const scroller = timelineScrollRef.current
                  if (!scroller) return
                  // NOT clamped: the fit is allowed below the buttons' own floor, so a job longer than the
                  // floor can still be taken in at a glance.
                  setZoom(fitZoom(duration, scroller.clientWidth))
                }}
                disabled={duration <= 0}
                title="Fit the whole timeline into the panel"
              >FIT</button>
            </div>
          </div>
          <div className="timeline-lanes" style={{ '--filmstrip-tile': `${FILMSTRIP_CLIP_HEIGHT}px` } as React.CSSProperties} onWheel={scrubByWheel}>
            {/* The gutter: the ruler's own line and every lane's label, outside the scroller, so
                the scrollbar begins beside the labels rather than beneath them and neither the
                ruler nor the skimmer can travel under the column. Its rows carry the same heights
                as the lanes opposite, so the two columns cannot drift apart. */}
            <div className="timeline-gutter">
              {/* The live readout IS the timestamp/framestamp label, so the unit is chosen on it: right-click
                  the stamp to switch between timecode and frame count. */}
              <div
                className="timeline-gutter-ruler"
                onContextMenu={(event) => { event.preventDefault(); const point = menuPoint(event); setTimelineMenu({ kind: 'stamp', x: point.x, y: point.y }) }}
                title="Right-click to choose whether lengths read as a timestamp or a framestamp"
              >{stamp(playback.position)}</div>
              {model.lanes.map((lane) => (
                <div className="timeline-lane-head" key={lane.id} onContextMenu={(event) => openLaneMenu(event, lane.id, lane.label)} title="Right-click to choose how this lane's clips are drawn">
                  <button
                    className={`lane-mute${muted[lane.id] ? ' is-muted' : ''}`}
                    onClick={() => setLaneMuted(lane.id, !muted[lane.id])}
                    aria-pressed={Boolean(muted[lane.id])}
                    title={lane.embedded ? 'Mute this stream. The export will not carry it.' : 'Mute this track. The export will not carry it.'}
                  >M</button>
                  {/* An added track's own LEVEL, beside its MUTE: the track's level is the track's, written
                      per stream by the export and applied to this lane's element by the monitor. A track
                      that is SEQUENCED with others is one of several on the lane, so its level is not set
                      here — the lane holds no single track to set it on. */}
                  {(() => {
                    const track = (draft.additionalAudioTracks || []).find((candidate) => candidate.id === lane.id)
                    if (!track) return null
                    return <label className="lane-gain"><NumberField className="lane-gain-input" min={-60} max={24} step={0.5} value={track.gainDb ?? 0} onValue={(value) => setTrackGain(track.id, value)} ariaLabel={`${lane.label} level in dB`} title="This track's level in dB. 0 dB is unity; the export writes it on this track's own stream and the monitor follows." /><span>dB</span></label>
                  })()}
                  <span>{lane.label}</span>
                </div>
              ))}
            </div>
            <div className="timeline-scroll" ref={attachLanes}>
              {/* The lane area's own width, with nothing in it but lane: the label column is not a
                  part of this drawing at all, which is what makes a point in it map to a time with
                  the timeline's rate and no other figure. */}
              <div className="timeline-lanes-inner" ref={timelineInnerRef} style={{ width: `${laneWidthFor(duration, zoom)}px` }}>
                <TimelineRuler duration={duration} zoom={zoom} fps={fps} label={(seconds) => (duration > 0 ? scaleLabel(seconds) : '--:--:--.--')} scroller={timelineScrollRef} onWheel={zoomByWheel} />
                {model.lanes.map((lane) => (
                  <div className="timeline-lane" key={lane.id}>
                    <div className={`timeline-lane-track${lane.kind === 'audio' ? ' is-audio' : ''}`} onClick={seekFraction} title="Click to jump to this point">
                    {lane.segments.map((segment, index) => {
                      // The two gestures this clip offers: being dragged to another place (a reorder of the job's
                      // sources, which only the main lane's clips are), and having either edge of its source
                      // window trimmed. Both need the clip's place and its whole length, read once here.
                      const sourceFull = draft ? sourceDuration(draft, segment.sourcePath, undefined, resolveTiming) : 0
                      const reorderable = lane.id === mainLane?.id && lane.segments.length > 1
                      // Every lane's clips can be trimmed: an ADDED AUDIO TRACK is one clip with a whole
                      // source of its own, and the encoder applies that trim (`applyTrimInput` for a
                      // track input). Only a source with no length at all has nothing to trim.
                      const trimmable = sourceFull > 0
                      const trimming = trimDragKey === segment.key ? trimPreview : (trimGroup[segment.key] ?? null)
                      const clipWidth = laneWidthFor(segment.duration, zoom)
                      return (
                      <div
                        key={segment.key}
                        className={`timeline-clip${segment.trimmed ? ' is-trimmed' : ''}${segment.key === activeSegmentKey ? ' is-active' : ''}${multiSelected.includes(segment.key) ? ' is-selected' : ''}${filmstripLanes[lane.id] ? ' is-film' : ''}${draggingClipIndex === index ? ' is-dragging' : ''}`}
                        style={{ width: `${clipWidth}px` }}
                        title={clipTitle(segment)}
                        data-clip-key={segment.key}
                        draggable={reorderable}
                        onClick={(event) => selectClip(lane.id, segment.key, event.shiftKey)}
                        onContextMenu={(event) => openClipMenu(event, segment, lane.id, index)}
                        onDragStart={reorderable ? (event) => { event.stopPropagation(); setDraggingClipIndex(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-stitch-clip', segment.key) } : undefined}
                        onDragOver={reorderable ? (event) => { event.preventDefault(); event.stopPropagation() } : undefined}
                        onDrop={reorderable ? (event) => {
                          event.preventDefault(); event.stopPropagation()
                          if (draggingClipIndex != null && draggingClipIndex !== index) {
                            // A drag of a clip IN A GROUP moves the whole group as one block; a drag of one on
                            // its own is the plain reorder it has always been.
                            if (multiSelected.length > 1 && multiSelected.includes(segment.key)) moveSelectionTo(index)
                            else reorderClip(draggingClipIndex, index)
                          }
                          setDraggingClipIndex(null)
                        } : undefined}
                        onDragEnd={reorderable ? () => setDraggingClipIndex(null) : undefined}
                      >
                        {/* The cells share the lane exactly, so there is no gap at the end, and each
                            shows the frame the playhead would show at that place on the lane. A tile
                            whose frame has not arrived yet draws nothing until it does, and the tiles
                            around it keep theirs, so the strip fills in rather than flashing empty.
                            A still has no frames to sample and one frame across the clip is its
                            strip. Nothing on the strip is hovered or skimmed: the frames are read,
                            not scrubbed, and the clip underneath keeps every pointer event — which
                            is what the right-click menu needs. */}
                        {lane.kind === 'video' && filmstripLanes[lane.id] && (() => {
                          const plan = planFor(segment)
                          if (!plan) return null
                          // A still has one picture and no frames to sample, so every cell shows it:
                          // the same rule as any other clip, with the frame never changing. It is
                          // placed in the tile by the fit arithmetic rather than extracted, since a
                          // single-frame file has no frame at a time to seek to.
                          const stillUrl = segment.still ? mediaUrl(segment.sourcePath) : null
                          const stillStyle = stillUrl ? stillTileStyle(segment, plan) : undefined
                          return <div className="timeline-clip-film" aria-hidden="true">
                            {plan.frames.map((frame, cell) => {
                              const shown = stillUrl ?? frameImageFor(segment, frame)
                              // Painted at the width the arithmetic gave the cell, in pixels. A share
                              // of the clip looks the same until the clip's width changes before the
                              // count catches up — which is every frame of a window resize — and then
                              // the frames stretch instead of the strip growing denser.
                              return <span className={`timeline-clip-tile${stillStyle ? ' is-placed' : ''}`} key={cell} style={{ width: `${plan.cellWidth}px` }}>
                                {shown ? <img src={shown} alt="" draggable={false} style={stillStyle} /> : null}
                              </span>
                            })}
                          </div>
                        })()}
                        {lane.kind === 'audio' && filmstripLanes[lane.id] && (() => {
                          // The waveform, on the helper's own rules: two-pixel bars on a four-pixel
                          // stride either side of the centre, each the loudest bucket it covers, in
                          // green. One path for the whole drawing, because a zoomed-in lane is
                          // thousands of bars and thousands of elements would make it crawl.
                          const width = laneWidthFor(segment.duration, zoom)
                          const peaks = waveforms[segment.sourcePath]
                          const shown = peaks && peaks.length
                            ? peaksForTrim(peaks, segment.sourceIn, segment.sourceIn + segment.duration, sourceDuration(draft, segment.sourcePath, undefined, resolveTiming))
                            : []
                          return <div className="timeline-clip-wave" aria-hidden="true">
                            <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(1, width)} ${FILMSTRIP_CLIP_HEIGHT}`} preserveAspectRatio="none">
                              <line x1="0" y1={FILMSTRIP_CLIP_HEIGHT / 2} x2={Math.max(1, width)} y2={FILMSTRIP_CLIP_HEIGHT / 2} stroke="var(--ui-border)" strokeWidth="1" />
                              {shown.length ? <path d={waveformPath({ peaks: shown, width, height: FILMSTRIP_CLIP_HEIGHT })} stroke="var(--crt-green)" strokeWidth={WAVEFORM_BAR} fill="none" /> : null}
                            </svg>
                          </div>
                        })()}
                        <span className="timeline-clip-name">{segmentName(segment)}</span>
                        <small>{segmentDetail(segment)}</small>
                        {segment.fadeIn ? <span className="clip-fade clip-fade-in" style={{ width: `${Math.min(100, (segment.fadeIn / Math.max(segment.duration, 0.001)) * 100)}%` }} aria-hidden="true" /> : null}
                        {segment.fadeOut ? <span className="clip-fade clip-fade-out" style={{ width: `${Math.min(100, (segment.fadeOut / Math.max(segment.duration, 0.001)) * 100)}%` }} aria-hidden="true" /> : null}
                        {/* A visual clip that carries audio says so, and says whether the export still
                            carries it: green while it does, grey while the lane is muted. */}
                        {lane.kind === 'video' && sourceAudio[segment.sourcePath]
                          ? <span className={`clip-audio${muted[lane.id] || clipAudioDropped(draft, clipKey(draft, segment.sourcePath, clipIndexOf(segment)), segment.sourcePath, sourceProbes[segment.sourcePath]?.audioStreams?.length ?? 0) ? ' is-muted' : ''}`} aria-hidden="true" />
                          : null}
                        {/* The lane's own boundaries. The main lane's are the cuts of the join: a [+] on a cut
                            fades both sides, and a [+] at either end fades from or to black. An added audio
                            track is a single clip, so it has the two edges only; its panel offers ADD SOURCE
                            and, because the encoder does not write a fade on an added track yet, says so
                            rather than drawing a ramp the file would not contain. */}
                        {index === 0 && (
                          <button
                            className={`boundary-add is-head${(lane.id === mainLane?.id ? edgeFade(draft, 'head') : trackEdgeFade(draft, segment.key, 'head')) > 0 ? ' is-active' : ''}${openBoundary?.laneId === lane.id && openBoundary.at === 'head' ? ' is-open' : ''}`}
                            onClick={(event) => { event.stopPropagation(); setOpenBoundary(openBoundary?.laneId === lane.id && openBoundary.at === 'head' ? null : { laneId: lane.id, at: 'head' }) }}
                            aria-label={`Add a fade in on ${lane.label}`}
                            title={lane.id === mainLane?.id ? 'Fade in from black' : `Fade in on ${lane.label}`}
                          />
                        )}
                        {/* A CUT between SEQUENCED tracks, which is the same [+] the main lane's cuts carry: the
                            place between two of them is a place a source can be inserted into the track list,
                            even though a FADE across it is not something the concat graph writes. */}
                        {(lane.id === mainLane?.id || lane.id === STITCHED_AUDIO_LANE_ID) && index < lane.segments.length - 1 && (
                          <button
                            className={`boundary-add${(draft.transitions?.[segment.key]?.duration ?? 0) > 0 ? ' is-active' : ''}${openBoundary?.laneId === lane.id && openBoundary.at === index ? ' is-open' : ''}`}
                            onClick={(event) => { event.stopPropagation(); setOpenBoundary(openBoundary?.laneId === lane.id && openBoundary.at === index ? null : { laneId: lane.id, at: index }) }}
                            aria-label={`Add a source between the tracks of ${lane.label}`}
                            title={`Insert between the tracks of ${lane.label}`}
                          />
                        )}
                        {index === lane.segments.length - 1 && (
                          <button
                            className={`boundary-add is-tail${(lane.id === mainLane?.id ? edgeFade(draft, 'tail') : trackEdgeFade(draft, segment.key, 'tail')) > 0 ? ' is-active' : ''}${openBoundary?.laneId === lane.id && openBoundary.at === 'tail' ? ' is-open' : ''}`}
                            onClick={(event) => { event.stopPropagation(); setOpenBoundary(openBoundary?.laneId === lane.id && openBoundary.at === 'tail' ? null : { laneId: lane.id, at: 'tail' }) }}
                            aria-label={`Add a fade out on ${lane.label}`}
                            title={lane.id === mainLane?.id ? 'Fade out to black' : `Fade out on ${lane.label}`}
                          />
                        )}
                        {/* What the drag is about to take off either end. The window is committed on release, so
                            the clip's own box does not move while the pointer is down — the shading and the
                            readout are the whole of the gesture until then, which is what keeps the handle under
                            the pointer in a timeline whose clips are butted end to end. */}
                        {trimmable && trimming && (() => {
                          const out = segment.sourceIn + segment.sourceUsedSeconds
                          const headPx = segment.sourceUsedSeconds > 0 ? clipWidth * Math.max(0, Math.min(trimming.in, out) - segment.sourceIn) / segment.sourceUsedSeconds : 0
                          const tailPx = segment.sourceUsedSeconds > 0 ? clipWidth * Math.max(0, out - Math.max(trimming.out, segment.sourceIn)) / segment.sourceUsedSeconds : 0
                          // EXPANSION has its own drawer, drawn OUTSIDE the clip's box: the box does not move until
                          // release, so what a handle ADDS would otherwise show nothing at all — the removed run
                          // shading is inside the clip and a growing one has no inside to shade. The two are told
                          // apart by their style: removal is hatched inside, growth is an amber outline outside.
                          const growHeadPx = segment.sourceUsedSeconds > 0 ? clipWidth * Math.max(0, segment.sourceIn - trimming.in) / segment.sourceUsedSeconds : 0
                          const growTailPx = segment.sourceUsedSeconds > 0 ? clipWidth * Math.max(0, trimming.out - out) / segment.sourceUsedSeconds : 0
                          return <>
                            {headPx > 0.5 && <span className="clip-trim-shade is-head" style={{ width: `${Math.min(clipWidth, headPx)}px` }} aria-hidden="true" />}
                            {tailPx > 0.5 && <span className="clip-trim-shade is-tail" style={{ width: `${Math.min(clipWidth, tailPx)}px` }} aria-hidden="true" />}
                            {growHeadPx > 0.5 && <span className="clip-trim-grow is-head" style={{ width: `${growHeadPx}px` }} aria-hidden="true" />}
                            {growTailPx > 0.5 && <span className="clip-trim-grow is-tail" style={{ width: `${growTailPx}px` }} aria-hidden="true" />}
                            {/* And the pulled edge is marked INSIDE the clip, so growth is visible even where the
                                outside drawer has no room — the FIRST clip's head grows off the left edge of the
                                scroll area, which clips the drawer and left the drag with nothing to read but the
                                readout. The marker cannot be clipped: it is inside the box. */}
                            {growHeadPx > 0.5 && <span className="clip-trim-grow-edge is-head" aria-hidden="true" />}
                            {growTailPx > 0.5 && <span className="clip-trim-grow-edge is-tail" aria-hidden="true" />}
                          </>
                        })()}
                        {trimmable && (
                          <>
                            <span className="clip-trim-handle is-in" onPointerDown={(event) => beginTrimDrag(event, segment, 'in', lane)} role="presentation" title="Drag to trim this clip's head" />
                            <span className="clip-trim-handle is-out" onPointerDown={(event) => beginTrimDrag(event, segment, 'out', lane)} role="presentation" title="Drag to trim this clip's tail" />
                            {trimming && <span className="clip-trim-readout">{stamp(Math.max(0, trimming.out - trimming.in))}</span>}
                          </>
                        )}
                      </div>
                      )
                    })}
                    {lane.id === EMPTY_AUDIO_LANE_ID && (
                      // An empty lane's own [+], in its very first frame: the only way to put sound on a job
                      // that has none, without reopening it from the queue. It offers ADD SOURCE and nothing
                      // else — there is no clip to fade and no cut to join.
                      <button
                        className={`boundary-add is-lane-empty${openBoundary?.laneId === lane.id ? ' is-open' : ''}`}
                        onClick={(event) => { event.stopPropagation(); setOpenBoundary(openBoundary?.laneId === lane.id ? null : { laneId: lane.id, at: 'head' }) }}
                        aria-label={`Add a source to ${lane.label}`}
                        title={`Add a source to ${lane.label}`}
                      />
                    )}
                    {laneGap(lane) > 0 && <div className="timeline-fill" style={{ width: `${laneWidthFor(laneGap(lane), zoom)}px` }} title="No media on this lane" />}
                  </div>
                </div>
              ))}
              <div className="timeline-playhead" style={{ left: `${playheadFraction * laneWidthFor(duration, zoom)}px` }} onPointerDown={beginSkimmerDrag} title="Drag to move the skimmer" role="presentation" />
              </div>
            </div>
          </div>
          {selectedBoundary && selectedBoundary.kind === 'empty' && boundaryLane && (
            // An EMPTY lane's panel: one decision, and it is where the source goes rather than what the lane
            // is. A source added here becomes a TRACK, which is what an audio lane holds.
            <div className="boundary-editor">
              <span className="boundary-title">{boundaryLane.label} // EMPTY</span>
              <span className="boundary-divider" aria-hidden="true" />
              <button className="boundary-source" onClick={() => { setOpenBoundary(null); void insertTrackSources(0) }} title="Add a source to this lane">ADD SOURCE</button>
              <button className="boundary-close" onClick={() => setOpenBoundary(null)} aria-label="Close the add-source panel">x</button>
            </div>
          )}
          {selectedBoundary && selectedBoundary.kind === 'track-cut' && boundaryLane && (
            // A cut between two SEQUENCED tracks: a place a source can be inserted into the track list. A fade
            // across it is not written by the concat graph, so it is said rather than offered.
            <div className="boundary-editor">
              <span className="boundary-title">{boundaryLane.label} // CUT {selectedBoundary.index + 1}|{selectedBoundary.index + 2}</span>
              <span className="boundary-divider" aria-hidden="true" />
              <button className="boundary-source" onClick={() => { const at = selectedBoundary.index + 1; setOpenBoundary(null); void insertTrackSources(at) }} title="Insert a source between these two tracks">ADD SOURCE</button>
              <span className="boundary-clamped">A FADE ACROSS SEQUENCED TRACKS IS NOT WRITTEN</span>
              <button className="boundary-close" onClick={() => setOpenBoundary(null)} aria-label="Close this panel">x</button>
            </div>
          )}
          {selectedBoundary && selectedBoundary.kind !== 'empty' && selectedBoundary.kind !== 'track-cut' && (() => {
            const set = (type: TransitionType, duration?: number) => {
              if (selectedBoundary.kind === 'cut') { setBoundaryTransition(selectedBoundary.index, type, duration); return }
              // An edge on the MAIN lane is the timeline's own; on an added track it is that clip's, keyed so
              // the two lanes never share a fade.
              if (boundaryIsMainLane) setEdgeTransition(selectedBoundary.edge, type, duration)
              else applyTransition(trackEdgeFadeKey(selectedBoundary.clipKey, selectedBoundary.edge), type, duration)
            }
            const heading = selectedBoundary.kind === 'edge'
              ? (selectedBoundary.edge === 'head'
                ? (boundaryIsMainLane ? 'FADE IN FROM BLACK' : 'FADE IN')
                : (boundaryIsMainLane ? 'FADE OUT TO BLACK' : 'FADE OUT'))
              : `CUT ${selectedBoundary.index + 1}|${selectedBoundary.index + 2}`
            return <div className="boundary-editor">
              <span className="boundary-title">{heading}</span>
              <div className="boundary-options">
                <button className={selectedBoundary.requested > 0 ? '' : 'is-selected'} onClick={() => set('none')}>OFF</button>
                <button className={selectedBoundary.requested > 0 ? 'is-selected' : ''} onClick={() => set('fade', selectedBoundary.requested || Math.min(0.5, selectedBoundary.maxFade) || 0.25)}>FADE</button>
                <button disabled title="Crossfade overlaps the clips and needs the encoder rework planned next.">X-FADE</button>
              </div>
              {selectedBoundary.requested > 0 && (
                <div className="boundary-duration" title={`Longest fade that fits here: ${selectedBoundary.maxFade.toFixed(2)}s`}>
                  <button onClick={() => set('fade', Math.max(0.25, selectedBoundary.requested - 0.25))} disabled={selectedBoundary.requested <= 0.25} aria-label="Shorter fade">-</button>
                  <span className="boundary-duration-value">{selectedBoundary.requested.toFixed(2)}s</span>
                  <button onClick={() => set('fade', selectedBoundary.requested + 0.25)} aria-label="Longer fade">+</button>
                  {selectedBoundary.fade < selectedBoundary.requested && <small className="boundary-clamped">RENDERS {selectedBoundary.fade.toFixed(2)}s</small>}
                </div>
              )}
              {/* The panel's SECOND decision, after a rule: what is placed AT this cut. The place is the one
                  the [+] stood for — before the first clip, between two, or after the last. On an added
                  audio lane it is a place in the TRACK list, so the source lands beside that track. */}
              <span className="boundary-divider" aria-hidden="true" />
              <button
                className="boundary-source"
                onClick={() => {
                  if (!boundaryLane) return
                  if (boundaryIsMainLane) {
                    const at = selectedBoundary.kind === 'edge'
                      ? (selectedBoundary.edge === 'head' ? 0 : latest().sourcePaths.length)
                      : selectedBoundary.index + 1
                    setOpenBoundary(null)
                    void insertSources(at)
                  } else {
                    const trackIndex = model.lanes.findIndex((lane) => lane.id === boundaryLane.id) - 1
                    const at = selectedBoundary.kind === 'edge' && selectedBoundary.edge === 'tail' ? trackIndex + 1 : trackIndex
                    setOpenBoundary(null)
                    void insertTrackSources(at)
                  }
                }}
                title="Add a source at this place in the join"
              >ADD SOURCE</button>
              <button className="boundary-close" onClick={() => setOpenBoundary(null)} aria-label="Close transition editor">x</button>
            </div>
          })()}
          {audioChoice && (
            // THE FIRST SOUND ASKS HOW THE TRACKS RELATE. The files are held rather than inserted until the
            // choice is made, and the answer is the job's `comboMode` — the same field the queue's own card
            // switches, so the two windows agree about it.
            <div className="boundary-editor">
              <span className="boundary-title">ADD AUDIO AS</span>
              <div className="boundary-options">
                <button onClick={() => { const choice = audioChoice; setAudioChoice(null); applyInsert(choice.position, choice.visuals, choice.audios, 'multitrack') }} title="The tracks play together, each from zero">MULTI-TRACK</button>
                <button onClick={() => { const choice = audioChoice; setAudioChoice(null); applyInsert(choice.position, choice.visuals, choice.audios, 'stitch') }} title="The tracks play one after another, on one lane">STITCH TRACKS</button>
              </div>
              <button className="boundary-close" onClick={() => setAudioChoice(null)} aria-label="Cancel adding audio">x</button>
            </div>
          )}
          {model.unusedVideoSources.length > 0 && <div className="editor-note">&gt; {model.unusedVideoSources.length} EXTRA VIDEO SOURCE(S) ({model.unusedVideoSources.map(sourceName).join(', ')}) ARE NOT USED HERE: THIS JOB MAPS ONE VIDEO STREAM. A STITCH JOB CONCATENATES THEM.</div>}
          {showBoundaries && <div className="editor-note">&gt; [+] ON A CUT FADES BOTH SIDES OF IT; [+] AT THE TIMELINE'S ENDS FADES FROM OR TO BLACK. THE ENCODER APPLIES THEM AND THE MONITOR MIRRORS THEM.</div>}
          <div className="editor-note">&gt; LANE WIDTHS ARE THE REAL TRIMMED DURATIONS; AUDIO PLAYS ALONGSIDE THE VIDEO FROM ZERO, SO THE OUTPUT RUNS TO {duration > 0 ? stamp(duration) : 'AN UNKNOWN LENGTH'}.</div>
          </>}
        </section>
      </main>

      <aside className="export-sidebar">
        <div className="export-title">EXPORT SETTINGS</div>
        <div className="export-tabs">{tabsShown.map((name) => <button key={name} className={activeTab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</div>
        <div className="export-content">
          {activeTab === 'EXPORT' && <>
            <EditorField label="FORMAT"><EditorSelect value={container} options={CONTAINERS.map((name) => ({ value: name, label: name.toUpperCase() }))} onChange={(next) => changeContainer(next as EncodingPreset['container'])} /></EditorField>
            <EditorField
              label="PRESET"
              reason={audioOnly ? 'THIS FORMAT CARRIES SOUND ONLY, SO THERE IS NO PICTURE TO WRITE.' : undefined}
              canReset={codecChoiceValue(draft.preset) !== defaultCodecChoiceValue(container)}
              onReset={() => updatePreset(applyCodecChoice(latest().preset, defaultCodecChoiceValue(container)))}
            ><EditorSelect
              value={codecChoiceValue(draft.preset)}
              options={codecChoicesFor(container).map((choice) => ({ value: choice.value, label: choice.label, disabled: Boolean(choice.reason), title: choice.reason }))}
              disabled={audioOnly}
              onChange={(next) => updatePreset(applyCodecChoice(latest().preset, next))}
              ariaLabel="What the picture is written as"
            /></EditorField>
            <EditorField
              label="OUTPUT NAME"
              canReset={Boolean(draft.outputFilenameManuallySet)}
              onReset={() => updateDraft({ outputFilename: deriveOutputFilename(latest(), latest().preset, container), outputFilenameManuallySet: false })}
            ><input type="text" className="editor-input" value={draft.outputFilename} onChange={(event) => updateDraft({ outputFilename: event.target.value, outputFilenameManuallySet: true })} /></EditorField>
            <EditorRow label="PRESET NAME" value={presetEdited ? 'CUSTOM' : draft.preset.name} reason={presetEdited ? presetSummary(draft.preset).join('\n') : undefined} />
            {/* WHAT EACH STREAM'S PRESENCE IS HERE, and WHY one of them is held in place. A container that
                carries only one of them cannot have the other switched on — a WAV with no sound is nothing
                at all — and the last stream standing cannot be switched off either, so unchecking one forces
                the other back on and then locks it where it is. At least one of the two is always written. */}
            <EditorToggle
              label="EXPORT VIDEO"
              checked={audioOnly ? false : !streamOff.video}
              onChange={audioOnly || soundNeverPossible || streamOff.audio ? undefined : (checked) => updatePreset(checked ? { outputMode: undefined } : { outputMode: 'audio', audioEnabled: undefined })}
              reason={audioOnly ? 'THIS FORMAT CARRIES SOUND ONLY, SO THERE IS NO PICTURE TO WRITE.' : soundNeverPossible ? 'THIS FORMAT CARRIES NO SOUND, SO THE PICTURE IS ALWAYS WRITTEN.' : streamOff.audio ? 'THE PICTURE IS THE ONLY STREAM LEFT, SO IT CANNOT BE SWITCHED OFF.' : undefined}
            />
            <EditorToggle
              label="EXPORT AUDIO"
              checked={audioOnly ? true : soundNeverPossible ? false : !streamOff.audio}
              onChange={audioOnly || soundNeverPossible || streamOff.video ? undefined : (checked) => updatePreset(checked ? { audioEnabled: undefined } : { audioEnabled: false, outputMode: undefined })}
              reason={audioOnly ? 'THIS FORMAT CARRIES SOUND ONLY, SO IT IS ALWAYS WRITTEN.' : soundNeverPossible ? 'THIS FORMAT CARRIES NO AUDIO TRACK.' : streamOff.video ? 'THE SOUND IS THE ONLY STREAM LEFT, SO IT CANNOT BE SWITCHED OFF.' : undefined}
            />
            <EditorToggle label="EXPORT CAPTIONS" checked={false} reason="CAPTION OUTPUT HAS NO BACKING FIELD YET." />
          </>}

              {/* Resolution Scaling */}
            {activeTab === 'VIDEO' && <>
            {/* Three groups rather than eight foldouts: a group is a decision about the OUTPUT, and the
                settings inside one are read together or not at all. Folding a single field away would be
                a heading that only repeats the row beneath it. */}
            <EditorGroup id="output-frame" label="OUTPUT FRAME" hint="SHAPE AND SIZE" reason="What the encoder writes: the shape of the frame, the box it is scaled into, and an exact size that overrides both." collapsed={collapsedSections.includes('output-frame')} onToggle={toggleSection}>
            <div className="editor-field"><span>ASPECT RATIO<em>OUTPUT FRAME</em></span>
              <div className="aspect-row">
                {ASPECTS.map((candidate) => (
                  <button key={candidate.label} className={activeAspect === candidate.label ? 'is-selected' : ''} onClick={() => applyAspect(candidate.ratio)} title={`Output frame of ${candidate.label}`}>{candidate.label}</button>
                ))}
                <button className={matchSource || matchSourceChosen ? 'is-selected' : ''} onClick={applyMatchSource} title="Match the frame to the picture in hand: its shape and its own pixel size">MS</button>
              </div>
            </div>
            <EditorField
              label="RESOLUTION"
              reason={videoReason}
              canReset={draft.preset.resolution !== 'source'}
              onReset={() => updatePreset({ resolution: 'source', width: undefined, height: undefined })}
            ><EditorSelect value={draft.preset.resolution} options={RESOLUTIONS.map((name) => ({ value: name, label: name.toUpperCase() }))} disabled={audioOnly || isGif} onChange={(next) => changeResolution(next as EncodingPreset['resolution'])} /></EditorField>
            <div className="editor-field"><span>EXACT SIZE<em>OVERRIDES RESOLUTION</em></span>
              <div className="exact-row">
                <label className="mini-field"><span>W</span><NumberField min={2} step={2} className="editor-input" value={draft.preset.width} placeholder={outputFrame ? String(outputFrame.width) : '-'} disabled={audioOnly || isGif} onValue={(value) => setExactEdge('width', value)} title="Output width in pixels" /></label>
                <label className="mini-field"><span>H</span><NumberField min={2} step={2} className="editor-input" value={draft.preset.height} placeholder={outputFrame ? String(outputFrame.height) : '-'} disabled={audioOnly || isGif} onValue={(value) => setExactEdge('height', value)} title="Output height in pixels" /></label>
                <button className={`exact-icon${lockProportion ? ' is-on' : ''}`} aria-pressed={lockProportion} onClick={() => setLockProportion((on) => !on)} title={lockProportion ? 'Proportions locked' : 'Keep proportions'}>{lockProportion ? <Link size={12} /> : <Unlink size={12} />}</button>
                <button className="exact-icon" disabled={!exactSet} onClick={clearExactSize} title="Clear exact size" aria-label="Clear exact size"><RotateCcw size={12} /></button>
              </div>
            </div>
            </EditorGroup>
            <EditorGroup id="framing" label="FRAMING" hint="PER CLIP" reason="What each clip is framed with: what part of its source is kept, the margin it leaves, and where the picture is placed inside the frame. Starts folded because it is per clip rather than per job." collapsed={collapsedSections.includes('framing')} onToggle={toggleSection} actions={<>
              {/* ONE unit switch for the whole section: it governs all three of its controls, and each
                  reads it against its OWN rectangle rather than a shared one — per cent is a share of
                  the source for the crop and of the output frame for the insets and the offset, and a
                  pixel is the source's own for the one and the frame's for the other two. The figures
                  are stored as fractions either way, so the switch changes only how a field reads. No
                  reset here: the reset belongs to the four figures it puts back, so it sits at the end
                  of their own row rather than in a heading that would have to be read to work out what
                  it resets. */}
              <div className="unit-toggle">
                <button className={framingUnit === '%' ? 'is-on' : ''} onClick={() => setFramingUnit('%')} title="Per cent: of the source for the crop, of the output frame for the insets and the offset">%</button>
                <button className={framingUnit === 'px' ? 'is-on' : ''} disabled={!outputFrame} onClick={() => setFramingUnit('px')} title={outputFrame ? "Pixels: the source's own for the crop, the output frame's for the insets and the offset" : 'THE OUTPUT FRAME IS NOT KNOWN YET.'}>px</button>
              </div>
            </>}>
            <div className="editor-subsection">
              <div className="crop-title">
                <span className="editor-label">CROP</span>
                <EditorInfo text={CROP_HELP} />
              </div>
              <div className="crop-head">
                {/* The shape list is the switch as well: NONE is one of its entries, so choosing to
                    have no crop is the same gesture as choosing its shape rather than a control of its
                    own that had to ask before it could make its mind up. */}
                <EditorSelect
                  value={cropShape}
                  disabled={!naturalAspect && cropShape !== NO_CROP}
                  options={[
                    { value: NO_CROP, label: NO_CROP },
                    { value: FREEFORM, label: FREEFORM },
                    ...ASPECTS.map((candidate) => ({ value: candidate.label, label: candidate.label })),
                  ]}
                  onChange={applyCropProportion}
                  title={!naturalAspect ? 'THE PICTURE HAS NOT LOADED, SO ITS SHAPE IS UNKNOWN.' : 'NONE leaves the source whole; FREEFORM holds no shape at all, so a corner follows the pointer on both axes; a named shape centres the region on it.'}
                  ariaLabel="The shape the crop holds"
                />
                {/* A padlock rather than a checkbox, and next to the list it holds: what it locks is the
                    SHAPE being chosen, so it belongs where the shape is chosen rather than on a line of
                    its own below the four figures. */}
                <button
                  className={`exact-icon${lockRatio ? ' is-on' : ''}`}
                  aria-pressed={Boolean(lockRatio)}
                  disabled={!naturalAspect || !outputFrame}
                  onClick={() => setCropLock(!draft.preset.cropLockToOutput)}
                  title="Lock Crop to Output AR"
                  aria-label="Lock Crop to Output AR"
                >{lockRatio ? <Lock size={11} /> : <Unlock size={11} />}</button>
              </div>
              {cropEnabled && crop && <>
                <div className="crop-row">
                  {(['left', 'top', 'right', 'bottom'] as const).map((edge) => (
                    <label key={edge} className="mini-field">
                      <span>{edge.slice(0, 1).toUpperCase()}</span>
                      <NumberField
                        min={0}
                        max={framingUnit === 'px' && picture
                          ? Math.round((1 - MIN_KEPT - crop[OPPOSITE_EDGE[edge]]) * (edge === 'left' || edge === 'right' ? picture.width : picture.height))
                          : Math.round((1 - MIN_KEPT - crop[OPPOSITE_EDGE[edge]]) * 100)}
                        step={1}
                        className="editor-input"
                        value={framingUnit === 'px' && cropPx ? cropPx[edge] : Math.round(crop[edge] * 100)}
                        onValue={(raw) => setCropEdge(edge, raw)}
                        title={`${edge} edge, ${framingUnit === 'px' ? 'pixels' : 'per cent'} of the source`}
                      />
                    </label>
                  ))}
                  <button className="exact-icon" onClick={() => applyCropProportion(NO_CROP)} title="Take the crop away" aria-label="Take the crop away"><RotateCcw size={11} /></button>
                </div>
                {perClipFraming && (
                  <div className="crop-actions">
                    <span>THIS CLIP</span>
                    <button className="crop-apply" onClick={applyCropToAll} title="Put this clip's crop on every clip in the job - or, with NONE chosen, leave every clip whole">APPLY TO ALL</button>
                  </div>
                )}
              </>}
              {/* Outside the region's own block, because a crop of NOTHING is still a crop to hand on:
                  with NONE chosen this is the one gesture that leaves every clip whole, which is what the
                  question that used to ask about it did. */}
              {!cropEnabled && perClipFraming && (
                <div className="crop-actions">
                  <span>THIS CLIP{' - UNCROPPED'}</span>
                  <button className="crop-apply" onClick={applyCropToAll} title="Leave every clip whole">APPLY TO ALL</button>
                </div>
              )}
            </div>
            {/* The margins this clip leaves at the edges of the output, and where the picture sits inside
                them. Two controls, one answer, so they share the section's unit switch and its one
                reset rather than carrying a copy of each — see the FRAMING heading above. */}
            <div className="editor-field">
              <span><span className="editor-label">INSETS</span><EditorInfo text={INSETS_HELP} /></span>
              <div className="crop-row">
                {(['l', 't', 'r', 'b'] as const).map((edge) => {
                  const span = outputFrame ? (edge === 'l' || edge === 'r' ? outputFrame.width : outputFrame.height) : 0
                  const inPixels = framingUnit === 'px' && span > 0
                  return (
                    <label key={edge} className="mini-field"><span>{edge.toUpperCase()}</span>
                      <NumberField
                        step={1}
                        className="editor-input"
                        value={inPixels ? Math.round(activeInsets[edge] * span) : Math.round(activeInsets[edge] * 100)}
                        onValue={(raw) => setInsets({ [edge]: inPixels ? raw / span : raw / 100 })}
                        title={`${edge.toUpperCase()} margin, ${inPixels ? 'pixels' : 'per cent'} of the output frame`}
                      />
                    </label>
                  )
                })}
                <button className="exact-icon" disabled={!activeFitKey || !hasInsets(activeInsets)} onClick={() => setInsets({ l: 0, t: 0, r: 0, b: 0 })} title="Take the margins away" aria-label="Take the margins away"><RotateCcw size={11} /></button>
              </div>
            </div>
            <div className="editor-divider" aria-hidden="true" />
            <div className="editor-field">
              <span><span className="editor-label">OFFSET</span><EditorInfo text={OFFSET_HELP} /></span>
              <div className="crop-row is-two">
                {(['x', 'y'] as const).map((axis) => {
                  const span = outputFrame ? (axis === 'x' ? outputFrame.width : outputFrame.height) : 0
                  const inPixels = framingUnit === 'px' && span > 0
                  const value = axis === 'x' ? pictureOffset.x : pictureOffset.y
                  // The setter works in the frame's own fractions, so a pixel entry is divided by the
                  // axis it was read along; the figure NOT being edited is carried through as a
                  // fraction too, whatever unit it happens to be shown in.
                  const keep = Math.round((axis === 'x' ? pictureOffset.y : pictureOffset.x) * 100)
                  const next = (raw: number) => (inPixels ? (raw / span) * 100 : raw)
                  return (
                    <label key={axis} className="mini-field"><span>{axis.toUpperCase()}</span>
                      <NumberField
                        step={1}
                        className="editor-input"
                        value={inPixels ? Math.round(value * span) : Math.round(value * 100)}
                        onValue={(raw) => setFitOffset(axis === 'x' ? next(raw) : keep, axis === 'x' ? keep : next(raw))}
                        title={`${axis.toUpperCase()} of the output frame, ${inPixels ? 'in pixels' : 'in per cent'}`}
                      />
                    </label>
                  )
                })}
                <button className="exact-icon" disabled={!activeFitKey || (pictureOffset.x === 0 && pictureOffset.y === 0)} onClick={() => setFitOffset(0, 0)} title="Centre the picture" aria-label="Centre the picture"><RotateCcw size={11} /></button>
              </div>
            </div>
            </EditorGroup>
            <EditorGroup id="encoding" label="ENCODING" hint="RATE AND QUALITY" reason="How the output is encoded: the frame rate it is written at, and the bitrate it is written to." collapsed={collapsedSections.includes('encoding')} onToggle={toggleSection}>
            {/* The two micro-labels this section carried are in the fields now: what a blank FPS means,
                and what a quality figure looks like. A label beside a field is read as a title for it;
                a placeholder is read as what to put in it. */}
            <EditorField
              label="FPS"
              hint={draft.preset.fps === undefined && draft.preset.fpsRate === undefined ? 'FROM THE SOURCE' : undefined}
              reason={audioOnly ? 'THIS CONTAINER CARRIES AUDIO ONLY.' : `The rate the whole output is written at, fixed for the job rather than bound to any one clip: a rate named here is the rate every frame is counted at, and the rate the OUTPUT FRAME totals are worked out from. Left at SOURCE it is the first clip's own rate, read once and held (${rateRationalLabel(outputRate)}), so retiming or removing that clip does not move the output under the frames already counted for it.`}
              canReset={draft.preset.fps !== undefined || draft.preset.fpsRate !== undefined}
              onReset={() => { setOutFpsCustomText(null); updatePreset({ fps: undefined, fpsRate: undefined }) }}
            >{(() => {
              const named = draft.preset.fpsRate !== undefined || draft.preset.fps !== undefined
              const chosen = RATE_PRESETS.find((entry) => ratesEqual(entry.rate, outputRate))
              return <EditorSelect
                value={chosen ? `${chosen.rate.num}/${chosen.rate.den}` : named ? 'custom' : 'source'}
                options={[
                  { value: 'source', label: `SOURCE | ${rateLabel(defaultOutputRate)}` },
                  ...RATE_PRESETS.map((entry) => ({ value: `${entry.rate.num}/${entry.rate.den}`, label: `${entry.label} FPS` })),
                  { value: 'custom', label: named && !chosen ? `CUSTOM... (${rateLabel(outputRate)})` : 'CUSTOM...' },
                ]}
                disabled={audioOnly}
                onChange={(next) => {
                  if (next === 'source') { setOutFpsCustomText(null); updatePreset({ fps: undefined, fpsRate: undefined }); return }
                  if (next === 'custom') { setOutFpsCustomText(String(Number(rateValue(outputRate).toFixed(3)))); return }
                  const [num, den] = next.split('/').map(Number)
                  setOutFpsCustomText(null)
                  updatePreset({ fps: undefined, fpsRate: makeRate(num, den) })
                }}
                ariaLabel="The rate the whole output is written at"
              />
            })()}</EditorField>
            {outFpsCustomText !== null && !audioOnly && <EditorField label="CUSTOM FPS" reason="A rate of the job's own for the whole output, in frames a second. Kept as the exact rational it is written as and reduced, so a fraction like 23.976 does not drift a frame over a long reel.">
              <NumberField min={1} max={240} step={0.001} className="editor-input" value={Number(outFpsCustomText) || undefined} onValue={(value) => { if (value > 0) { setOutFpsCustomText(String(value)); updatePreset({ fps: undefined, fpsRate: rateOf(value) }) } }} />
            </EditorField>}
            {/* DEPTH. ProRes decides it by PROFILE and nothing else, so it is read rather than chosen;
                H.264 and H.265 genuinely take both and get the choice; every other codec here has no such
                setting to offer, so the field is not drawn for them at all. */}
            {depthKind && <EditorField
              label="DEPTH"
              hint={depthKind === 'profile' ? 'FROM THE PROFILE' : undefined}
              reason={depthKind === 'profile'
                ? `A ProRes profile decides its own depth: the 422 family is ten bits a sample and the 4444 family is twelve with an alpha plane beside it. There is no eight-bit ProRes and no sixteen-bit one, so this is a reading rather than a control — ${proresDepthLabel(draft.preset.proresProfile)}.`
                : 'The samples a sample is stored in. Eight is what every player opens; ten keeps a banded gradient from banding further on its way through a grade. At a bitrate the job names the two are the SAME file size — the depth spends the rate on a different picture rather than on more of it — so this changes what the picture looks like rather than how big the file is. The software encoder writes it; the hardware one is left at eight.'}
              canReset={depthKind === 'choice' && draft.preset.videoBitDepth !== undefined}
              onReset={() => updatePreset({ videoBitDepth: undefined })}
            >{depthKind === 'profile'
              ? <input className="editor-input" type="text" value={proresDepthLabel(draft.preset.proresProfile)} readOnly aria-label="The depth the picture is written at" />
              : <EditorSelect
                value={String(draft.preset.videoBitDepth ?? 8)}
                options={[{ value: '8', label: '8-BIT' }, { value: '10', label: '10-BIT' }]}
                onChange={(next) => updatePreset({ videoBitDepth: Number(next) === 10 ? 10 : 8 })}
                ariaLabel="The depth the picture is written at"
              />}</EditorField>}
            {/* BITRATE, which is what this field always was: it takes a figure in bits a second, and calling
                it QUALITY made a rate look like a quality. It is drawn only where the codec HAS a rate —
                ProRes is a family of fixed rates and the intra-only codecs have none — so a reader is not
                offered a box the encoder would ignore. */}
            <EditorField
              label="BITRATE"
              hint={ratePossible ? undefined : 'SET BY THE CODEC'}
              reason={rateReason}
              canReset={draft.preset.videoBitrate !== undefined}
              onReset={() => updatePreset({ videoBitrate: undefined })}
            ><input
              type="text"
              className="editor-input"
              aria-label="The bitrate the picture is written at"
              value={draft.preset.videoBitrate ?? ''}
              placeholder={ratePossible ? 'SOURCE | E.G. 8M' : '--'}
              disabled={!ratePossible}
              onChange={(event) => updatePreset({ videoBitrate: event.target.value.trim() || undefined })}
            /></EditorField>
            </EditorGroup>
          </>}

          {/* THE IMAGE TAB. What it holds belongs to the FORMAT rather than to the job, which is why it is a
              tab of its own: a PNG's compression, a JPEG's quality and a GIF's loop have nothing to say to
              one another. IMAGE OUTPUT leads because it is the one question all three ask — and because a
              single frame and a run of them are two different outputs of the same picture. */}
          {activeTab === 'IMAGE' && framesPossible && <>
            <EditorField
              label="IMAGE OUTPUT"
              reason="Whether the format writes ONE file or a numbered run of single frames. A sequence names each file with a frame number and any sound is dropped, because a frame has none; SINGLE FRAME writes the frame under the playhead. A GIF is offered all three: its animation, that same run, and the one still it can hold."
              canReset={imageOutputChoiceValue(draft.preset) !== defaultImageOutputChoiceValue(container)}
              onReset={() => updatePreset(applyImageOutputChoice(latest().preset, defaultImageOutputChoiceValue(container)))}
            ><EditorSelect
              value={imageOutputChoiceValue(draft.preset)}
              options={imageOutputChoicesFor(container).map((choice) => ({ value: choice.value, label: choice.label }))}
              onChange={(next) => updatePreset(applyImageOutputChoice(latest().preset, next))}
              ariaLabel="Whether the format writes one file or a numbered run of frames"
            /></EditorField>
            {container === 'gif' && <EditorField
              label="LOOP"
              reason="What the animation does at its end: played through ONCE, repeated for ever, or turned around and played back again, which is a bounce. It belongs to the ANIMATION, so it is not offered for a run of frames — a run has no end to reach."
              canReset={draft.preset.gifMode !== undefined && draft.preset.gifMode !== 'loop'}
              onReset={() => updatePreset({ gifMode: 'loop' })}
            ><EditorSelect
              value={draft.preset.gifMode ?? 'loop'}
              options={[{ value: 'regular', label: 'ONCE' }, { value: 'loop', label: 'LOOP' }, { value: 'bounce', label: 'BOUNCE' }]}
              disabled={draft.preset.imageOutputMode === 'sequence'}
              onChange={(next) => updatePreset({ gifMode: next as NonNullable<EncodingPreset['gifMode']> })}
              ariaLabel="What the animation does at its end"
            /></EditorField>}
            {container === 'png' && <>
              <EditorField
                label="COMPRESSION"
                hint="TIME FOR SIZE"
                reason="How hard the PNG encoder works. A PNG is lossless at every setting, so this trades the TIME spent writing the file against its SIZE and never a pixel: 9 is the smallest file and the slowest to write, 0 the largest and the quickest."
                canReset={draft.preset.pngCompression !== undefined}
                onReset={() => updatePreset({ pngCompression: undefined })}
              ><span className="field-pair">
                <EditorSelect
                  value={compressionCustom ? 'custom' : draft.preset.pngCompression === undefined ? 'default' : String(draft.preset.pngCompression)}
                  options={[
                    { value: 'default', label: 'ENCODER DEFAULT' },
                    ...PNG_COMPRESSION_CHOICES.map((level) => ({ value: String(level), label: level === 0 ? '0 (FASTEST)' : level === 9 ? '9 (SMALLEST)' : String(level) })),
                    { value: 'custom', label: 'CUSTOM...' },
                  ]}
                  onChange={(next) => updatePreset({ pngCompression: next === 'default' ? undefined : next === 'custom' ? 7 : Number(next) })}
                  ariaLabel="How hard the PNG encoder works"
                />
                {compressionCustom && <NumberField
                  className="editor-input"
                  min={0}
                  max={9}
                  step={1}
                  value={draft.preset.pngCompression}
                  onValue={(level) => updatePreset({ pngCompression: Math.max(0, Math.min(9, Math.round(level))) })}
                  ariaLabel="The PNG compression level, 0 to 9"
                />}
              </span></EditorField>
              <EditorField
                label="BIT DEPTH"
                reason="The samples a channel is stored in. Eight is what a player opens and what a delivery frame is; sixteen is for a frame on its way into a compositor, where the extra room is the point — and it is twice the samples per channel."
                canReset={draft.preset.imageBitDepth !== undefined}
                onReset={() => updatePreset({ imageBitDepth: undefined })}
              ><EditorSelect
                value={String(draft.preset.imageBitDepth ?? 8)}
                options={IMAGE_BIT_DEPTHS.map((depth) => ({ value: String(depth), label: `${depth}-BIT${depth === 8 ? ' (DELIVERY)' : ''}` }))}
                onChange={(next) => updatePreset({ imageBitDepth: Number(next) === 16 ? 16 : 8 })}
                ariaLabel="The samples a channel is stored in"
              /></EditorField>
            </>}
            {container === 'jpg' && <EditorField
              label="QUALITY"
              hint="LOWER IS BETTER"
              reason="The JPEG encoder's quality, in ffmpeg's own `-q:v` figures, which run DOWNWARDS: a lower figure is a better picture and a larger file. It is the one image setting that trades SIZE against the picture rather than against the time spent writing it."
              canReset={draft.preset.jpegQuality !== undefined}
              onReset={() => updatePreset({ jpegQuality: undefined })}
            ><span className="field-pair">
              <EditorSelect
                value={qualityCustom ? 'custom' : draft.preset.jpegQuality === undefined ? 'default' : String(draft.preset.jpegQuality)}
                options={[
                  { value: 'default', label: 'ENCODER DEFAULT' },
                  ...JPEG_QUALITY_CHOICES.map((quality) => ({ value: String(quality), label: quality === 2 ? '2 (BEST)' : quality === 31 ? '31 (SMALLEST)' : String(quality) })),
                  { value: 'custom', label: 'CUSTOM...' },
                ]}
                onChange={(next) => updatePreset({ jpegQuality: next === 'default' ? undefined : next === 'custom' ? 6 : Number(next) })}
                ariaLabel="The JPEG encoder's quality"
              />
              {qualityCustom && <NumberField
                className="editor-input"
                min={1}
                max={31}
                step={1}
                value={draft.preset.jpegQuality}
                onValue={(quality) => updatePreset({ jpegQuality: Math.max(1, Math.min(31, Math.round(quality))) })}
                ariaLabel="The JPEG quality, 1 to 31"
              />}
            </span></EditorField>}
            <div className="editor-note">&gt; A RUN OF FRAMES NAMES EACH FILE WITH ITS FRAME NUMBER, SO THE OUTPUT NAME IS A PATTERN TOO. THE RATE IN THE VIDEO TAB IS THE ANIMATION'S OWN AND DOES NOT RESAMPLE A RUN.</div>
          </>}

          {activeTab === 'AUDIO' && <>
            {/* What the file IS, above what the export will make of it: the two are read together, and the
                answer comes off the probe this window already made for the source under the playhead. */}
            <EditorRow
              label="SOURCE AUDIO"
              value={tabAudioSource ? (tabAudioFacts ?? 'NO SOUND') : 'PROBING...'}
              reason={tabAudioSource && tabAudioCodec ? `${sourceName(tabAudioSource)} - ${tabAudioCodec}.` : undefined}
            />
            <EditorField
              label="CODEC"
              reason={audioReason}
              canReset={audioChoiceValue(draft.preset) !== defaultAudioChoiceValue(container)}
              onReset={() => updatePreset(applyAudioChoice(latest().preset, defaultAudioChoiceValue(container)))}
            ><EditorSelect
              value={audioChoiceValue(draft.preset)}
              options={audioChoicesFor(container).map((choice) => ({ value: choice.value, label: choice.label, disabled: Boolean(choice.reason), title: choice.reason }))}
              disabled={audioDisabled}
              onChange={(next) => updatePreset(applyAudioChoice(latest().preset, next))}
              ariaLabel="What the sound is written as"
            /></EditorField>
            {/* A rung of the encoder's own ladder, or a figure of the user's — and NOTHING AT ALL where the codec
                has no bitrate to set, because a lossless encoder writes what the samples are. */}
            {bitrateApplies(draft.preset.audioCodec) && <EditorField label="BITRATE" hint={bitrateCustom ? 'IN KBPS' : undefined} reason={audioReason ?? 'How many bits a second the sound is written at. A lossless codec has no such figure and is not offered one.'}>
              <span className="field-pair">
                <EditorSelect
                  value={bitrateCustom ? 'custom' : String(bitrateRung ?? 0)}
                  options={[
                    { value: '0', label: 'SOURCE' },
                    ...AUDIO_BITRATES.map((kbps) => ({ value: String(kbps), label: `${kbps} KBPS` })),
                    { value: 'custom', label: 'CUSTOM...' },
                  ]}
                  disabled={audioDisabled}
                  onChange={bitrateValueForChoice}
                  ariaLabel="The bitrate the sound is written at"
                />
                {bitrateCustom && <input type="text" className="editor-input" aria-label="Bitrate" value={draft.preset.audioBitrate ?? ''} placeholder="E.G. 320K" disabled={audioDisabled} onChange={(event) => updatePreset({ audioBitrate: event.target.value.trim() })} />}
              </span>
            </EditorField>}
            <EditorField label="SAMPLE RATE" reason={audioReason}><EditorSelect value={String(draft.preset.audioSampleRate ?? 0)} options={[{ value: '0', label: 'SOURCE' }, { value: '44100', label: '44.1 KHZ' }, { value: '48000', label: '48 KHZ' }, { value: '96000', label: '96 KHZ' }]} disabled={audioDisabled} onChange={(next) => updatePreset({ audioSampleRate: Number(next) || undefined })} /></EditorField>
            {/* THE DEPTH THE SAMPLES ARE, which only a LOSSLESS codec has: a lossy one holds a transform
                rather than samples, so a depth beside it would be a control with nothing behind it. Offered
                for the two that store samples — a WAV at eight, sixteen, twenty-four or thirty-two, and a
                FLAC at sixteen or twenty-four — and absent for the rest. */}
            {audioDepthsFor(draft.preset.audioCodec).length > 0 && <EditorField
              label="BIT DEPTH"
              reason="How many bits one sample of the export's sound is. A lossless codec writes the samples it is given, so this is the only thing that decides what they are: sixteen is what a CD is and what this app has always written, twenty-four is what a master is, and thirty-two is a working depth. Sixteen is what a job that names nothing gets, so leaving it alone changes nothing."
              canReset={draft.preset.audioBitDepth !== undefined}
              onReset={() => updatePreset({ audioBitDepth: undefined })}
            ><EditorSelect
              value={String(draft.preset.audioBitDepth ?? 16)}
              options={audioDepthsFor(draft.preset.audioCodec).map((depth) => ({ value: String(depth), label: `${depth}-BIT${depth === 16 ? ' (DEFAULT)' : ''}` }))}
              disabled={audioDisabled}
              onChange={(next) => updatePreset({ audioBitDepth: Number(next) as NonNullable<EncodingPreset['audioBitDepth']> })}
              ariaLabel="How many bits one sample of the export's sound is"
            /></EditorField>}
            {/* The one audio setting about the SHAPE of the stream rather than its quality, and the only one
                offered for a job that has sound in it: a job with none has nothing to lay out, and the field
                would be a choice about a stream that is never written. */}
            {jobSound && <EditorField label="CHANNELS" hint={draft.preset.audioChannels ? undefined : 'FROM THE SOURCE'} reason="How many channels the export writes. SOURCE keeps the path's own answer - a stitch follows the widest source it was given - and MONO or STEREO folds the mix down without a second encode. Two is the most this can ask for, because the drawing's own graph lays the stream it writes out as mono or stereo and the two halves of one split cannot be laid out differently.">
              <EditorSelect value={String(clampAudioChannels(draft.preset.audioChannels))} options={AUDIO_CHANNELS.map((option) => ({ value: String(option.value), label: option.name }))} disabled={audioDisabled} onChange={chooseAudioChannels} ariaLabel="How many channels the export writes" />
            </EditorField>}
            <EditorRow label="TRACKS" value={draft.additionalAudioTracks?.length ? `${draft.additionalAudioTracks.length + 1} (EMBEDDED + ${draft.additionalAudioTracks.length})` : '1 EMBEDDED'} />
            <div className="editor-note">&gt; ADDING AND REORDERING TRACKS ARRIVES WITH THE TRACK EDITOR.</div>
            {/* What a sound-only job is given to show. Every setting below it only exists while the
                picture is being drawn, so the section reads as one decision and its consequences. */}
            {offersPicture && <>
              <EditorField label="PICTURE SOURCE" reason="What the export is given to show when the job is nothing but sound: a black frame, the still the job already has, an image of your own with nothing drawn over it, or a drawing made from the very mix that is written, so the picture cannot disagree with the sound.">
                <EditorSelect
                  value={pictureSource}
                  options={[
                    { value: 'black', label: 'BLACK' },
                    ...(hasStill ? [{ value: 'still', label: 'STILL IMAGE' }] : []),
                    { value: 'custom', label: 'CUSTOM IMAGE...' },
                    { value: 'visualization', label: 'DRAW THE SOUND' },
                  ]}
                  onChange={(next) => updatePreset({ audioPicture: next as NonNullable<EncodingPreset['audioPicture']> })}
                  ariaLabel="What the export is given to show"
                />
              </EditorField>
              {/* A ROW rather than a FIELD, like the drawing's own IMAGE row: a field is a label, and a button
                  inside a label is a button that is pressed twice. */}
              {pictureSource === 'custom' && <EditorRow label="IMAGE" value={<button className="editor-pick" onClick={() => { void choosePictureImage() }}>{pictureImageName || 'CHOOSE...'}</button>} reason="The image the export is shown. It is held for the length of the sound and scaled into the frame with its shape kept, letterboxed on black - the same rule a drawing's uploaded background follows, with nothing drawn over it." />}
              {pictureSource === 'visualization' && <>
                <EditorField label="TEMPLATE" reason="What kind of drawing. WAVEFORM is the whole sound in one picture, held for the length of the export, which is what the monitor is showing; SPECTRUM is the same idea as a spectrogram. EQ BARS and the two SCROLL templates draw an instant at a time, so they move where the first two do not.">
                  <EditorSelect value={draft.preset.visualization ?? 'waveform'} options={VISUALIZATIONS.map((template) => ({ value: template.id, label: template.name }))} onChange={(next) => updatePreset({ visualization: next as NonNullable<EncodingPreset['visualization']> })} ariaLabel="The drawing" />
                </EditorField>
                <EditorField label="THEME" reason="The palette the drawing is made in: the app's own green, or the amber of a CRT. It settles the colour the drawing is drawn in unless the job names one of its own, and the ramp the two spectra colour themselves with - which is why those two are offered no colour field.">
                  <EditorSelect value={drawingTune.theme} options={DRAWING_THEMES.map((theme) => ({ value: theme.id, label: theme.name }))} onChange={(next) => updatePreset({ drawingTheme: next as NonNullable<EncodingPreset['drawingTheme']> })} ariaLabel="The palette the drawing is made in" />
                </EditorField>
                {templateFor(draft.preset.visualization).colour && <EditorField label="COLOUR" reason="The colour the drawing is made in. The SWATCH is the colour that will be used - the theme's own until one is picked - and clicking it opens the system picker; the field beside it takes the same colour as a hex figure, and clearing it hands the drawing back to the theme.">
                  <span className="field-pair">
                    {/* The hex field is what is TYPED and the square beside it is what is CLICKED: the square
                        shows the colour that will actually be used — the theme's own until one is picked — and
                        it opens the system picker. The picker itself is a colour input kept out of sight rather
                        than drawn as the wide native box it used to be. */}
                    <input type="text" className="editor-input" aria-label="The colour the drawing is made in, as a hex figure" value={draft.preset.visualizationColor ?? ''} placeholder={themeFor(draft.preset.drawingTheme).color.toUpperCase()} onChange={(event) => updatePreset({ visualizationColor: event.target.value.trim() || undefined })} />
                    <button
                      type="button"
                      className="editor-swatch"
                      style={{ background: drawingColour }}
                      data-colour={drawingColour}
                      aria-label="Pick the colour the drawing is made in"
                      title="Pick the colour the drawing is made in"
                      onClick={() => colourInputRef.current?.click()}
                    />
                    <input
                      ref={colourInputRef}
                      type="color"
                      className="editor-swatch-input"
                      value={drawingColour}
                      tabIndex={-1}
                      aria-hidden="true"
                      onChange={(event) => updatePreset({ visualizationColor: event.target.value })}
                    />
                  </span>
                </EditorField>}
                <EditorField label="BACKGROUND" reason="What the drawing sits on: a flat colour, the still the job already has, or an image of your own. The image is scaled to the frame and the drawing is laid over it.">
                  <EditorSelect value={backgroundKind} options={VISUALIZATION_BACKGROUNDS.filter((option) => option.id !== 'still' || hasStill).map((option) => ({ value: option.id, label: option.name }))} onChange={(next) => updatePreset({ visualizationBackground: next as NonNullable<EncodingPreset['visualizationBackground']> })} ariaLabel="What the drawing sits on" />
                </EditorField>
                {backgroundKind === 'colour' && <EditorField label="UNDER THE DRAWING" reason="The colour the drawing sits on, as a hex figure.">
                  <input type="text" className="editor-input" value={draft.preset.visualizationBackgroundColor ?? ''} placeholder={VISUALIZATION_BACKGROUND.toUpperCase()} onChange={(event) => updatePreset({ visualizationBackgroundColor: event.target.value.trim() || undefined })} />
                </EditorField>}
                {/* A ROW rather than a FIELD: a field is a label, and a button inside a label is a button
                    that is pressed twice. */}
                {backgroundKind === 'image' && <EditorRow label="IMAGE" value={<button className="editor-pick" onClick={() => { void chooseBackgroundImage() }}>{backgroundImageName || 'CHOOSE...'}</button>} reason="The image the drawing sits on. It is scaled to the frame's own shape and the drawing is laid over it." />}
                {/* Only the PICTURES get a line: a drawing that moves is already showing where the sound is,
                    and a bar over one would be a second answer to the same question. */}
                {templateFor(draft.preset.visualization).kind === 'picture' && <EditorToggle label="PROGRESS LINE" checked={visualizationProgressLine(draft.preset)} onChange={(checked) => updatePreset({ visualizationProgressLine: checked })} reason="A bar that sweeps across the picture from the left edge to the right as the sound plays, which is what a podcast video looks like. The two pictures are one frame held for the length of the sound, so without it the video sits motionless; it is off where the drawing already moves." />}
                {/* The waveform's own three: how the amplitude is scaled, how heavy the drawing is, and how many
                    waveforms it draws. The count is a DOWNMIX rather than a filter option — see `WAVE_CHANNELS`:
                    a stereo sound fills the frame with a row per channel however the filter is told to split. */}
                {isWaveTemplate(drawingTemplate.id) && <>
                  <EditorField label="AMPLITUDE" reason="How the sound's own level is turned into the height of the drawing. Logarithmic makes the quiet end visible, which is what a waveform of speech is normally read with; linear draws the levels as they are.">
                    <EditorSelect value={drawingTune.waveScale} options={WAVE_SCALES.map((scale) => ({ value: scale, label: scale.toUpperCase() }))} onChange={(next) => updatePreset({ waveScale: next as NonNullable<EncodingPreset['waveScale']> })} ariaLabel="How the sound's own level is turned into the height of the drawing" />
                  </EditorField>
                  <EditorField label="WEIGHT" reason="How much of the drawing is inked. FILLED is the whole envelope and is what the monitor shows and what the static waveform already draws; LINE is the lighter stroke, which covers about a fifth of what the filled drawing does at a 1080-row frame.">
                    <EditorSelect value={drawingTune.waveWeight} options={WAVE_WEIGHTS.map((weight) => ({ value: weight, label: weight === 'fill' ? 'FILLED' : 'LINE' }))} onChange={(next) => updatePreset({ waveWeight: next as NonNullable<EncodingPreset['waveWeight']> })} ariaLabel="How much of the drawing is inked" />
                  </EditorField>
                  <EditorField label="WAVEFORMS" reason="How many waveforms the drawing shows. ONE mixes the sound to a single channel first, which is what makes the drawing one shape and what the static waveform draws; TWO keeps the sound's own pair, each channel in its own row, which is the look for a sound whose channels differ.">
                    <EditorSelect value={String(drawingTune.waveChannels)} options={WAVE_CHANNELS.map((count) => ({ value: String(count), label: count === 1 ? 'ONE' : 'TWO' }))} onChange={(next) => updatePreset({ waveChannels: Number(next) === 2 ? 2 : 1 })} ariaLabel="How many waveforms the drawing shows" />
                  </EditorField>
                </>}
                {/* The spectra's own two. Their ramp comes from the theme, so they are given no colour field. */}
                {isSpectrumTemplate(drawingTemplate.id) && <>
                  <EditorField label="AMPLITUDE" reason="How a band's level is turned into its colour. Logarithmic is what a spectrogram is normally read with, because it makes the quiet bands visible; linear shows the levels as they are.">
                    <EditorSelect value={drawingTune.spectrumScale} options={SPECTRUM_SCALES.map((scale) => ({ value: scale, label: scale.toUpperCase() }))} onChange={(next) => updatePreset({ spectrumScale: next as NonNullable<EncodingPreset['spectrumScale']> })} ariaLabel="How a band's level is turned into its colour" />
                  </EditorField>
                  <div className="editor-field">
                    <span><span className="editor-label">SATURATION</span></span>
                    <NumberField min={SPECTRUM_MIN_SATURATION} max={SPECTRUM_MAX_SATURATION} step={1} className="editor-input" value={drawingTune.spectrumSaturation} onValue={(value) => updatePreset({ spectrumSaturation: clampSaturation(value) })} title="How far a band's colour is pushed: 0 is a grey ramp, 1 is the theme's own, and higher pushes it further still." />
                  </div>
                </>}
                {/* The bars' own knobs. Their bars are drawn one pixel each and STRETCHED to the frame, so the
                    count is what makes them chunky; the gap is a grid drawn over that, which is the only way to
                    open one in a filter that has no concept of it. The segments are the same trick turned
                    sideways, which is what makes the drawing read as a panel of blocks rather than a bar chart.
                    The rest are the filter's own knobs, passed through unchanged. */}
                {isBarsTemplate(drawingTemplate.id) && <>
                  <div className="editor-field">
                    <span><span className="editor-label">BAR COUNT</span></span>
                    <div className="exact-row">
                      <label className="mini-field"><span>DENSITY</span><NumberField min={EQ_MIN_BARS} max={EQ_MAX_BARS} step={1} className="editor-input" value={eqStyle.bars} onValue={(value) => updatePreset({ eqBars: clampEqBars(value) })} title="How many bars the spectrum is divided into" /></label>
                      <label className="mini-field"><span>GAP PX</span><NumberField min={0} max={EQ_MAX_GAP} step={1} className="editor-input" value={eqStyle.gap} onValue={(value) => updatePreset({ eqGap: clampEqGap(value) })} title="The gap between bars, in pixels of the output frame. 0 is solid." /></label>
                    </div>
                  </div>
                  <EditorField label="AMPLITUDE" reason="How a frequency's level is turned into the height of its bar. Logarithmic is what a spectrum normally wants - it makes the quiet end visible - and linear shows the levels as they are.">
                    <EditorSelect value={draft.preset.eqAmplitude ?? 'log'} options={EQ_AMPLITUDE_SCALES.map((scale) => ({ value: scale, label: scale.toUpperCase() }))} onChange={(next) => updatePreset({ eqAmplitude: next as NonNullable<EncodingPreset['eqAmplitude']> })} ariaLabel="How a frequency's level is turned into the height of its bar" />
                  </EditorField>
                  <EditorField label="FREQUENCY" reason="How the frequencies are laid out across the frame: linear is even per hertz, logarithmic is even per octave and reads the way music is heard.">
                    <EditorSelect value={draft.preset.eqFrequency ?? 'lin'} options={EQ_FREQUENCY_SCALES.map((scale) => ({ value: scale, label: scale.toUpperCase() }))} onChange={(next) => updatePreset({ eqFrequency: next as NonNullable<EncodingPreset['eqFrequency']> })} ariaLabel="How the frequencies are laid out across the frame" />
                  </EditorField>
                  <EditorField label="SENSITIVITY" reason="The floor below which a frequency is not drawn: the smaller the figure, the more of the quiet detail is shown. It is a fraction of full scale, so the useful figures are small - 0.000001 is ffmpeg's own floor and the least sensitive this can be asked to be.">
                    <NumberField min={EQ_MIN_SENSITIVITY} max={EQ_MAX_SENSITIVITY} step={0.0000001} className="editor-input" value={draft.preset.eqSensitivity ?? EQ_MAX_SENSITIVITY} onValue={(value) => updatePreset({ eqSensitivity: clampEqSensitivity(value) })} title="The minimum amplitude a frequency must reach to be drawn" />
                  </EditorField>
                  <EditorToggle label="SEGMENTED" checked={drawingTune.segmented} onChange={(checked) => updatePreset({ eqSegmented: checked })} reason="Break each bar into a stack of blocks with thin dark lines between them, so the drawing reads as a panel of lamps rather than a solid column. The lines are aligned from the top so no block is cut off." />
                  {/* The block drawing's own two. The gap is how thick the dividers are — a hairline for the
                      ordinary stack, and the wide one that turns it into separated pills — and the hold is what
                      leaves a fading ghost above each peak rather than letting it drop out from under the bar. */}
                  <div className="editor-field">
                    <span><span className="editor-label">BLOCKS</span></span>
                    <div className="exact-row">
                      <label className="mini-field"><span>BLOCK GAP</span><NumberField min={1} max={EQ_SEGMENT_GAP_MAX} step={1} className="editor-input" value={drawingTune.segmentGap} onValue={(value) => updatePreset({ eqSegmentGap: clampSegmentGap(value) })} title="How many pixels thick the divider between two blocks is. A hairline is a stack; several pixels turns it into a column of separated pills." /></label>
                      {drawingTune.peakHold && <label className="mini-field"><span>PEAK DECAY</span><NumberField min={EQ_PEAK_DECAY_MIN} max={EQ_PEAK_DECAY_MAX} step={0.005} className="editor-input" value={drawingTune.peakDecay} onValue={(value) => updatePreset({ eqPeakDecay: clampPeakDecay(value) })} title="How long a held peak lasts: the share of its height it keeps each frame, so a figure just below one is a long trail and zero is no hold at all." /></label>}
                    </div>
                  </div>
                  <EditorToggle label="PEAK HOLD" checked={drawingTune.peakHold} onChange={(checked) => updatePreset({ eqPeakHold: checked })} reason="Let each bar's peaks linger and fade above it rather than vanishing with its height, which is what a peak-hold meter does. The bar itself stays crisp; only the ghosts above it fall away. A decay of zero is no hold, so a job that fades it out has turned it off." />
                  {drawingTemplate.id === 'led-eq' && <EditorToggle label="LABELS" checked={drawingTune.labels} onChange={(checked) => updatePreset({ eqLabels: checked })} reason="Draw the band frequencies along the bottom of the panel, one per named band, in the drawing's own colour." />}
                </>}
                {/* The scope's own four. Its colour is three channel contrasts rather than a hex, so that comes
                    from the theme; the fade is the inverse of the persistence; and TRUE STEREO is the one thing
                    about the sound itself — off, the ring is synthesised from a single channel, which is what a
                    scope on a mono sound needs and what a container's channel count cannot tell you. */}
                {drawingTemplate.id === 'scope' && <>
                  <div className="editor-field">
                    <span><span className="editor-label">TRACE</span></span>
                    <div className="exact-row">
                      <label className="mini-field"><span>PERSISTENCE</span><NumberField min={0} max={1} step={0.01} className="editor-input" value={drawingTune.scopePersist} onValue={(value) => updatePreset({ scopePersist: clampScopePersist(value) })} title="How long the trace lasts: 0 is a single bright dot, and a long trail is what a phosphor scope looks like." /></label>
                      <label className="mini-field"><span>ZOOM</span><NumberField min={SCOPE_MIN_ZOOM} max={SCOPE_MAX_ZOOM} step={0.1} className="editor-input" value={drawingTune.scopeZoom} onValue={(value) => updatePreset({ scopeZoom: clampScopeZoom(value) })} title="How far the trace is magnified about the centre." /></label>
                    </div>
                  </div>
                  <EditorField label="DRAW" reason="A continuous trace, or a trail of dots with the samples' own spacing in it.">
                    <EditorSelect value={drawingTune.scopeDraw} options={SCOPE_DRAWS.map((draw) => ({ value: draw, label: draw.toUpperCase() }))} onChange={(next) => updatePreset({ scopeDraw: next as NonNullable<EncodingPreset['scopeDraw']> })} ariaLabel="A continuous trace, or a trail of dots" />
                  </EditorField>
                  <EditorToggle label="TRUE STEREO" checked={drawingTune.trueStereo} onChange={(checked) => updatePreset({ scopeTrueStereo: checked })} reason="Plot the sound's own two channels against each other. Off - the default - the scope is drawn from a single mixed-down channel, opened into a ring with a quarter-cycle of phase, because a polar scope on a sound whose two channels are the same draws a spoke rather than a ring, and a mono file stored as stereo is the commonest case of that. Turn it on for genuinely wide music." />
                </>}
              </>}
            </>}
            {artCoverOffered && <EditorToggle label="COVER ART" checked={draft.preset.coverArt !== false} onChange={(checked) => updatePreset({ coverArt: checked })} reason="Attach the still to the file as its artwork. It is stored as a picture rather than played as a frame, which is what an MP3, M4A or FLAC can hold." />}
            {stillIntoWav && <div className="editor-note">&gt; A WAV CANNOT CARRY ARTWORK. THE STILL IS DROPPED; MP3, M4A OR FLAC WOULD KEEP IT.</div>}
          </>}

          {activeTab === 'EFFECTS' && <>
            <EditorToggle label="TIMESTAMP BURN-IN" checked={false} reason="BURN-IN HAS NO BACKING FIELD AND IS NOT IMPLEMENTED BY THE ENCODER." />
            <EditorToggle label="FRAMESTAMP BURN-IN" checked={false} reason="BURN-IN HAS NO BACKING FIELD AND IS NOT IMPLEMENTED BY THE ENCODER." />
            <EditorToggle label="IMAGE OVERLAY / WATERMARK" checked={false} reason="BURN-IN HAS NO BACKING FIELD AND IS NOT IMPLEMENTED BY THE ENCODER." />
            <div className="editor-note">&gt; THESE CONTROLS ARE SHOWN DISABLED BECAUSE THE ENCODER HAS NOTHING TO DRIVE YET. WIRING THEM WOULD FORCE A RE-ENCODE.</div>
          </>}

          {activeTab === 'CAPTIONS' && <>
            <EditorField label="MODE" reason="CAPTIONS ARE NOT WIRED TO THE ENCODER YET."><EditorSelect value="embedded" options={[{ value: 'embedded', label: 'EMBEDDED' }, { value: 'sidecar', label: 'SIDECAR SRT' }, { value: 'burn-in', label: 'BURN-IN' }]} disabled onChange={() => undefined} ariaLabel="Caption mode" /></EditorField>
            <div className="editor-note">&gt; CAPTION MODE HAS NO BACKING FIELD YET, SO NOTHING IS SENT BACK ON APPLY.</div>
          </>}
        </div>

        <div className="export-summary">
          <span className="panel-kicker">SUMMARY</span>
          <strong>{draft.outputFilename}</strong>
          <span>{stillFrameJob
            ? (nothingToTimeJob ? 'SINGLE FRAME OUTPUT - NO TIMELINE' : `SINGLE FRAME AT ${stamp(playback.position)} OF ${stamp(duration)}`)
            : duration > 0 ? `ASSEMBLED ${stamp(duration)} ACROSS ${model.lanes.length} LANE(S)` : 'LENGTH UNKNOWN - PROBE ON START'}</span>
          <span>ESTIMATED SIZE {estimateLabel(estimate)}</span>
          <span>{dirty ? 'UNSAVED CHANGES' : 'NO CHANGES'}</span>
        </div>

        <div className="editor-actions">
          {confirmingDiscard
            ? <><span className="editor-confirm">DISCARD UNSAVED CHANGES?</span><button onClick={() => setConfirmingDiscard(false)}>KEEP EDITING</button><button className="editor-danger" onClick={() => void window.electronAPI?.cancelEditJob()}>DISCARD</button></>
            : <><button onClick={() => (dirty ? setConfirmingDiscard(true) : void window.electronAPI?.cancelEditJob())}>CANCEL</button><button onClick={() => applyEdits(false)} disabled={!dirty} title={dirty ? 'Apply without closing' : 'NO CHANGES TO APPLY.'}>APPLY</button><button className="primary-retro" onClick={() => applyEdits(true)} title="Apply and close">OK</button></>}
        </div>
      </aside>
    </div>

    {audioLanes.map((lane) => {
      const laneSegment = lane.segments[0]
      const url = laneSegment ? sourceUrlFor(laneSegment) : null
      return url ? <audio
        key={lane.id}
        ref={audioLaneRefs[lane.id]}
        src={url}
        preload="auto"
      /> : null
    })}

    {/* Fixed rather than positioned inside the timeline, so it is never clipped by the scroll
        area it was opened from. */}
    {timelineMenu && <div className="timeline-menu" ref={menuRef} style={{ left: menuAt.x, top: menuAt.y }} role="menu">
      <span className="timeline-menu-head">{timelineMenu.kind === 'stamp' ? 'TIMELINE UNITS' : timelineMenu.label}</span>
      {timelineMenu.kind === 'stamp' ? <>
        {/* The unit the window shows lengths in, which is the app's setting rather than this job's: the
            ruler, the clip boxes, the monitor's line and the transport all read it, and so does the
            Quick Look helper. A radio rather than a checkbox, because exactly one of the two is on. */}
        <button role="menuitemradio" aria-checked={timestampMode === 'timestamp'} className={timestampMode === 'timestamp' ? 'is-on' : ''} onClick={() => { setTimelineMenu(null); setTimestampMode('timestamp') }}>TIMESTAMP</button>
        <button role="menuitemradio" aria-checked={timestampMode === 'framestamp'} className={timestampMode === 'framestamp' ? 'is-on' : ''} onClick={() => { setTimelineMenu(null); setTimestampMode('framestamp') }}>FRAMESTAMP</button>
      </> : timelineMenu.kind === 'clip' ? (timelineMenu.confirming ? <>
        {/* The removal is the one thing in here that cannot be taken back by the window, so it asks
            first. A source that is the job's last takes the job with it, and says so outright. */}
        <span className="timeline-menu-head">{timelineMenu.multi ? `REMOVE ${multiSelected.length} CLIPS?` : `REMOVE ${sourceName(timelineMenu.sourcePath)}?`}</span>
        <p className="timeline-menu-note">{timelineMenu.multi
          ? 'EVERY CLIP IN HAND GOES FROM THE TIMELINE AND FROM THE JOB\'S SOURCE LIST.'
          : draft.sourcePaths.length <= 1 && !draft.additionalAudioTracks?.length
            ? 'THIS IS THE JOB\'S LAST SOURCE, SO REMOVING IT REMOVES THE JOB.'
            : 'THE CLIP GOES FROM THE TIMELINE AND FROM THE JOB\'S SOURCE LIST.'}</p>
        <div className="timeline-menu-actions">
          <button role="menuitem" onClick={() => setTimelineMenu({ ...timelineMenu, confirming: undefined })}>KEEP IT</button>
          <button role="menuitem" className="is-danger" onClick={() => {
            if (timelineMenu.multi) { setTimelineMenu(null); removeSelectedClips(); return }
            const { sourcePath, sourceIndex } = timelineMenu
            setTimelineMenu(null)
            removeClipAt(sourcePath, sourceIndex)
          }}>REMOVE</button>
        </div>
      </> : <>
        <button role="menuitem" onClick={() => { const target = timelineMenu; setTimelineMenu(null); void openNativePreview({ sourcePath: target.sourcePath, sourceIndex: target.mainIndex ?? 0 }) }}>QUICK LOOK...</button>
        <button role="menuitem" onClick={() => { const target = timelineMenu; setTimelineMenu(null); selectClip(target.laneId, target.fitKey); setInspectorOpen(true) }}>PROPERTIES</button>
        {/* The clip's own two repairs. RESET TRIM is offered only where there is a trim to take away — a
            control that is always there and usually does nothing is a control nobody trusts. REPLACE
            SOURCE swaps the FILE at this place, and needs a place: an added audio track is not in
            `sourcePaths`, so it names none and the item is out of reach there. */}
        <span className="timeline-menu-divider" aria-hidden="true" />
        <button role="menuitem" disabled={!multiSelected.some((key) => draft.trimPoints?.[key] !== undefined)} onClick={() => { setTimelineMenu(null); resetTrimSelected() }} title={multiSelected.length > 1 ? `Take the trim away from all ${multiSelected.length} clips in hand` : undefined}>RESET TRIM{multiSelected.length > 1 ? ` (${multiSelected.length})` : ''}</button>
        {/* The CUT, at the skimmer. Offered only for a clip on the source list, and only while the playhead is
            strictly inside it — a cut at either edge makes no second clip. */}
        {timelineMenu.mainIndex != null && (() => {
          const lane = model.lanes.find((candidate) => candidate.id === timelineMenu.laneId)
          const segment = lane?.segments[timelineMenu.segmentIndex]
          const inside = Boolean(segment && playback.position > segment.start + 1e-6 && playback.position < segment.start + segment.duration - 1e-6)
          return <button role="menuitem" disabled={!inside} title={inside ? 'Cut this clip in two at the skimmer (C)' : 'Move the skimmer inside this clip to cut it'} onClick={() => { setTimelineMenu(null); splitSelectedClip() }}>SPLIT AT SKIMMER</button>
        })()}
        <button role="menuitem" disabled={timelineMenu.sourceIndex == null} onClick={() => { const index = timelineMenu.sourceIndex; setTimelineMenu(null); void replaceClipAt(index) }}>REPLACE SOURCE...</button>
        {timelineMenu.visual && (() => {
          const fit = draft.sourceFit?.[timelineMenu.fitKey]
          const blocked = timelineMenu.fitReason
          return <>
            <span className="timeline-menu-divider" aria-hidden="true" />
            <button
              role="menuitemcheckbox"
              aria-checked={fit?.mode === 'width'}
              className={fit?.mode === 'width' ? 'is-on' : ''}
              disabled={Boolean(blocked)}
              onClick={() => { const key = timelineMenu.fitKey; setTimelineMenu(null); setSourceFit(key, fit?.mode === 'width' ? null : 'width') }}
              title={blocked ?? "Fill the output frame's width and crop what the height overflows by. The export follows this."}
            >FIT TO WIDTH</button>
            <button
              role="menuitemcheckbox"
              aria-checked={fit?.mode === 'height'}
              className={fit?.mode === 'height' ? 'is-on' : ''}
              disabled={Boolean(blocked)}
              onClick={() => { const key = timelineMenu.fitKey; setTimelineMenu(null); setSourceFit(key, fit?.mode === 'height' ? null : 'height') }}
              title={blocked ?? "Fill the output frame's height and crop what the width overflows by. The export follows this."}
            >FIT TO HEIGHT</button>
          </>
        })()}
        <span className="timeline-menu-divider" aria-hidden="true" />
        {timelineMenu.duplicating ? <>
          {/* The copy's own two places, asked as a sub-question of DUPLICATE rather than as two top-level
              commands: right after the clip, or at the end of the join. The heading names the command only —
              the menu was opened on the clip, so repeating its filename says what is already known — and the
              answers are INDENTED under it, so the group reads as one question with its own answers. */}
          <span className="timeline-menu-head">DUPLICATE</span>
          <button role="menuitem" className="is-sub" disabled={timelineMenu.sourceIndex == null} onClick={() => { const index = timelineMenu.sourceIndex; setTimelineMenu(null); if (index != null) duplicateClipTo(index, 'after') }}>PLACE AFTER</button>
          <button role="menuitem" className="is-sub" disabled={timelineMenu.sourceIndex == null} onClick={() => { const index = timelineMenu.sourceIndex; setTimelineMenu(null); if (index != null) duplicateClipTo(index, 'end') }}>AT THE END</button>
          <button role="menuitem" className="is-sub" onClick={() => setTimelineMenu({ ...timelineMenu, duplicating: false })}>CANCEL</button>
        </> : <button role="menuitem" onClick={() => setTimelineMenu({ ...timelineMenu, duplicating: true })}>DUPLICATE...</button>}
        {/* The clip's OWN sound can leave the picture and become a track of its own. Offered only where the
            encoder can honour it — a clip on the source list of a CONVERT or a MULTI-TRACK that actually has
            an audio stream — and only through the probe, so it never appears for a silent file. One stream
            extracts straight away; several ask which, defaulting to all of them. */}
        {timelineMenu.visual && timelineMenu.sourceIndex != null && embeddedAudioEditable(draft) && (sourceProbes[timelineMenu.sourcePath]?.audioStreams?.length ?? 0) > 0 && (() => {
          const clipId = timelineMenu.fitKey
          const path = timelineMenu.sourcePath
          const streams = sourceProbes[path]?.audioStreams ?? []
          const couldExtract = streams.filter((stream, sourceIndex) => !extractedBy(draft, clipId, path, stream.index ?? sourceIndex))
          if (!couldExtract.length) return null
          if (timelineMenu.extracting && streams.length > 1) return <>
            <span className="timeline-menu-head">EXTRACT AUDIO</span>
            <button role="menuitem" className="is-sub" disabled={!couldExtract.length} onClick={() => { setTimelineMenu(null); extractAudioToTrack(clipId, path, couldExtract.map((stream, sourceIndex) => stream.index ?? sourceIndex)) }}>ALL STREAMS</button>
            {streams.map((stream, sourceIndex) => {
              const streamIndex = stream.index ?? sourceIndex
              const taken = Boolean(extractedBy(draft, clipId, path, streamIndex))
              return <button key={streamIndex} role="menuitem" className="is-sub" disabled={taken} onClick={() => { setTimelineMenu(null); extractAudioToTrack(clipId, path, [streamIndex]) }}>{embeddedStreamLabel(stream, streamIndex)}{taken ? ' (EXTRACTED)' : ''}</button>
            })}
            <button role="menuitem" className="is-sub" onClick={() => setTimelineMenu({ ...timelineMenu, extracting: false })}>CANCEL</button>
          </>
          return <button role="menuitem" onClick={() => { if (streams.length > 1) setTimelineMenu({ ...timelineMenu, extracting: true }); else { setTimelineMenu(null); extractAudioToTrack(clipId, path, [streams[0].index ?? 0]) } }}>EXTRACT AUDIO TO TRACK...</button>
        })()}
        <span className="timeline-menu-divider" aria-hidden="true" />
        <button role="menuitem" className="is-danger" onClick={() => setTimelineMenu({ ...timelineMenu, confirming: true })}>REMOVE SOURCE</button>
      </>) : <>
        <button role="menuitem" className={filmstripLanes[timelineMenu.laneId] ? '' : 'is-on'} onClick={() => { const laneId = timelineMenu.laneId; setTimelineMenu(null); setFilmstripLanes((current) => ({ ...current, [laneId]: false })) }}>SIMPLE VIEW</button>
        <button role="menuitem" className={filmstripLanes[timelineMenu.laneId] ? 'is-on' : ''} onClick={() => { const laneId = timelineMenu.laneId; setTimelineMenu(null); setFilmstripLanes((current) => ({ ...current, [laneId]: true })) }}>{model.lanes.find((lane) => lane.id === timelineMenu.laneId)?.kind === 'audio' ? 'WAVEFORM' : 'FILMSTRIP'}</button>
      </>}
    </div>}
  </div>
}
