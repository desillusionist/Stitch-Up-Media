import React from 'react'
import { createRoot } from 'react-dom/client'
import { EditJobApp } from '../src/components/EditJobApp'
import { mediaKind } from '../src/lib/mediaKind'
import { outputKind, outputTakesArt } from '../src/lib/outputKind'
import { MAX_CLIP_SPEED } from '../src/lib/clipSpeed'

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
/**
 * The job the main process is holding, which is what a PULL from the window returns.
 *
 * The editor subscribes to a push, and the real main process also sends the job once on load — but that send
 * races the subscription, which is the fault under test. So the stub answers `getEditJobTask` as well, and the
 * drive proves the pull carries a re-entry on its own. `heldTask` is what the pull answers with.
 */
let heldTask: unknown = null
/** How many times the window has pulled the job, which is what says the pull is wired at all. */
let pullCalls = 0
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
  // The pull half of the handshake: the job the main process is holding, which is what a re-created (or
  // re-focused) window asks for rather than waiting to be pushed to.
  getEditJobTask: async () => { pullCalls += 1; return heldTask },
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

const result: { errors: string[]; waiting?: boolean; rendered?: unknown; audio?: unknown; stitch?: unknown; cover?: unknown; reentry?: unknown; imageOutput?: unknown; depth?: unknown } = { errors }
const carries = window as unknown as Record<string, unknown>
carries.__MOUNT_RESULT = result
carries.__MOUNT_DONE = false

/** The label text of every settings field or toggle on screen, which is what "did it render" means. */
const labelsOf = (selector: string) => [...document.querySelectorAll(selector)].map((element) => element.querySelector('span')?.textContent?.trim() ?? '')

/** The settings field a label belongs to, found by its name rather than by position. */
const fieldFor = (label: string) => [...document.querySelectorAll('.editor-field')]
  .find((field) => (field.querySelector('span')?.textContent ?? '').startsWith(label)) ?? null

/** The window's own dropdown inside a field: the control that replaced every platform `<select>` in it. */
const selectIn = (label: string) => fieldFor(label)?.querySelector('.editor-select') as HTMLElement | null

/** What a plain reading of the sidebar says, by its label — the row the codec select replaced, for one. */
const rowValue = (label: string) => ([...document.querySelectorAll('.editor-row')] as HTMLElement[])
  .find((row) => row.querySelector('span')?.textContent?.trim() === label)?.querySelector('strong')?.textContent?.trim() ?? null

/**
 * The stream toggles as they stand: what each is showing and whether it can be moved.
 *
 * The FORMAT decides what a job's two streams can be — a sound-only container writes no picture, a
 * picture-only one writes no sound, and a container that carries a stream always writes it — so the
 * interesting reading is the CHECKED and DISABLED pair rather than the label.
 */
const toggleStates = () => Object.fromEntries(([...document.querySelectorAll('.editor-toggle')] as HTMLElement[]).map((element) => {
  const input = element.querySelector('input')
  return [(element.querySelector('span')?.textContent ?? '').trim(), { checked: Boolean(input?.checked), disabled: Boolean(input?.disabled) }]
}))

/** What a dropdown is showing, and what it offers, read off the DOM the same way a reader would. */
const valueOf = (control: HTMLElement | null) => control?.querySelector('.editor-select-trigger')?.getAttribute('data-value') ?? null
const optionsOf = (control: HTMLElement | null) => control ? [...control.querySelectorAll('.editor-select-option')].map((option) => option.getAttribute('data-value')) : []

/** Whether a labelled control is drawn disabled — the reading that says a setting can be set at all. */
const fieldDisabled = (label: string) => {
  const field = fieldFor(label)
  return Boolean(field?.querySelector('.editor-select-trigger')?.hasAttribute('disabled') || field?.querySelector('input')?.hasAttribute('disabled'))
}

/** Choosing an option the way a user does: pressing the entry itself, so React sees the change. */
const chooseOption = (control: HTMLElement | null, value: string) => {
  const option = [...(control?.querySelectorAll('.editor-select-option') ?? [])].find((candidate) => candidate.getAttribute('data-value') === value) as HTMLButtonElement | undefined
  option?.click()
}

/** The TEMPLATE control, found by the option only it offers rather than by position. */
const templateSelect = () => [...document.querySelectorAll('.editor-select')]
  .find((control) => [...control.querySelectorAll('.editor-select-option')].some((option) => option.getAttribute('data-value') === 'eq')) as HTMLElement | undefined

/** The PICTURE SOURCE control, found by the label the window gives it rather than by position. */
const pictureSourceSelect = () => selectIn('PICTURE SOURCE')

/** And the BACKGROUND one, which is the choice that grew a third option in this pass. */
const backgroundSelect = () => selectIn('BACKGROUND')

/** The AUDIO tab's channel count, which is the one audio setting about the stream's SHAPE. */
const channelsSelect = () => selectIn('CHANNELS')

/** The AUDIO tab's bitrate, which is a rung of a ladder rather than a free field. */
const bitrateSelect = () => selectIn('BITRATE')

