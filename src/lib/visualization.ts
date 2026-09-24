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
 * unless something else is asked for, and a static waveform is what a podcast video is. The three LED
 * templates sit together at the end of the bars family, because they ARE the bars drawn another way — see
 * `VISUALIZATION_DEFAULTS`, where each one's panel, pills and peak hold are set up.
 */
export const VISUALIZATIONS: VisualizationTemplate[] = [
  { id: 'waveform', name: 'WAVEFORM', kind: 'picture', colour: true },
  { id: 'spectrum', name: 'SPECTRUM', kind: 'picture', colour: false },
  { id: 'eq', name: 'EQ BARS', kind: 'moving', colour: true },
  { id: 'mirrored-bars', name: 'MIRRORED BARS', kind: 'moving', colour: true },
  { id: 'led-eq', name: 'LED EQ', kind: 'moving', colour: true },
  { id: 'matrix-panel', name: 'MATRIX PANEL', kind: 'moving', colour: true },
  { id: 'peak-pills', name: 'PEAK PILLS', kind: 'moving', colour: true },
  { id: 'scope', name: 'RADIAL SCOPE', kind: 'moving', colour: false },
  { id: 'waveform-scroll', name: 'WAVEFORM - SCROLL', kind: 'moving', colour: true },
  { id: 'spectrum-scroll', name: 'SPECTRUM - SCROLL', kind: 'moving', colour: false },
]

/**
 * The templates built out of EQ bars, which share every one of their knobs and their geometry.
 *
 * The three LED ones are in the family rather than beside it: LED EQ is the bars with a peak hold, PEAK
 * PILLS is the bars with a wider block gap, and MATRIX PANEL is the bars mirrored over a lit panel — one
 * drawing with three sets of defaults, not three drawings.
 */
export const isBarsTemplate = (template: Visualization): boolean =>
  template === 'eq' || template === 'mirrored-bars' || template === 'led-eq' || template === 'matrix-panel' || template === 'peak-pills'

/**
 * The bar templates drawn as two halves about the centre line.
 *
 * The mirror is arithmetic rather than taste: the bars are made at HALF the frame's height, one copy is
 * flipped, and the two are stacked, so the drawing grows both ways from the middle. MATRIX PANEL is in here
 * because its ACTIVE layer is the mirrored bars — the lit panel underneath is not mirrored, it is a field.
 */
export const isMirroredTemplate = (template: Visualization): boolean =>
  template === 'mirrored-bars' || template === 'matrix-panel'

/** The two waveforms, which share the amplitude scale, the weight and how many waveforms they draw. */
export const isWaveTemplate = (template: Visualization): boolean => template === 'waveform' || template === 'waveform-scroll'

/** The two spectra, which share the amplitude scale and the saturation — their ramp comes from the theme. */
export const isSpectrumTemplate = (template: Visualization): boolean => template === 'spectrum' || template === 'spectrum-scroll'

/** The template table's answer for one id, for a preset that was saved before a template existed. */
export const templateFor = (id: Visualization | undefined): VisualizationTemplate =>
  VISUALIZATIONS.find((template) => template.id === id) ?? VISUALIZATIONS[0]

/** What a drawing starts in: the green the app's own waveform is drawn in. */
export const VISUALIZATION_COLOR = '#9fbf9a'
/** And what it starts on: the black the export letterboxes with. */
export const VISUALIZATION_BACKGROUND = '#000000'

/**
 * The palettes a drawing may be made in, as one answer the editor and the encoder both read.
 *
 * Two, and both of them the app's own phosphors: the restrained green the drawings are drawn in by default,
 * and the amber the app gives its actions and its trim. No rainbow and no per-bar gradients — a drawing is
 * instrumentation, and a palette per bar would make it a different thing.
 *
 * A theme sets the COLOUR, and for the two spectra — which colour themselves by intensity rather than by a
 * hex, which is why they are offered no colour field — it picks the monochrome ffmpeg ramp they are drawn
 * with: `green`, and the warm `fiery` for amber. Both are single-hue ramps, so the identity holds.
 */
export type DrawingTheme = 'green' | 'amber'

export interface DrawingThemeOption {
  id: DrawingTheme
  name: string
  /** The colour the templates that take one are drawn in. */
  color: string
  /** The ramp the spectra colour themselves with. */
  ramp: string
}

export const DRAWING_THEMES: DrawingThemeOption[] = [
  { id: 'green', name: 'MONO GREEN', color: VISUALIZATION_COLOR, ramp: 'green' },
  { id: 'amber', name: 'AMBER CRT', color: '#c5b879', ramp: 'fiery' },
]

/** The theme's own answer for an id, for a preset that was saved before themes existed. */
export const themeFor = (id: DrawingTheme | undefined): DrawingThemeOption =>
  DRAWING_THEMES.find((theme) => theme.id === id) ?? DRAWING_THEMES[0]

/** The colour a drawing is made in: the job's own where it named one, and the theme's otherwise. */
export const drawingColorOf = (preset: Pick<EncodingPreset, 'visualizationColor' | 'drawingTheme'>): string =>
  preset.visualizationColor || themeFor(preset.drawingTheme).color
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
  { id: 'still', name: "SOUND'S STILL" },
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

/** How much dark case the bar carries on each side, in pixels. */
export const PROGRESS_LINE_CASE = 2
/** The case's colour: the same black the export letterboxes with, so the bar reads on any drawing. */
export const VISUALIZATION_PROGRESS_CASE_COLOR = '#000000'

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
 * The bar is drawn as an amber CORE inside a dark case rather than as a bare line. That is not decoration: a
 * spectrum fills its frame with colour, and a bare amber line over it all but disappears wherever the drawing
 * underneath is itself bright — which is why the line on the spectrum was reported as not drawing at all when
 * it was there the whole time. The case is what makes the line read on the bright drawing as well as on the
 * dark one, and the pair is composited into one small image that the sweep then moves.
 *
 * Nothing is returned when there is no line to draw — a moving template, the line turned off, or a sound with
 * no known length to sweep across.
 */
