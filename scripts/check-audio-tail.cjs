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
const { probeFile } = require('./.probe.cjs')
const { blankSource, silenceSource } = require('./.placeholder.cjs')
const viz = require('./.visualization.cjs')

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
 /** The language tag on the file's first AUDIO stream.
 *
 * Asked of the audio streams by name rather than read off the front of the list: the mp4 muxer writes
 * `und` on the video stream of a file nothing was said about, so the first tag in the file belongs to
 * the picture and says nothing at all about the track under test.
 */
const audioLanguage = async (file) => String(await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream_tags=language', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim()

/** How many channels the file's AUDIO stream has, which is the one thing an output-layout choice changes. */
const audioChannels = async (file) => Number(await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=channels', '-of', 'default=noprint_wrappers=1:nokey=1', file]))

/** One pixel of the frame at a time, as three numbers: what the picture there actually is. */
const pixelAt = async (file, time) => {
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'crop=2:2:10:10,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
  return [raw[0], raw[1], raw[2]]
}

/** One pixel of the frame at a time, as three numbers — at a point of the caller's choosing.
 *
 * A LETTERBOXED picture is the reason this exists beside `pixelAt`: the middle of the frame is the image and
 * the sides are the padding, so where the sample is taken is the whole of what it says.
 */
const pixelAtPoint = async (file, time, x, y) => {
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-'], { encoding: 'buffer' })
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

/** How bright a narrow strip of a frame is, at an x in PIXELS. Narrow enough to sit inside a gap. */
const stripLuma = async (file, time, x, width = 8) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `crop=${width}:ih:${x}:0,signalstats,metadata=print:file=-`, '-f', 'null', '-'])
  return Math.round(Number(String(out).match(/YMAX=([\d.]+)/)?.[1] ?? 0))
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
 * The loudness of a stretch of a file's sound, as a root mean square of its samples.
 *
 * A fade is a question about LEVEL over time, so it cannot be read off the picture or off a probe's summary:
 * the file is decoded to raw samples and the stretch is measured. One channel at 8kHz, because what is asked
 * is whether this stretch is quieter than that one, and neither the layout nor the rate is the subject.
 */
const rmsAt = async (file, start, duration) => {
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-ss', String(start), '-t', String(duration), '-f', 's16le', '-ac', '1', '-ar', '8000', '-'], { encoding: 'buffer' })
  const count = Math.floor(raw.length / 2)
  let sum = 0
  for (let index = 0; index < count; index += 1) { const value = raw.readInt16LE(index * 2) / 32768; sum += value * value }
  return Math.sqrt(sum / Math.max(1, count))
}

/** The same reading of ONE named audio stream, for a file whose streams are not all the same sound. */
const rmsStream = async (file, stream, start, duration) => {
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', `0:a:${stream}`, '-ss', String(start), '-t', String(duration), '-f', 's16le', '-ac', '1', '-ar', '8000', '-'], { encoding: 'buffer' })
  const count = Math.floor(raw.length / 2)
  let sum = 0
  for (let index = 0; index < count; index += 1) { const value = raw.readInt16LE(index * 2) / 32768; sum += value * value }
  return Math.sqrt(sum / Math.max(1, count))
}

/**
 * The largest single SAMPLE of a decode, read as FLOAT so a peak ABOVE full scale shows.
 *
 * `volumedetect` reports any over-scale peak at 0 dB, because it clamps its own reading — useful for a file and
 * useless for asking whether a chain caught a peak that was over the line. The raw float samples do not clamp,
 * so this is what tells a caught peak from a raw one.
 */
const peakAt = async (args) => {
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, '-f', 'f32le', '-ac', '1', '-'], { encoding: 'buffer' })
  let peak = 0
  const count = Math.floor(raw.length / 4)
  for (let index = 0; index < count; index += 1) { const value = Math.abs(raw.readFloatLE(index * 4)); if (value > peak) peak = value }
  return peak
}

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

/** What the whole frame averages to, as three channels.
 *
 * The frame's own colour, which is how the THEME's colour is asked about: a drawing in the app's green averages
 * green — measured, 128,154,124 — and one drawn in the filter's own fallback averages pure white, 207,207,207,
 * which no amount of reading luma could tell apart. */
const frameColour = async (file, time) => {
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
  return [raw[0], raw[1], raw[2]]
}

/** How different two exports are, over the whole frame, at one moment.
 *
 * For the pair of questions a drawing option raises that the frame's own geometry cannot answer: a scrolling
 * waveform's ink reaches its row's edge only where the sound PEAKS, so the top band of one of those is a
 * question about the fixture's loudest moment rather than about how many rows it drew. What can be asked of it
 * is that the two options draw different pictures at all.
 */
const frameDifference = async (file, reference, time) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-ss', String(time), '-i', reference, '-frames:v', '1', '-filter_complex', '[0:v][1:v]blend=all_mode=difference,signalstats,metadata=print:file=-', '-f', 'null', '-'])
  return Math.round(Number(String(out).match(/YMAX=([\d.]+)/)?.[1] ?? 0))
}

/** The brightest luma in a horizontal band of the frame, given as fractions of its height.
 *
 * Which is how the NUMBER of waveforms is read off a drawing rather than claimed: a waveform filter fills a row
 * per channel, so one waveform is a single row about the middle — the top of the frame black — and two put a
 * channel in each half, so the top is inked and, for a still picture, the very centre is the gap between them.
 */
const bandLuma = async (file, time, from, to) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `crop=iw:ih*${(to - from).toFixed(4)}:0:ih*${from.toFixed(4)},signalstats,metadata=print:file=-`, '-f', 'null', '-'])
  return Math.round(Number(String(out).match(/YMAX=([\d.]+)/)?.[1] ?? 0))
}

/** What the whole frame averages to, which is how two moments are asked whether they are the same picture. */
const frameAverages = async (file, time) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'])
  const text = String(out)
  return { y: Number(text.match(/YAVG=([\d.]+)/)?.[1] ?? 0), u: Number(text.match(/UAVG=([\d.]+)/)?.[1] ?? 0), v: Number(text.match(/VAVG=([\d.]+)/)?.[1] ?? 0) }
}

/**
 * The brightest luma in a still.
 *
 * A still is ONE frame and there is nothing to seek to, and an input seek over one finds it less reliably
 * than not seeking at all — measured: `-ss 0` before the input of a single-frame JPEG finds no frame and the
 * probe reads black, which is how a still that was perfectly drawn went on being reported as blank.
 */
const brightestStill = async (file) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'])
  return Math.round(Number(String(out).match(/YMAX=([\d.]+)/)?.[1] ?? 0))
}

/**
 * How far a frame is from being its own mirror about the horizontal centre line.
 *
 * The MIRRORED BARS drawing is `vstack(vflip(bars), bars)`, which is exactly symmetric, so blended against its
 * own vflip it reads nearly nothing — while the plain bars, which grow from one edge of the frame, read high.
 * The pair is what makes this a test of the MIRROR rather than of a drawing that happens to be even: measured
 * on broadband noise, the mirrored frame reads 56 and the plain one 228.
 */
const mirrorDelta = async (file, time) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-filter_complex', '[0:v]split[a][b];[b]vflip[c];[a][c]blend=all_mode=difference,signalstats,metadata=print:file=-', '-f', 'null', '-'])
  return Math.round(Number(String(out).match(/YMAX=([\d.]+)/)?.[1] ?? 0))
}

/** How bright a narrow band of ROWS is, at a y in PIXELS — the horizontal counterpart of `stripLuma`, which
 *  is how a divider drawn across the bars is read: the row a line is on is dark, the row between two is not.
 *
 * The format is set first because a row one pixel tall cannot be cropped out of a chroma-subsampled frame:
 * measured, `crop=iw:1` on a yuv420p input is refused outright — the chroma plane has no half-row to give it
 * and the filter reports a height of zero — while the same crop on the same frame as rgb24 is fine. */
const rowStripLuma = async (file, time, y, height = 1) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `format=rgb24,crop=iw:${height}:0:${y},signalstats,metadata=print:file=-`, '-f', 'null', '-'])
  return Math.round(Number(String(out).match(/YMAX=([\d.]+)/)?.[1] ?? 0))
}

/**
 * How many of a frame's column bands carry any ink at all — the width of what is drawn.
 *
 * This is how the polar scope is asked whether a MONO sound was opened into a ring: a scope plots one channel
 * against the other, so two identical channels draw a flat spoke and a quadrature pair draws a ring, and the
 * only difference visible from outside is how far across the frame the drawing reaches. Measured on a mono
 * source: one band of twenty with the quadrature off, eight with it on, and eleven for a genuinely stereo one.
 *
 * Twenty narrow probes rather than one averaged row, because the trace is a couple of pixels wide and any
 * averaging that would fit in one pass dilutes it to nothing — which is exactly the reading that made the
 * spoke look like an empty frame in the first place.
 */
const inkedBands = async (file, time, bands = 20) => {
  const width = 1 / bands
  const probes = await Promise.all(Array.from({ length: bands }, (_, index) =>
    columnLuma(file, time, (index * width).toFixed(4)).catch(() => 0)))
  return probes.filter((luma) => luma > 60).length
}

/**
 * The brightest pixel of a MASK laid over the frame, as the luma of the mask.
 *
 * `expression` is a `geq` over the RGB frame, drawn into the red channel, so the mask reads a luma well above
 * the yuv black floor (16) where it fires and the floor itself where it never does — which makes "is there any
 * such pixel at all" one number. A question about what colour the drawing IS rather than how much of the frame
 * it covers, which is what these are for: a trace is a few pixels wide and a mean would bury it in the black.
 */
