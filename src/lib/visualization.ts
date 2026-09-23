import { EncodingPreset, QueueTask } from '../types'
import { IMAGE_CONTAINERS } from './containerSwitch'
import { mediaKind } from './mediaKind'
import { outputCarriesPicture } from './outputKind'

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

/** The three things a drawing can sit on. */
export type VisualizationBackgroundKind = 'colour' | 'still' | 'image'

/** The list the editor offers, in the order it offers it. The still and the image come and go with the job. */
export const VISUALIZATION_BACKGROUNDS: Array<{ id: VisualizationBackgroundKind; name: string }> = [
  { id: 'colour', name: 'SOLID COLOUR' },
  { id: 'still', name: 'SOUND\u2019S STILL' },
  { id: 'image', name: 'UPLOAD IMAGE' },
]

/**
 * What a drawing sits on, as ONE answer from settings that have accumulated.
 *
 * `visualizationBackground` is the choice. Before it existed there was a flag meaning "over the job's own
 * still" and a colour underneath it, and a job saved then still says "over the still" in the only way it
 * could — so the flag is READ as that same choice rather than thrown away, and the editor and the encoder
 * both ask this one function, which is what keeps the selector and the export from disagreeing about a
 * job that was saved before either of them.
 */
export const visualizationBackgroundKind = (preset: EncodingPreset): VisualizationBackgroundKind => {
  if (preset.visualizationBackground) return preset.visualizationBackground
  return preset.visualizationOnStill ? 'still' : 'colour'
}

/**
 * Whether an export's picture is a DRAWING of its own sound, and what that drawing is made from.
 *
 * One answer, because three places need the same one: the AUDIO tab, which offers the setting; the encoder,
 * which draws the picture; and the monitor, which shows a still of it so the design can be judged before it
 * is paid for. Deriving it separately in each of them is how a job ends up encoding a picture the editor
 * never showed — which is the whole reason the monitor and the export read from one module here.
 *
 * `sources` is the audible files in the order the export mixes them: the main lane's own sound first, then
 * the added tracks, deduplicated because the same file can be two places in a job. Muted lanes are not
 * removed here — the encoder is the one that knows what a lane is — so this is what the editor would draw,
 * which for a still of it is the right thing to show.
 */
export interface DrawingPicture {
  /** Whether a picture is offered at all: a job of sound, into a container with room for one. */
  offersPicture: boolean
  /** Whether the picture that will be shown is a drawing of the sound. */
  draws: boolean
  /** The audible files the drawing is made from, in the order they would be mixed. */
  sources: string[]
  /** The still the drawing could sit on, when the job has one. */
  still: string | null
}

export const drawingPictureFor = (task: QueueTask): DrawingPicture => {
  const kinds = task.sourcePaths.map(mediaKind)
  const hasStill = kinds.includes('image')
  const hasFootage = kinds.some((kind) => kind === 'video')
    || Boolean(task.sequenceInput)
    || Object.keys(task.sequenceInputs ?? {}).length > 0
  const jobSound = kinds.includes('audio') || Boolean(task.additionalAudioTracks?.length)
  const container = task.preset.container
  const offersPicture = outputCarriesPicture(container)
    && !IMAGE_CONTAINERS.includes(container)
    && container !== 'gif'
    && task.preset.outputMode !== 'audio'
    && !hasFootage
    && jobSound
  // What the export would show, which is the setting or the job's own default of its still and then black.
  const chosen = task.preset.audioPicture ?? (hasStill ? 'still' : 'black')
  const sources = [
    ...task.sourcePaths.filter((source) => mediaKind(source) === 'audio'),
    ...(task.additionalAudioTracks ?? []).map((track) => track.path),
  ].filter((source, index, all) => all.indexOf(source) === index)
  return {
    offersPicture,
    draws: offersPicture && chosen === 'visualization',
    sources,
    still: hasStill ? task.sourcePaths.find((source) => mediaKind(source) === 'image') ?? null : null,
  }
}

/** The longest edge a drawing is made at. */
export const DRAWING_MAX_EDGE = 1280

/**
 * How long the editor waits before redrawing the still of a drawing, in milliseconds.
 *
 * A colour is typed a character at a time and a still is a whole ffmpeg run, so without the wait the field
 * would start one per keystroke. Short enough that the monitor still reads as answering the change.
 */
export const DRAWING_STILL_SETTLE_MS = 150

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

/**
 * How long a drawing is given to fill before a still of it is taken.
 *
 * A waveform's still is the whole file in one picture and is taken at once. The other two have no still of
 * their own, so a frame of the drawing is captured once it has had a moment to fill — and that moment has to
 * stay inside the sound, because asking for a frame of a source that has already ended produces no picture
 * at all rather than a late one. The spectrum slides in from the right, so a still taken at half a second of
 * a four-second sound is a filled frame; the same still of a four-TENTH-second sound would be a sliver.
 */