/** The bitrate's own typed field, which only appears once CUSTOM is chosen. */
const bitrateCustomField = () => fieldFor('BITRATE')?.querySelector('.field-pair input[type="text"]') as HTMLInputElement | null

/** The drawing's colour swatch: the compact square that opens the system picker. */
const colourSwatch = () => fieldFor('COLOUR')?.querySelector('.editor-swatch') as HTMLButtonElement | null

/** The waveform templates' WAVEFORMS count. */
const waveformsSelect = () => selectIn('WAVEFORMS')

/** Whether the preview speed dropdown under the monitor is still drawn — a control this pass removed. */
const speedSelector = () => Boolean(document.querySelector('.transport-speed'))

/** One of the two stream toggles in EXPORT SETTINGS, found by its label rather than by position. */
const toggleInput = (label: string) => ([...document.querySelectorAll('.editor-toggle')] as HTMLElement[])
  .find((element) => (element.querySelector('span')?.textContent ?? '').trim() === label)?.querySelector('input') as HTMLInputElement | null

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

/**
 * The PROPERTIES drawer, opened the way a reader opens it: a right-click on a clip, then the menu item.
 *
 * What it measures is the whole of what this pass claims, and it is read off real layout and real events
 * rather than off the stylesheet: that the rows OVERFLOW (so the drawer really does need the scrollbar it
 * was given), that the scroller holds the five-row cap, that the close button is clear of both the rows
 * and the scroller's own bar and stays on screen while the list moves, that the four figures of the
 * clip's own run are drawn, that the DURATION readout is a timecode with the share of the source beside
 * it, that a WHEEL over a value field moves the figure and cancels the event so the drawer does not
 * scroll, that the arrow keys do the same, that the bounds are a real stop, and that the two retiming
 * options come out only where they mean something. The speed it sets to ask those questions is put back,
 * so the drawer leaves the draft as it found it and the jobs driven after this one are unaffected.
 */
