import React from 'react'
import { createRoot } from 'react-dom/client'
import { EditJobApp } from '../src/components/EditJobApp'
import { mediaKind } from '../src/lib/mediaKind'
import { outputKind, outputTakesArt } from '../src/lib/outputKind'

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
/** Every still the window has asked for, so a monitor that cannot PLAY a stubbed file is not mistaken for
 * one that was never asked to draw anything. */
const stillRequests: unknown[] = []
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
  // A sentinel rather than a real still: what is being checked is whether the MONITOR asks for one and
  // draws it, not what ffmpeg would put in it — `check-tail` and the still graph's own assertions are
  // what answer that.
  visualizationStill: async (options: unknown) => { stillRequests.push(options); return 'data:image/jpeg;base64,DRAWING-SENTINEL' },
  selectImage: async () => '/tmp/chosen.png',
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

/**
 * The job the OTHER conditional control is for: a still standing under a track, into a container that
 * can hold artwork. COVER ART and PICTURE SOURCE are opposite sides of the same question — a file that
 * holds a picture as a FRAME versus one that holds it as its FACE — so the report that both were missing
 * needs both asked. This job's container cannot hold a frame, so it must offer cover art and must NOT
 * offer a picture source; the sound-only jobs above are the mirror of exactly that.
 */
const coverTask = {
  id: 'mount-check-cover', type: 'multitrack', sourcePaths: ['/tmp/cover.png'],
  additionalAudioTracks: [{ id: 't1', path: '/tmp/track.wav', language: 'und' }],
  outputDirectory: '/tmp', outputFilename: 'out.mp3', status: 'pending', progress: 0,
  preset: { id: 'p', name: 'P', container: 'mp3', videoCodec: 'h264', audioCodec: 'mp3', resolution: '1080p' },
}

const host = document.createElement('div')
document.body.appendChild(host)
createRoot(host).render(React.createElement(EditJobApp))

const result: { errors: string[]; waiting?: boolean; rendered?: unknown; audio?: unknown; stitch?: unknown; cover?: unknown } = { errors }
const carries = window as unknown as Record<string, unknown>
carries.__MOUNT_RESULT = result
carries.__MOUNT_DONE = false

/** The label text of every settings field or toggle on screen, which is what "did it render" means. */
const labelsOf = (selector: string) => [...document.querySelectorAll(selector)].map((element) => element.querySelector('span')?.textContent?.trim() ?? '')

/** The TEMPLATE control, found by the option only it offers rather than by position. */
const templateSelect = () => [...document.querySelectorAll('select')]
  .find((select) => [...(select as HTMLSelectElement).options].some((option) => option.value === 'eq')) as HTMLSelectElement | undefined

/** The PICTURE SOURCE control, found by the label the window gives it rather than by position. */
const pictureSourceSelect = () => [...document.querySelectorAll('.editor-field')]
  .find((field) => (field.querySelector('span')?.textContent ?? '').startsWith('PICTURE SOURCE'))
  ?.querySelector('select') as HTMLSelectElement | null

/** And the BACKGROUND one, which is the choice that grew a third option in this pass. */
const backgroundSelect = () => [...document.querySelectorAll('.editor-field')]
  .find((field) => (field.querySelector('span')?.textContent ?? '').startsWith('BACKGROUND'))
  ?.querySelector('select') as HTMLSelectElement | null

/** Whether the monitor is drawing the still it was handed, found by the name the window gives it. */
const monitorDrawing = () => Boolean(document.querySelector('img[alt="DRAWING THE SOUND"]'))

/**
 * What the loaded stylesheet declares for a selector, or nothing where it carries no such rule.
 *
 * For the rules a stub environment cannot put on screen. The monitor's drawing never mounts here — the stub
 * media fails to decode, which the monitor answers with its own notice — so its LAYOUT cannot be measured,
 * while the rule that decides that layout is in the stylesheet either way and is what the fix consists of.
 */
const cssRule = (selector: string) => {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | undefined
    try { rules = sheet.cssRules } catch { continue }
    for (const rule of Array.from(rules ?? [])) {
      if (rule instanceof CSSStyleRule && rule.selectorText === selector) {
        return { selector: rule.selectorText, width: rule.style.width, height: rule.style.height, objectFit: rule.style.objectFit }
      }
    }
  }
  return null
}

