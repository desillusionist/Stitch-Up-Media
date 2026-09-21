import React from 'react'
import { createRoot } from 'react-dom/client'
import { EditJobApp } from '../src/components/EditJobApp'

/**
 * Renders the EDIT JOB window for real, in a page, and reports what it drew.
 *
 * Nothing else in the project renders a React component: `verify` is arithmetic, `verify-fit` is
 * pixels out of ffmpeg, and `measure` is a hand-written page of markup measured inside Electron. So
 * the one thing that had never been checked was whether the window renders at all — and the answer
 * was that it did not: hooks added after the component's early return made the hook count change
 * between the render that shows WAITING FOR QUEUE ITEM and the render that shows the editor, React
 * threw, and the window came up blank with nothing but its traffic lights. That is a whole class of
 * fault, and it is invisible to every other harness in the repo, so it is checked here.
 *
 * The bridge is a stub: this is about the editor's own render, not about IPC. Two renders are asked
 * for, and both matter — the waiting state first, which must be a message rather than nothing, and
 * the editor after a task arrives, which is the render that threw.
 */
const errors: string[] = []
window.addEventListener('error', (event) => { errors.push(String(event.message || event.error)) })
window.addEventListener('unhandledrejection', (event) => { errors.push('unhandled rejection: ' + String(event.reason)) })

const listeners: Array<(task: unknown) => void> = []
const noop = async () => undefined
const bridge = {
  getSettings: async () => ({
    maxConcurrentTasks: 1, useHardwareAcceleration: false, notifyOnCompletion: false,
    saveTempNextToSource: false, pauseOnHighLoad: false, defaultImageDuration: 10, sequenceFps: 25,
  }),
  onEditJobTask: (callback: (task: unknown) => void) => { listeners.push(callback); return () => undefined },
  onEditJobApplied: () => () => undefined,
  onSourceTiming: () => () => undefined,
  onSequencePreviewReady: () => () => undefined,
  onQueueFinished: () => () => undefined,
  probeMedia: async () => ({
    format: 'mp4', duration: 12, size: 0, bitrate: 0,
    videoStreams: [{ codec: 'h264', resolution: '1920x1080', fps: 25 }],
    audioStreams: [{ codec: 'aac', channels: 2, sampleRate: 48000 }],
  }),
  pathExists: async () => true,
  createImageSequencePreview: async () => null,
  framesAt: async () => [],
  waveformFor: async () => [],
  applySourceTiming: noop, syncEditJobTask: noop, applyEditJob: noop, cancelEditJob: noop,
  rememberPreview: noop, openEditJob: noop, quickLook: noop, diagnosticLog: noop,
}
// A cast through `unknown`, because the project declares `window.electronAPI` globally as the real
// bridge and a stub is deliberately not that: it answers the calls the editor makes on mount and
// nothing else, which is what "the render does not depend on IPC" is meant to demonstrate.
;(window as unknown as { electronAPI: unknown }).electronAPI = bridge

/** A job of the plainest kind, so the render has a timeline, a monitor and settings to draw. */
const task = {
  id: 'mount-check', type: 'transcode', sourcePaths: ['/tmp/clip.mp4'],
  outputDirectory: '/tmp', outputFilename: 'out.mp4', status: 'pending', progress: 0,
  preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p' },
}

const host = document.createElement('div')
document.body.appendChild(host)
createRoot(host).render(React.createElement(EditJobApp))

const result: { errors: string[]; waiting?: boolean; rendered?: unknown } = { errors }
const carries = window as unknown as Record<string, unknown>
carries.__MOUNT_RESULT = result
carries.__MOUNT_DONE = false

setTimeout(() => {
  result.waiting = Boolean(document.querySelector('.editor-loading'))
  listeners.forEach((listener) => {
    try { listener(task) } catch (error) { errors.push('threw on the task: ' + String(error)) }
  })
  // Long enough for the effects the arrival starts — a probe, a resolution, a layout — to have run
  // and for anything they threw to have been reported.
  setTimeout(() => {
    result.rendered = {
      header: Boolean(document.querySelector('.editor-header')),
      timeline: Boolean(document.querySelector('.timeline-lanes')),
      monitor: Boolean(document.querySelector('.editor-stage')),
      settings: Boolean(document.querySelector('.export-sidebar')),
      laneLabels: document.querySelectorAll('.timeline-lane-head').length,
      clips: document.querySelectorAll('.timeline-clip').length,
    }
    ;(window as unknown as Record<string, unknown>).__MOUNT_DONE = true
  }, 500)
}, 60)
