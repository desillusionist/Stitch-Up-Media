import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeFile } from './ffmpeg/probe'
import { QueueManager } from './queue/manager'
import { QueueTask, AppSettings, EditJobPatch } from '../src/types'
import { logEvent, getLogFile } from './logger'
import { spawn, execFileSync } from 'node:child_process'
import os from 'node:os'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let queueManager: QueueManager | null = null
let editJobWindow: BrowserWindow | null = null
let editJobTask: QueueTask | null = null

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

  queueManager = new QueueManager(() => mainWindow)

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  logEvent('main', 'Application starting', { platform: process.platform, version: process.versions.electron, logFile: getLogFile() })
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
    editJobWindow = new BrowserWindow({ width: 1320, height: 840, minWidth: 980, minHeight: 640, title: 'EDIT JOB', titleBarStyle: 'hiddenInset', backgroundColor: '#07111d', parent: mainWindow || undefined, webPreferences: { preload: path.join(__dirname, 'preload.mjs'), nodeIntegration: false, contextIsolation: true, sandbox: false } })
    editJobWindow.on('closed', () => { editJobWindow = null; editJobTask = null })
    editJobWindow.webContents.once('did-finish-load', sendEditJobTask)
    if (process.env.VITE_DEV_SERVER_URL) await editJobWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#edit-job`)
    else await editJobWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'edit-job' })
  })
  // The editor sends only the fields it owns; the queue merges them field-scoped.
  ipcMain.handle('apply-edit-job', async (_, patch: EditJobPatch) => {
    mainWindow?.webContents.send('edit-job-applied', patch)
    editJobWindow?.close()
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
  ipcMain.handle('cancel-edit-job', async () => { editJobWindow?.close() })
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

  ipcMain.handle('create-image-sequence-preview', async (_, inputPaths: string[]) => {
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
    const list = images.length === 1
      ? `file '${images[0].replace(/'/g, "'\\''")}'\nduration 1\nfile '${images[0].replace(/'/g, "'\\''")}'\n`
      : images.map((image) => `file '${image.replace(/'/g, "'\\''")}'\nduration 0.04`).join('\n') + `\nfile '${images[images.length - 1].replace(/'/g, "'\\''")}'\n`
    try {
      fs.writeFileSync(listPath, list, 'utf8')
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-vsync', 'vfr', '-pix_fmt', 'yuv420p', previewPath], { timeout: 120000 })
      return previewPath
    } catch (error) {
      logEvent('ipc', 'image-sequence preview failed', { count: images.length, error: String(error) })
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
    const sourceCandidates = [
      path.join(unpackedRoot, `electron/${helperSourceName}`),
      path.join(__dirname, `../electron/${helperSourceName}`),
      path.resolve(process.cwd(), `electron/${helperSourceName}`),
    ]
    const source = sourceCandidates.find((candidate) => fs.existsSync(candidate))
    const helper = path.join(os.tmpdir(), stillMode ? 'stitch-up-quicklook-lite' : 'stitch-up-quicklook')
    try {
      if (!source) throw new Error(`Quick Look helper source not found. Checked: ${sourceCandidates.join(', ')}`)
      logEvent('quick-look', 'starting native helper', { source, helper, targetPath, stillMode })
      if (!fs.existsSync(helper) || fs.statSync(source).mtimeMs > fs.statSync(helper).mtimeMs) {
        execFileSync('swiftc', [source, '-o', helper, '-framework', 'AppKit', '-framework', 'AVKit', '-framework', 'AVFoundation'])
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
