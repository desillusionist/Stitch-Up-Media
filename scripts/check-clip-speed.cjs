/**
 * What a clip's own speed does to the file the encoder writes.
 *
 * The speed is a claim about TIME and the only place it can be checked is the finished file: how long
 * the export runs, how many frames it holds, and which clip is on screen at an instant the timeline
 * says belongs to the sped one. A filter string cannot answer any of those, so this runs the encoder's
 * own stitch path — the real one, not a copy of its arguments — over generated fixtures and reads the
 * result back.
 *
 * The fixtures are two one-colour clips joined end to end: red for two seconds, then green for one. The
 * red one is run at twice its speed, so the timeline is red for ONE second and green for the second
 * after it — one second shorter than the sources are, and a join that has moved with it. Everything
 * below follows from that: the length, the frame count, and which colour is on screen either side of
 * the cut.
 *
 * A control run with no speed at all is made beside it, because the property that matters most is that
 * a job which has never been retimed is the file it always was.
 *
 * Usage: node scripts/check-clip-speed.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { FFmpegEngine } = require('./.engine.cjs')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-speed-'))

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message)))
    else resolve(stdout)
  })
})
const runFfmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

/** A clip of one colour with a tone under it, at the rate and length asked for. */
const makeClip = async (name, colour, seconds) => {
  const file = path.join(work, `${name}.mp4`)
  await runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=${colour}:s=320x240:r=30:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${colour === 'red' ? 440 : 660}:sample_rate=48000:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ])
  return file
}

