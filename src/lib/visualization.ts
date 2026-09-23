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

/** One template, and the two things the editor and the encoder both need to know about it. */
export interface VisualizationTemplate {
  id: Visualization
  name: string
  /**
   * Whether the drawing is ONE PICTURE of the whole sound or a drawing that MOVES.
   *
   * A picture uses `showwavespic` and `showspectrumpic`, which draw the whole sound into a single image; it
   * is then held for the length of the export, so the video is a still of the sound rather than a window
   * scrolling through it. A moving drawing is a filter that emits a frame per instant.
   */
  kind: 'picture' | 'moving'
  /** Whether the template takes a colour of its own. The spectra colour themselves by intensity. */
  colour: boolean
}

/**
 * The list the editor offers, in the order it offers it.
 *
 * The two at the top are PICTURES — the look the editor can show a still of and the export then holds for
 * the whole file — and the rest are moving drawings. The order is deliberate: the first is what a job gets
 * unless something else is asked for, and a static waveform is what a podcast video is.
 */
export const VISUALIZATIONS: VisualizationTemplate[] = [
  { id: 'waveform', name: 'WAVEFORM', kind: 'picture', colour: true },
  { id: 'spectrum', name: 'SPECTRUM', kind: 'picture', colour: false },
  { id: 'eq', name: 'EQ BARS', kind: 'moving', colour: true },
  { id: 'waveform-scroll', name: 'WAVEFORM \u00b7 SCROLL', kind: 'moving', colour: true },
  { id: 'spectrum-scroll', name: 'SPECTRUM \u00b7 SCROLL', kind: 'moving', colour: false },
]

/** The template table's answer for one id, for a preset that was saved before a template existed. */
export const templateFor = (id: Visualization | undefined): VisualizationTemplate =>
  VISUALIZATIONS.find((template) => template.id === id) ?? VISUALIZATIONS[0]

/** What a drawing starts in: the green the app's own waveform is drawn in. */
export const VISUALIZATION_COLOR = '#9fbf9a'
/** And what it starts on: the black the export letterboxes with. */
export const VISUALIZATION_BACKGROUND = '#000000'
/**
 * What a drawing's progress line is drawn in: the app's action accent, amber.
 *
 * Amber rather than the app's other green, and deliberately: the drawing's own default colour IS that green,
 * so a line in it would be invisible on a default waveform. The accent the app gives its actions is the one
 * that reads against whatever the drawing is made in, which is what a playhead has to do.
 */
export const VISUALIZATION_PROGRESS_COLOR = '#c5b879'

/**
 * Whether a job's drawing carries the sweeping progress line. Absent means ON — it is the podcast look.
 *
 * A preference saved before the line existed says nothing about it, and the answer for those is the same as
 * the answer for a new job, so only an explicit OFF turns it off.
 */
export const visualizationProgressLine = (preset: EncodingPreset): boolean => preset.visualizationProgressLine !== false

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
 * How wide the progress line is, as a share of the frame's height — a few pixels at any size.
 *
 * A share rather than a fixed count so the line reads the same shape at 720p and at 4K: a bar that is a few
 * pixels in a 1080-row frame is a few pixels in a 2160-row one, in proportion.
 */
export const progressLineWidth = (height: number): number => Math.max(2, Math.round(height * 0.006))

/**
 * The sweeping progress line, as the bar it is made of and the overlay that moves it.
 *
 * A drawing that MOVES is its own progress, so the line is only ever laid over a PICTURE — one frame of the
 * whole sound, held for its length, which would otherwise sit motionless. The bar is a colour source a few
 * pixels wide and the height of the frame, laid over the plate at a time-driven x, so it travels from the
 * left edge at t=0 to the right edge at t=duration and reads exactly as playback progress across the whole
 * waveform. `atStart` pins it to the left, which is what the editor's own still shows: the sweep is a
 * playback affordance, not a design, so the still shows that the bar EXISTS rather than guessing at a moment.
 *
 * Nothing is returned when there is no line to draw — a moving template, the line turned off, or a sound with
 * no known length to sweep across.
 */
