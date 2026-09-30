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

const result: { errors: string[]; waiting?: boolean; rendered?: unknown; audio?: unknown; stitch?: unknown; cover?: unknown; reentry?: unknown } = { errors }
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

/** What a dropdown is showing, and what it offers, read off the DOM the same way a reader would. */
const valueOf = (control: HTMLElement | null) => control?.querySelector('.editor-select-trigger')?.getAttribute('data-value') ?? null
const optionsOf = (control: HTMLElement | null) => control ? [...control.querySelectorAll('.editor-select-option')].map((option) => option.getAttribute('data-value')) : []

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

/** The speeds the monitor is watched at, which the wheel over it climbs. */
const speedSelect = () => document.querySelector('.transport-speed .editor-select') as HTMLElement | null

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
 * What it measures is the whole of this pass's claim, and it is read off real layout rather than a
 * stylesheet: that the rows OVERFLOW (so the drawer really does need the scrollbar it was given), that
 * the scroller holds the five-row cap, that the close button is clear of both the rows and the
 * scroller's own bar and stays on screen while the list moves, that a value field is a TEXT field (the
 * only kind that does not take the wheel for a stepper), and that the two retiming options come out
 * only where they mean something. The speed it sets to ask that last question is put back, so the
 * drawer leaves the draft as it found it and the jobs driven after this one are unaffected.
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
  const speedField = scroller.querySelector('input[aria-label="The speed this clip is played at"]') as HTMLInputElement | null
  // One question about the retiming options, asked at a speed where they mean something and then undone.
  const offered = () => ({
    interpolation: fieldLabels.some((label) => label.startsWith('INTERPOLATION')),
    maintainPitch: labelsOf('.inspector-scroll .editor-toggle').some((label) => label.startsWith('MAINTAIN AUDIO PITCH')),
  })
  const atOwnSpeed = offered()
  let atTwice = null
  let steppedUp: string | null = null
  let atCeiling: string | null = null
  let steppedPastCeiling: string | null = null
  if (speedField) {
    const speed = () => scroller.querySelector('input[aria-label="The speed this clip is played at"]') as HTMLInputElement | null
    const press = (key: string) => speed()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    setNativeValue(speedField, '2')
    await wait(80)
    const labels = [...scroller.querySelectorAll('.editor-field > span')].map((span) => (span.textContent ?? '').trim())
    atTwice = {
      interpolation: labels.some((label) => label.startsWith('INTERPOLATION')),
      maintainPitch: labelsOf('.inspector-scroll .editor-toggle').some((label) => label.startsWith('MAINTAIN AUDIO PITCH')),
    }
    // The arrow keys stand in for the stepper a text field no longer has, so they are read here: one step
    // of `step`, and a press at the ceiling leaving the figure where it is rather than running past it.
    press('ArrowUp')
    await wait(80)
    steppedUp = speed()?.value ?? null
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
    // Every value field is a text field, which is the guarantee the wheel needed. The read-only stamps
    // (the FPS one) are left out: there is no figure to step in them, so no stepper to take a wheel.
    valueFieldTypes: ([...scroller.querySelectorAll('input:not([readonly])')] as HTMLInputElement[]).map((input) => `${input.type}/${input.inputMode}`),
    atOwnSpeed,
    atTwice,
    steppedUp,
    atCeiling,
    steppedPastCeiling,
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
    // WHAT THE TRANSPORT SAYS. Two halves of one question: the state has to be stated somewhere — the readout
    // under the monitor — and it must NOT be said a second time by a pause glyph among the buttons. The rate
    // readout is read as its own text so that an idle transport saying NOTHING is what is asserted.
    transport: {
      state: document.querySelector('.transport-state')?.textContent ?? null,
      rate: document.querySelector('.transport-rate')?.textContent ?? null,
      speeds: optionsOf(speedSelect()),
    },
  }

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
  result.cover = {
    gate: {
      containerKind: outputKind(coverTask.preset.container as never),
      visuals: coverTask.sourcePaths.map(mediaKind),
      takesArt: outputTakesArt(coverTask.preset.container as never),
    },
    audioToggles: labelsOf('.editor-toggle'),
    pictureSource: pictureSourceSelect() ? 'drawn' : null,
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

  ;(window as unknown as Record<string, unknown>).__MOUNT_DONE = true
}

void drive().catch((error) => { errors.push('the drive threw: ' + String(error)); ;(window as unknown as Record<string, unknown>).__MOUNT_DONE = true })
