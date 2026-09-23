export type TaskStatus = 'pending' | 'encoding' | 'done' | 'error' | 'paused'

export interface MediaStreamInfo {
  codec: string
  resolution?: string
  fps?: number
  bitrate?: string
  channels?: number
  sampleRate?: number
  language?: string
}

export interface MediaProbeInfo {
  format: string
  duration: number
  size: number
  bitrate: number
  videoStreams: MediaStreamInfo[]
  audioStreams: MediaStreamInfo[]
  dpi?: string
  colorProfile?: string
  pixelFormat?: string
}

export interface EncodingPreset {
  id: string
  name: string
  container: 'mp4' | 'mov' | 'mkv' | 'webm' | 'mp3' | 'wav' | 'm4a' | 'flac' | 'png' | 'jpg' | 'gif'
  videoCodec: 'h264' | 'hevc' | 'prores' | 'vp9' | 'av1' | 'png' | 'mjpeg' | 'copy'
  audioCodec: 'aac' | 'mp3' | 'opus' | 'pcm' | 'flac' | 'copy'
  resolution: 'source' | '4k' | '1080p' | '720p'
  videoBitrate?: string // e.g. '8M'
  audioBitrate?: string // e.g. '320k'
  fps?: number
  crf?: number // 18-28
  hardwareAccelerated?: boolean // VideoToolbox on macOS
  proresProfile?: 'proxy' | 'lt' | 'standard' | 'hq' | '4444'
  suffix?: string
  width?: number
  height?: number
  /**
   * The picture kept from each frame, as fractions of the frame, before any scaling. It is
   * applied to the output canvas, so a multi-clip job loses the same edges from every clip.
   */
  crop?: { left: number; top: number; right: number; bottom: number }
  /**
   * Whether crop editing is held to the output frame's aspect ratio.
   *
   * An editing constraint rather than part of the crop itself: what it produces is captured by the
   * region it leaves behind, so turning it off again does not change any crop already shaped by it.
   */
  cropLockToOutput?: boolean
  aspectRatio?: 'source' | '1:1' | '4:3' | '16:9' | '9:16' | 'custom'
  audioEnabled?: boolean
  frameRate?: number
  outputMode?: 'video' | 'audio'
  audioFormat?: 'aac' | 'mp3' | 'opus' | 'pcm' | 'flac'
  audioSampleRate?: number
  imageOutputMode?: 'sequence' | 'still'
  gifMode?: 'regular' | 'loop' | 'bounce'
  /**
   * Whether a still is attached to a sound container that can hold one.
   *
   * On unless switched off, and only ever asked of a container that can carry artwork: a WAV has no
   * room for it, and says so rather than being handed a stream it cannot hold.
   */
  coverArt?: boolean
}

export interface AudioTrackItem {
  id: string
  path: string
  language: string // e.g. 'eng', 'spa', 'fra'
  title?: string
}

/** Clip-boundary transitions. Only meaningful where clips are concatenated. */
export type TransitionType = 'none' | 'fade'

/**
 * The region of a clip's SOURCE that the job keeps, normalised to the source's own size.
 *
 * Keyed like trimPoints and sourceFit, by the clip that owns it, so it follows a clip through a
 * reorder and goes with it when it is removed. An absent entry is the whole clip.
 *
 * Normalised to the SOURCE rather than to the output, which is what makes it survive a change of
 * output resolution or aspect ratio: the crop decides what part of the clip is kept, and the output
 * only ever affects where that part is placed afterwards.
 */
export interface SourceCrop {
  /** Left edge, as a fraction of the source's width. */
  x: number
  /** Top edge, as a fraction of the source's height. */
  y: number
  /** Kept width, as a fraction of the source's width. */
  w: number
  /** Kept height, as a fraction of the source's height. */
  h: number
}

/**
 * The margin a clip leaves at each edge of the OUTPUT frame, as fractions of it.
 *
 * Not a crop, and the two are independent: a crop decides what part of the SOURCE is kept, and an
 * inset decides how much of the OUTPUT the clip is not given. Like the crop it is a fraction of the
 * frame it means something in, so it survives a change of output resolution or aspect ratio, and zero
 * on every edge is the whole frame — which is what a clip carrying no record behaves as.
 */