const progressLineGraph = (template: Visualization, height: number, fps: number, duration: number, atStart: boolean): { bar: string; overlay: string } | null => {
  if (templateFor(template).kind !== 'picture') return null
  if (!atStart && !(duration > 0)) return null
  const bar = `color=c=${VISUALIZATION_PROGRESS_COLOR}:s=${progressLineWidth(height)}x${height}:r=${fps}`
  const x = atStart ? '0' : `(t/${duration.toFixed(3)})*(main_w-overlay_w)`
  return { bar, overlay: `overlay=x='${x}':y=0` }
}

/**
 * The animated waveform's own cap, which is lower than every other template's.
 *
 * Measured rather than preferred, and it is the whole reason a cap is a per-template figure: `showwaves`
 * with `mode=cline` and this app's own green draws a PURPLE line at exactly 1280 wide — a chroma of U 180
 * and V 199, against the 115 the green itself has — while the same filter at 320, 640, 960, 1344, 1600 and
 * 1920 draws the green it was given. It is the one template drawn instant by instant rather than as one
 * picture, and the one width it goes wrong at is the width this canvas would pick for a 16:9 frame. Below
 * it the line is also brighter — a maximum luma of 213 to 238 at 960x540 against 58 to 60 at 1920x1080 —
 * which is what the cap is for in the first place.
 */
export const SCROLLING_WAVEFORM_MAX_EDGE = 960

/** The edge a template's drawing is capped at, which is not the same figure for all of them. */
export const templateMaxEdge = (template: Visualization): number =>
  template === 'waveform-scroll' ? SCROLLING_WAVEFORM_MAX_EDGE : DRAWING_MAX_EDGE

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
export const drawingCanvas = (width: number, height: number, maxEdge: number = DRAWING_MAX_EDGE): { width: number; height: number } => {
  const cap = maxEdge > 0 ? maxEdge : DRAWING_MAX_EDGE
  const longest = Math.max(width, height)
  if (longest <= cap) return { width, height }
  const ratio = cap / longest
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
  // A PICTURE is the whole sound already and is taken at once; a moving drawing has to be given a moment to
  // fill, unless it is a waveform, whose line is there from its first frame.
  if (templateFor(template).kind === 'picture' || template === 'waveform-scroll' || !(duration > 0)) return 0
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
  /**
   * The length the export's sound runs for, in seconds — what the progress line sweeps across. A sweep needs
   * a beginning and an end, so a sound with no known length gets no line.
   */
  duration?: number
  /**
   * Whether the picture carries the sweeping progress line. Off unless asked for: the CALLER reads the job's
   * own default from the preset (see `visualizationProgressLine`), so the graph takes an answer rather than a
   * preference.
   */
  progressLine?: boolean
}

/**
 * One template's filter — the ONE its preview and its export are both made from.
 *
 * This is the whole of the "what you see is what you get" rule: the editor's still and the encoder's picture
 * are built from this same function, with the same parameters, so they cannot be two different drawings. A
 * picture template draws the whole sound into a single frame here; a moving one draws an instant.
 *
 * `showspectrum` and `showspectrumpic` are the odd ones twice over. They have no colour of their own — the
 * ramp is ffmpeg's `color=intensity`, which is why the editor offers them no colour field — and the
 * scrolling one has to be told to SLIDE, because left on its default it draws one column per emitted frame
 * into a frame nothing ever fills: measured, a four-second tone reads a maximum luma of 16 (black) in the
 * right-hand column at one second, two seconds and at the end, while `slide=scroll` reads 233 to 235 at
 * every one of them. The picture one needs `legend=0` for the same kind of reason: its legend band occupies
 * the right-hand edge, so with the default the picture does not reach its own frame.
 */
const drawingFilters = (template: Visualization, size: string, fps: number, color: string): string => {
  if (template === 'eq') return `showfreqs=s=${size}:mode=bar:ascale=log:rate=${fps}:colors=${color}`
  if (template === 'spectrum') return `showspectrumpic=s=${size}:mode=combined:color=intensity:scale=log:legend=0`
  if (template === 'spectrum-scroll') return `showspectrum=s=${size}:mode=combined:color=intensity:scale=log:slide=scroll,fps=${fps}`
  if (template === 'waveform-scroll') return `showwaves=s=${size}:mode=cline:rate=${fps}:colors=${color}`
  return `showwavespic=s=${size}:colors=${color}`
}