const setNativeValue = (field: HTMLInputElement, next: string) => {
  // The native setter, so React's own value tracking sees the change and fires onChange.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(field, next)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

const measureInspector = async () => {
  const box = document.querySelector('.media-inspector') as HTMLElement | null
  const scroller = document.querySelector('.inspector-scroll') as HTMLElement | null
  const close = document.querySelector('.inspector-close') as HTMLElement | null
  if (!box || !scroller || !close) return { opened: false }
  const row = parseFloat(getComputedStyle(box).getPropertyValue('--inspector-row')) || 0
  const rows = scroller.querySelectorAll('.editor-row, .editor-field, .editor-toggle').length
  const closeRect = close.getBoundingClientRect()
  const overlaps = (other: DOMRect) => !(closeRect.right <= other.left || closeRect.left >= other.right || closeRect.bottom <= other.top || closeRect.top >= other.bottom)
  const closeVisible = () => closeRect.bottom <= box.getBoundingClientRect().bottom + 0.5
  const beforeScroll = closeVisible()
  scroller.scrollTop = scroller.scrollHeight
  const afterScroll = closeVisible()
  scroller.scrollTop = 0
  const controls = [...scroller.querySelectorAll('input, .editor-select-trigger')] as HTMLElement[]
  const overlapsAControl = controls.some((control) => overlaps(control.getBoundingClientRect()))
  const fieldLabels = [...scroller.querySelectorAll('.editor-field > span')].map((span) => (span.textContent ?? '').trim())
  /** The pane's plain readings, by their label: the four figures of the clip's run are read this way. */
  const readings = Object.fromEntries(([...scroller.querySelectorAll('.editor-row')] as HTMLElement[])
    .map((element) => [element.querySelector('span')?.textContent?.trim() ?? '', element.querySelector('strong')?.textContent?.trim() ?? '']))
  /** The hint a field carries, which is where the reading beside a figure lives. */
  const hintOf = (label: string) => ([...scroller.querySelectorAll('.editor-field')] as HTMLElement[])
    .find((field) => (field.querySelector('span')?.textContent ?? '').startsWith(label))
    ?.querySelector('em')?.textContent?.trim() ?? null
  /** The figure a field is showing, which for the length is a timecode rather than a number. */
  const fieldValueOf = (label: string) => ([...scroller.querySelectorAll('.editor-field')] as HTMLElement[])
    .find((field) => (field.querySelector('span')?.textContent ?? '').startsWith(label))
    ?.querySelector('input') as HTMLInputElement | null
  /** How many fields are offering a way back to what an untouched job has. */
  const resets = () => scroller.querySelectorAll('.field-reset').length
  const speedField = scroller.querySelector('input[aria-label="The speed this clip is played at"]') as HTMLInputElement | null
  // One question about the retiming options, asked at a speed where they mean something and then undone.
  const offered = () => ({
    interpolation: fieldLabels.some((label) => label.startsWith('INTERPOLATION')),
    maintainPitch: labelsOf('.inspector-scroll .editor-toggle').some((label) => label.startsWith('MAINTAIN AUDIO PITCH')),
  })
  const atOwnSpeed = offered()
  const durationAtOwnSpeed = fieldValueOf('DURATION')?.value ?? null
  const durationHintAtOwnSpeed = hintOf('DURATION')
  const resetsAtOwnSpeed = resets()
  let atTwice = null
  let wheelSteppedTo: string | null = null
  let wheelCancelled: boolean | null = null
  let arrowSteppedTo: string | null = null
  let arrowCancelled: boolean | null = null
  let atCeiling: string | null = null
  let steppedPastCeiling: string | null = null
  let durationAtTwice: string | null = null
  let durationHintAtTwice: string | null = null
  let resetsAtTwice = 0
  let fieldType: string | null = null
  let durationWheelFrom: string | null = null
  let durationWheelTo: string | null = null
  let durationWheelCancelled: boolean | null = null
  let durationArrowTo: string | null = null
  let durationArrowCancelled: boolean | null = null
  let durationTypedHeld: string | null = null
  let speedWhileTyped: string | null = null
  let typingHeldTheFigure: boolean | null = null
  let durationTypedCommitted: string | null = null
  let speedAfterEnter: string | null = null
  let durationAfterRefusal: string | null = null
  if (speedField) {
    const speed = () => scroller.querySelector('input[aria-label="The speed this clip is played at"]') as HTMLInputElement | null
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      speed()?.dispatchEvent(event)
      return event.defaultPrevented
    }
    setNativeValue(speedField, '2')
    await wait(80)
    fieldType = speed()?.type ?? null
    const labels = [...scroller.querySelectorAll('.editor-field > span')].map((span) => (span.textContent ?? '').trim())
    atTwice = {
      interpolation: labels.some((label) => label.startsWith('INTERPOLATION')),
      maintainPitch: labelsOf('.inspector-scroll .editor-toggle').some((label) => label.startsWith('MAINTAIN AUDIO PITCH')),
    }
    durationAtTwice = fieldValueOf('DURATION')?.value ?? null
    durationHintAtTwice = hintOf('DURATION')
    resetsAtTwice = resets()
    // THE WHEEL. One notch is one step, and the event has to come back CANCELLED — that is what stops the
    // drawer scrolling out from under the field the reader was aiming at. The event is a PIXEL one
    // (deltaMode 0) for the reason the bug existed: a real wheel on this platform reports pixels rather
    // than lines, and the divisor that turned a notch into a whole step was wrong by a factor of thirty-
    // odd. A three-pixel notch is the smallest this can be dispatched as and still be one notch, and the
    // assertion below is what says the divisor answers it with exactly one step.
    const wheelEvent = new WheelEvent('wheel', { deltaY: -3, deltaMode: 0, bubbles: true, cancelable: true })
    speed()?.dispatchEvent(wheelEvent)
    wheelCancelled = wheelEvent.defaultPrevented
    await wait(80)
    wheelSteppedTo = speed()?.value ?? null
    // The arrow keys are the platform's own stepping, kept and made to stop at the bounds.
    arrowCancelled = press('ArrowUp')
    await wait(80)
    arrowSteppedTo = speed()?.value ?? null
    // AND THE DURATION FIELD'S OWN TWO GESTURES, which is the field the report was about. A timecode
    // field is the one whose wheel and arrow keys have to move a FIGURE rather than a digit, and the
    // wheel must come back cancelled so the drawer does not scroll out from under it. This wheel is a
    // LINE one (deltaMode 1), so the two fields between them exercise both unit paths.
    const durationInput = () => scroller.querySelector('input[aria-label="The length this clip occupies on the timeline"]') as HTMLInputElement | null
    durationWheelFrom = durationInput()?.value ?? null
    const durationWheel = new WheelEvent('wheel', { deltaY: -1, deltaMode: 1, bubbles: true, cancelable: true })
    durationInput()?.dispatchEvent(durationWheel)
    durationWheelCancelled = durationWheel.defaultPrevented
    await wait(80)
    durationWheelTo = durationInput()?.value ?? null
    const durationArrow = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    durationInput()?.dispatchEvent(durationArrow)
    durationArrowCancelled = durationArrow.defaultPrevented
    await wait(80)
    durationArrowTo = durationInput()?.value ?? null
    // AND A TYPED FIGURE IS HELD UNTIL IT IS CONFIRMED. A timecode is typed as a whole rather than built up
    // a digit at a time, so nothing is applied until Enter — and a figure that is not a timecode is refused
    // rather than run, with the field falling back to the value it had.
    const typeInto = (value: string) => { const field = durationInput(); if (field) setNativeValue(field, value) }
    const speedBeforeTyping = speed()?.value ?? null
    typeInto('00:00:04.00')
    await wait(80)
    durationTypedHeld = durationInput()?.value ?? null
    speedWhileTyped = speed()?.value ?? null
    // Whether typing moved the figure at all, which is the question — the speed it was on is whatever the
    // two gestures above left it at.
    typingHeldTheFigure = speedWhileTyped === speedBeforeTyping
    durationInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await wait(120)
    durationTypedCommitted = durationInput()?.value ?? null
    speedAfterEnter = speed()?.value ?? null
    typeInto('nonsense')
    durationInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await wait(120)
    durationAfterRefusal = durationInput()?.value ?? null
    setNativeValue(speed() ?? speedField, String(MAX_CLIP_SPEED * 99))
    await wait(80)
    // Left, so the figure the caller clamped is what the field shows rather than the digits just typed:
    // a value field keeps an entry's own text while it is being typed, clamp and all.
    speed()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await wait(80)
    atCeiling = speed()?.value ?? null
    press('ArrowUp')
    await wait(80)
    steppedPastCeiling = speed()?.value ?? null
    setNativeValue(speed() ?? speedField, '1')
    await wait(80)
  }
  ;(close as HTMLButtonElement).click()
  return {
    opened: true,
    rows,
    cap: 5 * row,
    clientHeight: scroller.clientHeight,
    scrollHeight: scroller.scrollHeight,
    overflowY: getComputedStyle(scroller).overflowY,
    closeOutsideScroller: !scroller.contains(close),
    closeAboveScroller: closeRect.bottom <= scroller.getBoundingClientRect().top + 0.5,
    closeOverlapsAControl: overlapsAControl,
    closeVisible: beforeScroll,
    closeVisibleAfterScroll: afterScroll,
    readings,
    durationAtOwnSpeed,
    durationHintAtOwnSpeed,
    durationAtTwice,
    durationHintAtTwice,
    resetsAtOwnSpeed,
    resetsAtTwice,
    fieldType,
    atOwnSpeed,
    atTwice,
    wheelSteppedTo,
    wheelCancelled,
    arrowSteppedTo,
    arrowCancelled,
    atCeiling,
    steppedPastCeiling,
    durationWheelFrom,
    durationWheelTo,
    durationWheelCancelled,
    durationArrowTo,
    durationArrowCancelled,
    durationTypedHeld,
    speedWhileTyped,
    typingHeldTheFigure,
    durationTypedCommitted,
    speedAfterEnter,
    durationAfterRefusal,
  }
}