export interface Insets {
  /** Left edge, as a fraction of the output frame's width. */
  l: number
  /** Top edge, as a fraction of the output frame's height. */
  t: number
  /** Right edge, as a fraction of the output frame's width. */
  r: number
  /** Bottom edge, as a fraction of the output frame's height. */
  b: number
}

/**
 * How one clip is placed in the output frame, when it is not left to fit itself.
 *
 * Keyed like trimPoints, by the clip that owns it (`"path#index"`), so it follows the clip
 * through a reorder. An absent entry is the default fit: the whole clip inside the frame, with
 * the shortfall filled in.
 */
export interface SourceFit {
  /**
   * The axis fixed to the frame's; the other one overflows or falls short. `contain` fixes neither,
   * which is the default fit — a clip carrying only a `contain` fit is one that has been given a
   * POSITION and no change of scale.
   */
  mode: 'contain' | 'width' | 'height'
  /**
   * Where the picture sits on the output canvas, as fractions of the OUTPUT frame: 0, 0 is centred,
   * which is where it sits when nothing has been moved.
   *
   * Fractions of the frame rather than pixels, so a change of resolution or aspect ratio does not
   * invalidate it. NOT clamped: a position may be negative, or far enough to push the picture wholly
   * or partly off the canvas, and where the picture does not cover the canvas the background shows.
   * That is the point of a position — bars are what a position produces, not a mistake in it.
   */
  offset: { x: number; y: number }
  /**
   * The margin this clip leaves around itself, as fractions of the output frame.
   *
   * This is the box the fit scales the clip INTO and centres it in, and the frame the offset then
   * slides the result around in. The two are independent and they compose in that order: the insets
   * decide how big the picture is and where its box is, and the offset decides where the picture sits
   * once it is that size. Absent, or zero on every edge, leaves every step of that exactly as it was
   * — which is what makes insets additive rather than a second way of saying position.
   */
  insets?: Insets
}

export interface ClipTransition {
  type: TransitionType
  /** Length of the fade on each side of the boundary, in seconds. */
  duration: number
}
export interface SequenceInput {
  dir: string
  pattern: string
  globPattern: string
  startNumber: number
  frameCount: number
  hasGaps: boolean
  missing: number[]
  fps: number
  duration?: number
  firstFrame: string
  width?: number
  height?: number
  pixelFormat?: string
  hasAlpha?: boolean
  prefix?: string
  ext?: string
  files?: string[]
  totalSize?: number
}
export interface SourceMetadata {
  resolution?: string
  fps?: number
  duration?: number
  format?: string
}
export interface QueueTask {
  id: string
  type: 'transcode' | 'stitch' | 'multitrack' | 'combo'
  /** COMBO interpretation: mux/stack tracks or concatenate both axes. */
  comboMode?: 'multitrack' | 'stitch'
  sourcePaths: string[] // 1 for transcode/multitrack, >=2 for stitch
  outputDirectory: string
  outputFilename: string
  preset: EncodingPreset
  status: TaskStatus
  skipped?: boolean
  progress: number // 0 - 100
  fps?: number
  currentTimemark?: string
  speed?: string
  etaSeconds?: number
  errorMessage?: string
  sourceInfo?: MediaProbeInfo
  // Special feature params:
  additionalAudioTracks?: AudioTrackItem[]
  outputFilenameManuallySet?: boolean
  sourceBaseName?: string
  trimPoints?: Record<string, { in: number; out: number }>
  /** Temporary playable previews for imported image sequences, keyed by first image path. */
  imageSequencePreviews?: Record<string, string>
  sequenceInput?: SequenceInput
  sequenceInputs?: Record<string, SequenceInput>
  sourceMetadata?: Record<string, SourceMetadata>
  quickLookSourceIndex?: number
  stillImageDuration?: number
  /**
   * Transitions at clip boundaries, keyed by the clip that PRECEDES the boundary
   * (`"path#index"`), mirroring how trimPoints are keyed. A boundary fades the
   * preceding clip out and the following clip in, through black. Only STITCH
   * concatenates, so other job types ignore this.
   */
  transitions?: Record<string, ClipTransition>
  /**
   * How each clip is placed in the output frame, keyed by the clip that owns it, mirroring how
   * trimPoints are keyed. Absent means the default fit.
   */
  sourceFit?: Record<string, SourceFit>
  /**
   * The region of each clip's source the job keeps, keyed by the clip that owns it, mirroring how
   * trimPoints are keyed. Absent means the whole clip.
   */
  sourceCrop?: Record<string, SourceCrop>
  /**
   * Lanes whose audio the export does NOT carry, by lane id.
   *
   * The same toggle that silences a lane while monitoring decides whether it reaches the output, so
   * a mute is a decision about the job rather than about the monitor. An absent entry is a lane that
   * is carried; the map being absent altogether is a job nothing has been muted in.
   */
  mutedLanes?: Record<string, boolean>
}

