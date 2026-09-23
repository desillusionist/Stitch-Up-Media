import ffmpeg from 'fluent-ffmpeg'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { logEvent } from '../logger'
import { QueueTask, EncodingPreset } from '../../src/types'
import { ClipFade, MAIN_LANE_ID, clipsConcatenate, edgeFade, effectiveCropFor, jobExportsPicture, laneIsMuted, resolveFades, segmentTiming, sourceDuration, sourceFitFor, stillSecondsFor, transitionDuration, usesClipFraming } from '../../src/lib/timelineModel'
import { mediaKind } from '../../src/lib/mediaKind'
import { progressPercent } from '../../src/lib/progress'
import { cropFilter, hasCrop, resolutionBox } from '../../src/lib/outputFrame'
import { outputCarriesPicture, outputTakesArt } from '../../src/lib/outputKind'
import { clipFilters } from '../../src/lib/sourceFit'
import { VISUALIZATION_BACKGROUND, VISUALIZATION_COLOR, visualizationBackgroundKind, visualizationGraph, visualizationProgressLine } from '../../src/lib/visualization'
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
const EVEN_SIZE_CODECS: Array<EncodingPreset['videoCodec']> = ['h264', 'hevc', 'prores', 'vp9', 'av1']

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
  private trimPoint(task: QueueTask, source: string, index: number) {
    return task.trimPoints?.[`${source}#${index}`] || task.trimPoints?.[source]
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
  private normalizeStitchSource(task: QueueTask, source: string, output: string, point: { in: number; out: number } | undefined, stitchCanvas: [number, number] | undefined, targetFps = 30, clipDuration = 0, fade?: ClipFade, clipIndex = 0, sourceSize?: { width: number; height: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      const sequence = this.sequenceFor(task, source)
      const isSequence = Boolean(sequence)
      const isStill = !isSequence && /\.(png|jpe?g|gif|tiff?|bmp|webp|heic|heif|avif)$/i.test(source)
      const command = sequence ? this.sequenceCommand(sequence, point) : ffmpeg(source)
      const [W, H] = stitchCanvas || (task.preset.width && task.preset.height ? [task.preset.width, task.preset.height]
        : task.preset.resolution === '4k' ? [3840, 2160] : task.preset.resolution === '720p' ? [1280, 720] : [1920, 1080])
      const rate = isSequence ? (sequence?.fps || 30) : (targetFps || 30)
      if (isStill) command.inputOptions(['-loop 1', '-framerate', String(this.stillRate(task, source)), '-t', String(stillSecondsFor(task, source))])
      if (!isSequence) this.applyTrimInput(command, point)
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
      const videoFilters = [
        ...(placement ?? [
          // No size to work the crop out against, so it is asked for in the source's own terms — the
          // same region either way — and the fit is left to ffmpeg's own aspect handling.
          ...(crop && hasCrop(crop) ? [cropFilter(crop)] : []),
          `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
          'setsar=1',
        ]),
        `fps=${outputRate}`,
        ...fades.video,
      ]
      command.videoCodec('libx264').outputOptions([`-vf ${videoFilters.join(',')}`, '-preset veryfast', '-pix_fmt yuv420p', '-video_track_timescale 90000'])
      command.audioCodec('aac').audioFrequency(48000).audioChannels(2)
        .outputOptions([`-af ${['aresample=48000:async=1', 'aformat=sample_fmts=fltp:channel_layouts=stereo', ...fades.audio].join(',')}`, '-b:a 160k', '-map 0:v:0?', '-map 0:a:0?'])
        .on('end', () => resolve()).on('error', reject).save(output)
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
    // The length the finished file will have, for the progress readout: the same rule the
    // timeline uses, backed by a probe of the one source.
    let expectedSeconds = 0
    // The source's own pixel size, from the probe this path already makes: a fit is worked out from
    // the clip's shape and the frame rather than by ffmpeg from the stream, so it needs the shape.
    let sourceSize: { width: number; height: number } | null = sequence?.width && sequence?.height
      ? { width: sequence.width, height: sequence.height }
      : null
    try {
      const probe = await probeFile(source)
      expectedSeconds = segmentTiming(
        sourceDuration(task, source, sequence, () => ({ duration: Number(probe.duration || 0) })),
        trim,
      ).duration
      const resolution = probe.videoStreams[0]?.resolution?.split('x').map(Number)
      if (!sourceSize && resolution && resolution.length === 2 && resolution.every((value) => value > 0)) {
        sourceSize = { width: resolution[0], height: resolution[1] }
      }
    } catch { /* the bar falls back to whatever ffmpeg reports */ }
    let cmd = sequence ? this.sequenceCommand(sequence, trim) : ffmpeg(source)
    if (isStillImage && task.preset.outputMode !== 'audio' && !task.preset.imageOutputMode) {
      // The rate is set on the input as well as the output. Without it ffmpeg's image
      // demuxer picks its own 25, and the clip would render at a rate unrelated to the
      // one the editor showed.
      cmd.inputOptions(['-loop 1', `-framerate ${this.stillRate(task, source)}`, '-t ' + stillSecondsFor(task, source)])
    }
    if (!isSequence) this.applyTrimInput(cmd, trim)
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
    if (draws) this.applyVisualization(cmd, task.preset, ['0:a:0'], this.visualizationBackgroundFor(cmd, task.preset, undefined, 1), 48000, 2, expectedSeconds)
    else if (soundOnly) this.addBlackPicture(cmd, task.preset, expectedSeconds)

    // A fit chosen for this clip's picture is the clip's own framing, and this is the one path where
    // the picture is not normalized first: a single visual has no other clip to be joined to, so
    // there is nothing to normalize it against. The chain STANDS IN for the job's own crop, scale
    // and pad rather than being added after them, so the clip is not framed twice.
    const clipChain = this.clipFraming(task, source, sourceSize)
    this.applyPresetToCommand(cmd, task.preset, [], {
      ...(clipChain ? { clipChain } : { cropsPerClip: clipsConcatenate(task) }),
      ...(draws ? { graphOwnsPicture: true } : {}),
    })
    // A muted lane is one the export does not carry, so its audio is dropped outright rather than
    // encoded and left silent: a file with no audio stream says so without being listened to.
    if (laneIsMuted(task, MAIN_LANE_ID)) cmd.outputOptions(['-an'])
    // A preset with no rate of its own means "source", and a still has none, so the
    // recorded rate becomes the output rate rather than leaving it to the encoder.
    if (isStillImage && !task.preset.fps && task.preset.outputMode !== 'audio' && !task.preset.imageOutputMode) {
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
      const probes = await Promise.all(task.sourcePaths.map((source) => probeFile(source)))
      const audio = probes.flatMap((probe) => probe.audioStreams)
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
    let targetFps = task.preset.fps || 0
    let clipDurations: number[] = []
    try {
      const parseFps = (value: any) => {
        if (typeof value === 'number') return value
        if (!value) return 0
        const text = String(value)
        if (text.includes('/')) {
          const [a, b] = text.split('/').map(Number)
          return b ? a / b : 0
        }
        return Number(text) || 0
      }
      const probes = await Promise.all(task.sourcePaths.map((source) => probeFile(source)))
      let maxW = 0, maxH = 0, maxFps = 0
      for (let probeIndex = 0; probeIndex < probes.length; probeIndex++) {
        const probe = probes[probeIndex]
        const source = task.sourcePaths[probeIndex]
        const resolution = probe.videoStreams[0]?.resolution?.split('x').map(Number)
        if (resolution && resolution.length === 2 && resolution.every(Number.isFinite)) {
          maxW = Math.max(maxW, resolution[0]); maxH = Math.max(maxH, resolution[1])
          sourceSizes.set(source, { width: resolution[0], height: resolution[1] })
        }
        const sequence = this.sequenceFor(task, source)
        maxFps = Math.max(maxFps, sequence?.fps || parseFps(probe.videoStreams[0]?.fps))
      }
      const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)
      stitchCanvas = task.preset.width && task.preset.height
        ? [task.preset.width, task.preset.height]
        : maxW && maxH ? [even(maxW), even(maxH)] : undefined
      if (!targetFps) targetFps = maxFps > 0 ? Math.round(maxFps * 1000) / 1000 : (task.sequenceInput?.fps || 30)
      // Clip lengths use the same precedence as the timeline, backed by the probes
      // already fetched here, so the encoder and the drawn ramps agree on timing.
      const probeDurations = new Map(probes.map((probe, index) => [task.sourcePaths[index], Number(probe.duration || 0)]))
      clipDurations = task.sourcePaths.map((source, index) => segmentTiming(
        sourceDuration(task, source, this.sequenceFor(task, source), (sourcePath) => ({ duration: probeDurations.get(sourcePath) ?? 0 })),
        this.trimPoint(task, source, index),
      ).duration)
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
        await this.normalizeStitchSource(task, source, normalized, this.trimPoint(task, source, index), stitchCanvas, targetFps, clipDurations[index] || 0, clipFades[index], index, sourceSizes.get(source))
        normalizedSources.push(normalized)
      }
    } catch (error) {
      normalizedSources.forEach((file) => { try { fs.unlinkSync(file) } catch {} })
      onError(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const tmpConcatFile = path.join(os.tmpdir(), `stitch_${task.id}.txt`)
    const fileLines = normalizedSources.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
    fs.writeFileSync(tmpConcatFile, fileLines, 'utf-8')

    let cmd = ffmpeg()
      .input(tmpConcatFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])

    // The same rule as the transcode path: a stitch of sound files asked for a picture has none to
    // join, so the export's own frame is supplied. It takes ONE input rather than one per clip,
    // because the picture never changes from clip to clip and there is nothing here for a clip's own
    // picture to differ about. A DRAWING is the sound itself drawn, and it takes the audio over with
    // it — built from the very joined sound it writes — so it is asked for ahead of the black frame.
    const carriesMainAudio = !laneIsMuted(task, MAIN_LANE_ID)
    const soundOnlyStitch = task.sourcePaths.length > 0 && task.sourcePaths.every((source) => mediaKind(source) === 'audio')
    const stitchPictured = jobExportsPicture(task) && soundOnlyStitch && carriesMainAudio
    const stitchDraws = stitchPictured && task.preset.audioPicture === 'visualization' && task.preset.videoCodec !== 'copy'

    this.applyPresetToCommand(cmd, task.preset, [], {
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
      cmd.outputOptions([
        `-ar ${targetSampleRate}`,
        `-ac ${targetChannels}`,
        `-af aresample=${targetSampleRate}:async=1,aformat=sample_fmts=fltp:channel_layouts=${targetChannels === 1 ? 'mono' : 'stereo'}`,
        ...(targetBitrate > 0 ? [`-b:a ${Math.max(128000, targetBitrate)}`] : []),
      ])
    }

    // The joined sound is what the drawing is made from — the concatenated stream, not a sum of the
    // files, because a stitch plays its sources one after another and the picture has to show that
    // rather than a mix of them. Black remains the answer when nothing was asked for.
    if (stitchPictured) {
      if (stitchDraws) this.applyVisualization(cmd, task.preset, ['0:a:0'], this.visualizationBackgroundFor(cmd, task.preset, undefined, 1), targetSampleRate, targetChannels, clipDurations.reduce((total, clip) => total + clip, 0))
      else this.addBlackPicture(cmd, task.preset, clipDurations.reduce((total, clip) => total + clip, 0))
    }

    cmd
      .on('progress', this.progressHandler(clipDurations.reduce((total, clip) => total + clip, 0), onProgress))
      .on('end', () => {
        try {
          fs.unlinkSync(tmpConcatFile)
        } catch {}
        normalizedSources.forEach((file) => { try { fs.unlinkSync(file) } catch {} })
        this.activeProcesses.delete(task.id)
        onComplete()
      })
      .on('error', (err: Error) => {
        logEvent('ffmpeg', 'process error', { taskId: task.id, error: err.message })
        try {
          fs.unlinkSync(tmpConcatFile)
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
    const targetFps = task.preset.fps || 30
    const normalized: string[] = []
    // Clip lengths and fades follow the same rules the editor draws, so a fade put on
    // a cut is rendered here too: the muxing step downstream only ever sees the single
    // concatenated video, and could never place one itself.
    const clipDurations: number[] = []
    const sourceSizes: Array<{ width: number; height: number } | undefined> = []
    for (let index = 0; index < task.sourcePaths.length; index++) {
      const source = task.sourcePaths[index]
      let probeDuration = 0
      let sourceSize: { width: number; height: number } | undefined
      try {
        const probe = await probeFile(source)
        probeDuration = Number(probe.duration || 0)
        const resolution = probe.videoStreams[0]?.resolution?.split('x').map(Number)
        if (resolution && resolution.length === 2 && resolution.every(Number.isFinite)) sourceSize = { width: resolution[0], height: resolution[1] }
      } catch { /* fall back to configured timing */ }
      clipDurations.push(segmentTiming(
        sourceDuration(task, source, this.sequenceFor(task, source), () => ({ duration: probeDuration })),
        this.trimPoint(task, source, index),
      ).duration)
      sourceSizes.push(sourceSize)
    }
    const clipFades = resolveFades(clipDurations, task.sourcePaths.map((source, index) => transitionDuration(task, source, index)), { head: edgeFade(task, 'head'), tail: edgeFade(task, 'tail') })
    try {
      for (let index = 0; index < task.sourcePaths.length; index++) {
        const output = path.join(os.tmpdir(), `combo_${task.id}_${index}.mkv`)
        await this.normalizeStitchSource(task, task.sourcePaths[index], output, this.trimPoint(task, task.sourcePaths[index], index), canvas, targetFps, clipDurations[index] || 0, clipFades[index], index, sourceSizes[index])
        normalized.push(output)
      }
    } catch (error) {
      normalized.forEach((file) => { try { fs.unlinkSync(file) } catch {} })
      onError(error instanceof Error ? error : new Error(String(error)))
      return null
    }
    const listPath = path.join(os.tmpdir(), `combo_${task.id}.txt`)
    fs.writeFileSync(listPath, normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8')
    const combined = path.join(os.tmpdir(), `combo_${task.id}.mkv`)
    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .on('end', () => resolve())
          .on('error', reject)
          .save(combined)
      })
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
    // A muted track is one the export does not carry, so it is never even an input: its map would
    // otherwise be written out below and the stream would reach the output. It does not lengthen the
    // output either, which is the same decision seen from the other side.
    const extraAudios = (task.additionalAudioTracks || []).filter((track) => !laneIsMuted(task, track.id))
    // What the visual IS, before anything asks how long it is. A sequence and a lone still image used to
    // be one case here, because a sequence's first frame is a still — and they are not the same case: a
    // still cover plays under its tracks for as long as they run, while a sequence is a piece of footage
    // that finishes, and what comes after it is the tail this path exists to reconcile.
    const videoSequence = videoOverride ? undefined : this.sequenceFor(task, videoSource)
    const isSequenceVideo = Boolean(videoSequence)
    const isStillCover = !videoOverride && !isSequenceVideo && /\.(png|jpe?g|gif|tiff?|bmp|webp)$/i.test(videoSource)
    const videoTrim = videoOverride ? undefined : this.trimPoint(task, videoSource, 0)
    let longestAudioDuration = 0
    // The visual's own pixel size, from the probe this path already makes, for the same reason the
    // transcode path reads it: a fit is worked out from the clip's shape and the frame.
    let videoSize: { width: number; height: number } | null = null
    let probedDuration = 0
    // Whether the visual brings an audio stream of its own, which is what decides how the added tracks
    // are NUMBERED in the output. A still cover and an image sequence have none by construction, and a
    // video's own answer comes from the probe below. Guessed at rather than probed, the tags that name
    // each track's language would be written against a stream that may not exist.
    let videoHasAudio = !isStillCover && !isSequenceVideo
    try {
      const videoProbe = await probeFile(videoSource)
      probedDuration = Number(videoProbe.duration || 0)
      videoHasAudio = videoProbe.audioStreams.length > 0
      const resolution = videoProbe.videoStreams[0]?.resolution?.split('x').map(Number)
      if (resolution && resolution.length === 2 && resolution.every((value) => value > 0)) {
        videoSize = { width: resolution[0], height: resolution[1] }
      } else if (videoSequence?.width && videoSequence?.height) {
        videoSize = { width: videoSequence.width, height: videoSequence.height }
      }
      const audioProbes = await Promise.all(extraAudios.map((track) => probeFile(track.path)))
      longestAudioDuration = audioProbes.reduce((max, probe, index) => {
        const point = this.trimPoint(task, extraAudios[index].path, 0)
        const full = Number(probe.duration || 0)
        return Math.max(max, point && point.out > point.in ? Math.min(full - point.in, point.out - point.in) : full)
      }, 0)
    } catch (error) {
      logEvent('ffmpeg', 'duration reconciliation probe failed; using container durations', { taskId: task.id, error: String(error) })
    }
    // How long the visual RUNS, which is the timeline's own rule rather than a fact about the file: a
    // sequence's length is its frames at its rate, and a still's is a length the job chose. Asked of a
    // probe instead, a sequence could only answer with the length of its first frame — which is nothing,
    // because a still has no length in its container — and the tail below then quietly became nothing too.
    const videoDuration = segmentTiming(
      sourceDuration(task, videoSource, videoSequence, () => ({ duration: probedDuration })),
      videoTrim,
    ).duration
    // A multi-track output runs to the longer of the visual and its tracks, the visual being padded when a
    // track outlasts it. A still cover is the exception: it is bounded by the tracks it plays under, having
    // no length of its own to run out of.
    const expectedSeconds = isStillCover && extraAudios.length > 0
      ? longestAudioDuration
      : Math.max(videoDuration, longestAudioDuration)
    // A visual shorter than its longest track is padded out, and that filter joins the same chain as any
    // scaling rather than replacing it. The padding such a visual gets is BLACK — which is what the tail
    // of a run-out picture should be, and what an added track plays under.
    const tailDuration = isStillCover ? 0 : Math.max(0, longestAudioDuration - videoDuration)
    let cmd = videoOverride ? ffmpeg(videoOverride) : (videoSequence ? this.sequenceCommand(videoSequence, videoTrim) : ffmpeg(videoSource))
    if (isStillCover && extraAudios.length > 0) {
      cmd.inputOptions(['-loop 1', '-framerate 2'])
    }
    if (!isSequenceVideo) this.applyTrimInput(cmd, videoTrim)

    extraAudios.forEach((track) => {
      cmd.input(track.path)
      this.applyTrimInput(cmd, this.trimPoint(task, track.path, 0))
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
      this.applyVisualization(cmd, task.preset, audible, this.visualizationBackgroundFor(cmd, task.preset, isStillCover ? 0 : undefined, 1 + extraAudios.length), 48000, 2, expectedSeconds)
    }
    const attachCover = !pictured && isStillCover && outputTakesArt(task.preset.container) && task.preset.coverArt !== false

    // Video stream mapping
    const outputOptions: string[] = pictured ? [] : ['-map 0:v:0']
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
    if (!pictured && carriesMainAudio) outputOptions.push('-map 0:a?')
    else if (!pictured && extraAudios.length === 0) outputOptions.push('-an')

    if (!pictured) extraAudios.forEach((track, idx) => {
      const inputIdx = idx + 1
      outputOptions.push(`-map ${inputIdx}:a:0`)
      // Metadata tags for language and title, written against the index the stream has in the OUTPUT
      // rather than its place in this list. The visual's own audio is mapped first when the job carries
      // it and the visual HAS one; a still cover or an image sequence has none, so a job whose only
      // audio is its added tracks numbers them from zero. Naming `s:a:1` where one audio stream exists
      // names nothing at all, which is how a language the job was told to write went missing.
      const audioStreamOutIdx = (carriesMainAudio && videoHasAudio ? 1 : 0) + idx
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
    this.applyPresetToCommand(cmd, task.preset, pictured ? [] : tailFilter, {
      ...(clipChain ? { clipChain } : {}),
      ...(pictured ? { graphOwnsPicture: true } : {}),
      ...(attachCover ? { keepsArtwork: true } : {}),
    })
    if (isStillCover && extraAudios.length > 0 && !pictured) {
      cmd.outputOptions(['-r 2', '-tune stillimage', '-pix_fmt yuv420p', '-shortest'])
    }
    if (task.preset.audioCodec === 'copy') cmd.audioCodec('aac')
    // The drawing's own graph resamples and lays the audio out, so the chain is not written twice.
    if (!pictured) cmd.outputOptions(['-ar 48000', '-ac 2', '-af aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo'])
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
    if (task.preset.fps && task.preset.fps > 0) return task.preset.fps
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
    return preset.fps && preset.fps > 0 ? preset.fps : 30
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
  private applyVisualization(cmd: ffmpeg.FfmpegCommand, preset: EncodingPreset, sources: string[], background: string | { input: number }, rate: number, channels: number, duration: number): void {
    const { width, height } = this.frameBoxFor(preset)
    const graph = visualizationGraph({
      template: preset.visualization ?? 'waveform',
      width,
      height,
      fps: this.pictureRateFor(preset),
      color: preset.visualizationColor || VISUALIZATION_COLOR,
      sources,
      background,
      rate,
      channels,
      duration,
      progressLine: visualizationProgressLine(preset),
    })
    cmd.outputOptions([`-filter_complex ${graph}`, '-map [v]', '-map [aout]', '-shortest'])
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
      }
    } else if (preset.videoCodec === 'hevc') {
      if (preset.hardwareAccelerated && process.platform === 'darwin') {
        cmd.videoCodec('hevc_videotoolbox')
      } else {
        cmd.videoCodec('libx265').outputOptions(['-preset medium', '-crf 23'])
      }
    } else if (preset.videoCodec === 'prores') {
      if (preset.hardwareAccelerated && process.platform === 'darwin') {
        cmd.videoCodec('prores_videotoolbox')
      } else {
        cmd.videoCodec('prores_ks')
      }
      const profile = preset.proresProfile || 'standard'
      const profileMap: Record<string, number> = { proxy: 0, lt: 1, standard: 2, hq: 3, '4444': 4 }
      cmd.outputOptions([`-profile:v ${profileMap[profile] ?? 2}`])
    } else if (preset.videoCodec === 'vp9') {
      cmd.videoCodec('libvpx-vp9')
    } else if (preset.videoCodec === 'av1') {
      cmd.videoCodec('libsvtav1')
    } else if (preset.videoCodec === 'png') {
      cmd.videoCodec('png')
    } else if (preset.videoCodec === 'mjpeg') {
      cmd.videoCodec('mjpeg')
    }

    if (preset.container === 'gif') {
      cmd.videoCodec('gif')
      cmd.outputOptions(['-an', '-f gif', '-loop ' + (preset.gifMode === 'regular' ? '1' : '0')])
      if (preset.gifMode === 'bounce') cmd.outputOptions(['-filter_complex [0:v]split[a][b];[b]reverse[rev];[a][rev]concat=n=2:v=1:a=0[v]', '-map [v]'])
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
      // cannot reintroduce an odd size.
      if (preset.container !== 'gif' && EVEN_SIZE_CODECS.includes(preset.videoCodec)) {
        videoFilters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2')
      }
    }
    videoFilters.push(...(wantsVideo ? extraFilters : []))
    if (videoFilters.length) cmd.outputOptions([`-vf ${videoFilters.join(',')}`])

    // 3. Bitrates & FPS
    if (preset.videoBitrate && preset.videoCodec !== 'copy') {
      cmd.outputOptions(['-b:v ' + preset.videoBitrate])
    }
    if (preset.fps) {
      cmd.fps(preset.fps)
    }

    // 4. Audio Codec
    if (preset.outputMode === 'audio' && preset.audioFormat === 'flac') {
      cmd.audioCodec('flac')
    } else if (preset.audioCodec === 'copy') {
      cmd.audioCodec('copy')
    } else if (preset.audioCodec === 'aac') {
      cmd.audioCodec('aac')
    } else if (preset.audioCodec === 'pcm') {
      cmd.audioCodec('pcm_s16le')
    } else if (preset.audioCodec === 'opus') {
      cmd.audioCodec('libopus')
    } else if (preset.audioCodec === 'mp3') {
      cmd.audioCodec('libmp3lame')
    }

    if (preset.audioBitrate && preset.audioCodec !== 'copy' && preset.audioCodec !== 'pcm') {
      cmd.audioBitrate(preset.audioBitrate)
    }
  }
}