const openInspector = async () => {
  const clip = document.querySelector('.timeline-clip') as HTMLElement | null
  if (!clip) return { opened: false, reason: 'no clip to right-click' }
  clip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
  await wait(80)
  const item = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'PROPERTIES') as HTMLButtonElement | undefined
  if (!item) return { opened: false, reason: 'the clip menu offered no PROPERTIES item' }
  item.click()
  await wait(120)
  return measureInspector()
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Handing the window a job, which is how a task arrives in the real app too. */
const arrive = (job: unknown, what: string) => {
  heldTask = job
  listeners.forEach((listener) => {
    try { listener(job) } catch (error) {
      errors.push(`threw on the ${what} job: ` + String(error))
    }
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
    // THEMED DROPDOWNS. The window must offer no platform <select> at all: its open list is drawn by the OS
    // and cannot be themed, which is what put the system's blue highlight under a themed border. The count is
    // the whole of the fix, so it is read as a count.
    nativeSelects: document.querySelectorAll('select').length,
    dropdowns: document.querySelectorAll('.editor-select').length,
    // What the two stream toggles say for a MOVIE container, which is where both of them are choosable.
    toggles: toggleStates(),
    // THE PRESET LIST, which belongs to the FORMAT. Read off the DOM the way a reader sees it: the codec
    // select that replaced VIDEO CODEC, what it is offering for this job's container, and the preset
    // NAME the row beside it now carries — the two cannot both be called PRESET.
    preset: {
      value: valueOf(selectIn('PRESET')),
      options: optionsOf(selectIn('PRESET')),
      name: rowValue('PRESET NAME'),
      videoCodecField: Boolean(fieldFor('VIDEO CODEC')),
      container: valueOf(selectIn('FORMAT')),
    },
    // WHAT THE TRANSPORT SAYS. Two halves of one question: the state has to be stated somewhere — the readout
    // under the monitor — and it must NOT be said a second time by a pause glyph among the buttons. The rate
    // readout is read as its own text so that an idle transport saying NOTHING is what is asserted.
    transport: {
      state: document.querySelector('.transport-state')?.textContent ?? null,
      rate: document.querySelector('.transport-rate')?.textContent ?? null,
      // The speed dropdown beside the transport was chosen here until this pass. It must now be GONE:
      // the wheel over the monitor still steps the rate, and the readout on the line above is where the
      // figure is, so a second control for it was a duplicate of what the transport already owned.
      speedSelector: speedSelector(),
    },
    // THE SUMMARY'S OWN LINE, which is where the size estimate is read. A movie job must not answer
    // UNKNOWN: its picture is a CRF delivery codec, which is bracketed rather than unknown.
    summary: document.querySelector('.export-summary')?.textContent ?? null,
  }

  // THE ONE-STREAM RULE. A file with neither a picture nor a sound in it is nothing, so unchecking one
  // toggle has to force the other back on and then LOCK it: the picture off makes the job sound-only,
  // and the sound then cannot be switched off as well. Driven here rather than asserted off the initial
  // render, because the rule is about what a CLICK does. The picture is put back afterwards so the jobs
  // driven below arrive into the draft this one left as it found it.
  const videoToggle = toggleInput('EXPORT VIDEO')
  let afterVideoOff: ReturnType<typeof toggleStates> | null = null
  if (videoToggle && !videoToggle.disabled) {
    videoToggle.click()
    await wait(120)
    afterVideoOff = toggleStates()
    const restore = toggleInput('EXPORT VIDEO')
    if (restore && !restore.disabled) restore.click()
    await wait(120)
  }
  result.rendered = { ...(result.rendered as object), afterVideoOff }

  // The lone-sound job. The container the window is on is read BEFORE switching tabs, because the tab
  // switch unmounts the FORMAT field that shows it.
  arrive(audioTask, 'audio')
  await wait(400)
  const containerShown = valueOf(document.querySelector('.export-content .editor-field .editor-select') as HTMLElement | null)
  clickTab('AUDIO')
  await wait(120)
  const soundSelect = pictureSourceSelect()
  const pictureSource = soundSelect ? { value: valueOf(soundSelect), options: optionsOf(soundSelect) } : null
  const bitrate = bitrateSelect()
  if (soundSelect) chooseOption(soundSelect, 'visualization')
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
    // The ROWS, which are a different shape: the source's own facts are one, and TRACKS is the other.
    audioRows: labelsOf('.editor-row'),
    audioToggles: labelsOf('.editor-toggle'),
    channels: channelsSelect() ? { value: valueOf(channelsSelect()), options: optionsOf(channelsSelect()) } : null,
    pictureSource,
    background: background ? optionsOf(background) : null,
    drawnFields: soundSelect ? labelsOf('.editor-field') : null,
    // The toggles the drawing brings with it, which are the one control that is not a FIELD: the progress
    // line, which only a picture takes, and the waveform's own count — which is a field, and read as one below.
    drawnToggles: soundSelect ? labelsOf('.editor-toggle') : null,
    // The colour SWATCH, which is what the theme's own green is read off: a job that has named no colour has to
    // show the colour it will be drawn in rather than an empty box, and the swatch is where that is visible.
    colourSwatch: colourSwatch()?.getAttribute('data-colour') ?? null,
    // The swatch is the window's own button and the picker is a hidden colour input behind it — not the wide
    // native colour box it used to be, which is what the tag and the hidden-input count settle.
    colourSwatchTag: colourSwatch()?.tagName ?? null,
    hiddenColourInputs: document.querySelectorAll('.editor-swatch-input').length,
    // The bitrate's own ladder, and the typed field that only CUSTOM brings out.
    bitrate: bitrate ? { value: valueOf(bitrate), options: optionsOf(bitrate) } : null,
    bitrateCustomFieldBefore: Boolean(bitrateCustomField()),
    waveforms: waveformsSelect() ? { value: valueOf(waveformsSelect()), options: optionsOf(waveformsSelect()) } : null,
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
  // An APPLY here, while the picture source is still the DRAWING: the patch is what the encoder is asked by, so
  // the history has to carry the drawing as well as the image chosen later — two answers, two applies.
  const firstApply = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY')
  ;(firstApply as HTMLButtonElement | undefined)?.click()
  await wait(150)

  // The EQ's own knobs. They are state the editor has to RENDER, and state without a control is exactly the
  // fault this harness exists to catch — so choosing the EQ has to bring its four controls out AND reach the
  // encoder as four figures, which the still request is where a window can be wrong on its own.
  const templates = templateSelect()
  if (templates) chooseOption(templates, 'eq')
  await wait(600)
  result.audio = {
    ...(result.audio as object),
    eqFields: templates ? labelsOf('.editor-field') : null,
    eqSegments: templates ? labelsOf('.editor-toggle') : null,
    eqStill: stillRequests.length ? stillRequests[stillRequests.length - 1] : null,
  }
  // The palette, which every template reads, and which is the one control that settles a colour the job may
  // not have named itself — so it has to be there for every template, not only the ones with a colour field.
  const themes = [...document.querySelectorAll('.editor-select')]
    .find((control) => [...control.querySelectorAll('.editor-select-option')].some((option) => option.getAttribute('data-value') === 'amber')) as HTMLElement | undefined
  result.audio = { ...(result.audio as object), themeOptions: themes ? [...themes.querySelectorAll('.editor-select-option')].map((option) => option.getAttribute('data-value')) : null }

  // The SCOPE, whose three knobs are its own and whose canvas is a SQUARE — the one drawing that is a
  // different shape inside the frame, so the one most likely to be drawn by a path of its own.
  if (templates) chooseOption(templates, 'scope')
  await wait(600)
  result.audio = {
    ...(result.audio as object),
    scopeFields: templates ? labelsOf('.editor-field') : null,
    // TRUE STEREO is a toggle rather than a field, and it is the one knob about the SOUND itself rather than
    // about the drawing of it.
    scopeToggles: templates ? labelsOf('.editor-toggle') : null,
    scopeStill: stillRequests.length ? stillRequests[stillRequests.length - 1] : null,
  }

  // And MIRRORED BARS, which is the same geometry as the EQ with the mirror applied to it: if the two did not
  // share their knobs, this is where the pair would come apart.
  if (templates) chooseOption(templates, 'mirrored-bars')
  await wait(600)
  result.audio = {
    ...(result.audio as object),
    mirrorFields: templates ? labelsOf('.editor-field') : null,
    mirrorToggles: templates ? labelsOf('.editor-toggle') : null,
    mirrorStill: stillRequests.length ? stillRequests[stillRequests.length - 1] : null,
  }

  // The three LED templates, which ARE the bars with settings of their own. Choosing one has to bring out the
  // knobs the family shares, the two the LED looks add — the peak hold and the block gap — and the template's
  // own density: the LED EQ opens at sixteen bars where the plain bars open at sixty-four, so a still asked for
  // at sixty-four would be a drawing nobody chose.
  if (templates) chooseOption(templates, 'led-eq')
  await wait(600)
  result.audio = {
    ...(result.audio as object),
    ledFields: templates ? labelsOf('.editor-field') : null,
    ledToggles: templates ? labelsOf('.editor-toggle') : null,
    ledStill: stillRequests.length ? stillRequests[stillRequests.length - 1] : null,
  }
  if (templates) chooseOption(templates, 'matrix-panel')
  await wait(600)
  result.audio = {
    ...(result.audio as object),
    panelStill: stillRequests.length ? stillRequests[stillRequests.length - 1] : null,
  }
  // The bitrate's CUSTOM rung, which has to bring its own field out: a ladder that offers a typed figure has to
  // have somewhere to type it.
  const chooseBitrate = bitrateSelect()
  if (chooseBitrate) chooseOption(chooseBitrate, 'custom')
  await wait(120)
  result.audio = { ...(result.audio as object), bitrateAfterCustom: valueOf(bitrateSelect()), bitrateCustomField: Boolean(bitrateCustomField()) }

  // And the picture a sound-only job can be GIVEN: choosing it has to bring the picker out, and picking has to
  // record the path the export will read. The stub picker answers with a path rather than opening a dialog, which
  // is the half of it a page can drive.
  const pictureForImage = pictureSourceSelect()
  if (pictureForImage) chooseOption(pictureForImage, 'custom')
  await wait(120)
  const pickButton = [...document.querySelectorAll('.editor-pick')].find((button) => button.textContent?.includes('CHOOSE')) as HTMLButtonElement | undefined
  pickButton?.click()
  await wait(200)
  result.audio = {
    ...(result.audio as object),
    pictureImageRow: labelsOf('.editor-row').find((label) => label.startsWith('IMAGE')) ?? null,
    pictureImageName: pickButton?.textContent ?? null,
  }

  // The output channel count, chosen the way a user chooses it, so the patch proves the control reaches the
  // encoder rather than merely rendering. A stereo source asked for MONO is the case the encoder harness
  // reads off the finished file; this is the half a window can be wrong about on its own.
  const channels = channelsSelect()
  if (channels) chooseOption(channels, '1')
  await wait(120)
  result.audio = { ...(result.audio as object), channelsAfterChoosing: valueOf(channelsSelect()) }

  // What the choice becomes: the patch the window hands the queue, which is where the drawing has to
  // arrive for the encoder to be asked for it at all. `check-tail` proves the encoder then draws; this is
  // the half a window can be wrong about on its own.
  await wait(150)
  const apply = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY')
  ;(apply as HTMLButtonElement | undefined)?.click()
  await wait(150)
  const patch = applied[applied.length - 1] as { preset?: { audioPicture?: string; audioChannels?: number; audioPictureImage?: string } } | undefined
  result.audio = {
    ...(result.audio as object),
    // What EACH patch said, as well as the last: the drive chooses the drawing and then an image of its own, so
    // both are proved by the history rather than by the last one alone.
    appliedPictures: applied.map((entry) => (entry as { preset?: { audioPicture?: string } })?.preset?.audioPicture ?? null),
    appliedPicture: patch?.preset?.audioPicture ?? null,
    appliedChannels: patch?.preset?.audioChannels ?? null,
    appliedPictureImage: patch?.preset?.audioPictureImage ?? null,
  }

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
    pictureSource: joinedSelect ? { value: valueOf(joinedSelect), options: optionsOf(joinedSelect) } : null,
    // The PROPERTIES drawer over a clip of this job, which is where the speed fields appear.
    inspector: await openInspector(),
  }

  // And the other side of the same gate: a still under a track, into a container that holds artwork
  // rather than frames. COVER ART belongs here and PICTURE SOURCE must not, which is the mirror of the
  // two sound-only jobs above.
  arrive(coverTask, 'cover')
  await wait(400)
  const coverAudioToggles = labelsOf('.editor-toggle')
  const coverPictureSource = pictureSourceSelect() ? 'drawn' : null
  // THE AUDIO-ONLY FORMAT is a SOUND export, so its sound settings have to be choosable: SAMPLE RATE,
  // BITRATE and CHANNELS were all drawn disabled for every audio-only container, which left the one
  // format that is nothing BUT sound with nothing to set.
  const coverAudioDisabled = { sampleRate: fieldDisabled('SAMPLE RATE'), bitrate: fieldDisabled('BITRATE'), channels: fieldDisabled('CHANNELS') }
  const coverSummary = document.querySelector('.export-summary')?.textContent ?? null
  // The EXPORT tab, which is where the two stream toggles live, and where THIS container's answer to
  // them is the one the report was about: an mp3 carries a sound and no picture at all.
  clickTab('EXPORT')
  await wait(120)
  result.cover = {
    gate: {
      containerKind: outputKind(coverTask.preset.container as never),
      visuals: coverTask.sourcePaths.map(mediaKind),
      takesArt: outputTakesArt(coverTask.preset.container as never),
    },
    audioToggles: coverAudioToggles,
    pictureSource: coverPictureSource,
    toggles: toggleStates(),
    audioDisabled: coverAudioDisabled,
    summary: coverSummary,
  }

  // RE-ENTRY, with NOTHING pushed. This is the half that closes the race a re-created window loses: the job
  // has moved in the queue, the window is focused again, and the pull is the only thing that can deliver it.
  // The task keeps its id and its shape (a multitrack maps one picture, so adding a source would change
  // nothing on screen) and changes its OUTPUT NAME instead — a figure the summary shows on every tab, so the
  // render has to show it and cannot do so by luck. `pulls` is asserted too, because a pull that is wired but
  // never called would pass this by an earlier push.
  const nameBefore = document.querySelector('.export-summary strong')?.textContent ?? null
  heldTask = { ...coverTask, outputFilename: 'pulled-by-focus.mp3' }
  window.dispatchEvent(new Event('focus'))
  await wait(400)
  result.reentry = {
    nameBefore,
    name: document.querySelector('.export-summary strong')?.textContent ?? null,
    pulls: pullCalls,
  }

  // THE IMAGE TAB, which is where the frame formats keep their own settings, and which this pass added.
  // Driven on the movie job, whose FORMAT is switched to GIF and then to PNG so both sides of the gate are
  // read: a movie container must offer NO IMAGE tab at all, and a frame container must offer one with its
  // own knobs and the output shape all three share.
  arrive(task, 'plain')
  await wait(400)
  clickTab('EXPORT')
  await wait(120)
  const tabNames = () => [...document.querySelectorAll('.export-tabs button')].map((button) => button.textContent?.trim())
  const tabsForMovie = tabNames()
  // A HEADING IS NOT A HANDLE FOR THE DROPDOWN BESIDE IT. A `<button>` is a LABELABLE element, so a click
  // anywhere on a field's own `<label>` forwards a synthetic click to the select's trigger and opens its
  // menu — which is not what clicking the NAME of a setting means. The heading's click is cancelled where
  // the field holds a select, and the trigger itself still opens it, so the control is not broken.
  const formatField = fieldFor('FORMAT')
  const menuOpen = () => Boolean(formatField?.querySelector('.editor-select-menu:not([hidden])'))
  ;(formatField?.querySelector('span') as HTMLElement | null)?.click()
  await wait(150)
  const headingOpened = menuOpen()
  ;(formatField?.querySelector('.editor-select-trigger') as HTMLElement | null)?.click()
  await wait(150)
  const triggerOpened = menuOpen()
  // Shut again, so the rest of the drive starts from a closed menu.
  if (menuOpen()) (formatField?.querySelector('.editor-select-trigger') as HTMLElement | null)?.click()
  await wait(120)
  const formatSelect = selectIn('FORMAT')
  // The FORMAT lives on the EXPORT tab and the tab switch UNMOUNTS it, so it is read and changed while
  // that tab is the one on screen — a reading taken from the IMAGE tab is a reading of nothing.
  if (formatSelect) chooseOption(formatSelect, 'gif')
  await wait(200)
  const containerAfterGif = valueOf(selectIn('FORMAT'))
  clickTab('IMAGE')
  await wait(150)
  const imageSelect = selectIn('IMAGE OUTPUT')
  const gifFields = labelsOf('.editor-field')
  const loopSelect = selectIn('LOOP')
  result.imageOutput = {
    container: containerAfterGif,
    tabsForMovie,
    tabsForGif: tabNames(),
    headingOpened,
    triggerOpened,
    drawn: Boolean(fieldFor('IMAGE OUTPUT')),
    options: optionsOf(imageSelect),
    value: valueOf(imageSelect),
    gifFields,
    loopOptions: optionsOf(loopSelect),
    loopValue: valueOf(loopSelect),
  }
  if (imageSelect) chooseOption(imageSelect, 'sequence')
  await wait(200)
  const afterSequence = valueOf(selectIn('IMAGE OUTPUT'))
  const loopDisabledForRun = Boolean(loopSelect?.querySelector('.editor-select-trigger')?.hasAttribute('disabled'))
  const applyImage = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY')
  ;(applyImage as HTMLButtonElement | undefined)?.click()
  await wait(200)
  const sentImage = applied[applied.length - 1] as { preset?: { imageOutputMode?: string; container?: string; gifMode?: string } } | undefined
  // The still-image container's own knobs, which the animated one does not carry.
  clickTab('EXPORT')
  await wait(120)
  const formatAgain = selectIn('FORMAT')
  if (formatAgain) chooseOption(formatAgain, 'png')
  await wait(200)
  const containerAfterPng = valueOf(selectIn('FORMAT'))
  clickTab('IMAGE')
  await wait(150)
  const pngFields = labelsOf('.editor-field')
  const compressionSelect = selectIn('COMPRESSION')
  const bitDepthSelect = selectIn('BIT DEPTH')
  const pngImageSelect = selectIn('IMAGE OUTPUT')
  const compressionOptions = optionsOf(compressionSelect)
  // What the change of container made of the run chosen for the GIF, read before anything else is touched.
  const imageBeforeApply = valueOf(pngImageSelect)
  if (pngImageSelect) chooseOption(pngImageSelect, 'still')
  await wait(150)
  const imageAfterStill = valueOf(selectIn('IMAGE OUTPUT'))
  // CUSTOM has to bring a field of its own out, and a figure typed into it has to be the figure sent.
  if (compressionSelect) chooseOption(compressionSelect, 'custom')
  await wait(150)
  const compressionCustomField = Boolean(fieldFor('COMPRESSION')?.querySelector('input'))
  const compressionInput = fieldFor('COMPRESSION')?.querySelector('input') as HTMLInputElement | null
  if (compressionInput) setNativeValue(compressionInput, '7')
  await wait(150)
  const compressionAfterTyping = valueOf(selectIn('COMPRESSION'))
  if (bitDepthSelect) chooseOption(bitDepthSelect, '16')
  await wait(150)
  const applyPng = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY')
  ;(applyPng as HTMLButtonElement | undefined)?.click()
  await wait(200)
  const sentPng = applied[applied.length - 1] as { preset?: { pngCompression?: number; imageBitDepth?: number; container?: string; stillFrameAt?: number; imageOutputMode?: string } } | undefined
  result.imageOutput = {
    ...(result.imageOutput as object),
    afterSequence,
    loopDisabledForRun,
    sentMode: sentImage?.preset?.imageOutputMode ?? null,
    sentContainer: sentImage?.preset?.container ?? null,
    sentLoop: sentImage?.preset?.gifMode ?? null,
    pngFields,
    compressionOptions,
    compressionCustomField,
    compressionAfterTyping,
    containerAfterPng,
    bitDepthOptions: optionsOf(bitDepthSelect),
    imageBeforeApply,
    imageAfterStill,
    sentContainer2: sentPng?.preset?.container ?? null,
    sentCompression: sentPng?.preset?.pngCompression ?? null,
    sentBitDepth: sentPng?.preset?.imageBitDepth ?? null,
    sentStillFrame: sentPng?.preset?.stillFrameAt ?? null,
  }

  // THE DEPTH CONTROL, which is derived for ProRes and chosen for H.264 and H.265. A movie container is
  // switched to first, then the codec, and the two readings are taken off the same field.
  clickTab('EXPORT')
  await wait(120)
  const toMovie = selectIn('FORMAT')
  if (toMovie) chooseOption(toMovie, 'mp4')
  await wait(200)
  const toH264 = selectIn('PRESET')
  if (toH264) chooseOption(toH264, 'h264')
  await wait(200)
  clickTab('VIDEO')
  await wait(150)
  const depthSelect = selectIn('DEPTH')
  const h264Depth = {
    drawn: Boolean(fieldFor('DEPTH')),
    options: optionsOf(depthSelect),
    value: valueOf(depthSelect),
    readOnly: Boolean(fieldFor('DEPTH')?.querySelector('input[readonly]')),
  }
  if (depthSelect) chooseOption(depthSelect, '10')
  await wait(150)
  const applyDepth = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY')
  ;(applyDepth as HTMLButtonElement | undefined)?.click()
  await wait(200)
  const sentDepth = (applied[applied.length - 1] as { preset?: { videoBitDepth?: number } } | undefined)?.preset?.videoBitDepth ?? null
  // And ProRes, whose depth its PROFILE decides: the same field becomes a reading rather than a control.
  clickTab('EXPORT')
  await wait(120)
  const toMov = selectIn('FORMAT')
  if (toMov) chooseOption(toMov, 'mov')
  await wait(200)
  const toProres = selectIn('PRESET')
  if (toProres) chooseOption(toProres, 'prores-4444xq')
  await wait(200)
  clickTab('VIDEO')
  await wait(150)
  const proresDepthField = fieldFor('DEPTH')
  result.depth = {
    h264: h264Depth,
    sentDepth,
    prores: {
      value: proresDepthField?.querySelector('input')?.value ?? null,
      readOnly: Boolean(proresDepthField?.querySelector('input[readonly]')),
      hasSelect: Boolean(proresDepthField?.querySelector('.editor-select')),
    },
    proresHint: proresDepthField?.querySelector('em')?.textContent?.trim() ?? null,
  }

  ;(window as unknown as Record<string, unknown>).__MOUNT_DONE = true
}

void drive().catch((error) => { errors.push('the drive threw: ' + String(error)); ;(window as unknown as Record<string, unknown>).__MOUNT_DONE = true })
