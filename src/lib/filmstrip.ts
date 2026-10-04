import { CropFractions, FrameSize } from './outputFrame'
import { SourceFit } from '../types'
import { fitSignature } from './sourceFit'

/**
 * Filmstrip rules for the EDIT JOB timeline.
 *
 * The lane width is DYNAMIC — `trimmedSeconds x pixelsPerSecond(zoom)` — so every figure below
 * is recomputed from the current one. That is the point: the strip must span exactly the lane
 * whatever its width is, and a wider lane must buy density rather than less of the range.
 *
 * A tile is the shape of the OUTPUT frame, not of the clip it came from, because a tile is a
 * small picture of the output: the frame the encoder will write, with the clip placed in it by
 * whatever fit it carries. That is what makes the strips read as one job rather than several:
 * every clip's tiles are the same shape, whatever the shapes of the files behind them, and a
 * clip that will be letterboxed shows the letterbox it will get.
 *
 * The two things that must never happen are partial coverage and sampling outside the trim.
 * Coverage comes from the step being derived from the tile count, and the samples are offset
 * by the clip's in-point and stepped across the trimmed span, so each thumbnail shows the frame
 * the playhead would show at that place on the lane.
 */

/**
 * How tall a tile is drawn. This is the lane's row height, and it is the one number the whole
 * strip hangs off: the tile count is worked out from it, and the stylesheet draws the tile at
 * it too (by way of the `--filmstrip-tile` property the timeline sets from this figure), so the
 * picture that is extracted and the picture that is painted are the same size.
 */
export const FILMSTRIP_CLIP_HEIGHT = 38

/** The multiple the tiles are generated at, so they stay crisp on a retina panel. */
export const FILMSTRIP_SCALE = 2

/**
 * How long the lane's width has to hold still before frames are extracted for it.
 *
 * The strip's LAYOUT follows the width as it changes, one animation frame behind at most, but the
 * frames themselves are not asked for until the width settles: a drag of the window edge names a
 * slightly different set of frames on every frame of it, and extracting for each of those would
 * put an ffmpeg behind the whole drag.
 */
export const FILMSTRIP_SETTLE_MS = 180

export interface FilmstripPlan {
  /** A tile's width, from the shape of the output frame. */
  thumbWidth: number
  /** How many tiles fit across the lane as it is right now. */
  thumbCount: number
  /**
   * Each cell's share of the lane. The cells share the lane exactly, so there is no end gap. This
   * is the width the tile is PAINTED at, in pixels — not a percentage of the clip — so the strip
   * on screen is this arithmetic's and cannot be stretched by whatever the clip's box turns out
   * to be. A percent width was the bug: while a resize was in progress the count was a layout
   * behind, and the tiles stretched to fill the clip instead of the strip growing denser.
   */
  cellWidth: number
  /** Source frames between one tile and the next. Fractional on purpose — never floor it. */
  step: number
  /** Absolute SOURCE TIME each tile samples, at its own cell's midpoint. */
  times: number[]
  /** The absolute source frame each time falls on, which is the key its picture is cached under. */
  frames: number[]
}

/**
 * Lay a clip's strip out across the lane as it is now.
 *
 * The tile is the shape of the output frame — so every strip in a job has the same tile shape
 * whatever its clips are — and the count is how many of those fit across the lane, the cells
 * being equal shares of it. A tile therefore holds a small picture of the output: the clip placed
 * in the frame by its own fit, the same placement the encoder is handed.
 */
export const computeFilmstrip = (o: {
  laneWidth: number
  thumbHeight: number
  /** The OUTPUT frame's width over its height, which is what a tile is shaped like. */
  outAspect: number
  fps: number
  inSec: number
  outSec: number
}): FilmstripPlan => {
  const outAspect = Number.isFinite(o.outAspect) && o.outAspect > 0 ? o.outAspect : 16 / 9
  const thumbHeight = o.thumbHeight > 0 ? o.thumbHeight : FILMSTRIP_CLIP_HEIGHT
  const thumbWidth = Math.max(1, Math.round(thumbHeight * outAspect))
  const laneWidth = Number.isFinite(o.laneWidth) ? Math.max(0, o.laneWidth) : 0
  const fps = o.fps > 0 ? o.fps : 30
  const inFrame = Math.max(0, Math.round(o.inSec * fps))
  const trimmed = Math.max(1, Math.round((o.outSec - o.inSec) * fps))
  // How many whole tiles fit across the lane as it is now, and never more than there are frames to
  // fill them with: past that the same frame would be asked for twice over, which is work for
  // nothing. There is deliberately no other ceiling on this. There used to be a fixed one, and
  // past it the count stopped rising with the lane and every tile simply grew, so a wider window
  // or a deeper zoom magnified the strip instead of packing more frames into it. The lane's own
  // width is the bound, and a tile's own width is what decides the count.
  const thumbCount = Math.max(1, Math.min(Math.round(laneWidth / thumbWidth), trimmed))
  const cellWidth = laneWidth / thumbCount
  const step = trimmed / thumbCount
  // A time and the frame it falls on, derived together so the picture a tile shows and the key
  // it is cached under cannot drift apart. The time is what is asked for, because seeking to a
  // time works on any source however its frames are numbered; the frame index is what is cached,
  // because that is what stays stable when the lane is re-laid out and the times shift a little.
  const times = Array.from({ length: thumbCount }, (_, index) => o.inSec + ((index + 0.5) * step) / fps)
  const frames = times.map((time) => Math.max(inFrame, Math.min(inFrame + trimmed - 1, Math.round(time * fps))))
  return { thumbWidth, thumbCount, cellWidth, step, times, frames }
}

/**
 * The identity of a thumbnail: the frame, and everything that decides what its picture looks like.
 *
 * The source frame alone will not do, because the same frame is a different picture under a
 * different placement: the frame it is being fitted into, the offset it is cropped at, and the
 * crop the job applies are all part of it. Frames cached under one placement must never be served
 * for another, which is what toggling a fit or dragging the offset would otherwise do.
 */
export const frameKey = (index: number, signature: string): string => `${index}|${signature}`

/**
 * Everything that changes a thumbnail's picture, as one key.
 *
 * Shared by the editor that asks for the pictures and the main process that extracts and caches
 * them, so the two cannot disagree about which picture a key names.
 */
export const thumbnailSignature = (input: { source: FrameSize; frame: FrameSize; fit?: SourceFit; crop?: CropFractions }): string => {
  const crop = input.crop
  const cropKey = crop ? [crop.left, crop.top, crop.right, crop.bottom].map((edge) => (Number.isFinite(edge) ? edge.toFixed(4) : '0')).join(',') : 'none'
  return `${fitSignature(input)}|${cropKey}`
}
