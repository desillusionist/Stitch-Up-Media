import React from 'react'

/**
 * The closed-caption mark, drawn from the reader's own SVG (svgrepo, `closed-caption--filled`).
 *
 * It takes its colour from the text, so it is the row's ink in every theme rather than a black square: the supplied art
 * is a filled rectangle with the two C's knocked out of it, and `fill: currentColor` keeps that relationship while
 * letting the stylesheet say what the colour is.
 */
export const CaptionIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M28,6H4A2,2,0,0,0,2,8V24a2,2,0,0,0,2,2H28a2,2,0,0,0,2-2V8A2,2,0,0,0,28,6ZM15,13H10v6h5v2H10a2,2,0,0,1-2-2V13a2,2,0,0,1,2-2h5Zm10,0H20v6h5v2H20a2,2,0,0,1-2-2V13a2,2,0,0,1,2-2h5Z" />
  </svg>
)