const maskBrightest = async (file, time, expression) => {
  const out = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `format=rgb24,geq=r='${expression}':g=0:b=0,signalstats,metadata=print:file=-`, '-f', 'null', '-'])
  return Math.round(Number(String(out).match(/YMAX=([\d.]+)/)?.[1] ?? 0))
}

/** Green leading both other channels: what the theme's own trace is, and what a neutral one is not. */
const greenBrightest = (file, time) => maskBrightest(file, time, 'gt(g(X,Y),r(X,Y)+2)*gt(g(X,Y),b(X,Y)+2)*255')
/** Blue and red both leading green: the stray purple, which a green trace cannot produce anywhere. */
const magentaBrightest = (file, time) => maskBrightest(file, time, 'gt(r(X,Y),g(X,Y)+6)*gt(b(X,Y),g(X,Y)+6)*255')
/** All three channels bright at once: white, which a trace tinted to a colour never is. */
const whiteBrightest = (file, time) => maskBrightest(file, time, 'gt(r(X,Y),200)*gt(g(X,Y),200)*gt(b(X,Y),200)*255')

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
  // And a SQUARE one of the same colour, for the picture a sound-only job can be given: a shape that cannot
  // fill a 16:9 frame is the only way the letterboxing is visible in the finished file.
  const squareArt = path.join(root, 'square.png')
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x204060:s=400x400', '-frames:v', '1', squareArt])

  // A broadband sound, so a spectrum has something in every band: a tone lights one bar and leaves the rest
  // black, which would make "the bar under this column is drawn" a question about the fixture's frequency.
  const broadband = path.join(root, 'broadband.wav')
  await runFfmpeg(['-f', 'lavfi', '-i', 'anoisesrc=color=pink:sample_rate=48000:duration=5', '-c:a', 'pcm_s16le', broadband])

  // A GENUINELY stereo sound and a lossy one, for the two things the probe's own figures are asked about: a
  // PCM file carries its sample size and a lossy one has none to carry. The stereo pair is two DIFFERENT
  // noises joined rather than one upmixed — `-ac 2` duplicates a single signal, and the drawing tests below
  // turn on the two channels being different. Noise rather than tones because a pure tone lights one bar of a
  // spectrum and draws one thin line, which is a fixture that cannot tell a colour from a blank frame.
  const stereo16 = path.join(root, 'stereo16.wav')
  await runFfmpeg(['-f', 'lavfi', '-i', 'anoisesrc=color=pink:sample_rate=48000:duration=5:seed=42', '-f', 'lavfi', '-i', 'anoisesrc=color=white:sample_rate=48000:duration=5:seed=7', '-filter_complex', '[0:a][1:a]join=inputs=2:channel_layout=stereo', '-c:a', 'pcm_s16le', stereo16])
  // And a stereo pair of TONES is deliberately NOT used for those tests: measured, `showwavespic` with
  // `split_channels` on a pair of low tones draws an empty frame, so a fixture like that cannot say how many
  // rows there are. Noise fills every row to the frame's edge, which is what the tests below read.
  const lossy = path.join(root, 'lossy.mp3')
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-c:a', 'libmp3lame', '-b:a', '320k', lossy])

  // WHAT THE EDITOR IS SHOWN. The monitor's still is built by the same module as the export's picture, and
  // the one thing that can go wrong with it is the MOMENT it is photographed: a drawing that moves has an
  // EMPTY canvas at t=0 — its content arrives as it scrolls or fills — so a still asked for at the start is
  // black. That was reported twice as the monitor being broken when it was the SAMPLE that was wrong, so a
  // blank frame fails here rather than shipping again.
  console.log('\n== what the editor is shown of each drawing ==')
  // The warm-up is an OUTPUT seek, exactly as `main.ts` writes it. An INPUT seek shifts the audio while the
  // drawing's own frames keep their position, so the overlay's first frame has nothing to composite and the
  // still comes out black — which is the same symptom from a different cause.
  const stillGraph = (template, seconds) => viz.visualizationStillGraph({
    // The template is named to the resolvers as well as to the graph, so the still is drawn with the same
    // defaults the export would use — the LED templates' own hold, blocks and bar count included.
    template, width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000',
    tune: viz.drawingTuneOf({ visualization: template }),
    eq: viz.eqStyleOf({ visualization: template }),
  }).replace('$SECONDS', String(seconds))
  for (const template of viz.VISUALIZATIONS.map((entry) => entry.id)) {
    const canvas = viz.drawingCanvas(1920, 1080, viz.templateMaxEdge(template))
    const warmup = viz.stillWarmupSeconds(template, 5, canvas.width, 30)
    const shot = path.join(root, `still-${template}.jpg`)
    try {
      await runFfmpeg(['-i', broadband, '-filter_complex', stillGraph(template, warmup), '-map', '[out]', '-ss', warmup.toFixed(3), '-frames:v', '1', '-q:v', '3', shot])
    } catch (error) {
      check(`a still of the ${template} drawing is drawn at all (${String(error.message).split('\n')[0]})`, false, true)
      continue
    }
    const lit = await brightestStill(shot)
    check(`a still of the ${template} drawing is inked (warm-up ${warmup}s, brightest ${lit})`, lit > 60, true)
    // And the guard itself: the scrolling waveform's first frame really is empty, which is why the warm-up
    // exists — so the case above is a measurement and not a coincidence.
    if (template === 'waveform-scroll') {
      const atStart = path.join(root, 'still-waveform-scroll-0.jpg')
      await runFfmpeg(['-i', broadband, '-filter_complex', stillGraph(template, 0), '-map', '[out]', '-ss', '0', '-frames:v', '1', '-q:v', '3', atStart])
      check('and its very first frame is empty, which is the whole reason for the warm-up', (await brightestStill(atStart)) < 40, true)
    }
  }

  // WHAT THE PROBE ANSWERS ABOUT A SOUND. The sample size in particular is asked for in two places, because
  // ffprobe fills in a different field for a PCM file than for a FLAC, and each is either a figure or an
  // absence — a lossy file has no sample size at all and the line that shows it leaves that part out rather
  // than claiming zero bits of one. Four places read these figures, so one arriving as `undefined` would be
  // missing from all four at once.
  console.log('\n== what the probe says a sound is ==')
  const sixteen = (await probeFile(stereo16)).audioStreams[0]
  check('a 16-bit wav reports its sample rate', sixteen.sampleRate, 48000)
  check('and its channels', sixteen.channels, 2)
  check('and its sample size, which the container carries', sixteen.bitDepth, 16)
  check('and its codec', sixteen.codec, 'pcm_s16le')
  const compressed = (await probeFile(lossy)).audioStreams[0]
  check('a lossy file reports its rate too', compressed.sampleRate, 48000)
  check('and its codec', compressed.codec, 'mp3')
  check('but no sample size, because it has none to report', compressed.bitDepth, undefined)

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
      // THE EQ'S OWN KNOBS, which `showfreqs` has no way to be told: its bars are one output column each, so
      // the count IS the width and the drawing is stretched to the frame. This job asks for EIGHT bars with a
      // twenty-four pixel gap, which makes both of them readable off the picture — a cell is 240 pixels wide
      // and its first 24 are blanked, so the same probe at the cell's lead and at its middle tells the gap
      // apart from the bar, and probing the NEXT cell's lead says how wide a cell is.
      name: 'a sound file drawn as eight EQ bars with a gap between them',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'eq', fps: 30, eqBars: 8, eqGap: 24 },
      task: {
        id: 'viz-eq-gap', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [broadband],
        outputDirectory: root, outputFilename: 'viz-eq-gap.mp4', preset,
      },
      output: path.join(root, 'viz-eq-gap.mp4'),
      expectedSeconds: 5,
      drawn: true,
      // The lead of the first cell and of the second, and the middle of the first bar between them.
      eqProbes: { gap: [4, 244], bar: 100 },
    },
    {
      // The same eight bars with NO gap, which is the control for the case above: the column the gap blanked
      // is drawn, so what the pair proves is that the gap is what blanked it and not the drawing being dark.
      name: 'the same bars with no gap',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'eq', fps: 30, eqBars: 8, eqGap: 0 },
      task: {
        id: 'viz-eq-solid', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [broadband],
        outputDirectory: root, outputFilename: 'viz-eq-solid.mp4', preset,
      },
      output: path.join(root, 'viz-eq-solid.mp4'),
      expectedSeconds: 5,
      drawn: true,
      eqSolid: { bar: 4 },
    },
    {
      // THE PEAK HOLD, and it is a measurement rather than a claim. The fixture is LOUD for two seconds and
      // SILENT for three, so a drawing that merely draws the sound is BLACK past the loud half while one that
      // holds its peaks still has the bar's ghost standing: measured, the top band reads 16 without the hold
      // and 151 with it, and the ghost then falls 151 to 99 to 44 across the silent stretch — which is the hold
      // decaying rather than a static image that never lets go.
      name: 'a loud-then-quiet sound drawn with a peak hold',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'led-eq', fps: 30, visualizationProgressLine: false },
      task: {
        id: 'viz-hold', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [halfway],
        outputDirectory: root, outputFilename: 'viz-hold.mp4', preset,
      },
      output: path.join(root, 'viz-hold.mp4'),
      expectedSeconds: 5,
      drawn: true,
      // Read just past the loud half, then again deep in the silence.
      holdsPeaks: { early: 2.1, late: 3.0 },
    },
    {
      // The control for the case above: the SAME sound, the same LED EQ, the hold turned OFF — so what the pair
      // proves is the hold and not the drawing happening to be bright at that moment.
      name: 'the same sound drawn with the hold turned off',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'led-eq', fps: 30, visualizationProgressLine: false, eqPeakHold: false },
      task: {
        id: 'viz-hold-off', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [halfway],
        outputDirectory: root, outputFilename: 'viz-hold-off.mp4', preset,
      },
      output: path.join(root, 'viz-hold-off.mp4'),
      expectedSeconds: 5,
      drawn: true,
      noHold: { at: 2.1 },
    },
    {
      // MATRIX PANEL's lit field, which is the whole difference between a panel and a bar chart, measured on a
      // SILENT sound — because that is the case where there is nothing to draw and the field is all there is. A
      // plain drawing of silence is black; the panel is its own colour at a share of itself, which is the point
      // of a panel of unlit cells. The pair of cases is what makes it a measurement.
      name: 'the same silence drawn as plain bars, for the panel to be measured against',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'eq', fps: 30, visualizationProgressLine: false },
      task: {
        id: 'viz-matrix-plain', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [quietHalf],
        outputDirectory: root, outputFilename: 'viz-matrix-plain.mp4', preset,
      },
      output: path.join(root, 'viz-matrix-plain.mp4'),
      expectedSeconds: 3,
      drawn: true,
    },
    {
      name: 'a silent sound drawn as a matrix panel',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'matrix-panel', fps: 30, visualizationProgressLine: false },
      task: {
        id: 'viz-matrix', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [quietHalf],
        outputDirectory: root, outputFilename: 'viz-matrix.mp4', preset,
      },
      output: path.join(root, 'viz-matrix.mp4'),
      expectedSeconds: 3,
      drawn: true,
      matrixField: { against: path.join(root, 'viz-matrix-plain.mp4') },
    },
    {
      // PEAK PILLS' wide block gap, read as three consecutive dark rows where the ordinary stack has one: the
      // dividers fall on multiples of eight, so with a three-pixel gap rows 896, 897 and 898 are dark and 899 —
      // the block below them — is drawn. Measured, the hairline's own drawing has row 897 drawn at 169, so the
      // three dark rows are the gap and not the drawing happening to be dark there.
      name: 'a sound file drawn as peak pills',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'peak-pills', fps: 30, visualizationProgressLine: false },
      task: {
        id: 'viz-pills', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [broadband],
        outputDirectory: root, outputFilename: 'viz-pills.mp4', preset,
      },
      output: path.join(root, 'viz-pills.mp4'),
      expectedSeconds: 5,
      drawn: true,
      segmentGap: { divider: 896, gap: 897, block: 899 },
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
    {
      // MIRRORED BARS. The drawing is two half-drawings stacked about the centre line, one the flip of the
      // other, so the frame is its own mirror — and that is a measurement rather than a claim: blended against
      // its own vflip the frame reads nearly nothing, while the plain bars beside it read high. The pair is
      // what makes this a test of the MIRROR and not of a drawing that happens to be even.
      name: 'a sound file drawn as mirrored bars',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'mirrored-bars', fps: 30 },
      task: {
        id: 'viz-mirror', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [broadband],
        outputDirectory: root, outputFilename: 'viz-mirror.mp4', preset,
      },
      output: path.join(root, 'viz-mirror.mp4'),
      expectedSeconds: 5,
      drawn: true,
      mirrored: true,
    },
    {
      // The control for the case above: the SAME sound, the same bars, without the mirror — so what the pair
      // proves is the mirror and not the drawing being dark.
      name: 'the same sound drawn as plain bars rather than mirrored',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'eq', fps: 30 },
      task: {
        id: 'viz-plain-bars', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [broadband],
        outputDirectory: root, outputFilename: 'viz-plain-bars.mp4', preset,
      },
      output: path.join(root, 'viz-plain-bars.mp4'),
      expectedSeconds: 5,
      drawn: true,
      plainBars: true,
    },
    {
      // RADIAL SCOPE on a MONO sound, which is the case the quadrature branch exists for. A scope plots one
      // channel against the other, and this fixture is a single channel the encoder duplicates — two IDENTICAL
      // channels, which draw a flat spoke rather than a ring, and a reader reported exactly that. Measured
      // with the branch on, eight column bands of twenty are inked; with it off, one.
      name: 'a mono sound drawn as a radial scope',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'scope', fps: 30 },
      task: {
        id: 'viz-scope', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [broadband],
        outputDirectory: root, outputFilename: 'viz-scope.mp4', preset,
      },
      output: path.join(root, 'viz-scope.mp4'),
      expectedSeconds: 5,
      drawn: true,
      scopeRing: true,
    },
    {
      // The EQ with SEGMENTED on, which is the LED-panel look: dividers across every bar, so each is a stack of
      // blocks. What is asserted is that the drawing still reaches the frame and that the last block is not cut
      // off — a grid aligned from an edge rather than to a height the frame divides into leaves the top block
      // half-drawn, which reads as a bright line along the top.
      name: 'a sound file drawn as segmented bars',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'eq', fps: 30, eqSegmented: true },
      task: {
        id: 'viz-segments', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [broadband],
        outputDirectory: root, outputFilename: 'viz-segments.mp4', preset,
      },
      output: path.join(root, 'viz-segments.mp4'),
      expectedSeconds: 5,
      drawn: true,
      segmented: true,
    },
    {
      // THE OUTPUT'S OWN CHANNEL COUNT, which is a CHOICE rather than a fact about the file: this is the same
      // stereo sound as the case above, asked to be written as ONE channel. The pair is what makes it a test of
      // the control rather than of the fixture — with nothing asked for the source's layout stands, which is
      // what every job saved before this control off the list still gets.
      name: 'a stereo sound exported as mono',
      preset: { ...preset, audioChannels: 1 },
      task: {
        id: 'chan-mono', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [stereo16],
        outputDirectory: root, outputFilename: 'chan-mono.mp4', preset,
      },
      output: path.join(root, 'chan-mono.mp4'),
      expectedSeconds: 5,
      soundOnly: true,
      channels: 1,
    },
    {
      // And the control for it: the same sound, nothing asked for, so the source's own two channels stand.
      name: 'the same stereo sound with no channel count asked for',
      preset: { ...preset },
      task: {
        id: 'chan-source', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [stereo16],
        outputDirectory: root, outputFilename: 'chan-source.mp4', preset,
      },
      output: path.join(root, 'chan-source.mp4'),
      expectedSeconds: 5,
      soundOnly: true,
      channels: 2,
    },
    {
      // THE BARS IN THE THEME'S COLOUR, on a sound with two channels — which is the case that had them drawn in
      // WHITE. `colors` is a list indexed by CHANNEL, so a list shorter than the sound leaves the channels it
      // does not cover in the filter's own default: measured, one entry with a stereo input averages
      // (207,207,207), and a list long enough for every channel averages the theme's own green (128,154,124).
      // The luma this drawing reads is no different either way, which is why it is the frame's COLOUR that is
      // asserted rather than its brightness.
      name: 'a stereo sound drawn as bars in the theme\u2019s own colour',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'eq', fps: 30, visualizationProgressLine: false },
      task: {
        id: 'viz-bars-theme', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [stereo16],
        outputDirectory: root, outputFilename: 'viz-bars-theme.mp4', preset,
      },
      output: path.join(root, 'viz-bars-theme.mp4'),
      expectedSeconds: 5,
      drawn: true,
      themeGreen: true,
    },
    {
      // ONE WAVEFORM, which is the default and what the report was about: a waveform filter fills a ROW per
      // channel, so a stereo sound has two of them however `split_channels` is set. ONE is a real downmix, and
      // this is the measurement that says so — the top of the frame is black and the middle is drawn.
      name: 'a stereo sound drawn as one waveform',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform', fps: 30, visualizationProgressLine: false },
      task: {
        id: 'viz-one-wave', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [stereo16],
        outputDirectory: root, outputFilename: 'viz-one-wave.mp4', preset,
      },
      output: path.join(root, 'viz-one-wave.mp4'),
      expectedSeconds: 5,
      drawn: true,
      waveRows: { kind: 'waveform', rows: 1 },
    },
    {
      // And the control: the same sound asked for TWO, which keeps its own pair and gives each a row — so the
      // pair proves the knob rather than the fixture.
      name: 'the same stereo sound drawn as two waveforms',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform', fps: 30, visualizationProgressLine: false, waveChannels: 2 },
      task: {
        id: 'viz-two-waves', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [stereo16],
        outputDirectory: root, outputFilename: 'viz-two-waves.mp4', preset,
      },
      output: path.join(root, 'viz-two-waves.mp4'),
      expectedSeconds: 5,
      drawn: true,
      waveRows: { kind: 'waveform', rows: 2 },
    },
    {
      // The SCROLLING waveform is the one the report named, and the same knob is read off it. Its rows fill
      // their halves rather than leaving a gap at the centre, so it is asked about the top of the frame alone.
      name: 'a stereo sound drawn as one scrolling waveform',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform-scroll', fps: 30 },
      task: {
        id: 'viz-one-scroll', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [stereo16],
        outputDirectory: root, outputFilename: 'viz-one-scroll.mp4', preset,
      },
      output: path.join(root, 'viz-one-scroll.mp4'),
      expectedSeconds: 5,
      drawn: true,
      // The difference below is asked of the SECOND of the pair, because a comparison needs both files and this
      // one is exported first — the pair is what says the knob changes the drawing at all.
    },
    {
      name: 'the same sound drawn as two scrolling waveforms',
      preset: { ...preset, audioPicture: 'visualization', visualization: 'waveform-scroll', fps: 30, waveChannels: 2 },
      task: {
        id: 'viz-two-scroll', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [stereo16],
        outputDirectory: root, outputFilename: 'viz-two-scroll.mp4', preset,
      },
      output: path.join(root, 'viz-two-scroll.mp4'),
      expectedSeconds: 5,
      drawn: true,
      // And the two scrolling options are asked that they DIFFER rather than how far their ink reaches: the row
      // GEOMETRY is read off the still picture above, which is the same knob, and a scrolling drawing's top band
      // answers a question about where the fixture happens to peak.
      waveDiffers: path.join(root, 'viz-one-scroll.mp4'),
    },
    {
      // A PICTURE THE JOB WAS GIVEN, for a sound with none of its own: the third answer its picture source can
      // be, beside the black frame and the drawing. It is held for the length of the sound and fitted with its
      // shape kept, so a square image in a 16:9 frame is letterboxed — which is what the two samples below read:
      // the middle of the frame is the image and the sides are the padding.
      name: 'a sound given a picture of its own',
      preset: { ...preset, audioPicture: 'custom', audioPictureImage: squareArt },
      task: {
        id: 'viz-custom-art', type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [audio],
        outputDirectory: root, outputFilename: 'viz-custom-art.mp4', preset,
      },
      output: path.join(root, 'viz-custom-art.mp4'),
      expectedSeconds: 5,
      picturedImage: true,
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
      if (item.channels) check(`and its sound is written as ${item.channels} channel(s)`, await audioChannels(item.output), item.channels)
      continue
    }
    if (item.noPicture) {
      // A container that cannot hold a picture: the sound it came from, and no video stream at all.
      const carried = String(await probeValue(item.output, 'stream=codec_type')).split('\n').map((line) => line.trim()).filter(Boolean)
      check('a container that cannot hold a picture carries none', carried.includes('video'), false)
      check('and it carries the sound it was given', carried.includes('audio'), true)
      continue
    }
    if (item.picturedImage) {
      // A picture the job was GIVEN. What is asked is the three things the branch can get wrong: that there IS a
      // picture and that the sound is still there beside it; that it LASTS (an image input that is not looped
      // gives a video one frame long); and that it is letterboxed rather than stretched — the image's own colour
      // in the middle of the frame and the black it was padded with at the sides.
      const carried = String(await probeValue(item.output, 'stream=codec_type')).split('\n').map((line) => line.trim()).filter(Boolean)
      check('a job given an image carries a picture', carried.includes('video'), true)
      check('and the sound it was given it for', carried.includes('audio'), true)
      check('and the picture lasts as long as the sound', (await frameCount(item.output)) > 60, true)
      check('the image is what the frame shows', isPicture(await pixelAtPoint(item.output, 2, 960, 540)), true)
      check('and it is letterboxed rather than stretched, so the sides are black', isBlack(await pixelAtPoint(item.output, 2, 20, 540)), true)
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
      if (item.themeGreen) {
        const [red, green, blue] = await frameColour(item.output, 1)
        check(`the bars are drawn in the theme\u2019s green (frame rgb ${red},${green},${blue})`, green - red >= 12 && green - blue >= 12, true)
      }
      if (item.waveRows) {
        // Read as the SHAPE of the frame rather than as a claim: one waveform is a single row about the middle,
        // so the top is black; two put a channel in each half, so the top is inked — and a still picture's two
        // rows leave the very centre as the gap between them. Measured on this fixture: 16 at the top and 168 at
        // the centre for one, 221 and 16 for two.
        const { rows } = item.waveRows
        const top = await bandLuma(item.output, 1, 0, 0.2)
        const centre = await bandLuma(item.output, 1, 0.49, 0.51)
        check(`the drawing is ${rows} waveform(s) (top ${top}, centre ${centre})`, rows === 1 ? top < 40 && centre > 60 : top > 60 && centre < 40, true)
      }
      if (item.waveDiffers) {
        const difference = await frameDifference(item.output, item.waveDiffers, 1)
        check(`ONE waveform and TWO are different drawings (frame difference ${difference})`, difference > 60, true)
      }
      if (item.eqProbes) {
        // The gap's lead, the bar between the two gaps, and the NEXT gap's lead: the first and last are blank
        // and the middle is drawn, which is both that the gap is applied and that a cell is one bar wide.
        const inGap = await stripLuma(item.output, 1, item.eqProbes.gap[0])
        const inBar = await stripLuma(item.output, 1, item.eqProbes.bar)
        const nextGap = await stripLuma(item.output, 1, item.eqProbes.gap[1])
        check(`a gap blanks the columns it is over (${inGap} and ${nextGap}) while the bar between them is drawn (${inBar})`, inGap < 40 && nextGap < 40 && inBar > 60, true)
      }
      if (item.eqSolid) {
        const inBar = await stripLuma(item.output, 1, item.eqSolid.bar)
        check(`with no gap the column the gap would blank is drawn (${inBar})`, inBar > 60, true)
      }
      if (item.mirrored) {
        // The drawing is its own mirror about the centre line, and its own reflection is what it is compared
        // to — so this says the mirror is exact rather than that the two halves are merely alike.
        const delta = await mirrorDelta(item.output, 2)
        check(`the frame is its own mirror about the centre line (vflip difference ${delta})`, delta < 100, true)
      }
      if (item.plainBars) {
        // And the same bars drawn the plain way are NOT symmetric, which is what makes the case above a
        // measurement: the only difference between the two jobs is the mirror.
        const delta = await mirrorDelta(item.output, 2)
        check(`and the same bars unmirrored are not symmetric (vflip difference ${delta})`, delta > 150, true)
      }
      if (item.scopeRing) {
        // A lissajous of the quadrature pair traces a circle, so it reaches across the canvas rather than
        // rising from the baseline. Measured on this fixture: seven column bands of twenty inked.
        const bands = await inkedBands(item.output, 2)
        check(`the pair is traced as a figure rather than a spoke (${bands} of 20 bands inked)`, bands >= 4, true)
        // CENTRED, not a pedestal — the whole difference from the polar mode, whose fountain stood ON the
        // baseline and left the middle of the frame black: here the middle is inked and the very bottom is not.
        const middle = await bandLuma(item.output, 2, 0.45, 0.55)
        const bottom = await bandLuma(item.output, 2, 0.8, 1)
        check(`and it sits on the centre rather than the baseline (middle ${middle}, bottom ${bottom})`, middle > 60 && bottom < 40, true)
        // THE TRACE IS THE DRAWING'S OWN COLOUR, not the white a per-channel contrast produced: green leads
        // both other channels somewhere in the frame, and nothing in it is bright in all three at once. The
        // margin is small on purpose — the theme's green is a desaturated one and 4:2:0 subsampling thins a
        // thin trace's chroma, so a strict margin finds nothing on some runs; the tint keeps the channels in
        // proportion however dim a pixel gets, so a small one is still exactly green-minus-neutral.
        const green = await greenBrightest(item.output, 2)
        const white = await whiteBrightest(item.output, 2)
        check(`and the trace is the theme's own green rather than white (green ${green}, white ${white})`, green > 40 && white <= 16, true)
        // And no magenta, which was the stray purple: blue and red never both lead green anywhere.
        const purple = await magentaBrightest(item.output, 2)
        check(`with no magenta specks anywhere (magenta ${purple})`, purple <= 16, true)
      }
      if (item.segmented) {
        // The dividers fall on a height the frame divides exactly into, so they sit at multiples of eight — and
        // they are read near the BASELINE, where the bars certainly are: the bars grow up from the bottom and
        // the top of the frame is above the tallest of them, so a row near the top is empty either way. Row
        // 896 is a divider and row 900 is the middle of the block below it, four rows apart and the same bar.
        const atDivider = await rowStripLuma(item.output, 2, 896)
        const inBlock = await rowStripLuma(item.output, 2, 900)
        check(`a segmented drawing has a dark divider across the bars (${atDivider}) with a drawn block between them (${inBlock})`, atDivider < 40 && inBlock > 60, true)
      }
      if (item.holdsPeaks) {
        // The ghost standing where the loud half left it, and then the same ghost lower down: the pair says the
        // hold is holding AND that it is decaying, rather than a picture that simply never changes.
        const early = await bandLuma(item.output, item.holdsPeaks.early, 0.1, 0.25)
        const late = await bandLuma(item.output, item.holdsPeaks.late, 0.1, 0.25)
        check(`the peak still stands past the sound that made it (top band ${early} at ${item.holdsPeaks.early}s)`, early > 60, true)
        check(`and it falls away rather than sitting there (${late} at ${item.holdsPeaks.late}s, against ${early})`, late < early && late > 15, true)
      }
      if (item.noHold) {
        const top = await bandLuma(item.output, item.noHold.at, 0.1, 0.25)
        check(`with the hold off the same sound has nothing there (top band ${top})`, top < 40, true)
      }
      if (item.matrixField) {
        // A band above the baseline, which is where the bars are NOT: on silence a plain drawing leaves it black
        // (16, the yuv black the rest of the harness calls black) while the panel lights it faintly. Measured, 41
        // against 16, so the floor sits above black and the ceiling well below a lit bar.
        const field = await bandLuma(item.output, 1, 0.05, 0.4)
        const plain = await bandLuma(item.matrixField.against, 1, 0.05, 0.4)
        check(`a panel of unlit cells is lit faintly (${field}) where the plain bars leave it black (${plain})`, field > 26 && field < 90 && plain < 24, true)
      }
      if (item.segmentGap) {
        // Three rows of divider and then a block: the gap is WIDER than the hairline, which is what makes the
        // stack read as separated pills rather than as one column with lines across it.
        const atDivider = await rowStripLuma(item.output, 2, item.segmentGap.divider)
        const inGap = await rowStripLuma(item.output, 2, item.segmentGap.gap)
        const inBlock = await rowStripLuma(item.output, 2, item.segmentGap.block)
        check(`the pills' divider is three rows thick (${atDivider}, ${inGap}) with a drawn block below it (${inBlock})`, atDivider < 40 && inGap < 40 && inBlock > 60, true)
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

  // A FADE, WHICH IS NOW WRITTEN FOR EVERY KIND OF JOB. The transcode path had no fade at all, and the
  // multi-track path had ONE shared `-af` for every audio stream — so a fade set on one added track would have
  // landed on every other lane as well. What is measured here is the SOUND: the file is decoded and the level
  // at its ends is compared with its middle, with an unfaded control beside it so the reading can tell a fade
  // from a quiet fixture. The command line is read too, because "which stream was filtered" is not something a
  // decoded mix can show.
  console.log('\n== fades ==')
  const captureCommand = async (task) => {
    const captured = []
    const original = console.log
    console.log = (...args) => { captured.push(args) }
    try { await encode(task) } finally { console.log = original }
    return captured.map((args) => (args[1] && args[1].commandLine) || '').filter(Boolean).join('\n')
  }
  const fadeConvert = {
    id: 'fade-convert', type: 'transcode', status: 'pending', progress: 0,
    sourcePaths: [audio], outputDirectory: root, outputFilename: 'fade-convert.mp4', preset,
    transitions: { '#head': { type: 'fade', duration: 1 }, '#tail': { type: 'fade', duration: 1 } },
  }
  const convertCmd = await captureCommand(fadeConvert)
  check('a CONVERT writes the fade as a video filter', /(?<![a-z])fade=t=in:st=0:d=1\.000/.test(convertCmd), true)
  check('and as an audio filter', /afade=t=in:st=0:d=1\.000/.test(convertCmd), true)
  check('and the fade out too', /afade=t=out:st=4\.000:d=1\.000/.test(convertCmd), true)
  const convertOut = path.join(root, 'fade-convert.mp4')
  const head = await rmsAt(convertOut, 0, 0.2)
  const mid = await rmsAt(convertOut, 2.4, 0.2)
  const tail = await rmsAt(convertOut, 4.8, 0.15)
  check(`the sound really fades in (head ${head.toFixed(3)} vs middle ${mid.toFixed(3)})`, head < mid * 0.4, true)
  check(`and really fades out (tail ${tail.toFixed(3)})`, tail < mid * 0.4, true)
  // The CONTROL: the same job with no fade, so "the ends are quieter" is a reading and not the fixture.
  const plainConvert = { ...fadeConvert, id: 'fade-none', outputFilename: 'fade-none.mp4' }
  delete plainConvert.transitions
  await captureCommand(plainConvert)
  const plainOut = path.join(root, 'fade-none.mp4')
  const plainHead = await rmsAt(plainOut, 0, 0.2)
  const plainMid = await rmsAt(plainOut, 2.4, 0.2)
  check(`and without a fade the same stretch is NOT quieter (head ${plainHead.toFixed(3)} vs middle ${plainMid.toFixed(3)})`, plainHead > plainMid * 0.5, true)

  // A FADE ON A STITCH OF SOUND. The two edges are the timeline's own and the boundary is the cut; all three
  // are baked into each clip's OWN chain before the join. Measured at the cut and at the clip middles, so a
  // quiet cut is a reading and not the fixture.
  const stitchFadeA = path.join(root, 'stitch-fade-a.wav')
  const stitchFadeB = path.join(root, 'stitch-fade-b.wav')
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:a', 'pcm_s16le', stitchFadeA])
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=3', '-c:a', 'pcm_s16le', stitchFadeB])
  const stitchFadeTask = {
    id: 'stitch-fade', type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: [stitchFadeA, stitchFadeB], outputDirectory: root, outputFilename: 'stitch-fade.mp4', preset,
    transitions: { [`${stitchFadeA}#0`]: { type: 'fade', duration: 1 } },
  }
  const stitchFadeCmd = await captureCommand(stitchFadeTask)
  check('a stitch bakes the boundary fade OUT into the first clip', /afade=t=out:st=2\.000:d=1\.000/.test(stitchFadeCmd), true)
  check('and the fade IN into the second', /afade=t=in:st=0:d=1\.000/.test(stitchFadeCmd), true)
  const stitchOutFile = path.join(root, 'stitch-fade.mp4')
  const stitchMidA = await rmsAt(stitchOutFile, 1.0, 0.2)
  const stitchAtCut = await rmsAt(stitchOutFile, 3.0, 0.12)
  const stitchMidB = await rmsAt(stitchOutFile, 5.0, 0.2)
  check(`the sound really fades at the cut (cut ${stitchAtCut.toFixed(3)} vs mid ${stitchMidA.toFixed(3)}/${stitchMidB.toFixed(3)})`, stitchAtCut < Math.min(stitchMidA, stitchMidB) * 0.4, true)
  // THE CONTROL: the same two clips with no fade keep the cut at full level.
  const stitchCutTask = { ...stitchFadeTask, id: 'stitch-cut', outputFilename: 'stitch-cut.mp4', transitions: undefined }
  await captureCommand(stitchCutTask)
  const stitchCutPlain = await rmsAt(path.join(root, 'stitch-cut.mp4'), 3.0, 0.12)
  check(`and with no fade the cut is NOT quieter (${stitchCutPlain.toFixed(3)})`, stitchCutPlain > Math.min(stitchMidA, stitchMidB) * 0.5, true)

  // A FADE ON ONE ADDED TRACK IS THAT TRACK'S ALONE. The visual here carries its own sound, so the track is the
  // output's SECOND audio stream; the command has to filter the two separately, with `afade` on the track and
  // none on the picture's own sound. One shared `-af` — what the path used before — could not have said that.
  const videoTone = path.join(root, 'visual-tone.mp4')
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=red:size=320x240:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', videoTone])
  const trackFade = {
    id: 'fade-track', type: 'multitrack', status: 'pending', progress: 0,
    sourcePaths: [videoTone], additionalAudioTracks: [{ id: 't1', path: audio, language: 'und' }],
    outputDirectory: root, outputFilename: 'fade-track.mp4', preset,
    transitions: { [`${audio}#0::head`]: { type: 'fade', duration: 1 } },
  }
  const trackCmd = await captureCommand(trackFade)
  const mainChain = (/ -filter:a:0 ([^ ]+)/.exec(trackCmd) || [])[1] || ''
  const trackChain = (/ -filter:a:1 ([^ ]+)/.exec(trackCmd) || [])[1] || ''
  check('the lane with a fade is filtered as its OWN stream', /afade=t=in:st=0:d=1\.000/.test(trackChain), true)
  check('and the lane without one carries no fade', /afade/.test(mainChain), false)
  check('and the shared single-filter path is not used once a lane is faded', /(^| )-af /.test(trackCmd), false)
  const plainTrack = { ...trackFade, id: 'fade-track-none', outputFilename: 'fade-track-none.mp4', transitions: undefined }
  const plainTrackCmd = await captureCommand(plainTrack)
  check('while a job with no fade keeps the one shared audio filter it always had', /(^| )-af aresample=48000/.test(plainTrackCmd), true)
  check('and writes no per-stream filters at all', / -filter:a:/.test(plainTrackCmd), false)

  // SEQUENCED TRACKS AND RETIMING IN A MULTI-TRACK/COMBO. 'stitch' tracks are concatenated into ONE stream
  // that plays end to end, where stacked tracks are one stream each from zero; and a MULTI-TRACK/COMBO can
  // retime its visual and its tracks through the same filters a CONVERT uses. Read as the LENGTH of the
  // file and the NUMBER of audio streams, which are the two things the mode and the retime change.
  console.log('\n== sequenced tracks and retiming ==')
  const audioStreams = async (file) => String(await probeValue(file, 'stream=codec_type')).split('\n').map((line) => line.trim()).filter((line) => line === 'audio').length
  const videoTone4 = path.join(root, 'visual-tone-4.mp4')
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=red:size=320x240:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', videoTone4])
  const shortTone = path.join(root, 'short-tone.wav')
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', shortTone])

  // Two 5s tracks SEQUENCED behind a 2s picture: the output runs to their SUM. The same two STACKED would
  // run to the longest, and carry two audio streams rather than one.
  const sequenced = {
    id: 'track-sequence', type: 'multitrack', comboMode: 'stitch', status: 'pending', progress: 0,
    sourcePaths: [video], additionalAudioTracks: [{ id: 't1', path: audio, language: 'und' }, { id: 't2', path: audio, language: 'und' }],
    outputDirectory: root, outputFilename: 'track-sequence.mp4', preset,
  }
  await encode(sequenced)
  const sequencedOut = path.join(root, 'track-sequence.mp4')
  check('two tracks sequenced run one after the other', Number(await probeValue(sequencedOut, 'format=duration')), 10)
  check('and they are written as ONE audio stream', await audioStreams(sequencedOut), 1)
  const stackedTwo = { ...sequenced, id: 'track-stack', comboMode: 'multitrack', outputFilename: 'track-stack.mp4' }
  await encode(stackedTwo)
  const stackedOut = path.join(root, 'track-stack.mp4')
  check('while the same two stacked run alongside each other', Number(await probeValue(stackedOut, 'format=duration')), 5)
  check('and are two streams', await audioStreams(stackedOut), 2)

  // RETIMING. A visual at 2x writes half its own length, with its embedded sound retimed beside it; a track
  // at 2x contributes half of its trimmed run, through the per-stream chain.
  const visualRetime = {
    id: 'retime-visual', type: 'multitrack', status: 'pending', progress: 0,
    sourcePaths: [videoTone4], additionalAudioTracks: [{ id: 't1', path: shortTone, language: 'und' }],
    sourceSpeed: { [`${videoTone4}#0`]: { speed: 2, interpolation: 'sampling', maintainPitch: true } },
    outputDirectory: root, outputFilename: 'retime-visual.mp4', preset,
  }
  await encode(visualRetime)
  check('a visual retimed at 2x writes half its run', Number(await probeValue(path.join(root, 'retime-visual.mp4'), 'format=duration')), 2)
  const trackRetime = {
    id: 'retime-track', type: 'multitrack', status: 'pending', progress: 0,
    sourcePaths: [videoTone4], additionalAudioTracks: [{ id: 't1', path: audio, language: 'und' }],
    sourceSpeed: { [`${audio}#0`]: { speed: 2, interpolation: 'sampling', maintainPitch: true } },
    outputDirectory: root, outputFilename: 'retime-track.mp4', preset,
  }
  await encode(trackRetime)
  check('a track retimed at 2x contributes half of its run', Number(await probeValue(path.join(root, 'retime-track.mp4'), 'format=duration')), 4)

  // A CLIP'S OWN EMBEDDED SOUND: which streams reach the export, at what level, and what extraction does.
  // The fixture carries TWO audio streams — a loud 440 Hz tone first and silence second — so "which stream
  // was written" is answered by measuring the output, not by reading the argument list alone.
  console.log('\n== embedded audio: per-stream mute, level and extraction ==')
  const twoAudio = path.join(root, 'two-audio.mp4')
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'color=red:size=320x240:rate=25:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', '2', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', twoAudio,
  ])
  check('the fixture carries TWO audio streams', await audioStreams(twoAudio), 2)
  const embedClipId = `${twoAudio}#0`
  const baseTask = { status: 'pending', progress: 0, sourcePaths: [twoAudio], outputDirectory: root, preset }
  // The fixture's own loudness, so the readings below are compared with the thing they are about rather than
  // with a figure guessed at: the tone stream is stream 0, which is the one ffmpeg decodes by default.
  const tone = await rmsAt(twoAudio, 0.5, 0.3)

  // UNTOUCHED: the clip is handed to ffmpeg's own selection exactly as before, so both streams are mapped.
  const untouchedCmd = await captureCommand({ id: 'embed-none', type: 'multitrack', outputFilename: 'embed-none.mp4', ...baseTask })
  check('an untouched clip keeps ffmpeg\u2019s own `-map 0:a?`', / -map 0:a\?/.test(untouchedCmd), true)
  check('and names no stream', / -map 0:a:/.test(untouchedCmd), false)
  check('so both streams reach the output', await audioStreams(path.join(root, 'embed-none.mp4')), 2)

  // MUTE the SILENT stream: only the loud one is written, and it is heard.
  const muteSecond = { id: 'embed-mute1', type: 'multitrack', outputFilename: 'embed-mute1.mp4', ...baseTask, embeddedAudio: { [embedClipId]: [{ index: 1, muted: true }] } }
  const muteSecondCmd = await captureCommand(muteSecond)
  check('muting a stream maps exactly the enabled ones', / -map 0:a:0/.test(muteSecondCmd), true)
  check('and does not fall back to `0:a?`', / -map 0:a\?/.test(muteSecondCmd), false)
  const muteSecondOut = path.join(root, 'embed-mute1.mp4')
  check('so the muted stream is not written', await audioStreams(muteSecondOut), 1)
  check(`and the sound left is the loud one (${(await rmsAt(muteSecondOut, 0.5, 0.3)).toFixed(3)} vs ${tone.toFixed(3)})`, (await rmsAt(muteSecondOut, 0.5, 0.3)) > tone * 0.5, true)

  // MUTE the LOUD stream: only the silent one is written, so the file is quiet — the other half of the same
  // reading, which a `0:a` or "first stream" mapping could not have told apart.
  const muteFirst = { ...muteSecond, id: 'embed-mute0', outputFilename: 'embed-mute0.mp4', embeddedAudio: { [embedClipId]: [{ index: 0, muted: true }] } }
  await captureCommand(muteFirst)
  const muteFirstOut = path.join(root, 'embed-mute0.mp4')
  check('muting the FIRST stream leaves the other one', await audioStreams(muteFirstOut), 1)
  check(`and it is the silent one, so the file is quiet (${(await rmsAt(muteFirstOut, 0.5, 0.3)).toFixed(3)})`, (await rmsAt(muteFirstOut, 0.5, 0.3)) < tone * 0.1, true)

  // A LEVEL: -20 dB on the loud stream is written as `volume=` on that stream's own chain and is measurably
  // quieter than the same stream at unity.
  const levelled = { ...muteSecond, id: 'embed-level', outputFilename: 'embed-level.mp4', embeddedAudio: { [embedClipId]: [{ index: 0, gainDb: -20 }] } }
  const levelledCmd = await captureCommand(levelled)
  check('a level is written as `volume=` on that stream\u2019s own chain', /volume=0\.1/.test(levelledCmd), true)
  const full = await rmsAt(muteSecondOut, 1, 0.4)
  const quiet = await rmsAt(path.join(root, 'embed-level.mp4'), 1, 0.4)
  check(`and -20 dB really is about a tenth as loud (${quiet.toFixed(4)} vs ${full.toFixed(4)})`, quiet < full * 0.25 && quiet > full * 0.03, true)

  // EXTRACT: the stream leaves the picture for a track that NAMES it, so the picture stops carrying it and
  // the track carries it instead — never both.
  const extracted = {
    id: 'embed-extract', type: 'multitrack', outputFilename: 'embed-extract.mp4', ...baseTask,
    additionalAudioTracks: [{ id: 'x1', path: twoAudio, language: 'und', streamIndex: 1, sourceClipId: embedClipId }],
  }
  const extractCmd = await captureCommand(extracted)
  check('an extracted stream is mapped from the track\u2019s own input, by its index', / -map 1:a:1/.test(extractCmd), true)
  check('and the picture no longer carries it', / -map 0:a:0/.test(extractCmd) && !/ -map 0:a:1/.test(extractCmd) && !/ -map 0:a\?/.test(extractCmd), true)
  check('so the output carries both, the picture\u2019s own and the track\u2019s', await audioStreams(path.join(root, 'embed-extract.mp4')), 2)

  // The CONVERT path names each stream too, and must name the PICTURE beside them: any `-map` turns off
  // ffmpeg's automatic selection for every kind, so a stream-named transcode that forgot the picture would
  // write a sound file in a video container.
  const convertLevel = { ...baseTask, id: 'embed-convert', type: 'transcode', outputFilename: 'embed-convert.mp4', embeddedAudio: { [embedClipId]: [{ index: 0, gainDb: -20 }, { index: 1, muted: true }] } }
  const convertLevelCmd = await captureCommand(convertLevel)
  check('a CONVERT names the picture beside the streams it names', / -map 0:v:0/.test(convertLevelCmd), true)
  check('and maps only the enabled stream', / -map 0:a:0/.test(convertLevelCmd) && !/ -map 0:a:1/.test(convertLevelCmd), true)

  // A TRACK'S OWN LEVEL, and the extraction that has to CARRY it. A track's gain is written on that track's
  // own stream — before the mix, so each track's level is independent — and extracting a levelled stream has
  // to hand the level to the new track, so the mix is unchanged at the moment of extraction.
  console.log('\n== a track\u2019s own level, and the level an extraction carries ==')
  const trackGain = {
    id: 'track-gain', type: 'multitrack', outputFilename: 'track-gain.mp4', ...baseTask,
    sourcePaths: [twoAudio], additionalAudioTracks: [{ id: 't1', path: shortTone, language: 'und', gainDb: -20 }],
  }
  const trackGainCmd = await captureCommand(trackGain)
  // The fixture's visual carries TWO audio streams, so an untouched main lane maps both (`-map 0:a?`) and the
  // added track is the THIRD output stream — the count the per-stream filters and the tags are indexed by.
  check('a track\u2019s level is written on that track\u2019s own stream', / -filter:a:2 [^\n]*volume=0\.1/.test(trackGainCmd), true)
  check('and the level is written nowhere else', (trackGainCmd.match(/volume=/g) || []).length === 1, true)
  const plainTrackGain = { ...trackGain, id: 'track-none', outputFilename: 'track-none.mp4', additionalAudioTracks: [{ id: 't1', path: shortTone, language: 'und' }] }
  await captureCommand(plainTrackGain)
  await encode(trackGain)
  await encode(plainTrackGain)
  const tGain = await rmsStream(path.join(root, 'track-gain.mp4'), 2, 0.3, 0.4)
  const tPlain = await rmsStream(path.join(root, 'track-none.mp4'), 2, 0.3, 0.4)
  check(`and the track really is about a tenth as loud (${tGain.toFixed(4)} vs ${tPlain.toFixed(4)})`, tGain < tPlain * 0.25 && tGain > tPlain * 0.03, true)

  // THE ACCEPTANCE: a clip at a non-unity level, extracted to a track, sounds the same before and after.
  const beforeExtract = { id: 'carry-before', type: 'multitrack', outputFilename: 'carry-before.mp4', ...baseTask, sourcePaths: [twoAudio], embeddedAudio: { [embedClipId]: [{ index: 0, gainDb: -20 }] } }
  await encode(beforeExtract)
  const beforeRms = await rmsStream(path.join(root, 'carry-before.mp4'), 0, 1, 0.4)
  const afterExtract = {
    id: 'carry-after', type: 'multitrack', outputFilename: 'carry-after.mp4', ...baseTask, sourcePaths: [twoAudio],
    additionalAudioTracks: [{ id: 'x1', path: twoAudio, language: 'und', streamIndex: 0, sourceClipId: embedClipId, gainDb: -20 }],
  }
  await encode(afterExtract)
  // The extracted stream is the SECOND output stream after extraction (the picture keeps the other one), and
  // the two readings have to agree: the level travelled with the stream rather than being left behind.
  const afterRms = await rmsStream(path.join(root, 'carry-after.mp4'), 1, 1, 0.4)
  check(`the extracted track sounds the same as the clip did (${afterRms.toFixed(4)} vs ${beforeRms.toFixed(4)})`, beforeRms > 0 && Math.abs(afterRms - beforeRms) < beforeRms * 0.3, true)
  check('and the level it carried is written on the track\u2019s own stream', /volume=0\.1/.test(await captureCommand(afterExtract)), true)

  // A SOUND CLIP'S OWN LEVEL, on the CONVERT path: an audio file's one stream IS the export's stream, so the
  // level joins the chain the retime and the fades use rather than needing a map list of its own.
  const soundLevel = { id: 'sound-level', type: 'transcode', outputFilename: 'sound-level.mp4', status: 'pending', progress: 0, sourcePaths: [audio], outputDirectory: root, preset, embeddedAudio: { [`${audio}#0`]: [{ index: 0, gainDb: -20 }] } }
  const soundCmd = await captureCommand(soundLevel)
  check('a sound clip\u2019s own level is written on the export\u2019s audio chain', / -af [^\n]*volume=0\.1/.test(soundCmd), true)

  // X-FADE: A CROSS-DISSOLVE OVERLAPS, SO THE JOIN IS SHORTER. The two clips are conformed first — `xfade`
  // refuses mismatched raster, rate or pixfmt — and the picture is blended with `xfade` and the sound with
  // `acrossfade`. Read as the LENGTH of the file (the overlap is missing from it) and the COMMAND (the
  // filtergraph is used, not the stream-copying concat demuxer), with an all-cut control beside it.
  console.log('\n== X-FADE: a cross-dissolve overlaps, so the join is shorter ==')
  const xfadeA = path.join(root, 'xfade-a.mp4')
  const xfadeB = path.join(root, 'xfade-b.mp4')
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=red:size=320x240:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', xfadeA])
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=blue:size=320x240:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', xfadeB])
  const xfadeTask = {
    id: 'xfade-join', type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: [xfadeA, xfadeB], outputDirectory: root, outputFilename: 'xfade.mp4', preset,
    transitions: { [`${xfadeA}#0`]: { type: 'crossfade', duration: 1 } },
  }
  const xfadeCmd = await captureCommand(xfadeTask)
  check('the join is written through a filtergraph', /xfade=transition=fade:duration=1\.000:offset=3\.000/.test(xfadeCmd), true)
  check('and the sound cross-fades across the same boundary', /acrossfade=d=1\.000/.test(xfadeCmd), true)
  check('and the stream-copying demuxer is not used once a crossfade is written', /-f concat/.test(xfadeCmd), false)
  const xfadeSeconds = Number(await probeValue(path.join(root, 'xfade.mp4'), 'format=duration'))
  check(`the join is one overlap shorter (${xfadeSeconds.toFixed(2)}s against 8.00)`, Math.abs(xfadeSeconds - 7) < 0.35, true)
  // THE CONTROL: the same two clips with no crossfade keep the demuxer and the full length.
  const cutTask = { ...xfadeTask, id: 'xfade-cut', outputFilename: 'plain-cut.mp4', transitions: undefined }
  const cutCmd = await captureCommand(cutTask)
  check('while a job of plain cuts still concatenates through the demuxer', /-f concat/.test(cutCmd), true)
  check('and writes no cross-dissolve at all', /xfade=transition=/.test(cutCmd), false)
  const cutSeconds = Number(await probeValue(path.join(root, 'plain-cut.mp4'), 'format=duration'))
  check(`and runs the full length (${cutSeconds.toFixed(2)}s against 8.00)`, Math.abs(cutSeconds - 8) < 0.35, true)

  // A PER-CLIP MUTE SILENCES THAT CLIP. Muting a clip is not dropping its stream — the join wants the same
  // streams on every clip — so the clip's own chain is given `volume=0` and the sound is taken while the
  // stream stays. Measured on the two clips above: the muted one's stretch is silent and the other still sounds.
  console.log('\n== a per-clip MUTE silences that clip in a stitch ==')
  const mutedClipTask = {
    id: 'stitch-mute', type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: [xfadeA, xfadeB], outputDirectory: root, outputFilename: 'stitch-mute.mp4', preset,
    embeddedAudio: { [`${xfadeA}#0`]: [{ index: 0, muted: true }] },
  }
  const muteCmd = await captureCommand(mutedClipTask)
  check('the muted clip is silenced in its own chain', /volume=0/.test(muteCmd), true)
  const muteOut = path.join(root, 'stitch-mute.mp4')
  const mutedStretch = await rmsAt(muteOut, 1.0, 0.2)
  const soundingStretch = await rmsAt(muteOut, 5.0, 0.2)
  check(`the muted clip's stretch is silent (${mutedStretch.toFixed(4)}) while the other still sounds (${soundingStretch.toFixed(4)})`, mutedStretch < 0.002 && soundingStretch > 0.02, true)

  // ADD BLANK / ADD SILENCE ARE PLACEHOLDERS THE ENCODER WRITES ITSELF. The editor places a source with no
  // file behind it — a flat colour, or silence — and the encoder asks ffmpeg's own `lavfi` device for it. This
  // proves both halves: that the sources it hands ffmpeg are what the pipeline assumes (a BLANK a picture AND a
  // sound, a SILENCE a sound alone), and that a blank joins an ordinary stitch, lengthens it by its own trimmed
  // length, and contributes the frame its own FILL COLOUR asks for.
  console.log('\n== ADD BLANK / ADD SILENCE are placeholders the encoder writes itself ==')
  const blankSrc = path.join(root, 'blank-source.mp4')
  await runFfmpeg(['-f', 'lavfi', '-i', blankSource('cc3344', 320, 240, 25, 3), '-map', '0:v', '-map', '0:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-c:a', 'aac', '-t', '3', blankSrc])
  const blankProbe = await probeFile(blankSrc)
  check('a BLANK source carries a picture', blankProbe.videoStreams.length > 0, true)
  check('and a sound, so a clip that is JOINED is still joinable', blankProbe.audioStreams.length > 0, true)

  const silenceSrc = path.join(root, 'silence-source.m4a')
  await runFfmpeg(['-f', 'lavfi', '-i', silenceSource(3), '-map', '0:a', '-c:a', 'aac', '-t', '3', silenceSrc])
  const silenceProbe = await probeFile(silenceSrc)
  check('a SILENCE source carries a sound', silenceProbe.audioStreams.length > 0, true)
  check('and no picture at all', silenceProbe.videoStreams.length, 0)

  // Through the STITCH path: a blank between two clips is joined like any clip and runs its own length, and
  // the frame it contributes is its own fill colour rather than black.
  const blankPath = 'placeholder:video:test-blank-1:cc3344'
  const blankStitch = {
    id: 'blank-stitch', type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: [xfadeA, blankPath, xfadeB], outputDirectory: root, outputFilename: 'blank-stitch.mp4', preset,
    trimPoints: { [blankPath]: { in: 0, out: 3 } },
  }
  const blankCmd = await captureCommand(blankStitch)
  check('the stitch asks the lavfi device for the blank', /-f lavfi/.test(blankCmd), true)
  check('and paints it the clip\u2019s own fill colour', /color=c=0xcc3344/.test(blankCmd), true)
  const blankOut = path.join(root, 'blank-stitch.mp4')
  const blankSeconds = Number(await probeValue(blankOut, 'format=duration'))
  check(`and the join runs 3s longer (${blankSeconds.toFixed(2)}s against 11.00)`, Math.abs(blankSeconds - 11) < 0.4, true)
  const blankPixel = await pixelAt(blankOut, 5.5)
  check(`and the blank\u2019s stretch really is its fill colour (${blankPixel.join(',')})`, blankPixel[0] > 120 && blankPixel[1] < 110 && blankPixel[2] < 110, true)

  // Through the MULTI-TRACK path: a silence as an added track, written from `anullsrc` at its trimmed length.
  const silencePath = 'placeholder:audio:test-silence-1'
  const silenceTrackTask = {
    id: 'silence-track', type: 'multitrack', status: 'pending', progress: 0,
    sourcePaths: [xfadeA], outputDirectory: root, outputFilename: 'silence-track.mp4', preset,
    additionalAudioTracks: [{ id: 'sil-1', path: silencePath, language: 'und' }],
    trimPoints: { [`${silencePath}#0`]: { in: 0, out: 4 } },
  }
  const silenceCmd = await captureCommand(silenceTrackTask)
  check('the multi-track writes the silence as anullsrc', /anullsrc/.test(silenceCmd), true)
  const silenceOutSeconds = Number(await probeValue(path.join(root, 'silence-track.mp4'), 'format=duration'))
  check(`at the length it was trimmed to (${silenceOutSeconds.toFixed(2)}s against 4.00)`, Math.abs(silenceOutSeconds - 4) < 0.4, true)

  // A CROSS-DISSOLVE INTO A BLANK. The blank's normalized clip carries BOTH streams, so `xfade` and
  // `acrossfade` are handed something they can blend — which is what a colour matte between two shots has to
  // be, and what a picture-only blank could not have been.
  const blankXfadeTask = {
    id: 'blank-xfade', type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: [xfadeA, blankPath, xfadeB], outputDirectory: root, outputFilename: 'blank-xfade.mp4', preset,
    trimPoints: { [blankPath]: { in: 0, out: 2 } },
    transitions: { [`${xfadeA}#0`]: { type: 'crossfade', duration: 1 } },
  }
  const blankXfadeCmd = await captureCommand(blankXfadeTask)
  check('a cross-dissolve into a blank builds the xfade graph', /xfade=transition=fade/.test(blankXfadeCmd), true)
  const blankXfadeSeconds = Number(await probeValue(path.join(root, 'blank-xfade.mp4'), 'format=duration'))
  check(`and the join runs one overlap shorter (${blankXfadeSeconds.toFixed(2)}s against 9.00)`, Math.abs(blankXfadeSeconds - 9) < 0.4, true)

  // HOW SEVERAL AUDIO LANES ARE LAID OUT. A MULTI-TRACK plays its lanes at once, and the export either writes
  // one stream per lane — carrying each lane's own language, which is what a container with several tracks is
  // for — or SUMS them into one. The container can also refuse the separate answer, which is what used to make
  // a multi-track export to a wav, a flac or an mp3 a FAILED job rather than a file.
  console.log('\n== how several audio lanes are laid out ==')
  const lanesVisual = path.join(root, 'lanes-visual.mp4')
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=3', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', lanesVisual])
  const laneA = path.join(root, 'lane-a.wav')
  const laneB = path.join(root, 'lane-b.wav')
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:a', 'pcm_s16le', laneA])
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=3', '-c:a', 'pcm_s16le', laneB])
  // A SILENT visual, so the two lanes are the only audio and the stream count is the lanes themselves.
  const laneTask = (container, audioLayout, outputFilename, preventClipping) => ({
    id: `lanes-${outputFilename}`, type: 'multitrack', status: 'pending', progress: 0,
    sourcePaths: [lanesVisual], outputDirectory: root, outputFilename,
    additionalAudioTracks: [{ id: 'la', path: laneA, language: 'eng' }, { id: 'lb', path: laneB, language: 'fra' }],
    preset: { ...preset, container, ...(audioLayout ? { audioLayout } : {}), ...(preventClipping ? { audioPreventClipping: true } : {}) },
  })

  const separateCmd = await captureCommand(laneTask('mkv', undefined, 'lanes-separate.mkv'))
  check('a roomy container maps a stream per lane', (separateCmd.match(/-map \d+:a:0/g) || []).length, 2)
  const separateProbe = await probeFile(path.join(root, 'lanes-separate.mkv'))
  check('and the file really holds them apart', separateProbe.audioStreams.length, 2)
  check('each naming its own language', separateProbe.audioStreams.map((stream) => stream.language).join(','), 'eng,fra')

  const mixCmd = await captureCommand(laneTask('mkv', 'mixdown', 'lanes-mix.mkv'))
  check('a mixture sums the lanes with amix', /amix=inputs=2:normalize=0:duration=longest/.test(mixCmd), true)
  const mixProbe = await probeFile(path.join(root, 'lanes-mix.mkv'))
  check('and the file holds ONE stream', mixProbe.audioStreams.length, 1)
  // ONE lane's level as the ENCODER wrote it — its own stream of the separate file — rather than the raw wav.
  // The reading has to be taken the same way on both sides: `rmsAt` decodes to s16le and MIXES DOWN to mono,
  // and this ffmpeg's downmix weights differ between s16 and f32 output (measured: the same stereo mix reads
  // 0.088 the s16 way and 0.125 the f32 way), so a mono wav against a stereo mix compares two weights.
  const oneLaneRms = await rmsStream(path.join(root, 'lanes-separate.mkv'), 0, 0.5, 1)
  const mixRms = await rmsAt(path.join(root, 'lanes-mix.mkv'), 0.5, 1)
  check(`and BOTH lanes are in it (${mixRms.toFixed(3)} against one lane's ${oneLaneRms.toFixed(3)})`, mixRms > oneLaneRms * 1.2, true)

  // THE FIX: wav, flac and mp3 take ONE audio stream and refuse a second (measured), so the lanes are SUMMED
  // there even though the job said nothing about how to lay them out.
  const wavCmd = await captureCommand(laneTask('wav', undefined, 'lanes-fixed.wav'))
  check('a one-track container never maps a second stream', /-map [12]:a/.test(wavCmd), false)
  check('and maps the summed one instead', /-map \[aout\]/.test(wavCmd), true)
  const wavProbe = await probeFile(path.join(root, 'lanes-fixed.wav'))
  check('so the file is written rather than refused', wavProbe.audioStreams.length, 1)

  // THE OPT-IN CLIPPING GUARD. Off — the default — the sum is written RAW, exactly as it always was; on, a
  // limiter is dropped AFTER the mixer, so it catches what the LANES added to each other rather than any one
  // lane, and a lane-count rescaling (amix's own default `normalize=1`) is never used because it would fight
  // each lane's own level.
  const guardOffCmd = await captureCommand(laneTask('mkv', 'mixdown', 'lanes-guard-off.mkv'))
  check('a raw sum carries no limiter', /alimiter/.test(guardOffCmd), false)
  const guardOnCmd = await captureCommand(laneTask('mkv', 'mixdown', 'lanes-guard-on.mkv', true))
  check('the guard drops a limiter AFTER the mixer', /amix=inputs=2:normalize=0:duration=longest,alimiter=level=disabled:limit=1\.0:latency=1\[aout\]/.test(guardOnCmd), true)
  check('and never a lane-count rescaling', /normalize=1/.test(guardOnCmd), false)
  // TRANSPARENT BELOW THE CEILING. The two equal tones sum to well inside full scale (peak 0.17), so the guard
  // has nothing to catch here: the guarded mix must read the same as the raw one. That is the whole reason the
  // guard can be OPT-IN rather than a change to every mixdown.
  const rawGuardRms = await rmsAt(path.join(root, 'lanes-guard-off.mkv'), 0.5, 1)
  const guardedRms = await rmsAt(path.join(root, 'lanes-guard-on.mkv'), 0.5, 1)
  check(`and leaves a mix that is already inside the scale alone (${guardedRms.toFixed(3)} against ${rawGuardRms.toFixed(3)})`, Math.abs(guardedRms - rawGuardRms) < rawGuardRms * 0.03, true)
  // AND IT REALLY CATCHES. `volumedetect` reports an over-scale peak at 0 dB whatever it is, so the peak is read
  // from FLOAT samples instead. The filter string is taken from the command the encoder just wrote, so what is
  // measured is the very filter this path drops — fed a sum that reaches ~1.4, which it must catch at 1.0.
  const guardFilter = (guardOnCmd.match(/alimiter=[^,\[]*/) || [])[0] || ''
  const overScale = (guard) => {
    const graph = '[0:a]volume=8[a];[1:a]volume=8[b];[a][b]amix=inputs=2:normalize=0[o]'
    return ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=1', '-filter_complex', guard ? `${graph};[o]${guard}[g]` : graph, '-map', guard ? '[g]' : '[o]']
  }
  const rawPeak = await peakAt(overScale(undefined))
  const caughtPeak = await peakAt(overScale(guardFilter))
  check(`an over-scale sum is raw when the guard is off (peak ${rawPeak.toFixed(2)})`, rawPeak > 1.2, true)
  check(`and the guard the encoder drops catches it at full scale (peak ${caughtPeak.toFixed(2)})`, caughtPeak < 1.05, true)

  // AN ASYMMETRIC PAIRING, not two equal tones. The sum has to hold across a CONTOUR — one loud lane and one
  // quiet — and not only where both lanes are alike. A raw sum ADDS energy, so the mix lands ABOVE its loud lane
  // alone; an average (amix's own default, which this path never uses) would land BELOW it, so the two answers
  // are told apart by which side of the loud lane the mix is on, and by how far.
  const laneLoud = path.join(root, 'lane-loud.wav')
  const laneQuiet = path.join(root, 'lane-quiet.wav')
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=3', '-c:a', 'pcm_s16le', laneLoud])
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=3', '-af', 'volume=0.5', '-c:a', 'pcm_s16le', laneQuiet])
  const contourTask = (audioLayout, outputFilename) => ({
    id: `contour-${outputFilename}`, type: 'multitrack', status: 'pending', progress: 0,
    sourcePaths: [lanesVisual], outputDirectory: root, outputFilename,
    additionalAudioTracks: [{ id: 'll', path: laneLoud, language: 'und' }, { id: 'lq', path: laneQuiet, language: 'und' }],
    preset: { ...preset, container: 'mkv', ...(audioLayout ? { audioLayout } : {}) },
  })
  // The loud lane alone, as the ENCODER writes it, is the control for the reading — the same reader on both sides.
  await captureCommand(contourTask(undefined, 'contour-separate.mkv'))
  const loudLaneRms = await rmsStream(path.join(root, 'contour-separate.mkv'), 0, 0.5, 1)
  const quietLaneRms = await rmsStream(path.join(root, 'contour-separate.mkv'), 1, 0.5, 1)
  await captureCommand(contourTask('mixdown', 'contour-mix.mkv'))
  const contourMixRms = await rmsAt(path.join(root, 'contour-mix.mkv'), 0.5, 1)
  check(`a loud lane and a quiet one really are apart (${(loudLaneRms / quietLaneRms).toFixed(2)}x)`, loudLaneRms > quietLaneRms * 1.9, true)
  // Half the loud lane's amplitude means a raw sum sits at sqrt(1 + 0.25) ~ 1.118x the loud lane: above it, but by
  // less than a second full lane would (sqrt(2) ~ 1.414x). Held inside 1.05...1.25, which an average (0.75x) and
  // a doubled sum (1.414x) both fall outside of.
  check(`the sum adds the quiet lane to the loud one (${contourMixRms.toFixed(3)} against ${loudLaneRms.toFixed(3)})`, contourMixRms > loudLaneRms * 1.05, true)
  check(`and by less than a second full lane would (${(contourMixRms / loudLaneRms).toFixed(3)}x against 1.414x)`, contourMixRms < loudLaneRms * 1.25, true)

  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
  console.log(failures.length ? `\n${failures.length} TAIL PROBLEM(S)\n` : '\nTHE OUTPUT RUNS TO ITS SOUND, IN BLACK\n')
  process.exit(failures.length ? 1 : 0)
}

void main().catch((error) => { console.error('HARNESS FAILED', error); process.exit(1) })
