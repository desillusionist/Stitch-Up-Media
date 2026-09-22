import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { QueueTask, MediaProbeInfo, AppSettings, EditJobPatch, SourceFit } from '../src/types'

export interface IElectronAPI {
  probeMedia: (filePath: string) => Promise<MediaProbeInfo>
  selectFiles: () => Promise<string[]>
  expandMediaPaths: (paths: string[]) => Promise<string[]>
  createImageSequencePreview: (paths: string[], options?: { fps?: number; stillSeconds?: number; duration?: number }) => Promise<string | null>
  findImageSiblings: (path: string) => Promise<string[]>
  listSiblingFiles: (filePath: string) => Promise<string[]>
  getPathsTotalSize: (filePaths: string[]) => Promise<number>
  pathExists: (filePath: string) => Promise<boolean>
  /** Frames of a clip at given absolute source times, composited as the export will show them. */
  framesAt: (filePath: string, options?: {
    times?: number[]
    fps?: number
    /** Everything that changes the picture, so a frame is never served for another placement. */
    signature?: string
    /** The output frame the clip is placed in, and the clip's own pixel size. */
    frame?: { width: number; height: number }
    source?: { width: number; height: number }
    fit?: SourceFit
    crop?: { left: number; top: number; right: number; bottom: number }
    /**
     * What the frame is cached by: the SOURCE the picture belongs to, which for a sequence is not
     * the file it is read out of. A generated clip is rebuilt under a new name, and a cache keyed on
     * that name was thrown away with it, so every tile was extracted again for an unchanged picture.
     */
    cacheId?: string
  }) => Promise<string[]>
  /** A file's audio as peaks for the timeline's waveform, or null when it has none. */
  waveformFor: (filePath: string) => Promise<number[] | null>
  selectOutputDir: () => Promise<string | null>
  startTask: (task: QueueTask) => Promise<{ success: boolean; error?: string }>
  startSelectedTasks: (tasks: QueueTask[]) => Promise<{ success: boolean; error?: string }>
  cancelTask: (taskId: string) => Promise<void>
  setQueueRunning: (running: boolean) => Promise<void>
  onProgress: (callback: (taskId: string, progressData: any) => void) => () => void
  onTaskCompleted: (callback: (taskId: string) => void) => () => void
  onTaskError: (callback: (taskId: string, error: string) => void) => () => void
  openPath: (path: string) => Promise<void>
  quickLook: (path: string, taskId?: string, trimStart?: number, trimEnd?: number, sourceIndex?: number, stillMode?: boolean, screenshotDirectory?: string, timestampDisplayMode?: 'timestamp' | 'framestamp', sequenceFps?: number, sequenceFrameCount?: number) => Promise<void>
  onQuickLookTrimmed: (callback: (taskId: string, path: string) => void) => () => void
  onQuickLookPoints: (callback: (taskId: string, path: string, start: number, end: number, sourceIndex: number) => void) => () => void
  /** Applies a per-source timing change at once, without waiting for the EDIT JOB to be applied. */
  applySourceTiming: (taskId: string, sourceKey: string, override: { fps?: number; seconds?: number }) => Promise<void>
  onSourceTiming: (callback: (taskId: string, sourceKey: string, override: { fps?: number; seconds?: number }) => void) => () => void
  /** Tells the queue a generated clip exists, so it survives the window that built it. */
  rememberPreview: (taskId: string, sourceKey: string, previewPath: string) => Promise<void>
  /**
   * The EDIT JOB window's own close button was pressed, and the window is holding itself open.
   *
   * The renderer answers it the way the CANCEL button is answered: keep editing, or discard and
   * close. Subscribing is what makes the window closable at all, so the reply is not optional.
   */
  onEditJobCloseRequested: (callback: () => void) => () => void
  onSequencePreviewReady: (callback: (taskId: string, sourceKey: string, previewPath: string) => void) => () => void
  selectOutputFilename: (path: string, container: string) => Promise<string | null>
  showItemInFolder: (path: string) => Promise<void>
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<void>
  clearCache: (directory?: string) => Promise<{ deleted: number }>
  loadAppState: () => Promise<{ tasks: QueueTask[]; settings: AppSettings } | null>
  saveAppState: (state: { tasks: QueueTask[]; settings: AppSettings }) => Promise<void>
  getSystemLoad: () => Promise<{ cpuPercent: number; isThrottled: boolean }>
  diagnosticLog: (message: string, details?: unknown) => Promise<void>
  getPathForFile: (file: File) => string
  openEditJob: (task: QueueTask) => Promise<void>
  onEditJobTask: (callback: (task: QueueTask) => void) => () => void
  syncEditJobTask: (task: QueueTask) => Promise<void>
  applyEditJob: (patch: EditJobPatch, close?: boolean) => Promise<void>
  onEditJobApplied: (callback: (patch: EditJobPatch) => void) => () => void
  cancelEditJob: () => Promise<void>
  /**
   * Takes a source out of the job the editor is editing, by its path and its place in the job.
   *
   * The queue owns the job, so this asks rather than does: the main process hands the request to the
   * queue window, which removes the source and sends the job back. The index is carried as well as
   * the path because the same file can appear twice in one job, and taking out "the file" would take
   * out the wrong one of them.
   */
  removeEditJobSource: (taskId: string, sourcePath: string, sourceIndex: number) => Promise<void>
  onEditJobRemoveSource: (callback: (payload: { taskId: string; sourcePath: string; sourceIndex: number }) => void) => () => void
  onQueueFinished: (callback: () => void) => () => void
}

