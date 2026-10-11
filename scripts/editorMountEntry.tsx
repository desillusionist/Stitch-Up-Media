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
const savedSettings: unknown[] = []
/** What the next file picker answers with, so a drive can add an AUDIO file rather than the video fixture. */
let nextSelection: string[] | null = null
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
  probeMedia: async (path: string) => (/[.](png|jpe?g|gif|tiff?|bmp|webp|heic|heif|avif)$/i.test(String(path))
    ? { format: 'png', duration: 0, size: 0, bitrate: 0, videoStreams: [], audioStreams: [] }
    : {
      format: 'mp4', duration: 12, size: 0, bitrate: 0,
      videoStreams: [{ codec: 'h264', resolution: '1920x1080', fps: 25 }],
      audioStreams: [{ codec: 'aac', channels: 2, sampleRate: 48000 }],
    }),
  pathExists: async () => true,
  createImageSequencePreview: async () => null,
  framesAt: async () => [],
  waveformFor: async () => [],
  applySourceTiming: noop, syncEditJobTask: noop, cancelEditJob: noop, saveSettings: async (settings: unknown) => { savedSettings.push(settings) },
  rememberPreview: noop, openEditJob: noop, quickLook: noop, diagnosticLog: noop,
  applyEditJob: async (patch: unknown) => { applied.push(patch) },
  // The picker the [+] panel's ADD SOURCE opens. It answers with the same real clip, so an insert is a second
  // copy of it — a file the job already holds, which is the case a copy number has to get right.
  selectFiles: async () => nextSelection ?? [CLIP_FIXTURE],
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

/**
 * The real clip the harness generated, so the monitor's element actually decodes one and reports its size.
 *
 * Every video task points at it: a source that cannot be decoded latches the monitor's error and never
 * clears, because the element that would report a successful load is the very thing the error hides — so a
 * missing file anywhere in the drive would poison every reading after it. The framing the monitor draws is
 * measured against the picture the element loaded, and a repeated source is the case where it does not
 * reload; a stub element that never loads cannot tell that from a picture of unknown size.
 */
const CLIP_FIXTURE = (window as unknown as { __clipFixture?: string }).__clipFixture || '/tmp/clip.mp4'
/** A clip that CARRIES a soundtrack, for the embedded-audio controls, which a silent fixture cannot drive. */
const CLIP_AUDIO = (window as unknown as { __clipAudioFixture?: string }).__clipAudioFixture || '/tmp/clip-audio.mp4'
/** A plain sound file, for the per-clip LEVEL the inspector offers on an audio source. */
const SOUND_FIXTURE = (window as unknown as { __soundFixture?: string }).__soundFixture || '/tmp/sound.wav'

