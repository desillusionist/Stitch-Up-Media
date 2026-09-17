import { BrowserWindow, Notification } from 'electron'
import { QueueTask, AppSettings } from '../../src/types'
import { FFmpegEngine } from '../ffmpeg/engine'

export class QueueManager {
  private queue: QueueTask[] = []
  private isProcessing = false
  private completedCount = 0
  private errorCount = 0
  private notificationSent = false
  private engine = new FFmpegEngine()
  private activeCount = 0
  private selectedOnly: Set<string> | null = null
  private settings: AppSettings = {
    maxConcurrentTasks: 2,
    useHardwareAcceleration: true,
    notifyOnCompletion: true,
    defaultImageDuration: 10,
    saveTempNextToSource: true,
    pauseOnHighLoad: false,
    sequenceFps: 24,
    defaultImageFps: 25,
    timestampDisplayMode: 'timestamp',
  }

  constructor(private getMainWindow: () => BrowserWindow | null) {}

  public updateSettings(newSettings: AppSettings) {
    this.settings = { ...this.settings, ...newSettings }
  }

  public getSettings(): AppSettings {
    return this.settings
  }

  public enqueue(task: QueueTask) {
    const existingIndex = this.queue.findIndex((item) => item.id === task.id)
    if (existingIndex < 0) this.queue.push(task)
    else if (this.queue[existingIndex].status !== 'encoding') this.queue[existingIndex] = task
  }

  public startSelected(tasks: QueueTask[]) {
    tasks.forEach((task) => this.enqueue(task))
    this.startQueue(tasks.map((task) => task.id))
  }

  public cancel(taskId: string) {
    this.engine.cancel(taskId)
    const task = this.queue.find((t) => t.id === taskId)
    if (task) {
      task.status = 'paused'
    }
  }

  public startQueue(selectedIds?: string[]) {
    this.selectedOnly = selectedIds ? new Set(selectedIds) : null
    this.isProcessing = true
    this.completedCount = 0
    this.errorCount = 0
    this.notificationSent = false
    this.processNext()
  }

  public pauseQueue() {
    this.isProcessing = false
    this.queue.filter((task) => task.status === "encoding").forEach((task) => {
      this.engine.cancel(task.id)
      task.status = "pending"
      task.progress = 0
    })
  }

  private processNext() {
    if (!this.isProcessing) return

    while (this.activeCount < this.settings.maxConcurrentTasks) {
      const nextTask = this.queue.find((t) => t.status === 'pending' && (!this.selectedOnly || this.selectedOnly.has(t.id)))
      if (!nextTask) {
        if (this.activeCount === 0 && this.completedCount + this.errorCount > 0) {
          this.notifyQueueFinished()
        }
        break
      }

      this.runTask(nextTask)
    }
  }

  private runTask(task: QueueTask) {
    this.activeCount++
    task.status = 'encoding'
    task.progress = 0

    const win = this.getMainWindow()

    try {
      this.engine.runTask(
        task,
      (progressData) => {
        task.progress = progressData.percent
        task.fps = progressData.currentFps
        task.currentTimemark = progressData.timemark
        if (win && !win.isDestroyed()) {
          win.webContents.send('task-progress', { taskId: task.id, progressData })
        }
      },
      () => {
        this.activeCount--
        task.status = 'done'
        task.progress = 100
        this.completedCount++
        if (win && !win.isDestroyed()) {
          win.webContents.send('task-completed', { taskId: task.id })
          if (this.activeCount === 0 && !this.queue.some((item) => item.status === 'pending' || item.status === 'encoding')) win.webContents.send('queue-finished')
        }
        this.processNext()
      },
      (err) => {
        this.activeCount--
        if (task.status === 'pending' && !this.isProcessing) {
          this.processNext()
          return
        }
        task.status = 'error'
        task.errorMessage = err.message
        this.errorCount++
        if (win && !win.isDestroyed()) {
          win.webContents.send('task-error', { taskId: task.id, error: err.message })
          if (this.activeCount === 0 && !this.queue.some((item) => item.status === 'pending' || item.status === 'encoding')) win.webContents.send('queue-finished')
        }
        this.processNext()
      }
      )
    } catch (error) {
      this.activeCount--
      task.status = 'error'
      task.errorMessage = error instanceof Error ? error.message : String(error)
      this.errorCount++
      if (win && !win.isDestroyed()) {
        win.webContents.send('task-error', { taskId: task.id, error: task.errorMessage })
      }
      this.processNext()
    }
  }

  private notifyQueueFinished() {
    if (this.notificationSent) return
    this.notificationSent = true
    if (this.settings.notifyOnCompletion && Notification.isSupported()) {
      new Notification({
        title: 'Stitch Up Media',
        body: this.errorCount > 0 ? this.completedCount + ' completed; ' + this.errorCount + ' failed.' : 'All ' + this.completedCount + ' task(s) finished successfully.',
      }).show()
    }
  }
}
