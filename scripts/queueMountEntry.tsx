import React from 'react'
import { createRoot } from 'react-dom/client'
import { TaskCard } from '../src/components/TaskCard'
import { SettingsModal } from '../src/components/SettingsModal'
import { Header } from '../src/components/Header'
import { QueueTask } from '../src/types'

/**
 * Renders a QUEUE card for real, in a page, and reports what it drew and where it put it.
 *
 * The queue had NO render coverage at all: `check-mount` mounts the EDIT JOB window, `measure` measures
 * hand-written markup, and `verify` is arithmetic — so a card that set its filename at the wrong size, or ran
 * a divider short of the card's edge, or left an added audio track's name unclickable, could only be found by
 * looking at it. What is asked here is the layout a reader sees, and what a CLICK on a row does.
 *
 * The fixture is a MULTI-TRACK: one picture and two tracks, so both kinds of row are drawn — a SOURCE and an
 * added AUDIO track — and the track's own name can be compared with the source's.
 *
 * The bridge is a stub: this is about the card's own render, not about IPC.
 */
const errors: string[] = []
window.addEventListener('error', (event) => { errors.push(String(event.message || event.error)) })
window.addEventListener('unhandledrejection', (event) => { errors.push('unhandled rejection: ' + String(event.reason)) })

const noop = () => undefined
/** What the card ASKED to replace, so a click on a row can be read rather than assumed. */
const replaceCalls: Array<{ kind: string; target: string }> = []
;(window as unknown as { electronAPI: unknown }).electronAPI = {
  probeMedia: async () => ({
    format: 'mp4', duration: 12, size: 0, bitrate: 0,
    videoStreams: [{ codec: 'h264', resolution: '1920x1080', fps: 25 }],
    audioStreams: [{ codec: 'aac', channels: 2, sampleRate: 48000 }],
  }),
  getPathsTotalSize: async () => 0,
  quickLook: async () => undefined,
  appVersion: async () => '0.0.0-check',
}

