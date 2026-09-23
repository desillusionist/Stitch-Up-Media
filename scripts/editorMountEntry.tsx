import React from 'react'
import { createRoot } from 'react-dom/client'
import { EditJobApp } from '../src/components/EditJobApp'
import { mediaKind } from '../src/lib/mediaKind'
import { outputKind } from '../src/lib/outputKind'

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
/** Every patch the window has sent, so the harness can read what a choice turned into. */
const applied: unknown[] = []
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
  applySourceTiming: noop, syncEditJobTask: noop, cancelEditJob: noop,
  rememberPreview: noop, openEditJob: noop, quickLook: noop, diagnosticLog: noop,
  applyEditJob: async (patch: unknown) => { applied.push(patch) },
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

/**
 * The job the picture settings are FOR: nothing but sound, exported into a container that carries a
 * picture. Its section is gated on exactly that, and a gate whose inputs are not what they look like is
 * how a section goes missing without anything being wrong with the render — so the harness reports both
 * the gate's own inputs and what the tab drew with them.
 */
const audioTask = {
  id: 'mount-check-audio', type: 'transcode', sourcePaths: ['/tmp/track.wav'],
  outputDirectory: '/tmp', outputFilename: 'out.mp4', status: 'pending', progress: 0,
  preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p' },
}

/**
 * The other job the drawing is for: a STITCH of sound files, which is not the same job at all — its
 * audio is a concatenation rather than a mix, so the encoder draws a different stream. A section that
 * renders for a lone track and goes missing for a joined one would be exactly the fault being reported
 * ("the engine works, the controls never showed"), so the joined shape is asked the same question.
 */
const stitchTask = {
  id: 'mount-check-stitch', type: 'stitch', sourcePaths: ['/tmp/one.wav', '/tmp/two.wav'],
  outputDirectory: '/tmp', outputFilename: 'out.mp4', status: 'pending', progress: 0,
  preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p' },
}

const host = document.createElement('div')
document.body.appendChild(host)
createRoot(host).render(React.createElement(EditJobApp))

const result: { errors: string[]; waiting?: boolean; rendered?: unknown; audio?: unknown; stitch?: unknown } = { errors }
const carries = window as unknown as Record<string, unknown>
carries.__MOUNT_RESULT = result
carries.__MOUNT_DONE = false

/** The label text of every settings field or toggle on screen, which is what "did it render" means. */
const labelsOf = (selector: string) => [...document.querySelectorAll(selector)].map((element) => element.querySelector('span')?.textContent?.trim() ?? '')

/** The PICTURE SOURCE control, found by the label the window gives it rather than by position. */
const pictureSourceSelect = () => [...document.querySelectorAll('.editor-field')]
  .find((field) => (field.querySelector('span')?.textContent ?? '').startsWith('PICTURE SOURCE'))
  ?.querySelector('select') as HTMLSelectElement | null

const clickTab = (name: string) => {
  const button = [...document.querySelectorAll('.export-tabs button')].find((candidate) => candidate.textContent?.trim() === name)
  ;(button as HTMLButtonElement | undefined)?.click()
}

/** Choosing an option the way a user does, so React sees the change rather than a property assignment. */
const choose = (select: HTMLSelectElement, value: string) => {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

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
    // The audio job, and the AUDIO tab its picture settings live on. The container the window is on is
    // read first, because switching tabs unmounts the FORMAT field that shows it.
    listeners.forEach((listener) => {
      try { listener(audioTask) } catch (error) { errors.push('threw on the audio task: ' + String(error)) }
    })
    setTimeout(() => {
      const containerShown = (document.querySelector('.export-content .editor-field select') as HTMLSelectElement | null)?.value
      clickTab('AUDIO')
      setTimeout(() => {
        const select = pictureSourceSelect()
        const pictureSource = select ? { value: select.value, options: [...select.options].map((option) => option.value) } : null
        if (select) choose(select, 'visualization')
        result.audio = {
          gate: {
            containerShown,
            containerKind: outputKind(audioTask.preset.container as never),
            visuals: audioTask.sourcePaths.map(mediaKind),
          },
          audioFields: labelsOf('.editor-field'),
          audioToggles: labelsOf('.editor-toggle'),
          pictureSource,
          drawnFields: select ? labelsOf('.editor-field') : null,
        }
        // And what the choice becomes: the patch the window hands the queue, which is where the drawing
        // has to arrive for the encoder to be asked for it at all. `check-tail` is what proves the encoder
        // then draws; this is the half a window can be wrong about on its own.
        setTimeout(() => {
          const apply = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY')
          ;(apply as HTMLButtonElement | undefined)?.click()
          setTimeout(() => {
            const patch = applied[applied.length - 1] as { preset?: { audioPicture?: string } } | undefined
            result.audio = { ...(result.audio as object), appliedPicture: patch?.preset?.audioPicture ?? null }
            // Now the JOINED job asks the same question. The tab is already on AUDIO, so its picture
            // settings are the ones on screen once the new job's draft has arrived.
            listeners.forEach((listener) => {
              try { listener(stitchTask) } catch (error) { errors.push('threw on the stitch task: ' + String(error)) }
            })
            setTimeout(() => {
              const joined = pictureSourceSelect()
              result.stitch = {
                gate: {
                  containerKind: outputKind(stitchTask.preset.container as never),
                  visuals: stitchTask.sourcePaths.map(mediaKind),
                },
                pictureSource: joined ? { value: joined.value, options: [...joined.options].map((option) => option.value) } : null,
              }
              ;(window as unknown as Record<string, unknown>).__MOUNT_DONE = true
            }, 400)
          }, 150)
        }, 150)
      }, 120)
    }, 400)
  }, 500)
}, 60)