const secondsOf = async (file) => Number(String(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim())
const framesOf = async (file) => Number(String(await run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim())
/** Whether the file carries a sound stream at all, which is what says the retimed sound was written. */
const hasAudio = async (file) => String(await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim() === 'audio'
/** The colour at a point in the finished file: red inside the sped clip's run, green inside the next. */
const colourAt = async (file, time) => {
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'crop=2:2:100:100,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
  const [r, g, b] = [raw[0], raw[1], raw[2]]
  if (r > g && r > b) return 'red'
  if (g > r && g > b) return 'green'
  return 'other'
}

const preset = { id: 'p', name: 'P', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', resolution: 'source', fps: 30, outputMode: 'video' }

let failures = 0
const check = (label, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) failures++
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label}${same ? '' : `\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`}`)
}

/**
 * The subtitle stream's own text, as SRT, or nothing where the file carries no subtitle stream.
 *
 * Read back through ffmpeg rather than off the file's bytes: what matters is what a PLAYER can pull out of
 * the container — an mp4's `mov_text` and an mkv's `subrip` are not the SRT that was fed in, they are the
 * cue list stored in the container's own way — and this is the same reader a player would use.
 */
const captionsOf = async (file) => {
  try {
    return String(await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:s:0', '-f', 'srt', '-']))
  } catch { return '' }
}
const subtitleCodecOf = async (file) => String(await run('ffprobe', ['-v', 'error', '-select_streams', 's', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim()
/** The `start --> end` lines of an SRT, which is the whole of what a caption's TIME is. */
const cueTimes = (srt) => [...srt.matchAll(/(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})/g)].map((match) => [match[1], match[2]])

/**
 * How many pale pixels are in the bottom part of a frame, which is where a burned caption sits.
 *
 * The fixture is RED, so a whitish pixel cannot be the picture: only the caption's own ink is pale. It is read from
 * the finished file rather than from the filter string, because a filter that was built and then not applied — the
 * fault this whole check exists for — leaves a perfectly red frame.
 */
const whiteBottomPixels = async (file, time) => {
  const width = 320
  const height = 240
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' })
  let count = 0
  for (let y = Math.floor(height * 0.55); y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3
      if (raw[at] > 140 && raw[at + 1] > 140 && raw[at + 2] > 140) count++
    }
  }
  return count
}

/** Runs one stitch to completion and hands back the file it wrote. */
const stitch = (sources, outputFilename, sourceSpeed, sourceFps, extra) => new Promise((resolve, reject) => {
  const engine = new FFmpegEngine()
  const directory = path.join(work, `${outputFilename}-dir`)
  fs.mkdirSync(directory, { recursive: true })
  const task = {
    id: `job-${outputFilename}`, type: 'stitch', status: 'pending', progress: 0,
    sourcePaths: sources, outputDirectory: directory, outputFilename,
    preset, ...(sourceSpeed ? { sourceSpeed } : {}), ...(sourceFps ? { sourceFps } : {}), ...(extra || {}),
  }
  engine.runTask(task, () => {}, () => resolve(path.join(directory, outputFilename)), (error) => reject(error))
})

/** The same, for a job whose shape is not a plain stitch — a multi-track job with added tracks, for instance. */
const runTask = (outputFilename, fields) => new Promise((resolve, reject) => {
  const engine = new FFmpegEngine()
  const directory = path.join(work, `${outputFilename}-dir`)
  fs.mkdirSync(directory, { recursive: true })
  engine.runTask({
    id: `job-${outputFilename}`, status: 'pending', progress: 0, outputDirectory: directory, outputFilename, preset,
    ...fields,
  }, () => {}, () => resolve(path.join(directory, outputFilename)), (error) => reject(error))
})

/**
 * The mean level of a short run of the finished file, in dBFS.
 *
 * `volumedetect` prints to stderr, which is why this does not go through `run`: the question is whether a
 * track is HEARD at an instant, and silence reads `-inf`, which is returned as -Infinity rather than as NaN.
 */
const volumeAt = (file, at, length = 0.4, stream = 0) => new Promise((resolve, reject) => {
  execFile('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-ss', String(at), '-t', String(length), '-i', file, '-map', `0:a:${stream}`, '-af', 'volumedetect', '-f', 'null', '-'], { maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
    if (error) return reject(new Error(String(stderr || error.message)))
    const match = String(stderr).match(/mean_volume:\s*(-?[\d.]+) dB/)
    resolve(match ? Number(match[1]) : -Infinity)
  })
})

;(async () => {
  const red = await makeClip('red', 'red', 2)
  const green = await makeClip('green', 'green', 1)

  console.log('\n== a clip run at twice its speed ==')
  const sped = await stitch([red, green], 'sped.mp4', { [`${red}#0`]: { speed: 2, interpolation: 'sampling' } })
  check('the export is the timeline length, not the sources\' own', Math.abs(await secondsOf(sped) - 2) < 0.2, true)
  check('and holds the frames that length at 30 fps', Math.abs(await framesOf(sped) - 60) <= 2, true)
  check('the sped picture is still there', await colourAt(sped, 0.4), 'red')
  // The join moved with the sped clip: the red clip is two source seconds and ONE timeline second, so a
  // second in is already the green one. A speed that shortened the picture without moving the cut would
  // show red here.
  check('and the cut after it lands where the sped length puts it', await colourAt(sped, 1.4), 'green')
  check('the sound was retimed beside the picture rather than dropped', await hasAudio(sped), true)

  console.log('\n== and a clip at its own speed is untouched ==')
  const plain = await stitch([red, green], 'plain.mp4', undefined)
  check('the export runs the whole of both clips', Math.abs(await secondsOf(plain) - 3) < 0.2, true)
  check('with every frame they had', Math.abs(await framesOf(plain) - 90) <= 2, true)
  check('the first clip is still on screen a second in', await colourAt(plain, 1.4), 'red')
  check('and the second after the cut at two', await colourAt(plain, 2.4), 'green')

  console.log('\n== a slow clip takes longer ==')
  const slow = await stitch([red, green], 'slow.mp4', { [`${red}#0`]: { speed: 0.5, interpolation: 'sampling' } })
  check('half speed runs the clip twice as long', Math.abs(await secondsOf(slow) - 5) < 0.3, true)
  check('so the cut after it moves out to four seconds', await colourAt(slow, 3.4), 'red')
  check('and the green one still follows it', await colourAt(slow, 4.4), 'green')

  console.log('\n== a clip read at a rate of its own ==')
  // The same red clip, whose own frames are 30 a second, READ at 15: its sixty frames now last four seconds
  // rather than two. This is the interpretation the editor draws and the encoder has to write — a rate of the
  // clip's own retimes it exactly as a speed does, by the ratio between that rate and the source's own.
  const reread = await stitch([red, green], 'reread.mp4', undefined, { [`${red}#0`]: { num: 15, den: 1 } })
  check('a 30fps clip read at 15fps runs twice as long', Math.abs(await secondsOf(reread) - 5) < 0.3, true)
  check('and holds the frames that length at 30 fps', Math.abs(await framesOf(reread) - 150) <= 3, true)
  check('the cut after it lands where the longer length puts it', await colourAt(reread, 3.4), 'red')
  check('and the green one still follows it', await colourAt(reread, 4.4), 'green')
  check('the sound was retimed beside the picture', await hasAudio(reread), true)

  console.log('\n== a rate of its own and a speed compose ==')
  // Fifteen fps of a thirty fps source is half speed; a speed of two on top of it is the identity — so the
  // export is the source's own length, and this is what says the two fold together rather than replacing
  // one another.
  const composed = await stitch([red, green], 'composed.mp4', { [`${red}#0`]: { speed: 2, interpolation: 'sampling' } }, { [`${red}#0`]: { num: 15, den: 1 } })
  check('half a rate and double a speed come back to the source length', Math.abs(await secondsOf(composed) - 3) < 0.25, true)
  check('so the cut is where it always was', await colourAt(composed, 1.4), 'red')

  console.log('\n== a caption reaches the finished file ==')
  // THE CAPTIONS ARE THE JOB'S, not a sidecar: the engine writes them into the file it just encoded. The two
  // clips' cues are in their own SOURCE seconds — 0.5 to 1.5 in the red one, 0.2 to 0.8 in the green one —
  // and on the joined timeline the green caption therefore has to be 2.2 to 2.8, which is what says the cue
  // followed its clip rather than staying where it was in its own file.
  const tracks = {
    [red]: { path: `${red}.srt`, format: 'srt', cues: [{ start: 0.5, end: 1.5, text: 'red line' }] },
    [green]: { path: `${green}.srt`, format: 'srt', cues: [{ start: 0.2, end: 0.8, text: 'green line' }] },
  }
  const captioned = await stitch([red, green], 'captioned.mp4', undefined, undefined, { subtitles: tracks })
  check('an mp4 carries its captions as mov_text', await subtitleCodecOf(captioned), 'mov_text')
  check('each clip\u2019s caption sits under that clip in the join', cueTimes(await captionsOf(captioned)), [['00:00:00,500', '00:00:01,500'], ['00:00:02,200', '00:00:02,800']])
  const captionedText = await captionsOf(captioned)
  check('and the words are the words', [captionedText.includes('red line'), captionedText.includes('green line')], [true, true])
  check('the picture is still there beside them', await colourAt(captioned, 0.4), 'red')
  check('and so is the sound', await hasAudio(captioned), true)

  console.log('\n== a caption follows its clip\u2019s TRIM ==')
  // The red clip is trimmed to its second second, so a caption that was 0.5 to 1.5 in the source reaches the
  // timeline as 0 to 0.5: the part of it before the in point is CUT with the picture, not shown over it.
  const trimmedCaption = await stitch([red, green], 'captioned-trim.mp4', undefined, undefined, {
    subtitles: { [red]: tracks[red] },
    trimPoints: { [`${red}#0`]: { in: 1, out: 2 } },
  })
  check('a cue straddling the in point is cut to the part kept', cueTimes(await captionsOf(trimmedCaption)), [['00:00:00,000', '00:00:00,500']])

  console.log('\n== each container gets its own subtitle codec ==')
  const mkvCaptioned = await stitch([red, green], 'captioned.mkv', undefined, undefined, { subtitles: tracks, preset: { ...preset, container: 'mkv' } })
  check('an mkv writes srt as its own subrip', await subtitleCodecOf(mkvCaptioned), 'subrip')
  check('with the same times', cueTimes(await captionsOf(mkvCaptioned)), [['00:00:00,500', '00:00:01,500'], ['00:00:02,200', '00:00:02,800']])
  const webmCaptioned = await stitch([red, green], 'captioned.webm', undefined, undefined, { subtitles: tracks, preset: { ...preset, container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' } })
  check('a webm writes webvtt', await subtitleCodecOf(webmCaptioned), 'webvtt')
  check('and reads back as the same cues', cueTimes(await captionsOf(webmCaptioned)), [['00:00:00,500', '00:00:01,500'], ['00:00:02,200', '00:00:02,800']])

  console.log('\n== and a container that takes none says nothing ==')
  const soundOnly = await stitch([red, green], 'captioned.mp3', undefined, undefined, { subtitles: tracks, preset: { ...preset, container: 'mp3', outputMode: 'audio', videoCodec: 'copy', audioCodec: 'mp3' } })
  check('an mp3 carries no subtitle stream rather than failing', await subtitleCodecOf(soundOnly), '')
  const captionless = await stitch([red, green], 'no-captions.mp4', undefined, undefined, {})
  check('a job with no captions is the file it always was', [await subtitleCodecOf(captionless), await colourAt(captionless, 1.4)], ['', 'red'])

  console.log('\n== a caption BURNED into the picture ==')
  // BURN-IN is a filter on the video chain, and the only proof of it is the frame: a red clip carries no pale pixel
  // unless the words are drawn into it. The pair of runs is the distinction that matters — the same job without the
  // switch writes a subtitle stream and leaves every frame red.
  const burning = { [red]: { path: `${red}.srt`, format: 'srt', cues: [{ start: 0, end: 2, text: 'BURNED CAPTION' }] } }
  const burned = await stitch([red], 'burned.mp4', undefined, undefined, { subtitles: burning, preset: { ...preset, captionBurnIn: true } })
  check('a burned job writes NO soft subtitle stream', await subtitleCodecOf(burned), '')
  check('and the words are lit into the picture', (await whiteBottomPixels(burned, 1)) > 50, true)
  const notBurned = await stitch([red], 'not-burned.mp4', undefined, undefined, { subtitles: burning })
  check('the same job without burn-in writes the stream instead', await subtitleCodecOf(notBurned), 'mov_text')
  check('and leaves the picture red', (await whiteBottomPixels(notBurned, 1)) < 5, true)
  // A COPIED picture has no frames to draw into, so the burn is refused and the soft stream is the fallback rather
  // than a job that fails or a caption that vanishes. The window disables the switch for the same reason.
  const copied = await stitch([red], 'copy-captioned.mp4', undefined, undefined, { subtitles: burning, preset: { ...preset, videoCodec: 'copy', captionBurnIn: true } })
  check('a copied picture falls back to the soft stream rather than losing the caption', await subtitleCodecOf(copied), 'mov_text')

  console.log('\n== a track moved along its lane ==')
  // A STACKED track may begin anywhere, so the output has to run to the PLACE PLUS THE CLIP and the sound has to be
  // heard from that instant. A one-second tone at four seconds under a two-second picture: the file runs to five, is
  // silent at three, and carries the tone at four point two.
  const tone = path.join(work, 'tone.wav')
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', tone])
  const moved = await runTask('moved.mp4', { type: 'multitrack', sourcePaths: [red], additionalAudioTracks: [{ id: 't1', path: tone, language: 'und', offset: 4 }] })
  check('the export runs to the moved track\u2019s end', Math.abs(await secondsOf(moved) - 5) < 0.25, true)
  // The track's own stream is the second one: SEPARATE is the layout here, so the main lane's sound and the track's
  // are two streams of the output and it is the TRACK's that has to be silent and then heard.
  check('nothing is heard where the lane is still empty', (await volumeAt(moved, 3, 0.4, 1)) < -60, true)
  check('and the track is heard from its own offset', (await volumeAt(moved, 4.2, 0.4, 1)) > -40, true)
  const inPlace = await runTask('in-place.mp4', { type: 'multitrack', sourcePaths: [red], additionalAudioTracks: [{ id: 't1', path: tone, language: 'und' }] })
  check('a track with no offset is heard at zero, as it always was', (await volumeAt(inPlace, 0.2, 0.4, 1)) > -40, true)
  check('and its lane is no longer than the picture', Math.abs(await secondsOf(inPlace) - 2) < 0.25, true)

  console.log(failures === 0 ? '\nCLIP SPEED MATCHES THE EXPORT\n' : `\n${failures} CLIP SPEED CHECK(S) FAILED\n`)
  fs.rmSync(work, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
})().catch((error) => { console.error(error); fs.rmSync(work, { recursive: true, force: true }); process.exit(1) })
