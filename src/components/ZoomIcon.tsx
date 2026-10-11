import React from 'react'

/**
 * The monitor's ZOOM glyph: a magnifying glass, drawn rather than written.
 *
 * The zoom control was a labelled dropdown on a row below the monitor; it is an icon BUTTON in the monitor's own
 * bottom-left corner now, with the chosen scale written beside it. The shape is pixel-stepped like the rest of the
 * window's glyphs, is filled with `currentColor` so the button's hover colours it, and carries no `fill` of its
 * own.
 */
export const ZoomIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg className="preview-zoom-icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M6 2h8v2H6V2zM4 6V4h2v2H4zm0 8H2V6h2v8zm2 2H4v-2h2v2zm8 0v2H6v-2h8zm2-2h-2v2h2v2h2v2h2v2h2v-2h-2v-2h-2v-2h-2v-2zm0-8h2v8h-2V6zm0 0V4h-2v2h2z" />
  </svg>
)