export const stillWarmupSeconds = (template: Visualization, duration: number): number => {
  if (template === 'waveform' || !(duration > 0)) return 0
  return Math.min(1, duration / 2)
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
  /**
   * The layout the export's own audio is written at, which the drawing's half of the mix is laid out to
   * as well — the two halves of one split cannot be laid out differently, and a stitch writes what its
   * own sources asked for rather than what another path happens to use.
   */
  rate: number
  channels: number
}

/**
 * One template's filter, at the canvas's own size and rate and in the given colour.
 *
 * `showspectrum` is the odd one twice over. It has no `rate` option of its own, so the rate is imposed by
 * an `fps` filter after it rather than asked for; and its colouring is ffmpeg's own ramp
 * (`color=intensity`), which is why the colour this app offers does not reach it — there is no hex to give
 * that filter.
 *
 * It also has to be told to SCROLL, which is not cosmetic. Left on its default the spectrogram is drawn one
 * column per emitted frame into a frame that is never filled, so the drawing occupies a narrow band at the
 * left and the right edge stays black for the whole export — measured on this ffmpeg: a four-second tone
 * reads a maximum luma of 16 (black) in the right-hand column at one second, two seconds and at the end,
 * while `slide=scroll` reads 233 to 235 at every one of them. The spectrogram of a sound should slide past
 * the frame, not creep into its corner.
 */
const drawingFilters = (template: Visualization, size: string, fps: number, color: string): string => {
  if (template === 'eq') return `showfreqs=s=${size}:mode=bar:ascale=log:rate=${fps}:colors=${color}`
  if (template === 'spectrum') return `showspectrum=s=${size}:mode=combined:color=intensity:scale=log:slide=scroll,fps=${fps}`
  return `showwaves=s=${size}:mode=cline:rate=${fps}:colors=${color}`
}

/**
 * What the editor's own still of a drawing is asked for: the same template, colour and background the
 * export will use, at the frame's size, and the audible inputs by label.
 */
export interface VisualizationStillRequest {
  template: Visualization
  /** The output frame the still is scaled up to, which is the export's own. */
  width: number
  height: number
  fps: number
  color: string
  /** The audible inputs to mix, by their labels — the same rule the export's own graph is given. */
  sources: string[]
  /** What the still sits on: a colour, or a picture INPUT by index. */
  background: string | { input: number }
}

/**
 * The one drawing the editor LOOKS at, as a single still rather than as an export.
 *
 * The templates are built from the same filters the export uses, at the same bounded canvas, so what the
 * editor judges is what they will get. Two of them have no still of their own and are captured as a frame
 * of the drawing after its warm-up — see `stillWarmupSeconds`. A waveform does have one: `showwavespic`
 * draws the whole file as one picture, which is a truer thing to look at than one frame of a line.
 */
export const visualizationStillGraph = (request: VisualizationStillRequest): string => {
  const { template, width, height, fps, color, sources, background } = request
  const canvas = drawingCanvas(width, height)
  const size = `${canvas.width}x${canvas.height}`
  const drawn = template === 'waveform'
    ? `showwavespic=s=${size}:colors=${color}`
    : drawingFilters(template, size, fps, color)
  const listened = sources.length === 1
    ? `[${sources[0]}]${drawn}[draw]`
    : `${sources.map((label) => `[${label}]`).join('')}amix=inputs=${sources.length}:normalize=0,${drawn}[draw]`
  const base = typeof background === 'string'
    ? `color=c=${background}:s=${width}x${height}:r=${fps}[bg]`
    : `[${background.input}:v]scale=${width}:${height},setsar=1[bg]`
  return [
    listened,
    `[draw]scale=${width}:${height}:flags=lanczos[scaled]`,
    base,
    '[bg][scaled]overlay=shortest=1,format=yuv420p[out]',
  ].join(';')
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
  const { template, width, height, fps, color, sources, background, rate, channels } = request
  const canvas = drawingCanvas(width, height)
  const listened = sources.length === 1
    ? `[${sources[0]}]asplit=2[mixA][mixV]`
    : `${sources.map((label) => `[${label}]`).join('')}amix=inputs=${sources.length}:normalize=0,asplit=2[mixA][mixV]`
  const base = typeof background === 'string'
    ? `color=c=${background}:s=${width}x${height}:r=${fps}[bg]`
    : `[${background.input}:v]scale=${width}:${height},setsar=1[bg]`
  return [
    listened,
    // The export's own audio, resampled and laid out exactly as the path that asked for the drawing
    // writes it, and cut from the mix rather than from the files.
    `[mixA]aresample=${rate}:async=1,aformat=sample_fmts=fltp:channel_layouts=${channels === 1 ? 'mono' : 'stereo'}[aout]`,
    `[mixV]${drawingFilters(template, `${canvas.width}x${canvas.height}`, fps, color)},scale=${width}:${height}:flags=lanczos[w]`,
    base,
    '[bg][w]overlay=shortest=1,format=yuv420p[v]',
  ].join(';')
}
