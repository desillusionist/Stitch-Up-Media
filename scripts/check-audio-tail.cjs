/**
 * What the picture does when a track outlasts it.
 *
 * A multi-track job exists to play tracks under one visual, and the case it is FOR is a track that runs
 * longer than the picture does. What the output holds past the end of the picture is therefore a
 * decision the encoder makes on nearly every one of them, and the answer asked for is black: the export
 * keeps running to the length of its sound rather than stopping when the picture runs out.
 *
 * This runs the encoder's own multi-track path — not a copy of its arguments — on generated fixtures,
 * and reads the finished file back: how long it is, and what colour the picture is in the tail. Both
 * shapes are tried, because a visual is a clip in one job and an image sequence in the next, and the
 * sequence is the one whose length the probe cannot tell it (its first frame is a still).
 *
 * Three more questions are asked of the same encoder, because they are the other ways a sound-only
 * source meets a picture: whether a sound file asked for video is GIVEN a picture at all, whether a
 * container that cannot hold one is spared the attempt (an h264 stream asked for into a WAV is a failed
 * encode, not a WAV with a picture in it), and whether the language a track asks for reaches the stream
 * it is — which is an index into the OUTPUT, where a still cover's silent visual shifts every added
 * track down a place.
 *
 * Usage: node scripts/check-audio-tail.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { FFmpegEngine } = require('./.engine.cjs')

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message)))
    else resolve(stdout)
  })
})

const runFfmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

const probeValue = async (file, entries) => {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=noprint_wrappers=1:nokey=1', file])
  return String(out).trim()
}

/**
 * The language tag on the file's first AUDIO stream.
 *
 * Asked of the audio streams by name rather than read off the front of the list: the mp4 muxer writes
 * `und` on the video stream of a file nothing was said about, so the first tag in the file belongs to
 * the picture and says nothing at all about the track under test.
 */
const audioLanguage = async (file) => String(await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream_tags=language', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim()

/** One pixel of the frame at a time, as three numbers: what the picture there actually is. */
const pixelAt = async (file, time) => {
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'crop=2:2:10:10,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
  return [raw[0], raw[1], raw[2]]
}

/** What the file says about a stream's disposition, read from the video streams alone. */
const attachedPicture = async (file) => String(await run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream_disposition=attached_pic', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim()

/**
 * The brightest pixel in a frame, as its luma.
 *
 * A drawing has to be read this way rather than by sampling a point, or by averaging the frame: where a
 * waveform's line falls depends on the sound, so a point check would be a check on the fixture's
 * frequency, and a line two pixels thick averages away to nothing. The brightest luma separates the two
 * answers that matter — a drawing on black reads 150 and up, a black frame reads 16.
 */
const brightestLuma = async (file, time) => {
  const out = await run('ffmpeg', ['-hide_banner', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'])
  return Number(String(out).match(/YMAX=([\d.]+)/)?.[1] ?? 0)
}

/**
 /** How bright a narrow column of a frame is, at a fraction across it.
 *
 * Which is how a spectrum is asked whether it reaches the right-hand edge: `showspectrum` left on its
 * default draws one column per emitted frame into a frame nothing ever fills, so its right-hand side is
 * black for the whole export. Black through a limited-range encode reads 16.
 */
const columnLuma = async (file, time, fraction) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `crop=iw*0.04:ih:iw*${fraction}:0,signalstats,metadata=print:file=-`, '-f', 'null', '-'])
  return Math.round(Number(String(out).match(/YMAX=([\d.]+)/)?.[1] ?? 0))
}

/**
 * How different two exports are in a narrow column, at a fraction across it.
 *
 * This is how the progress line is asked whether it is drawn where it should be WITHOUT needing the rest of
 * the frame to be black: two jobs identical but for the line are blended by difference, and a column the line
 * is over reads high while a column it is not over reads near zero. A waveform can be asked more simply
 * because its drawing is a thin line on black, but a spectrum fills its frame, so "where the line is" has to
 * be read as a difference rather than as brightness.
 */
const columnDelta = async (file, reference, time, fraction) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-ss', String(time), '-i', reference, '-frames:v', '1', '-filter_complex', `[0:v][1:v]blend=all_mode=difference[d];[d]crop=iw*0.03:ih:iw*${fraction}:0,signalstats,metadata=print:file=-`, '-f', 'null', '-'])
  const values = [...String(out).matchAll(/YMAX=([\d.]+)/g)].map((match) => Number(match[1]))
  return Math.round(Math.max(0, ...values))
}