/** A LONG name on the first track, so the row has something to overflow and start crawling. */
const LONG_NAME = 'JapaneseFashionVlogger_a_very_long_output_name_that_will_not_fit_stitched.mp4'
const LONG_TRACK = 'The_Hidden_Heart_of_Bhagavad_gita_Chapter_10_a_very_long_track_name.wav'
const task = {
  id: 'queue-card-check', type: 'multitrack', status: 'pending', progress: 0,
  sourcePaths: ['/media/JapaneseFashionVlogger.mp4'],
  additionalAudioTracks: [
    { id: 'track-a', path: `/media/${LONG_TRACK}`, language: 'und' },
    { id: 'track-b', path: '/media/score.wav', language: 'und' },
  ],
  outputDirectory: '/out', outputFilename: LONG_NAME,
  preset: { id: 'p', name: 'CUSTOM', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p', fps: 30 },
} as unknown as QueueTask

const props = {
  task, selected: false,
  onSelectTask: noop, onOpenEditor: noop, onAddToExisting: noop, onAddSource: noop, onRemoveSource: noop,
  onReorderSources: noop, onReorderTracks: noop,
  onReplaceSource: (_task: QueueTask, sourcePath: string, sourceIndex: number) => { replaceCalls.push({ kind: 'source', target: `${sourcePath}#${sourceIndex}` }) },
  onReplaceTrack: (_task: QueueTask, trackId: string) => { replaceCalls.push({ kind: 'track', target: trackId }) },
  onChangeJobType: noop, onChangeComboMode: noop,
  onOpenPresetPicker: noop, onRemoveTask: noop, onRevealOutput: noop, onQuickLook: noop, onChangeSourceTiming: noop,
  onChangeOutputName: noop, onDuplicateTask: noop, onSkipTask: noop, onSelectAll: noop, onExpandAll: noop,
  onCollapseAll: noop, onEncodeSelected: noop, onJobDragStart: noop, onJobDrop: noop,
} as unknown as React.ComponentProps<typeof TaskCard>

const host = document.createElement('div')
host.style.width = '820px'
host.style.padding = '0'
document.body.appendChild(host)
createRoot(host).render(React.createElement(TaskCard, props))

const result: Record<string, unknown> = { errors }
;(window as unknown as Record<string, unknown>).__QUEUE_RESULT = result
;(window as unknown as Record<string, unknown>).__QUEUE_DONE = false

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const drive = async () => {
  await wait(120)
  // The card opens collapsed; the panel with the SOURCES — and so the rows the export's own is compared
  // against — only exists once it is expanded.
  window.dispatchEvent(new Event('queue-expand-all'))
  await wait(180)

  const card = document.querySelector('.queue-card') as HTMLElement | null
  const sources = document.querySelector('.queue-sources') as HTMLElement | null
  const output = document.querySelector('.queue-output') as HTMLElement | null
  const status = document.querySelector('.queue-card-status') as HTMLElement | null
  const preset = document.querySelector('.preset-controls') as HTMLElement | null
  const outputName = document.querySelector('.queue-output .source-name') as HTMLElement | null
  const sourceName = document.querySelector('.queue-sources .source-name') as HTMLElement | null
  const trackName = document.querySelector('.queue-sources .source-track-name') as HTMLElement | null
  const outputRow = document.querySelector('.queue-output-row') as HTMLElement | null
  const outputLabel = document.querySelector('.queue-output-label') as HTMLElement | null
  const outputBrief = document.querySelector('.queue-output .source-brief-details') as HTMLElement | null

  const size = (element: HTMLElement | null) => (element ? getComputedStyle(element).fontSize : null)
  const box = (element: HTMLElement | null) => { if (!element) return null; const r = element.getBoundingClientRect(); return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) } }
  const cardPadding = card ? parseFloat(getComputedStyle(card).paddingRight) : 0

  result.drawn = {
    card: Boolean(card), sources: Boolean(sources), output: Boolean(output), status: Boolean(status),
    preset: Boolean(preset), outputName: Boolean(outputName), sourceName: Boolean(sourceName), outputRow: Boolean(outputRow),
  }
  result.labels = {
    output: outputLabel?.textContent?.trim() ?? null,
    brief: outputBrief?.textContent?.trim() ?? null,
    status: status?.textContent?.trim() ?? null,
    preset: preset?.textContent?.trim() ?? null,
  }
  result.type = { output: size(outputName), source: size(sourceName), track: size(trackName) }
  result.crawling = {
    armed: Boolean(outputName?.classList.contains('source-name-cropped')),
    overflow: Boolean(outputName && outputName.scrollWidth > outputName.clientWidth),
    hasTrack: Boolean(outputName?.querySelector('.source-name-track')),
  }
  // BOTH ROWS ARE ROWS A READER CAN CLICK: a source's name is a button, and an added track's name must be one
  // too — the fault was that it was a span, so it could not be clicked at all.
  result.rows = {
    sourceTag: sourceName?.tagName ?? null,
    trackTag: trackName?.tagName ?? null,
    trackTitle: trackName?.getAttribute('title') ?? null,
    trackCrawls: Boolean(trackName?.classList.contains('source-name-cropped')),
    trackOverflow: Boolean(trackName && trackName.scrollWidth > trackName.clientWidth),
    trackHasTrack: Boolean(trackName?.querySelector('.source-name-track')),
  }
  if (trackName) trackName.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  if (sourceName) sourceName.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  await wait(80)
  result.replaceCalls = [...replaceCalls]

  // THE DROP HIGHLIGHT, which the bug reported as a card stuck looking SELECTED. It is the card's own drop
  // state, raised while files are dragged over it, and it used to be cleared only on a leave whose target was
  // the card itself — so crossing the card's own rows, or ending the drag on another card, left it raised for
  // good, and no click or DE-SELECT ALL could take it off. What is driven here is exactly that path: a raise, a
  // leave still INSIDE the card (which must NOT clear it), a leave OUTSIDE it (which must), and a drag that ends
  // elsewhere with no clean leave at all (which the dragend must clear).
  const dropActive = () => Boolean(card?.classList.contains('queue-card-drop-active'))
  if (card) {
    const rect = card.getBoundingClientRect()
    const inside = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    const outside = { clientX: rect.right + 40, clientY: rect.top + rect.height / 2 }
    const fileDrag = () => new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })
    card.dispatchEvent(fileDrag())
    await wait(40)
    const afterOver = dropActive()
    card.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, ...inside }))
    await wait(40)
    const afterInnerLeave = dropActive()
    card.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, ...outside }))
    await wait(40)
    const afterOuterLeave = dropActive()
    card.dispatchEvent(fileDrag())
    await wait(40)
    const afterOverAgain = dropActive()
    window.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }))
    await wait(40)
    const afterDragEnd = dropActive()
    result.dragHighlight = { afterOver, afterInnerLeave, afterOuterLeave, afterOverAgain, afterDragEnd }
  }

  result.edges = { sources: box(sources), card: box(card), cardPadding, output: box(output) }
  result.order = { preset: box(preset), sources: box(sources), outputRow: box(outputRow), status: box(status) }

  // THE SETTINGS PANEL, OPENED FOR REAL. It is mounted CLOSED and then opened, because the fault lived in that
  // transition: two hooks sat below `if (!isOpen) return null`, so opening the panel changed the number of hooks
  // React saw, React threw, and the WHOLE window unmounted — SETTINGS blanked the app and only a reload brought it
  // back, still shut. Rendering it open from the start would not have caught it.
  const panelHost = document.createElement('div')
  document.body.appendChild(panelHost)
  const panelRoot = createRoot(panelHost)
  const settingsFixture = {
    maxConcurrentTasks: 2, useHardwareAcceleration: true, notifyOnCompletion: true, saveTempNextToSource: true,
    pauseOnHighLoad: false, sequenceFps: 24, defaultImageFps: 25, defaultImageDuration: 10,
    timestampDisplayMode: 'timestamp' as const,
  }
  const renderPanel = (isOpen: boolean) => panelRoot.render(<SettingsModal isOpen={isOpen} onClose={() => undefined} settings={settingsFixture} onSaveSettings={() => undefined} />)
  renderPanel(false)
  await wait(80)
  const settingsClosedNodes = panelHost.querySelectorAll('*').length
  const errorsBeforeOpen = errors.length
  renderPanel(true)
  await wait(250)
  const panel = panelHost.querySelector('.fixed.inset-0') as HTMLElement | null
  const panelText = (panel?.textContent || '').replace(/\s+/g, ' ')
  // WHAT THE PLATFORM PAINTS INSIDE THE PANEL. A checkbox and a range slider are drawn by the system, so
  // `accent-color` is the only thing that reaches them; the palette's own value is read off a probe element rather
  // than written here, so the check follows the stylesheet instead of restating it.
  const colourProbe = document.createElement('span')
  colourProbe.style.color = 'var(--crt-green)'
  document.body.appendChild(colourProbe)
  const paletteGreen = getComputedStyle(colourProbe).color
  colourProbe.remove()
  const rangeInput = panelHost.querySelector('input[type="range"]') as HTMLElement | null
  const boxInput = panelHost.querySelector('input[type="checkbox"]') as HTMLElement | null
  // START QUEUE AND ITS SCOPE. One press starts at the choice; the caret offers the two answers, and every press is
  // reported with the scope it carried so the reading is what the button DID rather than what it says.
  const headerHost = document.createElement('div')
  document.body.appendChild(headerHost)
  const headerRoot = createRoot(headerHost)
  const starts: string[] = []
  headerRoot.render(<Header isQueueRunning={false} onToggleQueue={(scope) => starts.push(String(scope))} taskCount={2} canStartQueue />)
  await wait(150)
  const startButton = () => [...headerHost.querySelectorAll('button')].find((button) => /START QUEUE/.test(button.textContent || '')) as HTMLButtonElement | undefined
  const caretButton = () => headerHost.querySelector('.queue-titlebar-start-caret') as HTMLButtonElement | null
  startButton()?.click()
  await wait(80)
  caretButton()?.click()
  await wait(80)
  const offered = [...headerHost.querySelectorAll('.queue-start-menu button')].map((button) => (button.textContent || '').trim())
  const selectedOnly = [...headerHost.querySelectorAll('.queue-start-menu button')].find((button) => /SELECTED ONLY/.test(button.textContent || '')) as HTMLButtonElement | undefined
  selectedOnly?.click()
  await wait(80)
  startButton()?.click()
  await wait(80)
  result.startScope = { offered, starts: [...starts] }

  result.settings = {
    accentColor: {
      palette: paletteGreen,
      range: rangeInput ? getComputedStyle(rangeInput).accentColor : null,
      checkbox: boxInput ? getComputedStyle(boxInput).accentColor : null,
    },
    selectionBackground: getComputedStyle(document.body, '::selection').backgroundColor,
    closedNodes: settingsClosedNodes,
    opened: Boolean(panel),
    text: panelText.slice(0, 160),
    showsVersion: /0\.0\.0-check/.test(panelText),
    hasUpdateButton: Boolean([...panelHost.querySelectorAll('button')].find((button) => /Check for Updates/i.test(button.textContent || ''))),
    errorsWhileOpening: errors.slice(errorsBeforeOpen),
  }

  ;(window as unknown as Record<string, unknown>).__QUEUE_DONE = true
}

void drive().catch((error) => {
  errors.push('the drive threw: ' + String(error))
  ;(window as unknown as Record<string, unknown>).__QUEUE_DONE = true
})