const progressLineGraph = (template: Visualization, height: number, fps: number, duration: number, atStart: boolean): { bar: string; overlay: string } | null => {
  if (templateFor(template).kind !== 'picture') return null
  if (!atStart && !(duration > 0)) return null
  const core = progressLineWidth(height)
  const caseWidth = core + PROGRESS_LINE_CASE * 2
  const bar = `color=c=${VISUALIZATION_PROGRESS_CASE_COLOR}:s=${caseWidth}x${height}:r=${fps}[case];color=c=${VISUALIZATION_PROGRESS_COLOR}:s=${core}x${height}:r=${fps}[core];[case][core]overlay=x=${PROGRESS_LINE_CASE}:y=0[bar]`
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
/**
 * How long a drawing is given to fill before a still of it is taken, in seconds.
 *
 * A PICTURE is the whole sound in one frame and is photographed at once. A drawing that MOVES has an EMPTY
 * canvas at t=0 — content arrives as it scrolls or fills, so a frame taken at the start is black, which is
 * what a reviewer saw for both scrolling templates. The sample is therefore taken somewhere the window is
 * populated, and there are two bounds on it.
 *
 * The first is how long the window takes to fill: the scrolling spectrum fills one column per frame, so its
 * window is `canvasWidth / fps` seconds long, while a scrolling waveform's line and the bars are there within
 * a frame or two. The second is the middle of the sound — a frame asked for after the sound has ENDED comes
 * back blank, so a short clip is sampled at its own midpoint rather than at a figure it never reaches. The
 * floor of `STILL_SAMPLE_SECONDS` is what keeps a long clip's preview cheap: its window would take a minute
 * to fill, and waiting that long to draw a thumbnail is worse than showing a partly-filled one.
 */
export const STILL_SAMPLE_SECONDS = 2

export const stillWarmupSeconds = (template: Visualization, duration: number, canvasWidth: number, fps: number): number => {
  if (templateFor(template).kind === 'picture' || !(duration > 0)) return 0
  const fill = template === 'spectrum-scroll' ? canvasWidth / Math.max(1, fps) : 0
  return Math.max(0, Math.min(duration / 2, Math.max(fill, STILL_SAMPLE_SECONDS)))
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
   * The EQ's own knobs, when the template is one. Absent means the defaults — see `DEFAULT_EQ_STYLE`.
   */
  eq?: EqStyle
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
  /** The palette and the knobs, resolved by the caller from the preset — see `drawingTuneOf`. */
  tune?: DrawingTune
}

/**
 * The EQ drawing's own knobs, resolved from a preset's settings.
 *
 * `showfreqs` in `bar` mode has no option for how many bars it draws, how thick they are, or how far apart:
 * its bars are one output column each, so the count IS the width and a thicker bar is only a wider drawing.
 * The way to control it is therefore to draw at the BAR COUNT and stretch — one pixel per bar, scaled up with
 * a nearest-neighbour stretch, so a bar becomes `frameWidth / bars` output pixels wide and the bars are
 * chunky rather than blurred. The GAP is then a grid drawn over the result, blanking the leading pixels of
 * every bar's cell, which is the only way to open one in a filter that has no concept of it.
 */
export interface EqStyle {
  /** How many bars the spectrum is divided into — its density. */
  bars: number
  /** The gap between bars, in pixels of the output frame. 0 is solid. */
  gap: number
  amplitude: EqAmplitudeScale
  frequency: EqFrequencyScale
  /** ffmpeg's `minamp`: the floor below which a frequency is not drawn. Smaller is more sensitive. */
  sensitivity: number
}

export type EqAmplitudeScale = 'lin' | 'sqrt' | 'cbrt' | 'log'
export type EqFrequencyScale = 'lin' | 'log' | 'rlog'

export const EQ_AMPLITUDE_SCALES: EqAmplitudeScale[] = ['lin', 'sqrt', 'cbrt', 'log']
export const EQ_FREQUENCY_SCALES: EqFrequencyScale[] = ['lin', 'log', 'rlog']
/** How many bars a drawing starts with. */
export const EQ_DEFAULT_BARS = 64
/** The range a bar count may take: below this every bar is gap, above it the stretch is pointless. */
export const EQ_MIN_BARS = 2
export const EQ_MAX_BARS = 512
/** The gap starts at none, which is a solid spectrum. */
export const EQ_DEFAULT_GAP = 0
/** The widest a gap may be, in output pixels — past this a bar would be mostly gap. */
export const EQ_MAX_GAP = 200
/**
 * The largest `minamp` ffmpeg takes, which is the least sensitive a spectrum can be asked to be — and the
 * default, because a drawing's own floor is what a spectrum normally wants.
 */
export const EQ_MAX_SENSITIVITY = 1e-6
/** And the smallest, which is as sensitive as it is worth asking for. */
export const EQ_MIN_SENSITIVITY = 1e-12

/** The EQ's knobs as a job that says nothing about them gets them. */
export const DEFAULT_EQ_STYLE: EqStyle = { bars: EQ_DEFAULT_BARS, gap: EQ_DEFAULT_GAP, amplitude: 'log', frequency: 'lin', sensitivity: EQ_MAX_SENSITIVITY }

export const clampEqBars = (value: unknown): number => {
  const bars = Math.round(Number(value))
  return Number.isFinite(bars) && bars > 0 ? Math.max(EQ_MIN_BARS, Math.min(EQ_MAX_BARS, bars)) : EQ_DEFAULT_BARS
}

export const clampEqGap = (value: unknown): number => {
  const gap = Math.round(Number(value))
  return Number.isFinite(gap) ? Math.max(0, Math.min(EQ_MAX_GAP, gap)) : EQ_DEFAULT_GAP
}

export const clampEqSensitivity = (value: unknown): number => {
  const sensitivity = Number(value)
  if (!Number.isFinite(sensitivity) || sensitivity <= 0) return EQ_MAX_SENSITIVITY
  return Math.max(EQ_MIN_SENSITIVITY, Math.min(EQ_MAX_SENSITIVITY, sensitivity))
}

/**
 * The EQ's knobs, read off a preset with the defaults filled in and every figure held to what ffmpeg takes.
 *
 * The BAR COUNT's default is the template's own — see `drawingDefaultsFor` — which is what lets the LED EQ
 * open at sixteen bars while the plain bars still open at `EQ_DEFAULT_BARS`. Everything else is the job's
 * figure or the family's, the same for every bar template.
 */
export const eqStyleOf = (preset: Pick<EncodingPreset, 'visualization' | 'eqBars' | 'eqGap' | 'eqAmplitude' | 'eqFrequency' | 'eqSensitivity'>): EqStyle => ({
  bars: clampEqBars(preset.eqBars ?? drawingDefaultsFor(preset.visualization).bars ?? EQ_DEFAULT_BARS),
  gap: clampEqGap(preset.eqGap ?? EQ_DEFAULT_GAP),
  amplitude: EQ_AMPLITUDE_SCALES.includes(preset.eqAmplitude as EqAmplitudeScale) ? (preset.eqAmplitude as EqAmplitudeScale) : DEFAULT_EQ_STYLE.amplitude,
  frequency: EQ_FREQUENCY_SCALES.includes(preset.eqFrequency as EqFrequencyScale) ? (preset.eqFrequency as EqFrequencyScale) : DEFAULT_EQ_STYLE.frequency,
  sensitivity: clampEqSensitivity(preset.eqSensitivity ?? EQ_MAX_SENSITIVITY),
})

/** The waveform templates' amplitude scales, and the spectra's — the two filters have different lists. */
export type WaveScale = NonNullable<EncodingPreset['waveScale']>
export type SpectrumScale = NonNullable<EncodingPreset['spectrumScale']>
export const WAVE_SCALES: WaveScale[] = ['lin', 'log', 'sqrt', 'cbrt']
export const SPECTRUM_SCALES: SpectrumScale[] = ['lin', 'sqrt', 'cbrt', 'log', '4thrt', '5thrt']
export const WAVE_DEFAULT_SCALE: WaveScale = 'lin'
export const SPECTRUM_DEFAULT_SCALE: SpectrumScale = 'log'
/**
 * How heavy a waveform's drawing is.
 *
 * The two settings of ffmpeg's own `draw`: `scale` divides each drawn sample by the number of samples sharing
 * its column, which draws the light marks of a thin line, and `full` draws every sample directly, which fills
 * the envelope. The FILL is the default because the light one is what reads as a blank monitor on a 1080-row
 * frame: measured on broadband material, the lighter drawing covers about a fifth of what the fuller one does.
 */
export type WaveWeight = 'line' | 'fill'
export const WAVE_WEIGHTS: WaveWeight[] = ['fill', 'line']
export const WAVE_DEFAULT_WEIGHT: WaveWeight = 'fill'
/** The scope's draw modes — a continuous trace, or dots. */
export type ScopeDraw = 'dot' | 'line'
export const SCOPE_DRAWS: ScopeDraw[] = ['line', 'dot']
export const SCOPE_DEFAULT_DRAW: ScopeDraw = 'line'
/**
 * How many waveforms a waveform template draws.
 *
 * ONE is the default, and it is what makes the drawing a single shape: `showwaves` and `showwavespic` DRAW A
 * CHANNEL PER ROW, so a stereo input fills the frame with two of them however `split_channels` is set —
 * measured, a stereo source inks the whole frame height where the same sound downmixed inks the middle of it.
 * So `1` is a real downmix to mono rather than a setting on the filter, and the two templates agree because
 * they are handed the same thing. `2` hands them the stereo pair and asks the filter to split it, which is
 * the look for a sound whose channels differ.
 */
export type WaveChannels = 1 | 2
export const WAVE_CHANNELS: WaveChannels[] = [1, 2]
export const WAVE_DEFAULT_CHANNELS: WaveChannels = 1
/**
 * The rate a stream is mixed down to one channel at, layout-agnostically.
 *
 * `aformat` rather than `pan`: a `pan` has to name the input's channels, so it has to be told what it is being
 * handed, and this is the one thing in a drawing that should not depend on the input's layout. Measured, the
 * filter collapses a stereo pair to one row and leaves a mono stream alone.
 */
export const MONO_MIX = 'aformat=channel_layouts=mono'
/**
 * How many entries a colour list is written with.
 *
 * `colors` is a list indexed BY CHANNEL, and a list shorter than the input leaves the channels it does not
 * cover drawn in the filter's own default. That is the whole of the white bars: measured, one entry with a
 * stereo input puts pure white (255,255,255) in the frame where the theme's own green belongs, and a list
 * long enough for every channel puts `#9fbf9a` there and nothing else. Eight is the widest layout ffmpeg
 * names, so eight entries cover every case a sound can arrive in; a mono input ignores the rest.
 */
export const COLOUR_LIST_LENGTH = 8

/** One colour, repeated for as many channels as a filter may be handed — see `COLOUR_LIST_LENGTH`. */
export const colourList = (colour: string, count: number = COLOUR_LIST_LENGTH): string =>
  new Array(Math.max(1, count)).fill(colour).join('|')

/** A hex colour as three 0-255 channels, or nothing where it cannot be read. Six- and three-digit forms. */
export const parseHexColour = (colour: string): { red: number; green: number; blue: number } | null => {
  const hex = String(colour).trim().replace(/^#/, '')
  const full = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return { red: parseInt(full.slice(0, 2), 16), green: parseInt(full.slice(2, 4), 16), blue: parseInt(full.slice(4, 6), 16) }
}

/**
 * The polar scope's three channel CONTRASTS, taken from the colour the drawing is made in.
 *
 * The scope has no colour option of its own — its output is a per-pixel contrast applied to each channel — so
 * the drawing's colour is what decides it, which is also what makes it follow the COLOUR field rather than a
 * table fixed per theme. All three are set, and none to zero, and that is the whole of the fix for the stray
 * purple: measured, a contrast of zero leaves the channel it belongs to carrying only the near-black rounding
 * of the trace, which lands as magenta specks at (2,0,3) where the same scope with every channel set is green
 * throughout. An unreadable colour falls back to the app's own green, which is the one trace that cannot be
 * wrong; a colour the filters refuse would have failed the drawing a line later anyway.
 */
export const scopeChannelsOf = (colour: string): { red: number; green: number; blue: number } =>
  parseHexColour(colour) ?? parseHexColour(VISUALIZATION_COLOR)!

/**
 * One colour, dimmed: the theme's own green taken down to a share of itself.
 *
 * The comment inside `colourList` explains why a colour has to be walked out per channel; this one explains
 * why a colour has to be DARKENED in TypeScript at all, and the reason is the same shape. MATRIX PANEL's
 * unlit cells are not a filter option — ffmpeg has no "draw a bar at 15%" — so the dim panel is a flat source
 * of a colour that has to be computed here, where the hex is known, rather than asked for downstream. It
 * parses the six- and three-digit forms and gives black for anything it cannot read, which is the one dim
 * that cannot be wrong; an unreadable colour would have failed the drawing's own filters a line later anyway.
 */
export const dimmedColour = (colour: string, share: number): string => {
  const channels = parseHexColour(colour)
  if (!channels) return '#000000'
  const factor = Math.max(0, Math.min(1, share))
  const scaled = (value: number) => Math.round(value * factor).toString(16).padStart(2, '0')
  return `#${scaled(channels.red)}${scaled(channels.green)}${scaled(channels.blue)}`
}

export const SCOPE_MIN_ZOOM = 0.2
export const SCOPE_MAX_ZOOM = 10
export const SCOPE_DEFAULT_ZOOM = 1
/** How long the scope's trace lasts, 0 to 1. High, because a scope with no trail is a single bright dot. */
export const SCOPE_DEFAULT_PERSIST = 0.88
/** The widest and narrowest a spectrum's colour may be pushed. */
export const SPECTRUM_MIN_SATURATION = 0
export const SPECTRUM_MAX_SATURATION = 10
export const SPECTRUM_DEFAULT_SATURATION = 1
/** How tall one block of a segmented drawing is, before its lines are taken out of the frame. */
export const SEGMENT_PX = 8
/** How thick a segment divider is, and how thick a bar's edge may be. */
export const SEGMENT_DIVIDER = 1
/**
 * How narrow a bar may be before a gap stops meaning anything.
 *
 * A gap is a share of a bar, so on a bar three pixels wide it is most of the bar and the drawing becomes a
 * comb. Past this the gaps are turned off rather than drawn, so a dense spectrum reads as a spectrum.
 */
export const EQ_MIN_BAR_PX = 3

/**
 * How long a held peak lasts: the share of its height it keeps each frame, and the range it may be set in.
 *
 * The upper bound stops short of one on purpose. `lagfun` with a decay of one holds every peak forever, so
 * the ghost would never clear and the drawing would be a single image that only ever grows — the bar chart
 * would stop being about the sound. Just below one is a long trail that still lets go.
 */
export const EQ_PEAK_DECAY_MIN = 0
export const EQ_PEAK_DECAY_MAX = 0.999
/** The decay a hold starts at, and the longer one the pills are given — their whole look is a slower fall. */
export const EQ_DEFAULT_PEAK_DECAY = 0.95
export const EQ_PILL_PEAK_DECAY = 0.985
/**
 * How thick a segment divider is by default, and how far it may be opened.
 *
 * The default is the hairline the ordinary block drawing has always used, and the range stops at half a
 * block: past that the blocks are mostly gap and the drawing stops reading as a stack of anything.
 */
export const EQ_SEGMENT_GAP_MAX = Math.max(1, Math.floor(SEGMENT_PX / 2))
/**
 * The share of the drawing's colour MATRIX PANEL lights its unlit cells at.
 *
 * Dim enough to be unmistakably OFF — measured, the theme's green at this share reads a luma around 27, so
 * the field is visible without ever being mistaken for a lit bar — and high enough not to be black, which
 * would make the panel a plain background rather than a panel of unlit lamps.
 */
export const MATRIX_DIM_SHARE = 0.15
/**
 * The frequencies the LED EQ labels its bands with, low to high.
 *
 * The seven of a graphic equaliser rather than one per bar, because a label per bar is unreadable past a
 * handful: the bands are placed evenly across the width, which is the one layout that holds whatever the
 * bar count, and the figures are the shorthands a reader recognises rather than exact centre frequencies.
 */
export const EQ_LABEL_FREQUENCIES = ['63', '160', '400', '1k', '2.5k', '6.3k', '16k']

/**
 * A peak hold's decay, held to what `lagfun` can be asked for: nothing at all, or a trail just short of
 * forever. Nonsense — a typed figure, an absent one — falls back to the default rather than to off, because
 * a job that says nothing about a hold wants the ordinary one, not none.
 */
export const clampPeakDecay = (value: unknown): number => {
  const decay = Number(value)
  if (!Number.isFinite(decay)) return EQ_DEFAULT_PEAK_DECAY
  return Math.max(EQ_PEAK_DECAY_MIN, Math.min(EQ_PEAK_DECAY_MAX, decay))
}

/** A block gap, held to a whole number of pixels between a hairline and half a block. */
export const clampSegmentGap = (value: unknown): number => {
  const gap = Math.round(Number(value))
  if (!Number.isFinite(gap)) return SEGMENT_DIVIDER
  return Math.max(1, Math.min(EQ_SEGMENT_GAP_MAX, gap))
}

/**
 * What a bar template does unless the job says otherwise.
 *
 * A template's own defaults, rather than one set for the whole family, because the three LED looks ARE the
 * bars with different settings: LED EQ is a sparse panel that holds its peaks, PEAK PILLS is the block
 * drawing with a wide gap and a slow fall, and MATRIX PANEL is the lit field. Keeping them here means a job
 * that picks one gets its look without having to be told six figures, while an absent field still reads the
 * same as it always did for the templates that declare none — a job saved before any of this, asking for the
 * plain bars, gets exactly the drawing it did.
 */
export interface DrawingDefaults {
  bars?: number
  segmented?: boolean
  segmentGap?: number
  peakHold?: boolean
  peakDecay?: number
  labels?: boolean
}

export const VISUALIZATION_DEFAULTS: Record<Visualization, DrawingDefaults> = {
  waveform: {},
  spectrum: {},
  eq: {},
  'mirrored-bars': {},
  scope: {},
  'waveform-scroll': {},
  'spectrum-scroll': {},
  // A sparse panel that holds its peaks: sixteen bars is what an LED spectrum has room for, and the blocks
  // and the hold are what make it read as lamps rather than as a bar chart.
  'led-eq': { bars: 16, segmented: true, peakHold: true },
  // The lit field. More bars than the LED EQ, because a panel wants cells rather than bars, and its active
  // layer is the mirrored, segmented bars over that field — see `drawingChains`.
  'matrix-panel': { bars: 24, segmented: true, peakHold: true },
  // The blocks with a wide gap and a slow fall: `segmented` plus a divider several pixels thick is what turns
  // a stack of blocks into a column of separated pills, and the longer decay is what tells them apart from
  // the LED EQ when both are on screen.
  'peak-pills': { segmented: true, segmentGap: 3, peakHold: true, peakDecay: EQ_PILL_PEAK_DECAY },
}

/** A template's own defaults, for an id that may have been saved before the template existed. */
export const drawingDefaultsFor = (id: Visualization | undefined): DrawingDefaults =>
  VISUALIZATION_DEFAULTS[templateFor(id).id]

/** The height one block of a segmented drawing gets, so the blocks tile the frame exactly and none is cut. */
export const segmentHeight = (height: number): number => height / Math.max(1, Math.round(height / SEGMENT_PX))

const evenNumber = (value: number): number => Math.max(2, Math.round(value / 2) * 2)

/** The square a polar scope is drawn on: the frame's short side, capped like every other canvas. */
export const scopeSide = (frame: { width: number; height: number }): number =>
  Math.max(2, Math.min(Math.min(frame.width, frame.height), DRAWING_MAX_EDGE))

/** The scope's fade, which is the inverse of its persistence: a long trail is a small fade. */
export const scopeFade = (persist: number): number => Math.round((1 - clampScopePersist(persist)) * 255)

export const clampScopePersist = (value: unknown): number => {
  const persist = Number(value)
  return Number.isFinite(persist) ? Math.max(0, Math.min(1, persist)) : SCOPE_DEFAULT_PERSIST
}

export const clampScopeZoom = (value: unknown): number => {
  const zoom = Number(value)
  return Number.isFinite(zoom) && zoom > 0 ? Math.max(SCOPE_MIN_ZOOM, Math.min(SCOPE_MAX_ZOOM, zoom)) : SCOPE_DEFAULT_ZOOM
}

export const clampSaturation = (value: unknown): number => {
  const saturation = Number(value)
  return Number.isFinite(saturation) ? Math.max(SPECTRUM_MIN_SATURATION, Math.min(SPECTRUM_MAX_SATURATION, saturation)) : SPECTRUM_DEFAULT_SATURATION
}

/**
 * Everything about a drawing that is neither its template nor its size: the palette and the knobs.
 *
 * One object rather than a dozen arguments, because the editor and the encoder both resolve a preset into it
 * with `drawingTuneOf` and neither of them then has to know what a template's defaults are — which is what
 * keeps a knob the editor draws from ever being a knob the encoder ignores.
 */
export interface DrawingTune {
  theme: DrawingTheme
  waveScale: WaveScale
  waveWeight: WaveWeight
  waveChannels: WaveChannels
  spectrumScale: SpectrumScale
  spectrumSaturation: number
  segmented: boolean
  /** How thick the divider between a segmented drawing's blocks is, in pixels of the frame. */
  segmentGap: number
  /** Whether the bar drawings hold their peaks, and how long one is held for — see `eqPeakHold`. */
  peakHold: boolean
  peakDecay: number
  /** Whether the LED EQ draws its frequency bands along the bottom. */
  labels: boolean
  scopePersist: number
  scopeZoom: number
  scopeDraw: ScopeDraw
  /**
   * Whether the scope is fed the sound's own two channels rather than a synthesised ring.
   *
   * OFF by default, and that is the correction of a wrong guess: a polar scope plots one channel against the
   * other, so a sound whose channels are the SAME draws a fixed-angle spoke however many channels its
   * container has — and a mono signal stored as stereo is the commonest case of that by far. Measured, that
   * sound reaches one column band of twenty as a spoke and fourteen as a ring. So the ring is what a scope
   * draws unless it is told otherwise, and TRUE STEREO is the opt-in for genuinely wide music.
   */
  trueStereo: boolean
}

export const DEFAULT_TUNE: DrawingTune = {
  theme: 'green',
  waveScale: WAVE_DEFAULT_SCALE,
  waveWeight: WAVE_DEFAULT_WEIGHT,
  waveChannels: WAVE_DEFAULT_CHANNELS,
  spectrumScale: SPECTRUM_DEFAULT_SCALE,
  spectrumSaturation: SPECTRUM_DEFAULT_SATURATION,
  segmented: false,
  segmentGap: SEGMENT_DIVIDER,
  peakHold: false,
  peakDecay: EQ_DEFAULT_PEAK_DECAY,
  labels: false,
  scopePersist: SCOPE_DEFAULT_PERSIST,
  scopeZoom: SCOPE_DEFAULT_ZOOM,
  scopeDraw: SCOPE_DEFAULT_DRAW,
  trueStereo: false,
}

/**
 * A preset's knobs, resolved with the defaults filled in and every figure held to what the filters take.
 *
 * The template's OWN defaults are what an absent field falls back to — see `drawingDefaultsFor` — so a job
 * that picks LED EQ gets its hold and its blocks without being asked, while a job that says nothing at all
 * still resolves exactly as it always did, because the templates that declare no defaults declare none. A
 * peak hold is off when its decay is nothing as well as when it is not asked for: a peak that falls instantly
 * is no peak, and the two ways of saying off should mean the same thing to the graph.
 */
export const drawingTuneOf = (preset: Pick<EncodingPreset,
  'visualization' | 'drawingTheme' | 'waveScale' | 'waveWeight' | 'waveChannels' | 'spectrumScale' | 'spectrumSaturation' |
  'eqSegmented' | 'eqPeakHold' | 'eqPeakDecay' | 'eqSegmentGap' | 'eqLabels' | 'scopePersist' | 'scopeZoom' | 'scopeDraw' | 'scopeTrueStereo'>): DrawingTune => {
  const own = drawingDefaultsFor(preset.visualization)
  const peakDecay = clampPeakDecay(preset.eqPeakDecay ?? own.peakDecay ?? EQ_DEFAULT_PEAK_DECAY)
  return {
    theme: themeFor(preset.drawingTheme).id,
    waveScale: WAVE_SCALES.includes(preset.waveScale as WaveScale) ? (preset.waveScale as WaveScale) : WAVE_DEFAULT_SCALE,
    waveWeight: preset.waveWeight === 'line' ? 'line' : WAVE_DEFAULT_WEIGHT,
    waveChannels: preset.waveChannels === 2 ? 2 : WAVE_DEFAULT_CHANNELS,
    spectrumScale: SPECTRUM_SCALES.includes(preset.spectrumScale as SpectrumScale) ? (preset.spectrumScale as SpectrumScale) : SPECTRUM_DEFAULT_SCALE,
    spectrumSaturation: clampSaturation(preset.spectrumSaturation ?? SPECTRUM_DEFAULT_SATURATION),
    segmented: (preset.eqSegmented ?? own.segmented) === true,
    segmentGap: clampSegmentGap(preset.eqSegmentGap ?? own.segmentGap ?? SEGMENT_DIVIDER),
    peakHold: (preset.eqPeakHold ?? own.peakHold) === true && peakDecay > EQ_PEAK_DECAY_MIN,
    peakDecay,
    labels: (preset.eqLabels ?? own.labels) === true,
    scopePersist: clampScopePersist(preset.scopePersist ?? SCOPE_DEFAULT_PERSIST),
    scopeZoom: clampScopeZoom(preset.scopeZoom ?? SCOPE_DEFAULT_ZOOM),
    scopeDraw: preset.scopeDraw === 'dot' ? 'dot' : SCOPE_DEFAULT_DRAW,
    trueStereo: preset.scopeTrueStereo === true,
  }
}

/** Everything one drawing is made from: the template, the two sizes, the palette and the knobs. */
interface DrawingRequest {
  template: Visualization
  /** The bounded canvas the drawing is made on, which is what the templates that use one are made at. */
  canvas: { width: number; height: number }
  /** The frame the drawing is scaled up to, which is where every template ends up. */
  frame: { width: number; height: number }
  fps: number
  color: string
  tune: DrawingTune
  eq: EqStyle
}

/**
 * The size a drawing is MADE at.
 *
 * The bars templates are made one pixel per bar at the frame's own height — or at half of it when the drawing
 * is to be mirrored, because the mirror stacks two of them — and the scope is made square. Everything else is
 * made at the capped canvas and scaled up smoothly, which is what `drawingCanvas` explains.
 */
const drawingSize = (request: DrawingRequest): string => {
  const { template, frame, eq } = request
  if (isBarsTemplate(template)) return `${eq.bars}x${barsDrawHeight(template, frame.height)}`
  if (template === 'scope') return `${scopeSide(frame)}x${scopeSide(frame)}`
  return `${request.canvas.width}x${request.canvas.height}`
}

/** The height a bars drawing is made at: the frame's, or half of it when it is to be mirrored. */
const barsDrawHeight = (template: Visualization, frameHeight: number): number =>
  isMirroredTemplate(template) ? evenNumber(frameHeight / 2) : Math.max(2, frameHeight)

/**
 * Where a bars drawing's bars land on the frame: the whole-pixel width of one, the strip they fill, and the
 * leftover that is centred.
 *
 * One geometry, read by the stage that draws the bars and by the panel that is drawn beneath MATRIX PANEL's
 * active layer, so the built panel's cells line up with the bars rather than beside them. See the stage's own
 * note for why the count is the width and the leftover is padded rather than stretched.
 */
export const barsGeometry = (frameWidth: number, bars: number): { barPx: number; strip: number; pad: number } => {
  const barPx = Math.max(1, Math.floor(frameWidth / bars))
  const strip = Math.max(1, barPx * bars)
  const pad = Math.max(0, Math.round((frameWidth - strip) / 2))
  return { barPx, strip, pad }
}

/**
 * One template's filter — the ONE its preview and its export are both made from.
 *
 * This is the whole of the "what you see is what you get" rule: the editor's still and the encoder's picture
 * are built from this same function, with the same parameters, so they cannot be two different drawings. A
 * picture template draws the whole sound into a single frame here; a moving one draws an instant.
 *
 * `showspectrum` and `showspectrumpic` are the odd ones twice over. They have no colour of their own — the
 * ramp is ffmpeg's `color`, which is why the editor offers them no colour field — and the scrolling one has to
 * be told to SLIDE, because left on its default it draws one column per emitted frame into a frame nothing
 * ever fills: measured, a four-second tone reads a maximum luma of 16 (black) in the right-hand column at one
 * second, two seconds and at the end, while `slide=scroll` reads 233 to 235 at every one of them. The picture
 * one needs `legend=0` for the same kind of reason: its legend band occupies the right-hand edge, so with the
 * default the picture does not reach its own frame. Their ramp comes from the THEME, and both themes' ramps
 * are single-hue — green, and the warm `fiery` for amber — because a rainbow would make a drawing a different
 * thing from the instrumentation the rest of it is.
 *
 * The scrolling WAVEFORM fills rather than strokes, and the measurement is worth keeping: `mode=line` (a
 * vertical line per sample) covers about a FIFTH of what `mode=cline` (a centred one) does at a 1080-row
 * frame, which is why the lighter mode read as a blank monitor — so the fill is `cline` with `draw=full`,
 * and the WEIGHT knob is what makes it lighter. `draw=full` is the heavier of ffmpeg's two draw modes and is
 * its own recommendation for a high sample-per-column count, which is what a 30fps drawing of 48kHz audio is.
 */
const drawingFilters = (request: DrawingRequest): string => {
  const { template, fps, color, eq, tune } = request
  const size = drawingSize(request)
  const theme = themeFor(tune.theme)
  // ONE waveform or two, which is a DOWNMIX rather than a filter option: the two filters draw a channel per
  // row, so a stereo input fills the frame with two rows whichever way `split_channels` is set. Measured, a
  // stereo source inks the whole frame height and the same sound downmixed inks the middle of it. So `1`
  // mixes down and asks for no split, and `2` hands over the pair and asks it to split them.
  const twoWaveforms = tune.waveChannels === 2
  const waveLead = twoWaveforms ? '' : `${MONO_MIX},`
  const wave = `scale=${tune.waveScale}:draw=${tune.waveWeight === 'fill' ? 'full' : 'scale'}:split_channels=${twoWaveforms ? 1 : 0}`
  // A colour LIST, one entry per channel the filter may be handed: a short list leaves the channels it does
  // not cover in the filter's own default, which is how a stereo source came to be drawn in white.
  const colors = colourList(color)
  if (isBarsTemplate(template)) return `showfreqs=s=${size}:mode=bar:ascale=${eq.amplitude}:fscale=${eq.frequency}:minamp=${eq.sensitivity}:rate=${fps}:colors=${colors}`
  if (template === 'scope') {
    // The scope's colour is three channel CONTRASTS rather than a hex — it has no colour option — so the
    // drawing's own colour is what decides it, and the fade is the inverse of the persistence.
    const fade = scopeFade(tune.scopePersist)
    const channels = scopeChannelsOf(color)
    return `avectorscope=mode=polar:rate=${fps}:draw=${tune.scopeDraw}:zoom=${tune.scopeZoom}:rc=${channels.red}:gc=${channels.green}:bc=${channels.blue}:rf=${fade}:gf=${fade}:bf=${fade}:s=${size}`
  }
  if (template === 'spectrum') return `showspectrumpic=s=${size}:mode=combined:color=${theme.ramp}:saturation=${tune.spectrumSaturation}:scale=${tune.spectrumScale}:legend=0`
  if (template === 'spectrum-scroll') return `showspectrum=s=${size}:mode=combined:color=${theme.ramp}:saturation=${tune.spectrumSaturation}:scale=${tune.spectrumScale}:slide=scroll,fps=${fps}`
  if (template === 'waveform-scroll') return `${waveLead}showwaves=s=${size}:mode=cline:${wave}:rate=${fps}:colors=${colors}`
  return `${waveLead}showwavespic=s=${size}:${wave}:colors=${colors}`
}

/**
 * The same drawing, as the export's own picture: a PICTURE is held for the whole sound, a moving one is not.
 *
 * A picture is one frame, so on its own it would be one frame of video: `loop` holds it, and the export is
 * then as long as the sound it is drawn from. This is the only difference between what the editor shows and
 * what the encoder writes — a loop is not a look, so the still the editor draws is a frame of exactly this.
 */
const exportDrawingFilters = (request: DrawingRequest): string => {
  const drawn = drawingFilters(request)
  return templateFor(request.template).kind === 'picture' ? `${drawn},loop=loop=-1:size=1` : drawn
}

/**
 * The chains that bring a drawn picture to the frame: what to scale it to, and what to do at the frame's size.
 *
 * Three templates need more than a scale, and each of them for a reason that is arithmetic rather than taste:
 *
 * - The BARS templates are where the bar count and the gap become exact. `showfreqs` draws one bar per output
 *   column, so the count IS the width and a fractional column is a bar that is not quite where the next one
 *   starts. So the drawing is made one pixel per bar and stretched nearest-neighbour to a WHOLE number of
 *   pixels per bar (`floor(frameWidth / bars)`), which leaves a strip narrower than the frame; that strip is
 *   centred on a black pad rather than stretched over it, which is what keeps the last bar the same width as
 *   the first. The grids are then drawn from the PAD's own origin, so a gap lands on a bar boundary instead of
 *   drifting off it towards the right-hand end — the two faults reported as uneven bars and misaligned gaps.
 * - MIRRORED BARS is the same drawing mirrored: the two halves are stacked about the centre line, so the bars
 *   grow both ways from it. That is why its drawing is made at HALF the frame's height and the mirror's second
 *   copy makes up the rest.
 * - The SCOPE is a CIRCLE, so it is drawn square and centred: stretched to a 16:9 frame the ring would be an
 *   ellipse. The square is the frame's short side, padded with the background either side of it.
 */
interface DrawingStage {
  /** The size the drawing is scaled to, after which `finish` takes it to the frame. */
  scale: { width: number; height: number }
  flags: string
  /**
   * The suffix from the scaled drawing to `target`: the padding, the grids, and the label.
   *
   * It carries its OWN leading comma when it has anything to add, because one of the three chains it is used
   * in has already spent a comma on the filter before it and the other two have not. A suffix that led with
   * a bare filter name would join onto the scale's options and be read as one of them — which is how
   * `flags=neighborpad=…` happens.
   */
  finish: (target: string) => string
  /** Whether the drawing is mirrored about its centre, which needs two chains rather than a suffix. */
  mirror: boolean
}

const drawingStage = (request: DrawingRequest): DrawingStage => {
  const { template, frame, eq, tune, color } = request
  if (template === 'scope') {
    const side = scopeSide(frame)
    const x = Math.max(0, Math.round((frame.width - side) / 2))
    return { scale: { width: side, height: side }, flags: 'lanczos', finish: (target) => `,pad=${frame.width}:${frame.height}:${x}:0:color=black${target}`, mirror: false }
  }
  if (isBarsTemplate(template)) {
    const { barPx, strip, pad } = barsGeometry(frame.width, eq.bars)
    // The gap is a share of a bar, so it stops meaning anything on a bar a couple of pixels wide: past that it
    // is turned off rather than drawn as a comb.
    const gap = eq.gap > 0 && barPx >= EQ_MIN_BAR_PX ? `,drawgrid=x=${pad}:y=99999:w=${barPx}:h=99999:t=${eq.gap}:c=black` : ''
    // The segment dividers are drawn with a height the frame divides EXACTLY into, so every block is whole —
    // the top one included, which a grid aligned from the baseline would leave cut off. The gap between them
    // is the knobs', and MATRIX PANEL's active layer is always segmented: its whole idea is bright cells over a
    // field of dim ones, and a solid bar over a celled field would read as neither.
    const segmented = tune.segmented || template === 'matrix-panel'
    const segments = segmented ? `,drawgrid=x=99999:y=0:w=99999:h=${segmentHeight(frame.height)}:t=${tune.segmentGap}:c=black` : ''
    // The band labels are drawn LAST, over the finished frame, so they sit on the blocks rather than under
    // them — and only the LED EQ is offered them, because on a sixty-four bar spectrum seven labels would be
    // reading under bars they do not name.
    const labels = template === 'led-eq' && tune.labels ? labelFilters(frame, color) : ''
    return {
      scale: { width: strip, height: barsDrawHeight(template, frame.height) },
      flags: 'neighbor',
      finish: (target) => `,pad=${frame.width}:${frame.height}:${pad}:0:color=black${gap}${segments}${labels}${target}`,
      mirror: isMirroredTemplate(template),
    }
  }
  // Everything else is drawn at the frame's own size already, so there is nothing between the scale and the
  // label and the suffix is the label alone — no comma, nothing to join.
  return { scale: { ...frame }, flags: 'lanczos', finish: (target) => target, mirror: false }
}

/**
 * The band labels along the bottom of an LED EQ, one per named frequency, in the drawing's own colour.
 *
 * The font is named rather than left to the system: a label is a readout and has to be legible, and the app is
 * a macOS one where this face is always present. `drawtext` needs to be told SOMETHING — left entirely to
 * fontconfig it picks a proportional face, which reads as a caption rather than as an instrument scale. The
 * bands are spaced evenly across the width and each label is nudged in from its division's leading edge, which
 * is the one layout that holds whatever the bar count; a true frequency axis would need the labels to track
 * the filter's `fscale`, which is a mapping `drawtext` cannot be handed.
 */
const LABEL_FONT = 'Menlo'

const labelFilters = (frame: { width: number; height: number }, colour: string): string => {
  const size = Math.max(10, Math.round(frame.height * 0.03))
  const y = Math.max(0, frame.height - size - Math.round(frame.height * 0.02))
  const step = frame.width / EQ_LABEL_FREQUENCIES.length
  return EQ_LABEL_FREQUENCIES.map((label, index) =>
    `,drawtext=font=${LABEL_FONT}:text=${label}:x=${Math.round(index * step + step * 0.06)}:y=${y}:fontsize=${size}:fontcolor=${colour}`,
  ).join('')
}

/**
 * The decay a bar drawing's peak hold is made with, or nothing where it is not asked for.
 *
 * The toggle and the decay are two ways of asking for the same thing and both have to agree: a hold that was
 * switched on and then faded to nothing is off, and so is one nothing turned on. The filter only exists when
 * this returns a figure, which is what keeps a hold nobody asked for out of the graph entirely.
 */
const peakHoldDecay = (request: DrawingRequest): number | null => {
  if (!isBarsTemplate(request.template) || !request.tune.peakHold) return null
  return request.tune.peakDecay > EQ_PEAK_DECAY_MIN ? request.tune.peakDecay : null
}

/**
 * MATRIX PANEL's lit field: every cell of the panel at a share of the drawing's colour.
 *
 * A source rather than a filter, because there is nothing to derive it from — the unlit cells are lit whether
 * or not the sound is there, which is the whole difference between a panel and a bar chart. It is built at the
 * SAME bar geometry as the active layer above it and its grids are drawn from the same pad origin, so a cell of
 * the field sits exactly under the bar that will light it. The two are then combined by LIGHTENING, which is
 * the one blend that gives the composite the behaviour the look needs: where the active bar is bright it wins,
 * where it is dark the field shows through, and the active layer's own black padding — the leftover when the
 * bar count does not divide the frame — leaves the field rather than a black stripe.
 */
const matrixPanelChain = (request: DrawingRequest): string => {
  const { frame, eq, tune, color, fps } = request
  const { barPx, pad } = barsGeometry(frame.width, eq.bars)
  const dim = dimmedColour(color, MATRIX_DIM_SHARE)
  const gap = eq.gap > 0 && barPx >= EQ_MIN_BAR_PX ? `,drawgrid=x=${pad}:y=99999:w=${barPx}:h=99999:t=${eq.gap}:c=black` : ''
  const segments = `,drawgrid=x=99999:y=0:w=99999:h=${segmentHeight(frame.height)}:t=${tune.segmentGap}:c=black`
  return `color=c=${dim}:s=${frame.width}x${frame.height}:r=${fps}${gap}${segments}[panel]`
}

/**
 * The chains that draw one template's picture to `target`, at the frame's own size.
 *
 * More than a scale is needed in four of the cases, and each for a reason that is arithmetic rather than taste:
 *
 * - The BARS templates come to the frame through `drawingStage`, which is where the bar count and the gap
 *   become exact — see its own note.
 * - A PEAK HOLD is a split, a `lagfun` and a recombine, so it is chains rather than a suffix: the drawing is
 *   forked, one fork is run through `lagfun` so its brightest points fall slowly instead of vanishing, and the
 *   two are merged by LIGHTENING — so a live bar is its full height while the peak above it lingers and fades.
 * - The MIRROR is two half-drawings stacked, as it always was.
 * - MATRIX PANEL adds a source beneath the two: a panel of dim cells, built where the drawing cannot reach, and
 *   merged with the active layer by the same lightening. Every other template's chains are byte for byte what
 *   they were, which is deliberate — the graph is asserted, so a change of shape has to be a change of look.
 */
const drawingChains = (request: DrawingRequest, input: string, filters: string, target: string): string[] => {
  const stage = drawingStage(request)
  const drawn = `${filters},scale=${stage.scale.width}:${stage.scale.height}:flags=${stage.flags}`
  if (request.template === 'scope' && !request.tune.trueStereo) {
    // One channel, then two that are a quarter of a cycle apart. The mix comes FIRST so the pair is built
    // from the sound rather than from the container: a mono signal stored as stereo has two identical
    // channels, and two identical channels are what draws a spoke.
    return [
      `${input}${MONO_MIX},asplit=2[scopeQ1][scopeQ2]`,
      '[scopeQ1]anull[scopeI]',
      '[scopeQ2]aphaseshift=shift=0.25[scopeQ]',
      `[scopeI][scopeQ]join=inputs=2:channel_layout=stereo,${drawn}${stage.finish(target)}`,
    ]
  }
  const hold = peakHoldDecay(request)
  if (hold == null && request.template !== 'matrix-panel') {
    // The shape every template had before any of this: one chain, or the mirror's three.
    if (stage.mirror) {
      return [
        `${input}${drawn},split[halfAbove][halfBelow]`,
        '[halfAbove]vflip[flipped]',
        `[flipped][halfBelow]vstack${stage.finish(target)}`,
      ]
    }
    return [`${input}${drawn}${stage.finish(target)}`]
  }
  // The drawing, then its hold, then its mirror, each stage taking the label the one before it left.
  const chains: string[] = []
  let body = `${input}${drawn}`
  if (hold != null) {
    chains.push(`${body},split[holdLive][holdGhostSrc]`)
    chains.push(`[holdGhostSrc]lagfun=decay=${hold}[holdGhost]`)
    body = '[holdLive][holdGhost]blend=all_mode=lighten'
  }
  if (stage.mirror) {
    chains.push(`${body},split[holdHalfAbove][holdHalfBelow]`)
    chains.push('[holdHalfAbove]vflip[holdFlipped]')
    body = '[holdFlipped][holdHalfBelow]vstack'
  }
  if (request.template === 'matrix-panel') {
    chains.push(`${body}${stage.finish('[active]')}`)
    chains.push(matrixPanelChain(request))
    // `shortest` because the panel is an endless source and the drawing is not: without it the merge would
    // wait for the panel to finish, which it never does.
    chains.push(`[panel][active]blend=all_mode=lighten:shortest=1${target}`)
    return chains
  }
  chains.push(`${body}${stage.finish(target)}`)
  return chains
}

/**
 * The quarter-cycle the scope's synthesised pair is opened with.
 *
 * A polar scope plots one channel against the other, so a sound whose channels are the SAME draws a
 * fixed-angle spoke: the sound is mixed to one channel, split, and one half is shifted a quarter of a cycle
 * (`aphaseshift`'s own unit is a cycle, so 0.25 is 90°), and the halves are joined into a stereo pair, which
 * opens it out into a ring. This filter and its unit were both checked on this build rather than assumed, and
 * the branch is demonstrably live: measured, the same sound reaches one column band of twenty as a spoke and
 * fourteen as a ring, so the filter is doing the work rather than passing the pair through untouched.
 */
export const SCOPE_QUADRATURE_SHIFT = 0.25

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
  /** The EQ's own knobs, when the template is one. Absent means the defaults — see `DEFAULT_EQ_STYLE`. */
  eq?: EqStyle
  /** The palette and the knobs. Absent means the defaults — see `DEFAULT_TUNE`. */
  tune?: DrawingTune
}

/**
 * The one drawing the editor LOOKS at, as a single still rather than as an export.
 *
 * The templates are built from the same filters the export uses, at the same bounded canvas, so what the
 * editor judges is what they will get. Every template but the two PICTURES has no still of its own and is
 * captured as a frame of the drawing after its warm-up — see `stillWarmupSeconds`, which is what keeps a
 * scroll or a scope from being photographed at the one moment it is empty.
 */
export const visualizationStillGraph = (request: VisualizationStillRequest): string => {
  const { template, width, height, fps, color, sources, background, progressLine, eq, tune } = request
  const canvas = drawingCanvas(width, height, templateMaxEdge(template))
  const style = eq ?? DEFAULT_EQ_STYLE
  const knobs = tune ?? DEFAULT_TUNE
  const drawing: DrawingRequest = { template, canvas, frame: { width, height }, fps, color, tune: knobs, eq: style }
  const mixed = '[mixed]'
  const listening = sources.length === 1
    ? `[${sources[0]}]anull${mixed}`
    : `${sources.map((label) => `[${label}]`).join('')}amix=inputs=${sources.length}:normalize=0${mixed}`
  const base = typeof background === 'string'
    ? `color=c=${background}:s=${width}x${height}:r=${fps}[bg]`
    : `[${background.input}:v]scale=${width}:${height},setsar=1[bg]`
  // The line is shown at x=0 rather than hidden: the sweep is what the export does, and the still's job is to
  // show that the design has a bar in it. Pinned left is also the one moment the export's own picture shares.
  const line = progressLine ? progressLineGraph(template, height, fps, 0, true) : null
  return [
    listening,
    ...drawingChains(drawing, mixed, drawingFilters(drawing), '[scaled]'),
    base,
    '[bg][scaled]overlay=shortest=1[plate]',
    ...(line
      ? [line.bar, `[plate][bar]${line.overlay},format=yuv420p[out]`]
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
  const { template, width, height, fps, color, sources, background, rate, channels, duration, progressLine, eq, tune } = request
  const canvas = drawingCanvas(width, height, templateMaxEdge(template))
  const drawing: DrawingRequest = {
    template,
    canvas,
    frame: { width, height },
    fps,
    color,
    tune: tune ?? DEFAULT_TUNE,
    eq: eq ?? DEFAULT_EQ_STYLE,
  }
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
    // The drawing, through the very chains the editor's own still is built from — the scale, the mirror and
    // the bars' stretch and grids included — so a knob the editor draws is a knob the encoder honours.
    ...drawingChains(drawing, '[mixV]', exportDrawingFilters(drawing), '[w]'),
    base,
    '[bg][w]overlay=shortest=1[plate]',
    ...(line
      ? [line.bar, `[plate][bar]${line.overlay},format=yuv420p[v]`]
      : ['[plate]format=yuv420p[v]']),
  ].join(';')
}
