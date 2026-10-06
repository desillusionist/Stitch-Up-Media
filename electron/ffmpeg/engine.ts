import ffmpeg from 'fluent-ffmpeg'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { logEvent } from '../logger'
import { QueueTask, EncodingPreset } from '../../src/types'
import { ClipFade, MAIN_LANE_ID, clipRateFor, clipsConcatenate, crossfadeAt, edgeFade, effectiveCropFor, jobExportsPicture, joinedTimeline, laneIsMuted, nativeRateFor, resolveCrossfades, resolveFades, segmentTiming, sourceDuration, sourceFitFor, stillSecondsFor, trackEdgeFade, tracksConcatenate, transitionDuration, usesClipFraming } from '../../src/lib/timelineModel'
import { DEFAULT_CLIP_SPEED, clampClipSpeed, clipDurationFor, clipRetime, speedAudioFilters, speedFor, speedVideoFilters } from '../../src/lib/clipSpeed'
import { rateValue } from '../../src/lib/frameRate'
import { mediaKind } from '../../src/lib/mediaKind'
import { placeholderFill, placeholderKind } from '../../src/lib/placeholder'
import { blankSource, silenceSource } from './placeholder'
import { progressPercent } from '../../src/lib/progress'
import { cropFilter, hasCrop, resolutionBox } from '../../src/lib/outputFrame'
import { codecTakesRate } from '../../src/lib/outputSize'
import { clipKey, trackKey } from '../../src/lib/clipIds'
import { clipAudioDropped, embeddedAudioCustomised, embeddedGainDb, enabledEmbeddedStreams, gainForDb } from '../../src/lib/embeddedAudio'
import { outputCarriesPicture, outputTakesArt } from '../../src/lib/outputKind'
import { clipFilters } from '../../src/lib/sourceFit'
import { VISUALIZATION_BACKGROUND, drawingColorOf, drawingTuneOf, eqStyleOf, visualizationBackgroundKind, visualizationGraph, visualizationProgressLine } from '../../src/lib/visualization'
import { channelLayoutFor, outputChannels } from '../../src/lib/audioFacts'
import { probeFile } from './probe'
import { teachLavfiFormat } from './virtualInput'

// Before any command is built: a black picture for a job whose source has no frame of its own is
// asked for with `-f lavfi`, which fluent-ffmpeg refuses until it knows that format's name.
teachLavfiFormat()

export interface ProgressData {
  percent: number
  currentFps?: number
  timemark?: string
  currentKbps?: number
  targetSize?: number
}

/**
 * Codecs that cannot encode an odd frame size. 4:2:0 and 4:2:2 chroma is sampled in
 * pairs, so libx264 rejects 1195x896 outright, whatever pixel format is asked for.
 */
const EVEN_SIZE_CODECS: Array<EncodingPreset['videoCodec']> = ['h264', 'hevc', 'prores', 'vp9', 'av1', 'mpeg4', 'dxv']
/**
 * Codecs that pack the frame in four-by-four blocks and refuse anything else.
 *
 * Hap is the one: asked for a 322x242 frame it answers "Video size 322x242 is not multiple of 4" and
 * fails the whole job, so for it the frame is rounded to FOUR rather than to two. Measured against this
 * machine's own ffmpeg, which is where the figure comes from.
 */
const QUAD_SIZE_CODECS: Array<EncodingPreset['videoCodec']> = ['hap']

/**
 * The PCM codec name for a depth, which is how a WAV says how many bits its samples are.
 *
 * Sixteen is the one this app has always written, so a job that names no depth lands on `pcm_s16le` exactly
 * as it did. Eight is UNSIGNED in a WAV, which is the one oddity of the family. Measured against this
 * machine's ffmpeg: each of the four writes its depth and reads it back.
 */
const pcmCodecFor = (depth: EncodingPreset['audioBitDepth']): string =>
  depth === 8 ? 'pcm_u8' : depth === 24 ? 'pcm_s24le' : depth === 32 ? 'pcm_s32le' : 'pcm_s16le'

/**
 * FLAC's depth as its own SAMPLE FORMAT, which is how it is asked for rather than by a figure.
 *
 * Sixteen is written EXPLICITLY even when the job names no depth, because the encoder would otherwise choose
 * from the SOURCE: measured here, the same job from an AAC source — whose decoder hands over floats — came
 * out at TWENTY-FOUR bits, which is not what the field says and not what the size estimate promised. Pinning
 * it is what keeps the label, the figure and the file saying the same thing. `s32` is what this machine's
 * encoder writes twenty-four bits from.
 */
const flacSampleFormat = (depth: EncodingPreset['audioBitDepth']): string => `-sample_fmt ${depth === 24 ? 's32' : 's16'}`

/**
 * The gif muxer's own loop count.
 *
 * `-loop -1` plays the animation through ONCE and writes no looping extension at all, while `-loop 0`
 * repeats it for ever — both read back off the file rather than assumed. ONCE and FOREVER are the two
 * things the control offers; a BOUNCE is forever over a doubled, mirrored frame list rather than a count
 * of its own. An animation that named no mode keeps the looping one, which is what it did before the
 * choice existed.
 */
const gifLoopCount = (mode: EncodingPreset['gifMode']): string => (mode === 'regular' ? '-1' : '0')

/**
 * A probe's frame rate as a figure, whether it came back as a number, as `30000/1001`, or as neither.
 *
 * The probe reports a rate either way depending on the file, and the ONE figure the retiming needs is the
 * source's own seconds-per-frame, so the two spellings are read here rather than at each of the callers.
 */
const parseFrameRate = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (!value) return 0
  const text = String(value)
  if (text.includes('/')) {
    const [a, b] = text.split('/').map(Number)
    return b ? a / b : 0
  }
  return Number(text) || 0
}

/**
 * The rate a job writes its output at, as the figure ffmpeg's own filters take: its exact rational where
 * the ENCODING tab named one, else the plain figure an older job stored, else zero for "the source's own".
 */
const outputFpsOf = (preset: EncodingPreset): number =>
  preset.fpsRate ? rateValue(preset.fpsRate) : preset.fps && preset.fps > 0 ? preset.fps : 0

export class FFmpegEngine {
  private activeProcesses = new Map<string, ffmpeg.FfmpegCommand>()
  private sequenceFor(task: QueueTask, source: string) {
    return task.sequenceInputs?.[source] || (task.sequenceInput?.firstFrame === source ? task.sequenceInput : undefined)
  }
  private sequenceCommand(sequence: NonNullable<QueueTask['sequenceInput']>, point?: { in: number; out: number }): ffmpeg.FfmpegCommand {
    if (!sequence) return ffmpeg()
    const fps = sequence.fps || 30
    const input = sequence.hasGaps ? path.join(sequence.dir, sequence.globPattern) : path.join(sequence.dir, sequence.pattern)
    const command = ffmpeg()
    const trimmed = Boolean(point && point.out > point.in)
    const inFrameOffset = trimmed && !sequence.hasGaps && point!.in > 0 ? Math.round(point!.in * fps) : 0
    const startNumber = sequence.startNumber + inFrameOffset
    command.input(input).inputOptions([
      '-framerate', String(fps),
      ...(sequence.hasGaps ? ['-pattern_type', 'glob'] : ['-start_number', String(startNumber)]),
    ])
    if (trimmed) {
      const outputTrim: string[] = []
      if (sequence.hasGaps && point!.in > 0) outputTrim.push('-ss', String(Math.max(0, point!.in)))
      outputTrim.push('-t', String(Math.max(0, point!.out - point!.in)))
      command.outputOptions(outputTrim)
    }
    return command
  }
  private trimPoint(task: QueueTask, source: string, index: number, key?: string) {
    return task.trimPoints?.[key ?? clipKey(task, source, index)] || task.trimPoints?.[source]
  }
  /**
   * Fade filters for one clip, appended to the same chains the scaling already
   * uses. A second `-vf` would silently replace the first, so these must compose.
   */
  private fadeFilters(fade: ClipFade | undefined, duration: number) {
    if (!fade || duration <= 0) return { video: [] as string[], audio: [] as string[] }
    const video: string[] = []
    const audio: string[] = []
    if (fade.fadeIn > 0) {
      const length = Math.min(fade.fadeIn, duration)
      video.push(`fade=t=in:st=0:d=${length.toFixed(3)}`)
      audio.push(`afade=t=in:st=0:d=${length.toFixed(3)}`)
    }
    if (fade.fadeOut > 0) {
      const length = Math.min(fade.fadeOut, duration)
      const start = Math.max(0, duration - length)
      video.push(`fade=t=out:st=${start.toFixed(3)}:d=${length.toFixed(3)}`)
      audio.push(`afade=t=out:st=${start.toFixed(3)}:d=${length.toFixed(3)}`)
    }
    return { video, audio }
  }
  /**
   * The source-seconds-per-timeline-second a clip runs at, its INTERPRETED rate and its speed folded in.
   *
   * The one figure the encoders are handed in place of the speed, so a clip given a rate of its own — a 24p
   * clip in a 30 fps timeline, or a run of images told what rate to run at — is retimed by the same rule the
   * timeline and the monitor draw it with. `probedFps` is the source's own rate as measured by whichever
   * probe the caller already made; an absent record and an equal rate leave this exactly the speed it was.
   */
  private retimeFor(task: QueueTask, source: string, index: number, probedFps: number, key?: string): number {
    const sequence = this.sequenceFor(task, source)
    const native = nativeRateFor(task, source, sequence, () => ({ duration: 0, fps: probedFps }))
    const rate = clipRateFor(task, source, index, native, key)
    return clampClipSpeed(clipRetime(speedFor(task, source, index, key).speed, rate, native))
  }

  /**
   * The `volume` link for one stream's own level, empty at unity so an untouched stream is unfiltered.
   *
   * Written as a linear gain from the dB the reader set, on that stream's own chain — a single `-af` would
   * put one stream's level on all of them the moment a clip or a track carried more than one.
   */
  private gainFilters(gainDb: number | undefined): string[] {
    const gain = gainForDb(gainDb ?? 0)
    return Math.abs(gain - 1) > 1e-6 ? [`volume=${gain}`] : []
  }

