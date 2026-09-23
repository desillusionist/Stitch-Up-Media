import { EncodingPreset } from '../types'

/**
 * The drawings an audio export can be given, as ffmpeg's own filters.
 *
 * Each template is a NAME and its parameters, and the graph around it is the same for all three: the
 * mix is split, one half is drawn and the other is what the export muxes. That is the point of building
 * the picture this way — the waveform a listener sees cannot disagree with the sound they hear, because
 * it is drawn from the very stream that is written.
 */
export type Visualization = NonNullable<EncodingPreset['visualization']>

/** The list the editor offers, in the order it offers it. */
export const VISUALIZATIONS: Array<{ id: Visualization; name: string }> = [
  { id: 'waveform', name: 'WAVEFORM' },
  { id: 'eq', name: 'EQ BARS' },
  { id: 'spectrum', name: 'SPECTRUM' },
]

/** What a drawing starts in: the green the app's own waveform is drawn in. */
export const VISUALIZATION_COLOR = '#9fbf9a'
/** And what it starts on: the black the export letterboxes with. */
export const VISUALIZATION_BACKGROUND = '#000000'

/** The longest edge a drawing is made at. */
export const DRAWING_MAX_EDGE = 1280

/**
 * The canvas a drawing is made on, which is deliberately NOT the output frame's own size.
 *
 * Measured, on this ffmpeg, rather than assumed: `showwaves` and its siblings drawn natively at
 * 1920x1080 come out dim and colourless — a maximum luma of 46 of 235 and no chroma at all, whichever
 * display mode is asked for — and drawn at 1280x720 or below they are correct. So a drawing is made on
 * a canvas whose LONG edge is bounded here and scaled up to the frame afterwards, keeping the frame's
 * own shape: a waveform has no detail that upscaling can lose, and drawing one at 4K loses the drawing.
 */
export const drawingCanvas = (width: number, height: number): { width: number; height: number } => {
  const longest = Math.max(width, height)
  if (longest <= DRAWING_MAX_EDGE) return { width, height }
  const ratio = DRAWING_MAX_EDGE / longest
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)
  return { width: even(width * ratio), height: even(height * ratio) }
}

export interface VisualizationRequest {
  template: Visualization
  /** The output frame the drawing is scaled up to, which is the export's own. */
  width: number
  height: number
  fps: number
  color: string
  /**
   * The audible inputs to mix, by their labels in the input list: one for a lone sound, several when
   * tracks are muxed alongside it. Empty is not a request — there is nothing to draw.
   */
  sources: string[]
  /**
   * What the drawing sits on: a colour ffmpeg draws, or a picture INPUT by index — which is what puts
   * the job's own still behind the waveform.
   */
  background: string | { input: number }
}

/**
 * One template's filter, at the canvas's own size and rate and in the given colour.
 *
 * `showspectrum` is the odd one: it has no `rate` option of its own, so the rate is imposed by an `fps`
 * filter after it rather than asked for. Its colouring is ffmpeg's own ramp (`color=intensity`), which
 * is why the colour this app offers does not reach it — there is no hex to give that filter.
 */
const drawingFilters = (template: Visualization, size: string, fps: number, color: string): string => {
  if (template === 'eq') return `showfreqs=s=${size}:mode=bar:ascale=log:rate=${fps}:colors=${color}`
  if (template === 'spectrum') return `showspectrum=s=${size}:mode=combined:color=intensity:scale=log,fps=${fps}`
  return `showwaves=s=${size}:mode=cline:rate=${fps}:colors=${color}`
}

/**
 * The filter graph that draws one template over its background and leaves the export's own streams.
 *
 * Three labels come out and the names are fixed, because the caller maps them: `[v]` is the picture,
 * `[aout]` is the audio the export carries, and the audio it is cut from is the mix.
 *
 * The mix is SPLIT rather than read twice. One source is a mix of one, which is why the lone-audio case
 * needs no path of its own: the same `asplit` that hands the drawing its copy hands the encoder the
 * other. Where several tracks are audible they are summed first, with `normalize=0` so a level the user
 * set is the level that is written — the alternative halves every track, which is a decision nobody
 * asked the encoder to make about their mix. A muted track is not named here at all: one the export does
 * not carry is not in the mix it draws either.
 *
 * The drawing is made at the bounded canvas and scaled UP to the frame with lanczos, then flattened to
 * the pixel format every other path writes. See `drawingCanvas` for why it is not drawn at the frame's
 * own size.
 */
export const visualizationGraph = (request: VisualizationRequest): string => {
  const { template, width, height, fps, color, sources, background } = request
  const canvas = drawingCanvas(width, height)
  const listened = sources.length === 1
    ? `[${sources[0]}]asplit=2[mixA][mixV]`
    : `${sources.map((label) => `[${label}]`).join('')}amix=inputs=${sources.length}:normalize=0,asplit=2[mixA][mixV]`
  const base = typeof background === 'string'
    ? `color=c=${background}:s=${width}x${height}:r=${fps}[bg]`
    : `[${background.input}:v]scale=${width}:${height},setsar=1[bg]`
  return [
    listened,
    // The export's own audio, resampled and laid out exactly as every other path writes it, and cut from
    // the mix rather than from the files.
    '[mixA]aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]',
    `[mixV]${drawingFilters(template, `${canvas.width}x${canvas.height}`, fps, color)},scale=${width}:${height}:flags=lanczos[w]`,
    base,
    '[bg][w]overlay=shortest=1,format=yuv420p[v]',
  ].join(';')
}