const clickTab = (name: string) => {
  const button = [...document.querySelectorAll('.export-tabs button')].find((candidate) => candidate.textContent?.trim() === name)
  ;(button as HTMLButtonElement | undefined)?.click()
}

/** Choosing an option the way a user does, so React sees the change rather than a property assignment. */
const choose = (select: HTMLSelectElement, value: string) => {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Handing the window a job, which is how a task arrives in the real app too. */
const arrive = (job: unknown, what: string) => {
  listeners.forEach((listener) => {
    try { listener(job) } catch (error) { errors.push(`threw on the ${what} job: ` + String(error)) }
  })
}

/**
 * The drives, in order. Written as one awaited sequence rather than a nest of timers, because there are
 * four jobs to put through the window now and the depth of the nesting was becoming the harder thing to
 * read than the assertions it was feeding.
 */
const drive = async () => {
  await wait(60)
  result.waiting = Boolean(document.querySelector('.editor-loading'))
  arrive(task, 'plain')
  // Long enough for the effects the arrival starts — a probe, a resolution, a layout — to have run and
  // for anything they threw to have been reported.
  await wait(500)
  result.rendered = {
    header: Boolean(document.querySelector('.editor-header')),
    timeline: Boolean(document.querySelector('.timeline-lanes')),
    monitor: Boolean(document.querySelector('.editor-stage')),
    settings: Boolean(document.querySelector('.export-sidebar')),
    laneLabels: document.querySelectorAll('.timeline-lane-head').length,
    clips: document.querySelectorAll('.timeline-clip').length,
  }

  // The lone-sound job. The container the window is on is read BEFORE switching tabs, because the tab
  // switch unmounts the FORMAT field that shows it.
  arrive(audioTask, 'audio')
  await wait(400)
  const containerShown = (document.querySelector('.export-content .editor-field select') as HTMLSelectElement | null)?.value
  clickTab('AUDIO')
  await wait(120)
  const soundSelect = pictureSourceSelect()
  const pictureSource = soundSelect ? { value: soundSelect.value, options: [...soundSelect.options].map((option) => option.value) } : null
  if (soundSelect) choose(soundSelect, 'visualization')
  await wait(120)
  // The background control only exists once the picture source IS a drawing, so it is read after choosing.
  const background = backgroundSelect()
  result.audio = {
    gate: {
      containerShown,
      containerKind: outputKind(audioTask.preset.container as never),
      visuals: audioTask.sourcePaths.map(mediaKind),
    },
    audioFields: labelsOf('.editor-field'),
    audioToggles: labelsOf('.editor-toggle'),
    pictureSource,
    background: background ? [...background.options].map((option) => option.value) : null,
    drawnFields: soundSelect ? labelsOf('.editor-field') : null,
    // The toggles the drawing brings with it, which are the one control that is not a FIELD: the progress
    // line, which only a picture takes, and the waveform's own channel mirror.
    drawnToggles: soundSelect ? labelsOf('.editor-toggle') : null,
  }
  // What the monitor DID. The still is asked for over IPC and delayed, so this waits past the debounce;
  // the request itself is recorded too, because a monitor that could not play a stubbed file would
  // otherwise be indistinguishable from one that was never asked.
  await wait(600)
  result.audio = {
    ...(result.audio as object),
    monitorDrawing: monitorDrawing(),
    // The drawing's own scaling rule, read off the loaded stylesheet: see `cssRule` for why it is the rule
    // rather than the element that this harness can check.
    drawingRule: cssRule('.editor-still.is-drawing'),
    screen: document.querySelector('.editor-screen-message')?.textContent ?? null,
    stillAlts: [...document.querySelectorAll('.editor-still')].map((img) => img.getAttribute('alt')),
    // The request as it stood BEFORE the EQ was chosen, because the assertions about the drawing's own
    // settings are about the template that was chosen first and the last request on the list is the EQ's.
    drawingStill: stillRequests.length ? stillRequests[stillRequests.length - 1] : null,
    stillRequests,
  }
  // The EQ's own knobs. They are state the editor has to RENDER, and state without a control is exactly the
  // fault this harness exists to catch — so choosing the EQ has to bring its four controls out AND reach the
  // encoder as four figures, which the still request is where a window can be wrong on its own.
  const templates = templateSelect()
  if (templates) choose(templates, 'eq')
  await wait(600)
  result.audio = {
    ...(result.audio as object),
    eqFields: templates ? labelsOf('.editor-field') : null,
    eqSegments: templates ? labelsOf('.editor-toggle') : null,
    eqStill: stillRequests.length ? stillRequests[stillRequests.length - 1] : null,
  }
  // The palette, which every template reads, and which is the one control that settles a colour the job may
  // not have named itself — so it has to be there for every template, not only the ones with a colour field.
  const themes = [...document.querySelectorAll('select')]
    .find((select) => [...(select as HTMLSelectElement).options].some((option) => option.value === 'amber')) as HTMLSelectElement | undefined
  result.audio = { ...(result.audio as object), themeOptions: themes ? [...themes.options].map((option) => option.value) : null }

  // The SCOPE, whose three knobs are its own and whose canvas is a SQUARE — the one drawing that is a
  // different shape inside the frame, so the one most likely to be drawn by a path of its own.
  if (templates) choose(templates, 'scope')
  await wait(600)
  result.audio = {
    ...(result.audio as object),
    scopeFields: templates ? labelsOf('.editor-field') : null,
    scopeStill: stillRequests.length ? stillRequests[stillRequests.length - 1] : null,
  }

  // And MIRRORED BARS, which is the same geometry as the EQ with the mirror applied to it: if the two did not
  // share their knobs, this is where the pair would come apart.
  if (templates) choose(templates, 'mirrored-bars')
  await wait(600)
  result.audio = {
    ...(result.audio as object),
    mirrorFields: templates ? labelsOf('.editor-field') : null,
    mirrorToggles: templates ? labelsOf('.editor-toggle') : null,
    mirrorStill: stillRequests.length ? stillRequests[stillRequests.length - 1] : null,
  }
  // What the choice becomes: the patch the window hands the queue, which is where the drawing has to
  // arrive for the encoder to be asked for it at all. `check-tail` proves the encoder then draws; this is
  // the half a window can be wrong about on its own.
  await wait(150)
  const apply = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY')
  ;(apply as HTMLButtonElement | undefined)?.click()
  await wait(150)
  const patch = applied[applied.length - 1] as { preset?: { audioPicture?: string } } | undefined
  result.audio = { ...(result.audio as object), appliedPicture: patch?.preset?.audioPicture ?? null }

  // The JOINED job. The tab is already on AUDIO, so its picture settings are what is on screen once the
  // new draft has arrived.
  arrive(stitchTask, 'stitch')
  await wait(400)
  const joinedSelect = pictureSourceSelect()
  result.stitch = {
    gate: {
      containerKind: outputKind(stitchTask.preset.container as never),
      visuals: stitchTask.sourcePaths.map(mediaKind),
    },
    pictureSource: joinedSelect ? { value: joinedSelect.value, options: [...joinedSelect.options].map((option) => option.value) } : null,
  }

  // And the other side of the same gate: a still under a track, into a container that holds artwork
  // rather than frames. COVER ART belongs here and PICTURE SOURCE must not, which is the mirror of the
  // two sound-only jobs above.
  arrive(coverTask, 'cover')
  await wait(400)
  result.cover = {
    gate: {
      containerKind: outputKind(coverTask.preset.container as never),
      visuals: coverTask.sourcePaths.map(mediaKind),
      takesArt: outputTakesArt(coverTask.preset.container as never),
    },
    audioToggles: labelsOf('.editor-toggle'),
    pictureSource: pictureSourceSelect() ? 'drawn' : null,
  }

  ;(window as unknown as Record<string, unknown>).__MOUNT_DONE = true
}

void drive().catch((error) => { errors.push('the drive threw: ' + String(error)); ;(window as unknown as Record<string, unknown>).__MOUNT_DONE = true })
