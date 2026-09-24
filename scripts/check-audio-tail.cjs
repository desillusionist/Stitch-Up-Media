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
    template, width: 1920, height: 1080, fps: 30, color: '#9fbf9a', sources: ['0:a'], background: '#000000', tune: viz.drawingTuneOf({}),
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
        // A spoke reaches one column band of twenty and a ring reaches several. Measured on this fixture: one
        // with the quadrature off, eight with it on — so four is the floor and the figure is printed beside it.
        const bands = await inkedBands(item.output, 2)
        check(`a mono sound is opened into a ring rather than drawn as a spoke (${bands} of 20 bands inked)`, bands >= 4, true)
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
