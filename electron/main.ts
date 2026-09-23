import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { probeFile } from './ffmpeg/probe'
import { QueueManager } from './queue/manager'
import { QueueTask, AppSettings, EditJobPatch, SourceFit } from '../src/types'
import { logEvent, getLogFile } from './logger'
import { resolveByteRange, mimeTypeFor } from './mediaRange'
import { FILMSTRIP_CLIP_HEIGHT, FILMSTRIP_SCALE, frameKey } from '../src/lib/filmstrip'
import { cropFilter, hasCrop, CropFractions } from '../src/lib/outputFrame'
import { clipFilters } from '../src/lib/sourceFit'
import { VISUALIZATION_BACKGROUND, VISUALIZATION_COLOR, stillWarmupSeconds, visualizationStillGraph } from '../src/lib/visualization'
import { peaksFromSamples } from '../src/lib/waveform'
import { runFfmpeg } from './ffmpeg/run'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import os from 'node:os'
import fs from 'node:fs'

/**
 * How much of the source hash names a helper build.
 *
 * Long enough that two revisions colliding is not a thing that happens, short enough to read in a log line.
 */
const HELPER_STAMP_LENGTH = 12

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Renderers load local media through this scheme. A custom protocol is required
// because the dev renderer runs on http://localhost, where Chromium refuses to
// load file:// media, and because <video> needs range requests in order to seek.
// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([{
  scheme: 'stitch-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
}])

// One state directory, shared by the development app and the packaged build. Electron
// derives the default from the app's own name, which is not the same in both, so settings
// and the queue were only ever remembered within whichever one wrote them: a rebuild
// looked like everything had been forgotten. Must run before the app is ready, and before
// anything asks for the userData path.
app.setPath('userData', path.join(app.getPath('appData'), 'stitch-up-media'))

