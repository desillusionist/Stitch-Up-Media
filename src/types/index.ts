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
  aspectRatio?: 'source' | '1:1' | '4:3' | '16:9' | '9:16' | 'custom'
  audioEnabled?: boolean
  frameRate?: number
  outputMode?: 'video' | 'audio'
  audioFormat?: 'aac' | 'mp3' | 'opus' | 'pcm' | 'flac'
  audioSampleRate?: number
  imageOutputMode?: 'sequence' | 'still'
  gifMode?: 'regular' | 'loop' | 'bounce'
}

export interface AudioTrackItem {
  id: string
  path: string
  language: string // e.g. 'eng', 'spa', 'fra'
  title?: string
}

/** Clip-boundary transitions. Only meaningful where clips are concatenated. */
export type TransitionType = 'none' | 'fade'

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
  screenshotDirectory?: string
  defaultImageDuration: number
  timestampDisplayMode?: 'timestamp' | 'framestamp'
}
