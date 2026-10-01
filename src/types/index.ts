export type TaskStatus = 'pending' | 'encoding' | 'done' | 'error' | 'paused'

export interface MediaStreamInfo {
  codec: string
  resolution?: string
  fps?: number
  bitrate?: string
  channels?: number
  sampleRate?: number
  language?: string
  /**
   * How many bits one sample is, where the container records it.
   *
   * A PCM or FLAC file carries it; a lossy codec has no such thing, which is why this is absent rather than
   * zero for an mp3 — the absence is the fact, and a `0 BIT` would be a claim about the file.
   */
  bitDepth?: number
  /** The speaker layout where the file names one (`stereo`, `5.1`). `unknown` is answered as none. */
  channelLayout?: string
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
  /**
   * What the picture is written as.
   *
   * The set is what the encoder can actually be asked for. It grew the intermediates a finishing house
   * works in — DXV and Hap for Resolume and Vidvox playback, MPEG-4 part 2 and QuickTime Animation for
   * older masters — which is why which of them is OFFERED is a question about the container rather than
   * about this list: see `src/lib/codecChoices.ts`.
   */
  videoCodec: 'h264' | 'hevc' | 'prores' | 'vp9' | 'av1' | 'png' | 'mjpeg' | 'gif' | 'dxv' | 'hap' | 'mpeg4' | 'qtrle' | 'copy'
  audioCodec: 'aac' | 'mp3' | 'opus' | 'pcm' | 'flac' | 'copy'
  resolution: 'source' | '4k' | '1080p' | '720p'
  videoBitrate?: string // e.g. '8M'
  audioBitrate?: string // e.g. '320k'
  fps?: number
  crf?: number // 18-28
  hardwareAccelerated?: boolean // VideoToolbox on macOS
  proresProfile?: 'proxy' | 'lt' | 'standard' | 'hq' | '4444' | '4444xq'
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
  /**
   * How many channels the export writes. Absent means whatever the path would have written anyway.
   *
   * The monitor's own `-ac` for every path that owns the output layout, so a 5.1 source can be folded to
   * stereo without a second encode. It is capped at stereo for the same reason the drawing's own graph
   * lays its audio out as mono or stereo: the two halves of one stream cannot be laid out differently.
   */
  audioChannels?: 1 | 2
  imageOutputMode?: 'sequence' | 'still'
  gifMode?: 'regular' | 'loop' | 'bounce'
  /**
   * The picture an audio job is given when the export can hold one.
   *
   * Absent is the job's own default: the still it already has, if its visual IS a still, and black
   * otherwise. `still` is never chosen where there is none, and `visualization` draws the export's own
   * mix — see `visualizationGraph`.
   */
  audioPicture?: 'black' | 'still' | 'visualization' | 'custom'
  /**
   * The picture a job with sound is given when its picture source is a CUSTOM image.
   *
   * A file the user picked, shown as the export's whole picture — held for the length of the sound and scaled
   * into the frame with its shape kept, exactly as the still a job was covered with is. It is deliberately NOT
   * a drawing's background: this is the picture, with nothing drawn over it.
   */
  audioPictureImage?: string
  /**
   * Which drawing, when the picture source is a visualization. Absent means the waveform.
   *
   * The first two draw the WHOLE sound into one picture, which the export then holds for its length, so the
   * editor can show a still of exactly what will be written; the last three draw an instant at a time. See
   * `VISUALIZATIONS` for the table the editor and the encoder both read.
   */
  visualization?: 'waveform' | 'spectrum' | 'eq' | 'waveform-scroll' | 'spectrum-scroll' | 'mirrored-bars' | 'scope' | 'led-eq' | 'matrix-panel' | 'peak-pills'
  /** The colour the drawing is made in, as ffmpeg takes it. Absent means the app's green. */
  visualizationColor?: string
  /**
   * The EQ drawing's own knobs. They are read only when the template is EQ — see `eqStyleOf`, which is what
   * the editor and the encoder both ask so the two cannot disagree about a job that was saved before they
   * existed.
   */
  /** How many bars an EQ drawing is divided into. Absent means the default density. */
  eqBars?: number
  /** The gap between EQ bars, in pixels of the output frame. Absent means solid. */
  eqGap?: number
  /** The EQ's amplitude scale. Absent means logarithmic. */
  eqAmplitude?: 'lin' | 'sqrt' | 'cbrt' | 'log'
  /** The EQ's frequency scale. Absent means linear. */
  eqFrequency?: 'lin' | 'log' | 'rlog'
  /** The EQ's minimum amplitude — how quiet a frequency may be and still be drawn. Absent means ffmpeg's own. */
  eqSensitivity?: number
  /**
   * The palette a drawing is made in. Absent means the app's own green.
   *
   * It sets the COLOUR (unless the job names one of its own) and, for the two spectra — which colour
   * themselves by intensity rather than by a hex — which monochrome ramp they are drawn with.
   */
  drawingTheme?: 'green' | 'amber'
  /** The EQ and the mirrored bars: dividers across the bars, so each becomes a stack of blocks. */
  eqSegmented?: boolean
  /**
   * Whether the bar drawings hold their peaks.
   *
   * The drawing is split, one half is run through `lagfun` so its brightest points fade rather than vanish,
   * and the two are recombined by lightening — so a live bar stays crisp while the peaks it reached linger
   * above it as ghosts. Absent means the template's own default, which is on for the LED templates and off
   * elsewhere; a decay of zero turns it off whatever this says — see `eqPeakDecay`.
   */
  eqPeakHold?: boolean
  /**
   * How long a held peak lingers, 0 to 1: the share of its height it keeps each frame. Absent means the
   * template's own default, and zero means no hold at all, because a peak that decays to nothing instantly is
   * no peak. It is only read when a hold is asked for.
   */
  eqPeakDecay?: number
  /**
   * How thick the divider between a segmented drawing's blocks is, in pixels. Absent means the template's
   * own — a hairline for the ordinary blocks, and a broader gap for the pills.
   */
  eqSegmentGap?: number
  /** Whether the LED EQ draws its frequency bands along the bottom. Absent means the template's own default. */
  eqLabels?: boolean
  /** The waveform templates' amplitude scale. Absent means linear. */
  waveScale?: 'lin' | 'log' | 'sqrt' | 'cbrt'
  /** The waveform templates' weight: a thin line, or the full filled drawing. Absent means the fill. */
  waveWeight?: 'line' | 'fill'
  /**
   * How many waveforms a waveform template draws. Absent means one.
   *
   * ONE mixes the sound down before the filter, which is what makes the drawing a single shape; TWO hands the
   * filter the stereo pair and asks it for a row each. See `WAVE_CHANNELS` for why the count is a downmix
   * rather than a filter setting.
   */
  waveChannels?: 1 | 2
  /** The spectra's amplitude scale. Absent means logarithmic. */
  spectrumScale?: 'lin' | 'sqrt' | 'cbrt' | 'log' | '4thrt' | '5thrt'
  /** The spectra's colour saturation. Absent means ffmpeg's own. */
  spectrumSaturation?: number
  /** The scope's persistence, 0 to 1: how long its trace lasts. Absent means a long trail. */
  scopePersist?: number
  /** The scope's zoom, 1 being unframed. Absent means 1. */
  scopeZoom?: number
  /** The scope's draw mode. Absent means a continuous trace. */
  scopeDraw?: 'dot' | 'line'
  /**
   * Whether the scope is fed the sound's own two channels rather than a synthesised ring. Absent means OFF.
   *
   * OFF is the default because a polar scope plots one channel against the other, so a sound whose channels
   * are the same draws a spoke — and a mono signal in a stereo container is the commonest case of that. TRUE
   * STEREO is for genuinely wide music, whose two channels are worth plotting against each other.
   */
  scopeTrueStereo?: boolean
  /** What the drawing sits on. Absent means black. */
  visualizationBackgroundColor?: string
  /**
   * What the drawing sits ON: a colour, the job's own still, or an image the user chose.
   *
   * Absent means the colour, unless `visualizationOnStill` is set — see `visualizationBackgroundKind`,
   * which is what both the editor and the encoder ask so a job saved before this was a choice reads the
   * same way to both of them.
   */
  visualizationBackground?: 'colour' | 'still' | 'image'
  /** The image a drawing sits on when its background is an uploaded one. */
  visualizationBackgroundImage?: string
  /**
   * Whether a PICTURE drawing is given the sweeping progress line across it.
   *
   * Absent means ON — the podcast look — so only an explicit false turns it off. See
   * `visualizationProgressLine`, which is what the editor and the encoder both read so they cannot disagree.
   */
  visualizationProgressLine?: boolean
  /**
   * Whether the drawing is made over the job's own still rather than over a colour.
   *
   * @deprecated Kept as the way a job saved before `visualizationBackground` existed says "over the still".
   * New writes use `visualizationBackground`; this is only ever read.
   */
  visualizationOnStill?: boolean
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

/**
 * How fast one clip runs, and how the frames it does not have are made up.
 *
 * SPEED multiplies the clip's own time: the source is read at its native rate and the timeline it
 * occupies is `trimmed length / speed`, so 2x of a ten-second trim is five seconds of output. It is
 * the one number the encoder, the monitor, the thumbnails and the filmstrip all read, which is what
 * keeps a preview from disagreeing with the file it previews.
 *
 * INTERPOLATION decides what fills the gap a speed leaves: `sampling` keeps whichever source frame
 * the output instant lands on (ffmpeg's own `setpts` behaviour, and the cheap one), while `blending`
 * averages the neighbours so a slowed clip reads as movement rather than as judder. It affects the
 * PICTURE only; the sound is retimed the same way either way.
 *
 * MAINTAIN PITCH keeps the sound at its own pitch while it is sped (`atempo`), which is the default
 * and what one expects of a speed change. Turned off, the sample rate is shifted instead (`asetrate`)
 * so the pitch rises and falls with the speed, the way a tape does.
 */
export interface ClipSpeed {
  /** Forward playback rate. 1 is the clip's own speed; above 1 is faster, below 1 is slower. */
  speed: number
  /** What fills the frames a speed change leaves out or repeats. */
  interpolation: 'sampling' | 'blending'
  /** Absent is the default: keep the sound at its own pitch. */
  maintainPitch?: boolean
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
   * How fast each clip runs, keyed by the clip that owns it, mirroring how trimPoints are keyed.
   * Absent means the clip's own speed, which is 1.
   */
  sourceSpeed?: Record<string, ClipSpeed>
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
  /** Per-clip speed, keyed like the fit and carried whole rather than interpreted. */
  sourceSpeed?: Record<string, ClipSpeed>
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
