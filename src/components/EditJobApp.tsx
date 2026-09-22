import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, RotateCcw, Unlink, ZoomIn, ZoomOut } from 'lucide-react'
import { AppSettings, EditJobPatch, EncodingPreset, Insets, QueueTask, SourceCrop, SourceFit, TransitionType } from '../types'
import { deriveOutputFilename } from '../lib/outputNaming'
import { mediaKind } from '../lib/mediaKind'
import { applyContainerChange, IMAGE_CONTAINERS } from '../lib/containerSwitch'
import { rememberedPreviewFor, resolveQuickLookRequest } from '../lib/quickLookTarget'
import { mediaUrl } from '../lib/mediaUrl'
import { buildTimeline, canApplyClipFit, clipIndexOf, clipsConcatenate, edgeFade, effectiveCropFor, firstVisualSource, frameStamp, HEAD_FADE_KEY, isStillFrameJob, maxEdgeFade, maxFadeAtBoundary, sequenceFor, sourceDuration, sourceFitFor, sourceFps, SourceTiming, stillSecondsFor, TAIL_FADE_KEY, timecode, TimelineLane, TimelineModel, TimelineSegment } from '../lib/timelineModel'
import { sequenceLabel } from '../lib/sequenceLabel'
import { computeFilmstrip, FILMSTRIP_CLIP_HEIGHT, FILMSTRIP_SETTLE_MS, frameKey, thumbnailSignature } from '../lib/filmstrip'
import { WAVEFORM_BAR, peaksForTrim, waveformPath } from '../lib/waveform'
import { cropBands, cropFractions, cropForProportion, cropPixels, exactSizeFields, hasCrop, holdCropShape, insetCrop, keptAspect, outputFrameSize, resizeCorner, shiftCrop, resolutionBox, aspectSize, resolutionShortSide, resizeExact, clampCrop, MIN_KEPT, CropCorner, CropFractions } from '../lib/outputFrame'
import { DEFAULT_PREVIEW_ZOOM, MAX_PREVIEW_ZOOM, MIN_PREVIEW_ZOOM, PREVIEW_ZOOM_STEPS, PreviewZoom, clampPan, clampPreviewZoom, isPresetZoom, panSlack, zoomedRaster } from '../lib/previewZoom'
import { ZOOM_MAX, ZOOM_MIN, clampZoom, fitZoom, laneWidthFor, secondsAt } from '../lib/timelineScale'

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
import { sourceTimingOverrides, SourceTimingOverride, withSourceTiming } from '../lib/sourceTiming'
import { DEFAULT_FIT_OFFSET, cropFractionsOf, fitOffsetWithin, hasInsets, innerBox, insetsOf, normaliseInsets, placedSource, sourceCropOf, storedFitOffset } from '../lib/sourceFit'
import { useConsolidatedPlayback } from '../hooks/useConsolidatedPlayback'
import { scrollToKeepVisible, skimmerOffset } from '../lib/timelinePan'
import { placeMenu } from '../lib/menuPlacement'
import { emptyHistory, DraftHistory, recordChange, stepHistory as stepBack } from '../lib/draftHistory'
import { NumberField } from './NumberField'

const tabs = ['EXPORT', 'VIDEO', 'AUDIO', 'EFFECTS', 'CAPTIONS'] as const
type Tab = typeof tabs[number]

const CONTAINERS: Array<EncodingPreset['container']> = ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'flac', 'png', 'jpg', 'gif']
const VIDEO_CODECS: Array<EncodingPreset['videoCodec']> = ['copy', 'h264', 'hevc', 'prores', 'vp9', 'av1', 'png', 'mjpeg']
const AUDIO_CODECS: Array<EncodingPreset['audioCodec']> = ['copy', 'aac', 'mp3', 'opus', 'pcm', 'flac']
const AUDIO_CONTAINERS: Array<EncodingPreset['container']> = ['mp3', 'wav', 'm4a', 'flac']
const RESOLUTIONS: Array<EncodingPreset['resolution']> = ['source', '4k', '1080p', '720p']

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
  // The framing the window owns, exactly as it owns the transitions: a crop, a fit or a mute set on
  // its own is a change like any other, and leaving these out of the slice made the window call
  // itself clean the moment one of them was the first thing touched — so APPLY and OK stayed
  // disabled and the change could not be committed at all.
  sourceFit: task.sourceFit,
  sourceCrop: task.sourceCrop,
  mutedLanes: task.mutedLanes,
  // Per-source timing is editable from MEDIA INFO, so the window owns it too.
  sourceMetadata: task.sourceMetadata,
  sequenceInput: task.sequenceInput,
  sequenceInputs: task.sequenceInputs,
})

/** The rates the MEDIA INFO inspector offers, matching the queue's own list. */
const FPS_CHOICES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60]

const sliceSignature = (task: QueueTask) => JSON.stringify(editableSlice(task))
const isDirty = (draft: QueueTask, baseline: QueueTask) => sliceSignature(draft) !== sliceSignature(baseline)

/**
 * What a right-click on the timeline was on.
 *
 * A clip offers the two things that are about the clip itself: its frame-accurate preview and
 * its media info. A lane head offers the two ways to draw its clips, since that is a property
 * of the lane rather than of any one clip in it.
 */
type TimelineMenu =
  | { kind: 'clip'; x: number; y: number; sourceIndex: number; mainIndex: number | null; laneId: string; segmentIndex: number; sourcePath: string; label: string; fitKey: string; visual: boolean; fitReason?: string; confirming?: boolean }
  | { kind: 'lane'; x: number; y: number; laneId: string; label: string }

const sourceName = (filePath?: string) => filePath?.split('/').pop() || 'UNTITLED'

const EditorRow: React.FC<{ label: string; value: React.ReactNode; reason?: string }> = ({ label, value, reason }) => (
  <div className="editor-row" title={reason}><span>{label}</span><strong>{value}</strong></div>
)

