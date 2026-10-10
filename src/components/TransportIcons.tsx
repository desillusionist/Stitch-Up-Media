import React from 'react'

/**
 * The monitor's TRANSPORT glyphs, as fixed-shape SVGs rather than the bracket-and-pipe text they replaced.
 *
 * The transport used to read `[|<] FRAME  [>] PLAY  [>|] FRAME`, with the play/pause toggle written as the
 * characters `>` and `||`. Those are text, so their weight and width followed the button's font and the two
 * halves of the toggle sat on different baselines; these are drawn shapes that hold their own weight whatever
 * the button is set in. Each is filled with `currentColor`, so a button's own colour — including a hover or a
 * disabled dim — is the glyph's colour with nothing to keep in step.
 *
 * The shapes are pixel-stepped rather than smooth: the paths jog a pixel at a time, which is the grain of the
 * rest of the window. They carry no `fill` of their own, so the CSS that colours the button is what colours
 * them, exactly as the `lucide` icons used elsewhere in the window do.
 */
const Glyph: React.FC<{ size?: number; children: React.ReactNode; label: string }> = ({ size = 12, children, label }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" role="img" data-glyph={label}>
    {children}
  </svg>
)

/** Step back one frame: the bar-and-chevron that reads as the start, mirrored. */
export const PrevFrameIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Glyph size={size} label="prev">
    <path d="M6 4h2v16H6V4zm12 0h-2v2h-2v3h-2v2h-2v2h2v3h2v2h2v2h2V4z" />
  </Glyph>
)

/** Step forward one frame: the mirror of the step back. */
export const NextFrameIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Glyph size={size} label="next">
    <path d="M6 4h2v2h2v2h2v2h2v4h-2v2h-2v2H8v2H6V4zm12 0h-2v16h2V4z" />
  </Glyph>
)

/** Play: a single stepped chevron pointing forward. */
export const PlayIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Glyph size={size} label="play">
    <path d="M10 20H8V4h2v2h2v3h2v2h2v2h-2v2h-2v3h-2v2z" />
  </Glyph>
)

/** Pause: two stepped bars, the state the toggle holds while the monitor runs. */
export const PauseIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Glyph size={size} label="pause">
    <path d="M10 4H5v16h5V4zm9 0h-5v16h5V4z" />
  </Glyph>
)
