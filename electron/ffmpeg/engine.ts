import ffmpeg from 'fluent-ffmpeg'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { logEvent } from '../logger'
import { QueueTask, EncodingPreset } from '../../src/types'
import { probeFile } from './probe'

export interface ProgressData {
  percent: number
  currentFps?: number
  timemark?: string
  currentKbps?: number
  targetSize?: number
}

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
  private normalizeStitchSource(task: QueueTask, source: string, output: string, point?: { in: number; out: number }, stitchCanvas?: [number, number], targetFps = 30): Promise<void> {
    return new Promise((resolve, reject) => {
      const sequence = this.sequenceFor(task, source)
      const isSequence = Boolean(sequence)
      const isStill = !isSequence && /\.(png|jpe?g|gif|tiff?|bmp|webp|heic|heif|avif)$/i.test(source)
      const command = sequence ? this.sequenceCommand(sequence, point) : ffmpeg(source)
      const [W, H] = stitchCanvas || (task.preset.width && task.preset.height ? [task.preset.width, task.preset.height]
        : task.preset.resolution === '4k' ? [3840, 2160] : task.preset.resolution === '720p' ? [1280, 720] : [1920, 1080])
      const rate = isSequence ? (sequence?.fps || 30) : (targetFps || 30)
      if (isStill) command.inputOptions(['-loop 1', '-framerate', String(rate), '-t', String(Math.max(0.1, task.stillImageDuration || 10))])
      if (!isSequence) this.applyTrimInput(command, point)
      if (isSequence || isStill) {
        command.outputOptions([`-vf scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${rate}`])
        command.videoCodec('libx264').outputOptions(['-preset veryfast', '-pix_fmt yuv420p', '-video_track_timescale 90000'])
      } else {
        command.videoCodec('libx264').outputOptions([`-vf scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${targetFps || 30}`, '-preset veryfast', '-pix_fmt yuv420p', '-video_track_timescale 90000'])
      }
      command.audioCodec('aac').audioFrequency(48000).audioChannels(2)
        .outputOptions(['-af aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo', '-b:a 160k', '-map 0:v:0?', '-map 0:a:0?'])
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
    } else if (task.type === 'multitrack' || task.type === 'combo') {
      void this.executeMultiTrack(task, outputPath, onProgress, onComplete, onError)
    } else {
      this.executeTranscode(task, outputPath, onProgress, onComplete, onError)
    }
  }

  // --- Feature 1: Standard Transcoding with Apple Hardware Acceleration ---
  private executeTranscode(
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
    let cmd = sequence ? this.sequenceCommand(sequence, trim) : ffmpeg(source)
    if (isStillImage && task.preset.outputMode !== 'audio' && !task.preset.imageOutputMode) {
      cmd.inputOptions(['-loop 1', '-t ' + Math.max(0.1, task.stillImageDuration || 10)])
    }
    if (!isSequence) this.applyTrimInput(cmd, trim)

    this.applyPresetToCommand(cmd, task.preset)

    cmd
      .on('progress', (progress: any) => {
        onProgress({
          percent: Math.min(100, Math.max(0, Math.round(progress.percent || 0))),
          currentFps: progress.currentFps,
          timemark: progress.timemark,
          currentKbps: progress.currentKbps,
          targetSize: progress.targetSize,
        })
      })
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
    } catch (error) {
      targetFps = targetFps || 30
      logEvent('ffmpeg', 'stitch canvas probe failed; using defaults', { taskId: task.id, error: String(error) })
    }
    try {
      for (let index = 0; index < task.sourcePaths.length; index++) {
        const normalized = path.join(os.tmpdir(), `stitch_${task.id}_${index}.mkv`)
        await this.normalizeStitchSource(task, task.sourcePaths[index], normalized, this.trimPoint(task, task.sourcePaths[index], index), stitchCanvas, targetFps)
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
      .on('progress', (progress: any) => {
        onProgress({
          percent: Math.min(100, Math.max(0, Math.round(progress.percent || 0))),
          currentFps: progress.currentFps,
          timemark: progress.timemark,
        })
      })
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
  private async executeMultiTrack(
    task: QueueTask,
    outputPath: string,
    onProgress: (data: ProgressData) => void,
    onComplete: () => void,
    onError: (err: Error) => void
  ) {
    const videoSource = task.sourcePaths[0]
    const extraAudios = task.additionalAudioTracks || []
    const isStillCover = /\.(png|jpe?g|gif|tiff?|bmp|webp)$/i.test(videoSource)
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
    const videoSequence = this.sequenceFor(task, videoSource)
    const isSequenceVideo = Boolean(videoSequence)
    const videoTrim = this.trimPoint(task, videoSource, 0)
    let cmd = videoSequence ? this.sequenceCommand(videoSequence, videoTrim) : ffmpeg(videoSource)
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

    this.applyPresetToCommand(cmd, task.preset)
    if (isStillCover && extraAudios.length > 0) {
      cmd.outputOptions(['-r 2', '-tune stillimage', '-pix_fmt yuv420p', '-shortest'])
    }
    const tailDuration = Math.max(0, longestAudioDuration - videoDuration)
    if (tailDuration > 0.01 && task.preset.videoCodec !== 'copy') {
      cmd.outputOptions([`-vf tpad=stop_mode=add:stop_duration=${tailDuration.toFixed(3)}`])
    }
    if (task.preset.audioCodec === 'copy') cmd.audioCodec('aac')
    cmd.outputOptions(['-ar 48000', '-ac 2', '-af aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo'])
    cmd.outputOptions(outputOptions)

    cmd
      .on('progress', (progress: any) => {
        onProgress({
          percent: Math.min(100, Math.max(0, Math.round(progress.percent || 0))),
          currentFps: progress.currentFps,
          timemark: progress.timemark,
        })
      })
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

  private applyTrimInput(cmd: ffmpeg.FfmpegCommand, point?: { in: number; out: number }) {
    if (!point || (point.in <= 0 && point.out <= point.in)) return
    const inputOptions: string[] = []
    if (point.in > 0) inputOptions.push('-ss', String(Math.max(0, point.in)))
    if (point.out > point.in) inputOptions.push('-t', String(Math.max(0, point.out - point.in)))
    if (inputOptions.length) cmd.inputOptions(inputOptions)
  }

  // Helper to configure video/audio encoders with macOS VideoToolbox optimizations
  private applyPresetToCommand(cmd: ffmpeg.FfmpegCommand, preset: EncodingPreset) {
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
    if (preset.width && preset.height && preset.videoCodec !== 'copy') {
      cmd.outputOptions([`-vf scale=${preset.width}:${preset.height}`])
    }
    if (preset.audioSampleRate) cmd.audioFrequency(preset.audioSampleRate)
    // 2. Resolution Scaling
    if (preset.width && preset.height) {
      // Exact custom dimensions above take precedence over named resolutions.
    } else if (preset.resolution === '4k') {
      cmd.outputOptions(['-vf scale=3840:2160:force_original_aspect_ratio=decrease'])
    } else if (preset.resolution === '1080p') {
      cmd.outputOptions(['-vf scale=1920:1080:force_original_aspect_ratio=decrease'])
    } else if (preset.resolution === '720p') {
      cmd.outputOptions(['-vf scale=1280:720:force_original_aspect_ratio=decrease'])
    }

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