/** How far apart the brightest and darkest pixel of a frame are: how much is DRAWN in it. */
const contrast = async (file, time) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'])
  const text = String(out)
  const lo = Number(text.match(/YMIN=([\d.]+)/)?.[1] ?? 0)
  const hi = Number(text.match(/YMAX=([\d.]+)/)?.[1] ?? 0)
  return Math.round(hi - lo)
}

/** How many pictures the file holds, which is how a picture kept ONE FRAME long is caught. */
const frameCount = async (file) => Number(await run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'default=noprint_wrappers=1:nokey=1', file]))

/**
 * The average colour of where a drawing IS: a centre strip for a line, a centre column for bars and bands.
 *
 * The whole frame will not do. A waveform is a two-pixel line through a 1080-row picture, so the frame's own
 * average is black whichever colour the line is; the line's own rows have to be the thing measured.
 */
const drawnColour = async (file, time, template) => {
  const crop = template === 'waveform' || template === 'waveform-scroll' ? 'crop=iw:14:0:ih/2-7' : 'crop=8:ih:iw/2:0'
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `${crop},signalstats,metadata=print:file=-`, '-f', 'null', '-'])
  const text = String(out)
  return { u: Math.round(Number(text.match(/UAVG=([\d.]+)/)?.[1] ?? 0)), v: Math.round(Number(text.match(/VAVG=([\d.]+)/)?.[1] ?? 0)) }
}

/** What the whole frame averages to, which is how two moments are asked whether they are the same picture. */
const frameAverages = async (file, time) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'])
  const text = String(out)
  return { y: Number(text.match(/YAVG=([\d.]+)/)?.[1] ?? 0), u: Number(text.match(/UAVG=([\d.]+)/)?.[1] ?? 0), v: Number(text.match(/VAVG=([\d.]+)/)?.[1] ?? 0) }
}

