/**
 * The ffmpeg arguments that render an ADD BLANK / ADD SILENCE placeholder.
 *
 * Kept out of `main.ts` and PURE, so the harness can render the very same file the app hands the editor
 * rather than a copy of the command — the same reason the encoder's paths are exercised by their own
 * harnesses rather than by re-stating their arguments.
 *
 * A BLANK carries BOTH streams. That is not decoration: a stitch joins its clips through a demuxer that
 * wants the same streams on each, so a picture-only blank would break the join it was placed to lengthen,
 * and a blank between two clips should also be cross-dissolvable, which needs a sound as well as a picture.
 * A SILENCE carries sound alone.
 *
 * `PLACEHOLDER_MAX_SECONDS` is deliberately long: the file is generated once and the length a reader wants
 * is set on the TIMELINE by stretching the clip, not by regenerating the file.
 */
export const PLACEHOLDER_MAX_SECONDS = 600

export const placeholderArgs = (kind: 'video' | 'audio', seconds: number = PLACEHOLDER_MAX_SECONDS): string[] => {
  if (kind === 'audio') {
    return ['-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=48000:d=${seconds}`,
      '-c:a', 'aac', '-b:a', '128k']
  }
  return [
    '-f', 'lavfi', '-i', `color=c=black:s=1280x720:r=30:d=${seconds}`,
    '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=48000:d=${seconds}`,
    // H.264 at 4:2:0 limited range with the index at the front, so a `<video>` element plays and seeks it
    // exactly as it plays the generated still clips — the same reason the sequence clip names them.
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', '30',
    '-c:a', 'aac', '-b:a', '128k', '-shortest',
  ]
}