/**
 * The same drawing, as the export's own picture: a PICTURE is held for the whole sound, a moving one is not.
 *
 * A picture is one frame, so on its own it would be one frame of video: `loop` holds it, and the export is
 * then as long as the sound it is drawn from. This is the only difference between what the editor shows and
 * what the encoder writes — a loop is not a look, so the still the editor draws is a frame of exactly this.
 */
const exportDrawingFilters = (template: Visualization, size: string, fps: number, color: string): string => {
  const drawn = drawingFilters(template, size, fps, color)
  return templateFor(template).kind === 'picture' ? `${drawn},loop=loop=-1:size=1` : drawn
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
  /** Whether the still shows the progress line, pinned at the left. Off unless asked for — see the export. */
  progressLine?: boolean
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
  const { template, width, height, fps, color, sources, background, progressLine } = request
  const canvas = drawingCanvas(width, height, templateMaxEdge(template))
  const size = `${canvas.width}x${canvas.height}`
  const drawn = drawingFilters(template, size, fps, color)
  const listened = sources.length === 1
    ? `[${sources[0]}]${drawn}[draw]`
    : `${sources.map((label) => `[${label}]`).join('')}amix=inputs=${sources.length}:normalize=0,${drawn}[draw]`
  const base = typeof background === 'string'
    ? `color=c=${background}:s=${width}x${height}:r=${fps}[bg]`
    : `[${background.input}:v]scale=${width}:${height},setsar=1[bg]`
  // The line is shown at x=0 rather than hidden: the sweep is what the export does, and the still's job is to
  // show that the design has a bar in it. Pinned left is also the one moment the export's own picture shares.
  const line = progressLine ? progressLineGraph(template, height, fps, 0, true) : null
  return [
    listened,
    `[draw]scale=${width}:${height}:flags=lanczos[scaled]`,
    base,
    '[bg][scaled]overlay=shortest=1[plate]',
    ...(line
      ? [`${line.bar}[bar]`, `[plate][bar]${line.overlay},format=yuv420p[out]`]
      : ['[plate]format=yuv420p[out]']),
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
  const { template, width, height, fps, color, sources, background, rate, channels, duration, progressLine } = request
  const canvas = drawingCanvas(width, height, templateMaxEdge(template))
  const listened = sources.length === 1
    ? `[${sources[0]}]asplit=2[mixA][mixV]`
    : `${sources.map((label) => `[${label}]`).join('')}amix=inputs=${sources.length}:normalize=0,asplit=2[mixA][mixV]`
  const base = typeof background === 'string'
    ? `color=c=${background}:s=${width}x${height}:r=${fps}[bg]`
    : `[${background.input}:v]scale=${width}:${height},setsar=1[bg]`
  // The progress line, over the assembled plate: see `progressLineGraph`. It is the LAST thing drawn, so it
  // sits over the drawing rather than under it, and it sweeps the sound's own length.
  const line = progressLine ? progressLineGraph(template, height, fps, duration ?? 0, false) : null
  return [
    listened,
    // The export's own audio, resampled and laid out exactly as the path that asked for the drawing
    // writes it, and cut from the mix rather than from the files.
    `[mixA]aresample=${rate}:async=1,aformat=sample_fmts=fltp:channel_layouts=${channels === 1 ? 'mono' : 'stereo'}[aout]`,
    `[mixV]${exportDrawingFilters(template, `${canvas.width}x${canvas.height}`, fps, color)},scale=${width}:${height}:flags=lanczos[w]`,
    base,
    '[bg][w]overlay=shortest=1[plate]',
    ...(line
      ? [`${line.bar}[bar]`, `[plate][bar]${line.overlay},format=yuv420p[v]`]
      : ['[plate]format=yuv420p[v]']),
  ].join(';')
}