let mainWindow: BrowserWindow | null = null
let queueManager: QueueManager | null = null
let editJobWindow: BrowserWindow | null = null
let editJobTask: QueueTask | null = null
// Set while the window is being closed ON PURPOSE — by OK, APPLY-and-close, or a confirmed discard —
// so that a close the user asked for is not turned back into the question the close button asks.
let editJobClosing = false
// Whether the renderer is up and listening. Before it is, there is nobody to ask, so a close is let
// through rather than swallowed by a question that no window is there to put.
let editJobReady = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 840,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#141416',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  // A trackpad pinch would otherwise zoom the whole interface, which reads as a
  // stray magnifier over the window.
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1)

  queueManager = new QueueManager(() => mainWindow)

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  logEvent('main', 'Application starting', { platform: process.platform, version: process.versions.electron, logFile: getLogFile() })

  // Streams a local file into a renderer. Byte ranges are resolved here rather
  // than delegated to net.fetch: a media element will not seek at all unless it
  // receives a 206 with Content-Range, so this must be exact.
  protocol.handle('stitch-media', async (request) => {
    const target = new URL(request.url).searchParams.get('path')
    if (!target || !path.isAbsolute(target)) return new Response('Missing media path', { status: 400 })

    let size: number
    try {
      const stats = fs.statSync(target)
      if (!stats.isFile()) return new Response('Not a file', { status: 404 })
      size = stats.size
    } catch {
      logEvent('media-protocol', 'media not found', { target })
      return new Response('Not found', { status: 404 })
    }

    const contentType = mimeTypeFor(target)
    const requested = request.headers.get('Range')
    const range = resolveByteRange(requested, size)

    if (requested && !range) {
      return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }

    if (range) {
      const body = Readable.toWeb(fs.createReadStream(target, { start: range.start, end: range.end })) as unknown as ReadableStream<Uint8Array>
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      })
    }

    const body = Readable.toWeb(fs.createReadStream(target)) as unknown as ReadableStream<Uint8Array>
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': contentType, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    })
  })

  createWindow()

  // IPC Handlers
  const sendEditJobTask = () => {
    if (editJobWindow && editJobTask) editJobWindow.webContents.send('edit-job-task', editJobTask)
  }
  ipcMain.handle('open-edit-job', async (_, task: QueueTask) => {
    editJobTask = task
    if (editJobWindow && !editJobWindow.isDestroyed()) {
      editJobWindow.focus(); sendEditJobTask(); return
    }
    editJobClosing = false
    editJobReady = false
    editJobWindow = new BrowserWindow({ width: 1320, height: 840, minWidth: 980, minHeight: 640, title: 'EDIT JOB', titleBarStyle: 'hiddenInset', backgroundColor: '#07111d', parent: mainWindow || undefined, webPreferences: { preload: path.join(__dirname, 'preload.mjs'), nodeIntegration: false, contextIsolation: true, sandbox: false } })
    editJobWindow.webContents.setVisualZoomLevelLimits(1, 1)
    editJobWindow.on('closed', () => { editJobWindow = null; editJobTask = null; editJobReady = false; editJobClosing = false })
    // The title bar's own close button asks the same question CANCEL does. The window is not shut here:
    // it is held open and the renderer is asked, so an edit is not lost by reaching for the traffic
    // light instead of the footbar. A close that was asked for deliberately passes straight through.
    editJobWindow.on('close', (event) => {
      if (editJobClosing || !editJobReady) return
      event.preventDefault()
      editJobWindow?.webContents.send('edit-job-close-requested')
    })
    editJobWindow.webContents.once('did-finish-load', () => { editJobReady = true; sendEditJobTask() })
    if (process.env.VITE_DEV_SERVER_URL) await editJobWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#edit-job`)
    else await editJobWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'edit-job' })
  })
  /** Shuts the window for real: the flag is what stops the close handler asking about it. */
  const closeEditJob = () => { editJobClosing = true; editJobWindow?.close() }
  // The editor sends only the fields it owns; the queue merges them field-scoped. APPLY keeps
  // the window open so a change can be made and looked at again; OK is the same thing and a
  // close, which is what the caller asks for with `close`.
  ipcMain.handle('apply-edit-job', async (_, patch: EditJobPatch, close = true) => {
    mainWindow?.webContents.send('edit-job-applied', patch)
    if (close) closeEditJob()
  })
  // The queue pushes editable-field changes here while the editor is open, so the
  // editor never applies edits on top of a stale snapshot. Ignored once the
  // window is gone, which is why no explicit teardown channel is needed.
  ipcMain.handle('sync-edit-job-task', async (_, task: QueueTask) => {
    if (!editJobWindow || editJobWindow.isDestroyed()) return
    if (!editJobTask || task.id !== editJobTask.id) return
    editJobTask = task
    sendEditJobTask()
  })
  ipcMain.handle('cancel-edit-job', async () => { closeEditJob() })
  // A generated clip belongs to the task, not to the window that happened to build it,
  // so the window reports it here and the queue records it. Without this the helper would
  // rebuild the footage for every still it opens, and the in/out points reported on close
  // would be filed against a file name that no longer exists.
  ipcMain.handle('remember-preview', async (_, taskId: string, sourceKey: string, previewPath: string) => {
    if (!taskId || !sourceKey || !previewPath) return
    mainWindow?.webContents.send('sequence-preview-ready', { taskId, sourceKey, previewPath })
  })
  // Per-source timing is a fact about the media rather than a job setting, so the editor
  // reports it as soon as it changes instead of waiting to be applied. The queue's card and
  // the frame-accurate helper then show the same numbers the editor just set.
  ipcMain.handle('apply-source-timing', async (_, taskId: string, sourceKey: string, override: { fps?: number; seconds?: number }) => {
    if (!taskId || !sourceKey || !override) return
    mainWindow?.webContents.send('source-timing', { taskId, sourceKey, override })
  })
  // The editor can take a source out of the job it is editing, and the queue is the only thing that
  // owns the job, so the window reports the removal rather than doing it. The INDEX is carried as
  // well as the path, because the same file can appear twice in one job and taking out "the file"
  // would take out the wrong one of them.
  ipcMain.handle('remove-edit-job-source', async (_, taskId: string, sourcePath: string, sourceIndex: number) => {
    if (!taskId || !sourcePath || !Number.isInteger(sourceIndex)) return
    mainWindow?.webContents.send('edit-job-remove-source', { taskId, sourcePath, sourceIndex })
  })
  ipcMain.handle('probe-media', async (_, filePath: string) => {
    logEvent('ipc', 'probe-media request', { filePath })
    try {
      const result = await probeFile(filePath)
      logEvent('ipc', 'probe-media success', { filePath })
      return result
    } catch (error) {
      logEvent('ipc', 'probe-media failure', { filePath, error: String(error) })
      throw error
    }
  })
  ipcMain.handle('path-exists', async (_, filePath: string) => {
    try { return fs.existsSync(filePath) } catch { return false }
  })

  // Filmstrip tiles for the timeline: frames sampled evenly across the range a clip actually uses,
  // one image per tile. Cached in memory, since a clip is redrawn on every scroll and zoom far more
  // often than its footage changes.
  //
  // Keyed by the SOURCE the picture belongs to and then by the source frame it is, never by where a
  // tile happens to sit and never by the file the frame was read out of. A tile that moves when the
  // lane is re-laid out is the same picture and comes from the cache, so a zoom extracts only the
  // frames it did not already have; and since a generated clip is rebuilt under a new name, keying on
  // the file would have thrown the whole cache away every rebuild for pictures that had not changed.
  /**
   * Whether a file has a picture at all, probed once and remembered.
   *
   * Frames are asked for by path, and a path may be one with no video stream in it — an audio track of
   * a multi-track job, say. Asking such a file for a frame is asking for something it does not have:
   * ffmpeg fails with "Output file does not contain any stream", which says nothing useful about the
   * file and everything about the request being wrong. The answer is a fact about the file and never
   * changes, so it is asked once and kept — the strip asks far more often than a file changes.
   *
   * This is the belt to the renderer's braces: the editor does not ask for frames of an audio clip,
   * and the one place that hands a path to ffmpeg refuses to make a picture out of one either.
   */
  const videoStreamCache = new Map<string, boolean>()
  const hasVideoStream = async (filePath: string): Promise<boolean> => {
    const remembered = videoStreamCache.get(filePath)
    if (remembered !== undefined) return remembered
    let hasVideo = false
    try {
      hasVideo = Boolean((await probeFile(filePath))?.videoStreams?.length)
    } catch {
      // A file that cannot be probed has no picture this process can read, which is the same answer
      // as far as the caller is concerned.
      hasVideo = false
    }
    videoStreamCache.set(filePath, hasVideo)
    return hasVideo
  }
  const frameCache = new Map<string, Map<string, string>>()
  const framesFor = (cacheId: string) => {
    const existing = frameCache.get(cacheId)
    if (existing) return existing
    const created = new Map<string, string>()
    frameCache.set(cacheId, created)
    if (frameCache.size > 40) frameCache.delete(frameCache.keys().next().value as string)
    return created
  }
  // The tile's pixel size, from the shape of the OUTPUT frame: every tile in a job is the same
  // shape, so a strip of a portrait clip and a strip of a landscape one read as one row of the
  // same thing — small pictures of the frame the encoder will write.
  const tileSizeFor = (outAspect: number) => {
    const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)
    const height = even(FILMSTRIP_CLIP_HEIGHT * FILMSTRIP_SCALE)
    return { width: even(height * outAspect), height }
  }
  ipcMain.handle('frames-at', async (_, filePath: string, options?: { times?: number[]; fps?: number; signature?: string; cacheId?: string; frame?: { width: number; height: number }; source?: { width: number; height: number }; fit?: SourceFit; crop?: CropFractions }) => {
    const times = (options?.times ?? []).filter((time) => Number.isFinite(time) && time >= 0)
    const fps = options?.fps && options.fps > 0 ? options.fps : 30
    const frame = options?.frame
    const source = options?.source
    const fit = options?.fit
    const crop = options?.crop
    // The key the editor is asking under, so a picture is never served for a placement it was not
    // drawn for. It names the frame, of which the tile's own size is the scaled copy.
    const signature = options?.signature ?? ''
    if (!filePath || !times.length) return []
    try { if (!(await fs.promises.stat(filePath)).isFile()) return [] } catch { return [] }
    // Nothing to extract from: an audio track has no frame to ask for at any time.
    if (!(await hasVideoStream(filePath))) return []
    // Cached by the SOURCE, never by the file the frame is read out of. For a sequence those differ:
    // the file is a generated clip, and a clip is rebuilt — at another rate, after a purge — under a
    // new name every time. Keyed by that name the cache could never survive a rebuild, so every tile
    // was extracted again for a picture that had not changed; keyed by the source it does.
    const have = framesFor(options?.cacheId || filePath)
    const keyOf = (time: number) => `${frameKey(Math.max(0, Math.round(time * fps)), signature)}`
    const outAspect = frame && frame.width > 0 && frame.height > 0 ? frame.width / frame.height : 16 / 9
    const { width, height } = tileSizeFor(outAspect)
    // One extraction per frame, each seeking straight to the moment it wants. Seeking the INPUT
    // is a fast keyframe seek, and it works on any source however its frames are numbered: the
    // alternative, selecting frame numbers out of the whole file, only lines up when they are
    // counted from the source's own start, and decodes everything up to the furthest one.
    const jobs: Array<{ key: string; time: number }> = []
    const queued = new Set<string>()
    times.forEach((time) => {
      const key = keyOf(time)
      if (have.has(key) || queued.has(key)) return
      queued.add(key)
      jobs.push({ key, time })
    })
    const extract = async ({ key, time }: { key: string; time: number }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-up-frame-'))
      const framePath = path.join(dir, 'frame.jpg')
      try {
        // The clip placed in the output frame by its own fit — the same chain the encoder is handed
        // — then the job's own crop of that frame, then the frame scaled down to the tile. So a
        // thumbnail is what the output will contain, and a fitted clip's tiles show the crop or the
        // bars it is going to get rather than a picture the export will never contain.
        const chain: string[] = []
        // Crop then fit, from the same module and in the same order the encoder uses, so a thumbnail
        // is a small copy of the frame the export will write rather than a picture of the source.
        const placement = frame && source ? clipFilters({ source, frame, fit, crop }) : null
        if (placement) {
          chain.push(...placement)
          // Down to the tile, and into it: what the placement left is already the frame's shape, so
          // this is a plain scaling of it.
          chain.push(`scale=${width}:${height}`)
        } else {
          // Nothing to place the clip in — a source whose size could not be read — so the frame is
          // treated as it was before there was a fit, and the crop is of the source itself.
          if (crop && hasCrop(crop)) chain.push(cropFilter(crop))
          chain.push(`scale=${width}:${height}`)
        }
        await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', time.toFixed(3), '-i', filePath, '-frames:v', '1', '-vf', chain.join(','), '-q:v', '4', framePath], 30000)
        have.set(key, `data:image/jpeg;base64,${(await fs.promises.readFile(framePath)).toString('base64')}`)
      } catch (error) {
        logEvent('ipc', 'frame extraction failed', { filePath, time, key, error: String(error) })
      } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
      }
    }
    // A few at a time. This bound is the machine's — each worker is an ffmpeg decoding a frame — so it
    // is deliberately small; what matters is that it is real, since a worker that never yields gave
    // no concurrency at all however many were started.
    const lanes = 4
    let next = 0
    await Promise.all(Array.from({ length: Math.min(lanes, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++]
        await extract(job)
      }
    }))
    return times.map((time) => have.get(keyOf(time)) ?? '')
  })

  /**
   * A file's audio as peaks, read once per file and kept, since the drawing is done in the timeline
   * from figures rather than from the audio itself.
   *
   * The audio is decoded to mono unsigned-float samples at a low rate — enough to describe a
   * waveform's shape, and a fraction of the size of the file's own audio — and then bucketed by the
   * same arithmetic the drawing uses. A file with no audio answers with nothing, which the timeline
   * draws as a flat line, and a file that cannot be read is remembered as having none rather than
   * being attempted again on every render.
   */
  const audioPeaksCache = new Map<string, number[] | null>()
  const peaksFor = async (filePath: string): Promise<number[] | null> => {
    if (audioPeaksCache.has(filePath)) return audioPeaksCache.get(filePath) ?? null
    let peaks: number[] | null = null
    try {
      const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 256 * 1024 * 1024 })
      const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4))
      peaks = samples.length ? peaksFromSamples(samples) : null
    } catch (error) {
      logEvent('ipc', 'waveform extraction failed', { filePath, error: String(error) })
    }
    audioPeaksCache.set(filePath, peaks)
    if (audioPeaksCache.size > 40) audioPeaksCache.delete(audioPeaksCache.keys().next().value as string)
    return peaks
  }
  ipcMain.handle('waveform-for', async (_, filePath: string) => {
    if (!filePath) return null
    try { if (!fs.statSync(filePath).isFile()) return null } catch { return null }
    return await peaksFor(filePath)
  })

  ipcMain.handle('get-paths-total-size', async (_, filePaths: string[]) => {
    return filePaths.reduce((total, filePath) => {
      try { return total + fs.statSync(filePath).size } catch { return total }
    }, 0)
  })

  ipcMain.handle('select-files', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Media Files',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [
        { name: 'Video, Audio & Image Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'wav', 'mp3', 'aac', 'm4a', 'flac', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    const files = result.canceled ? [] : result.filePaths
    logEvent('ipc', 'select-files result', { canceled: result.canceled, files })
    return files
  })

  ipcMain.handle('select-image', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an Image to Draw On',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'webp', 'heic', 'gif'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    const file = result.canceled ? null : result.filePaths[0] ?? null
    logEvent('ipc', 'select-image result', { canceled: result.canceled, file })
    return file
  })

  /**
   * The editor's own look at a drawing: one still of the chosen template in the chosen style.
   *
   * The same module builds this graph as builds the export's, so what is being judged is what will be
   * encoded rather than an impression of it. The frame is taken at a fixed quality and handed back as a
   * data URL, because it is a picture for a monitor rather than a file for anything to keep.
   */
  ipcMain.handle('visualization-still', async (_, options: {
    sources: string[]
    template: 'waveform' | 'eq' | 'spectrum'
    color?: string
    background?: 'colour' | 'still' | 'image'
    backgroundColor?: string
    backgroundImage?: string
    width?: number
    height?: number
    fps?: number
  }) => {
    const sources = (options.sources ?? []).filter((source) => { try { return fs.statSync(source).isFile() } catch { return false } })
    // Nothing to draw from is not an error: a job whose sound has not been probed yet simply has no still
    // to show, and the monitor says as much with its own placeholder.
    if (!sources.length) return null
    const width = Math.max(2, Math.round(options.width ?? 1280))
    const height = Math.max(2, Math.round(options.height ?? 720))
    const fps = Math.max(1, options.fps ?? 30)
    const wantsPicture = options.background === 'still' || options.background === 'image'
    const backgroundImage = wantsPicture && options.backgroundImage && fs.existsSync(options.backgroundImage) ? options.backgroundImage : null
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-up-viz-'))
    const stillPath = path.join(dir, 'still.jpg')
    try {
      // How long the drawing is given to fill before it is photographed, clamped to the shortest sound it
      // is drawn from — a frame asked for after a source has ended is a frame that arrives empty.
      let shortest = Number.POSITIVE_INFINITY
      for (const source of sources) {
        try { shortest = Math.min(shortest, Number((await probeFile(source)).duration || 0)) } catch { /* an unreadable length leaves the others */ }
      }
      const warmup = Number.isFinite(shortest) && shortest > 0 ? stillWarmupSeconds(options.template, shortest) : 0
      const args = ['-hide_banner', '-loglevel', 'error', '-y', ...sources.flatMap((source) => ['-i', source])]
      if (backgroundImage) args.push('-loop', '1', '-framerate', String(fps), '-i', backgroundImage)
      const background = backgroundImage ? { input: sources.length } : (options.backgroundColor || VISUALIZATION_BACKGROUND)
      const graph = visualizationStillGraph({
        template: options.template,
        width,
        height,
        fps,
        color: options.color || VISUALIZATION_COLOR,
        sources: sources.map((_, index) => `${index}:a`),
        background,
      })
      args.push('-filter_complex', graph, '-map', '[out]')
      if (warmup > 0.001) args.push('-ss', warmup.toFixed(3))
      args.push('-frames:v', '1', '-q:v', '3', stillPath)
      await runFfmpeg(args, 30000)
      return `data:image/jpeg;base64,${(await fs.promises.readFile(stillPath)).toString('base64')}`
    } catch (error) {
      logEvent('ipc', 'visualization still failed', { sources, error: String(error) })
      return null
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
    }
  })

  ipcMain.handle('expand-media-paths', async (_, inputPaths: string[]) => {
    const extensions = new Set(['mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'wav', 'mp3', 'aac', 'm4a', 'flac', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic'])
    const files: string[] = []
    const visit = (candidate: string) => {
      try {
        const info = fs.statSync(candidate)
        if (info.isDirectory()) {
          fs.readdirSync(candidate).forEach((child) => visit(path.join(candidate, child)))
        } else if (info.isFile() && extensions.has(path.extname(candidate).slice(1).toLowerCase())) {
          files.push(candidate)
        }
      } catch (error) {
        logEvent('ipc', 'expand-media-paths skipped path', { candidate, error: String(error) })
      }
    }
    inputPaths.forEach(visit)
    return [...new Set(files)]
  })

  ipcMain.handle('create-image-sequence-preview', async (_, inputPaths: string[], options?: { fps?: number; stillSeconds?: number; duration?: number }) => {
    const images = [...new Set(inputPaths)].filter((candidate) => /\.(jpg|jpeg|png|tif|tiff|heic)$/i.test(candidate))
    if (images.length < 1) return null
    const settings = queueManager?.getSettings()
    const cacheRoot = settings?.saveTempNextToSource
      ? path.dirname(images[0])
      : (settings?.cacheDirectory || path.join(os.tmpdir(), 'Stitch Up Media'))
    fs.mkdirSync(cacheRoot, { recursive: true })
    const previewPath = path.join(cacheRoot, `stitch-up-image-sequence-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`)
    const previewRegistry = path.join(app.getPath('userData'), 'generated-preview-paths.json')
    try {
      const current = fs.existsSync(previewRegistry) ? JSON.parse(fs.readFileSync(previewRegistry, 'utf8')) : []
      fs.mkdirSync(path.dirname(previewRegistry), { recursive: true })
      fs.writeFileSync(previewRegistry, JSON.stringify([...new Set([...(Array.isArray(current) ? current : []), previewPath])]), 'utf8')
    } catch {}
    const listPath = `${previewPath}.txt`
    const rate = options?.fps && options.fps > 0 ? options.fps : 25
    // A lone image becomes a clip of the requested length, so a still can be
    // trimmed like footage. Without the option it keeps its previous behaviour.
    const stillSeconds = options?.stillSeconds && options.stillSeconds > 0 ? options.stillSeconds : 1
    const args = ['-hide_banner', '-loglevel', 'error', '-y']
    try {
      if (images.length === 1) {
        // Looped straight from the file. The concat demuxer's duration directive adds
        // a tail frame, which made a ten-second still come out at 10.04s.
        args.push('-loop', '1', '-framerate', String(rate), '-t', String(stillSeconds), '-i', images[0])
      } else {
        // Each frame is held for one frame at the requested rate, and the output is
        // that rate too, so the clip's length is frameCount over rate. The rate used to
        // be a hardcoded 25 here while everything else worked in the requested rate,
        // which is how the helper came to show footage at the rate the user had just
        // replaced.
        const frameSeconds = 1 / rate
        const list = images.map((image) => `file '${image.replace(/'/g, "'\\''")}'\nduration ${frameSeconds}`).join('\n') + `\nfile '${images[images.length - 1].replace(/'/g, "'\\''")}'\n`
        fs.writeFileSync(listPath, list, 'utf8')
        args.push('-f', 'concat', '-safe', '0', '-i', listPath)
      }
      // A still is whatever size it happens to be, and 4:2:0 output needs both
      // dimensions even. An odd source, 1195 wide say, used to fail the whole run,
      // which left the caller with no clip and a helper reading the image as video.
      args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p')
      // Named outright rather than left to the muxer's default, because this file is played by a
      // <video> element and a decoder is not a muxer: H.264 at 4:2:0 with the index at the front is
      // what every Chromium build reads without argument, and the index at the front is what lets the
      // monitor seek into it before it has finished loading.
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(rate))
      // LIMITED RANGE, and this is the line that matters most for whether the clip plays at all. A
      // frame out of a JPEG is full range, and `-pix_fmt yuv420p` — or a format filter — does not
      // change that: ffmpeg names a full-range 4:2:0 frame yuvj420p, which IS yuv420p at the other
      // range, and Chromium's decoder has no entry for that name. It reported an unsupported pixel
      // format instead, so a still exported from a JPEG produced a clip nothing could play.
      args.push('-color_range', 'tv')
      // The concat demuxer emits a frame past the last one, so a sequence's clip came
      // out longer than frameCount over rate and drifted from the timeline across it.
      // An explicit length pins it to exactly the frames the timeline expects.
      if (images.length > 1 && options?.duration && options.duration > 0) args.push('-t', String(options.duration))
      args.push(previewPath)
      await runFfmpeg(args, 120000)
      return previewPath
    } catch (error) {
      logEvent('ipc', 'image-sequence preview failed', { count: images.length, rate, stillSeconds, args: args.join(' '), error: String(error) })
      try { fs.unlinkSync(previewPath) } catch {}
      return null
    } finally {
      try { fs.unlinkSync(listPath) } catch {}
    }
  })

  ipcMain.handle('find-image-siblings', async (_, filePath: string) => {
    const name = path.basename(filePath)
    const match = /^(.*?)(\d+)(\.[^.]+)$/.exec(name)
    if (!match || !/\.(png|jpg|jpeg|tif|tiff)$/i.test(match[3])) return [filePath]
    try {
      const dir = path.dirname(filePath)
      const escapedPrefix = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const escapedExt = match[3].replace('.', '\\.')
      const pattern = new RegExp(`^${escapedPrefix}\\d+${escapedExt}$`, 'i')
      return fs.readdirSync(dir).filter((entry) => pattern.test(entry)).sort().map((entry) => path.join(dir, entry))
    } catch {
      return [filePath]
    }
  })

  ipcMain.handle('list-sibling-files', async (_, filePath: string) => {
    const dir = path.dirname(filePath)
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(dir, entry.name))
  })

  ipcMain.handle('select-output-dir', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Output Folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('diagnostic-log', async (_, message: string, details?: unknown) => {
    logEvent('renderer', message, details)
  })

  ipcMain.handle('start-task', async (_, task: QueueTask) => {
    if (!queueManager) return { success: false, error: 'Queue Manager not ready' }
    queueManager.enqueue(task)
    queueManager.startQueue()
    return { success: true }
  })
  ipcMain.handle('start-selected-tasks', async (_, tasks: QueueTask[]) => {
    if (!queueManager) return { success: false, error: 'Queue Manager not ready' }
    queueManager.startSelected(tasks)
    return { success: true }
  })

  ipcMain.handle('cancel-task', async (_, taskId: string) => {
    queueManager?.cancel(taskId)
  })

  ipcMain.handle('set-queue-running', async (_, running: boolean) => {
    if (!queueManager) return { success: false, error: 'Queue Manager not ready' }
    if (running) queueManager.startQueue()
    else queueManager.pauseQueue()
    return { success: true }
  })

  ipcMain.handle('select-output-filename', async (_, currentPath: string, container: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: currentPath, filters: [{ name: container.toUpperCase(), extensions: [container] }] })
    return result.canceled ? null : result.filePath
  })
  ipcMain.handle('quick-look', async (_, targetPath: string, taskId?: string, trimStart?: number, trimEnd?: number, sourceIndex?: number, stillMode?: boolean, screenshotDirectory?: string, timestampDisplayMode?: 'timestamp' | 'framestamp', sequenceFps?: number, sequenceFrameCount?: number) => {
    const helperSourceName = stillMode ? 'quicklook-lite.swift' : 'quicklook-preview.swift'
    // Packaged builds unpack the Swift helpers from the asar archive: swiftc runs
    // as a native process and cannot read a path inside app.asar, and Electron's
    // fs shim would otherwise resolve the asar path successfully and hand swiftc
    // an unreadable file. Prefer the unpacked copy. When no archive is in play
    // (development), getAppPath() has no .asar segment and this is the repo root.
    const unpackedRoot = app.getAppPath().replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1')
    const sourceRoots = [
      path.join(unpackedRoot, 'electron'),
      path.join(__dirname, '../electron'),
      path.resolve(process.cwd(), 'electron'),
    ]
    // The preview helper is two files: its own, and the ruler arithmetic, which lives apart so it can be
    // asserted without a window. swiftc takes them as one program. The still helper needs only its own.
    const sourceNames = stillMode ? [helperSourceName] : [helperSourceName, 'quicklook-scale.swift']
    const sources = sourceRoots.map((root) => sourceNames.map((name) => path.join(root, name))).find((group) => group.every((file) => fs.existsSync(file)))
    const source = sources?.[0]
    try {
      if (!source || !sources) throw new Error(`Quick Look helper source not found. Checked: ${sourceRoots.map((root) => path.join(root, helperSourceName)).join(', ')}`)
      // The helper binary is named after the CONTENTS of the sources that make it, not after their
      // timestamps. This is the one place the app shells out to a compiled program, and a stale binary is
      // indistinguishable from stale code when it happens: the window opens, everything looks right, and
      // the change that was just made is simply not in it. That has cost real time here more than once. A
      // name that follows the source makes running an old one impossible rather than merely unlikely, and
      // it means the rebuild question is answered by the name rather than by a comparison of clocks.
      const base = stillMode ? 'stitch-up-quicklook-lite' : 'stitch-up-quicklook'
      const stamp = createHash('sha1')
        .update(sources.map((file) => fs.readFileSync(file)).reduce((all, contents) => Buffer.concat([all, contents]), Buffer.alloc(0)))
        .digest('hex')
        .slice(0, HELPER_STAMP_LENGTH)
      const helper = path.join(os.tmpdir(), `${base}-${stamp}`)
      logEvent('quick-look', 'starting native helper', { source, helper, targetPath, stillMode })
      if (!fs.existsSync(helper)) {
        execFileSync('swiftc', [...sources, '-o', helper, '-framework', 'AppKit', '-framework', 'AVKit', '-framework', 'AVFoundation'])
        // Every build from an earlier revision is dead weight AND a trap, since the stamped name is only worth
        // anything while the old names are gone. Swept here, where the directory is already being touched,
        // rather than on every open.
        try {
          const current = path.basename(helper)
          const stamped = new RegExp(`^${base}-[0-9a-f]{${HELPER_STAMP_LENGTH}}$`)
          for (const entry of fs.readdirSync(os.tmpdir())) {
            if (entry === current || !(stamped.test(entry) || entry === base)) continue
            try { fs.rmSync(path.join(os.tmpdir(), entry), { force: true }) } catch { /* another session may hold it */ }
          }
        } catch { /* a temp directory that cannot be listed is not a reason to refuse to open a window */ }
      }
      fs.chmodSync(helper, 0o755)
      const child = spawn(helper, [targetPath, taskId || '', trimStart == null ? '' : String(trimStart), trimEnd == null ? '' : String(trimEnd), sourceIndex == null ? '0' : String(sourceIndex), stillMode ? 'still' : '', screenshotDirectory || '', timestampDisplayMode === 'framestamp' ? 'framestamp' : 'timestamp', sequenceFps == null ? '' : String(sequenceFps), sequenceFrameCount == null ? '' : String(sequenceFrameCount)], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.once('error', (error) => logEvent('quick-look', 'native helper process error', { error: String(error), targetPath }))
      child.once('exit', (code, signal) => {
        if (code && code !== 143) logEvent('quick-look', 'native helper exited', { code, signal, targetPath })
      })
      child.unref()
      child.stdout?.on('data', (chunk: Buffer) => {
        const line = String(chunk).trim()
        if (line.startsWith('STITCH_TRIMMED:')) {
          const payload = line.slice('STITCH_TRIMMED:'.length)
          const separator = payload.indexOf(':')
          const returnedTaskId = separator >= 0 ? payload.slice(0, separator) : ''
          const returnedPath = separator >= 0 ? payload.slice(separator + 1) : payload
          if (returnedTaskId && returnedPath) mainWindow?.webContents.send('quicklook-trimmed', { taskId: returnedTaskId, path: returnedPath })
        }
        if (line.startsWith('STITCH_POINTS:')) {
          const payload = line.slice('STITCH_POINTS:'.length)
          const parts = payload.split(':')
          const returnedTaskId = parts.shift() || ''
          const sourceIndex = Number(parts.pop())
          const end = Number(parts.pop())
          const start = Number(parts.pop())
          const returnedPath = parts.join(':')
          if (returnedTaskId && returnedPath && Number.isFinite(start) && Number.isFinite(end)) mainWindow?.webContents.send('quicklook-points', { taskId: returnedTaskId, path: returnedPath, start, end, sourceIndex: Number.isFinite(sourceIndex) ? sourceIndex : 0 })
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        const message = String(chunk).trim()
        if (message) logEvent('quick-look', 'native helper stderr', { message, targetPath })
      })
    } catch (error) {
      logEvent('quick-look', 'native helper failed to start', { error: String(error), targetPath })
    }
  })

  ipcMain.handle('open-path', async (_, targetPath: string) => {
    shell.openPath(targetPath)
  })

  ipcMain.handle('show-item-in-folder', async (_, targetPath: string) => {
    shell.showItemInFolder(targetPath)
  })

  ipcMain.handle('get-settings', async () => {
    return queueManager?.getSettings()
  })

  const appStatePath = () => path.join(app.getPath('userData'), 'stitch-up-media-state.json')
  ipcMain.handle('load-app-state', async () => {
    try {
      if (!fs.existsSync(appStatePath())) return null
      const saved = JSON.parse(fs.readFileSync(appStatePath(), 'utf8'))
      if (saved?.settings) queueManager?.updateSettings(saved.settings)
      return saved
    } catch (error) {
      logEvent('main', 'Failed to load app state', { error: String(error) })
      return null
    }
  })
  ipcMain.handle('save-app-state', async (_, state: { tasks: QueueTask[]; settings: AppSettings }) => {
    try {
      const destination = appStatePath()
      const temporary = `${destination}.tmp`
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(temporary, JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2), 'utf8')
      fs.renameSync(temporary, destination)
    } catch (error) {
      logEvent('main', 'Failed to save app state', { error: String(error) })
    }
  })

  ipcMain.handle('save-settings', async (_, settings: AppSettings) => {
    queueManager?.updateSettings(settings)
    // Settings are persisted by the main window, which owns the app-state file, so a change made in
    // another window has to reach it or it lives only in this process's memory. That was invisible
    // while the queue was the only thing that ever changed a setting.
    mainWindow?.webContents.send('settings-changed', settings)
  })

  ipcMain.handle('clear-cache', async (_, directory?: string) => {
    const targets = [directory ? path.resolve(directory) : path.join(app.getPath('temp'), 'Stitch Up Media'), path.join(os.tmpdir(), 'Stitch Up Media')]
    let deleted = 0
    const previewRegistry = path.join(app.getPath('userData'), 'generated-preview-paths.json')
    try {
      const generated = fs.existsSync(previewRegistry) ? JSON.parse(fs.readFileSync(previewRegistry, 'utf8')) : []
      for (const generatedPath of Array.isArray(generated) ? generated : []) {
        if (typeof generatedPath === 'string' && fs.existsSync(generatedPath)) { fs.rmSync(generatedPath, { force: true }); deleted++ }
      }
      fs.rmSync(previewRegistry, { force: true })
    } catch {}
    for (const target of [...new Set(targets)]) {
      try {
        if (fs.existsSync(target)) {
          for (const entry of fs.readdirSync(target)) {
            fs.rmSync(path.join(target, entry), { recursive: true, force: true })
            deleted++
          }
        }
        for (const entry of fs.readdirSync(path.dirname(target))) {
          if (entry.startsWith('stitch-up-image-sequence-') && entry.endsWith('.mp4')) {
            fs.rmSync(path.join(path.dirname(target), entry), { force: true }); deleted++
          }
        }
      } catch (error) {
        logEvent('main', 'Failed to clear cache', { target, error: String(error) })
      }
    }
    return { deleted }
  })

  ipcMain.handle('get-system-load', async () => {
    return { cpuPercent: 12, isThrottled: false }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
// A quit is not a question. Every window closes without asking on the way out, which is what stops the
// EDIT JOB window's own close handler from holding the app open by asking a question as it leaves.
app.on('before-quit', () => { editJobClosing = true })
