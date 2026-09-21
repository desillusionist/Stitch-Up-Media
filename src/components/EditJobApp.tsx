import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, RotateCcw, Unlink, ZoomIn, ZoomOut } from 'lucide-react'
import { AppSettings, EditJobPatch, EncodingPreset, QueueTask, SourceCrop, SourceFit, TransitionType } from '../types'
import { deriveOutputFilename } from '../lib/outputNaming'
import { mediaKind } from '../lib/mediaKind'
import { applyContainerChange, IMAGE_CONTAINERS } from '../lib/containerSwitch'
import { resolveQuickLookRequest } from '../lib/quickLookTarget'
import { mediaUrl } from '../lib/mediaUrl'
import { buildTimeline, clipIndexOf, clipsConcatenate, edgeFade, effectiveCropFor, frameStamp, HEAD_FADE_KEY, isStillFrameJob, maxEdgeFade, maxFadeAtBoundary, sequenceFor, sourceDuration, sourceFitFor, sourceFps, SourceTiming, stillSecondsFor, TAIL_FADE_KEY, timecode, TimelineLane, TimelineModel, TimelineSegment } from '../lib/timelineModel'
import { sequenceLabel } from '../lib/sequenceLabel'
import { computeFilmstrip, FILMSTRIP_CLIP_HEIGHT, FILMSTRIP_SETTLE_MS, frameKey, thumbnailSignature } from '../lib/filmstrip'
import { WAVEFORM_BAR, peaksForTrim, waveformPath } from '../lib/waveform'
import { cropBands, cropFractions, cropForProportion, cropPixels, exactSizeFields, hasCrop, holdCropShape, insetCrop, keptAspect, outputFrameSize, resizeCorner, shiftCrop, resolutionBox, aspectSize, resolutionShortSide, resizeExact, clampCrop, MAX_CROP, CropCorner, CropFractions } from '../lib/outputFrame'
import { DEFAULT_PREVIEW_ZOOM, MAX_PREVIEW_ZOOM, MIN_PREVIEW_ZOOM, PREVIEW_ZOOM_STEPS, PreviewZoom, clampPan, clampPreviewZoom, isPresetZoom, panSlack, zoomedRaster } from '../lib/previewZoom'
import { ZOOM_MAX, ZOOM_MIN, clampZoom, contentWidthFor, fitZoom, laneWidthFor, secondsAt } from '../lib/timelineScale'

/** The output shapes offered as buttons. The frame is the encoder's canvas, not a hint. */
const ASPECTS: Array<{ label: string; ratio: number }> = [
  { label: '16:9', ratio: 16 / 9 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '1:1', ratio: 1 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '9:16', ratio: 9 / 16 },
]
const ASPECT_TOLERANCE = 0.01
import { sourceTimingOverrides, SourceTimingOverride, withSourceTiming } from '../lib/sourceTiming'
import { clampFitOffset, cropFractionsOf, DEFAULT_FIT_OFFSET, placedSource, sourceCropOf } from '../lib/sourceFit'
import { useConsolidatedPlayback } from '../hooks/useConsolidatedPlayback'
import { scrollToKeepVisible, skimmerOffset } from '../lib/timelinePan'

const tabs = ['EXPORT', 'VIDEO', 'AUDIO', 'EFFECTS', 'CAPTIONS'] as const
type Tab = typeof tabs[number]

const CONTAINERS: Array<EncodingPreset['container']> = ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'flac', 'png', 'jpg', 'gif']
const VIDEO_CODECS: Array<EncodingPreset['videoCodec']> = ['copy', 'h264', 'hevc', 'prores', 'vp9', 'av1', 'png', 'mjpeg']
const AUDIO_CODECS: Array<EncodingPreset['audioCodec']> = ['copy', 'aac', 'mp3', 'opus', 'pcm', 'flac']
const AUDIO_CONTAINERS: Array<EncodingPreset['container']> = ['mp3', 'wav', 'm4a', 'flac']
const RESOLUTIONS: Array<EncodingPreset['resolution']> = ['source', '4k', '1080p', '720p']