  private normalizeStitchSource(task: QueueTask, source: string, output: string, point: { in: number; out: number } | undefined, stitchCanvas: [number, number] | undefined, targetFps = 30, clipDuration = 0, fade?: ClipFade, clipIndex = 0, sourceSize?: { width: number; height: number }, retime?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const sequence = this.sequenceFor(task, source)
      const isSequence = Boolean(sequence)
      const isStill = !isSequence && /\.(png|jpe?g|gif|tiff?|bmp|webp|heic|heif|avif)$/i.test(source)
      // A PLACEHOLDER has no file at all: the picture is a flat colour and the sound is silence, asked of
      // ffmpeg's own `lavfi` device at the length the clip was stretched to. It is ONE input carrying one
      // stream or two — see `placeholder` — so every stream index downstream is where it always was.
      const placeholder = placeholderKind(source)
      const [W, H] = stitchCanvas || (task.preset.width && task.preset.height ? [task.preset.width, task.preset.height]
        : task.preset.resolution === '4k' ? [3840, 2160] : task.preset.resolution === '720p' ? [1280, 720] : [1920, 1080])
      const command = sequence ? this.sequenceCommand(sequence, point)
        : placeholder === 'video' ? ffmpeg().input(blankSource(placeholderFill(source) ?? '000000', W, H, targetFps || 30, clipDuration)).inputOptions(['-f', 'lavfi'])
        : placeholder === 'audio' ? ffmpeg().input(silenceSource(clipDuration)).inputOptions(['-f', 'lavfi'])
        : ffmpeg(source)
      const rate = isSequence ? (sequence?.fps || 30) : (targetFps || 30)
      if (isStill) command.inputOptions(['-loop 1', '-framerate', String(this.stillRate(task, source)), '-t', String(stillSecondsFor(task, source))])
      // A placeholder carries its own length in the source filter, so there is nothing to seek into.
      if (!isSequence && !placeholder) this.applyTrimInput(command, point)
      const fades = this.fadeFilters(fade, clipDuration)
      const outputRate = isSequence || isStill ? rate : (targetFps || 30)
      const fit = sourceFitFor(task, source, clipIndex)
      // Crop first, in the source's own space, then place what is left in the frame: the crop decides
      // WHAT of the clip is kept, and the fit decides HOW it sits. Both come from the clip's own
      // record and fall back to the job-wide crop, so a job that was cropped before clips could be
      // cropped one by one keeps the crop it had, and a clip with neither is the whole clip fitted
      // as it always was.
      const crop = effectiveCropFor(task, source, clipIndex)
      const placement = sourceSize && sourceSize.width > 0 && sourceSize.height > 0
        ? clipFilters({ source: sourceSize, frame: { width: W, height: H }, crop, fit })
        : null
      if ((fit || crop) && !placement) {
        logEvent('ffmpeg', 'clip crop or fit could not be applied; using the default fit', { taskId: task.id, source, clipIndex })
      }
      // The clip's own speed, retiming the picture and the sound by the one figure. Empty at the clip's
      // own speed, so a job that has never been retimed is handed the same filters it always was.
      const clipSpeed = speedFor(task, source, clipIndex)
      // The retime is the speed with the clip's interpreted rate folded in, computed by the caller from the
      // probe it already made; the fallback keeps a caller that has not measured a rate at the plain speed.
      const retimeRate = retime ?? clipSpeed.speed
      // A clip with no picture has no frames to fill, so blending is a filter with nothing to do that is
      // not written for one. The size being unknown is what says so: an audio source has no video stream
      // to take a frame size from, which is the same thing the fit above already has to allow for.
      const hasPicture = Boolean(sourceSize && sourceSize.width > 0 && sourceSize.height > 0)
      const speedVideo = speedVideoFilters(retimeRate, hasPicture ? clipSpeed.interpolation : 'sampling', outputRate)
      const speedAudio = speedAudioFilters(retimeRate, clipSpeed.maintainPitch !== false, 48000)
      const videoFilters = [
        ...(placement ?? [
          // No size to work the crop out against, so it is asked for in the source's own terms — the
          // same region either way — and the fit is left to ffmpeg's own aspect handling.
          ...(crop && hasCrop(crop) ? [cropFilter(crop)] : []),
          `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
          'setsar=1',
        ]),
        // The speed sits between the framing and the rate: every frame is moved to where it falls at
        // the new speed, and the `fps` filter beside it then keeps whichever frame the output instant
        // lands on — which is what makes the written file's frame count the timeline's own.
        ...speedVideo,
        `fps=${outputRate}`,
        ...fades.video,
      ]
      command.videoCodec('libx264').outputOptions([`-vf ${videoFilters.join(',')}`, '-preset veryfast', '-pix_fmt yuv420p', '-video_track_timescale 90000'])
      // A SOUND clip's own level joins the chain the retime and the fades already use, so a stitch of audio
      // files is levelled clip by clip. Nothing is written for a clip at unity, which leaves the chain — and
      // the command — exactly what it was.
      const clipGain = mediaKind(source) === 'audio' ? this.gainFilters(embeddedGainDb(task, clipKey(task, source, clipIndex), 0)) : []
      // A MUTED clip is silenced, not dropped: the normalized clips are joined by a demuxer that wants the SAME
      // streams on each, so a clip with its sound removed would break the join. `volume=0` keeps the stream and
      // takes the sound, which is what the monitor shows and what the editor's per-clip MUTE asks for.
      const soundDropped = clipAudioDropped(task, clipKey(task, source, clipIndex), source, 1)
      command.audioCodec('aac').audioFrequency(48000).audioChannels(2)
        .outputOptions([`-af ${['aresample=48000:async=1', ...speedAudio, 'aformat=sample_fmts=fltp:channel_layouts=stereo', ...fades.audio, ...(soundDropped ? ['volume=0'] : []), ...clipGain].join(',')}`, '-b:a 160k', '-map 0:v:0?', '-map 0:a:0?'])
        .on('start', (commandLine: string) => logEvent('ffmpeg', 'process started', { taskId: task.id, commandLine }))
        .on('end', () => resolve()).on('error', reject).save(output)
    })
  }

  /**
   * Joins normalized clips with a cross-DISSOLVE where a boundary asks for one, writing the result to a file.
   *
   * The clips arrive already conformed to the output raster, rate, pixel format and SAR — `xfade` refuses
   * anything else — and their dip fades are baked, except at a crossfade boundary, where `resolveFades`
   * leaves nothing to fade because the DISSOLVE is the transition there. So this writes only the join: an
   * `xfade` (picture) and an `acrossfade` (sound) at each crossfade boundary, and the `concat` filter at each
   * plain cut, in ONE graph rather than a second pass. A crossfade is a re-encode, which is the cost.
   */
  private renderCrossfadeJoin(inputs: string[], durations: number[], overlaps: number[], output: string, taskId: string): Promise<void> {
    const { starts } = joinedTimeline(durations, overlaps)
    const parts: string[] = []
    let video = '0:v'
    let audio = '0:a'
    for (let index = 1; index < inputs.length; index += 1) {
      const overlap = overlaps[index - 1] || 0
      const videoOut = `xv${index}`
      const audioOut = `xa${index}`
      if (overlap > 0) {
        // The OUTGOING clip's last D seconds blend under the INCOMING clip's first D, `offset` being when the
        // dissolve begins on the stream built so far — which is exactly where the incoming clip STARTS once the
        // overlaps are taken out.
        parts.push(`[${video}][${index}:v]xfade=transition=fade:duration=${overlap.toFixed(3)}:offset=${starts[index].toFixed(3)}[${videoOut}]`)
        parts.push(`[${audio}][${index}:a]acrossfade=d=${overlap.toFixed(3)}[${audioOut}]`)
      } else {
        parts.push(`[${video}][${index}:v]concat=n=2:v=1:a=0[${videoOut}]`)
        parts.push(`[${audio}][${index}:a]concat=n=2:v=0:a=1[${audioOut}]`)
      }
      video = videoOut
      audio = audioOut
    }
    const command = ffmpeg()
    inputs.forEach((file) => command.input(file))
    command
      .complexFilter(parts)
      .videoCodec('libx264')
      .outputOptions(['-preset veryfast', '-pix_fmt yuv420p', '-video_track_timescale 90000'])
      .audioCodec('aac')
      .outputOptions(['-b:a 160k', '-map', `[${video}]`, '-map', `[${audio}]`])
    return new Promise<void>((resolve, reject) => {
      command
        .on('start', (commandLine: string) => logEvent('ffmpeg', 'process started', { taskId, commandLine }))
        .on('end', () => resolve())
        .on('error', reject)
        .save(output)
    })
  }

  private resolveOutputDirectory(directory: string): string {
    try {
      const resolved = path.resolve(directory)
      if (resolved.startsWith("/Users/") && !resolved.startsWith(os.homedir() + path.sep)) {
        throw new Error("Output path belongs to a different user")
      }
      fs.mkdirSync(resolved, { recursive: true })
      fs.accessSync(resolved, fs.constants.W_OK)
      const probePath = path.join(resolved, '.stitch-up-write-test-' + process.pid)
      fs.writeFileSync(probePath, "")
      fs.unlinkSync(probePath)
      return resolved
    } catch (error) {
      const fallback = path.join(os.tmpdir(), 'Stitch Up Media')
      fs.mkdirSync(fallback, { recursive: true })
      console.warn('Output directory is not writable: ' + directory + '; using fallback: ' + fallback, error)
      return fallback
    }
  }

  public cancel(taskId: string): void {
    const cmd = this.activeProcesses.get(taskId)
    if (cmd) {
      try {
        cmd.kill('SIGKILL')
      } catch (e) {
        console.error('Error killing process:', e)
      }
      this.activeProcesses.delete(taskId)
    }
  }

  public runTask(
    task: QueueTask,
    onProgress: (data: ProgressData) => void,
    onComplete: () => void,
    onError: (err: Error) => void
  ): void {
    logEvent('ffmpeg', 'task requested', { taskId: task.id, type: task.type, sourcePaths: task.sourcePaths, requestedOutputDirectory: task.outputDirectory, outputFilename: task.outputFilename, preset: task.preset.id })
    const outputDirectory = this.resolveOutputDirectory(task.outputDirectory)
    const outputFilename = task.preset.imageOutputMode === 'sequence' && !task.outputFilename.includes('%')
      ? task.outputFilename.replace(/\.[^.]+$/, '') + '_%06d' + path.extname(task.outputFilename)
      : task.outputFilename
    const outputPath = path.join(outputDirectory, outputFilename)
    logEvent('ffmpeg', 'resolved output path', { taskId: task.id, outputPath })

    if (task.type === 'stitch') {
      void this.executeStitch(task, outputPath, onProgress, onComplete, onError)
    } else if (task.type === 'combo' && task.sourcePaths.length > 1) {
      void this.executeCombo(task, outputPath, onProgress, onComplete, onError)
    } else if (task.type === 'multitrack' || task.type === 'combo') {
      void this.executeMultiTrack(task, outputPath, onProgress, onComplete, onError)
    } else {
      void this.executeTranscode(task, outputPath, onProgress, onComplete, onError)
    }
  }

  // --- Feature 1: Standard Transcoding with Apple Hardware Acceleration ---
  private async executeTranscode(
    task: QueueTask,
    outputPath: string,
    onProgress: (data: ProgressData) => void,
    onComplete: () => void,
    onError: (err: Error) => void
  ) {
    const source = task.sourcePaths[0]
    const sequence = this.sequenceFor(task, source)
    const isSequence = Boolean(sequence)
    const isStillImage = !isSequence && /\.(png|jpe?g|gif|tiff?|bmp|webp)$/i.test(source)
    const trim = this.trimPoint(task, source, 0)
    // The clip's own speed, retiming the picture and the sound by the one figure. It is read here
    // rather than beside the filters because the length the progress bar sweeps across is the clip's
    // TIMELINE length, which the speed decides.
    const clipSpeed = speedFor(task, source, 0)
    let expectedSeconds = 0
    let sourceHasAudio = false
    // The number of AUDIO streams the source carries, from the probe below: it is the range a clip's own
    // per-stream controls are offered over, and the count an explicit map list is built against.
    let audioStreamCount = 0
    // The source's own rate, filled by the probe below: the retime is the speed with the clip's INTERPRETED
    // rate folded in against it, so a clip given a rate of its own writes the length the editor drew.
    let probedFps = 0
    let retime = clipSpeed.speed
    // The source's own pixel size, from the probe this path already makes: a fit is worked out from
    // the clip's shape and the frame rather than by ffmpeg from the stream, so it needs the shape.
    let sourceSize: { width: number; height: number } | null = sequence?.width && sequence?.height
      ? { width: sequence.width, height: sequence.height }
      : null
    // The channel counts of the sound are no longer read here: the scope's ring is synthesised whatever the
    // container holds — see `TRUE STEREO` on the preset — so the drawing no longer depends on a probe.
    try {
      const placeholder = placeholderKind(source)
      if (placeholder) {
        // A PLACEHOLDER carries its own length and its own streams — a BLANK a picture AND a sound, a SILENCE
        // a sound alone — so there is nothing to probe and nothing to seek into.
        sourceHasAudio = true
        audioStreamCount = 1
        retime = this.retimeFor(task, source, 0, 0)
        expectedSeconds = clipDurationFor(segmentTiming(sourceDuration(task, source, sequence), trim).duration, retime)
      } else {
        const probe = await probeFile(source)
        sourceHasAudio = probe.audioStreams.length > 0
        audioStreamCount = probe.audioStreams.length
        probedFps = parseFrameRate(probe.videoStreams[0]?.fps)
        retime = this.retimeFor(task, source, 0, probedFps)
        expectedSeconds = clipDurationFor(segmentTiming(
          sourceDuration(task, source, sequence, () => ({ duration: Number(probe.duration || 0) })),
          trim,
        ).duration, retime)
        const resolution = probe.videoStreams[0]?.resolution?.split('x').map(Number)
        if (!sourceSize && resolution && resolution.length === 2 && resolution.every((value) => value > 0)) {
          sourceSize = { width: resolution[0], height: resolution[1] }
        }
      }
    } catch { /* the bar falls back to whatever ffmpeg reports */ }
    let cmd = sequence ? this.sequenceCommand(sequence, trim)
      : placeholderKind(source) === 'video' ? (() => {
        // A flat colour with silence, as ONE input carrying two streams — see `placeholder`.
        const box = this.frameBoxFor(task.preset)
        return ffmpeg().input(blankSource(placeholderFill(source) ?? '000000', box.width, box.height, outputFpsOf(task.preset) || 30, expectedSeconds)).inputOptions(['-f', 'lavfi'])
      })()
      : placeholderKind(source) === 'audio' ? ffmpeg().input(silenceSource(expectedSeconds)).inputOptions(['-f', 'lavfi'])
      : ffmpeg(source)
    if (isStillImage && task.preset.outputMode !== 'audio' && !task.preset.imageOutputMode) {
      // The rate is set on the input as well as the output. Without it ffmpeg's image
      // demuxer picks its own 25, and the clip would render at a rate unrelated to the
      // one the editor showed.
      cmd.inputOptions(['-loop 1', `-framerate ${this.stillRate(task, source)}`, '-t ' + stillSecondsFor(task, source)])
    }
    // A SINGLE FRAME is taken at the instant the reader was LOOKING AT, and that instant is a position in
    // the SOURCE — so the clip's own trim is not applied beside it: two seeks would write a frame nobody
    // pointed at, and a range has no meaning for one frame. An input seek is accurate here because the
    // frame is re-encoded, so it lands on the frame it names rather than on the keyframe before it.
    const singleFrameAt = task.preset.imageOutputMode === 'still' ? Math.max(0, Number(task.preset.stillFrameAt) || 0) : null
    if (singleFrameAt !== null) {
      if (singleFrameAt > 0) cmd.inputOptions(['-ss ' + singleFrameAt])
    } else if (!isSequence && !placeholderKind(source)) {
      this.applyTrimInput(cmd, trim)
    }
    // A sound file has no frame to give, so a preset that asks for video would write a container
    // holding a sound stream and no picture at all — a video file in name only. The export's own frame
    // is supplied instead. It is skipped for a muted lane, where the audio is dropped and there would be
    // nothing left for a picture to accompany.
    const soundOnly = jobExportsPicture(task) && mediaKind(source) === 'audio' && !laneIsMuted(task, MAIN_LANE_ID) && task.preset.audioEnabled !== false
    // A drawing takes the picture AND the audio over — it is built from the very mix it writes — so it
    // is asked for ahead of the frame a separate black input would have supplied.
    const draws = soundOnly && task.preset.audioPicture === 'visualization' && task.preset.videoCodec !== 'copy'
    // The stream is named down to its index rather than as `0:a`: a filter label of `[0:a]` stands for
    // EVERY audio stream of the input, which is fine for a lone sound file and wrong the moment one is
    // not, while `[0:a:0]` is the one stream this path means. The drawing is laid out to the same rate
    // and channel count every other path writes, because the two halves of one split cannot differ.
    // A picture the job was GIVEN, for the third of the three answers its picture source can be: black, a
    // drawing of its own sound, or an image the user picked. The picked one is added as an input of its own
    // before the preset's filters are built, because the chain that fits it into the frame is one of them.
    const customPicture = soundOnly ? this.usablePicture(task.preset.audioPicture === 'custom' ? task.preset.audioPictureImage : undefined) : null
    const pictureFilters = customPicture ? this.addStillPicture(cmd, task.preset, customPicture) : []
    // The clip's own id and its own LEVEL, read here because the DRAWING path below needs the level at the
    // moment it builds its graph — a sound clip's one stream IS the export's stream on this path, so the gain
    // is written on that stream's own chain (or, for a drawing, on its input before the graph sums it).
    const embeddedClipId = clipKey(task, source, 0)
    const clipGainDb = mediaKind(source) === 'audio' ? embeddedGainDb(task, embeddedClipId, 0) : 0
    if (draws) this.applyVisualization(cmd, task.preset, ['0:a:0'], this.visualizationBackgroundFor(cmd, task.preset, undefined, 1), 48000, this.exportChannels(task.preset, 2), expectedSeconds, [clipGainDb])
    else if (soundOnly && !customPicture) this.addBlackPicture(cmd, task.preset, expectedSeconds)

    // A fit chosen for this clip's picture is the clip's own framing, and this is the one path where
    // the picture is not normalized first: a single visual has no other clip to be joined to, so
    // there is nothing to normalize it against. The chain STANDS IN for the job's own crop, scale
    // and pad rather than being added after them, so the clip is not framed twice.
    const clipChain = this.clipFraming(task, source, sourceSize)
    // The retiming joins the same chain the framing does, after it: the picture is placed first and
    // then moved to where it falls at the new speed, which is the order the normalizer uses too. A job
    // whose visual is a sound file has no picture to fill between frames, so blending is not asked of it.
    const speedVideo = speedVideoFilters(retime, soundOnly ? 'sampling' : clipSpeed.interpolation, outputFpsOf(task.preset))
    const speedAudio = speedAudioFilters(retime, clipSpeed.maintainPitch !== false, task.preset.audioSampleRate || 48000)
    // This clip's own two edges, which are the only boundaries a single-source job has. They fade the picture
    // and the sound through the same clamp the timeline draws with, so a CONVERT can fade in and out exactly as
    // a stitch can — the picture through the video chain and the sound through the audio one. A job whose
    // picture is a DRAWING is skipped: its graph owns both streams, and a fade there belongs in the graph.
    const fades = draws ? { video: [] as string[], audio: [] as string[] } : this.fadeFilters(
      resolveFades([expectedSeconds], [], { head: edgeFade(task, 'head'), tail: edgeFade(task, 'tail') })[0],
      expectedSeconds,
    )
    this.applyPresetToCommand(cmd, task.preset, [...pictureFilters, ...speedVideo, ...fades.video], {
      ...(clipChain ? { clipChain } : { cropsPerClip: clipsConcatenate(task) }),
      ...(draws ? { graphOwnsPicture: true } : {}),
    })
    // The clip's OWN embedded sound, where a reader has told it which streams to carry or set a level on
    // one: the enabled streams are named one at a time rather than left to ffmpeg's own selection, so a
    // muted or EXTRACTED stream is not written at all. An untouched clip keeps the default path exactly.
    const embeddedCustom = mediaKind(source) === 'video'
      && embeddedAudioCustomised(task, embeddedClipId, source)
      && task.preset.audioEnabled !== false
      && task.preset.container !== 'gif'
      && task.preset.imageOutputMode !== 'sequence'
      && !laneIsMuted(task, MAIN_LANE_ID)
    const embeddedEnabled = embeddedCustom ? enabledEmbeddedStreams(task, embeddedClipId, source, audioStreamCount) : []
    // The sound is retimed beside the picture, in the same terms: `atempo` keeps the pitch, or
    // `asetrate` shifts it with the speed. A stream-copied sound cannot be filtered at all and a
    // source with no sound has nothing to retime, so the chain is only written where it applies.
    const audioChain = [...speedAudio, ...fades.audio, ...this.gainFilters(clipGainDb)]
    if (!embeddedCustom && audioChain.length && sourceHasAudio && !draws && task.preset.audioCodec !== 'copy' && task.preset.audioEnabled !== false) {
      cmd.outputOptions([`-af ${audioChain.join(',')}`])
    }
    // Naming a stream at all turns OFF ffmpeg's automatic selection for every kind, so the picture has to be
    // named too wherever the container carries one. A pictureless container already says `-vn`.
    if (embeddedCustom) {
      const carriesPicture = task.preset.outputMode !== 'audio' && outputCarriesPicture(task.preset.container)
      if (carriesPicture) cmd.outputOptions(['-map 0:v:0'])
      if (embeddedEnabled.length === 0) {
        cmd.outputOptions(['-an'])
      } else {
        embeddedEnabled.forEach((stream) => cmd.outputOptions([`-map 0:a:${stream.index}`]))
        if (task.preset.audioCodec !== 'copy') {
          // One chain per output stream: the clip's own retime and fades on each, with that stream's level
          // appended — which is the only way two streams of one clip can carry two different levels.
          embeddedEnabled.forEach((stream, outIndex) => {
            const chain = [...audioChain, ...this.gainFilters(stream.gainDb)]
            if (chain.length) cmd.outputOptions([`-filter:a:${outIndex} ${chain.join(',')}`])
          })
        }
      }
    }
    // A muted lane is one the export does not carry, so its audio is dropped outright rather than
    // encoded and left silent: a file with no audio stream says so without being listened to.
    if (laneIsMuted(task, MAIN_LANE_ID)) cmd.outputOptions(['-an'])
    // A preset with no rate of its own means "source", and a still has none, so the
    // recorded rate becomes the output rate rather than leaving it to the encoder.
    if (isStillImage && !outputFpsOf(task.preset) && task.preset.outputMode !== 'audio' && !task.preset.imageOutputMode) {
      cmd.outputOptions([`-r ${this.stillRate(task, source)}`])
    }

    cmd
      .on('progress', this.progressHandler(expectedSeconds, onProgress))
      .on('end', () => {
        this.activeProcesses.delete(task.id)
        onComplete()
      })
      .on('error', (err: Error) => {
        logEvent('ffmpeg', 'process error', { taskId: task.id, error: err.message })
        this.activeProcesses.delete(task.id)
        onError(err)
      })

    this.activeProcesses.set(task.id, cmd)
    cmd.on('start', (commandLine: string) => logEvent('ffmpeg', 'process started', { taskId: task.id, commandLine }))
    cmd.save(outputPath)
  }

  // --- Feature 2: Unique Feature: Multi-fragment Stitching (Concat Demuxer / Filter) ---
  private async executeStitch(
    task: QueueTask,
    outputPath: string,
    onProgress: (data: ProgressData) => void,
    onComplete: () => void,
    onError: (err: Error) => void
  ) {
    let targetSampleRate = 48000
    let targetChannels = 2
    let targetBitrate = 0
    try {
      const probes = await Promise.all(task.sourcePaths.map((source) => (placeholderKind(source) ? null : probeFile(source))))
      const audio = probes.flatMap((probe) => probe?.audioStreams ?? [])
      if (audio.length) {
        targetSampleRate = Math.max(44100, ...audio.map((stream) => stream.sampleRate || 0))
        targetChannels = Math.max(2, ...audio.map((stream) => stream.channels || 0))
        targetBitrate = Math.max(...audio.map((stream) => Number.parseInt(stream.bitrate || '0', 10) * 1000))
      }
    } catch (error) {
      logEvent('ffmpeg', 'audio probe failed; using safe stitch defaults', { taskId: task.id, error: String(error) })
    }
    // Normalize every source before concat so mono/stereo transitions cannot corrupt timestamps or channel mapping.
    const normalizedSources: string[] = []
    let stitchCanvas: [number, number] | undefined
    // Each clip's own pixel size, from the probes this path already makes, because a per-clip fit
    // is worked out from the clip's shape and the frame rather than by ffmpeg from the streams.
    const sourceSizes = new Map<string, { width: number; height: number }>()
    let targetFps = outputFpsOf(task.preset)
    let clipDurations: number[] = []
    // Read OUTSIDE the probe's own try because the normalization pass below uses them too: each source's own
    // measured rate, and the widest of them, so a clip given a rate of its own is retimed against its own.
    const nativeFpsByPath = new Map<string, number>()
    let maxFps = 0
    // Whether EVERY clip carries both a picture and sound, which is what a cross-dissolve needs of its two
    // neighbours: `xfade` blends two pictures and `acrossfade` two sounds, and neither can be asked of a
    // stream that is not there. A job that fails either test keeps the plain-cut join it always had.
    let everySourceHasPicture = true
    let everySourceHasAudio = true
    try {
      const probes = await Promise.all(task.sourcePaths.map((source) => (placeholderKind(source) ? null : probeFile(source))))
      let maxW = 0, maxH = 0
      for (let probeIndex = 0; probeIndex < probes.length; probeIndex++) {
        const probe = probes[probeIndex]
        const source = task.sourcePaths[probeIndex]
        // A PLACEHOLDER has no stream to probe. A BLANK carries a picture AND a sound by construction, so it
        // fails neither of the cross-dissolve's tests; a SILENCE is sound alone and, being sound, brings no
        // size of its own to the canvas either.
        if (!probe) {
          if (placeholderKind(source) === 'audio') everySourceHasPicture = false
          continue
        }
        const resolution = probe.videoStreams[0]?.resolution?.split('x').map(Number)
        if (resolution && resolution.length === 2 && resolution.every(Number.isFinite)) {
          maxW = Math.max(maxW, resolution[0]); maxH = Math.max(maxH, resolution[1])
          sourceSizes.set(source, { width: resolution[0], height: resolution[1] })
        } else {
          everySourceHasPicture = false
        }
        if (!probe.audioStreams.length) everySourceHasAudio = false
        const sequence = this.sequenceFor(task, source)
        const probed = sequence?.fps || parseFrameRate(probe.videoStreams[0]?.fps)
        nativeFpsByPath.set(source, probed)
        maxFps = Math.max(maxFps, probed)
      }
      const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)
      stitchCanvas = task.preset.width && task.preset.height
        ? [task.preset.width, task.preset.height]
        : maxW && maxH ? [even(maxW), even(maxH)] : undefined
      if (!targetFps) targetFps = maxFps > 0 ? Math.round(maxFps * 1000) / 1000 : (task.sequenceInput?.fps || 30)
      // Clip lengths use the same precedence as the timeline, backed by the probes
      // already fetched here, so the encoder and the drawn ramps agree on timing.
      const probeDurations = new Map(probes.map((probe, index) => [task.sourcePaths[index], probe ? Number(probe.duration || 0) : 0]))
      // The length each clip OCCUPIES is the trimmed source length divided by its RETIME — the speed with
      // the clip's interpreted rate folded in — which is the figure the fades are placed against and the
      // figure the whole output is summed from. The trim itself stays in SOURCE seconds and reaches ffmpeg
      // through `applyTrimInput`.
      clipDurations = task.sourcePaths.map((source, index) => clipDurationFor(segmentTiming(
        sourceDuration(task, source, this.sequenceFor(task, source), (sourcePath) => ({ duration: probeDurations.get(sourcePath) ?? 0 })),
        this.trimPoint(task, source, index),
      ).duration, this.retimeFor(task, source, index, nativeFpsByPath.get(source) ?? maxFps)))
    } catch (error) {
      targetFps = targetFps || 30
      logEvent('ffmpeg', 'stitch canvas probe failed; using defaults', { taskId: task.id, error: String(error) })
    }
    // Fade placement is clamped by the shared rule, so a request that would overlap
    // inside a clip is reduced rather than producing a broken ramp.
    const clipFades = resolveFades(clipDurations, task.sourcePaths.map((source, index) => transitionDuration(task, source, index)), { head: edgeFade(task, 'head'), tail: edgeFade(task, 'tail') })
    try {
      for (let index = 0; index < task.sourcePaths.length; index++) {
        const source = task.sourcePaths[index]
        const normalized = path.join(os.tmpdir(), `stitch_${task.id}_${index}.mkv`)
        await this.normalizeStitchSource(task, source, normalized, this.trimPoint(task, source, index), stitchCanvas, targetFps, clipDurations[index] || 0, clipFades[index], index, sourceSizes.get(source), this.retimeFor(task, source, index, nativeFpsByPath.get(source) ?? maxFps))
        normalizedSources.push(normalized)
      }
    } catch (error) {
      normalizedSources.forEach((file) => { try { fs.unlinkSync(file) } catch {} })
      onError(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const tmpConcatFile = path.join(os.tmpdir(), `stitch_${task.id}.txt`)
    // WHICH JOIN IS OURS: plain cuts ride the concat DEMUXER, which copies stream to stream and re-encodes
    // nothing; ONE cross-dissolve anywhere needs the filtergraph instead, because an overlap is not something a
    // demuxer can express. A job with no crossfade is untouched, so the common case keeps its old cost.
    const crossfadeOverlaps = resolveCrossfades(clipDurations, task.sourcePaths.map((source, index) => crossfadeAt(task, clipKey(task, source, index))))
    const crossfadeReady = crossfadeOverlaps.some((value) => value > 0) && everySourceHasPicture && everySourceHasAudio
      && task.preset.container !== 'gif' && task.preset.imageOutputMode !== 'sequence'
    let joinedInput = tmpConcatFile
    let joinedInputOptions = ['-f', 'concat', '-safe', '0']
    if (crossfadeReady) {
      joinedInput = path.join(os.tmpdir(), `stitch_${task.id}_xfade.mkv`)
      try {
        await this.renderCrossfadeJoin(normalizedSources, clipDurations, crossfadeOverlaps, joinedInput, task.id)
        joinedInputOptions = []
      } catch (error) {
        // A graph that cannot be built falls back to the cut join rather than failing the job — the file is
        // still the one the job asked for, minus the dissolve.
        logEvent('ffmpeg', 'crossfade join failed; falling back to the plain-cut join', { taskId: task.id, error: String(error) })
        try { fs.unlinkSync(joinedInput) } catch {}
        joinedInput = tmpConcatFile
        joinedInputOptions = ['-f', 'concat', '-safe', '0']
      }
    }
    if (joinedInput === tmpConcatFile) {
      const fileLines = normalizedSources.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
      fs.writeFileSync(tmpConcatFile, fileLines, 'utf-8')
    }

    let cmd = ffmpeg()
      .input(joinedInput)
      .inputOptions(joinedInputOptions)

    // A crossed join is D shorter than the clips, and the figures below are read off the join's own length.
    const joinedSeconds = crossfadeReady ? joinedTimeline(clipDurations, crossfadeOverlaps).total : clipDurations.reduce((total, clip) => total + clip, 0)

    // The same rule as the transcode path: a stitch of sound files asked for a picture has none to
    // join, so the export's own frame is supplied. It takes ONE input rather than one per clip,
    // because the picture never changes from clip to clip and there is nothing here for a clip's own
    // picture to differ about. A DRAWING is the sound itself drawn, and it takes the audio over with
    // it — built from the very joined sound it writes — so it is asked for ahead of the black frame.
    const carriesMainAudio = !laneIsMuted(task, MAIN_LANE_ID)
    const soundOnlyStitch = task.sourcePaths.length > 0 && task.sourcePaths.every((source) => mediaKind(source) === 'audio')
    const stitchPictured = jobExportsPicture(task) && soundOnlyStitch && carriesMainAudio
    const stitchDraws = stitchPictured && task.preset.audioPicture === 'visualization' && task.preset.videoCodec !== 'copy'
    // And the third answer its picture source can be: an image the user picked rather than the black frame.
    // Added here, ahead of the preset's filters, because the chain that fits it into the frame is one of them.
    const stitchCustom = stitchDraws || !stitchPictured ? null : this.usablePicture(task.preset.audioPicture === 'custom' ? task.preset.audioPictureImage : undefined)
    const stitchPictureFilters = stitchCustom ? this.addStillPicture(cmd, task.preset, stitchCustom) : []

    this.applyPresetToCommand(cmd, task.preset, stitchPictureFilters, {
      cropsPerClip: clipsConcatenate(task),
      // The drawing's graph owns the picture and the audio, so the encoder is not handed a `-vf` for a
      // picture the graph is already making.
      ...(stitchDraws ? { graphOwnsPicture: true } : {}),
    })
    if (targetBitrate > 0 && task.preset.audioCodec === 'copy') cmd.audioCodec('aac')
    // The clips' own audio is what arrives through the concat, so muting the main lane means the
    // joined output carries none of it — and there is then nothing for the audio options below to
    // apply to, which is why they are skipped rather than left to be ignored.
    if (!carriesMainAudio) cmd.outputOptions(['-an'])
    // A drawing's own graph resamples and lays the audio out, so the chain is not written twice: the
    // graph's half of the split and this one would fight over the same output stream.
    if (!stitchDraws && task.preset.container !== 'gif' && task.preset.imageOutputMode !== 'sequence' && carriesMainAudio) {
      // A stitch's own answer is the WIDEST source it was given, so a job that names no channel count keeps
      // that rather than being folded to stereo by a figure nobody asked for.
      const channels = this.exportChannels(task.preset, targetChannels)
      cmd.outputOptions([
        `-ar ${targetSampleRate}`,
        `-ac ${channels}`,
        `-af aresample=${targetSampleRate}:async=1,aformat=sample_fmts=fltp:channel_layouts=${channelLayoutFor(channels)}`,
        ...(targetBitrate > 0 ? [`-b:a ${Math.max(128000, targetBitrate)}`] : []),
      ])
    }

    // The joined sound is what the drawing is made from — the concatenated stream, not a sum of the
    // files, because a stitch plays its sources one after another and the picture has to show that
    // rather than a mix of them. Black remains the answer when nothing was asked for.
    if (stitchPictured) {
      // Every normalized source is written as stereo before it is joined, so the concatenated stream the
      // drawing is made from is a stereo one whatever the files were — the scope is drawn straight.
      if (stitchDraws) this.applyVisualization(cmd, task.preset, ['0:a:0'], this.visualizationBackgroundFor(cmd, task.preset, undefined, 1), targetSampleRate, this.exportChannels(task.preset, targetChannels), joinedSeconds)
      else if (!stitchCustom) this.addBlackPicture(cmd, task.preset, joinedSeconds)
    }

    cmd
      .on('progress', this.progressHandler(joinedSeconds, onProgress))
      .on('end', () => {
        try {
          fs.unlinkSync(joinedInput)
        } catch {}
        normalizedSources.forEach((file) => { try { fs.unlinkSync(file) } catch {} })
        this.activeProcesses.delete(task.id)
        onComplete()
      })
      .on('error', (err: Error) => {
        logEvent('ffmpeg', 'process error', { taskId: task.id, error: err.message })
        try {
          fs.unlinkSync(joinedInput)
        } catch {}
        normalizedSources.forEach((file) => { try { fs.unlinkSync(file) } catch {} })
        this.activeProcesses.delete(task.id)
        onError(err)
      })

    this.activeProcesses.set(task.id, cmd)
    cmd.on('start', (commandLine: string) => logEvent('ffmpeg', 'process started', { taskId: task.id, commandLine }))
    cmd.save(outputPath)
  }

  // --- Feature 3: Unique Feature: Multi-Language Audio Track Packaging ---
  /**
   * Concatenates a combo's visual sources into one file.
   *
   * The multi-track path maps a single video stream, so a combo with several
   * visuals used to reach the output with only the first of them. The clips are
   * normalized exactly as a stitch normalizes them, then joined by stream copy,
   * which leaves the muxing step with a single video to work with.
   */
  private async concatComboVisuals(task: QueueTask, onError: (error: Error) => void): Promise<string | null> {
    const canvas: [number, number] | undefined = task.preset.width && task.preset.height ? [task.preset.width, task.preset.height] : undefined
    const targetFps = outputFpsOf(task.preset) || 30
    const normalized: string[] = []
    // Clip lengths and fades follow the same rules the editor draws, so a fade put on
    // a cut is rendered here too: the muxing step downstream only ever sees the single
    // concatenated video, and could never place one itself.
    const clipDurations: number[] = []
    const sourceSizes: Array<{ width: number; height: number } | undefined> = []
    const comboRetimes: number[] = []
    // A cross-dissolve needs both neighbours to carry BOTH streams — `xfade` blends pictures, `acrossfade`
    // sounds — so a visual that is silent keeps the plain-cut join it had.
    let everySourceHasAudio = true
    for (let index = 0; index < task.sourcePaths.length; index++) {
      const source = task.sourcePaths[index]
      let probeDuration = 0
      let probedFps = 0
      let sourceSize: { width: number; height: number } | undefined
      // A PLACEHOLDER has no file to probe: a BLANK carries a picture AND a sound by construction and a
      // SILENCE sound alone, so neither changes the cross-dissolve's answer, and the clip's length comes from
      // its trim rather than from any container — see `sourceDuration`.
      if (!placeholderKind(source)) {
        try {
          const probe = await probeFile(source)
          probeDuration = Number(probe.duration || 0)
          probedFps = parseFrameRate(probe.videoStreams[0]?.fps)
          if (!probe.audioStreams.length) everySourceHasAudio = false
          const resolution = probe.videoStreams[0]?.resolution?.split('x').map(Number)
          if (resolution && resolution.length === 2 && resolution.every(Number.isFinite)) sourceSize = { width: resolution[0], height: resolution[1] }
        } catch { /* fall back to configured timing */ }
      }
      comboRetimes.push(this.retimeFor(task, source, index, probedFps))
      clipDurations.push(clipDurationFor(segmentTiming(
        sourceDuration(task, source, this.sequenceFor(task, source), () => ({ duration: probeDuration })),
        this.trimPoint(task, source, index),
      ).duration, comboRetimes[comboRetimes.length - 1]))
      sourceSizes.push(sourceSize)
    }
    const clipFades = resolveFades(clipDurations, task.sourcePaths.map((source, index) => transitionDuration(task, source, index)), { head: edgeFade(task, 'head'), tail: edgeFade(task, 'tail') })
    try {
      for (let index = 0; index < task.sourcePaths.length; index++) {
        const output = path.join(os.tmpdir(), `combo_${task.id}_${index}.mkv`)
        await this.normalizeStitchSource(task, task.sourcePaths[index], output, this.trimPoint(task, task.sourcePaths[index], index), canvas, targetFps, clipDurations[index] || 0, clipFades[index], index, sourceSizes[index], comboRetimes[index])
        normalized.push(output)
      }
    } catch (error) {
      normalized.forEach((file) => { try { fs.unlinkSync(file) } catch {} })
      onError(error instanceof Error ? error : new Error(String(error)))
      return null
    }
    const combined = path.join(os.tmpdir(), `combo_${task.id}.mkv`)
    // ONE cross-dissolve anywhere and the visuals are joined through the filtergraph rather than the concat
    // demuxer; a job of plain cuts keeps the demuxer and its stream copy, exactly as before.
    const crossfadeOverlaps = resolveCrossfades(clipDurations, task.sourcePaths.map((source, index) => crossfadeAt(task, clipKey(task, source, index))))
    const crossfadeReady = crossfadeOverlaps.some((value) => value > 0) && everySourceHasAudio
    try {
      if (crossfadeReady) {
        await this.renderCrossfadeJoin(normalized, clipDurations, crossfadeOverlaps, combined, task.id)
      } else {
        const listPath = path.join(os.tmpdir(), `combo_${task.id}.txt`)
        fs.writeFileSync(listPath, normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8')
        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(listPath)
            .inputOptions(['-f', 'concat', '-safe', '0'])
            .outputOptions(['-c', 'copy'])
            .on('end', () => resolve())
            .on('error', reject)
            .save(combined)
        })
      }
    } catch (error) {
      logEvent('ffmpeg', 'combo concat failed', { taskId: task.id, error: String(error) })
      onError(error instanceof Error ? error : new Error(String(error)))
      return null
    }
    logEvent('ffmpeg', 'combo visuals concatenated', { taskId: task.id, clips: task.sourcePaths.length, combined })
    return combined
  }

  /** A combo combines both axes: visuals concatenated, tracks muxed alongside. */
  private async executeCombo(
    task: QueueTask,
    outputPath: string,
    onProgress: (data: ProgressData) => void,
    onComplete: () => void,
    onError: (err: Error) => void
  ) {
    const combined = await this.concatComboVisuals(task, onError)
    if (!combined) return
    await this.executeMultiTrack(task, outputPath, onProgress, onComplete, onError, combined)
  }

  private async executeMultiTrack(
    task: QueueTask,
    outputPath: string,
    onProgress: (data: ProgressData) => void,
    onComplete: () => void,
    onError: (err: Error) => void,
    /** A already-rendered video to mux onto, used by the combo path. */
    videoOverride?: string
  ) {
    const videoSource = videoOverride || task.sourcePaths[0]
    // A muted track is one the export does not carry. STACKED, that means it is not an input at all — its lane
    // is its own stream, and it does not lengthen the output either. SEQUENCED, the tracks are ONE stream end
    // to end, so dropping one would SHORTEN the lane; a muted track is silenced in place instead, which is what
    // the concat below writes. Keeping the muted ones here is what lets it.
    const extraAudios = tracksConcatenate(task)
      ? (task.additionalAudioTracks || [])
      : (task.additionalAudioTracks || []).filter((track) => !laneIsMuted(task, track.id))
    // What the visual IS, before anything asks how long it is. A sequence and a lone still image used to
    // be one case here, because a sequence's first frame is a still — and they are not the same case: a
    // still cover plays under its tracks for as long as they run, while a sequence is a piece of footage
    // that finishes, and what comes after it is the tail this path exists to reconcile.
    const videoSequence = videoOverride ? undefined : this.sequenceFor(task, videoSource)
    const isSequenceVideo = Boolean(videoSequence)
    const isStillCover = !videoOverride && !isSequenceVideo && /\.(png|jpe?g|gif|tiff?|bmp|webp)$/i.test(videoSource)
    const videoTrim = videoOverride ? undefined : this.trimPoint(task, videoSource, 0)
    // The visual's own pixel size, from the probe this path already makes, for the same reason the
    // transcode path reads it: a fit is worked out from the clip's shape and the frame.
    let videoSize: { width: number; height: number } | null = null
    let probedDuration = 0
    let probedFps = 0
    // Whether the visual brings an audio stream of its own, which is what decides how the added tracks
    // are NUMBERED in the output. A still cover and an image sequence have none by construction, and a
    // video's own answer comes from the probe below. Guessed at rather than probed, the tags that name
    // each track's language would be written against a stream that may not exist.
    let videoHasAudio = !isStillCover && !isSequenceVideo
    // How many audio streams the visual carries, from the probe below: the range a clip's own per-stream
    // embedded controls are offered over, and the count an explicit map list is built against.
    let videoAudioCount = 0
    // Each track's own played length in SOURCE seconds, and its probed rate, both read once.
    const trackDurations: number[] = []
    const trackFps: number[] = []
    try {
      // A PLACEHOLDER has no file to probe. A BLANK carries a picture AND a sound by construction, which is
      // exactly what `videoHasAudio` would have learned from a probe; a SILENCE as a track is sound alone.
      const placeholderVisual = placeholderKind(videoSource)
      if (!placeholderVisual) {
        const videoProbe = await probeFile(videoSource)
        probedDuration = Number(videoProbe.duration || 0)
        probedFps = parseFrameRate(videoProbe.videoStreams[0]?.fps)
        videoHasAudio = videoProbe.audioStreams.length > 0
        videoAudioCount = videoProbe.audioStreams.length
        const resolution = videoProbe.videoStreams[0]?.resolution?.split('x').map(Number)
        if (resolution && resolution.length === 2 && resolution.every((value) => value > 0)) {
          videoSize = { width: resolution[0], height: resolution[1] }
        } else if (videoSequence?.width && videoSequence?.height) {
          videoSize = { width: videoSequence.width, height: videoSequence.height }
        }
      } else {
        videoHasAudio = placeholderVisual === 'video'
        videoAudioCount = videoHasAudio ? 1 : 0
      }
      const audioProbes = await Promise.all(extraAudios.map((track) => (placeholderKind(track.path) ? null : probeFile(track.path))))
      audioProbes.forEach((probe, index) => {
        const track = extraAudios[index]
        const point = this.trimPoint(task, track.path, 0, trackKey(task, track))
        if (!probe) {
          // A SILENCE's length is its trim against its endless source, exactly as the timeline reads it.
          trackDurations[index] = segmentTiming(sourceDuration(task, track.path), point).duration
          return
        }
        trackFps[index] = parseFrameRate(probe.videoStreams[0]?.fps)
        const full = Number(probe.duration || 0)
        trackDurations[index] = point && point.out > point.in ? Math.min(full - point.in, point.out - point.in) : full
      })
    } catch (error) {
      logEvent('ffmpeg', 'duration reconciliation probe failed; using container durations', { taskId: task.id, error: String(error) })
    }
    // How long the visual RUNS, which is the timeline's own rule rather than a fact about the file: a
    // sequence's length is its frames at its rate, and a still's is a length the job chose. Asked of a
    // probe instead, a sequence could only answer with the length of its first frame — which is nothing,
    // because a still has no length in its container — and the tail below then quietly became nothing too.
    // The RETIME is folded in exactly as the timeline folds it in (`clipDurationFor`), so a MULTI-TRACK or
    // COMBO can retime its visual and the drawn length is the written one.
    const visualSpeed = videoOverride ? DEFAULT_CLIP_SPEED : speedFor(task, videoSource, 0)
    const visualRetime = videoOverride ? 1 : this.retimeFor(task, videoSource, 0, probedFps)
    const trackRetimes = extraAudios.map((track, index) => this.retimeFor(task, track.path, 0, trackFps[index] ?? 0, trackKey(task, track)))
    const videoDuration = clipDurationFor(
      segmentTiming(sourceDuration(task, videoSource, videoSequence, () => ({ duration: probedDuration })), videoTrim).duration,
      visualRetime,
    )
    const trackTimelineDurations = trackDurations.map((seconds, index) => clipDurationFor(seconds || 0, trackRetimes[index]))
    // What the tracks amount to as ONE run of sound: the sum where they are SEQUENCED, the longest where
    // they are stacked. That is the figure the output is reconciled against either way.
    const audioRun = trackTimelineDurations.reduce((run, seconds) => (tracksConcatenate(task) ? run + seconds : Math.max(run, seconds)), 0)
    // A multi-track output runs to the longer of the visual and its tracks, the visual being padded when a
    // track outlasts it. A still cover is the exception: it is bounded by the tracks it plays under, having
    // no length of its own to run out of.
    const expectedSeconds = isStillCover && extraAudios.length > 0
      ? audioRun
      : Math.max(videoDuration, audioRun)
    // A visual shorter than its longest track is padded out, and that filter joins the same chain as any
    // scaling rather than replacing it. The padding such a visual gets is BLACK — which is what the tail
    // of a run-out picture should be, and what an added track plays under.
    const tailDuration = isStillCover ? 0 : Math.max(0, audioRun - videoDuration)
    // The fades the encoder will WRITE, on the same clamp the timeline draws with. The main visual's two
    // edges fade the picture and its own sound; each added track's edges fade THAT track and nothing else,
    // which is why the audio is filtered per output stream below. A combo's visual was already normalized
    // clip by clip — fades and all — so there is nothing left for its main lane here.
    const mainFades = videoOverride
      ? { video: [] as string[], audio: [] as string[] }
      : this.fadeFilters(
        resolveFades([videoDuration], [], { head: edgeFade(task, 'head'), tail: edgeFade(task, 'tail') })[0],
        videoDuration,
      )
    const trackFades = extraAudios.map((track, index) => this.fadeFilters(
      resolveFades([trackTimelineDurations[index] || 0], [], {
        head: trackEdgeFade(task, trackKey(task, track), 'head'),
        tail: trackEdgeFade(task, trackKey(task, track), 'tail'),
      })[0],
      trackTimelineDurations[index] || 0,
    ))
    // The retime filters, composed exactly as the transcode and normalize paths compose them: the picture
    // moved to where it falls at the new rate with the output rate pinned beside it, and the sound retimed
    // by atempo (pitch kept) or asetrate. Empty at the source's own rate, so an untouched job is handed the
    // same chain it always was.
    const speedVideo = speedVideoFilters(visualRetime, visualSpeed.interpolation === 'blending' ? 'blending' : 'sampling', outputFpsOf(task.preset))
    const speedMainAudio = speedAudioFilters(visualRetime, visualSpeed.maintainPitch !== false, 48000)
    const trackSpeedAudio = extraAudios.map((track, index) => speedAudioFilters(trackRetimes[index], speedFor(task, track.path, 0, trackKey(task, track)).maintainPitch !== false, 48000))
    let cmd = videoOverride ? ffmpeg(videoOverride)
      : videoSequence ? this.sequenceCommand(videoSequence, videoTrim)
      // A PLACEHOLDER visual is a flat colour (with silence) or a silence, asked of ffmpeg's own `lavfi` device
      // at the length the clip was stretched to: ONE input carrying one stream or two — see `placeholder`.
      : placeholderKind(videoSource) === 'video' ? (() => {
        const box = this.frameBoxFor(task.preset)
        return ffmpeg().input(blankSource(placeholderFill(videoSource) ?? '000000', box.width, box.height, outputFpsOf(task.preset) || 30, videoDuration)).inputOptions(['-f', 'lavfi'])
      })()
      : placeholderKind(videoSource) === 'audio' ? ffmpeg().input(silenceSource(videoDuration)).inputOptions(['-f', 'lavfi'])
      : ffmpeg(videoSource)
    if (isStillCover && extraAudios.length > 0) {
      cmd.inputOptions(['-loop 1', '-framerate 2'])
    }
    // A placeholder carries its own length in the source filter, so there is nothing to seek into.
    if (!isSequenceVideo && !placeholderKind(videoSource)) this.applyTrimInput(cmd, videoTrim)

    extraAudios.forEach((track, index) => {
      if (placeholderKind(track.path)) {
        cmd.input(silenceSource(trackDurations[index] || trackTimelineDurations[index] || 0)).inputOptions(['-f', 'lavfi'])
        return
      }
      cmd.input(track.path)
      this.applyTrimInput(cmd, this.trimPoint(task, track.path, 0, trackKey(task, track)))
    })

    // What the export does with the picture, which is three different things. A DRAWING takes the place
    // of the visual and is built from the mix the export writes, so it needs a visual that was only
    // standing in for one; a still the job was covered with becomes the drawing's background unless a
    // colour was asked for instead. An ATTACHED COVER is the still going into a sound container that can
    // hold artwork, which is the one way a picture belongs in an MP3. And otherwise the visual is the
    // picture and is mapped below.
    const drawsSound = isStillCover
      && task.preset.audioPicture === 'visualization'
      && task.preset.videoCodec !== 'copy'
      && task.preset.audioEnabled !== false
    // The audible inputs, in the order ffmpeg has them: the visual's own sound when the job carries it
    // and the visual HAS one, then each added track. A muted track is not here at all, which is what
    // keeps the drawing honest about what is heard.
    const carriesMainAudio = !laneIsMuted(task, MAIN_LANE_ID)
    const audible = [
      ...(carriesMainAudio && videoHasAudio ? ['0:a'] : []),
      ...extraAudios.map((_, idx) => `${idx + 1}:a`),
    ]
    const pictured = drawsSound && audible.length > 0
    if (pictured) {
      // The tracks summed for a drawing carry their OWN levels into the mix, one weight per input, because a
      // gain applied after `amix` would move every track together. The main lane is only in `audible` when
      // the visual HAS sound of its own, which a still cover does not, so the two lists line up.
      const audibleGains: Array<number | undefined> = [
        ...(carriesMainAudio && videoHasAudio ? [undefined] : []),
        ...extraAudios.map((track) => track.gainDb),
      ]
      this.applyVisualization(cmd, task.preset, audible, this.visualizationBackgroundFor(cmd, task.preset, isStillCover ? 0 : undefined, 1 + extraAudios.length), 48000, this.exportChannels(task.preset, 2), expectedSeconds, audibleGains)
    }
    const attachCover = !pictured && isStillCover && outputTakesArt(task.preset.container) && task.preset.coverArt !== false

    // And the picture the job was GIVEN, where its picture source is an image of the user's own choosing rather
    // than the still it is covered with. It is added as the LAST input, after the tracks, so every input index
    // written below — the tracks and their tags — still means what it meant; the mapping below is what points
    // the picture at it instead of at the cover. It is decided here rather than beside the filters because the
    // video mapping is what names it.
    const customPicture = pictured || attachCover ? null : this.usablePicture(task.preset.audioPicture === 'custom' ? task.preset.audioPictureImage : undefined)
    const pictureIndex = customPicture ? 1 + extraAudios.length : 0
    const pictureFilters = customPicture ? this.addStillPicture(cmd, task.preset, customPicture) : []

    // Video stream mapping
    const outputOptions: string[] = pictured ? [] : [`-map ${pictureIndex}:v:0`]
    if (attachCover) {
      // The still, stored rather than re-encoded, and marked as the file's artwork. `-c:v copy` comes
      // after the preset's own video codec so it is the codec that stands, and the still is never
      // scaled: an attached picture is not a rendered frame.
      cmd.outputOptions(['-c:v copy', '-disposition:v:0 attached_pic'])
    }

    // The video's own audio belongs to the main lane, so a muted main lane is not mapped at all; and
    // a job left with no audio anywhere says so, rather than being handed one by ffmpeg's own
    // default mapping of the first stream it found. A drawing's own graph carries the audio, so neither
    // is mapped here at all — mapping it twice would mux it twice.
    //
    // An untouched clip keeps `-map 0:a?` and ffmpeg's own selection. A clip a reader has told WHICH
    // streams to carry — or taken a stream OUT of — is mapped one stream at a time, so a muted or
    // extracted stream is not written at all and no stream is carried by both the picture and a track.
    const embeddedClipId = videoOverride ? undefined : clipKey(task, videoSource, 0)
    const embeddedCustom = !pictured
      && !videoOverride
      && carriesMainAudio
      && embeddedAudioCustomised(task, embeddedClipId as string, videoSource)
      && task.preset.audioEnabled !== false
    const mainStreams = embeddedCustom ? enabledEmbeddedStreams(task, embeddedClipId as string, videoSource, videoAudioCount) : null
    // The output stream each track's audio lands on: after the main lane's own streams, however many
    // there are — one per enabled embedded stream where the clip was told which to carry, or every stream
    // of the input where it is left to `-map 0:a?`, which maps ALL of them.
    const firstTrackOut = mainStreams ? mainStreams.length : (carriesMainAudio && videoHasAudio ? Math.max(1, videoAudioCount) : 0)
    if (!pictured) {
      if (mainStreams) {
        mainStreams.forEach((stream) => outputOptions.push(`-map 0:a:${stream.index}`))
        if (!mainStreams.length && extraAudios.length === 0) outputOptions.push('-an')
      } else if (carriesMainAudio) {
        outputOptions.push('-map 0:a?')
      } else if (extraAudios.length === 0) {
        outputOptions.push('-an')
      }
    }

    // A SEQUENCED set of tracks is ONE output stream, built by the graph below and mapped as `[aout]`;
    // stacked tracks are one stream each, mapped here. The two are the same list of inputs either way.
    const tracksStitched = tracksConcatenate(task) && extraAudios.length > 0
    if (!pictured && !tracksStitched) extraAudios.forEach((track, idx) => {
      const inputIdx = idx + 1
      // An EXTRACTED track names the stream it was pulled from; a plain added track is the file's own first.
      const stream = track.streamIndex != null ? `:a:${track.streamIndex}` : ':a:0'
      outputOptions.push(`-map ${inputIdx}${stream}`)
      // Metadata tags for language and title, written against the index the stream has in the OUTPUT
      // rather than its place in this list. The visual's own audio is mapped first when the job carries
      // it and the visual HAS one; a still cover or an image sequence has none, so a job whose only
      // audio is its added tracks numbers them from zero. Naming `s:a:1` where one audio stream exists
      // names nothing at all, which is how a language the job was told to write went missing.
      const audioStreamOutIdx = firstTrackOut + idx
      outputOptions.push(`-metadata:s:a:${audioStreamOutIdx} language=${track.language}`)
      if (track.title) {
        outputOptions.push(`-metadata:s:a:${audioStreamOutIdx} title="${track.title}"`)
      }
    })

    // A fit on the single visual is that clip's own framing, exactly as it is on the transcode path:
    // the chain stands in for the job's crop, scale and pad. A combo's visual is already a rendered
    // file whose framing was decided clip by clip before it was joined, so there is nothing here for
    // a fit to apply to and the override suppresses it.
    const clipChain = videoOverride ? null : this.clipFraming(task, videoSource, videoSize)
    // A visual shorter than its longest track is padded out, and that filter joins the same chain as any
    // scaling rather than replacing it. The padding is written as BLACK rather than left to the filter's
    // default: a tail that is a held frame and a tail that is black are one word apart in a filter chain,
    // and only one of them is what the export should contain where the picture has run out.
    const tailFilter = tailDuration > 0.01 && task.preset.videoCodec !== 'copy'
      ? [`tpad=stop_mode=add:color=black:stop_duration=${tailDuration.toFixed(3)}`]
      : []
    this.applyPresetToCommand(cmd, task.preset, pictured ? [] : [...tailFilter, ...pictureFilters, ...speedVideo, ...mainFades.video], {
      ...(clipChain ? { clipChain } : {}),
      ...(pictured ? { graphOwnsPicture: true } : {}),
      ...(attachCover ? { keepsArtwork: true } : {}),
    })
    if (isStillCover && extraAudios.length > 0 && !pictured) {
      cmd.outputOptions(['-r 2', '-tune stillimage', '-pix_fmt yuv420p', '-shortest'])
    }
    if (task.preset.audioCodec === 'copy') cmd.audioCodec('aac')
    // The drawing's own graph resamples and lays the audio out, so the chain is not written twice.
    const channels = this.exportChannels(task.preset, 2)
    const audioBase = `aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=${channelLayoutFor(channels)}`
    // One chain per MAIN-lane output stream: the untouched path has its one shared chain, and an explicit
    // embedded selection has one per enabled stream, each with that stream's own level appended — a single
    // `-af` would put one stream's level on all of them.
    const mainChains = mainStreams
      ? mainStreams.map((stream) => [audioBase, ...speedMainAudio, ...mainFades.audio, ...this.gainFilters(stream.gainDb)])
      : (carriesMainAudio && videoHasAudio ? [[audioBase, ...speedMainAudio, ...mainFades.audio]] : [])
    if (!pictured && tracksStitched) {
      // A SEQUENCED set of tracks: each input is retimed, faded and resampled in its own chain, and the
      // chains are CONCATENATED into one stream — the second axis of concatenation a COMBO(a STITCH of
      // tracks) asks for. One stream is mapped, so the tracks play one after another rather than together.
      const parts = extraAudios.map((track, idx) => {
        // A track this job's reader silenced is written as `volume=0` rather than left out: the concatenation
        // wants a segment of every track's length, so the lane keeps its shape while the mute is honoured.
        const chain = [audioBase, ...trackSpeedAudio[idx], ...(trackFades[idx]?.audio ?? []), ...(laneIsMuted(task, track.id) ? ['volume=0'] : []), ...this.gainFilters(track.gainDb)]
        const source = track.streamIndex != null ? `${idx + 1}:a:${track.streamIndex}` : `${idx + 1}:a`
        return `[${source}]${chain.join(',')}[t${idx}]`
      })
      const labels = extraAudios.map((_track, idx) => `[t${idx}]`).join('')
      parts.push(`${labels}concat=n=${extraAudios.length}:v=0:a=1[aout]`)
      cmd.complexFilter(parts.join(';'))
      cmd.outputOptions([`-ar 48000`, `-ac ${channels}`])
      outputOptions.push('-map [aout]')
      const language = extraAudios[0].language
      if (language) outputOptions.push(`-metadata:s:a:${firstTrackOut} language=${language}`)
      if (extraAudios[0].title) outputOptions.push(`-metadata:s:a:${firstTrackOut} title="${extraAudios[0].title}"`)
      mainChains.forEach((chain, outIndex) => cmd.outputOptions([`-filter:a:${outIndex} ${chain.join(',')}`]))
    } else if (!pictured) {
      // THE AUDIO IS FILTERED PER OUTPUT STREAM once any lane needs its own chain — a fade, a retime, or a
      // level — because a single `-af` would put one lane's on all of them. Each output stream gets the same
      // resample/layout it always had, with that lane's own filters appended. A job needing none is
      // handed the one `-af` it has always had, so the common path is untouched.
      const perStream = mainChains.some((chain) => chain.length > 1)
        || trackFades.some((fade) => fade.audio.length > 0)
        || trackSpeedAudio.some((chain) => chain.length > 0)
        // A track with a LEVEL of its own needs its own chain too: a shared `-af` would put that level on
        // every stream, which is the one thing a per-track gain must not do.
        || extraAudios.some((track) => this.gainFilters(track.gainDb).length > 0)
      cmd.outputOptions([`-ar 48000`, `-ac ${channels}`])
      if (!perStream) {
        cmd.outputOptions([`-af ${audioBase}`])
      } else {
        mainChains.forEach((chain, outIndex) => cmd.outputOptions([`-filter:a:${outIndex} ${chain.join(',')}`]))
        extraAudios.forEach((track, idx) => {
          const chain = [audioBase, ...trackSpeedAudio[idx], ...(trackFades[idx]?.audio ?? []), ...this.gainFilters(track.gainDb)]
          cmd.outputOptions([`-filter:a:${firstTrackOut + idx} ${chain.join(',')}`])
        })
      }
    }
    cmd.outputOptions(outputOptions)

    cmd
      .on('progress', this.progressHandler(expectedSeconds, onProgress))
      .on('end', () => {
        this.activeProcesses.delete(task.id)
        onComplete()
      })
      .on('error', (err: Error) => {
        logEvent('ffmpeg', 'process error', { taskId: task.id, error: err.message })
        this.activeProcesses.delete(task.id)
        onError(err)
      })

    this.activeProcesses.set(task.id, cmd)
    cmd.on('start', (commandLine: string) => logEvent('ffmpeg', 'process started', { taskId: task.id, commandLine }))
    cmd.save(outputPath)
  }

  /**
   * The progress callback for a command.
   *
   * fluent-ffmpeg's own percentage is documented as "may not be available depending on
   * input", and for a concat or a mix of inputs it never arrives: the queue's progress
   * bar then sat empty for the whole encode while the timemark advanced. The timemark
   * measured against the length the job will actually have is always available.
   */
  private progressHandler(expectedSeconds: number, onProgress: (data: ProgressData) => void) {
    return (progress: any) => {
      onProgress({
        percent: progressPercent({ timemark: progress.timemark, expectedSeconds, fallback: progress.percent }),
        currentFps: progress.currentFps,
        timemark: progress.timemark,
        currentKbps: progress.currentKbps,
        targetSize: progress.targetSize,
      })
    }
  }

  /**
   * The rate a still image is encoded at.
   *
   * The task records it per source when the file is imported, so the rate the editor
   * displays is the rate rendered. The preset's rate and then 25 stand in for files
   * that were added before that record existed.
   */
  private stillRate(task: QueueTask, source: string): number {
    const recorded = task.sourceMetadata?.[source]?.fps
    if (recorded && recorded > 0) return recorded
    if (outputFpsOf(task.preset) > 0) return outputFpsOf(task.preset)
    return 25
  }

  private applyTrimInput(cmd: ffmpeg.FfmpegCommand, point?: { in: number; out: number }) {
    if (!point || (point.in <= 0 && point.out <= point.in)) return
    const inputOptions: string[] = []
    if (point.in > 0) inputOptions.push('-ss', String(Math.max(0, point.in)))
    if (point.out > point.in) inputOptions.push('-t', String(Math.max(0, point.out - point.in)))
    if (inputOptions.length) cmd.inputOptions(inputOptions)
  }

  /**
   * A black picture for a source that has none.
   *
   * Built by ffmpeg itself and added as a second input, so the export has a video stream where its
   * one source could not supply one. The size is the export's own frame: a source with no picture
   * cannot say how big a picture should be, so the job's resolution answers and a job that asks for
   * "source" falls back to 1080p rather than inventing a size out of nothing. The length is the one
   * the job's own timeline gives it, and `-shortest` keeps the pair trimmed to the sound, so the
   * picture neither outlasts the track it accompanies nor holds the encode open when it is endless.
   */
  private addBlackPicture(cmd: ffmpeg.FfmpegCommand, preset: EncodingPreset, seconds: number): void {
    const { width, height } = this.frameBoxFor(preset)
    const length = seconds > 0 ? `:d=${seconds.toFixed(3)}` : ''
    cmd.input(`color=c=black:s=${width}x${height}:r=${this.pictureRateFor(preset)}${length}`).inputOptions(['-f', 'lavfi'])
    cmd.outputOptions(['-shortest'])
  }

  /** A path a job was given, where it can actually be read — a picture that has moved is not a picture. */
  private usablePicture(imagePath: string | undefined): string | null {
    if (!imagePath) return null
    try { return fs.statSync(imagePath).isFile() ? imagePath : null } catch { return null }
  }

  /**
   * The frame an image the job was given is fitted into: scaled with its shape kept, letterboxed on black.
   *
   * The same rule the export already applies to a clip that does not fill its frame, and the same one the
   * drawing's own graphs use for an uploaded background — so a custom picture and a drawing's background land
   * in the frame the same way. It is a suffix to the preset's own filters rather than a replacement for them,
   * so a job that named a resolution is scaled by that first and this then finds nothing left to do.
   */
  private stillFitFilters(preset: EncodingPreset): string[] {
    const { width, height } = this.frameBoxFor(preset)
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'setsar=1',
    ]
  }

  /**
   * The picture a job with only sound was given, added as an input of its own.
   *
   * HELD rather than played: an image input is looped at the export's own rate, and `-shortest` bounds it to
   * the sound, which is the rule the black frame beside it follows and the reason a still does not outlast the
   * track it accompanies. What comes back is the suffix that fits it into the frame — see `stillFitFilters`.
   */
  private addStillPicture(cmd: ffmpeg.FfmpegCommand, preset: EncodingPreset, imagePath: string): string[] {
    cmd.input(imagePath)
    cmd.inputOptions(['-loop', '1', '-framerate', String(this.pictureRateFor(preset))])
    cmd.outputOptions(['-shortest'])
    return this.stillFitFilters(preset)
  }

  /**
   * The frame a job with no picture of its own is given, and the rate it is written at.
   *
   * A source with no picture cannot say how big one should be, so the export's own resolution answers
   * and a job that asks for "source" falls back to 1080p rather than inventing a size out of nothing.
   * Even, because 4:2:0 encoders refuse an odd frame.
   */
  private frameBoxFor(preset: EncodingPreset): { width: number; height: number } {
    const box = preset.width && preset.height
      ? { width: preset.width, height: preset.height }
      : resolutionBox(preset.resolution) ?? { width: 1920, height: 1080 }
    const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2)
    return { width: even(box.width), height: even(box.height) }
  }

  private pictureRateFor(preset: EncodingPreset): number {
    return outputFpsOf(preset) > 0 ? outputFpsOf(preset) : 30
  }

  /**
   * How many channels a path writes: the job's own answer where it has one, and the path's own otherwise.
   *
   * Every path that owns the output layout has a fallback of its own — a stitch follows the widest source it
   * was given, the others write stereo — and a preset that says nothing keeps that fallback rather than
   * overriding it with a figure the user never chose. This is also the figure the drawing's own graph is laid
   * out to, because the two halves of one split cannot be laid out differently.
   */
  private exportChannels(preset: EncodingPreset, fallback: number): number {
    return outputChannels(preset) ?? fallback
  }

  /**
   * Draws the export's own mix, as one graph whose picture and whose audio come from the same stream.
   *
   * `sources` are the audible inputs by label — a lone sound file's own stream, or the tracks that
   * survive the job's mutes — and they are summed into one mix. What is drawn is that mix and what is
   * muxed is that mix, split rather than read twice, which is why the picture is built as a graph rather
   * than as a filter beside the encoder's own: a waveform that agreed with the sound only by coincidence
   * would be worse than no waveform at all.
   *
   * The picture filters live inside this graph, so the caller must not also hand ffmpeg a `-vf`: the two
   * are mutually exclusive for one output, and the refusal is a hard error rather than a precedence.
   *
   * `duration` is how long the export's sound runs — what the progress line sweeps across — and the line's
   * own on/off comes from the preset, so the default lives in one place rather than at each call site.
   */
  private applyVisualization(cmd: ffmpeg.FfmpegCommand, preset: EncodingPreset, sources: string[], background: string | { input: number }, rate: number, channels: number, duration: number, gainDbs: Array<number | undefined> = []): void {
    const { width, height } = this.frameBoxFor(preset)
    // EACH SOURCE IS LEVELLED BEFORE IT IS SUMMED. A drawing built from several inputs sums them with `amix`,
    // and a level applied after the sum would move every one of them together — so the gain is written on
    // that input's own chain and the mix takes the labels, which is the only way two tracks in one drawing
    // can stay at two different levels. Nothing is written for a source at unity, so an untouched job's
    // graph is the one it always was.
    const pre: string[] = []
    const labels = sources.map((source, index) => {
      const gain = this.gainFilters(gainDbs[index])
      if (!gain.length) return source
      pre.push(`[${source}]${gain.join(',')}[lv${index}]`)
      return `lv${index}`
    })
    const graph = visualizationGraph({
      template: preset.visualization ?? 'waveform',
      width,
      height,
      fps: this.pictureRateFor(preset),
      color: drawingColorOf(preset),
      sources: labels,
      background,
      rate,
      channels,
      duration,
      progressLine: visualizationProgressLine(preset),
      eq: eqStyleOf(preset),
      tune: drawingTuneOf(preset),
    })
    cmd.outputOptions([`-filter_complex ${[...pre, graph].join(';')}`, '-map [v]', '-map [aout]', '-shortest'])
  }

  /**
   * What the drawing sits on, adding the image input if the choice is one.
   *
   * The choice itself is `visualizationBackgroundKind`, which the editor asks too, so the two cannot
   * disagree about a job saved before the background was a choice. A still is an input the caller already
   * has — the visual the job is covered with — and is passed in by index. An uploaded IMAGE is not an input
   * yet, so it is added here and its index returned.
   *
   * It is added LOOPED, which is not a detail: one still is one frame, and an overlay of a drawing over a
   * single frame ends with that frame. Without the loop the export is a picture one frame long, whatever
   * the sound does.
   */
  private visualizationBackgroundFor(cmd: ffmpeg.FfmpegCommand, preset: EncodingPreset, stillInput: number | undefined, nextInputIndex: number): string | { input: number } {
    const kind = visualizationBackgroundKind(preset)
    if (kind === 'image' && preset.visualizationBackgroundImage) {
      cmd.input(preset.visualizationBackgroundImage)
      cmd.inputOptions(['-loop 1', `-framerate ${this.pictureRateFor(preset)}`])
      return { input: nextInputIndex }
    }
    if (kind === 'still' && stillInput !== undefined) return { input: stillInput }
    return preset.visualizationBackgroundColor || VISUALIZATION_BACKGROUND
  }

  /**
   * A clip's own crop and fit, as a filter chain, for a job whose clips are NOT joined.
   *
   * A job that concatenates normalizes every clip through its own chain, so a fit is a fit there by
   * construction. This is for the other shape of job — one visual, however many tracks sit beside it
   * — where the picture used to be left entirely to the job's resolution and crop, and a fit chosen
   * in the editor reached the timeline and stopped there. The frame is the job's own, so the fit
   * places the clip in exactly the frame the export writes; with no named frame or exact size the
   * output is the source's own size, which is therefore the frame the fit is worked out against.
   *
   * Nothing is returned when there is no fit to apply, which is what keeps this off the common path:
   * a job without one is handed to the encoder exactly as it always was.
   */
  private clipFraming(task: QueueTask, source: string, sourceSize: { width: number; height: number } | null): string[] | null {
    if (!usesClipFraming(task, source, 0)) return null
    if (!sourceSize || !(sourceSize.width > 0) || !(sourceSize.height > 0)) {
      logEvent('ffmpeg', 'the clip fit could not be applied: the source size is unknown', { taskId: task.id, source })
      return null
    }
    const frame = task.preset.width && task.preset.height
      ? { width: task.preset.width, height: task.preset.height }
      : resolutionBox(task.preset.resolution) ?? sourceSize
    return clipFilters({ source: sourceSize, frame, crop: effectiveCropFor(task, source, 0), fit: sourceFitFor(task, source, 0) })
  }

  // Helper to configure video/audio encoders with macOS VideoToolbox optimizations
  private applyPresetToCommand(cmd: ffmpeg.FfmpegCommand, preset: EncodingPreset, extraFilters: string[] = [], options: { cropsPerClip?: boolean; clipChain?: string[]; graphOwnsPicture?: boolean; keepsArtwork?: boolean } = {}) {
    // 1. Video Codec
    if (preset.videoCodec === 'copy') {
      cmd.videoCodec('copy')
    } else if (preset.videoCodec === 'h264') {
      if (preset.hardwareAccelerated && process.platform === 'darwin') {
        cmd.videoCodec('h264_videotoolbox')
      } else {
        cmd.videoCodec('libx264').outputOptions(['-preset medium', '-crf 20'])
        // Ten bits a sample where the job asked for it. It is the SOFTWARE encoder's own pixel format: the
        // hardware one is left at eight, because what a VideoToolbox generation supports for 10-bit H.264
        // depends on the machine and asking for it blindly turns a job into a failure on the wrong one.
        if (preset.videoBitDepth === 10) cmd.outputOptions(['-pix_fmt yuv420p10le'])
      }
    } else if (preset.videoCodec === 'hevc') {
      if (preset.hardwareAccelerated && process.platform === 'darwin') {
        cmd.videoCodec('hevc_videotoolbox')
      } else {
        cmd.videoCodec('libx265').outputOptions(['-preset medium', '-crf 23'])
        if (preset.videoBitDepth === 10) cmd.outputOptions(['-pix_fmt yuv420p10le'])
      }
    } else if (preset.videoCodec === 'prores') {
      if (preset.hardwareAccelerated && process.platform === 'darwin') {
        cmd.videoCodec('prores_videotoolbox')
      } else {
        cmd.videoCodec('prores_ks')
      }
      const profile = preset.proresProfile || 'standard'
      // The two 4444 profiles are the only higher ones: 4 is 4444 and 5 is 4444 XQ. There is no 8-bit
      // ProRes to offer — the codec's own pixel formats are 10-bit with a 12-bit alpha plane, and this
      // build writes yuv422p10le, yuv444p10le and yuva444p10le and nothing else.
      const profileMap: Record<string, number> = { proxy: 0, lt: 1, standard: 2, hq: 3, '4444': 4, '4444xq': 5 }
      cmd.outputOptions([`-profile:v ${profileMap[profile] ?? 2}`])
    } else if (preset.videoCodec === 'vp9') {
      cmd.videoCodec('libvpx-vp9')
    } else if (preset.videoCodec === 'av1') {
      cmd.videoCodec('libsvtav1')
    } else if (preset.videoCodec === 'png') {
      cmd.videoCodec('png')
      // PNG's two own settings. Compression trades the time spent writing the file against its SIZE and
      // never a pixel — a PNG is lossless at every setting. The bit depth is the samples a channel is
      // stored in: eight for a frame a player will open, sixteen for one on its way into a compositor.
      const png: string[] = []
      if (typeof preset.pngCompression === 'number' && Number.isFinite(preset.pngCompression)) {
        png.push('-compression_level ' + Math.max(0, Math.min(9, Math.round(preset.pngCompression))))
      }
      if (preset.imageBitDepth === 16) png.push('-pix_fmt rgb48be')
      else if (preset.imageBitDepth === 8) png.push('-pix_fmt rgb24')
      if (png.length) cmd.outputOptions(png)
    } else if (preset.videoCodec === 'mjpeg') {
      cmd.videoCodec('mjpeg')
      // The one image setting that trades SIZE against the picture rather than against time. ffmpeg's own
      // ladder runs downwards: a lower figure is a better picture and a larger file.
      if (typeof preset.jpegQuality === 'number' && Number.isFinite(preset.jpegQuality)) {
        cmd.outputOptions(['-q:v ' + Math.max(1, Math.min(31, Math.round(preset.jpegQuality)))])
      }
    } else if (preset.videoCodec === 'dxv') {
      // Resolume's own intermediate. Its encoder takes the picture as it comes, with no profile and
      // nothing to configure beyond the frame size the filters have already settled.
      cmd.videoCodec('dxv')
    } else if (preset.videoCodec === 'hap') {
      cmd.videoCodec('hap')
    } else if (preset.videoCodec === 'qtrle') {
      cmd.videoCodec('qtrle')
    } else if (preset.videoCodec === 'mpeg4') {
      cmd.videoCodec('mpeg4').outputOptions(['-q:v 3'])
    }

    if (preset.container === 'gif') {
      cmd.videoCodec('gif')
      // ANIMATION is one file, which is what the gif muxer writes with its loop count. A SEQUENCE is a
      // numbered run of single-frame GIFs instead, and `image2` is the muxer that writes a run — the
      // general `-vsync 0 -an` above is already in place for a sequence, so only the muxer differs here.
      // The loop and bounce options belong to the animation: a run of separate files has no loop to set.
      if (preset.imageOutputMode === 'sequence') {
        cmd.outputOptions(['-f image2'])
      } else {
        cmd.outputOptions(['-an', '-f gif', '-loop ' + gifLoopCount(preset.gifMode)])
        if (preset.gifMode === 'bounce') cmd.outputOptions(['-filter_complex [0:v]split[a][b];[b]reverse[rev];[a][rev]concat=n=2:v=1:a=0[v]', '-map [v]'])
      }
    }
    // Custom stream selection and exact dimensions. A container that cannot hold a picture is told so
    // outright, whatever the rest of the preset says: a WAV or an MP3 with a video filter and a video
    // codec attached is an encode that FAILS rather than a file with a stream the container could not
    // carry, which is the whole reason this question is asked of the container and not of `outputMode`.
    const pictureless = !outputCarriesPicture(preset.container) || preset.outputMode === 'audio'
    // A sound container that holds a still as ARTWORK is not pictureless for this purpose: `-vn` takes
    // the cover with it, and an attached picture is the one kind of stream such a container is for. That
    // stream is mapped by the caller, which also says `-c:v copy` so the still is stored, not re-encoded.
    if (pictureless && !options.keepsArtwork) cmd.outputOptions(['-vn'])
    if (preset.imageOutputMode === 'still') cmd.outputOptions(['-frames:v 1'])
    if (preset.imageOutputMode === 'sequence') cmd.outputOptions(['-vsync 0', '-an'])
    else if (preset.audioEnabled === false) cmd.outputOptions(['-an'])
    if (preset.audioSampleRate) cmd.audioFrequency(preset.audioSampleRate)
    // How many channels the export writes, where the job has been asked. Absent means the path's own answer,
    // which is what keeps a job saved before this control off the list encoding exactly as it did.
    if (preset.audioChannels) cmd.audioChannels(preset.audioChannels)
    // `-vf` is emitted once, from one chain. Setting it twice leaves only the last one
    // standing, which used to drop a named resolution the moment a caller added a
    // filter of its own.
    const videoFilters: string[] = []
    // An audio-only export has no picture to filter, and handing ffmpeg a filter chain
    // alongside -vn is an error rather than a harmless extra. Neither has any other container that
    // cannot hold a picture: the files that are sound-only are the same files everywhere below. A graph
    // that owns the picture owns the filters too — `-filter_complex` and `-vf` cannot both be given for
    // one output, and a drawing is scaled up to the frame inside its own graph.
    const wantsVideo = !pictureless && !options.graphOwnsPicture
    // A crop goes first: everything downstream then works on what was kept, which is what
    // makes cropping to an output shape a crop followed by a fit rather than two unrelated
    // operations. Its smallest side is floored, since an encoder rejects an empty frame.
    // A clip's own chain, where one was handed in, IS the framing: it already carries that crop, so
    // the job's own would be a crop of the crop, taken at fractions of a picture that no longer is
    // the source. That is why the chain suppresses it rather than following it.
    const usesClipChain = Boolean(options.clipChain && wantsVideo && preset.videoCodec !== 'copy')
    if (wantsVideo && preset.crop && hasCrop(preset.crop) && !options.cropsPerClip && !usesClipChain) videoFilters.push(cropFilter(preset.crop))
    // 2. Resolution Scaling
    if (wantsVideo && preset.videoCodec !== 'copy') {
      if (usesClipChain) videoFilters.push(...(options.clipChain as string[]))
      else {
        const exact = preset.width && preset.height ? { width: preset.width, height: preset.height } : undefined
        const box = exact ?? resolutionBox(preset.resolution)
        if (box) {
          // A cropped picture is fitted into the output frame keeping its proportions and then
          // padded out, because stretching a crop to the frame would undo the shape the crop was
          // made to have. A named resolution is the frame itself and is fitted the same way, so
          // asking for 4K really produces 4K. An exact size with no crop is still applied as it
          // stands, which is what lets the aspect buttons shape the picture.
          // The crop being per clip does not change that: the frame is still not to be stretched, so a
          // job whose clips are cropped one by one is fitted exactly as a job-wide crop was.
          const keepShape = Boolean(preset.crop && hasCrop(preset.crop)) || !exact
          videoFilters.push(`scale=${box.width}:${box.height}${keepShape ? ':force_original_aspect_ratio=decrease' : ''}`)
          if (keepShape) videoFilters.push(`pad=${box.width}:${box.height}:(ow-iw)/2:(oh-ih)/2:color=black`)
        }
      }
      // A still image can be any size at all, and 4:2:0 and 4:2:2 encoders refuse an odd
      // one outright: a 1195x896 source failed the whole job with "width not divisible by
      // 2". Rounding down to even is a no-op for a frame that already is, and it is added
      // after any scaling so a named resolution that leaves a smaller source untouched
      // cannot reintroduce an odd size. Hap wants four rather than two, and says so itself.
      if (preset.container !== 'gif' && QUAD_SIZE_CODECS.includes(preset.videoCodec)) {
        videoFilters.push('scale=trunc(iw/4)*4:trunc(ih/4)*4')
      } else if (preset.container !== 'gif' && EVEN_SIZE_CODECS.includes(preset.videoCodec)) {
        videoFilters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2')
      }
    }
    videoFilters.push(...(wantsVideo ? extraFilters : []))
    if (videoFilters.length) cmd.outputOptions([`-vf ${videoFilters.join(',')}`])

    // 3. Bitrates & FPS
    if (preset.videoBitrate && codecTakesRate(preset.videoCodec)) {
      cmd.outputOptions(['-b:v ' + preset.videoBitrate])
    }
    // A SEQUENCE writes one file per frame and says so with `-vsync 0`, which is passthrough — and
    // ffmpeg refuses an output rate beside a passthrough mode outright: "One of -r/-fpsmax was specified
    // together with a non-CFR -vsync/-fps_mode. This is contradictory." So the rate is NOT written for a
    // run, which is also the honest reading of it: a numbered run is every frame of the source as its own
    // file, and a rate would be a question about how fast they PLAY, which is the animation's business.
    if (outputFpsOf(preset) && preset.imageOutputMode !== 'sequence') {
      // The rate is handed over as the exact rational where the job named one — ffmpeg's `-r` takes
      // `30000/1001` — so an NTSC output does not drift a frame over a long reel the way its decimal would.
      if (preset.fpsRate) cmd.outputOptions([`-r ${preset.fpsRate.num}/${preset.fpsRate.den}`])
      else cmd.fps(outputFpsOf(preset))
    }

    // 4. Audio Codec
    if (preset.outputMode === 'audio' && preset.audioFormat === 'flac') {
      cmd.audioCodec('flac')
      cmd.outputOptions([flacSampleFormat(preset.audioBitDepth)])
    } else if (preset.audioCodec === 'copy') {
      cmd.audioCodec('copy')
    } else if (preset.audioCodec === 'aac') {
      cmd.audioCodec('aac')
    } else if (preset.audioCodec === 'pcm') {
      cmd.audioCodec(pcmCodecFor(preset.audioBitDepth))
    } else if (preset.audioCodec === 'opus') {
      cmd.audioCodec('libopus')
    } else if (preset.audioCodec === 'mp3') {
      cmd.audioCodec('libmp3lame')
    } else if (preset.audioCodec === 'flac') {
      // The one the chain used to miss. FLAC was settable and had no branch of its own, so it fell
      // through to the muxer's own default — a Matroska wrote VORBIS under a FLAC label, which
      // `npm run verify-codecs` caught by reading the file back rather than the argument list.
      cmd.audioCodec('flac')
      // And its DEPTH is its sample format rather than a figure of its own — pinned, so the file says what
      // the field and the estimate say. See `flacSampleFormat`.
      cmd.outputOptions([flacSampleFormat(preset.audioBitDepth)])
    }

    if (preset.audioBitrate && preset.audioCodec !== 'copy' && preset.audioCodec !== 'pcm') {
      cmd.audioBitrate(preset.audioBitrate)
    }
  }
}
