import ffmpeg from 'fluent-ffmpeg'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { logEvent } from '../logger'
import { QueueTask, EncodingPreset } from '../../src/types'
import { ClipFade, resolveFades, segmentTiming, sourceDuration, stillSecondsFor, transitionDuration } from '../../src/lib/timelineModel'
import { progressPercent } from '../../src/lib/progress'
import { cropFilter, hasCrop } from '../../src/lib/outputFrame'
import { probeFile } from './probe'

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
  private normalizeStitchSource(task: QueueTask, source: string, output: string, point?: { in: number; out: number }, stitchCanvas?: [number, number], targetFps = 30, clipDuration = 0, fade?: ClipFade): Promise<void> {
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
      const videoFilters = [
        `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
        'setsar=1',
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
    try {
      const probe = await probeFile(source)
      expectedSeconds = segmentTiming(
        sourceDuration(task, source, sequence, () => ({ duration: Number(probe.duration || 0) })),
        trim,
      ).duration
    } catch { /* the bar falls back to whatever ffmpeg reports */ }
    let cmd = sequence ? this.sequenceCommand(sequence, trim) : ffmpeg(source)
    if (isStillImage && task.preset.outputMode !== 'audio' && !task.preset.imageOutputMode) {
      // The rate is set on the input as well as the output. Without it ffmpeg's image
      // demuxer picks its own 25, and the clip would render at a rate unrelated to the
      // one the editor showed.
      cmd.inputOptions(['-loop 1', `-framerate ${this.stillRate(task, source)}`, '-t ' + stillSecondsFor(task, source)])
    }
    if (!isSequence) this.applyTrimInput(cmd, trim)

    this.applyPresetToCommand(cmd, task.preset)
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
    const clipFades = resolveFades(clipDurations, task.sourcePaths.map((source, index) => transitionDuration(task, source, index)))
    try {
      for (let index = 0; index < task.sourcePaths.length; index++) {
        const normalized = path.join(os.tmpdir(), `stitch_${task.id}_${index}.mkv`)
        await this.normalizeStitchSource(task, task.sourcePaths[index], normalized, this.trimPoint(task, task.sourcePaths[index], index), stitchCanvas, targetFps, clipDurations[index] || 0, clipFades[index])
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

    this.applyPresetToCommand(cmd, task.preset)
    if (targetBitrate > 0 && task.preset.audioCodec === 'copy') cmd.audioCodec('aac')
    if (task.preset.container !== 'gif' && task.preset.imageOutputMode !== 'sequence') {
      cmd.outputOptions([
        `-ar ${targetSampleRate}`,
        `-ac ${targetChannels}`,
        `-af aresample=${targetSampleRate}:async=1,aformat=sample_fmts=fltp:channel_layouts=${targetChannels === 1 ? 'mono' : 'stereo'}`,
        ...(targetBitrate > 0 ? [`-b:a ${Math.max(128000, targetBitrate)}`] : []),
      ])
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
    for (let index = 0; index < task.sourcePaths.length; index++) {
      const source = task.sourcePaths[index]
      let probeDuration = 0
      try { probeDuration = Number((await probeFile(source)).duration || 0) } catch { /* fall back to configured timing */ }
      clipDurations.push(segmentTiming(
        sourceDuration(task, source, this.sequenceFor(task, source), () => ({ duration: probeDuration })),
        this.trimPoint(task, source, index),
      ).duration)
    }
    const clipFades = resolveFades(clipDurations, task.sourcePaths.map((source, index) => transitionDuration(task, source, index)))
    try {
      for (let index = 0; index < task.sourcePaths.length; index++) {
        const output = path.join(os.tmpdir(), `combo_${task.id}_${index}.mkv`)
        await this.normalizeStitchSource(task, task.sourcePaths[index], output, this.trimPoint(task, task.sourcePaths[index], index), canvas, targetFps, clipDurations[index] || 0, clipFades[index])
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
    const extraAudios = task.additionalAudioTracks || []
    const isStillCover = !videoOverride && /\.(png|jpe?g|gif|tiff?|bmp|webp)$/i.test(videoSource)
    let videoDuration = 0
    let longestAudioDuration = 0
    try {
      const videoProbe = await probeFile(videoSource)
      videoDuration = Number(videoProbe.duration || 0)
      const audioProbes = await Promise.all(extraAudios.map((track) => probeFile(track.path)))
      longestAudioDuration = audioProbes.reduce((max, probe, index) => {
        const point = this.trimPoint(task, extraAudios[index].path, 0)
        const full = Number(probe.duration || 0)
        return Math.max(max, point && point.out > point.in ? Math.min(full - point.in, point.out - point.in) : full)
      }, 0)
    } catch (error) {
      logEvent('ffmpeg', 'duration reconciliation probe failed; using container durations', { taskId: task.id, error: String(error) })
    }
    // A multi-track output runs to the longer of the video and its tracks, the video being
    // padded with a freeze frame when a track outlasts it. A still cover is the exception:
    // it is bounded by the tracks it plays under.
    const expectedSeconds = isStillCover && extraAudios.length > 0
      ? longestAudioDuration
      : Math.max(videoDuration, longestAudioDuration)
    const videoSequence = videoOverride ? undefined : this.sequenceFor(task, videoSource)
    const isSequenceVideo = Boolean(videoSequence)
    const videoTrim = videoOverride ? undefined : this.trimPoint(task, videoSource, 0)
    // A video shorter than its longest track is padded out with a freeze frame, and
    // that filter joins the same chain as any scaling rather than replacing it.
    const tailDuration = Math.max(0, longestAudioDuration - videoDuration)
    let cmd = videoOverride ? ffmpeg(videoOverride) : (videoSequence ? this.sequenceCommand(videoSequence, videoTrim) : ffmpeg(videoSource))
    if (isStillCover && extraAudios.length > 0) {
      cmd.inputOptions(['-loop 1', '-framerate 2'])
    }
    if (!isSequenceVideo) this.applyTrimInput(cmd, videoTrim)

    extraAudios.forEach((track) => {
      cmd.input(track.path)
      this.applyTrimInput(cmd, this.trimPoint(task, track.path, 0))
    })

    // Video stream mapping
    const outputOptions = ['-map 0:v:0']

    // Map audio from main video if wanted or only additional
    // Let's map audio 0:a? first, then additional tracks
    outputOptions.push('-map 0:a?')

    extraAudios.forEach((track, idx) => {
      const inputIdx = idx + 1
      outputOptions.push(`-map ${inputIdx}:a:0`)
      // Metadata tags for language and title
      const audioStreamOutIdx = idx + 1 // assuming 0:a is stream 0
      outputOptions.push(`-metadata:s:a:${audioStreamOutIdx} language=${track.language}`)
      if (track.title) {
        outputOptions.push(`-metadata:s:a:${audioStreamOutIdx} title="${track.title}"`)
      }
    })

    this.applyPresetToCommand(cmd, task.preset, tailDuration > 0.01 && task.preset.videoCodec !== 'copy'
      ? [`tpad=stop_mode=add:stop_duration=${tailDuration.toFixed(3)}`]
      : [])
    if (isStillCover && extraAudios.length > 0) {
      cmd.outputOptions(['-r 2', '-tune stillimage', '-pix_fmt yuv420p', '-shortest'])
    }
    if (task.preset.audioCodec === 'copy') cmd.audioCodec('aac')
    cmd.outputOptions(['-ar 48000', '-ac 2', '-af aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo'])
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

  // Helper to configure video/audio encoders with macOS VideoToolbox optimizations
  private applyPresetToCommand(cmd: ffmpeg.FfmpegCommand, preset: EncodingPreset, extraFilters: string[] = []) {
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
    // Custom stream selection and exact dimensions
    if (preset.outputMode === 'audio') cmd.outputOptions(['-vn'])
    if (preset.imageOutputMode === 'still') cmd.outputOptions(['-frames:v 1'])
    if (preset.imageOutputMode === 'sequence') cmd.outputOptions(['-vsync 0', '-an'])
    else if (preset.audioEnabled === false) cmd.outputOptions(['-an'])
    if (preset.audioSampleRate) cmd.audioFrequency(preset.audioSampleRate)
    // `-vf` is emitted once, from one chain. Setting it twice leaves only the last one
    // standing, which used to drop a named resolution the moment a caller added a
    // filter of its own.
    const videoFilters: string[] = []
    // An audio-only export has no picture to filter, and handing ffmpeg a filter chain
    // alongside -vn is an error rather than a harmless extra.
    const wantsVideo = preset.outputMode !== 'audio'
    // A crop goes first: everything downstream then works on what was kept, which is what
    // makes cropping to an output shape a crop followed by a fit rather than two unrelated
    // operations. Its smallest side is floored, since an encoder rejects an empty frame.
    if (wantsVideo && preset.crop && hasCrop(preset.crop)) videoFilters.push(cropFilter(preset.crop))
    // 2. Resolution Scaling
    if (wantsVideo) {
      if (preset.width && preset.height && preset.videoCodec !== 'copy') {
        videoFilters.push(`scale=${preset.width}:${preset.height}`)
      } else if (preset.resolution === '4k') {
        videoFilters.push('scale=3840:2160:force_original_aspect_ratio=decrease')
      } else if (preset.resolution === '1080p') {
        videoFilters.push('scale=1920:1080:force_original_aspect_ratio=decrease')
      } else if (preset.resolution === '720p') {
        videoFilters.push('scale=1280:720:force_original_aspect_ratio=decrease')
      }
      // A still image can be any size at all, and 4:2:0 and 4:2:2 encoders refuse an odd
      // one outright: a 1195x896 source failed the whole job with "width not divisible by
      // 2". Rounding down to even is a no-op for a frame that already is, and it is added
      // after any scaling so a named resolution that leaves a smaller source untouched
      // cannot reintroduce an odd size.
      if (preset.videoCodec !== 'copy' && preset.container !== 'gif' && EVEN_SIZE_CODECS.includes(preset.videoCodec)) {
        videoFilters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2')
      }
    }
    videoFilters.push(...extraFilters)
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