/** Lane label column width. Mirrored in CSS and in the playhead offset. */
const LANE_LABEL_WIDTH = 102
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
  | { kind: 'clip'; x: number; y: number; sourceIndex: number; mainIndex: number | null; label: string; fitKey: string; visual: boolean }
  | { kind: 'lane'; x: number; y: number; laneId: string; label: string }

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
  // Resolved preview targets, keyed by the source they belong to. The target is not
  // always the stored path: an image sequence plays through a generated clip. They
  // are all resolved up front rather than when the playhead reaches one, because
  // resolving takes IPC and, for a sequence with no cached clip, a whole ffmpeg run.
  // Doing that on arrival is what made the skimmer stumble at the start of every
  // sequence segment while the monitor said PREPARING THIS SEGMENT.
  const [mediaTargets, setMediaTargets] = useState<Record<string, { path: string; previewUnavailable?: boolean }>>({})
  /** Set when a still could not be turned into a clip, so the monitor is not lying. */
  const [previewNotice, setPreviewNotice] = useState<string | null>(null)
  /** Source whose MEDIA INFO inspector is open, by index on the main lane. */
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null)
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
  /** Each source's audio as peaks, read once per file, for a lane drawn as a waveform. */
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({})
  const waveformsAskedRef = useRef<Set<string>>(new Set())
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
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

  // Whether each source has an audio stream of its own, probed once per source: it is a fact about
  // the file, and it is what a clip's hairline reports, so it must be known for every source and
  // not only for the ones a probe was already needed for.
  useEffect(() => {
    if (!candidateSources.length) return
    const missing = candidateSources.filter((sourcePath) => sourceAudio[sourcePath] === undefined && !probedPathsRef.current.has(`audio:${sourcePath}`))
    if (!missing.length) return
    missing.forEach((sourcePath) => probedPathsRef.current.add(`audio:${sourcePath}`))
    let cancelled = false
    void Promise.all(missing.map(async (sourcePath) => {
      try {
        const info = await window.electronAPI?.probeMedia(sourcePath)
        return [sourcePath, Boolean(info?.audioStreams?.length)] as const
      } catch {
        return [sourcePath, false] as const
      }
    })).then((entries) => {
      if (!cancelled) setSourceAudio((current) => ({ ...current, ...Object.fromEntries(entries) }))
    })
    return () => { cancelled = true }
  }, [probeSignature])
  const model: TimelineModel | null = useMemo(
    () => (draft ? buildTimeline(draft, { resolveTiming }) : null),
    [timelineSignature, probedTiming],
  )
  // The audio of every lane being drawn as a waveform, read once per file. It is the file's audio
  // rather than the clip's, so a trim or a zoom needs no new reading: what is drawn of it changes,
  // what it is does not. It waits until there is a lane showing one, since a file that is only ever
  // drawn as a clip of frames never needs decoding for its peaks.
  useEffect(() => {
    const bridge = window.electronAPI
    if (!bridge?.waveformFor || !model) return
    const wanted = new Set<string>()
    model.lanes.forEach((lane) => {
      if (lane.kind !== 'audio' || !filmstripLanes[lane.id]) return
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
  }, [filmstripLanes, timelineSignature, model])
  // Frame rate of the primary source, for stepping and reverse. Kept separate from
  // the displayed rate because the hook is created before a segment is known.
  const primaryFps = draft ? sourceFps(draft, draft.sourcePaths[0], undefined, resolveTiming) : 25

  const playback = useConsolidatedPlayback(
    model ?? { lanes: [], duration: 0, unusedVideoSources: [] },
    audioElementsRef,
    { playable: Boolean(model && model.duration > 0), fps: primaryFps },
  )

  const focusedSourceIndex = playback.segmentIndex
  // The frame the encoder will produce, worked out before the strip's own layout and fetching
  // rather than beside the monitor, because a tile is the shape of the frame: a frame the strips
  // saw late would be a strip laid out for a shape that is no longer the output's. It needs nothing
  // but the task and the media's own size, and both are known by this point in the render.
  const outputFrame = draft ? outputFrameSize({
    natural: naturalSize && naturalSize.key === playback.segment?.key ? naturalSize : undefined,
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

  // Every main-lane source gets a target, once per rate, in the background. Nothing
  // on the playback path waits for this: an unresolved source simply renders nothing
  // for the moment it takes, which is one IPC round trip rather than a clip build.
  useEffect(() => {
    const task = draftRef.current
    if (!task) { setMediaTargets({}); return }
    const wanted = new Map<string, string>()
    Array.from(new Set(task.sourcePaths)).forEach((sourcePath) => {
      const rate = sourceFps(task, sourcePath, undefined, resolveTiming)
      wanted.set(`${sourcePath}\u0000${rate}`, sourcePath)
    })
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
      return [sourcePath, {
        width: resolution && resolution[0] > 0 ? resolution[0] : 16,
        height: resolution && resolution[1] > 0 ? resolution[1] : 9,
        fps: info?.videoStreams?.[0]?.fps && info.videoStreams[0].fps > 0 ? info.videoStreams[0].fps : 30,
      }] as const
    })).then((entries) => {
      if (cancelled || !entries.length) return
      setSourceShape((current) => ({ ...current, ...Object.fromEntries(entries) }))
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
  const planFor = (segment: TimelineSegment) => {
    const shape = sourceShape[segment.sourcePath]
    if (!shape || segment.duration <= 0) return undefined
    // The lane's width is the clip's trimmed length at the timeline's rate, which is a function of
    // the zoom alone: nothing here is read from the window, so a resize cannot re-lay a strip out.
    return computeFilmstrip({
      laneWidth: laneWidthFor(segment.duration, zoom),
      thumbHeight: FILMSTRIP_CLIP_HEIGHT,
      outAspect: frameAspect,
      fps: shape.fps,
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
  /** A frame already fetched. */
  const frameImageFor = (segment: TimelineSegment, frame: number) => {
    const target = mediaTargets[segment.sourcePath]?.path
    return target ? frameImages[target]?.[keyFor(segment, frame)] : undefined
  }

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
    const wanted = new Map<string, { target: string; signature: string; jobs: Array<{ time: number; key: string }>; fps: number; source: { width: number; height: number }; fit?: SourceFit; crop?: CropFractions }>()
    model.lanes.forEach((lane) => {
      if (!filmstripLanes[lane.id]) return
      lane.segments.forEach((segment) => {
        const plan = planFor(segment)
        const shape = sourceShape[segment.sourcePath]
        const target = mediaTargets[segment.sourcePath]?.path
        // A still has no frames to sample: its one picture repeated is its strip, and it is drawn
        // straight from the file rather than extracted.
        if (!plan || !shape || !target || segment.still) return
        const signature = signatureFor(segment)
        const fit = draft ? sourceFitFor(draft, segment.sourcePath, clipIndexOf(segment)) : undefined
        // The clip's own crop, which the chain crops with before it fits: a strip is a picture of the
        // output, and the output is cropped.
        const crop = draft ? effectiveCropFor(draft, segment.sourcePath, clipIndexOf(segment)) : undefined
        const source = { width: shape.width, height: shape.height }
        const id = `${target}#${signature}`
        const entry = wanted.get(id) ?? { target, signature, jobs: [], fps: shape.fps, source, fit, crop }
        plan.times.forEach((time, cell) => {
          const key = keyFor(segment, plan.frames[cell])
          if (frameImages[target]?.[key]) return
          if (framesPendingRef.current[`${target}#${key}`]) return
          entry.jobs.push({ time, key })
        })
        if (entry.jobs.length) wanted.set(id, entry)
      })
    })
    if (!wanted.size) return
    // Everything asked for, so that the marks can be released when the answer comes back.
    const asked = [...wanted].flatMap(([, { target, jobs }]) => jobs.map(({ key }) => `${target}#${key}`))
    const timer = window.setTimeout(() => {
      asked.forEach((key) => { framesPendingRef.current[key] = true })
      void Promise.all([...wanted].map(async ([, { target, signature, jobs, fps, source, fit, crop }]) => {
        const images = await bridge.framesAt(target, {
          times: jobs.map((job) => job.time),
          fps,
          signature,
          frame: outputFrame,
          source,
          fit,
          crop,
        })
        return [target, jobs, images] as const
      })).then((entries) => {
        // Released whether or not a later layout has moved on: a mark left behind is a frame that
        // is never asked for again, so those tiles would stay blank for good. The pictures are
        // stored on the same terms — a key names a source frame and the shape it was drawn at,
        // neither of which a resize changes — so work already done is never thrown away.
        asked.forEach((key) => { delete framesPendingRef.current[key] })
        setFrameImages((current) => {
          const next = { ...current }
          let arrived = false
          entries.forEach(([target, jobs, images]) => {
            const store = { ...(next[target] ?? {}) }
            jobs.forEach(({ key }, position) => {
              const image = images[position]
              if (image) { store[key] = image; arrived = true }
            })
            next[target] = store
          })
          return arrived ? next : current
        })
      })
    }, FILMSTRIP_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [filmstripLanes, laneZoom, mediaTargets, sourceShape, timelineSignature, frameImages, draft?.preset.crop, outputFrame, draft?.sourceFit])

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
      if (isTyping(event.target)) return
      const code = event.code
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
      offset: skimmerOffset(playheadFraction, inner.clientWidth, LANE_LABEL_WIDTH),
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

  const updateDraft = (changes: Partial<QueueTask>) => {
    const next = { ...latest(), ...changes }
    draftRef.current = next
    setDraft(next)
  }
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
  /**
   * MATCH SOURCE: no exact size and no named resolution, so the frame is the source's own.
   * It is the state the window starts in, and the way back to it once a shape has been chosen.
   */
  const matchSource = !draft.preset.width && !draft.preset.height && draft.preset.resolution === 'source'
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

  const changeFps = (value: string) => {
    const parsed = Number(value)
    updatePreset({ fps: value.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 ? undefined : Math.round(parsed) })
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
  const inspectedSegment = inspectedIndex != null ? mainLane?.segments[inspectedIndex] : undefined
  const inspectedSource = inspectedSegment?.sourcePath ?? (inspectedIndex != null ? draft.sourcePaths[inspectedIndex] : undefined)
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
  const setSourceFit = (key: string, mode: SourceFit['mode'] | null) => {
    const next = { ...(latest().sourceFit || {}) }
    const existing = next[key]
    if (mode === null) delete next[key]
    else next[key] = {
      mode,
      // Switching axes starts centred, since where the clip sits across one axis says nothing
      // about the other; the same fit switched back keeps where it was put.
      offset: existing && existing.mode === mode ? clampFitOffset(existing.offset) : DEFAULT_FIT_OFFSET,
    }
    updateDraft({ sourceFit: Object.keys(next).length ? next : undefined })
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
  const sequenceSources = new Set([...Object.keys(draft.sequenceInputs || {}), ...(draft.sequenceInput ? [draft.sequenceInput.firstFrame] : [])])
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
  /** Keeps a right-click menu on screen when the click landed near an edge. */
  const menuPoint = (event: React.MouseEvent) => ({
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 200)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 160)),
  })
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
      label: segmentLabel(segment),
      fitKey: `${segment.sourcePath}#${clipIndex}`,
      // A fit places a picture in the frame, and the encoder applies one only where clips are
      // concatenated: a stitch, or a combo with more than one visual. Where the encoder would
      // ignore it the item is not offered at all, rather than shown doing nothing.
      visual: model.lanes.find((lane) => lane.id === laneId)?.kind !== 'audio'
        && (draft.type === 'stitch' || (draft.type === 'combo' && draft.sourcePaths.filter((source) => mediaKind(source) !== 'audio').length > 1)),
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
   * A sequence frame cannot be handed to a video element, so it plays through the
   * resolved preview. Returning null keeps the element idle until that preview
   * exists, rather than letting it fail on a PNG.
   */
  const sourceUrlFor = (segment: TimelineSegment | undefined): string | null => {
    if (!segment) return null
    // A sequence frame cannot be handed to a video element, so it plays through the
    // resolved preview. Returning null keeps the element idle until that exists,
    // rather than letting it fail on a PNG.
    if (sequenceSources.has(segment.sourcePath)) {
      const target = mediaTargets[segment.sourcePath]
      return target ? mediaUrl(target.path) : null
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
      const seconds = secondsAt(clientX - rect.left - LANE_LABEL_WIDTH, zoom)
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
  const openNativePreview = async (sourceIndex: number = focusedSourceIndex) => {
    // A still that becomes a timed clip is opened in the advanced helper as a
    // generated clip, so its filmstrip and trimming behave like real footage.
    const request = await resolveQuickLookRequest(draft, window.electronAPI, { sourceIndex, preferTimedStill: true })
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
  /** The crop the preset applies. Its edges are fractions of the picture, which is what makes them
   *  survive a resize; the pixel figures the fields show are read off `picture` just above. */
  const crop = perClipFraming && activeSourceCrop ? cropFractionsOf(activeSourceCrop) : draft.preset.crop
  const cropPx = crop && picture ? cropPixels(crop, picture) : null
  /** The proportion list's value: no crop at all, a shape the crop keeps, or the user's own. */
  const keptProportion = crop && naturalAspect ? keptAspect(crop, naturalAspect) : undefined
  const matchedProportion = keptProportion != null
    ? ASPECTS.find((candidate) => Math.abs(candidate.ratio - keptProportion) < ASPECT_TOLERANCE)?.label
    : undefined
  const cropProportion = !crop || !hasCrop(crop) ? 'NONE' : matchedProportion ?? 'CUSTOM'
  /** The shape a corner drag holds: the chosen proportion, or nothing to hold the region's own. */
  const cropProportionRatio = ASPECTS.find((candidate) => candidate.label === cropProportion)?.ratio
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
  /** Sets the proportion list: NONE clears the crop, a shape centres the crop on it. */
  const applyCropProportion = (label: string) => {
    const option = ASPECTS.find((candidate) => candidate.label === label)
    if (!option || !naturalAspect) { setCrop({ left: 0, top: 0, right: 0, bottom: 0 }); return }
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
   * shape when the list is on NONE or CUSTOM. The corner opposite the one dragged stays put.
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
    // NONE in the list means no shape is being held at all, so the corner is free. A locked crop is
    // never free: the whole point of the lock is that the corner keeps the output's proportions.
    const free = !lockRatio && cropProportion === 'NONE'
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
  /** The axis a chosen fit leaves something to spare on, which is the one the dragger moves along. */
  const fitAxis = activeFit && placement ? placement.overflow : null
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
   * Moves the clip along the axis it overflows, which is what the dragger is for.
   *
   * The travel is read against the overflow in pixels on screen, so the picture keeps up with the
   * pointer rather than drifting with the zoom: dragging the whole of what is over moves the clip
   * from one end of its range to the other. It is written to the draft, so APPLY sends it, and the
   * thumbnails follow it — the export follows it too, which is the point of it not being view-only
   * like the pan beside it.
   */
  const beginFitDrag = (event: React.PointerEvent) => {
    if (!fitAxis || !placement || !frameRect || !outputFrame || !activeFitKey) return
    const scale = frameRect.width / Math.max(1, outputFrame.width)
    const travel = Math.max(1, (placement.size[fitAxis] - outputFrame[fitAxis]) * scale)
    const start = fitAxis === 'height' ? event.clientY : event.clientX
    const from = clampFitOffset(activeFit?.offset ?? DEFAULT_FIT_OFFSET)
    let moved = false
    const move = (moveEvent: PointerEvent) => {
      const at = fitAxis === 'height' ? moveEvent.clientY : moveEvent.clientX
      const delta = at - start
      if (!moved && Math.abs(delta) < 3) return
      moved = true
      const next = clampFitOffset(from + delta / travel)
      updateDraft({ sourceFit: { ...(latest().sourceFit ?? {}), [activeFitKey]: { mode: activeFit?.mode ?? 'width', offset: next } } })
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
   * On the picture, with a fit that has somewhere to move, it repositions the clip — the gesture
   * the fit is for, and the one the export follows. Anywhere else, when the view is larger than
   * the panel, it pans the view, which nothing but the monitor follows. A press on the crop box
   * belongs to the crop in either case, and a press that never travels is left to whatever it
   * landed on, so the media still toggles playback on a plain click.
   */
  const beginMonitorDrag = (event: React.PointerEvent) => {
    const target = event.target as Element | null
    if (target?.closest('.editor-crop')) return
    if (fitAxis && target?.closest('.editor-video, .editor-still, .editor-frame, .editor-crop-shade')) return beginFitDrag(event)
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
            <div className={`editor-stage${drawable ? ' is-pannable' : ''}${fitAxis ? ` is-fitting is-fit-${fitAxis === 'height' ? 'y' : 'x'}` : ''}`} ref={attachStage} onPointerDown={beginMonitorDrag}>
              <div className="editor-stage-pan" style={{ transform: `translate(${panX}px, ${panY}px)` }}>
                {/* The frame's own window: the picture is drawn inside it and clipped by it, so
                    what the monitor shows is the output's own area and not the picture spilling
                    past it. A clip fitted to the width really is cropped at the frame's edges. */}
                {frameRect && frameOrigin && <div className="editor-frame-window" style={{ left: frameOrigin.x, top: frameOrigin.y, width: frameRect.width, height: frameRect.height }}>
                  {playback.error
                    ? <span className="editor-screen-message">{playback.error}</span>
                    : stillFrameJob
                      ? <img className="editor-still" style={{ ...mediaStyle }} src={mediaUrl(draft.sourcePaths[0])} alt={sourceName(draft.sourcePaths[0])} onLoad={measureNatural} />
                      : playback.segment?.still
                        ? <img className="editor-still" style={{ ...mediaStyle, opacity: previewGain }} src={mediaUrl(playback.segment.sourcePath)} alt={sourceName(playback.segment.sourcePath)} onLoad={measureNatural} />
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
                </div>}
                {!frameRect && <span className="editor-screen-message">{screenMessage}</span>}
                {frameRect && <div className="editor-frame" style={{ width: frameRect.width, height: frameRect.height }} aria-hidden="true"><b>OUTPUT {outputFrame?.width}×{outputFrame?.height}</b></div>}
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
          {inspectedIndex != null && inspectedSource && (
            <div className="media-inspector">
              <button className="inspector-close" onClick={() => setInspectedIndex(null)} aria-label="Close the media info inspector" title="Close">&times;</button>
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
                  <input
                    className="editor-input"
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={stillSecondsFor(draft, inspectedSource)}
                    onChange={(event) => {
                      const seconds = Number(event.target.value)
                      if (Number.isFinite(seconds) && seconds > 0) setSourceTiming(inspectedSource, { seconds })
                    }}
                  />
                }</EditorField>
              )}
            </div>
          )}
          {previewNotice && <div className="editor-note is-warning">&gt; {previewNotice}</div>}
          <div className="editor-note">&gt; SPACE PLAYS, K STOPS. J / L SHUTTLE AND SPEED UP ON REPEAT; K+J OR K+L IS SLOW MOTION; A QUICK TAP STEPS ONE FRAME. IN / OUT POINTS COME FROM THE NATIVE PREVIEW.</div>
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
                  setZoom(clampZoom(fitZoom(duration, scroller.clientWidth - LANE_LABEL_WIDTH)))
                }}
                disabled={duration <= 0}
                title="Fit the whole timeline into the panel"
              >FIT</button>
            </div>
          </div>
          <div className="timeline-lanes" ref={attachLanes} onWheel={scrubByWheel}>
            <div className="timeline-lanes-inner" ref={timelineInnerRef} style={{ width: `${contentWidthFor(duration, zoom, LANE_LABEL_WIDTH)}px`, '--filmstrip-tile': `${FILMSTRIP_CLIP_HEIGHT}px` } as React.CSSProperties}>
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
                  <div className="timeline-lane-head" onContextMenu={(event) => openLaneMenu(event, lane.id, lane.label)} title="Right-click to choose how this lane's clips are drawn">
                    <button
                      className={`lane-mute${muted[lane.id] ? ' is-muted' : ''}`}
                      onClick={() => setLaneMuted(lane.id, !muted[lane.id])}
                      aria-pressed={Boolean(muted[lane.id])}
                      title={lane.embedded ? 'Mute this stream. The export will not carry it.' : 'Mute this track. The export will not carry it.'}
                    >M</button>
                    <span>{lane.label}</span>
                  </div>
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
              <div className="timeline-playhead" style={{ left: `${LANE_LABEL_WIDTH + playheadFraction * laneWidthFor(duration, zoom)}px` }} onPointerDown={beginSkimmerDrag} title="Drag to move the skimmer" role="presentation" />
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
                <label className="mini-field"><span>W</span><input type="number" min="2" step="2" className="editor-input" value={draft.preset.width ?? ''} placeholder={outputFrame ? String(outputFrame.width) : '\u2014'} disabled={audioOnly || isGif} onChange={(event) => setExactEdge('width', Number(event.target.value))} title="Output width in pixels" /></label>
                <label className="mini-field"><span>H</span><input type="number" min="2" step="2" className="editor-input" value={draft.preset.height ?? ''} placeholder={outputFrame ? String(outputFrame.height) : '\u2014'} disabled={audioOnly || isGif} onChange={(event) => setExactEdge('height', Number(event.target.value))} title="Output height in pixels" /></label>
                <button className={`exact-icon${lockProportion ? ' is-on' : ''}`} aria-pressed={lockProportion} onClick={() => setLockProportion((on) => !on)} title={lockProportion ? 'Proportions locked' : 'Keep proportions'}>{lockProportion ? <Link size={12} /> : <Unlink size={12} />}</button>
                <button className="exact-icon" disabled={!exactSet} onClick={clearExactSize} title="Clear exact size" aria-label="Clear exact size"><RotateCcw size={12} /></button>
              </div>
            </div>
            <div className="editor-subsection">
              <EditorToggle
                label="CROP SOURCE VIDEO"
                checked={cropEnabled}
                reason={videoReason}
                onChange={(checked) => checked ? enableCrop() : clearCrop()}
              />
              {cropEnabled && crop && <>
                <div className="crop-head">
                  <select value={cropProportion} disabled={!naturalAspect || Boolean(lockRatio)} onChange={(event) => applyCropProportion(event.target.value)} title={lockRatio ? 'THE CROP IS LOCKED TO THE OUTPUT SHAPE, SO THIS LIST IS NOT IN PLAY.' : naturalAspect ? 'Crop the picture to a shape' : 'THE PICTURE HAS NOT LOADED, SO ITS SHAPE IS UNKNOWN.'}>
                    <option value="NONE">NONE</option>
                    {ASPECTS.map((candidate) => <option key={candidate.label} value={candidate.label}>{candidate.label}</option>)}
                    <option value="CUSTOM" disabled>CUSTOM</option>
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
                      <input
                        type="number"
                        min="0"
                        max={cropUnit === 'px' && picture ? Math.round(MAX_CROP * (edge === 'left' || edge === 'right' ? picture.width : picture.height)) : Math.round(MAX_CROP * 100)}
                        step="1"
                        className="editor-input"
                        value={cropUnit === 'px' && cropPx ? cropPx[edge] : Math.round(crop[edge] * 100)}
                        onChange={(event) => setCropEdge(edge, Number(event.target.value) || 0)}
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
                <div className="editor-note">&gt; THE SHAPE LIST CENTRES A CROP ON THE PICTURE; NONE CLEARS IT. A CROP IS OF THE SOURCE, SO A CHANGE OF OUTPUT SIZE OR SHAPE NEVER INVALIDATES IT; IT IS TAKEN BEFORE ANY SCALING, SO CROPPING TO A SHAPE IS A CROP THEN A FIT. DRAG THE EDGES ON THE PREVIEW, OR SET THE FOUR FIGURES HERE.{lockRatio ? ' WITH THE LOCK ON, EVERY EDIT HOLDS THE OUTPUT\u2019S SHAPE.' : ''}</div>
              </>}
            </div>
            <EditorField label="FPS" hint="BLANK = SOURCE" reason={audioOnly ? 'THIS CONTAINER CARRIES AUDIO ONLY.' : undefined}><input type="number" min="1" className="editor-input" value={draft.preset.fps ?? ''} placeholder={String(defaultFps)} disabled={audioOnly} onChange={(event) => changeFps(event.target.value)} /></EditorField>
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
            : <><button onClick={() => (dirty ? setConfirmingDiscard(true) : void window.electronAPI?.cancelEditJob())}>CANCEL</button><button onClick={() => applyEdits(false)} disabled={!dirty} title={dirty ? 'Apply without closing' : 'NO CHANGES TO APPLY.'}>APPLY</button><button className="primary-retro" onClick={() => applyEdits(true)} title="Apply and close">OK</button></>}
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

    {/* Fixed rather than positioned inside the timeline, so it is never clipped by the scroll
        area it was opened from. */}
    {timelineMenu && <div className="timeline-menu" style={{ left: timelineMenu.x, top: timelineMenu.y }} role="menu">
      <span className="timeline-menu-head">{timelineMenu.label}</span>
      {timelineMenu.kind === 'clip' ? <>
        <button role="menuitem" onClick={() => { const index = timelineMenu.sourceIndex; setTimelineMenu(null); void openNativePreview(index) }}>QUICK LOOK...</button>
        <button role="menuitem" onClick={() => { const index = timelineMenu.mainIndex ?? timelineMenu.sourceIndex; setTimelineMenu(null); setInspectedIndex(index) }}>MEDIA INFO</button>
        {timelineMenu.visual && (() => {
          const fit = draft.sourceFit?.[timelineMenu.fitKey]
          return <>
            <span className="timeline-menu-divider" aria-hidden="true" />
            <button
              role="menuitemcheckbox"
              aria-checked={fit?.mode === 'width'}
              className={fit?.mode === 'width' ? 'is-on' : ''}
              onClick={() => { const key = timelineMenu.fitKey; setTimelineMenu(null); setSourceFit(key, fit?.mode === 'width' ? null : 'width') }}
              title="Fill the output frame's width and crop what the height overflows by. The export follows this."
            >FIT TO WIDTH</button>
            <button
              role="menuitemcheckbox"
              aria-checked={fit?.mode === 'height'}
              className={fit?.mode === 'height' ? 'is-on' : ''}
              onClick={() => { const key = timelineMenu.fitKey; setTimelineMenu(null); setSourceFit(key, fit?.mode === 'height' ? null : 'height') }}
              title="Fill the output frame's height and crop what the width overflows by. The export follows this."
            >FIT TO HEIGHT</button>
          </>
        })()}
      </> : <>
        <button role="menuitem" className={filmstripLanes[timelineMenu.laneId] ? '' : 'is-on'} onClick={() => { const laneId = timelineMenu.laneId; setTimelineMenu(null); setFilmstripLanes((current) => ({ ...current, [laneId]: false })) }}>COMPACT VIEW</button>
        <button role="menuitem" className={filmstripLanes[timelineMenu.laneId] ? 'is-on' : ''} onClick={() => { const laneId = timelineMenu.laneId; setTimelineMenu(null); setFilmstripLanes((current) => ({ ...current, [laneId]: true })) }}>{model.lanes.find((lane) => lane.id === timelineMenu.laneId)?.kind === 'audio' ? 'WAVEFORM' : 'FILMSTRIP'}</button>
      </>}
    </div>}
  </div>
}