const failures = []
const check = (label, actual, expected) => {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) <= 0.25 : actual === expected
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${ok ? '' : `\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`}`)
  if (!ok) failures.push(label)
}

/** Black through a limited-range encode reads a little above zero, so black is a threshold. */
const isBlack = (pixel) => pixel.every((channel) => channel <= 24)
const isPicture = (pixel) => pixel.some((channel) => channel > 60)

const main = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-up-tail-'))
  const preset = { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source' }

  // A two-second picture and a five-second track: the whole question is what the three seconds in the
  // gap are made of.
  const video = path.join(root, 'visual.mp4')
  const audio = path.join(root, 'track.wav')
  const still = path.join(root, 'cover.png')
  const seqDir = path.join(root, 'seq')
  fs.mkdirSync(seqDir, { recursive: true })
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=red:size=320x240:rate=25:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-c:a', 'pcm_s16le', audio])
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=red:size=320x240', '-frames:v', '1', still])
  for (let frame = 1; frame <= 3; frame += 1) {
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=red:size=320x240', '-frames:v', '1', path.join(seqDir, `frame_${String(frame).padStart(6, '0')}.png`)])
  }
  // Two seconds loud and three seconds silent, so WHICH stretch of the source a drawing is of can be read
  // off the picture: a drawing of the loud half is a tall line and a drawing of the silent half is nothing
  // at all. This is what makes "the drawn audio follows the trim" a measurement rather than a claim.
  const loudHalf = path.join(root, 'loud.wav')
  const quietHalf = path.join(root, 'quiet.wav')
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', loudHalf])
  await runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '3', '-c:a', 'pcm_s16le', quietHalf])
  const halfway = path.join(root, 'halfway.wav')
  await runFfmpeg(['-i', loudHalf, '-i', quietHalf, '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]', '-map', '[out]', '-c:a', 'pcm_s16le', halfway])
  // An image of a colour nothing else in these fixtures uses, for a drawing to be laid over.
  const artwork = path.join(root, 'artwork.png')
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x204060:s=320x180', '-frames:v', '1', artwork])

  const engine = new FFmpegEngine()
  const encode = (task) => new Promise((resolve, reject) => engine.runTask(task, () => {}, resolve, reject))

  const cases = [
    {
      name: 'a clip shorter than its track',
      task: {
        id: 'tail-clip', type: 'multitrack', status: 'pending', progress: 0,
        sourcePaths: [video],
        additionalAudioTracks: [{ id: 't1', path: audio, language: 'und' }],
        outputDirectory: root, outputFilename: 'clip-out.mp4', preset,
      },
      output: path.join(root, 'clip-out.mp4'),
      expectedSeconds: 5,
      pictureSeconds: 1,
      tailSeconds: 4,
    },
    {
      name: 'an image sequence shorter than its track',
      task: {
        id: 'tail-seq', type: 'multitrack', status: 'pending', progress: 0,
        sourcePaths: [path.join(seqDir, 'frame_000001.png')],
        sequenceInputs: {
          [path.join(seqDir, 'frame_000001.png')]: {
            dir: seqDir, pattern: 'frame_%06d.png', globPattern: 'frame_*.png', startNumber: 1,
            frameCount: 3, hasGaps: false, missing: [], fps: 25, width: 320, height: 240,
            firstFrame: path.join(seqDir, 'frame_000001.png'),
          },
        },
        additionalAudioTracks: [{ id: 't1', path: audio, language: 'und' }],
        outputDirectory: root, outputFilename: 'seq-out.mp4', preset,
      },
      output: path.join(root, 'seq-out.mp4'),
      expectedSeconds: 5,
      // The sequence itself is three frames at 25fps, which is over almost before it starts.
      pictureSeconds: 0.04,
      tailSeconds: 4,
    },
    {
      // The case the fix must NOT swallow. A lone still has no length of its own to run out of, so it
      // plays under its track for as long as the track runs: there is no tail to pad, and the export is
      // the cover for the whole of it. Rectangles of black here would be the same mistake the other way.
      //
      // Its track's language is not `und`, deliberately: the mp4 muxer writes `und` for a stream nothing
      // was said about, so a track that asked to be `eng` and came out `und` is the only way to see that
      // the tag was written against a stream that does not exist.
      name: 'a still cover under a longer track',
      task: {
        id: 'tail-still', type: 'multitrack', status: 'pending', progress: 0,
        sourcePaths: [still],
        additionalAudioTracks: [{ id: 't1', path: audio, language: 'eng' }],
        outputDirectory: root, outputFilename: 'still-out.mp4', preset,
      },
      output: path.join(root, 'still-out.mp4'),
      expectedSeconds: 5,
      pictureSeconds: 1,
      tailSeconds: 4,
      cover: true,
    },
    {
      // Item 9's other half: a MUTED track is not in the export at all, so it does not lengthen it
      // either. Padding in black for a track nobody will hear would be lengthening the output with
      // silence, which is not what a mute means.
      name: 'a muted track that is longer',
      task: {
        id: 'tail-muted', type: 'multitrack', status: 'pending', progress: 0,
        sourcePaths: [video],
        additionalAudioTracks: [{ id: 't1', path: audio, language: 'und' }],
        mutedLanes: { t1: true },
        outputDirectory: root, outputFilename: 'muted-out.mp4', preset,
      },
      output: path.join(root, 'muted-out.mp4'),
      // The visual is two seconds; the track is five and is not carried.
      expectedSeconds: 2,
      pictureSeconds: 1,
      muted: true,
    },
    {
      // A sound file with a preset that asks for video. It has no picture to give, so the export must
      // supply one — otherwise the container holds an audio stream and no video stream at all, which is a
      // video file in name only.
      name: 'a sound file exported as video',
      task: {
        id: 'tail-sound', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [audio],
        outputDirectory: root, outputFilename: 'sound-out.mp4', preset,
      },
      output: path.join(root, 'sound-out.mp4'),
      expectedSeconds: 5,
      soundOnly: true,
    },
    {
      // The same question asked of a STITCH: sound files joined, under a preset that asks for video.
      // The joined picture is black for the whole of the joined sound, and it is ONE input rather
      // than one per clip, because a picture that never changes has nothing per clip to differ about.
      name: 'a stitch of sound files exported as video',
      task: {
        id: 'tail-sound-stitch', type: 'stitch', status: 'pending', progress: 0,
        sourcePaths: [audio, audio],
        outputDirectory: root, outputFilename: 'sound-stitch.mp4', preset,
      },
      output: path.join(root, 'sound-stitch.mp4'),
      expectedSeconds: 10,
      soundOnly: true,
    },
    {
      // The same stitch asked for a DRAWING instead. What is drawn is the CONCATENATED stream the export
      // carries — the sources one after another, not a sum of them — so the waveform shows the join the
      // way the sound plays it. It is still one split: one half of the joined sound is drawn, the other
      // is muxed, which is what keeps the picture and the sound from ever disagreeing.
      name: 'a stitch of sound files drawn as a waveform',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform', fps: 30 },
      task: {
        id: 'viz-sound-stitch', type: 'stitch', status: 'pending', progress: 0,
        sourcePaths: [audio, audio],
        outputDirectory: root, outputFilename: 'viz-sound-stitch.mp4', preset,
      },
      output: path.join(root, 'viz-sound-stitch.mp4'),
      expectedSeconds: 10,
      drawn: true,
    },
    {
      // A video codec named with a container that cannot hold a picture, which is the gate this pass is
      // built on. The CONTAINER decides and not the preset: an h264 stream asked for into a WAV is an
      // encode that fails outright, so the export has to come out sound-only whatever codec was named.
      name: 'a sound file asked for video by a wav',
      preset: { ...preset, container: 'wav', audioCodec: 'pcm' },
      task: {
        id: 'tail-wav', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [audio],
        outputDirectory: root, outputFilename: 'sound-wav.wav', preset,
      },
      output: path.join(root, 'sound-wav.wav'),
      expectedSeconds: 5,
      noPicture: true,
    },
    {
      // A sound file EXPORTED AS A PICTURE, drawn from the very mix the file carries: the waveform and
      // the audio are two halves of one stream, which is what the split in the graph is for.
      //
      // The look is the whole point of this case. A waveform used to be drawn instant by instant, so the
      // export was a window scrolling through the sound while the editor showed one picture of the whole of
      // it — two different drawings of one job. It is now the picture, held for the length of the export.
      name: 'a sound file exported as a picture of its waveform',
      // The progress line is turned OFF here on purpose: this case is about the DRAWING being one held picture,
      // and a bar that moves is a different thing being measured. The line has its own case below.
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform', fps: 30, visualizationProgressLine: false },
      task: {
        id: 'viz-wave', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [audio],
        outputDirectory: root, outputFilename: 'viz-wave.mp4', preset,
      },
      output: path.join(root, 'viz-wave.mp4'),
      expectedSeconds: 5,
      drawn: true,
      pictureTemplate: true,
      drawnColour: 'green',
    },
    {
      // The same drawing in a colour that is not the app's own. This is the case that catches a colour going
      // missing between the editor and the encoder: the green reads neutral in the chroma planes, so a filter
      // that invented one would pass for it, and a red one cannot be mistaken for either.
      name: 'a waveform drawn in red',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform', fps: 30, visualizationColor: '#ff0000', visualizationProgressLine: false },
      task: {
        id: 'viz-red', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [audio],
        outputDirectory: root, outputFilename: 'viz-red.mp4', preset,
      },
      output: path.join(root, 'viz-red.mp4'),
      expectedSeconds: 5,
      drawn: true,
      pictureTemplate: true,
      drawnColour: 'red',
    },
    {
      // A still standing in for a sound, drawn over by the mix of the track it plays under — the still
      // is what the drawing sits ON, so the background is a picture input rather than a colour.
      name: 'a still cover drawn over by its track',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform', visualizationOnStill: true, fps: 30 },
      task: {
        id: 'viz-cover', type: 'multitrack', status: 'pending', progress: 0,
        sourcePaths: [still],
        additionalAudioTracks: [{ id: 't1', path: audio, language: 'eng' }],
        outputDirectory: root, outputFilename: 'viz-cover.mp4', preset,
      },
      output: path.join(root, 'viz-cover.mp4'),
      expectedSeconds: 5,
      drawn: true,
    },
    {
      // The spectrum's own fault, and it was never about the trim: `showspectrum` left on its default slide
      // draws one column per emitted frame into a frame that is never filled, so the right-hand side stays
      // BLACK for the whole export. What is asserted is the thing a listener would notice — at the end of
      // the sound the drawing is still reaching the right-hand edge.
      name: 'a sound file exported as a spectrum that fills its frame',
      // The line is off for the same reason as the waveform's: its own case must not be able to pass on the
      // brightness of a bar that happens to be over the edge it is asking about.
      preset: { ...preset, audioPicture: 'visualization', visualization: 'spectrum', fps: 30, visualizationProgressLine: false },
      task: {
        id: 'viz-spectrum-fill', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [audio],
        outputDirectory: root, outputFilename: 'viz-spectrum-fill.mp4', preset,
      },
      output: path.join(root, 'viz-spectrum-fill.mp4'),
      expectedSeconds: 5,
      drawn: true,
      fillsTheFrame: true,
    },
    {
      // THE SAME SPECTRUM WITH THE PROGRESS LINE ON, and the guard against it silently going missing again.
      // It was reported as not drawing; it WAS drawing, and the reason it could not be seen is that a bare
      // amber line all but vanishes over a drawing that fills its frame with colour. The line is cased now.
      //
      // The check is an A/B against the export directly above — identical but for the line — because "black
      // elsewhere" cannot be said of a spectrum: the drawing is colour right across the frame. Blended by
      // difference, a column the line is over reads high and one it is not over reads nothing, at two
      // timestamps, which is both that the line is there and that it MOVES.
      name: 'a spectrum with a progress line over it',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'spectrum', fps: 30, visualizationProgressLine: true },
      task: {
        id: 'viz-spec-sweep', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [audio],
        outputDirectory: root, outputFilename: 'viz-spec-sweep.mp4', preset,
      },
      output: path.join(root, 'viz-spec-sweep.mp4'),
      expectedSeconds: 5,
      drawn: true,
      sweepsAgainst: path.join(root, 'viz-spectrum-fill.mp4'),
    },
    {
      // Whether the DRAWN audio follows the trim, which was reported as not happening. This sound is loud
      // for two seconds and silent for three, and the trim keeps the SILENT three: a drawing of that
      // segment is a frame with nothing in it at all. A drawing of the whole source would be a tall line
      // over its first two seconds, and the untrimmed case below is the same job without the trim, so the
      // pair proves the measurement discriminates rather than asserting a grey frame means anything.
      name: 'a trimmed sound drawn to its own segment',
      // No line: a silent drawing is the thing being measured, and a full-height bright bar would fill the
      // frame's contrast whether the drawing was empty or not.
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform', fps: 30, visualizationProgressLine: false },
      task: {
        id: 'viz-trim', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [halfway],
        trimPoints: { [halfway]: { in: 2, out: 5 } },
        outputDirectory: root, outputFilename: 'viz-trim.mp4', preset,
      },
      output: path.join(root, 'viz-trim.mp4'),
      expectedSeconds: 3,
      drawn: true,
      drawnIsSilent: true,
    },
    {
      // THE PROGRESS LINE, and the case for it is a measurement rather than a claim. The fixture is a sound
      // that is LOUD for its first two seconds and SILENT for the last three, so the right-hand stretch of the
      // drawing is black — which makes the bar the only thing there that can be bright. Where the bar stands is
      // therefore readable off the picture, and asking twice says whether it moved.
      name: 'a waveform with a progress line that sweeps it',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform', fps: 30, visualizationProgressLine: true },
      task: {
        id: 'viz-sweep', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [halfway],
        outputDirectory: root, outputFilename: 'viz-sweep.mp4', preset,
      },
      output: path.join(root, 'viz-sweep.mp4'),
      expectedSeconds: 5,
      drawn: true,
      sweeps: true,
    },
    {
      name: 'the same sound drawn without its trim',
      // No line, so the pair with the trimmed case above differs in the TRIM alone and the comparison is
      // between two drawings of the same kind.
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform', fps: 30, visualizationProgressLine: false },
      task: {
        id: 'viz-untrimmed', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [halfway],
        outputDirectory: root, outputFilename: 'viz-untrimmed.mp4', preset,
      },
      output: path.join(root, 'viz-untrimmed.mp4'),
      expectedSeconds: 5,
      drawn: true,
      drawnIsAudible: true,
    },
    {
      // A drawing over an image the user chose. Two things are being asked: that the picture LASTS — one
      // still is one frame, and an overlay of a drawing over a single frame ends with that frame, so an
      // image input that is not looped gives a video one frame long — and that the image is what is under
      // the drawing rather than the black a colour background would leave.
      name: 'a sound drawn over an uploaded image',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform', fps: 30, visualizationBackground: 'image', visualizationBackgroundImage: artwork },
      task: {
        id: 'viz-image', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [audio],
        outputDirectory: root, outputFilename: 'viz-image.mp4', preset,
      },
      output: path.join(root, 'viz-image.mp4'),
      expectedSeconds: 5,
      drawn: true,
      overImage: true,
    },
    {
      // A still going into a container that can hold artwork, as the ARTWORK rather than as a video
      // stream — which is the one way a picture belongs in an MP3.
      name: 'a still attached to an mp3',
      preset: { ...preset, container: 'mp3', audioCodec: 'mp3', videoCodec: 'copy' },
      task: {
        id: 'art-mp3', type: 'multitrack', status: 'pending', progress: 0,
        sourcePaths: [still],
        additionalAudioTracks: [{ id: 't1', path: audio, language: 'eng' }],
        outputDirectory: root, outputFilename: 'art.mp3', preset,
      },
      output: path.join(root, 'art.mp3'),
      expectedSeconds: 5,
      coverArt: true,
    },
    {
      // And the same job in a container that cannot: the still is dropped rather than smuggled in, and
      // the export is the sound alone.
      name: 'a still dropped by a wav',
      preset: { ...preset, container: 'wav', audioCodec: 'pcm' },
      task: {
        id: 'art-wav', type: 'multitrack', status: 'pending', progress: 0,
        sourcePaths: [still],
        additionalAudioTracks: [{ id: 't1', path: audio, language: 'eng' }],
        outputDirectory: root, outputFilename: 'art.wav', preset,
      },
      output: path.join(root, 'art.wav'),
      expectedSeconds: 5,
      noPicture: true,
    },
  ]

  for (const item of cases) {
    console.log(`\n== ${item.name} ==`)
    try {
      await encode({ ...item.task, preset: item.preset ?? preset })
    } catch (error) {
      console.log(`  FAIL the encode failed: ${String(error.message).split('\n')[0]}`)
      failures.push(item.name)
      continue
    }
    const seconds = Number(await probeValue(item.output, 'format=duration'))
    check(item.muted ? 'a muted track does not lengthen the output' : 'the output runs to the length of its sound', seconds, item.expectedSeconds)
    if (item.soundOnly) {
      // The picture a sound file cannot supply has to be there, and it has to be BLACK: a video stream of
      // the right length that is a held frame or a colour would be a picture nothing asked for.
      const kinds = String(await probeValue(item.output, 'stream=codec_type')).split('\n').map((line) => line.trim()).filter(Boolean)
      check('a sound file exported as video carries a picture', kinds.includes('video'), true)
      check('and it carries the sound it came from', kinds.includes('audio'), true)
      if (kinds.includes('video')) check('and the picture it was given is black', isBlack(await pixelAt(item.output, 2)), true)
      continue
    }
    if (item.noPicture) {
      // A container that cannot hold a picture: the sound it came from, and no video stream at all.
      const carried = String(await probeValue(item.output, 'stream=codec_type')).split('\n').map((line) => line.trim()).filter(Boolean)
      check('a container that cannot hold a picture carries none', carried.includes('video'), false)
      check('and it carries the sound it was given', carried.includes('audio'), true)
      continue
    }
    if (item.drawn) {
      // A picture made from the sound. What matters is that there IS one, that the sound it was drawn
      // from is still there beside it, and that the frame is not blank: the black frame the same job
      // produces when it is given no picture reads 16, and a drawing reads well above that.
      const carried = String(await probeValue(item.output, 'stream=codec_type')).split('\n').map((line) => line.trim()).filter(Boolean)
      check('a drawn picture carries a picture', carried.includes('video'), true)
      check('and the sound it was drawn from', carried.includes('audio'), true)
      // A drawing of a SILENT segment draws nothing, deliberately — that is the case below — so the
      // "something is drawn" check is asked of every other drawing and not of that one.
      if (!item.drawnIsSilent) check('and something is drawn on the frame', (await brightestLuma(item.output, 1)) > 60, true)
      if (item.fillsTheFrame) {
        // The spectrum slides past the frame; left on its default it draws into the corner and the rest of
        // the width stays black for the whole export.
        check('and it reaches the right-hand edge of the frame', (await columnLuma(item.output, seconds - 0.2, 0.95)) > 60, true)
      }
      if (item.overImage) {
        // The image first, because a picture one frame long is the failure the loop prevents, and then the
        // image's own colour under the drawing, because an unlooped image would leave the frame black.
        check('the picture lasts as long as the sound it is drawn from', (await frameCount(item.output)) > 60, true)
        check('and the image it was given is what the drawing sits on', isPicture(await pixelAt(item.output, 2)), true)
      }
      if (item.drawnIsSilent) {
        // The trimmed segment is silence, and a drawing of silence is nothing at all. A drawing of the
        // whole source would be the loud half's line, which is the untrimmed case beside this one.
        check('a drawing of a silent segment has nothing in it', (await contrast(item.output, 0.5)) < 20, true)
      }
      if (item.drawnIsAudible) {
        check('and the same sound untrimmed is drawn as a line, so the check above can tell them apart', (await contrast(item.output, 0.5)) > 60, true)
      }
      if (item.sweepsAgainst) {
        // The line's column at one time, and the column it will have left by the other. Both are in the BLACK
        // of the silent half of the fixture, so the pair says the line moved rather than that it was there.
        const atThree = await columnDelta(item.output, item.sweepsAgainst, 3.0, 0.60)
        const cleanAtThree = await columnDelta(item.output, item.sweepsAgainst, 3.0, 0.90)
        const atEnd = await columnDelta(item.output, item.sweepsAgainst, 4.6, 0.90)
        const cleanAtEnd = await columnDelta(item.output, item.sweepsAgainst, 4.6, 0.60)
        check(`the line is over the spectrum at 3s (${atThree}) and the picture is otherwise untouched (${cleanAtThree})`, atThree > 60 && cleanAtThree < 25, true)
        check(`and it has swept to the end by 4.6s (${atEnd}), where it was now clean (${cleanAtEnd})`, atEnd > 60 && cleanAtEnd < 25, true)
      }
      if (item.sweeps) {
        // The bar travels from the left edge at t=0 to the right edge at t=sound length. Three seconds into
        // this five-second sound it stands past the loud half, in the BLACK stretch; at four-and-a-half it is
        // near the end. Neither moment is bright where the other one is, which is what "it moves" means.
        const startsAt = await columnLuma(item.output, 3.0, 0.60)
        const thereAtStart = await columnLuma(item.output, 3.0, 0.90)
        const endsAt = await columnLuma(item.output, 4.6, 0.90)
        const thereAtEnd = await columnLuma(item.output, 4.6, 0.60)
        check(`the bar stands over the black stretch at 3s (${startsAt}) and further along at 4.6s (${endsAt})`, startsAt > 60 && endsAt > 60, true)
        check(`and it is nowhere near where it was, so the line really sweeps (${thereAtStart} and ${thereAtEnd})`, thereAtStart < 40 && thereAtEnd < 40, true)
      }
      // WHAT YOU SEE IS WHAT YOU GET, which is the whole of this case for a template that draws one picture:
      // the editor shows the whole sound as a still, so the export has to BE that still, held for the length
      // of the sound. A frame that moved between the start and the end would be the old scrolling drawing,
      // which is a different picture from the one the editor showed of the same job.
      if (item.pictureTemplate) {
        const early = await frameAverages(item.output, 0.3)
        const late = await frameAverages(item.output, Math.max(0.4, seconds - 0.3))
        const same = Math.abs(early.y - late.y) < 0.5 && Math.abs(early.u - late.u) < 0.5 && Math.abs(early.v - late.v) < 0.5
        check(`a picture drawing is the same picture throughout (${JSON.stringify(early)} then ${JSON.stringify(late)})`, same, true)
      }
      // And the colour that was asked for is the colour that is written. The app's own green reads nearly
      // neutral in the chroma planes, so a filter that invented a colour could pass for it — which is exactly
      // how a purple line went unnoticed — so "neutral" is the whole of the green's assertion, and a red one
      // is asked for separately because it cannot be mistaken for either.
      if (item.drawnColour) {
        const drawn = await drawnColour(item.output, 1, item.preset?.visualization)
        if (item.drawnColour === 'green') check(`and it is drawn in the green it was given, not one ffmpeg invented (U ${drawn.u} V ${drawn.v})`, Math.abs(drawn.u - 128) <= 20 && Math.abs(drawn.v - 128) <= 20, true)
        if (item.drawnColour === 'red') check(`and a red drawing is red (U ${drawn.u} V ${drawn.v})`, drawn.v - drawn.u > 40, true)
      }
      continue
    }
    if (item.coverArt) {
      // Artwork, which is a video stream in name only: a still stored as the file's picture rather than
      // played as a frame. The sound is the export, and the picture is the file's face.
      const carried = String(await probeValue(item.output, 'stream=codec_type')).split('\n').map((line) => line.trim()).filter(Boolean)
      check('an artwork-capable container keeps the sound', carried.includes('audio'), true)
      check('and holds the still as its artwork', await attachedPicture(item.output), '1')
      continue
    }
    if (item.cover) {
      // The language the track asked for has to be ON the one audio stream the job has, which is the
      // index the tags are written against: the visual here is a still, so it brings no audio of its
      // own and the first added track is the output's first audio stream.
      check('and the track\u2019s own language reaches the stream it is', await audioLanguage(item.output), 'eng')
    }
    if (item.muted) continue
    const tail = await pixelAt(item.output, item.tailSeconds)
    if (item.cover) check('and a still cover is still showing under its track', isPicture(tail), true)
    else check('and the picture past its end is black', isBlack(tail), true)
  }

  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
  console.log(failures.length ? `\n${failures.length} TAIL PROBLEM(S)\n` : '\nTHE OUTPUT RUNS TO ITS SOUND, IN BLACK\n')
  process.exit(failures.length ? 1 : 0)
}

void main().catch((error) => { console.error('HARNESS FAILED', error); process.exit(1) })