/**
 * The only fields the EDIT JOB window is permitted to change.
 *
 * Everything else on a QueueTask is owned by the queue or the encoding engine
 * (progress, status, speed, eta, error state, probe results, trim points,
 * additional tracks) and must survive an apply untouched. The editor holds a
 * snapshot taken when it opened, so sending a whole QueueTask back would
 * overwrite live encoding state with stale values.
 */
export interface EditJobPatch {
  id: string
  preset: EncodingPreset
  outputFilename: string
  outputFilenameManuallySet?: boolean
  transitions?: Record<string, ClipTransition>
  /** Per-clip output fit, keyed like the transitions and carried whole rather than interpreted. */
  sourceFit?: Record<string, SourceFit>
  /** Per-clip source crop, keyed like the fit and carried whole rather than interpreted. */
  sourceCrop?: Record<string, SourceCrop>
  /** Lanes whose audio the export does not carry, carried whole like the fit. */
  mutedLanes?: Record<string, boolean>
  /**
   * Per-source timing the window owns: the rate a still or sequence is rendered at, and
   * the length of a still's clip. Keyed by source path.
   */
  sourceTiming?: Record<string, { fps?: number; seconds?: number }>
  /**
   * The job's sources, sent only when the WINDOW changed the list.
   *
   * A removal is the one edit that moves every other clip's place, so the queue does the removing and
   * re-keying rather than the window: it names the list the job now has, and what that took out — and
   * what that moves — is worked out where every other change to a job's sources is. Absent when the
   * window did not touch the list, so a reorder made in the queue is not overwritten by a snapshot
   * that never knew about it.
   */
  sourcePaths?: string[]
  /** Carried with the sources for the same reason, and absent on the same terms. */
  additionalAudioTracks?: NonNullable<QueueTask['additionalAudioTracks']>
}

export interface PresetRule {
  id: string
  pattern: string // regex or glob like *4K*
  presetId: string
}

export interface AppSettings {
  maxConcurrentTasks: number
  useHardwareAcceleration: boolean
  notifyOnCompletion: boolean
  webhookUrl?: string
  defaultOutputDir?: string
  cacheDirectory?: string
  saveTempNextToSource: boolean
  pauseOnHighLoad: boolean
  sequenceFps?: number
  /**
   * Frame rate a still image is given when it is exported as video rather than as a
   * single frame. Falls back to `sequenceFps`, then to 25.
   */
  defaultImageFps?: number
  screenshotDirectory?: string
  defaultImageDuration: number
  timestampDisplayMode?: 'timestamp' | 'framestamp'
  /**
   * Which of the EDIT JOB sidebar's groups are folded away, by each group's own id.
   *
   * A way of LOOKING at the settings rather than a setting: it changes nothing about what is exported.
   * It is kept with the rest all the same, because the sidebar is long enough that folding it is the
   * difference between seeing the setting wanted and scrolling past a dozen that are not — and having
   * to fold the same groups again on every launch would make that a chore rather than a preference.
   * Absent, or missing a group, means that group is open: nothing is hidden until it is folded.
   */
  collapsedSections?: string[]
}
