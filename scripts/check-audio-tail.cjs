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

/** One pixel of the frame at a time, as three numbers: what the picture there actually is. */
const pixelAt = async (file, time) => {
  const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'crop=2:2:10:10,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
  return [raw[0], raw[1], raw[2]]
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
      name: 'a still cover under a longer track',
      task: {
        id: 'tail-still', type: 'multitrack', status: 'pending', progress: 0,
        sourcePaths: [still],
        additionalAudioTracks: [{ id: 't1', path: audio, language: 'und' }],
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
  ]

  for (const item of cases) {
    console.log(`\n== ${item.name} ==`)
    try {
      await encode(item.task)
    } catch (error) {
      console.log(`  FAIL the encode failed: ${String(error.message).split('\n')[0]}`)
      failures.push(item.name)
      continue
    }
    const seconds = Number(await probeValue(item.output, 'format=duration'))
    check(item.muted ? 'a muted track does not lengthen the output' : 'the output runs to the length of its sound', seconds, item.expectedSeconds)
    const picture = await pixelAt(item.output, item.pictureSeconds)
    check('the visual is still a picture where it plays', isPicture(picture), true)
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
