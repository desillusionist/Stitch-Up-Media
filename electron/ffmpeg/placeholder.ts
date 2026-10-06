import { normaliseFill } from '../../src/lib/placeholder'

/**
 * The ffmpeg sources that stand in for an ADD BLANK / ADD SILENCE placeholder.
 *
 * A placeholder has no file, so the encoder asks ffmpeg's own `lavfi` device for one. It is given as ONE input
 * carrying one stream or two, using the demuxer's `[out0]`/`[out1]` names, which is what lets a BLANK be a
 * clip like any other: its picture is `out0` and its sound `out1`, so `-map 0:v` and `-map 0:a` mean for it
 * exactly what they mean for a file, and every input index downstream stays where it was.
 *
 * Kept here, PURE, so the harness renders the very same source the app uses rather than a copy of the string.
 */
export const blankSource = (fill: string, width: number, height: number, fps: number, seconds: number): string =>
  `color=c=0x${normaliseFill(fill)}:s=${Math.max(2, Math.round(width))}x${Math.max(2, Math.round(height))}:r=${fps > 0 ? fps : 30}:d=${Math.max(0.01, seconds).toFixed(3)}[out0];`
  + `anullsrc=channel_layout=stereo:sample_rate=48000:d=${Math.max(0.01, seconds).toFixed(3)}[out1]`

/** The lavfi source that IS a SILENCE: digital silence alone, at the output's own layout, for a set length. */
export const silenceSource = (seconds: number): string =>
  `anullsrc=channel_layout=stereo:sample_rate=48000:d=${Math.max(0.01, seconds).toFixed(3)}[out0]`