/** A job of the plainest kind, so the render has a timeline, a monitor and settings to draw. */
const task = {
  id: 'mount-check', type: 'transcode', sourcePaths: [CLIP_FIXTURE],
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

/**
 * A job whose visual source is a STILL IMAGE rather than a video, in a container that carries a picture.
 *
 * This is one of the two source kinds the SUMMARY's estimate was reported to have stopped recalculating
 * for: a picture is sized by the CODEC it is written as, so the figure has to move when FORMAT and PRESET
 * are recombined, exactly as a true video's does.
 */
const stillSourceTask = {
  id: 'mount-check-still-source', type: 'transcode', sourcePaths: ['/tmp/still.png'],
  outputDirectory: '/tmp', outputFilename: 'out.mp4', status: 'pending', progress: 0,
  preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p', videoBitrate: '8M' },
}

/** The other source kind the estimate was reported fixed for: a run of image frames read as a sequence. */
const sequenceSourceTask = {
  id: 'mount-check-sequence-source', type: 'transcode', sourcePaths: ['/tmp/frames/frame_0001.png'],
  outputDirectory: '/tmp', outputFilename: 'out.mp4', status: 'pending', progress: 0,
  preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p' },
  sequenceInput: {
    dir: '/tmp/frames', pattern: 'frame_%04d.png', globPattern: '*.png', startNumber: 1, frameCount: 120,
    hasGaps: false, missing: [], fps: 25, firstFrame: '/tmp/frames/frame_0001.png',
  },
}

/**
 * The SAME FILE twice, which is the job shape the clip menu's REMOVE got wrong.
 *
 * Two segments of one source, given trims of their own so the two clips can be told apart by their LENGTH:
 * the first runs five seconds and the second four. Removing the second has to leave the FIRST, and a removal
 * that takes the first one with that path instead leaves a four-second clip where a five-second one was.
 */
const duplicateTask = {
  id: 'mount-check-duplicate', type: 'stitch', sourcePaths: [CLIP_FIXTURE, CLIP_FIXTURE],
  outputDirectory: '/tmp', outputFilename: 'out.mp4', status: 'pending', progress: 0,
  preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p' },
  trimPoints: { [`${CLIP_FIXTURE}#0`]: { in: 0, out: 5 }, [`${CLIP_FIXTURE}#1`]: { in: 6, out: 10 } },
}

/**
 * A pair whose copy numbers are NOT one and two, so a list that falls out of step with its sources shows.
 *
 * Two copies numbered 2 and 3 (as if a third had been removed), and a third is added in the window — then the
 * queue pushes this two-source task back, which is the case that used to drop the window's numbers and leave
 * the third copy to fall back to its rank, where a copy already carried the figure it landed on.
 */
const pairTask = {
  id: 'mount-check-copy-pair', type: 'stitch', sourcePaths: [CLIP_FIXTURE, CLIP_FIXTURE],
  clipIds: ['pair-0', 'pair-1'], clipNumbers: [2, 3],
  outputDirectory: '/tmp', outputFilename: 'out.mp4', status: 'pending', progress: 0,
  preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p' },
  trimPoints: { 'pair-0': { in: 0, out: 5 }, 'pair-1': { in: 6, out: 10 } },
}

const host = document.createElement('div')
document.body.appendChild(host)
createRoot(host).render(React.createElement(EditJobApp))

const result: { errors: string[]; waiting?: unknown; rendered?: unknown; audio?: unknown; stitch?: unknown; cover?: unknown; reentry?: unknown; imageOutput?: unknown; depth?: unknown; videoToAudio?: unknown; scrub?: unknown; preview?: unknown; previewChrome?: unknown; zoomPanel?: unknown; stampEditor?: unknown; transportIcons?: unknown; scrubWheel?: unknown; imageSource?: unknown; imageSequence?: unknown; duplicate?: unknown; copyFraming?: unknown; timelineGestures?: unknown; timelineSourceCommands?: unknown; timelineDuplicate?: unknown; copyNumbers?: unknown; splitView?: unknown; audioLane?: unknown; quickLookMerge?: unknown; clipRepairs?: unknown; replaceBlank?: unknown; replaceSilence?: unknown; replaceMixed?: unknown; stampMenu?: unknown; modeChange?: unknown; emptyLane?: unknown; audioAsk?: unknown; soundStitchAdd?: unknown; trackDelete?: unknown; keepIt?: unknown; audioFadePreview?: unknown; clipMute?: unknown; comboMute?: unknown; videoAdd?: unknown; stitchMute?: unknown; seqMute?: unknown; comboMode?: unknown; trackOutput?: unknown; embeddedAudio?: unknown; soundLevel?: unknown; trackGain?: unknown; timelineGroups?: unknown; splitClip?: unknown; blankPreview?: unknown } = { errors }
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
        return {
          selector: rule.selectorText,
          width: rule.style.width,
          height: rule.style.height,
          objectFit: rule.style.objectFit,
          appearance: rule.style.getPropertyValue('-webkit-appearance') || rule.style.appearance,
          borderRadius: rule.style.borderRadius,
          background: rule.style.background,
        }
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
  // The clip's own RATE, and what reading it at another does to the length it occupies.
  let fpsHint: string | null = null
  let fpsOptions: (string | null)[] = []
  let fpsValueAtSource: string | null = null
  let fpsValueAfterRate: string | null = null
  let durationBeforeRate: string | null = null
  let durationAfterRate: string | null = null
  let durationAfterRateRestored: string | null = null
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

    // THE RATE THE CLIP'S FRAMES ARE READ AT, with the source's own beside it as the reference. ONE editable
    // figure, and a rate of the clip's own RETIMES it exactly as a speed does: the stubbed source is twelve
    // seconds at 25 fps, so read at 50 its frames run for six seconds of timeline.
    const fpsControl = ([...scroller.querySelectorAll('.editor-field')] as HTMLElement[])
      .find((field) => (field.querySelector('span')?.textContent ?? '').startsWith('FPS'))
      ?.querySelector('.editor-select') as HTMLElement | null
    fpsHint = hintOf('FPS')
    fpsOptions = optionsOf(fpsControl)
    fpsValueAtSource = valueOf(fpsControl)
    durationBeforeRate = durationInput()?.value ?? null
    chooseOption(fpsControl, '50/1')
    await wait(140)
    fpsValueAfterRate = valueOf(fpsControl)
    durationAfterRate = durationInput()?.value ?? null
    // Put it back to the source's own rate, so the drawer leaves the draft as it found it.
    chooseOption(fpsControl, '25/1')
    await wait(140)
    durationAfterRateRestored = durationInput()?.value ?? null
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
    fpsHint,
    fpsOptions,
    fpsValueAtSource,
    fpsValueAfterRate,
    durationBeforeRate,
    durationAfterRate,
    durationAfterRateRestored,
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
    // WHAT THE TRANSPORT SAYS, and where it says it. The block of detail that used to sit under the monitor —
    // the file's shape, the CLIP/TOTAL times and the transport's own state — is GONE, so the readout's absence
    // is what is asserted, and the state is now carried by the play/pause glyph alone: the button names itself
    // Pause while the monitor runs and Play at rest. The speed dropdown beside the transport must stay GONE too.
    transport: {
      readout: document.querySelector('.transport-state') === null,
      playLabel: document.querySelector('.transport button[aria-label="Play"], .transport button[aria-label="Pause"]')?.getAttribute('aria-label') ?? null,
      rate: document.querySelector('.transport-rate')?.textContent ?? null,
      speedSelector: speedSelector(),
    },
    // THE SUMMARY'S OWN LINE, which is where the size estimate is read. A movie job must not answer
    // UNKNOWN: its picture is a CRF delivery codec, which is bracketed rather than unknown.
    summary: document.querySelector('.export-summary')?.textContent ?? null,
  }
  // THE TRANSPORT'S GLYPHS. The four bracket-and-pipe tokens `[|<] [>] [>|] [||]` were text; they are drawn
  // SVG symbols now, so what is read is each button's own glyph and that no bracket-character survives in its
  // text. The middle button carries the PLAY symbol at rest and the PAUSE one while running.
  {
    const buttons = [...document.querySelectorAll('.transport button')]
    result.transportIcons = {
      count: buttons.length,
      glyphs: buttons.map((button) => button.querySelector('svg')?.getAttribute('data-glyph') ?? null),
      texts: buttons.map((button) => button.textContent ?? ''),
    }
  }

  // THE TRANSPORT'S SCRUBBER, which is drawn by the WINDOW rather than by the platform: an inset groove
  // with the played part in the accent and a thin rectangular handle, in the stylesheet's own terms.
  const scrub = document.querySelector('.transport-scrub') as HTMLElement | null
  result.scrub = {
    drawn: Boolean(scrub),
    played: scrub ? scrub.style.getPropertyValue('--played') : null,
    inputRule: cssRule('.transport-scrub'),
    trackRule: cssRule('.transport-scrub::-webkit-slider-runnable-track'),
    thumbRule: cssRule('.transport-scrub::-webkit-slider-thumb'),
  }

  // THE PREVIEW'S OWN HEADING, and the label drawn over the picture. The output frame's size belongs in the
  // panel's heading now, beside what the panel IS — `PREVIEW // ASSEMBLED OUTPUT (1920x1080)` — rather than in
  // a label drawn over the picture, where it covered the very picture it described. So the heading is read for
  // a bracketed pair and the frame is read for the absence of a label of its own.
  result.preview = {
    title: document.querySelector('.editor-preview .panel-kicker')?.textContent ?? null,
    frameLabel: Boolean(document.querySelector('.editor-frame b')),
  }
  // THE PREVIEW'S CHROME: the block of detail that used to sit under the monitor is gone, and the file's own
  // shape moved onto the clip it belongs to (`name • resolution • fps`). The zoom control is now an icon button
  // in the monitor's own bottom-left corner with the scale written beside it.
  result.previewChrome = {
    detailLines: document.querySelectorAll('.editor-preview small').length,
    clipName: document.querySelector('.timeline-clip-name')?.textContent ?? null,
    zoomInDock: Boolean(document.querySelector('.editor-screen .preview-zoom-dock')),
    zoomLabel: document.querySelector('.preview-zoom-label')?.textContent ?? null,
    zoomOptions: [...document.querySelectorAll('.preview-zoom-dock .editor-select-option')].map((node) => node.textContent ?? ''),
  }
  // THE GUTTER'S LIVE READOUT IS AN EDITABLE STAMP: a field that shows the skimmer's own position rather than a
  // static label. Read first as its tag and kind, and then — which is the whole of it — by whether typing the
  // window's OWN timecode into it and pressing ENTER actually moves the skimmer there.
  const stampInput = document.querySelector('.timeline-gutter-ruler input') as HTMLInputElement | null
  const scrubValue = () => Number((document.querySelector('.transport-scrub') as HTMLInputElement | null)?.value ?? -1)
  const stampBefore = scrubValue()
  if (stampInput) {
    // The native setter, because a plain assignment to a controlled input's `value` is swallowed by React.
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setValue?.call(stampInput, '00:00:04.00')
    stampInput.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(40)
    stampInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await wait(150)
  }
  result.stampEditor = {
    tag: document.querySelector('.timeline-gutter-ruler')?.firstElementChild?.tagName ?? null,
    kind: stampInput?.type ?? null,
    before: +stampBefore.toFixed(2),
    after: +scrubValue().toFixed(2),
    // ENTER confirms the figure AND leaves the field, so the caret must not still be in it.
    focusedAfterEnter: Boolean(stampInput) && document.activeElement === stampInput,
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

  // THE 5.1 LADDER IS OFFERED PER CODEC. MP3 is the one codec that refuses a 5.1 layout (measured), so
  // switching the sound to MP3 must take that entry OFF the CHANNELS list, and switching back must put it back
  // — an entry left on a list the codec cannot write is exactly the control-without-a-backing this checks for.
  const codecSelect = selectIn('CODEC')
  const channelsBefore = channelsSelect() ? optionsOf(channelsSelect()) : null
  chooseOption(codecSelect, 'mp3')
  await wait(140)
  const channelsUnderMp3 = channelsSelect() ? optionsOf(channelsSelect()) : null
  chooseOption(codecSelect, 'aac')
  await wait(140)
  const channelsBackOnAac = channelsSelect() ? optionsOf(channelsSelect()) : null
  result.audio = { ...(result.audio as object), channelsBefore, channelsUnderMp3, channelsBackOnAac }

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
  // And the field's own BOX — the padding and the dotted rule under it, which are the label's own edges
  // rather than the heading's text. Those edges are what a reader lands on when aiming at a divider.
  ;(formatField as HTMLElement | null)?.click()
  await wait(150)
  const dividerOpened = menuOpen()
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
    dividerOpened,
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
  // THE TIER HAS TO MOVE THE FIGURE. A reader changing the PNG's work setting is changing the size the
  // SUMMARY is showing, and a figure keyed to nothing but the frame would sit still while the control beside
  // it moved — which is what was reported.
  const summaryBeforeTier = document.querySelector('.export-summary')?.textContent ?? null
  if (compressionSelect) chooseOption(compressionSelect, '0')
  await wait(250)
  const summaryAtLevel0 = document.querySelector('.export-summary')?.textContent ?? null
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
    summaryBeforeTier,
    summaryAtLevel0,
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

  // AND THE JPEG'S OWN QUALITY MOVES ITS FIGURE TOO, which is the same report one codec along: the two ends
  // of a ladder that is several times apart have to read differently in the SUMMARY.
  clickTab('EXPORT')
  await wait(120)
  const toJpg = selectIn('FORMAT')
  if (toJpg) chooseOption(toJpg, 'jpg')
  await wait(200)
  clickTab('IMAGE')
  await wait(150)
  const qualitySelect = selectIn('QUALITY')
  const qualityOptions = optionsOf(qualitySelect)
  const jpgSummaryBefore = document.querySelector('.export-summary')?.textContent ?? null
  if (qualitySelect) chooseOption(qualitySelect, '2')
  await wait(250)
  const jpgSummaryBest = document.querySelector('.export-summary')?.textContent ?? null
  if (qualitySelect) chooseOption(qualitySelect, '31')
  await wait(250)
  const jpgSummarySmallest = document.querySelector('.export-summary')?.textContent ?? null
  result.imageOutput = {
    ...(result.imageOutput as object),
    qualityOptions,
    jpgSummaryBefore,
    jpgSummaryBest,
    jpgSummarySmallest,
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
  // AND THE BITRATE, which is what that field always was: a rate, named for what it takes. It is drawn
  // only where the codec HAS one, so ProRes is refused rather than offered a box it would ignore.
  const h264Bitrate = { drawn: Boolean(fieldFor('BITRATE')), disabled: fieldDisabled('BITRATE'), oldQualityLabel: Boolean(fieldFor('QUALITY')), title: fieldFor('BITRATE')?.getAttribute('title') ?? null }
  if (depthSelect) chooseOption(depthSelect, '10')
  await wait(150)
  // A HEADING CLICK MUST NOT PUT THE SETTING BACK. A field's reset button is the FIRST labelable element
  // inside its label, so a browser click on the label — its heading, its padding, the rule under it —
  // forwarded to the RESET rather than to the control the field draws. The heading is clicked first, then
  // the reset itself, so the fix is proved without breaking the button.
  const depthField = fieldFor('DEPTH')
  const depthResetDrawn = Boolean(depthField?.querySelector('.field-reset'))
  ;(depthField?.querySelector('span') as HTMLElement | null)?.click()
  await wait(150)
  const depthAfterHeading = valueOf(selectIn('DEPTH'))
  ;(depthField?.querySelector('.field-reset') as HTMLElement | null)?.click()
  await wait(150)
  const depthAfterReset = valueOf(selectIn('DEPTH'))
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
    h264: { ...h264Depth, afterHeading: depthAfterHeading, afterReset: depthAfterReset, resetDrawn: depthResetDrawn },
    h264Bitrate,
    sentDepth,
    prores: {
      value: proresDepthField?.querySelector('input')?.value ?? null,
      readOnly: Boolean(proresDepthField?.querySelector('input[readonly]')),
      hasSelect: Boolean(proresDepthField?.querySelector('.editor-select')),
    },
    proresHint: proresDepthField?.querySelector('em')?.textContent?.trim() ?? null,
    proresBitrate: { disabled: fieldDisabled('BITRATE'), hint: fieldFor('BITRATE')?.querySelector('em')?.textContent?.trim() ?? null },
  }

  // A VIDEO EXTRACTED TO SOUND, which is what VID2AUD means. The source is a VIDEO, so the job's own
  // visuals are not 'audio' — and the estimate was reading the SOURCE's kind rather than what the EXPORT
  // writes, which left every one of these jobs with nothing to size and no reason to size it. Its summary
  // must carry a figure, and its sound settings must be choosable.
  clickTab('EXPORT')
  await wait(120)
  const toMp3 = selectIn('FORMAT')
  if (toMp3) chooseOption(toMp3, 'mp3')
  await wait(300)
  const videoToAudioSummary = document.querySelector('.export-summary')?.textContent ?? null
  clickTab('AUDIO')
  await wait(150)
  // A LOSSLESS codec has a depth to store and a lossy one has none, so the field is read on both sides.
  const depthForMp3 = { drawn: Boolean(fieldFor('BIT DEPTH')) }
  clickTab('EXPORT')
  await wait(120)
  const toWav = selectIn('FORMAT')
  if (toWav) chooseOption(toWav, 'wav')
  await wait(250)
  const wavSummary = document.querySelector('.export-summary')?.textContent ?? null
  clickTab('AUDIO')
  await wait(150)
  const audioDepthSelect = selectIn('BIT DEPTH')
  result.videoToAudio = {
    container: 'mp3',
    summary: videoToAudioSummary,
    sampleRateDisabled: fieldDisabled('SAMPLE RATE'),
    bitrateDisabled: fieldDisabled('BITRATE'),
    depthForMp3,
    wavSummary,
    depthForWav: { drawn: Boolean(fieldFor('BIT DEPTH')), options: optionsOf(audioDepthSelect), value: valueOf(audioDepthSelect) },
  }

  // THE TRANSPORT'S WHEEL, which is the timeline's OWN scrub gesture rather than a second one: a flick on the
  // bar has to move the playhead. It is read as the stamp under the bar, before and after, because that is what
  // a reader sees move — and it is turned in whichever direction has room, since a bar already at its end can
  // only move the other way.
  const scrubEl = document.querySelector('.transport-scrub') as HTMLInputElement | null
  const wheelPositionBefore = Number(scrubEl?.value ?? 0)
  const wheelExtent = Number(scrubEl?.max ?? 0)
  const stampBeforeWheel = document.querySelector('.transport-stamp')?.textContent ?? null
  scrubEl?.dispatchEvent(new WheelEvent('wheel', { deltaY: wheelPositionBefore > wheelExtent / 2 ? 3 : -3, deltaMode: 0, bubbles: true, cancelable: true }))
  await wait(40)
  result.scrubWheel = {
    disabled: Boolean(scrubEl?.disabled),
    stampBefore: stampBeforeWheel,
    stampAfter: document.querySelector('.transport-stamp')?.textContent ?? null,
  }

  // AN IMAGE SOURCE'S OWN ESTIMATE. A picture is sized by the CODEC it is written as, so the figure has to
  // move when FORMAT and PRESET are recombined — exactly as a true video's does. It was reported as one
  // fixed figure for a still-image clip and for an image sequence, so the three recombinations are read
  // here: the codec, then the container, then a codec whose size does not come from a delivery bracket.
  // APPLY first, so the window is CLEAN and the image job is adopted whole rather than merged with the
  // edits the drives above left on it — otherwise the preset read here is the last job's, not this one's.
  const applyBeforeImage = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyBeforeImage?.click()
  await wait(200)
  arrive(stillSourceTask, 'image-source')
  await wait(500)
  clickTab('EXPORT')
  await wait(150)
  const summaryNow = () => document.querySelector('.export-summary')?.textContent ?? null
  const imageSourceSizes: Record<string, string | null> = { mp4h264: summaryNow() }
  chooseOption(selectIn('PRESET'), 'hevc')
  await wait(250)
  imageSourceSizes.mp4hevc = summaryNow()
  chooseOption(selectIn('FORMAT'), 'mov')
  await wait(300)
  imageSourceSizes.movhevc = summaryNow()
  chooseOption(selectIn('PRESET'), 'prores-hq')
  await wait(250)
  imageSourceSizes.movprores = summaryNow()
  chooseOption(selectIn('FORMAT'), 'png')
  await wait(300)
  imageSourceSizes.png = summaryNow()
  // The image formats themselves, and the run-versus-still choice inside one — the recombination the report
  // is most likely to be about, since those are the containers an image source is normally written into.
  clickTab('IMAGE')
  await wait(150)
  const stillImageOutput = selectIn('IMAGE OUTPUT')
  imageSourceSizes.pngStill = summaryNow()
  if (stillImageOutput) chooseOption(stillImageOutput, 'sequence')
  await wait(250)
  imageSourceSizes.pngSequence = summaryNow()
  clickTab('EXPORT')
  await wait(150)
  chooseOption(selectIn('FORMAT'), 'jpg')
  await wait(300)
  imageSourceSizes.jpg = summaryNow()
  result.imageSource = imageSourceSizes

  // AND THE SAME QUESTION FOR AN IMAGE SEQUENCE, the other source kind named. APPLY back to a clean draft
  // first, so the sequence job is adopted whole.
  const applyBeforeSequence = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyBeforeSequence?.click()
  await wait(200)
  arrive(sequenceSourceTask, 'image-sequence')
  await wait(500)
  clickTab('EXPORT')
  await wait(150)
  const sequenceSizes: Record<string, string | null> = { mp4h264: summaryNow() }
  chooseOption(selectIn('PRESET'), 'hevc')
  await wait(250)
  sequenceSizes.mp4hevc = summaryNow()
  chooseOption(selectIn('FORMAT'), 'mov')
  await wait(300)
  chooseOption(selectIn('PRESET'), 'prores-hq')
  await wait(250)
  sequenceSizes.movprores = summaryNow()
  // AND THE PICTURE'S OWN SETTING, which the last pass proved moves a STILL's figure: a run of frames asked
  // for at PNG level 0 against level 9 has to read differently too.
  clickTab('EXPORT')
  await wait(150)
  chooseOption(selectIn('FORMAT'), 'png')
  await wait(300)
  clickTab('IMAGE')
  await wait(150)
  const sequenceOutput = selectIn('IMAGE OUTPUT')
  if (sequenceOutput) chooseOption(sequenceOutput, 'sequence')
  await wait(250)
  sequenceSizes.pngRunDefault = summaryNow()
  const sequenceCompression = selectIn('COMPRESSION')
  if (sequenceCompression) chooseOption(sequenceCompression, '0')
  await wait(250)
  sequenceSizes.pngRunLevel0 = summaryNow()
  if (sequenceCompression) chooseOption(sequenceCompression, '9')
  await wait(250)
  sequenceSizes.pngRunLevel9 = summaryNow()
  result.imageSequence = sequenceSizes

  // WHAT A COPY IS CALLED, AND FRAMING THE SECOND ONE. Two things are asked of the EDIT JOB here, both of
  // which are invisible to the arithmetic: that a file imported twice is labelled by its copies on the
  // timeline box, in the monitor's own line and in PROPERTIES; and that the FRAMING controls reach the SECOND
  // copy. The monitor files the picture it measured under the clip that happened to be loaded, so a second
  // copy of one file — which does not reload the element and so never measures again — read as a picture of
  // unknown size with no framing to edit; and the controls described whichever clip the playhead was on rather
  // than the one selected. This drives the fix: right-click the second copy, open PROPERTIES, and frame it.
  const applyBeforeCopy = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  if (applyBeforeCopy && !applyBeforeCopy.disabled) applyBeforeCopy.click()
  await wait(200)
  arrive(duplicateTask, 'copy-framing')
  // Long enough for the monitor's element to decode the real clip and report its size: the framing that follows
  // is measured against that picture, which is the whole point of the drive.
  await wait(900)
  const copyClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const clipNames = copyClips().map((clip) => clip.querySelector('.timeline-clip-name')?.textContent ?? null)
  // The SECOND copy, by its right-click menu: PROPERTIES selects it and must bring the playhead to it, so the
  // clip selected, shown and described is the same one before a single framing figure is touched.
  copyClips()[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const propertiesItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'PROPERTIES') as HTMLButtonElement | undefined
  propertiesItem?.click()
  await wait(300)
  const activeCopyIndex = copyClips().findIndex((clip) => clip.classList.contains('is-active'))
  const propertiesSource = rowValue('SOURCE')
  // A crop on that copy: the FRAMING controls live under the VIDEO tab of EXPORT SETTINGS, so that tab is
  // opened first, then FRAMING is unfolded and FREEFORM chosen, which is what turns a region on.
  clickTab('VIDEO')
  await wait(200)
  const framingHead = [...document.querySelectorAll('.editor-group-name')].find((button) => button.querySelector('.editor-group-label')?.textContent?.trim() === 'FRAMING') as HTMLButtonElement | undefined
  framingHead?.click()
  await wait(200)
  const cropSelect = [...document.querySelectorAll('.editor-select')].find((control) => [...control.querySelectorAll('.editor-select-option')].some((option) => option.getAttribute('data-value') === 'FREEFORM')) as HTMLElement | undefined
  chooseOption(cropSelect ?? null, 'FREEFORM')
  await wait(300)
  const cropFields = [...document.querySelectorAll('.crop-row .mini-field input')].slice(0, 4).map((input) => (input as HTMLInputElement).value)
  // THE MONITOR'S OWN CROP BOX, which can only be drawn against a picture it has measured: a repeated source
  // whose size stayed filed under the first copy has no box here, which is what was reported.
  const cropBoxDrawn = Boolean(document.querySelector('.editor-crop'))
  const cropShades = document.querySelectorAll('.editor-crop-shade').length
  const applyCopy = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyCopy?.click()
  await wait(250)
  const lastCopyPatch = applied[applied.length - 1] as { sourceCrop?: Record<string, unknown> } | undefined
  result.copyFraming = {
    clipNames,
    activeCopyIndex,
    propertiesSource,
    cropFields,
    cropBoxDrawn,
    cropShades,
    cropKeys: lastCopyPatch?.sourceCrop ? Object.keys(lastCopyPatch.sourceCrop) : null,
  }

  // REORDER AND TRIM ON THE EDITOR'S TIMELINE. Two gestures the timeline now owns: dragging a clip to another
  // place in the join, and dragging either edge of a clip's source window. The reorder has to splice the IDs and
  // the copy numbers along with the paths, so the clip that moved keeps its identity; the trim has to write the
  // clip that was trimmed and no other. The two clips are told apart by their LENGTHS, so the reorder is read as
  // which duration now sits first.
  arrive(duplicateTask, 'timeline-gestures')
  await wait(900)
  const gestureClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const clipDurations = (clips: HTMLElement[]) => clips.map((clip) => clip.querySelector('small')?.textContent ?? null)
  const beforeOrder = clipDurations(gestureClips())

  // TRIM: the second copy's OUT handle, dragged left, which shortens its run through the source.
  const outHandle = gestureClips()[1]?.querySelector('.clip-trim-handle.is-out') as HTMLElement | null
  const handleBox = outHandle?.getBoundingClientRect()
  let trimReadout: string | null = null
  let trimShades = 0
  let growBands = 0
  let growEdges = 0
  let growWidth = 0
  let growHeight = 0
  let growHit: string | null = null
  let playheadStayed = false
  if (outHandle && handleBox) {
    const x = handleBox.left + handleBox.width / 2
    const y = handleBox.top + handleBox.height / 2
    const playheadLeft = () => (document.querySelector('.timeline-playhead') as HTMLElement | null)?.style.left ?? null
    const beforePlayhead = playheadLeft()
    outHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
    await wait(60)
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x - 40, clientY: y }))
    await wait(60)
    trimReadout = (document.querySelector('.clip-trim-readout') as HTMLElement | null)?.textContent ?? null
    trimShades = document.querySelectorAll('.clip-trim-shade').length
    // THE SKIMMER STAYS PUT: it used to be driven onto the landing frame so the monitor would show it, which
    // lost the reader their own place. The monitor follows the HANDLE now, so the skimmer's own position is the
    // reading that says the drag left it alone.
    playheadStayed = playheadLeft() === beforePlayhead
    // GROWING draws its own drawer OUTSIDE the clip's box, where removing draws shading inside it. This clip
    // is trimmed to four of twelve seconds, so dragging the out edge RIGHT grows it — captured here and then
    // put back at the shrink position before release, so the released window is the one asserted below.
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 90, clientY: y }))
    await wait(60)
    growBands = document.querySelectorAll('.clip-trim-grow').length
    growEdges = document.querySelectorAll('.clip-trim-grow-edge').length
    // The drawer has to be not merely in the DOM but VISIBLE: it is drawn OUTSIDE the clip's box (the box
    // does not move until release), so it can be clipped by an ancestor or painted under a neighbour. Its
    // own box and what the pointer at its centre actually hits are the two readings that tell those apart.
    const growEl = document.querySelector('.clip-trim-grow') as HTMLElement | null
    if (growEl) {
      const growRect = growEl.getBoundingClientRect()
      growWidth = Math.round(growRect.width)
      growHeight = Math.round(growRect.height)
      // The drawer is `pointer-events: none`, so `elementFromPoint` would skip straight past it and report
      // whatever is behind — which says nothing about whether it is PAINTED. Turning that off for the
      // instant of the probe makes the hit test answer the question it is asked: what is the topmost thing
      // drawn at the drawer's centre. A clipped ancestor or a neighbour over it answers with itself.
      const prior = growEl.style.pointerEvents
      growEl.style.pointerEvents = 'auto'
      const hit = document.elementFromPoint(growRect.left + growRect.width / 2, growRect.top + growRect.height / 2)
      growEl.style.pointerEvents = prior
      growHit = hit ? `${hit.tagName}.${String((hit as HTMLElement).className)}` : null
    }
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x - 40, clientY: y }))
    await wait(40)
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x - 40, clientY: y }))
    await wait(150)
  }
  const afterTrim = clipDurations(gestureClips())
  const applyTrim = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyTrim?.click()
  await wait(200)
  const trimPatch = applied[applied.length - 1] as { trimPoints?: Record<string, { in: number; out: number }> } | undefined
  const trimEntries = trimPatch?.trimPoints ? Object.entries(trimPatch.trimPoints).map(([key, value]) => [key, value]) : null

  // REORDER: the second copy dragged onto the first. A native DragEvent carries a real DataTransfer, which is
  // what the browser's drag machinery — and therefore React's synthetic events — need.
  const transfer = new DataTransfer()
  gestureClips()[1]?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  await wait(60)
  gestureClips()[0]?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  await wait(60)
  gestureClips()[0]?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  await wait(150)
  const afterOrder = clipDurations(gestureClips())
  const applyReorder = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyReorder?.click()
  await wait(200)
  const reorderPatch = applied[applied.length - 1] as { clipIds?: string[]; clipNumbers?: number[] } | undefined
  result.timelineGestures = {
    beforeOrder,
    trimReadout,
    trimShades,
    growBands,
    growEdges,
    growWidth,
    growHeight,
    growHit,
    playheadStayed,
    afterTrim,
    trimEntries,
    afterOrder,
    reorderIds: reorderPatch?.clipIds ?? null,
    reorderNumbers: reorderPatch?.clipNumbers ?? null,
  }

  // THE [+] PANEL'S OWN COMMANDS, AND THE DELETE KEY. The [+] sits on a clip's trailing edge, which is
  // exactly where the trim handle now sits, so whether it can still be clicked is a HIT TEST rather than a
  // reading of a z-index. That panel then carries a second decision after a rule — ADD SOURCE — which inserts
  // at the place the [+] stood for. And a selected clip can be removed with the Delete key, after a question.
  arrive(duplicateTask, 'timeline-source-commands')
  await wait(900)
  const commandClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const clipsBefore = commandClips().length
  const cutAdd = commandClips()[0]?.querySelector('.boundary-add:not(.is-head)') as HTMLElement | null
  const cutBox = cutAdd?.getBoundingClientRect()
  const cutHit = cutBox ? document.elementFromPoint(cutBox.left + cutBox.width / 2, cutBox.top + cutBox.height / 2) : null
  const cutReachable = Boolean(cutAdd && cutHit && (cutHit === cutAdd || cutAdd.contains(cutHit)))
  cutAdd?.click()
  await wait(200)
  const panelDivider = Boolean(document.querySelector('.boundary-editor .boundary-divider'))
  const addSourceButton = [...document.querySelectorAll('.boundary-editor .boundary-source')].find((button) => button.textContent?.trim() === 'ADD SOURCE') as HTMLButtonElement | undefined
  addSourceButton?.click()
  await wait(600)
  const clipsAfterAdd = commandClips().length
  const labelsAfterAdd = commandClips().map((clip) => clip.querySelector('.timeline-clip-name')?.textContent ?? null)
  // The DELETE key: select the inserted copy, ask, and answer. It must ask the SAME question the clip's own
  // REMOVE SOURCE asks — the menu's confirmation, not a second panel of its own.
  commandClips()[1]?.click()
  await wait(200)
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete', key: 'Delete', bubbles: true }))
  await wait(200)
  const menuText = [...document.querySelectorAll('.timeline-menu button')].map((button) => button.textContent?.trim() ?? '')
  const deleteConfirm = [...document.querySelectorAll('.timeline-menu-head')].map((node) => node.textContent ?? '').find((text) => text.startsWith('REMOVE ')) ?? null
  const menuHadKeepIt = menuText.includes('KEEP IT')
  const removeClipButton = [...document.querySelectorAll('.timeline-menu-actions button')].find((button) => button.textContent?.trim() === 'REMOVE') as HTMLButtonElement | undefined
  removeClipButton?.click()
  await wait(300)
  const clipsAfterDelete = commandClips().length
  result.timelineSourceCommands = { clipsBefore, cutReachable, panelDivider, clipsAfterAdd, labelsAfterAdd, deleteConfirm, menuHadKeepIt, clipsAfterDelete }

  // TWO COPIES OF ONE FILE, AND THE CLIP MENU'S REMOVE. Right-clicking the SECOND copy and removing it has
  // to take THAT clip: the menu's source index was read back with `indexOf`, which answers with the first
  // occurrence of a path however many there are, so removing any copy removed the first one. The two clips
  // are told apart by their LENGTH — five seconds against four — so which one survived is a reading.
  const applyBeforeDuplicate = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyBeforeDuplicate?.click()
  await wait(200)
  arrive(duplicateTask, 'duplicate-sources')
  await wait(500)
  const duplicateClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const beforeRemoval = duplicateClips().map((clip) => clip.textContent ?? null)
  duplicateClips()[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const removeItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'REMOVE SOURCE') as HTMLButtonElement | undefined
  removeItem?.click()
  await wait(150)
  const confirmRemove = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'REMOVE') as HTMLButtonElement | undefined
  confirmRemove?.click()
  await wait(300)
  result.duplicate = {
    beforeCount: beforeRemoval.length,
    before: beforeRemoval,
    afterCount: duplicateClips().length,
    after: duplicateClips().map((clip) => clip.textContent ?? null),
  }

  // DUPLICATE, COPY AND PASTE. The menu's DUPLICATE asks its own sub-question (PLACE AFTER / AT THE END); Cmd-C
  // takes the clip in hand and Cmd-V places it at the [+] nearest the skimmer. Every copy is the SAME file, so
  // the copy numbers have to stay distinct across all of them — which is where the label bug was seen.
  const flushEdits = () => {
    const apply = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
    if (apply && !apply.disabled) apply.click()
  }
  flushEdits()
  await wait(200)
  arrive(duplicateTask, 'timeline-duplicate')
  await wait(900)
  const dupClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const dupBefore = dupClips().length
  dupClips()[0]?.click()
  await wait(150)
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', metaKey: true, bubbles: true }))
  await wait(150)
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', metaKey: true, bubbles: true }))
  await wait(300)
  const dupAfterPaste = dupClips().length
  dupClips()[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const duplicateItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'DUPLICATE...') as HTMLButtonElement | undefined
  duplicateItem?.click()
  await wait(150)
  const menuButtons = [...document.querySelectorAll('.timeline-menu button')].map((button) => button.textContent?.trim() ?? '')
  const hasEndOption = menuButtons.includes('AT THE END')
  const duplicateHead = [...document.querySelectorAll('.timeline-menu-head')].map((node) => node.textContent ?? '').find((text) => text.startsWith('DUPLICATE')) ?? null
  // The sub-question's own answers are the INDENTED ones, and the heading names the command only.
  const subAnswers = [...document.querySelectorAll('.timeline-menu button.is-sub')].map((button) => button.textContent?.trim() ?? '')
  const placeAfter = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'PLACE AFTER') as HTMLButtonElement | undefined
  placeAfter?.click()
  await wait(300)
  const dupAfterMenu = dupClips().length
  const dupLabels = dupClips().map((clip) => clip.querySelector('.timeline-clip-name')?.textContent ?? null)
  result.timelineDuplicate = { dupBefore, dupAfterPaste, dupAfterMenu, hasEndOption, duplicateHead, subAnswers, dupLabels }

  // THE COPY NUMBERS WHEN THE QUEUE PUSHES A SHORTER LIST BACK. A third copy is added in the window, then the
  // two-source task is pushed to it again — the case that dropped the window's numbers and left the third copy
  // reading a figure it shared with the first.
  flushEdits()
  await wait(200)
  arrive(pairTask, 'copy-numbers')
  await wait(900)
  const pairCut = [...document.querySelectorAll('.timeline-clip')][0]?.querySelector('.boundary-add:not(.is-head)') as HTMLElement | undefined
  pairCut?.click()
  await wait(200)
  const pairAdd = [...document.querySelectorAll('.boundary-editor .boundary-source')].find((button) => button.textContent?.trim() === 'ADD SOURCE') as HTMLButtonElement | undefined
  pairAdd?.click()
  await wait(600)
  const pairLabelsAfterAdd = [...document.querySelectorAll('.timeline-clip-name')].map((node) => node.textContent ?? null)
  arrive(pairTask, 'copy-numbers-pushed')
  await wait(500)
  const pairLabelsAfterPush = [...document.querySelectorAll('.timeline-clip-name')].map((node) => node.textContent ?? null)
  result.copyNumbers = { pairLabelsAfterAdd, pairLabelsAfterPush }

  // THE SPLIT VIEW WHILE A HANDLE IS DOWN. On a two-clip join, dragging the SECOND clip's IN handle has a
  // clip before it: the monitor has to show that neighbour's LAST frame beside the clip being trimmed, in a
  // pane on the LEFT (the side the handle is on), labelled PREV LAST — and it has to go when the handle is up.
  flushEdits()
  await wait(200)
  arrive(duplicateTask, 'split-view')
  await wait(900)
  const splitClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const inHandle = splitClips()[1]?.querySelector('.clip-trim-handle.is-in') as HTMLElement | null
  let splitSide: string | null = null
  let splitLabel: string | null = null
  let splitLabels: string[] = []
  let splitFrameHidden = false
  let splitPanes = 0
  let playheadBefore = -1
  let playheadDuring = -1
  if (inHandle) {
    const box = inHandle.getBoundingClientRect()
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
    // THE PLAYHEAD MUST NOT MOVE while the handle is dragged: the skimmer is the reader's own place, kept
    // while the preview streams the frame the cut lands on.
    playheadBefore = Number((document.querySelector('.transport-scrub') as HTMLInputElement | null)?.value ?? -1)
    inHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ...at }))
    await wait(60)
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: at.clientX + 20, clientY: at.clientY }))
    await wait(80)
    playheadDuring = Number((document.querySelector('.transport-scrub') as HTMLInputElement | null)?.value ?? -1)
    splitPanes = document.querySelectorAll('.editor-trim-pane').length
    const paneLabels = [...document.querySelectorAll('.editor-trim-pane-label')].map((node) => node.textContent ?? '')
    splitSide = paneLabels[0] === 'PREV LAST' ? 'left' : paneLabels[0] === 'NEXT FIRST' ? 'right' : null
    splitLabel = paneLabels[0] || null
    splitLabels = paneLabels
    splitFrameHidden = Boolean(document.querySelector('.editor-stage.is-trimming'))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: at.clientX + 20, clientY: at.clientY }))
    await wait(120)
  }
  const splitGone = document.querySelector('.editor-trim-pair') === null
  result.splitView = { splitSide, splitLabel, splitPanes, splitGone, splitLabels, splitFrameHidden, playheadBefore, playheadDuring }

  // THE AUDIO LANE'S OWN CONTROLS. A multitrack job's added track is a lane of its own: its clip has to offer
  // the same trim handles the video lane's do, and a [+] whose panel offers ADD SOURCE — but a fade on an
  // added track is NOT written by the encoder, so the fade items are disabled and say so.
  flushEdits()
  await wait(200)
  arrive(coverTask, 'audio-lane')
  await wait(900)
  const laneBodies = [...document.querySelectorAll('.timeline-lane')] as HTMLElement[]
  const audioLaneBody = laneBodies[1]
  const audioClip = audioLaneBody?.querySelector('.timeline-clip') as HTMLElement | null
  const audioHandles = audioClip ? audioClip.querySelectorAll('.clip-trim-handle').length : 0
  // A SOUND lane gets NO trim preview: there is no frame at the end of a track to judge a cut against, so a
  // handle dragged there leaves the monitor as it was — and, like every trim, leaves the SKIMMER where it is.
  let audioSplitPanes = -1
  let audioPlayheadStayed = false
  const audioOut = audioClip?.querySelector('.clip-trim-handle.is-out') as HTMLElement | null
  if (audioOut) {
    const audioBox = audioOut.getBoundingClientRect()
    const audioAt = { clientX: audioBox.left + audioBox.width / 2, clientY: audioBox.top + audioBox.height / 2 }
    const playheadLeft = () => (document.querySelector('.timeline-playhead') as HTMLElement | null)?.style.left ?? null
    const beforeAudioPlayhead = playheadLeft()
    audioOut.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ...audioAt }))
    await wait(60)
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: audioAt.clientX - 30, clientY: audioAt.clientY }))
    await wait(80)
    audioSplitPanes = document.querySelectorAll('.editor-trim-pane').length
    audioPlayheadStayed = playheadLeft() === beforeAudioPlayhead
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: audioAt.clientX - 30, clientY: audioAt.clientY }))
    await wait(120)
  }
  const audioBoundary = audioClip?.querySelector('.boundary-add') as HTMLElement | null
  audioBoundary?.click()
  await wait(200)
  const audioPanelTitle = (document.querySelector('.boundary-editor .boundary-title') as HTMLElement | null)?.textContent ?? null
  const fadeButtons = [...document.querySelectorAll('.boundary-editor .boundary-options button')] as HTMLButtonElement[]
  const fadeButton = fadeButtons.find((button) => button.textContent?.trim() === 'FADE')
  const fadeDisabled = Boolean(fadeButton?.disabled)
  const blockedNote = (document.querySelector('.boundary-editor .boundary-clamped') as HTMLElement | null)?.textContent ?? null
  const audioAddSource = [...document.querySelectorAll('.boundary-editor .boundary-source')].some((button) => button.textContent?.trim() === 'ADD SOURCE')
  // Choosing FADE has to WRITE a record for THIS track, and APPLY has to carry it to the queue.
  fadeButton?.click()
  await wait(150)
  const applyFade = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyFade?.click()
  await wait(250)
  const fadePatch = applied[applied.length - 1] as { transitions?: Record<string, unknown> } | undefined
  const fadeKeys = fadePatch?.transitions ? Object.keys(fadePatch.transitions) : []
  result.audioLane = { laneCount: laneBodies.length, audioHandles, audioSplitPanes, audioPlayheadStayed, hasBoundary: Boolean(audioBoundary), audioPanelTitle, fadeDisabled, blockedNote, audioAddSource, fadeKeys }

  // A TRIM THE QUEUE MADE, LANDING ON A WINDOW THAT IS DIRTY. The QUICK LOOK helper's in/out points come back
  // through the queue, and the window is usually dirty when they do — the timeline was probably just trimmed.
  // The trims are merged three ways, so the helper's edit reaches its clip AND the window's own trim of
  // another clip survives, rather than either side being dropped.
  flushEdits()
  await wait(200)
  arrive(duplicateTask, 'quicklook-merge')
  await wait(900)
  const mergeClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const mergeOut = mergeClips()[0]?.querySelector('.clip-trim-handle.is-out') as HTMLElement | null
  if (mergeOut) {
    const box = mergeOut.getBoundingClientRect()
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
    mergeOut.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ...at }))
    await wait(60)
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: at.clientX - 40, clientY: at.clientY }))
    await wait(60)
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: at.clientX - 40, clientY: at.clientY }))
    await wait(150)
  }
  const windowTrim = mergeClips()[0]?.querySelector('small')?.textContent ?? null
  // The queue files the helper's points against the SECOND clip and pushes the job back.
  const pushedTrim = { ...duplicateTask, trimPoints: { [`${CLIP_FIXTURE}#0`]: { in: 0, out: 5 }, [`${CLIP_FIXTURE}#1`]: { in: 6, out: 8 } } }
  arrive(pushedTrim, 'quicklook-merge-push')
  await wait(500)
  const afterPushLabels = mergeClips().map((clip) => clip.querySelector('small')?.textContent ?? null)
  result.quickLookMerge = { windowTrim, afterPushLabels }

  // THE CLIP'S OWN TWO REPAIRS, from its context menu. RESET TRIM takes a clip back to the whole of its
  // source — the record IS the decision, so it goes rather than being set to a value — and REPLACE SOURCE
  // puts a different FILE in the clip's place, which is a new clip with an id of its own so none of the old
  // clip's records follow a file they were never about.
  flushEdits()
  await wait(200)
  arrive(pairTask, 'clip-repairs')
  await wait(900)
  const repairClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const beforeRepairs = repairClips().map((clip) => clip.querySelector('small')?.textContent ?? null)
  repairClips()[0]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const resetItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'RESET TRIM') as HTMLButtonElement | undefined
  const resetDisabled = Boolean(resetItem?.disabled)
  resetItem?.click()
  await wait(200)
  const afterReset = repairClips()[0]?.querySelector('small')?.textContent ?? null
  repairClips()[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const replaceItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'REPLACE SOURCE...') as HTMLButtonElement | undefined
  replaceItem?.click()
  await wait(400)
  const applyRepairs = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyRepairs?.click()
  await wait(250)
  const repairPatch = applied[applied.length - 1] as { trimPoints?: Record<string, unknown>; clipIds?: string[] } | undefined
  result.clipRepairs = { beforeRepairs, resetDisabled, afterReset, repairIds: repairPatch?.clipIds ?? null, repairTrims: repairPatch?.trimPoints ?? null }

  // A PLACEHOLDER IN THE CLIP'S OWN PLACE. REPLACE SOURCE needs a PLACE in the job's source list, and an added
  // AUDIO track has none — so that item is out of reach there, and it says why — while REPLACE WITH BLANK / WITH
  // SILENCE works on ANY lane, putting a placeholder of the lane's own kind in the clip's place.
  flushEdits()
  await wait(200)
  arrive(pairTask, 'replace-blank')
  await wait(900)
  const blankClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  blankClips()[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const blankItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'REPLACE WITH BLANK') as HTMLButtonElement | undefined
  const blankOffered = Boolean(blankItem)
  blankItem?.click()
  await wait(250)
  const blankShown = blankClips()[1]?.querySelector('small')?.textContent ?? null
  const applyBlank = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyBlank?.click()
  await wait(250)
  const blankPatch = applied[applied.length - 1] as { sourcePaths?: string[]; clipIds?: string[]; trimPoints?: Record<string, { in: number; out: number }> } | undefined
  const blankId = blankPatch?.clipIds?.[1]
  result.replaceBlank = { offered: blankOffered, path: blankPatch?.sourcePaths?.[1] ?? null, length: blankId ? blankPatch?.trimPoints?.[blankId]?.out ?? null : null, shown: blankShown }

  // The same on an AUDIO TRACK, where REPLACE SOURCE cannot reach: the silence item is offered, the source item
  // is out of reach and says why, and the track's own path becomes a placeholder.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'replace-silence', type: 'multitrack', sourcePaths: [CLIP_FIXTURE], additionalAudioTracks: [{ id: 'tA', path: SOUND_FIXTURE, language: 'und' }] }, 'replace-silence')
  await wait(1000)
  const trackClip = () => document.querySelector('.timeline-lane-track.is-audio .timeline-clip') as HTMLElement | null
  trackClip()?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const trackSourceItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'REPLACE SOURCE...') as HTMLButtonElement | undefined
  const trackSilenceItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'REPLACE WITH SILENCE') as HTMLButtonElement | undefined
  const trackSource = { disabled: Boolean(trackSourceItem?.disabled), titled: Boolean(trackSourceItem?.title) }
  const trackSilenceOffered = Boolean(trackSilenceItem)
  trackSilenceItem?.click()
  await wait(250)
  const silenceShown = trackClip()?.querySelector('small')?.textContent ?? null
  const applySilence = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applySilence?.click()
  await wait(250)
  const silencePatch = applied[applied.length - 1] as { additionalAudioTracks?: Array<{ path?: string }>; trimPoints?: Record<string, { in: number; out: number }> } | undefined
  const trackPath = silencePatch?.additionalAudioTracks?.[0]?.path ?? null
  result.replaceSilence = { offered: trackSilenceOffered, source: trackSource, trackPath, length: trackPath ? silencePatch?.trimPoints?.[`${trackPath}#0`]?.out ?? null : null, shown: silenceShown }

  // A COMMAND ASKED OF A SELECTION RUNS ON EVERY CLIP IN HAND, each taking the placeholder its OWN lane asks
  // for. Selecting a VIDEO clip and an AUDIO track together and choosing the item replaces BOTH — a BLANK and a
  // SILENCE — rather than one kind for the pair, and the item names both kinds and the count.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'replace-mixed', type: 'multitrack', sourcePaths: [CLIP_FIXTURE], additionalAudioTracks: [{ id: 'tA', path: SOUND_FIXTURE, language: 'und' }] }, 'replace-mixed')
  await wait(1000)
  const mixedVideo = () => document.querySelector('.timeline-lane-track:not(.is-audio) .timeline-clip') as HTMLElement | null
  const mixedTrack = () => document.querySelector('.timeline-lane-track.is-audio .timeline-clip') as HTMLElement | null
  mixedVideo()?.click()
  await wait(120)
  mixedTrack()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true, clientX: 60, clientY: 60 }))
  await wait(150)
  mixedVideo()?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const mixedItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => (button.textContent?.trim() ?? '').startsWith('REPLACE WITH')) as HTMLButtonElement | undefined
  const mixedLabel = mixedItem?.textContent?.trim() ?? null
  mixedItem?.click()
  await wait(250)
  const applyMixed = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyMixed?.click()
  await wait(250)
  const mixedPatch = applied[applied.length - 1] as { sourcePaths?: string[]; clipIds?: string[]; additionalAudioTracks?: Array<{ path?: string }>; trimPoints?: Record<string, { in: number; out: number }> } | undefined
  const mixedTrackPath = mixedPatch?.additionalAudioTracks?.[0]?.path ?? null
  const mixedId = mixedPatch?.clipIds?.[0]
  result.replaceMixed = {
    label: mixedLabel,
    source: mixedPatch?.sourcePaths?.[0] ?? null,
    sourceLength: mixedId ? mixedPatch?.trimPoints?.[mixedId]?.out ?? null : null,
    track: mixedTrackPath,
    trackLength: mixedTrackPath ? mixedPatch?.trimPoints?.[`${mixedTrackPath}#0`]?.out ?? null : null,
  }

  // THE TIMELINE KICKER'S OWN MENU. Which unit the window shows lengths in is a setting rather than a job
  // field, so this asks the whole chain: the menu offers both, choosing FRAMESTAMP re-stamps the clips, and
  // the setting is written back through saveSettings rather than only held in the window.
  flushEdits()
  await wait(200)
  arrive(duplicateTask, 'stamp-menu')
  await wait(900)
  const clipStamp = () => document.querySelector('.timeline-clip small')?.textContent ?? null
  const beforeStamp = clipStamp()
  const kicker = document.querySelector('.timeline-gutter-ruler') as HTMLElement | undefined
  kicker?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }))
  await wait(150)
  const stampItems = [...document.querySelectorAll('.timeline-menu button')].map((button) => button.textContent?.trim() ?? '')
  const frameStampItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'FRAMESTAMP') as HTMLButtonElement | undefined
  frameStampItem?.click()
  await wait(250)
  const afterStamp = clipStamp()
  const lastSettings = savedSettings[savedSettings.length - 1] as { timestampDisplayMode?: string } | undefined
  result.stampMenu = { beforeStamp, stampItems, afterStamp, savedMode: lastSettings?.timestampDisplayMode ?? null }

  // THE EMPTY AUDIO LANE. A CONVERT of one video has no sound to carry and still shows a lane to add it on,
  // with a [+] in its first frame that offers ADD SOURCE and nothing else — there is no clip to fade.
  flushEdits()
  await wait(200)
  arrive(task, 'empty-lane')
  await wait(900)
  const emptyLanes = [...document.querySelectorAll('.timeline-lane')] as HTMLElement[]
  const emptyLaneBody = emptyLanes[1]
  const emptyMark = emptyLaneBody?.querySelector('.boundary-add.is-lane-empty') as HTMLElement | null
  const emptyHasClip = Boolean(emptyLaneBody?.querySelector('.timeline-clip'))
  emptyMark?.click()
  await wait(200)
  const emptyPanelTitle = (document.querySelector('.boundary-editor .boundary-title') as HTMLElement | null)?.textContent ?? null
  const emptyButtons = [...document.querySelectorAll('.boundary-editor button')].map((button) => button.textContent?.trim() ?? '')
  // ADD SILENCE places a PLACEHOLDER: a source with nothing behind it, named for what it is and drawn with
  // the same two trim handles every clip has — which is what lets it be stretched to any length.
  const silenceButton = [...document.querySelectorAll('.boundary-editor button')].find((button) => button.textContent?.trim() === 'ADD SILENCE') as HTMLButtonElement | undefined
  silenceButton?.click()
  await wait(300)
  const clipsAfterSilence = [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const silenceClip = clipsAfterSilence.find((clip) => clip.querySelector('.timeline-clip-name')?.textContent === 'SILENCE 1') ?? null
  const silenceHandles = silenceClip ? silenceClip.querySelectorAll('.clip-trim-handle').length : 0
  result.emptyLane = {
    laneCount: emptyLanes.length, hasClip: emptyHasClip, hasMark: Boolean(emptyMark), panelTitle: emptyPanelTitle, buttons: emptyButtons,
    silencePlaced: Boolean(silenceClip), silenceHandles, silenceNames: clipsAfterSilence.map((clip) => clip.querySelector('.timeline-clip-name')?.textContent ?? null),
  }

  // A BLANK IS PREVIEWED IN THE MONITOR, not only boxed on the timeline. A blank has no media element to ride,
  // so the monitor paints its colour into a box of its own — and that box has to have a SIZE. A width-only div
  // in the frame's plain-block window collapsed to no height, so the colour was drawn into nothing and the
  // monitor showed only the frame's black while the timeline's clip box, which paints the colour itself, showed it.
  const blankPath = 'placeholder:video:mount-blank-1:cc3344'
  const blankTask = {
    ...task, id: 'mount-blank-preview', type: 'stitch' as const,
    sourcePaths: [CLIP_FIXTURE, blankPath, CLIP_FIXTURE],
    trimPoints: { [blankPath]: { in: 0, out: 2 } },
  }
  flushEdits()
  await wait(200)
  arrive(blankTask, 'blank-preview')
  await wait(1200)
  const blankClip = [...document.querySelectorAll('.timeline-clip')].find((clip) => clip.querySelector('.timeline-clip-name')?.textContent === 'BLANK 1') as HTMLElement | undefined
  const blankSwatch = blankClip?.querySelector('.clip-blank') as HTMLElement | null
  const clipBackground = blankSwatch ? getComputedStyle(blankSwatch).backgroundColor : null
  // Clicked at its own centre, so the seek lands inside the blank (a bare click would bubble to the lane's
  // click-to-seek and read the playhead's far-left edge).
  if (blankClip) {
    const rect = blankClip.getBoundingClientRect()
    blankClip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }))
  }
  await wait(800)
  const monitorBlank = document.querySelector('.editor-frame-window .editor-blank') as HTMLElement | null
  // Read BEFORE the transport is started: once the playhead leaves the blank this node is unmounted and would
  // measure nothing.
  const monitorWidth = monitorBlank ? monitorBlank.clientWidth : 0
  const monitorHeight = monitorBlank ? monitorBlank.clientHeight : 0
  const monitorBackground = monitorBlank ? getComputedStyle(monitorBlank).backgroundColor : null
  // AND THE TRANSPORT RUNS THROUGH IT. Clicking the blank put the playhead at its own start; PLAY must then
  // carry it ON. A placeholder has no media element, so without the anchored clock the playhead held at the
  // blank's start forever, waiting for an element that never came.
  const playButton = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes('PLAY')) as HTMLButtonElement | undefined
  playButton?.click()
  await wait(1600)
  const reached = Number((document.querySelector('.transport-scrub') as HTMLInputElement | null)?.value ?? -1)
  const stateWhilePlaying = document.querySelector('.transport button[aria-label="Pause"]') ? 'PLAYING' : 'PAUSED'
  playButton?.click()
  await wait(200)
  // THE PROPERTIES DRAWER. The VIDEO CODEC line, which the inspector had only for the sound, and the BLANK's
  // FILL COLOR, which has to be a SWATCH in the value column the stamps above it occupy.
  const openProps = async (clip: HTMLElement) => {
    const rect = clip.getBoundingClientRect()
    clip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.top + 4 }))
    await wait(150)
    const item = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'PROPERTIES') as HTMLButtonElement | undefined
    item?.click()
    await wait(200)
  }
  const firstClip = [...document.querySelectorAll('.timeline-clip')][0] as HTMLElement | undefined
  if (firstClip) await openProps(firstClip)
  const videoCodecLine = rowValue('VIDEO CODEC')
  const audioCodecLine = rowValue('AUDIO CODEC')
  const blankClipAgain = [...document.querySelectorAll('.timeline-clip')].find((clip) => clip.querySelector('.timeline-clip-name')?.textContent === 'BLANK 1') as HTMLElement | undefined
  if (blankClipAgain) await openProps(blankClipAgain)
  const swatch = document.querySelector('.editor-color input[type="color"]') as HTMLInputElement | null
  const swatchRect = swatch?.getBoundingClientRect()
  const swatchRow = swatch?.closest('.editor-row') as HTMLElement | null
  result.blankPreview = {
    clipPlaced: Boolean(blankClip),
    clipBackground,
    monitorPresent: Boolean(monitorBlank),
    monitorWidth,
    monitorHeight,
    monitorBackground,
    blankStart: 12,
    playStarted: Boolean(playButton) && String(stateWhilePlaying).includes('PLAYING'),
    reached,
    videoCodecLine,
    audioCodecLine,
    fillLabel: swatchRow?.querySelector('span')?.textContent?.trim() ?? null,
    swatchInValueColumn: Boolean(swatchRow?.querySelector('strong')?.contains(swatch ?? null)),
    swatchWidth: swatchRect ? Math.round(swatchRect.width) : 0,
    swatchHeight: swatchRect ? Math.round(swatchRect.height) : 0,
    swatchValue: swatch?.value ?? null,
  }

  // THE MODE FOLLOWS THE LIST. A CONVERT is one source; duplicating that source makes the job a STITCH, and
  // the window has to say so BEFORE APPLY rather than leaving a stale heading over a list that changed. The
  // same rule the queue re-reads when the patch lands, so the two cannot disagree.
  flushEdits()
  await wait(200)
  arrive(task, 'mode-change')
  await wait(900)
  const modeKicker = () => {
    const node = [...document.querySelectorAll('.panel-kicker')].find((candidate) => (candidate.textContent || '').startsWith('TIMELINE //'))
    return (node?.textContent || '').replace('TIMELINE // ', '').trim()
  }
  const beforeMode = modeKicker()
  const modeClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  modeClips()[0]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const modeDuplicate = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'DUPLICATE...') as HTMLButtonElement | undefined
  modeDuplicate?.click()
  await wait(150)
  const modePlaceAfter = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'PLACE AFTER') as HTMLButtonElement | undefined
  modePlaceAfter?.click()
  await wait(300)
  result.modeChange = { beforeMode, afterMode: modeKicker(), clips: modeClips().length }

  // THE FIRST SOUND ASKS HOW THE TRACKS RELATE. Adding an AUDIO file through a [+] on a job with no tracks
  // must offer MULTI-TRACK (stacked) or STITCH TRACKS (sequenced) before anything is inserted, and the
  // answer must reach the queue as `comboMode`.
  flushEdits()
  await wait(200)
  arrive(task, 'audio-ask')
  await wait(900)
  nextSelection = ['/tmp/added.wav']
  const askClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  ;(askClips()[0]?.querySelector('.boundary-add.is-head') as HTMLElement | null)?.click()
  await wait(150)
  const askAdd = [...document.querySelectorAll('.boundary-editor .boundary-source')].find((button) => button.textContent?.trim() === 'ADD SOURCE') as HTMLButtonElement | undefined
  askAdd?.click()
  await wait(300)
  const askButtons = [...document.querySelectorAll('.boundary-editor button')].map((button) => button.textContent?.trim() ?? '')
  const stitchChoice = [...document.querySelectorAll('.boundary-editor button')].find((button) => button.textContent?.trim() === 'STITCH TRACKS') as HTMLButtonElement | undefined
  stitchChoice?.click()
  await wait(300)
  nextSelection = null
  const lanesAfterAsk = document.querySelectorAll('.timeline-lane').length
  const applyAsk = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyAsk?.click()
  await wait(250)
  const askPatch = applied[applied.length - 1] as { comboMode?: string; additionalAudioTracks?: unknown[] } | undefined
  result.audioAsk = { askButtons, lanesAfterAsk, comboMode: askPatch?.comboMode ?? null, trackCount: askPatch?.additionalAudioTracks?.length ?? 0 }

  // A STITCH UP OF SOUND HAS NO SECOND LANE TO ADD SOUND TO. Its sources ARE the sequence, so a [+] adds the
  // chosen file to that sequence rather than to a track list: a job whose sources are all sound is a STITCH,
  // which draws no track lane and whose encoder path writes none, so an add routed to a track was neither seen
  // nor exported — the [+] that did nothing at all.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-sound-stitch', type: 'stitch', sourcePaths: [SOUND_FIXTURE, SOUND_FIXTURE], additionalAudioTracks: undefined }, 'sound-stitch-add')
  await wait(900)
  nextSelection = [SOUND_FIXTURE]
  const soundClipsBefore = document.querySelectorAll('.timeline-clip').length
  ;(document.querySelector('.timeline-clip .boundary-add.is-head') as HTMLElement | null)?.click()
  await wait(150)
  // An all-SOUND lane's edges fade from or to SILENCE, not black: there is no black on a lane that carries none.
  const soundHeadTitle = (document.querySelector('.boundary-editor .boundary-title') as HTMLElement | null)?.textContent ?? null
  const soundAdd = [...document.querySelectorAll('.boundary-editor .boundary-source')].find((button) => button.textContent?.trim() === 'ADD SOURCE') as HTMLButtonElement | undefined
  soundAdd?.click()
  await wait(300)
  nextSelection = null
  const soundClipsAfter = document.querySelectorAll('.timeline-clip').length
  const applySoundStitch = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applySoundStitch?.click()
  await wait(250)
  const soundStitchPatch = applied[applied.length - 1] as { sourcePaths?: string[]; additionalAudioTracks?: unknown[] } | undefined
  result.soundStitchAdd = { headTitle: soundHeadTitle, before: soundClipsBefore, after: soundClipsAfter, sourceCount: soundStitchPatch?.sourcePaths?.length ?? 0, trackCount: soundStitchPatch?.additionalAudioTracks?.length ?? 0 }

  // THE DELETE KEY REACHES AN ADDED AUDIO TRACK. A selection on an audio lane was left out of the Delete
  // question, so a track could only be taken out through its own menu. It asks the SAME question now.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-track-delete', type: 'multitrack', sourcePaths: [CLIP_FIXTURE], additionalAudioTracks: [{ id: 'tA', path: SOUND_FIXTURE, language: 'und' }, { id: 'tB', path: '/tmp/track-b.wav', language: 'und' }] }, 'track-delete')
  await wait(1200)
  const everyClip = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const lanesBeforeDelete = document.querySelectorAll('.timeline-lane-head').length
  // Clips are in lane order: the video's first, then the tracks'.
  everyClip()[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  await wait(200)
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete', key: 'Delete', bubbles: true }))
  await wait(200)
  const trackDeleteHead = ([...document.querySelectorAll('.timeline-menu-head')].map((node) => node.textContent ?? '')).find((text) => text.startsWith('REMOVE ')) ?? null
  const trackRemove = [...document.querySelectorAll('.timeline-menu-actions button')].find((button) => button.textContent?.trim() === 'REMOVE') as HTMLButtonElement | undefined
  trackRemove?.click()
  await wait(300)
  const lanesAfterDelete = document.querySelectorAll('.timeline-lane-head').length
  const applyTrackDelete = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyTrackDelete?.click()
  await wait(250)
  const trackDeletePatch = applied[applied.length - 1] as { additionalAudioTracks?: unknown[] } | undefined
  result.trackDelete = { head: trackDeleteHead, lanesBefore: lanesBeforeDelete, lanesAfter: lanesAfterDelete, tracksAfter: trackDeletePatch?.additionalAudioTracks?.length ?? 0 }

  // KEEP IT DISMISSES the removal question rather than re-opening the menu behind it.
  flushEdits()
  await wait(200)
  arrive(task, 'keep-it')
  await wait(900)
  const keepClip = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  keepClip()[0]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const keepRemoveSource = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'REMOVE SOURCE') as HTMLButtonElement | undefined
  keepRemoveSource?.click()
  await wait(150)
  const keepItButton = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'KEEP IT') as HTMLButtonElement | undefined
  keepItButton?.click()
  await wait(200)
  result.keepIt = { menuOpen: Boolean(document.querySelector('.timeline-menu')), clips: keepClip().length }

  // AN AUDIO LANE'S OWN FADE IS HEARD IN THE PREVIEW. The picture element carried the fade (its volume and
  // opacity), but an added track's <audio> did not, so a fade on a sound clip was silent. Each lane's OWN
  // clip fade is multiplied into its element's volume now, so at the very head of a 1s fade it reads zero.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-audio-fade', type: 'multitrack', sourcePaths: [CLIP_FIXTURE], additionalAudioTracks: [{ id: 'tA', path: SOUND_FIXTURE, language: 'und' }], transitions: { [`${SOUND_FIXTURE}#0::head`]: { type: 'fade', duration: 1 } } }, 'audio-fade-preview')
  await wait(1200)
  const fadedAudioVolume = (document.querySelector('audio') as HTMLAudioElement | null)?.volume ?? null
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-audio-nofade', type: 'multitrack', sourcePaths: [CLIP_FIXTURE], additionalAudioTracks: [{ id: 'tA', path: SOUND_FIXTURE, language: 'und' }] }, 'audio-no-fade-preview')
  await wait(1200)
  const plainAudioVolume = (document.querySelector('audio') as HTMLAudioElement | null)?.volume ?? null
  result.audioFadePreview = { faded: fadedAudioVolume, plain: plainAudioVolume }

  // A CLIP'S OWN SOUND ON ONE SWITCH, from its context menu. MUTE silences THIS clip — the lane's M silences the
  // whole lane — the box is shaded, and the mute reaches the queue as the clip's embedded record.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-clip-mute', type: 'transcode', sourcePaths: [CLIP_AUDIO] }, 'clip-mute')
  await wait(1200)
  const clipMuteBox = () => document.querySelector('.timeline-clip') as HTMLElement | null
  const clipMuteShadedBefore = Boolean(clipMuteBox()?.classList.contains('is-muted'))
  clipMuteBox()?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const clipMuteItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'MUTE CLIP') as HTMLButtonElement | undefined
  clipMuteItem?.click()
  await wait(300)
  const clipMuteShadedAfter = Boolean(clipMuteBox()?.classList.contains('is-muted'))
  const applyClipMute = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyClipMute?.click()
  await wait(250)
  const clipMutePatch = applied[applied.length - 1] as { embeddedAudio?: Record<string, Array<{ index?: number; muted?: boolean }>> } | undefined
  const clipMuteRecord = clipMutePatch?.embeddedAudio?.[`${CLIP_AUDIO}#0`] ?? []
  result.clipMute = { hadItem: Boolean(clipMuteItem), shadedBefore: clipMuteShadedBefore, shadedAfter: clipMuteShadedAfter, mutedIndexes: clipMuteRecord.filter((entry) => entry.muted).map((entry) => entry.index) }

  // A CLIP MUTED IN A COMBO GOES QUIET. The monitor applied a clip's own mute only where the in-place controls
  // were offered (a CONVERT or a MULTI-TRACK), while the encoder silenced the clip on EVERY path — so a COMBO's
  // muted clip still sounded. The monitor follows the mute everywhere now.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-combo-mute', type: 'combo', comboMode: 'multitrack', sourcePaths: [CLIP_AUDIO, CLIP_AUDIO], embeddedAudio: { [`${CLIP_AUDIO}#0`]: [{ index: 0, muted: true }] } }, 'combo-mute')
  await wait(1200)
  const comboMuteVideo = document.querySelector('video') as HTMLVideoElement | null
  result.comboMute = { videoMuted: comboMuteVideo?.muted ?? null }

  // ADD SOURCE ON A MULTI-TRACK'S VIDEO LANE. A new picture added at the main lane's [+] splices into the join
  // beside the one already there — the same place a DUPLICATE lands.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-video-add', type: 'multitrack', sourcePaths: [CLIP_FIXTURE], additionalAudioTracks: [{ id: 'tA', path: SOUND_FIXTURE, language: 'und' }] }, 'video-add')
  await wait(1200)
  const videoAddBefore = document.querySelectorAll('.timeline-clip').length
  nextSelection = [CLIP_AUDIO]
  ;(document.querySelector('.timeline-clip .boundary-add.is-head') as HTMLElement | null)?.click()
  await wait(150)
  const videoAddButton = [...document.querySelectorAll('.boundary-editor .boundary-source')].find((button) => button.textContent?.trim() === 'ADD SOURCE') as HTMLButtonElement | undefined
  videoAddButton?.click()
  await wait(1200)
  nextSelection = null
  const videoAddClips = [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const videoAddAfter = videoAddClips.length
  // A clip whose NEW source was not PROBED has no length and draws at zero width, which is how an added
  // picture "did not land" while a DUPLICATE of an already-probed file showed up.
  const videoAddMinWidth = videoAddClips.length ? Math.min(...videoAddClips.map((clip) => clip.getBoundingClientRect().width)) : 0
  const applyVideoAdd = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyVideoAdd?.click()
  await wait(250)
  const videoAddPatch = applied[applied.length - 1] as { sourcePaths?: string[] } | undefined
  result.videoAdd = { before: videoAddBefore, after: videoAddAfter, minWidth: videoAddMinWidth, sourceCount: videoAddPatch?.sourcePaths?.length ?? 0 }

  // A MUTE LANDS ON THE CLIP IT WAS PUT ON. A sound-only main lane and a SEQUENCED track lane each hold several
  // clips, and the monitor used to ask the lane's FIRST clip for all of them — which is why muting the first
  // track of a stitch silenced every track on it and muting the rest did nothing.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-stitch-mute-2', type: 'stitch', sourcePaths: [SOUND_FIXTURE, SOUND_FIXTURE], embeddedAudio: { [`${SOUND_FIXTURE}#1`]: [{ index: 0, muted: true }] } }, 'stitch-mute-2')
  await wait(1200)
  const stitchMuteAudios = [...document.querySelectorAll('audio')] as HTMLAudioElement[]
  result.stitchMute = { count: stitchMuteAudios.length, firstMuted: stitchMuteAudios[0]?.muted ?? null, secondMuted: stitchMuteAudios[1]?.muted ?? null }

  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-seq-mute-2', type: 'combo', comboMode: 'stitch', sourcePaths: [CLIP_FIXTURE], additionalAudioTracks: [{ id: 't1', path: SOUND_FIXTURE, language: 'und' }, { id: 't2', path: '/tmp/track-b.wav', language: 'und' }], mutedLanes: { t2: true } }, 'seq-mute-2')
  await wait(1200)
  const seqMuteAudios = [...document.querySelectorAll('audio')] as HTMLAudioElement[]
  result.seqMute = { count: seqMuteAudios.length, firstMuted: seqMuteAudios[0]?.muted ?? null, secondMuted: seqMuteAudios[1]?.muted ?? null }

  // THE TITLE AND THE LANES FOR A COMBO'S OWN MODE. A combo's heading names which of its two arrangements it
  // is, and its tracks land on ONE lane when they are sequenced rather than one each.
  flushEdits()
  await wait(200)
  const comboTask = {
    id: 'mount-check-combo', type: 'combo', comboMode: 'stitch', status: 'pending', progress: 0,
    sourcePaths: [CLIP_FIXTURE, CLIP_FIXTURE],
    additionalAudioTracks: [{ id: 't1', path: '/tmp/track-a.wav', language: 'und' }, { id: 't2', path: '/tmp/track-b.wav', language: 'und' }],
    outputDirectory: '/tmp', outputFilename: 'combo.mp4',
    preset: { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p' },
  }
  arrive(comboTask, 'combo-stitch')
  await wait(900)
  const headerTitle = () => (document.querySelector('.editor-header .panel-kicker')?.textContent ?? '')
  const comboStitchTitle = headerTitle()
  const comboStitchLanes = document.querySelectorAll('.timeline-lane').length
  arrive({ ...comboTask, comboMode: 'multitrack' }, 'combo-multitrack')
  await wait(600)
  const comboMultiTitle = headerTitle()
  const comboMultiLanes = document.querySelectorAll('.timeline-lane').length
  const comboMultiLabels = [...document.querySelectorAll('.timeline-lane-head span')].map((node) => node.textContent ?? '')
  result.comboMode = { comboStitchTitle, comboStitchLanes, comboMultiTitle, comboMultiLanes, comboMultiLabels }

  // HOW SEVERAL AUDIO LANES GO INTO THE FILE. A multi-track that plays its lanes at once is the ONE job the
  // TRACK OUTPUT setting can change — a stream per lane, or the lanes summed — and the setting is REFUSED
  // where the file cannot tell the two apart (a sequenced set is one stream already, a drawing builds its own
  // mix) or where the container cannot hold a second stream. Read from the window's AUDIO pane, chosen on a
  // real click, and the choice has to reach the queue as the preset.
  flushEdits()
  await wait(120)
  arrive({ ...comboTask, id: 'mount-track-output', comboMode: 'multitrack' }, 'track-output')
  await wait(500)
  clickTab('AUDIO')
  await wait(120)
  const layoutSelect = () => selectIn('TRACK OUTPUT')
  const layoutNote = () => [...document.querySelectorAll('.editor-note')].map((node) => node.textContent ?? '').find((text) => /SUMM|SEQUENCED|CARRIES ONE/.test(text)) ?? null
  // What each entry of the dropdown says it is, and whether it can be taken: `separate:off` is the answer a
  // one-track container cannot give. Read off the options themselves, which are in the DOM even while closed.
  const layoutOptions = () => layoutSelect() ? [...(layoutSelect() as HTMLElement).querySelectorAll('.editor-select-option')].map((option) => `${option.getAttribute('data-value')}:${option.hasAttribute('disabled') ? 'off' : 'on'}`) : null
  const laneDrawn = Boolean(fieldFor('TRACK OUTPUT'))
  const laneValue = valueOf(layoutSelect())
  const laneDisabled = fieldDisabled('TRACK OUTPUT')
  const laneOptions = layoutOptions()
  // The CLIPPING GUARD has nothing to catch while the lanes are APART, so it is not drawn until they are summed.
  const lanePreventBefore = Boolean(toggleInput('PREVENT CLIPPING'))
  chooseOption(layoutSelect(), 'mixdown')
  await wait(150)
  const lanePreventShown = Boolean(toggleInput('PREVENT CLIPPING'))
  const lanePreventDefault = toggleInput('PREVENT CLIPPING')?.checked ?? null
  toggleInput('PREVENT CLIPPING')?.click()
  await wait(120)
  const applyLayout = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyLayout?.click()
  await wait(180)
  const layoutPatch = applied[applied.length - 1] as { preset?: { audioLayout?: string; audioPreventClipping?: boolean } } | undefined
  const laneChose = layoutPatch?.preset?.audioLayout ?? null
  const laneGuard = layoutPatch?.preset?.audioPreventClipping ?? null
  result.trackOutput = { laneDrawn, laneValue, laneDisabled, laneOptions, lanePreventBefore, lanePreventShown, lanePreventDefault, laneChose, laneGuard }

  // A SEQUENCED set of tracks is one concatenated stream already, so the whole setting is refused with its reason.
  flushEdits()
  await wait(120)
  arrive({ ...comboTask, id: 'mount-track-output-seq' }, 'track-output-sequenced')
  await wait(500)
  clickTab('AUDIO')
  await wait(120)
  result.trackOutput = { ...(result.trackOutput as object), sequencedValue: valueOf(layoutSelect()), sequencedDisabled: fieldDisabled('TRACK OUTPUT'), sequencedNote: layoutNote(), sequencedPrevent: Boolean(toggleInput('PREVENT CLIPPING')) }

  // A container that carries ONE stream has no second answer to offer, so SEPARATE is refused and MIXDOWN is
  // what it will write — the reason names the format rather than leaving it to be found out by a failed job.
  flushEdits()
  await wait(120)
  arrive({ ...comboTask, id: 'mount-track-output-wav', comboMode: 'multitrack', outputFilename: 'combo.wav', preset: { ...comboTask.preset, container: 'wav', audioCodec: 'pcm' } }, 'track-output-wav')
  await wait(500)
  clickTab('AUDIO')
  await wait(120)
  result.trackOutput = { ...(result.trackOutput as object), wavValue: valueOf(layoutSelect()), wavDisabled: fieldDisabled('TRACK OUTPUT'), wavOptions: layoutOptions(), wavNote: layoutNote(), wavPrevent: Boolean(toggleInput('PREVENT CLIPPING')) }

  // A DRAWING builds its own mix out of the lanes, so there is nothing left for this setting to decide.
  flushEdits()
  await wait(120)
  arrive({ ...comboTask, id: 'mount-track-output-drawing', comboMode: 'multitrack', sourcePaths: [SOUND_FIXTURE], preset: { ...comboTask.preset, audioPicture: 'visualization' } }, 'track-output-drawing')
  await wait(500)
  clickTab('AUDIO')
  await wait(120)
  result.trackOutput = { ...(result.trackOutput as object), drawingValue: valueOf(layoutSelect()), drawingDisabled: fieldDisabled('TRACK OUTPUT'), drawingNote: layoutNote(), drawingPrevent: Boolean(toggleInput('PREVENT CLIPPING')) }

  // A CLIP'S OWN EMBEDDED SOUND, in PROPERTIES. A video that carries a soundtrack offers one row per stream,
  // each with a mute and a level and a way to EXTRACT it to a track; a mute has to reach the queue as
  // `embeddedAudio`, the clip's own green line has to DIM while it does, and extraction has to land a track
  // that NAMES the stream it came from rather than copying the file.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-check-embed', type: 'transcode', sourcePaths: [CLIP_AUDIO] }, 'embedded-audio')
  await wait(1400)
  const embedClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  const dotDimmedBefore = Boolean(embedClips()[0]?.querySelector('.clip-audio')?.classList.contains('is-muted'))
  embedClips()[0]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const propsItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'PROPERTIES') as HTMLButtonElement | undefined
  propsItem?.click()
  await wait(300)
  const streamRows = document.querySelectorAll('.embedded-stream').length
  const streamLabels = [...document.querySelectorAll('.embedded-stream .editor-toggle span')].map((node) => node.textContent ?? '')
  const muteBox = document.querySelector('.embedded-stream .editor-toggle input[type=checkbox]') as HTMLInputElement | null
  muteBox?.click()
  await wait(200)
  const dotDimmedAfter = Boolean(embedClips()[0]?.querySelector('.clip-audio')?.classList.contains('is-muted'))
  const applyEmbed = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyEmbed?.click()
  await wait(250)
  const embedPatch = applied[applied.length - 1] as { embeddedAudio?: Record<string, unknown> } | undefined
  const embedKeys = embedPatch?.embeddedAudio ? Object.keys(embedPatch.embeddedAudio) : []
  // EXTRACT AUDIO TO TRACK, from the same clip menu: with one stream it acts at once and the new track names
  // the stream (`streamIndex`) and its clip (`sourceClipId`).
  embedClips()[0]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const extractItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => (button.textContent ?? '').startsWith('EXTRACT AUDIO TO TRACK')) as HTMLButtonElement | undefined
  extractItem?.click()
  await wait(300)
  const applyExtract = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyExtract?.click()
  await wait(250)
  const extractPatch = applied[applied.length - 1] as { additionalAudioTracks?: Array<{ streamIndex?: number; sourceClipId?: string }> } | undefined
  result.embeddedAudio = {
    streamRows, streamLabels, dotDimmedBefore, dotDimmedAfter, embedKeys,
    extractTrack: (extractPatch?.additionalAudioTracks || []).find((track) => track.sourceClipId) ?? null,
  }

  // A PER-CLIP LEVEL ON AN AUDIO SOURCE: the inspector offers a LEVEL on a sound clip, and it reaches the
  // queue as `embeddedAudio` under that clip's own id.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-sound', type: 'transcode', sourcePaths: [SOUND_FIXTURE] }, 'sound-level')
  await wait(1200)
  ;(document.querySelector('.timeline-clip') as HTMLElement | null)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await wait(120)
  ;(document.querySelector('.timeline-clip') as HTMLElement | null)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))
  await wait(150)
  const soundProps = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'PROPERTIES') as HTMLButtonElement | undefined
  soundProps?.click()
  await wait(300)
  const soundLevelField = [...document.querySelectorAll('.inspector-scroll .editor-field')].some((field) => (field.querySelector('span')?.textContent ?? '').startsWith('LEVEL'))
  const soundLevelInput = [...document.querySelectorAll('.inspector-scroll .editor-field input')].find((input) => (input.getAttribute('aria-label') ?? '').includes('level in dB')) as HTMLInputElement | undefined
  if (soundLevelInput) setNativeValue(soundLevelInput, '-15')
  await wait(150)
  const applySound = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applySound?.click()
  await wait(250)
  const soundPatch = applied[applied.length - 1] as { embeddedAudio?: Record<string, Array<{ gainDb?: number }>> } | undefined
  const soundGain = soundPatch?.embeddedAudio ? Object.values(soundPatch.embeddedAudio)[0]?.[0]?.gainDb ?? null : null
  result.soundLevel = { hasField: soundLevelField, gainDb: soundGain }

  // A TRACK'S LEVEL, on its lane: an added track's head carries a dB field beside its M, and setting it reaches
  // the queue as that track's own `gainDb`.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-gain', type: 'multitrack', sourcePaths: [CLIP_FIXTURE], additionalAudioTracks: [{ id: 't1', path: CLIP_AUDIO, language: 'und' }] }, 'track-gain')
  await wait(900)
  const gainInput = document.querySelector('.lane-gain-input') as HTMLInputElement | null
  const gainShown = gainInput?.value ?? null
  if (gainInput) setNativeValue(gainInput, '-12')
  await wait(150)
  const applyGain = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyGain?.click()
  await wait(250)
  const gainPatch = applied[applied.length - 1] as { additionalAudioTracks?: Array<{ id: string; gainDb?: number }> } | undefined
  result.trackGain = { shown: gainShown, gainDb: gainPatch?.additionalAudioTracks?.find((track) => track.id === 't1')?.gainDb ?? null }

  // GROUP SELECTION AND THE SPLIT. Shift takes a RUN of clips on one lane; RESET TRIM then acts on all of them.
  // A bare C cuts the selected clip in two at the skimmer.
  flushEdits()
  await wait(200)
  const groupTask = {
    ...task, id: 'mount-groups', type: 'stitch',
    sourcePaths: [CLIP_FIXTURE, CLIP_FIXTURE, CLIP_FIXTURE],
    trimPoints: { [`${CLIP_FIXTURE}#0`]: { in: 1, out: 5 }, [`${CLIP_FIXTURE}#1`]: { in: 1, out: 5 }, [`${CLIP_FIXTURE}#2`]: { in: 1, out: 5 } },
  }
  arrive(groupTask, 'groups')
  await wait(900)
  const groupClips = () => [...document.querySelectorAll('.timeline-clip')] as HTMLElement[]
  groupClips()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await wait(80)
  groupClips()[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
  await wait(120)
  const groupSelected = document.querySelectorAll('.timeline-clip.is-selected').length
  groupClips()[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 60 }))
  await wait(150)
  const resetGroupItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => (button.textContent ?? '').startsWith('RESET TRIM')) as HTMLButtonElement | undefined
  const resetLabel = resetGroupItem?.textContent ?? null
  resetGroupItem?.click()
  await wait(200)
  const applyGroup = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyGroup?.click()
  await wait(250)
  const groupPatch = applied[applied.length - 1] as { trimPoints?: Record<string, unknown> } | undefined
  // GROUP REMOVE: two of the three, asked through Delete and the one confirmation.
  arrive(groupTask, 'group-remove')
  await wait(700)
  groupClips()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await wait(80)
  groupClips()[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
  await wait(120)
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete', bubbles: true }))
  await wait(180)
  const removeHead = ([...document.querySelectorAll('.timeline-menu-head')].map((node) => node.textContent ?? '')).join(' | ')
  const removeGo = [...document.querySelectorAll('.timeline-menu-actions button')].find((button) => button.textContent?.trim() === 'REMOVE') as HTMLButtonElement | undefined
  removeGo?.click()
  await wait(200)
  const applyRemove = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applyRemove?.click()
  await wait(250)
  const removePatch = applied[applied.length - 1] as { sourcePaths?: string[] } | undefined
  result.timelineGroups = { groupSelected, resetLabel, groupTrimPoints: groupPatch?.trimPoints ?? null, removeHead, remaining: removePatch?.sourcePaths?.length ?? null }

  // THE SPLIT. The clip is clicked at its own middle — which is where the lane's click-to-seek puts the
  // skimmer — and a bare C cuts it there.
  flushEdits()
  await wait(200)
  arrive({ ...task, id: 'mount-split' }, 'split')
  await wait(900)
  const splitClip = document.querySelector('.timeline-clip') as HTMLElement | null
  const splitRect = splitClip?.getBoundingClientRect()
  const splitClipsBefore = document.querySelectorAll('.timeline-clip').length
  if (splitClip && splitRect) {
    splitClip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: splitRect.left + splitRect.width / 2, clientY: splitRect.top + splitRect.height / 2 }))
    await wait(200)
  }
  const splitReadout = (document.querySelector('.timeline-gutter-ruler') as HTMLElement | null)?.textContent ?? null
  const splitClipText = (document.querySelector('.timeline-clip small') as HTMLElement | null)?.textContent ?? null
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', bubbles: true }))
  await wait(250)
  const afterKey = document.querySelectorAll('.timeline-clip').length
  let splitMenuDisabled: boolean | null = null
  if (afterKey === splitClipsBefore) {
    splitClip?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: (splitRect?.left ?? 60) + 4, clientY: (splitRect?.top ?? 60) + 4 }))
    await wait(150)
    const splitItem = [...document.querySelectorAll('.timeline-menu button')].find((button) => button.textContent?.trim() === 'SPLIT AT SKIMMER') as HTMLButtonElement | undefined
    splitMenuDisabled = splitItem ? Boolean(splitItem.disabled) : null
    splitItem?.click()
    await wait(200)
  }
  const splitClipsAfter = document.querySelectorAll('.timeline-clip').length
  const applySplit = [...document.querySelectorAll('.editor-actions button')].find((button) => button.textContent?.trim() === 'APPLY') as HTMLButtonElement | undefined
  applySplit?.click()
  await wait(250)
  const splitPatch = applied[applied.length - 1] as { sourcePaths?: string[]; trimPoints?: Record<string, { in: number; out: number }>; clipIds?: string[] } | undefined
  const splitTrims = splitPatch?.trimPoints ? Object.values(splitPatch.trimPoints) : []
  result.splitClip = { before: splitClipsBefore, afterKey, after: splitClipsAfter, menuDisabled: splitMenuDisabled, paths: splitPatch?.sourcePaths?.length ?? null, halves: splitTrims.length, idCount: splitPatch?.clipIds?.length ?? null, readout: splitReadout, clipText: splitClipText, trims: splitTrims }

  // THE ZOOM PANEL ITSELF, read last so changing the zoom for the CUSTOM field disturbs nothing before it. The
  // list has to be wide enough to READ, the CUSTOM field compact rather than a browser-sized number box, and the
  // control inset from the monitor's own corner rather than jammed into it.
  {
    const dock = document.querySelector('.preview-zoom-dock') as HTMLElement | null
    const screen = document.querySelector('.editor-screen') as HTMLElement | null
    const d = dock?.getBoundingClientRect()
    const s = screen?.getBoundingClientRect()
    ;(dock?.querySelector('.editor-select-trigger') as HTMLElement | null)?.click()
    await wait(80)
    const menu = dock?.querySelector('.editor-select-menu') as HTMLElement | null
    const options = [...(menu?.querySelectorAll('.editor-select-option') ?? [])] as HTMLElement[]
    const cropped = options.filter((option) => option.scrollWidth > option.clientWidth + 1).map((option) => option.textContent ?? '')
    const menuWidth = menu ? menu.getBoundingClientRect().width : 0
    options.find((option) => (option.textContent ?? '').includes('CUSTOM'))?.click()
    await wait(80)
    const field = document.querySelector('.preview-zoom-field input') as HTMLElement | null
    const f = field?.getBoundingClientRect()
    result.zoomPanel = {
      fromLeft: d && s ? +(d.left - s.left).toFixed(1) : null,
      fromBottom: d && s ? +(s.bottom - d.bottom).toFixed(1) : null,
      menuWidth: +menuWidth.toFixed(1),
      optionCount: options.length,
      cropped,
      fieldWidth: f ? +f.width.toFixed(1) : null,
      fieldHeight: f ? +f.height.toFixed(1) : null,
    }
  }

  ;(window as unknown as Record<string, unknown>).__MOUNT_DONE = true
}

void drive().catch((error) => { errors.push('the drive threw: ' + String(error)); ;(window as unknown as Record<string, unknown>).__MOUNT_DONE = true })