const api: IElectronAPI = {
  probeMedia: (filePath: string) => ipcRenderer.invoke('probe-media', filePath),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  expandMediaPaths: (paths: string[]) => ipcRenderer.invoke('expand-media-paths', paths),
  createImageSequencePreview: (paths: string[], options?: { fps?: number; stillSeconds?: number; duration?: number }) => ipcRenderer.invoke('create-image-sequence-preview', paths, options),
  findImageSiblings: (filePath: string) => ipcRenderer.invoke('find-image-siblings', filePath),
  listSiblingFiles: (filePath: string) => ipcRenderer.invoke('list-sibling-files', filePath),
  getPathsTotalSize: (filePaths: string[]) => ipcRenderer.invoke('get-paths-total-size', filePaths),
  pathExists: (filePath: string) => ipcRenderer.invoke('path-exists', filePath),
  framesAt: (filePath: string, options?: { times?: number[]; fps?: number; signature?: string; cacheId?: string; frame?: { width: number; height: number }; source?: { width: number; height: number }; fit?: SourceFit; crop?: { left: number; top: number; right: number; bottom: number } }) => ipcRenderer.invoke('frames-at', filePath, options),
  waveformFor: (filePath: string) => ipcRenderer.invoke('waveform-for', filePath),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  startTask: (task: QueueTask) => ipcRenderer.invoke('start-task', task),
  startSelectedTasks: (tasks: QueueTask[]) => ipcRenderer.invoke('start-selected-tasks', tasks),
  cancelTask: (taskId: string) => ipcRenderer.invoke('cancel-task', taskId),
  setQueueRunning: (running: boolean) => ipcRenderer.invoke('set-queue-running', running),
  onProgress: (callback) => {
    const handler = (_: any, { taskId, progressData }: any) => callback(taskId, progressData)
    ipcRenderer.on('task-progress', handler)
    return () => ipcRenderer.removeListener('task-progress', handler)
  },
  onTaskCompleted: (callback) => {
    const handler = (_: any, { taskId }: any) => callback(taskId)
    ipcRenderer.on('task-completed', handler)
    return () => ipcRenderer.removeListener('task-completed', handler)
  },
  onTaskError: (callback) => {
    const handler = (_: any, { taskId, error }: any) => callback(taskId, error)
    ipcRenderer.on('task-error', handler)
    return () => ipcRenderer.removeListener('task-error', handler)
  },
  openPath: (path: string) => ipcRenderer.invoke('open-path', path),
  quickLook: (path: string, taskId?: string, trimStart?: number, trimEnd?: number, sourceIndex?: number, stillMode?: boolean, screenshotDirectory?: string, timestampDisplayMode?: 'timestamp' | 'framestamp', sequenceFps?: number, sequenceFrameCount?: number) => ipcRenderer.invoke('quick-look', path, taskId, trimStart, trimEnd, sourceIndex, stillMode, screenshotDirectory, timestampDisplayMode, sequenceFps, sequenceFrameCount),
  onQuickLookTrimmed: (callback) => {
    const handler = (_: any, payload: { taskId: string; path: string }) => callback(payload.taskId, payload.path)
    ipcRenderer.on('quicklook-trimmed', handler)
    return () => ipcRenderer.removeListener('quicklook-trimmed', handler)
  },
  onQuickLookPoints: (callback) => {
    const handler = (_: any, payload: { taskId: string; path: string; start: number; end: number; sourceIndex: number }) => callback(payload.taskId, payload.path, payload.start, payload.end, payload.sourceIndex)
    ipcRenderer.on('quicklook-points', handler)
    return () => ipcRenderer.removeListener('quicklook-points', handler)
  },
  rememberPreview: (taskId: string, sourceKey: string, previewPath: string) => ipcRenderer.invoke('remember-preview', taskId, sourceKey, previewPath),
  onEditJobCloseRequested: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('edit-job-close-requested', handler)
    return () => ipcRenderer.removeListener('edit-job-close-requested', handler)
  },
  onSequencePreviewReady: (callback) => {
    const handler = (_: any, payload: { taskId: string; sourceKey: string; previewPath: string }) => callback(payload.taskId, payload.sourceKey, payload.previewPath)
    ipcRenderer.on('sequence-preview-ready', handler)
    return () => ipcRenderer.removeListener('sequence-preview-ready', handler)
  },
  applySourceTiming: (taskId: string, sourceKey: string, override: { fps?: number; seconds?: number }) => ipcRenderer.invoke('apply-source-timing', taskId, sourceKey, override),
  onSourceTiming: (callback) => {
    const handler = (_: any, payload: { taskId: string; sourceKey: string; override: { fps?: number; seconds?: number } }) => callback(payload.taskId, payload.sourceKey, payload.override)
    ipcRenderer.on('source-timing', handler)
    return () => ipcRenderer.removeListener('source-timing', handler)
  },
  selectOutputFilename: (path: string, container: string) => ipcRenderer.invoke('select-output-filename', path, container),
  showItemInFolder: (path: string) => ipcRenderer.invoke('show-item-in-folder', path),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('save-settings', settings),
  clearCache: (directory?: string) => ipcRenderer.invoke('clear-cache', directory),
  loadAppState: () => ipcRenderer.invoke('load-app-state'),
  saveAppState: (state) => ipcRenderer.invoke('save-app-state', state),
  getSystemLoad: () => ipcRenderer.invoke('get-system-load'),
  diagnosticLog: (message, details) => ipcRenderer.invoke('diagnostic-log', message, details),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openEditJob: (task: QueueTask) => ipcRenderer.invoke('open-edit-job', task),
  onEditJobTask: (callback) => {
    const handler = (_: any, task: QueueTask) => callback(task)
    ipcRenderer.on('edit-job-task', handler)
    return () => ipcRenderer.removeListener('edit-job-task', handler)
  },
  applyEditJob: (patch: EditJobPatch, close?: boolean) => ipcRenderer.invoke('apply-edit-job', patch, close),
  syncEditJobTask: (task: QueueTask) => ipcRenderer.invoke('sync-edit-job-task', task),
  cancelEditJob: () => ipcRenderer.invoke('cancel-edit-job'),
  removeEditJobSource: (taskId: string, sourcePath: string, sourceIndex: number) => ipcRenderer.invoke('remove-edit-job-source', taskId, sourcePath, sourceIndex),
  onEditJobRemoveSource: (callback) => {
    const handler = (_: any, payload: { taskId: string; sourcePath: string; sourceIndex: number }) => callback(payload)
    ipcRenderer.on('edit-job-remove-source', handler)
    return () => ipcRenderer.removeListener('edit-job-remove-source', handler)
  },
  onEditJobApplied: (callback) => {
    const handler = (_: any, patch: EditJobPatch) => callback(patch)
    ipcRenderer.on('edit-job-applied', handler)
    return () => ipcRenderer.removeListener('edit-job-applied', handler)
  },
  onQueueFinished: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('queue-finished', listener)
    return () => ipcRenderer.removeListener('queue-finished', listener)
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI?: IElectronAPI
  }
}
