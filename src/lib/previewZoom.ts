import { FitMode, FrameSize, fitFrameBy } from './outputFrame'

/**
 * How the monitor sizes what it shows.
 *
 * This is the VIEWER's zoom and nothing else. It changes how large the output frame and the
 * picture are drawn inside the preview panel; it never changes what is exported and never changes
 * how a clip is fitted into the output — that is the clip's own FIT TO WIDTH / FIT TO HEIGHT, a
 * different thing with a deliberately different name.
 *
 * The fit kinds are answered from the panel every time they are asked for, so they follow a resize
 * or a re-layout by themselves. A percentage is a share of the raster's own pixels, so it holds
 * still whatever the panel does, and one raster pixel at 100 per cent is one CSS pixel — which is
 * what makes 100 per cent mean here what it means everywhere else.
 */
export type PreviewZoom =
  | { kind: 'fit' }
  | { kind: 'fitWidth' }
  | { kind: 'fitHeight' }
  | { kind: 'percent'; percent: number }

/** The scales the monitor offers by name. */
export const PREVIEW_ZOOM_STEPS = [25, 50, 75, 100, 150, 200, 400] as const

/** A typed percentage is held inside these, so the frame can never be drawn off the scale. */
export const MIN_PREVIEW_ZOOM = 5
export const MAX_PREVIEW_ZOOM = 800

/** The whole frame visible on open, which is the only useful place to start. */
export const DEFAULT_PREVIEW_ZOOM: PreviewZoom = { kind: 'fit' }

/** A typed figure as a zoom: whole percentages, inside the range, with nonsense falling back. */
export const clampPreviewZoom = (percent: number): number => {
  if (!Number.isFinite(percent) || percent <= 0) return 100
  return Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, Math.round(percent)))
}

/** The fitting the frame arithmetic already knew, so the two vocabularies meet in one place. */
export const zoomFitMode = (zoom: PreviewZoom): FitMode =>
  zoom.kind === 'fitWidth' ? 'width' : zoom.kind === 'fitHeight' ? 'height' : 'contain'

/** Whether a percentage is one of the named scales, which is what the list shows. */
export const isPresetZoom = (percent: number): boolean =>
  (PREVIEW_ZOOM_STEPS as readonly number[]).includes(percent)

/**
 * The size a raster is drawn at inside the panel.
 *
 * A fit is the raster's shape fitted into the panel, which is why it follows a resize. A
 * percentage is the raster's own pixels scaled, which is why it does not.
 */
export const zoomedRaster = (raster: FrameSize, zoom: PreviewZoom, viewport: FrameSize): FrameSize | null => {
  if (!(raster.width > 0) || !(raster.height > 0)) return null
  if (zoom.kind !== 'percent') return fitFrameBy(viewport, raster.width / raster.height, zoomFitMode(zoom))
  const percent = clampPreviewZoom(zoom.percent)
  return { width: (raster.width * percent) / 100, height: (raster.height * percent) / 100 }
}

/**
 * How far what is drawn may be moved inside the panel on one axis: half the overflow each way.
 *
 * Half rather than all of it, because the drawing starts centred: from there it can travel half
 * the overflow towards either edge and no further, so no part of it can be lost.
 */
export const panSlack = (content: number, viewport: number): number =>
  Math.max(0, ((Number.isFinite(content) ? content : 0) - (Number.isFinite(viewport) ? viewport : 0)) / 2)

/** Holds a pan inside that slack. A drawing that fits has no slack, so it does not move at all. */
export const clampPan = (offset: number, content: number, viewport: number): number => {
  const slack = panSlack(content, viewport)
  if (!Number.isFinite(offset)) return 0
  return Math.max(-slack, Math.min(slack, offset))
}