const EditorField: React.FC<{ label: string; hint?: string; reason?: string; children: React.ReactNode }> = ({ label, hint, reason, children }) => (
  <label className="editor-field" title={reason}><span>{label}{hint ? <em>{hint}</em> : null}</span>{children}</label>
)

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
const EditorGroup: React.FC<{ id: string; label: string; hint?: string; reason?: string; collapsed: boolean; onToggle: (id: string) => void; children: React.ReactNode }> = ({ id, label, hint, reason, collapsed, onToggle, children }) => (
  <section className={`editor-group${collapsed ? ' is-collapsed' : ''}`}>
    <button type="button" className="editor-group-head" onClick={() => onToggle(id)} title={reason} aria-expanded={!collapsed}>
      <span>{label}{hint ? <em>{hint}</em> : null}</span>
      <span className="editor-group-mark" aria-hidden="true">{collapsed ? '+' : '\u2212'}</span>
    </button>
    {!collapsed && <div className="editor-group-body">{children}</div>}
  </section>
)

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
   * The clip whose MEDIA INFO inspector is open, by the lane it is on and its place in that lane.
   *
   * Not an index into `sourcePaths`: an audio track is not one of those, so a menu opened on one could
   * only name the job's first video — and the inspector then described a file the user had not asked
   * about.
   */
  const [inspected, setInspected] = useState<{ laneId: string; segmentIndex: number } | null>(null)
  // Mirrors of the editable state so the IPC listener can decide without stale closures.
  const draftRef = useRef<QueueTask | null>(null)
  const baselineRef = useRef<QueueTask | null>(null)
  const audioElementsRef = useRef<Record<string, HTMLAudioElement | null>>({})
  const [probedTiming, setProbedTiming] = useState<Record<string, SourceTiming>>({})
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
  /** Whether the crop fields read as per cent of the source or as pixels of it. */
  const [cropUnit, setCropUnit] = useState<'%' | 'px'>('%')
  /**
   * Whether the INSETS and OFFSET fields read as per cent of the output frame or as pixels of it.
   *
   * Each has its own switch rather than sharing one, because they are read at different moments: a
   * margin is a size one thinks about in pixels of the frame, and a position is usually "a tenth to
   * the right". Deciding the unit of one should not silently change how the other reads.
   */
  const [insetUnit, setInsetUnit] = useState<'%' | 'px'>('%')
  const [offsetUnit, setOffsetUnit] = useState<'%' | 'px'>('%')
  /**
   * Which sidebar groups are folded away, from the settings.
   *
   * A group is open unless it is named here, so a new group arrives visible and nothing is hidden
   * from a reader who has never folded anything.
   */
  const collapsedSections = settings?.collapsedSections ?? []
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
  const [confirmingClearCrop, setConfirmingClearCrop] = useState(false)
  const [clearCropAll, setClearCropAll] = useState(false)
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
  const undoRedoRef = useRef<{ undo: () => void; redo: () => void }>({ undo: () => undefined, redo: () => undefined })
  /** Boundary whose transition editor is open, by index of the clip it follows, or a timeline edge. */
  const [openBoundary, setOpenBoundary] = useState<number | 'head' | 'tail' | null>(null)
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
      // A change to the SOURCE LIST moves every clip's place in the job, and a transition, a fit and
      // a crop are all keyed by that place. The queue re-keys them as it takes a source out, and the
      // queue's version is the right one: the window's copy was filed against the places the clips
      // had a moment ago, so keeping it would leave a record sitting on whatever moved into an index
      // and would leave the removed clip's record behind with nothing to be about.
      const clipsMoved = JSON.stringify(incoming.sourcePaths) !== JSON.stringify(currentBaseline.sourcePaths)
        || JSON.stringify(incoming.additionalAudioTracks ?? []) !== JSON.stringify(currentBaseline.additionalAudioTracks ?? [])
      const kept = editableSlice(currentDraft)
      const merged = userDirty
        ? { ...incoming, ...(clipsMoved
          ? { ...kept, transitions: incoming.transitions, sourceFit: incoming.sourceFit, sourceCrop: incoming.sourceCrop }
          : kept) }
        : incoming
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

  // Nothing in the app ever populates `sourceInfo` or `sourceMetadata`, so a source without intrinsic
  // timing — an audio track especially — has to be probed before it can be drawn or played at its real
  // length. This is the list that gets probed and no more: a multi-track job maps one video stream, so
  // only the first source is a candidate for it, and every added track is one.
  const candidateSources = draft ? Array.from(new Set([
    ...(draft.type === 'stitch' ? draft.sourcePaths : draft.sourcePaths.slice(0, 1)),
    ...(draft.additionalAudioTracks || []).map((track) => track.path),
  ])) : []
  const probeSignature = candidateSources.join('\u0000')

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
        return [sourcePath, await window.electronAPI?.probeMedia(sourcePath)] as const
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

  const playback = useConsolidatedPlayback(
    model ?? { lanes: [], duration: 0, unusedVideoSources: [] },
    audioElementsRef,
    { playable: Boolean(model && model.duration > 0), fps: primaryFps },
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
  const playingNatural = naturalSize && naturalSize.key === playback.segment?.key ? naturalSize : undefined
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
  // A sequence is named after its whole range rather than the one frame that stands in
  // for it, the same way the queue's cards name it.
  const focusedSequence = draft && focusedSource ? sequenceFor(draft, focusedSource) : undefined
  const focusedLabel = focusedSequence ? sequenceLabel(focusedSequence) : sourceName(focusedSource)

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
    Array.from(new Set(task.sourcePaths)).forEach((sourcePath) => {
      const sequence = sequenceFor(task, sourcePath)
      if (!sequence) return
      const rate = sourceFps(task, sourcePath, sequence, resolveTiming)
      wanted.set(`${sourcePath}\u0000${rate}`, sourcePath)
    })
    if (!wanted.size) return
    const missing = [...wanted.keys()].filter((key) => resolvedTargetsRef.current[key] === undefined)
    if (!missing.length) return
    let cancelled = false
    void Promise.all(missing.map(async (key) => {
      const sourcePath = wanted.get(key) as string
      const request = await resolveQuickLookRequest(task, window.electronAPI, { sourceIndex: Math.max(0, task.sourcePaths.indexOf(sourcePath)) })
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
  }, [timelineSignature, probedTiming])

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
      const info = await window.electronAPI?.probeMedia(sourcePath)
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
    // The lane's width is the clip's trimmed length at the timeline's rate, which is a function of
    // the zoom alone: nothing here is read from the window, so a resize cannot re-lay a strip out.
    return computeFilmstrip({
      laneWidth: laneWidthFor(segment.duration, zoom),
      thumbHeight: FILMSTRIP_CLIP_HEIGHT,
      outAspect: frameAspect,
      fps: stripFpsFor(segment),
      inSec: segment.sourceIn,
      outSec: segment.sourceIn + segment.duration,
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
    if (!sequence) return segment.sourcePath
    const rate = sourceFps(draft, segment.sourcePath, sequence, resolveTiming)
    return rememberedPreviewFor(draft, segment.sourcePath, rate) ?? null
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
      if (isDirty(task, baselineRef.current ?? task)) setConfirmingDiscard(true)
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
  const audioLaneIds = (model?.lanes ?? []).filter((lane) => !lane.embedded).map((lane) => lane.id).join('|')
  const fps = draft ? sourceFps(draft, playback.segment?.sourcePath ?? draft.sourcePaths[0], undefined, resolveTiming) : 25
  // A lone image that is not an interpreted sequence, which is what a container
  // change can turn into a single frame or into a timed clip.
  const singleFrameSource = Boolean(draft && draft.sourcePaths.length === 1 && mediaKind(draft.sourcePaths[0]) === 'image' && !sequenceFor(draft, draft.sourcePaths[0]))
  const playbackRef = useRef(playback)
  playbackRef.current = playback
  const stepFpsRef = useRef(fps)
  stepFpsRef.current = Math.max(1, fps)

  // The stage the picture sits in, and the picture's own pixel size. Together they place the
  // output frame outline, which is drawn around the picture rather than guessed at.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageObserverRef = useRef<ResizeObserver | null>(null)
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null)

  const measureNatural = (event: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>) => {
    const element = event.currentTarget
    const width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth
    const height = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight
    if (width > 0 && height > 0) setNaturalSize({ key: playback.segment?.key, width, height })
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
   * The arrow keys follow the frame-accurate helper. Left and right step exactly one
   * frame; up and down move to the edges of the clip under the playhead, and pressing
   * again walks to the neighbouring clip's edge, which is the helper's jump-to-start
   * and jump-to-end widened to a timeline with many clips.
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
      if (code === 'Space' || event.key === ' ') {
        event.preventDefault()
        playbackRef.current.toggle()
        return
      }
      if (code === 'ArrowLeft' || code === 'ArrowRight') {
        event.preventDefault()
        playbackRef.current.step((code === 'ArrowRight' ? 1 : -1) / stepFpsRef.current)
        return
      }
      if (code === 'ArrowUp' || code === 'ArrowDown') {
        event.preventDefault()
        jumpToClipEdge(code === 'ArrowDown' ? 1 : -1)
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

  /**
   * Wheel over the timeline scrubs the playhead, as the helper's strip does: a
   * fraction of a frame per tick, eased with tanh so a flick travels much further
   * than a nudge, and the sign inverted to match the helper's convention.
   */
  const scrubByWheel = (event: React.WheelEvent<HTMLElement>) => {
    // Shift and the horizontal axis are left to the browser, so a zoomed-in timeline
    // can still be panned. The helper never needed that: its strip always showed the
    // whole clip.
    if (event.shiftKey || event.deltaY === 0) return
    const eased = Math.tanh(Math.abs(event.deltaY) / 6)
    const step = (1 / Math.max(1, stepFpsRef.current)) * (0.35 + 1.65 * eased)
    playback.seek(playback.position + (event.deltaY < 0 ? step : -step))
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
    const history = recordChange(historyRef.current, current, changes)
    if (history) historyRef.current = history
    const next = { ...current, ...changes }
    draftRef.current = next
    setDraft(next)
  }
  /** Steps the draft back or forward one edit, if there is one to step to. */
  const stepHistory = (direction: 'undo' | 'redo') => {
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
      preset: applyContainerChange(current.preset, container, singleFrameSource),
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
  // MATCH SOURCE is the state the window starts in, and the way back to it once a shape has been
  // chosen. What it then MEANS — which clip the frame follows — is decided where the frame is worked
  // out, well above this: the shape has to be known before these buttons can report it.
  /**
   * The rate the encoder will use when none is set: the source's own when there is one source,
   * and otherwise the default the output falls back to, since many sources have many rates and
   * no single one of them is the answer. Shown as the field's placeholder so a blank field says
   * what a blank field means rather than nothing at all.
   */
  const defaultFps = (() => {
    if (draft.sourcePaths.length === 1) {
      const only = sourceFps(draft, draft.sourcePaths[0], undefined, resolveTiming)
      if (only > 0) return Math.round(only)
    }
    return Math.round(settings?.sequenceFps || 30)
  })()

  const changeFps = (value: number | undefined) => {
    updatePreset({ fps: value === undefined || !Number.isFinite(value) || value <= 0 ? undefined : Math.round(value) })
  }

  /**
   * The cuts on the main lane, where a transition can sit.
   *
   * Transitions only exist between concatenated clips, which is the main lane of a
   * stitch and of a combo that concatenates its visuals. A multi-track job maps a
   * single video stream, so it has no cut to offer.
   */
  const mainLane = model.lanes[0]
  const cuts = (mainLane?.segments ?? []).slice(0, -1).map((clip, index) => ({ index, sourcePath: clip.sourcePath }))

  // MEDIA INFO reads the source under the playhead, which is the one the inspector was
  // opened on. A source with an intrinsic rate shows it; a still or a sequence, whose
  // rate is a choice rather than a fact about the file, can have it changed here.
  const inspectedSegment = inspected ? model?.lanes.find((lane) => lane.id === inspected.laneId)?.segments[inspected.segmentIndex] : undefined
  const inspectedSource = inspectedSegment?.sourcePath
  const inspectedSequence = inspectedSource ? sequenceFor(draft, inspectedSource) : undefined
  const inspectedFps = inspectedSource ? sourceFps(draft, inspectedSource, undefined, resolveTiming) : 0
  const inspectedEditable = Boolean(inspectedSegment && (inspectedSegment.still || inspectedSegment.sequence))
  const inspectedProbe = inspectedSource ? probedTiming[inspectedSource] : undefined

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
    applyTransition(`${cut.sourcePath}#${index}`, type, duration)
  }
  /** The head and tail of the timeline, which cut from and to black. */
  const setEdgeTransition = (edge: 'head' | 'tail', type: TransitionType, duration = 0.5) =>
    applyTransition(edge === 'head' ? HEAD_FADE_KEY : TAIL_FADE_KEY, type, duration)

  /**
   * Records a source's timing from MEDIA INFO: its rate, and for a still the length of
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

  const audioLanes = model.lanes.filter((lane) => !lane.embedded && lane.segments.length > 0)
  const playable = model.duration > 0
  const stamp = (seconds: number) => settings?.timestampDisplayMode === 'framestamp' ? frameStamp(seconds, fps) : timecode(seconds, fps)
  const segmentDetail = (segment: TimelineSegment) => {
    const parts = [stamp(segment.duration)]
    if (segment.trimmed) parts.push('TRIMMED')
    if (segment.sequence) parts.push(`SEQ ${segment.sequence.frames}F @ ${segment.sequence.fps}FPS`)
    // A still has no rate of its own, so the one it will be rendered at belongs in the
    // clip's own line rather than being left to the monitor to mention.
    if (segment.still) parts.push(`STILL @ ${Math.round(sourceFps(draft, segment.sourcePath, undefined, resolveTiming))}FPS`)
    if (segment.fadeIn) parts.push(`FADE IN ${segment.fadeIn.toFixed(2)}s`)
    if (segment.fadeOut) parts.push(`FADE OUT ${segment.fadeOut.toFixed(2)}s`)
    return parts.join(' // ')
  }
  const segmentLabel = (segment: TimelineSegment) => {
    const sequence = draft ? sequenceFor(draft, segment.sourcePath) : undefined
    return sequence ? sequenceLabel(sequence) : sourceName(segment.sourcePath)
  }
  const clipTitle = (segment: TimelineSegment) => {
    const kind = segment.sequence
      ? `image sequence, ${segment.sequence.frames} frames at ${segment.sequence.fps} fps`
      : segment.still ? 'still image' : 'media'
    return `${segmentLabel(segment)} — ${kind}, ${stamp(segment.duration)}${segment.trimmed ? ', trimmed' : ''}`
  }
  /**
   * Where the right-click menu was asked for, and where it ended up.
   *
   * The asked-for point is what the handler knows; the menu's own height is only known once it has
   * been drawn, and it varies with the state it is in, so the placement is worked out in a layout
   * effect from the measured element. Before that the menu is drawn at the pointer, which is where it
   * would be anyway in the common case, so there is nothing to see of the adjustment.
   */
  const menuPoint = (event: React.MouseEvent) => ({ x: event.clientX, y: event.clientY })
  const openClipMenu = (event: React.MouseEvent, segment: TimelineSegment, laneId: string, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    const point = menuPoint(event)
    const mainIndex = laneId === model.lanes[0]?.id ? index : null
    // The clip's own entry in the job, which is what a trim or a fit is keyed by.
    const clipIndex = mainIndex ?? Math.max(0, draft.sourcePaths.indexOf(segment.sourcePath))
    setTimelineMenu({
      kind: 'clip',
      x: point.x,
      y: point.y,
      sourceIndex: Math.max(0, draft.sourcePaths.indexOf(segment.sourcePath)),
      mainIndex,
      // The lane and the place in it, so a menu opened on a clip can name THAT clip: an audio track is
      // not in `sourcePaths` at all, and an index that misses it names the first video instead.
      laneId,
      segmentIndex: index,
      sourcePath: segment.sourcePath,
      label: segmentLabel(segment),
      fitKey: `${segment.sourcePath}#${clipIndex}`,
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

  const showBoundaries = cuts.length > 0
  // A single frame in and a single frame out has nothing to time.
  const stillFrameJob = isStillFrameJob(draft)
  const selectedBoundary = (() => {
    if (openBoundary == null) return null
    const segments = mainLane?.segments ?? []
    // An edge belongs to the timeline rather than to a clip, so it is cut from or to black with
    // only the one clip to fit into: the whole clip, less whatever a boundary at the other end
    // of the same clip is already using.
    if (openBoundary === 'head' || openBoundary === 'tail') {
      const clip = openBoundary === 'head' ? segments[0] : segments[segments.length - 1]
      if (!clip) return null
      const requested = edgeFade(draft, openBoundary)
      const neighbour = (openBoundary === 'head' ? clip.fadeOut : clip.fadeIn) || 0
      const maxFade = maxEdgeFade(clip.duration, neighbour)
      return { kind: 'edge' as const, edge: openBoundary, requested, fade: Math.min(requested, maxFade), maxFade }
    }
    const cut = cuts.find((candidate) => candidate.index === openBoundary)
    if (!cut || !segments[openBoundary] || !segments[openBoundary + 1]) return null
    const transition = draft.transitions?.[`${cut.sourcePath}#${openBoundary}`]
    const requested = transition && transition.type === 'fade' && transition.duration > 0 ? transition.duration : 0
    const maxFade = maxFadeAtBoundary(segments[openBoundary].duration, segments[openBoundary + 1].duration)
    // The request and what will actually render are reported separately. A fade that
    // a neighbour's length currently clamps away still reads as set, instead of
    // looking like the editor had forgotten it.
    return { kind: 'cut' as const, index: openBoundary, source: cut.sourcePath, requested, fade: Math.min(requested, maxFade), maxFade }
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
      playback.seek(Math.max(0, Math.min(1, seconds / duration)) * duration)
    }
    const move = (moveEvent: PointerEvent) => scrubTo(moveEvent.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
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
    void window.electronAPI?.quickLook(request.target, draft.id, request.trimIn, request.trimOut, request.sourceIndex, request.stillMode, settings?.screenshotDirectory, settings?.timestampDisplayMode || 'timestamp', helperFps, helperFrames)
  }

  const laneGap = (lane: TimelineLane) => Math.max(0, duration - lane.duration)
  const activeSegmentKey = playback.segment?.key
  const resolutionLabel = draft.sourceInfo?.videoStreams?.[0]?.resolution
    || draft.sourceMetadata?.[focusedSource ?? '']?.resolution
    || (draft.preset.width && draft.preset.height ? `${draft.preset.width}×${draft.preset.height}` : 'SOURCE')

  const dirty = isDirty(draft, baseline ?? draft)
  // A preset is only worth its name while it still describes the job. Once any of its own
  // fields is edited it no longer does, so it becomes CUSTOM: shown here as soon as an edit
  // lands, and written into the applied patch so the queue's badge agrees. Renaming an output
  // or setting a transition is not an encoding setting, so neither of those makes it custom.
  const presetEdited = JSON.stringify(draft.preset) !== JSON.stringify((baseline ?? draft).preset)
  /** The patch this window would send, built fresh so it never carries a stale snapshot. */
  const buildPatch = (): EditJobPatch => ({
    id: latest().id,
    // A hand-tuned preset stops claiming to be the preset it started from.
    preset: presetEdited ? { ...latest().preset, id: 'custom', name: 'CUSTOM' } : latest().preset,
    outputFilename: latest().outputFilename,
    outputFilenameManuallySet: latest().outputFilenameManuallySet,
    transitions: latest().transitions,
    sourceFit: latest().sourceFit,
    sourceCrop: latest().sourceCrop,
    mutedLanes: latest().mutedLanes,
    sourceTiming: sourceTimingOverrides(latest()),
  })
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
  const picture = naturalSize && naturalSize.key === playback.segment?.key ? naturalSize : undefined
  const naturalAspect = picture ? picture.width / picture.height : null
  /** The clip being shown, and the fit it carries, which is what places it in the frame. */
  const activeFitKey = playback.segment ? `${playback.segment.sourcePath}#${clipIndexOf(playback.segment)}` : null
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
  const cropShape = cropShapeChoice?.key === shapeKey ? cropShapeChoice.value : matchedProportion ?? FREEFORM
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
   * Takes the crop away once the user has confirmed it, on this clip or on every clip.
   *
   * EVERY clip means the job's own crop goes too, and in one step with them: a clip with no region of
   * its own falls back to the job's crop, so a job whose clips have all been told they are uncropped
   * would still crop anything added to it later. One draft write rather than two, so one undo takes
   * the whole decision back.
   */
  const clearCropConfirmed = (all: boolean) => {
    setConfirmingClearCrop(false)
    if (!all || !perClipFraming) { clearCrop(); return }
    const map: Record<string, SourceCrop> = {}
    draft.sourcePaths.forEach((sourcePath, index) => {
      if (mediaKind(sourcePath) !== 'audio') map[`${sourcePath}#${index}`] = { x: 0, y: 0, w: 1, h: 1 }
    })
    updateDraft({
      sourceCrop: Object.keys(map).length ? map : undefined,
      preset: { ...latest().preset, crop: undefined },
    })
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
      if (mediaKind(sourcePath) !== 'audio') map[`${sourcePath}#${index}`] = region
    })
    updateDraft({ sourceCrop: Object.keys(map).length ? map : undefined })
  }
  /**
   * Sets one crop edge from its field, in whichever unit the fields are currently showing.
   *
   * One edge moves at a time: the other three are already settled, so only the edited one changes
   * and the rest survive the trip through the unit's inverse. While the lock is on the axis that was
   * NOT typed follows from the one that was, so the figure in the field stays the one the user set
   * and the region is nonetheless the output's shape.
   */
  const setCropEdge = (edge: keyof CropFractions, raw: number) => {
    if (!crop) return
    const next = cropUnit === 'px'
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
    setCropShapeChoice({ key: shapeKey, value: label })
    const option = ASPECTS.find((candidate) => candidate.label === label)
    if (!option || !naturalAspect) return
    setCrop(cropForProportion(naturalAspect, option.ratio))
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
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
          <div className="editor-screen" onWheel={scrubByWheel}>
            {/* The media sits in its own measured stage, so the output frame outline can
                be drawn around the picture rather than around the panel. The stage is also the
                pan surface: everything drawn lives in one layer inside it and moves together
                when a zoom has left more than the panel can show. */}
            <div className={`editor-stage${drawable ? ' is-pannable' : ''}${canPlacePicture ? ' is-placing' : ''}`} ref={attachStage} onPointerDown={beginMonitorDrag}>
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
                  {playback.error
                    ? <span className="editor-screen-message">{playback.error}</span>
                    : stillFrameJob
                      ? <img className="editor-still" style={{ ...mediaStyle }} src={mediaUrl(draft.sourcePaths[0])} alt={sourceName(draft.sourcePaths[0])} onLoad={measureNatural} ref={(element) => logMediaElement(element, 'monitor-still')} />
                      // A picture file is drawn as a picture, whichever branch the timeline took to get
                      // here — the segment's own flag is not consulted, because the target is what would
                      // be decoded and it is the target that decides how to decode it.
                      : monitorShowsImage
                        ? <img className="editor-still" style={{ ...mediaStyle, opacity: previewGain }} src={elementUrl ?? mediaUrl(playback.segment?.sourcePath ?? '')} alt={sourceName(playback.segment?.sourcePath ?? '')} onLoad={measureNatural} ref={(element) => logMediaElement(element, 'monitor-still')} />
                        // Sound with no picture: a waveform, never a <video>. The element would be
                        // asked for a frame out of a file that has none.
                        : monitorIsAudio
                          ? monitorWaveform
                            ? <svg className="editor-waveform" width="100%" height="100%" viewBox={`0 0 ${monitorWaveform.width} ${monitorWaveform.height}`} preserveAspectRatio="none" aria-hidden="true">
                              <line x1="0" y1={monitorWaveform.height / 2} x2={monitorWaveform.width} y2={monitorWaveform.height / 2} stroke="var(--ui-border)" strokeWidth="1" />
                              {monitorWaveform.peaks.length
                                ? <path d={waveformPath({ peaks: monitorWaveform.peaks, width: monitorWaveform.width, height: monitorWaveform.height })} stroke="var(--crt-green)" strokeWidth={WAVEFORM_BAR} fill="none" />
                                : null}
                            </svg>
                            : <span className="editor-screen-message">{screenMessage}</span>
                          : elementUrl
                            ? <video
                              ref={(element) => { playback.attachVideo(element); logMediaElement(element, 'monitor-video') }}
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
                {frameRect && <div className="editor-frame" style={{ width: frameRect.width, height: frameRect.height }} aria-hidden="true"><b>OUTPUT {outputFrame?.width}×{outputFrame?.height}</b></div>}
                {/* The box the clip's own margins leave inside the frame. The background the export
                    will fill them with is already what shows through — the window is the output's own
                    black — so this only says where the box IS: the picture is scaled into it and
                    centred in it, and the offset then slides it from there. */}
                {insetBox && hasInsets(activeInsets) && <div className="editor-insets" style={{ left: insetBox.left, top: insetBox.top, width: insetBox.width, height: insetBox.height }} aria-hidden="true" />}
                {cropShade.map((band, index) => (
                  <div key={index} className="editor-crop-shade" style={{ left: band.left, top: band.top, width: band.width, height: band.height }} aria-hidden="true" />
                ))}
                {cropRect && <div className="editor-crop" style={{ left: cropRect.left, top: cropRect.top, width: cropRect.width, height: cropRect.height }} onPointerDown={beginCropMove}>
                  {(['left', 'top', 'right', 'bottom'] as const).map((edge) => (
                    <span key={edge} className={`crop-handle is-${edge}`} onPointerDown={(event) => beginCropDrag(edge, event)} role="presentation" />
                  ))}
                  {(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const).map((corner) => (
                    <span key={corner} className={`crop-corner is-${corner}`} onPointerDown={(event) => beginCropCorner(corner, event)} role="presentation" />
                  ))}
                </div>}
              </div>
            </div>
            <small>{focusedLabel} • {resolutionLabel}{duration > 0 ? ` • ${Math.round(fps)} FPS` : ''}</small>
            <small>{activeSegment ? `CLIP ${stamp(activeSegment.duration)}${activeSegment.trimmed ? ` · USED ${stamp(activeSegment.sourceIn)} → ${stamp(activeSegment.sourceIn + activeSegment.duration)}` : ''} · OUTPUT ${stamp(duration)}` : `OUTPUT ${stamp(duration)}`}</small>
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
            <span className="preview-divider" aria-hidden="true" />
            <label className="preview-zoom">
              <span>ZOOM</span>
              <select
                value={zoomOption}
                onChange={(event) => chooseZoom(event.target.value)}
                title="How large the monitor draws the output frame. The export is not affected, and neither is a clip's own fit."
                aria-label="Zoom the preview monitor"
              >
                {PREVIEW_ZOOM_STEPS.map((step) => <option key={step} value={String(step)}>{step}%</option>)}
                <option value="fitWidth">FIT WIDTH</option>
                <option value="fitHeight">FIT HEIGHT</option>
                <option value="fit">FIT</option>
                <option value="custom">CUSTOM...</option>
              </select>
            </label>
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
          {inspected != null && inspectedSource && (
            <div className="media-inspector">
              <button className="inspector-close" onClick={() => setInspected(null)} aria-label="Close the media info inspector" title="Close">&times;</button>
              <EditorRow label="SOURCE" value={inspectedSequence ? sequenceLabel(inspectedSequence) : sourceName(inspectedSource)} />
              <EditorRow label="FORMAT" value={(inspectedSource.split('.').pop() || 'UNKNOWN').toUpperCase()} />
              <EditorRow
                label="USED"
                value={inspectedSegment ? `${stamp(inspectedSegment.duration)}${inspectedSegment.trimmed ? ` OF ${stamp(sourceDuration(draft, inspectedSource, undefined, resolveTiming))} FROM ${stamp(inspectedSegment.sourceIn)}` : ''}` : (inspectedProbe ? stamp(inspectedProbe.duration) : 'PROBING...')}
              />
              <EditorField label="FPS" hint={inspectedEditable ? undefined : 'FROM THE SOURCE'}>{
                inspectedEditable
                  ? <select value={String(inspectedFps)} onChange={(event) => setSourceTiming(inspectedSource, { fps: Number(event.target.value) })}>
                    {[...new Set([...FPS_CHOICES, inspectedFps])].sort((a, b) => a - b).map((rate) => <option key={rate} value={String(rate)}>{rate}{FPS_CHOICES.includes(rate) ? '' : ' (CURRENT)'} FPS</option>)}
                  </select>
                  : <input className="editor-input" type="text" value={`${inspectedFps} FPS`} readOnly />
              }</EditorField>
              {inspectedSegment?.still && (
                <EditorField label="CLIP LENGTH" hint="THIS IMAGE">{
                  <NumberField
                    className="editor-input"
                    min={0.1}
                    step={0.1}
                    value={stillSecondsFor(draft, inspectedSource)}
                    onValue={(seconds) => { if (seconds > 0) setSourceTiming(inspectedSource, { seconds }) }}
                  />
                }</EditorField>
              )}
            </div>
          )}
          {previewNotice && <div className="editor-note is-warning">&gt; {previewNotice}</div>}
          <div className="editor-note">&gt; SPACE PLAYS, K STOPS. J / L SHUTTLE AND SPEED UP ON REPEAT; K+J OR K+L IS SLOW MOTION; A QUICK TAP STEPS ONE FRAME. IN / OUT POINTS COME FROM THE NATIVE PREVIEW. UNDO AND REDO ARE CMD+Z AND CMD+SHIFT+Z.</div>
        </section>

        <section className="timeline-panel">
          {stillFrameJob ? <>
            <div className="panel-kicker">TIMELINE // SINGLE FRAME</div>
            <div className="editor-note">&gt; THIS JOB MAPS ONE FRAME TO ONE FRAME, SO THERE IS NOTHING TO TIME. CHANGE THE FORMAT IN EXPORT SETTINGS TO TREAT THE IMAGE AS A {Math.round(draft.stillImageDuration || 10)}s CLIP.</div>
          </> : <>
          <div className="timeline-head">
            <div className="panel-kicker">TIMELINE // {draft.type.toUpperCase()}</div>
            <div className="timeline-zoom">
              <button onClick={() => setZoom((current) => clampZoom(current / 2))} disabled={zoom <= ZOOM_MIN} aria-label="Make the timeline shorter" title="Magnify out"><ZoomOut size={11} /></button>
              <span className="timeline-zoom-value">{Math.round(zoom * 100) / 100}×</span>
              <button onClick={() => setZoom((current) => clampZoom(current * 2))} disabled={zoom >= ZOOM_MAX} aria-label="Make the timeline longer" title="Magnify in"><ZoomIn size={11} /></button>
              <button
                onClick={() => {
                  // The viewport is read here and nowhere else: a fit is a decision, not a state the
                  // timeline lives in, so a later resize reveals more or less of it instead of
                  // re-deciding what the zoom should be.
                  const scroller = timelineScrollRef.current
                  if (!scroller) return
                  setZoom(clampZoom(fitZoom(duration, scroller.clientWidth)))
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
              <div className="timeline-gutter-ruler" aria-hidden="true" />
              {model.lanes.map((lane) => (
                <div className="timeline-lane-head" key={lane.id} onContextMenu={(event) => openLaneMenu(event, lane.id, lane.label)} title="Right-click to choose how this lane's clips are drawn">
                  <button
                    className={`lane-mute${muted[lane.id] ? ' is-muted' : ''}`}
                    onClick={() => setLaneMuted(lane.id, !muted[lane.id])}
                    aria-pressed={Boolean(muted[lane.id])}
                    title={lane.embedded ? 'Mute this stream. The export will not carry it.' : 'Mute this track. The export will not carry it.'}
                  >M</button>
                  <span>{lane.label}</span>
                </div>
              ))}
            </div>
            <div className="timeline-scroll" ref={attachLanes}>
              {/* The lane area's own width, with nothing in it but lane: the label column is not a
                  part of this drawing at all, which is what makes a point in it map to a time with
                  the timeline's rate and no other figure. */}
              <div className="timeline-lanes-inner" ref={timelineInnerRef} style={{ width: `${laneWidthFor(duration, zoom)}px` }}>
                <div className="timeline-ruler">
                  {/* Placed by TIME rather than by a share of the row: when a short timeline is
                      stretched to fill the panel, a percentage would put mid-way at the middle of the
                      panel instead of at half the output. */}
                  {Array.from({ length: 5 }, (_, index) => index / 4).map((fraction) => (
                    <span key={fraction} style={{ left: `${laneWidthFor(duration * fraction, zoom)}px`, transform: fraction === 0 ? 'none' : fraction === 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                      {duration > 0 ? stamp(duration * fraction) : '--:--:--.--'}
                    </span>
                  ))}
                </div>
                {model.lanes.map((lane) => (
                  <div className="timeline-lane" key={lane.id}>
                    <div className={`timeline-lane-track${lane.kind === 'audio' ? ' is-audio' : ''}`} onClick={seekFraction} title="Click to jump to this point">
                    {lane.segments.map((segment, index) => (
                      <div
                        key={segment.key}
                        className={`timeline-clip${segment.trimmed ? ' is-trimmed' : ''}${segment.key === activeSegmentKey ? ' is-active' : ''}${filmstripLanes[lane.id] ? ' is-film' : ''}`}
                        style={{ width: `${laneWidthFor(segment.duration, zoom)}px` }}
                        title={clipTitle(segment)}
                        onContextMenu={(event) => openClipMenu(event, segment, lane.id, index)}
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
                        <span className="timeline-clip-name">{segmentLabel(segment)}</span>
                        <small>{segmentDetail(segment)}</small>
                        {segment.fadeIn ? <span className="clip-fade clip-fade-in" style={{ width: `${Math.min(100, (segment.fadeIn / Math.max(segment.duration, 0.001)) * 100)}%` }} aria-hidden="true" /> : null}
                        {segment.fadeOut ? <span className="clip-fade clip-fade-out" style={{ width: `${Math.min(100, (segment.fadeOut / Math.max(segment.duration, 0.001)) * 100)}%` }} aria-hidden="true" /> : null}
                        {/* A visual clip that carries audio says so, and says whether the export still
                            carries it: green while it does, grey while the lane is muted. */}
                        {lane.kind === 'video' && sourceAudio[segment.sourcePath]
                          ? <span className={`clip-audio${muted[lane.id] ? ' is-muted' : ''}`} aria-hidden="true" />
                          : null}
                        {/* Anchored to this clip's own trailing edge, so the marker is on
                            the cut by construction. No arithmetic on the timeline's
                            length is involved, which is what put every marker far down
                            the lane in a combo whose audio outlasted the video. */}
                        {lane.id === mainLane?.id && index === 0 && (
                          <button
                            className={`boundary-add is-head${edgeFade(draft, 'head') > 0 ? ' is-active' : ''}${openBoundary === 'head' ? ' is-open' : ''}`}
                            onClick={(event) => { event.stopPropagation(); setOpenBoundary(openBoundary === 'head' ? null : 'head') }}
                            aria-label="Add a fade in from black"
                            title="Fade in from black"
                          />
                        )}
                        {lane.id === mainLane?.id && index < lane.segments.length - 1 && (
                          <button
                            className={`boundary-add${(draft.transitions?.[`${segment.sourcePath}#${index}`]?.duration ?? 0) > 0 ? ' is-active' : ''}${openBoundary === index ? ' is-open' : ''}`}
                            onClick={(event) => { event.stopPropagation(); setOpenBoundary(openBoundary === index ? null : index) }}
                            aria-label={`Add a transition after ${sourceName(segment.sourcePath)}`}
                            title={`Transition after ${sourceName(segment.sourcePath)}`}
                          />
                        )}
                        {lane.id === mainLane?.id && index === lane.segments.length - 1 && (
                          <button
                            className={`boundary-add is-tail${edgeFade(draft, 'tail') > 0 ? ' is-active' : ''}${openBoundary === 'tail' ? ' is-open' : ''}`}
                            onClick={(event) => { event.stopPropagation(); setOpenBoundary(openBoundary === 'tail' ? null : 'tail') }}
                            aria-label="Add a fade out to black"
                            title="Fade out to black"
                          />
                        )}
                      </div>
                    ))}
                    {laneGap(lane) > 0 && <div className="timeline-fill" style={{ width: `${laneWidthFor(laneGap(lane), zoom)}px` }} title="No media on this lane" />}
                  </div>
                </div>
              ))}
              <div className="timeline-playhead" style={{ left: `${playheadFraction * laneWidthFor(duration, zoom)}px` }} onPointerDown={beginSkimmerDrag} title="Drag to move the skimmer" role="presentation" />
              </div>
            </div>
          </div>
          {selectedBoundary && (() => {
            const set = (type: TransitionType, duration?: number) => selectedBoundary.kind === 'edge'
              ? setEdgeTransition(selectedBoundary.edge, type, duration)
              : setBoundaryTransition(selectedBoundary.index, type, duration)
            const heading = selectedBoundary.kind === 'edge'
              ? (selectedBoundary.edge === 'head' ? 'FADE IN FROM BLACK' : 'FADE OUT TO BLACK')
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
                  <button onClick={() => set('fade', Math.max(0.25, selectedBoundary.requested - 0.25))} disabled={selectedBoundary.requested <= 0.25} aria-label="Shorter fade">−</button>
                  <span className="boundary-duration-value">{selectedBoundary.requested.toFixed(2)}s</span>
                  <button onClick={() => set('fade', selectedBoundary.requested + 0.25)} aria-label="Longer fade">+</button>
                  {selectedBoundary.fade < selectedBoundary.requested && <small className="boundary-clamped">RENDERS {selectedBoundary.fade.toFixed(2)}s</small>}
                </div>
              )}
              <button className="boundary-close" onClick={() => setOpenBoundary(null)} aria-label="Close transition editor">×</button>
            </div>
          })()}
          {model.unusedVideoSources.length > 0 && <div className="editor-note">&gt; {model.unusedVideoSources.length} EXTRA VIDEO SOURCE(S) ({model.unusedVideoSources.map(sourceName).join(', ')}) ARE NOT USED HERE: THIS JOB MAPS ONE VIDEO STREAM. A STITCH JOB CONCATENATES THEM.</div>}
          {showBoundaries && <div className="editor-note">&gt; [+] ON A CUT FADES BOTH SIDES OF IT; [+] AT THE TIMELINE'S ENDS FADES FROM OR TO BLACK. THE ENCODER APPLIES THEM AND THE MONITOR MIRRORS THEM.</div>}
          <div className="editor-note">&gt; LANE WIDTHS ARE THE REAL TRIMMED DURATIONS; AUDIO PLAYS ALONGSIDE THE VIDEO FROM ZERO, SO THE OUTPUT RUNS TO {duration > 0 ? stamp(duration) : 'AN UNKNOWN LENGTH'}.</div>
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
            <EditorRow label="PRESET" value={presetEdited ? 'CUSTOM' : draft.preset.name} />
            <EditorToggle label="EXPORT VIDEO" checked={draft.preset.outputMode !== 'audio'} onChange={(checked) => updatePreset({ outputMode: checked ? undefined : 'audio' })} />
            <EditorToggle label="EXPORT AUDIO" checked={draft.preset.audioEnabled !== false} onChange={audioDisabled ? undefined : (checked) => updatePreset({ audioEnabled: checked })} reason={audioReason} />
            <EditorToggle label="EXPORT CAPTIONS" checked={false} reason="CAPTION OUTPUT HAS NO BACKING FIELD YET." />
          </>}

              {/* Resolution Scaling */}
            {tab === 'VIDEO' && <>
            {/* Three groups rather than eight foldouts: a group is a decision about the OUTPUT, and the
                settings inside one are read together or not at all. Folding a single field away would be
                a heading that only repeats the row beneath it. */}
            <EditorGroup id="output-frame" label="OUTPUT FRAME" hint="SHAPE AND SIZE" reason="What the encoder writes: the shape of the frame, the box it is scaled into, and an exact size that overrides both." collapsed={collapsedSections.includes('output-frame')} onToggle={toggleSection}>
            <div className="editor-field"><span>ASPECT RATIO<em>OUTPUT FRAME</em></span>
              <div className="aspect-row">
                {ASPECTS.map((candidate) => (
                  <button key={candidate.label} className={activeAspect === candidate.label ? 'is-selected' : ''} onClick={() => applyAspect(candidate.ratio)} title={`Output frame of ${candidate.label}`}>{candidate.label}</button>
                ))}
                <button className={matchSource ? 'is-selected' : ''} onClick={() => updatePreset({ width: undefined, height: undefined, resolution: 'source' })} title="Output frame follows the source">MS</button>
              </div>
            </div>
            <EditorField label="RESOLUTION" reason={videoReason}><select value={draft.preset.resolution} disabled={audioOnly || isGif} onChange={(event) => changeResolution(event.target.value as EncodingPreset['resolution'])}>{RESOLUTIONS.map((name) => <option key={name} value={name}>{name.toUpperCase()}</option>)}</select></EditorField>
            <div className="editor-field"><span>EXACT SIZE<em>OVERRIDES RESOLUTION</em></span>
              <div className="exact-row">
                <label className="mini-field"><span>W</span><NumberField min={2} step={2} className="editor-input" value={draft.preset.width} placeholder={outputFrame ? String(outputFrame.width) : '\u2014'} disabled={audioOnly || isGif} onValue={(value) => setExactEdge('width', value)} title="Output width in pixels" /></label>
                <label className="mini-field"><span>H</span><NumberField min={2} step={2} className="editor-input" value={draft.preset.height} placeholder={outputFrame ? String(outputFrame.height) : '\u2014'} disabled={audioOnly || isGif} onValue={(value) => setExactEdge('height', value)} title="Output height in pixels" /></label>
                <button className={`exact-icon${lockProportion ? ' is-on' : ''}`} aria-pressed={lockProportion} onClick={() => setLockProportion((on) => !on)} title={lockProportion ? 'Proportions locked' : 'Keep proportions'}>{lockProportion ? <Link size={12} /> : <Unlink size={12} />}</button>
                <button className="exact-icon" disabled={!exactSet} onClick={clearExactSize} title="Clear exact size" aria-label="Clear exact size"><RotateCcw size={12} /></button>
              </div>
            </div>
            </EditorGroup>
            <EditorGroup id="framing" label="FRAMING" hint="HOW EACH CLIP SITS" reason="What each clip is framed with: what part of its source is kept, the margin it leaves, and where the picture is placed inside the frame." collapsed={collapsedSections.includes('framing')} onToggle={toggleSection}>
            <div className="editor-subsection">
              <EditorToggle
                label="CROP SOURCE VIDEO"
                checked={cropEnabled}
                reason={videoReason}
                onChange={(checked) => {
                  if (checked) { enableCrop(); return }
                  // Unchecking throws the crop away, and a crop is a hand-made region that took several
                  // drags to place; so it is asked about rather than done. The switch stays as it is
                  // until the question is answered, which is what makes CANCEL a real way out.
                  setClearCropAll(false)
                  setConfirmingClearCrop(true)
                }}
              />
              {confirmingClearCrop && <div className="crop-confirm">
                <span>TAKE THE CROP AWAY?</span>
                {perClipFraming && <label className="crop-lock">
                  <input type="checkbox" checked={clearCropAll} onChange={(event) => setClearCropAll(event.target.checked)} />
                  <span>APPLY TO ALL CLIPS</span>
                </label>}
                <div className="crop-confirm-actions">
                  <button onClick={() => setConfirmingClearCrop(false)}>CANCEL</button>
                  <button className="is-danger" onClick={() => clearCropConfirmed(clearCropAll)}>OK</button>
                </div>
              </div>}
              {cropEnabled && crop && <>
                <div className="crop-head">
                  <select value={cropShape} disabled={!naturalAspect || Boolean(lockRatio)} onChange={(event) => applyCropProportion(event.target.value)} title={lockRatio ? 'THE CROP IS LOCKED TO THE OUTPUT SHAPE, SO THIS LIST IS NOT IN PLAY.' : naturalAspect ? 'FREEFORM holds no shape at all; a named shape centres the crop on it' : 'THE PICTURE HAS NOT LOADED, SO ITS SHAPE IS UNKNOWN.'}>
                    <option value={FREEFORM}>{FREEFORM}</option>
                    {ASPECTS.map((candidate) => <option key={candidate.label} value={candidate.label}>{candidate.label}</option>)}
                  </select>
                  <div className="unit-toggle">
                    <button className={cropUnit === '%' ? 'is-on' : ''} onClick={() => setCropUnit('%')} title="Per cent of the source">%</button>
                    <button className={cropUnit === 'px' ? 'is-on' : ''} disabled={!picture} onClick={() => setCropUnit('px')} title={picture ? 'Pixels of the source' : 'THE PICTURE HAS NOT LOADED, SO ITS PIXEL SIZE IS UNKNOWN.'}>px</button>
                  </div>
                </div>
                <div className="crop-row">
                  {(['left', 'top', 'right', 'bottom'] as const).map((edge) => (
                    <label key={edge} className="mini-field">
                      <span>{edge.slice(0, 1).toUpperCase()}</span>
                      <NumberField
                        min={0}
                        max={cropUnit === 'px' && picture
                          ? Math.round((1 - MIN_KEPT - crop[OPPOSITE_EDGE[edge]]) * (edge === 'left' || edge === 'right' ? picture.width : picture.height))
                          : Math.round((1 - MIN_KEPT - crop[OPPOSITE_EDGE[edge]]) * 100)}
                        step={1}
                        className="editor-input"
                        value={cropUnit === 'px' && cropPx ? cropPx[edge] : Math.round(crop[edge] * 100)}
                        onValue={(raw) => setCropEdge(edge, raw)}
                        title={`${edge} edge, ${cropUnit === 'px' ? 'pixels' : 'per cent'} of the source`}
                      />
                    </label>
                  ))}
                </div>
                <label className="crop-lock" title={lockRatio ? 'The crop is held to the output frame\u2019s shape' : 'THE OUTPUT FRAME\u2019S SHAPE IS NOT KNOWN YET.'}>
                  <input type="checkbox" checked={Boolean(draft.preset.cropLockToOutput)} disabled={!naturalAspect || !outputFrame} onChange={(event) => setCropLock(event.target.checked)} />
                  <span>LOCK CROP TO OUTPUT AR</span>
                </label>
                {perClipFraming && (
                  <div className="crop-actions">
                    <span>THIS CLIP{cropEnabled ? '' : ' — UNCROPPED'}</span>
                    <button onClick={applyCropToAll} title="Put this crop on every clip in the job">APPLY TO ALL CLIPS</button>
                  </div>
                )}
                <div className="editor-note">&gt; THE SHAPE LIST CENTRES A CROP ON A SHAPE; FREEFORM HOLDS NO SHAPE AT ALL, SO A CORNER FOLLOWS THE POINTER ON BOTH AXES AND THE REGION KEEPS ITS OWN. A CROP IS OF THE SOURCE, SO A CHANGE OF OUTPUT SIZE OR SHAPE NEVER INVALIDATES IT; IT IS TAKEN BEFORE ANY SCALING, SO CROPPING TO A SHAPE IS A CROP THEN A FIT. DRAG THE EDGES ON THE PREVIEW, OR SET THE FOUR FIGURES HERE.{lockRatio ? ' WITH THE LOCK ON, EVERY EDIT HOLDS THE OUTPUT\u2019S SHAPE.' : ''}</div>
              </>}
            </div>
            {/* The margins this clip leaves at the edges of the output. They are not a position and not
                a crop: a crop decides what part of the SOURCE is kept and this decides how much of the
                OUTPUT the clip is not given, so it survives a change of resolution or shape exactly as
                the crop does. The four figures are per cent of the output frame, which is why they mean
                the same at any resolution. */}
            {/* A div rather than the EditorField label, because the row holds buttons: a button inside
                a label also activates the label's own control, so the unit switch would steal focus from
                the field beside it. The exact-size row is built this way for the same reason. */}
            <div className="editor-field" title="The margin this clip leaves around itself: the box its fit scales it into. The picture is centred in the box, and the OFFSET below then slides it from there. 0 everywhere is the whole frame, which is what the clip gets until it is inset.">
              <span>INSETS · L / T / R / B<em>{insetUnit === 'px' ? 'PIXELS OF THE OUTPUT FRAME' : '% OF THE OUTPUT FRAME'}</em></span>
              <div className="sub-head">
                <div className="unit-toggle">
                  <button className={insetUnit === '%' ? 'is-on' : ''} onClick={() => setInsetUnit('%')} title="Per cent of the output frame">%</button>
                  <button className={insetUnit === 'px' ? 'is-on' : ''} disabled={!outputFrame} onClick={() => setInsetUnit('px')} title={outputFrame ? 'Pixels of the output frame' : 'THE OUTPUT FRAME IS NOT KNOWN YET.'}>px</button>
                </div>
                <button className="exact-icon" disabled={!hasInsets(activeInsets)} onClick={() => setInsets({ l: 0, t: 0, r: 0, b: 0 })} title="Take all four margins away" aria-label="Take all four margins away"><RotateCcw size={12} /></button>
              </div>
              <div className="crop-row">
                {(['l', 't', 'r', 'b'] as const).map((edge) => {
                  // The two sides of one axis are measured along the same one, which is what makes a
                  // figure in pixels comparable between them.
                  const span = outputFrame ? (edge === 'l' || edge === 'r' ? outputFrame.width : outputFrame.height) : 0
                  const inPixels = insetUnit === 'px' && span > 0
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
              </div>
            </div>
            <div className="editor-note">&gt; A MARGIN SHRINKS THE BOX THE CLIP IS FITTED INTO, SO THE PICTURE GETS SMALLER AND THE OUTPUT'S OWN BACKGROUND SHOWS IN THE MARGIN. THE PICTURE KEEPS ITS SHAPE EITHER WAY. AN INSET AND THE OFFSET ARE INDEPENDENT: THE INSET SETS THE SIZE OF THE BOX, AND THE OFFSET BELOW SLIDES THE PICTURE IN THE FRAME.{hasInsets(activeInsets) ? '' : ' ALL FOUR ARE ZERO, SO THIS CLIP IS USING THE WHOLE FRAME.'}</div>
            <div className="editor-divider" aria-hidden="true" />
            {/* Where the picture sits on the canvas, as a pair of figures. Two fields rather than one
                slider, because a position is two numbers and a bar with a middle would say the middle
                is special; the middle is only where the picture STARTS. Nothing is bounded: X and Y go
                as far in either direction as they are asked to, and past the canvas the background
                shows, which is what a position past the edge looks like. */}
            <div className="editor-field" title="Where the picture sits on the output canvas. 0 and 0 is centred; the figures may be negative, and may be far enough to take the picture clear of the frame, where the background shows. The monitor’s dragger writes the same two figures.">
              <span>OFFSET · X / Y<em>{offsetUnit === 'px' ? 'PIXELS OF THE OUTPUT FRAME' : '% OF THE OUTPUT FRAME'}</em></span>
              <div className="sub-head">
                <div className="unit-toggle">
                  <button className={offsetUnit === '%' ? 'is-on' : ''} onClick={() => setOffsetUnit('%')} title="Per cent of the output frame">%</button>
                  <button className={offsetUnit === 'px' ? 'is-on' : ''} disabled={!outputFrame} onClick={() => setOffsetUnit('px')} title={outputFrame ? 'Pixels of the output frame' : 'THE OUTPUT FRAME IS NOT KNOWN YET.'}>px</button>
                </div>
                <button className="exact-icon" disabled={pictureOffset.x === 0 && pictureOffset.y === 0} onClick={() => setFitOffset(0, 0)} title="Centre the picture again" aria-label="Centre the picture again"><RotateCcw size={12} /></button>
              </div>
              <div className="offset-row">
                {(['x', 'y'] as const).map((axis) => {
                  const span = outputFrame ? (axis === 'x' ? outputFrame.width : outputFrame.height) : 0
                  const inPixels = offsetUnit === 'px' && span > 0
                  const value = axis === 'x' ? pictureOffset.x : pictureOffset.y
                  // The setter works in the frame's own fractions, so a pixel entry is divided by the
                  // axis it was read along; the figure NOT being edited is carried through as a
                  // fraction too, whatever unit it happens to be displayed in.
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
              </div>
            </div>
            <div className="editor-note">&gt; 0 / 0 CENTRES THE PICTURE, WHICH IS WHERE IT SITS UNTIL IT IS MOVED. THE FIGURES ARE THE OUTPUT FRAME'S OWN, SO THEY MEAN THE SAME AT ANY RESOLUTION, AND THEY ARE NOT HELD IN: A PICTURE MOVED PAST AN EDGE IS CLIPPED BY THE FRAME, AND A PICTURE THAT LEAVES A GAP IS FILLED WITH THE BACKGROUND. DRAG IT ON THE PREVIEW, OR SET THE TWO FIGURES HERE.</div>
            </EditorGroup>
            <EditorGroup id="encoding" label="ENCODING" hint="RATE AND QUALITY" reason="How the output is encoded: the frame rate it is written at, and the bitrate it is written to." collapsed={collapsedSections.includes('encoding')} onToggle={toggleSection}>
            <EditorField label="FPS" hint="BLANK = SOURCE" reason={audioOnly ? 'THIS CONTAINER CARRIES AUDIO ONLY.' : undefined}><NumberField min={1} className="editor-input" value={draft.preset.fps} placeholder={String(defaultFps)} disabled={audioOnly} onValue={changeFps} onClear={() => changeFps(undefined)} /></EditorField>
            <EditorField label="QUALITY" hint="BITRATE, E.G. 8M" reason={videoReason}><input type="text" className="editor-input" value={draft.preset.videoBitrate ?? ''} placeholder="SOURCE" disabled={audioOnly || isGif || draft.preset.videoCodec === 'copy'} onChange={(event) => updatePreset({ videoBitrate: event.target.value.trim() || undefined })} /></EditorField>
            <div className="editor-note">&gt; BITRATE IS IGNORED WHILE THE VIDEO CODEC IS SET TO COPY. ADVANCED CONTROLS OPEN IN CUSTOM PRESET.</div>
            </EditorGroup>
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
            : <><button onClick={() => (dirty ? setConfirmingDiscard(true) : void window.electronAPI?.cancelEditJob())}>CANCEL</button><button onClick={() => applyEdits(false)} disabled={!dirty} title={dirty ? 'Apply without closing' : 'NO CHANGES TO APPLY.'}>APPLY</button><button className="primary-retro" onClick={() => applyEdits(true)} title="Apply and close">OK</button></>}
        </div>
      </aside>
    </div>

    {audioLanes.map((lane) => {
      const laneSegment = lane.segments[0]
      const url = laneSegment ? sourceUrlFor(laneSegment) : null
      return url ? <audio
        key={lane.id}
        ref={(element) => { audioElementsRef.current[lane.id] = element; if (element) element.muted = Boolean(muted[lane.id]); logMediaElement(element, `audio:${lane.id}`) }}
        src={url}
        preload="auto"
      /> : null
    })}

    {/* Fixed rather than positioned inside the timeline, so it is never clipped by the scroll
        area it was opened from. */}
    {timelineMenu && <div className="timeline-menu" ref={menuRef} style={{ left: menuAt.x, top: menuAt.y }} role="menu">
      <span className="timeline-menu-head">{timelineMenu.label}</span>
      {timelineMenu.kind === 'clip' ? (timelineMenu.confirming ? <>
        {/* The removal is the one thing in here that cannot be taken back by the window, so it asks
            first. A source that is the job's last takes the job with it, and says so outright. */}
        <span className="timeline-menu-head">REMOVE {sourceName(timelineMenu.sourcePath)}?</span>
        <p className="timeline-menu-note">{draft.sourcePaths.length <= 1 && !draft.additionalAudioTracks?.length
          ? 'THIS IS THE JOB\u2019S LAST SOURCE, SO REMOVING IT REMOVES THE JOB.'
          : 'THE CLIP GOES FROM THE TIMELINE AND FROM THE JOB\u2019S SOURCE LIST.'}</p>
        <div className="timeline-menu-actions">
          <button role="menuitem" onClick={() => setTimelineMenu({ ...timelineMenu, confirming: undefined })}>KEEP IT</button>
          <button
            role="menuitem"
            className="is-danger"
            onClick={() => {
              const { sourcePath, sourceIndex } = timelineMenu
              setTimelineMenu(null)
              void window.electronAPI?.removeEditJobSource(draft.id, sourcePath, sourceIndex)
            }}
          >REMOVE</button>
        </div>
      </> : <>
        <button role="menuitem" onClick={() => { const target = timelineMenu; setTimelineMenu(null); void openNativePreview({ sourcePath: target.sourcePath, sourceIndex: target.mainIndex ?? 0 }) }}>QUICK LOOK...</button>
        <button role="menuitem" onClick={() => { const target = timelineMenu; setTimelineMenu(null); setInspected({ laneId: target.laneId, segmentIndex: target.segmentIndex }) }}>MEDIA INFO</button>
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
        <button role="menuitem" className="is-danger" onClick={() => setTimelineMenu({ ...timelineMenu, confirming: true })}>REMOVE SOURCE</button>
      </>) : <>
        <button role="menuitem" className={filmstripLanes[timelineMenu.laneId] ? '' : 'is-on'} onClick={() => { const laneId = timelineMenu.laneId; setTimelineMenu(null); setFilmstripLanes((current) => ({ ...current, [laneId]: false })) }}>COMPACT VIEW</button>
        <button role="menuitem" className={filmstripLanes[timelineMenu.laneId] ? 'is-on' : ''} onClick={() => { const laneId = timelineMenu.laneId; setTimelineMenu(null); setFilmstripLanes((current) => ({ ...current, [laneId]: true })) }}>{model.lanes.find((lane) => lane.id === timelineMenu.laneId)?.kind === 'audio' ? 'WAVEFORM' : 'FILMSTRIP'}</button>
      </>}
    </div>}
  </div>
}
