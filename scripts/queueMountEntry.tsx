import React from 'react'
import { createRoot } from 'react-dom/client'
import { TaskCard } from '../src/components/TaskCard'
import { QueueTask } from '../src/types'

/**
 * Renders a QUEUE card for real, in a page, and reports what it drew and where it put it.
 *
 * The queue had NO render coverage at all: `check-mount` mounts the EDIT JOB window, `measure` measures
 * hand-written markup, and `verify` is arithmetic — so a card that drew its filename at the wrong size, or ran
 * a divider short of the card's edge, could only be found by looking at it. What is asked here is the layout a
 * reader sees: the export's own row and the type it is set in, which edge the panel's dividers reach, and which
 * corner the preset and the status are in.
 *
 * The bridge is a stub: this is about the card's own render, not about IPC.
 */
const errors: string[] = []
window.addEventListener('error', (event) => { errors.push(String(event.message || event.error)) })
window.addEventListener('unhandledrejection', (event) => { errors.push('unhandled rejection: ' + String(event.reason)) })

const noop = () => undefined
;(window as unknown as { electronAPI: unknown }).electronAPI = {
  probeMedia: async () => ({
    format: 'mp4', duration: 12, size: 0, bitrate: 0,
    videoStreams: [{ codec: 'h264', resolution: '1920x1080', fps: 25 }],
    audioStreams: [{ codec: 'aac', channels: 2, sampleRate: 48000 }],
  }),
  getPathsTotalSize: async () => 0,
  quickLook: async () => undefined,
}

/** A LONG output name, so the row it sits in has something to overflow and start crawling. */
const LONG_NAME = 'JapaneseFashionVlogger_a_very_long_output_name_that_will_not_fit_stitched.mp4'
const task = {
  id: 'queue-card-check', type: 'stitch', status: 'pending', progress: 0,
  sourcePaths: ['/media/JapaneseFashionVlogger.mp4', '/media/The_Hidden_Heart_of_Bhagavad_gita.mp4'],
  outputDirectory: '/out', outputFilename: LONG_NAME,
  preset: { id: 'p', name: 'CUSTOM', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: '1080p', fps: 30 },
} as unknown as QueueTask

const props = {
  task, selected: false,
  onSelectTask: noop, onOpenEditor: noop, onAddToExisting: noop, onAddSource: noop, onRemoveSource: noop,
  onReorderSources: noop, onReorderTracks: noop, onReplaceSource: noop, onChangeJobType: noop, onChangeComboMode: noop,
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
  // The card opens collapsed; the panel with the SOURCES — and so the source rows the export's row is compared
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
  result.type = { output: size(outputName), source: size(sourceName) }
  result.crawling = {
    armed: Boolean(outputName?.classList.contains('source-name-cropped')),
    overflow: Boolean(outputName && outputName.scrollWidth > outputName.clientWidth),
    hasTrack: Boolean(outputName?.querySelector('.source-name-track')),
  }
  result.edges = { sources: box(sources), card: box(card), cardPadding, output: box(output) }
  result.order = { preset: box(preset), sources: box(sources), outputRow: box(outputRow), status: box(status) }

  ;(window as unknown as Record<string, unknown>).__QUEUE_DONE = true
}

void drive().catch((error) => {
  errors.push('the drive threw: ' + String(error))
  ;(window as unknown as Record<string, unknown>).__QUEUE_DONE = true
})
