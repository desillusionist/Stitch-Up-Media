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
    if (item.coverArt) {
      // Artwork, which is a video stream in name only: a still stored as the file's picture rather than
      // played as a frame. The sound is the export, and the picture is the file's face.
      const carried = String(await probeValue(item.output, 'stream=codec_type')).split('\n').map((line) => line.trim()).filter(Boolean)
      check('an artwork-capable container keeps the sound', carried.includes('audio'), true)
      check('and holds the still as its artwork', await attachedPicture(item.output), '1')
      continue
    }
    if (item.coverArt) {
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
