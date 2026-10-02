/**
 * Every codec the PRESET list offers, put through the real encoder.
 *
 * The list is a claim: that a MOV can hold a DXV, that a Hap is a Hap, that the ProRes entries really do
 * differ by profile. Those are claims about the machine's own ffmpeg rather than about the table, and the
 * way to settle them is to export one file through the engine's own path — not a copy of its arguments —
 * and read back what came out. A choice that cannot be written is worse than a choice that is missing: it
 * is an option that fails the whole job long after the reader picked it.
 *
 * `COPY THE SOURCE` is deliberately not exercised: whether a passthrough is legal depends on the SOURCE
 * rather than on the container, which is a decision the reader makes with the file in hand.
 *
 * The still containers are exercised with a single frame, and the movie ones with a second of footage, so
 * the probe reads a file with a picture in it either way.
 *
 * Usage: node scripts/check-codec-choices.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { FFmpegEngine } = require('./.engine.cjs')
const { audioChoicesFor, codecChoicesFor } = require('./.codecChoices.cjs')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'codec-choices-'))

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message)))
    else resolve(stdout)
  })
})

/** What ffmpeg calls each codec the preset can be set to. */
const CODEC_NAME = {
  h264: 'h264', hevc: 'hevc', prores: 'prores', vp9: 'vp9', av1: 'av1',
  dxv: 'dxv', hap: 'hap', mpeg4: 'mpeg4', qtrle: 'qtrle', png: 'png', mjpeg: 'mjpeg', gif: 'gif',
}

/** Every container the list can be asked for, and whether the job it is asked with is a still. */
const CONTAINERS = ['mp4', 'mov', 'mkv', 'webm', 'gif', 'png', 'jpg']
const STILL_CONTAINERS = ['gif', 'png', 'jpg']
/**
 * The sound each container is given here, which is the sound it can actually hold.
 *
 * WebM takes Vorbis or Opus and refuses an AAC outright — "Only VP8 or VP9 or AV1 video and Vorbis or
 * Opus audio are supported" — so a WebM job with the default AAC fails on its SOUND rather than on its
 * picture, which would say nothing about the codecs under test.
 */
const audioFor = (container) => (container === 'webm' ? 'opus' : 'aac')

let failures = 0
const check = (label, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) failures++
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label}${same ? '' : `\n       got      ${JSON.stringify(actual)}\n       expected ${JSON.stringify(expected)}`}`)
}

/** One export through the engine's own path, and the codec of the picture it wrote. */
const exportWith = (source, container, choice) => new Promise((resolve, reject) => {
  const directory = path.join(work, `${container}-${choice.value}`)
  fs.mkdirSync(directory, { recursive: true })
  const outputFilename = `out.${container}`
  const still = STILL_CONTAINERS.includes(container)
  const engine = new FFmpegEngine()
  engine.runTask({
    id: `codec-${container}-${choice.value}`, type: 'transcode', status: 'pending', progress: 0,
    sourcePaths: [source], outputDirectory: directory, outputFilename,
    preset: {
      id: 'p', name: 'P', container, audioCodec: audioFor(container), resolution: 'source', outputMode: 'video',
      videoCodec: choice.videoCodec,
      ...(choice.proresProfile ? { proresProfile: choice.proresProfile } : {}),
      ...(still ? { imageOutputMode: 'still' } : {}),
    },
  }, () => {}, () => resolve(path.join(directory, outputFilename)), (error) => reject(error))
})

/** What ffmpeg calls each sound codec the preset can be set to. */
const AUDIO_NAME = { aac: 'aac', mp3: 'mp3', opus: 'opus', pcm: 'pcm_s16le', flac: 'flac' }

/** A picture codec each container accepts, so a sound can be tested without the picture failing first. */
const PICTURE_FOR = { mp4: 'h264', mov: 'prores', mkv: 'h264', webm: 'vp9' }

/** One export with a SOUND choice: a picture the container accepts, or no picture at all for a sound one. */
const exportSoundWith = (source, container, choice) => new Promise((resolve, reject) => {
  const directory = path.join(work, `sound-${container}-${choice.value}`)
  fs.mkdirSync(directory, { recursive: true })
  const outputFilename = `out.${container}`
  const soundOnly = ['mp3', 'wav', 'm4a', 'flac'].includes(container)
  const engine = new FFmpegEngine()
  engine.runTask({
    id: `sound-${container}-${choice.value}`, type: 'transcode', status: 'pending', progress: 0,
    sourcePaths: [source], outputDirectory: directory, outputFilename,
    preset: {
      id: 'p', name: 'P', container, resolution: 'source',
      videoCodec: soundOnly ? 'copy' : PICTURE_FOR[container],
      audioCodec: choice.audioCodec,
      ...(soundOnly ? { outputMode: 'audio' } : {}),
    },
  }, () => {}, () => resolve(path.join(directory, outputFilename)), (error) => reject(error))
})

/** The codec of the file's first picture, which is what says whether the choice was really written. */
const videoCodec = async (file) => {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', file])
  return String(out).trim()
}

/** And of its first sound, which is what the audio list is about. */
const audioCodec = async (file) => {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', file])
  return String(out).trim()
}

;(async () => {
  // A frame size every codec here accepts: four-by-four blocks are the strictest of them.
  const source = path.join(work, 'source.mp4')
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source])

  for (const container of CONTAINERS) {
    console.log(`\n== ${container.toUpperCase()} ==`)
    const choices = codecChoicesFor(container).filter((choice) => !choice.reason && choice.videoCodec !== 'copy')
    if (!choices.length) { check(`${container} offers something to encode with`, false, true); continue }
    for (const choice of choices) {
      const label = `${choice.value}${choice.proresProfile ? ` (${choice.proresProfile})` : ''}`
      try {
        const file = await exportWith(source, container, choice)
        check(`${container} writes ${label}`, await videoCodec(file), CODEC_NAME[choice.videoCodec])
      } catch (error) {
        failures++
        console.log(`FAIL ${container} ${label} did not export at all\n       ${String(error).split('\n')[0].slice(0, 200)}`)
      }
    }
  }

  // THE SOUND HALF. A sound codec a container refuses fails the whole job — which is what a WebM left on
  // the default AAC did, while its picture was never the problem — so every offered sound is exported
  // too, and read back.
  for (const container of CONTAINERS) {
    const choices = audioChoicesFor(container).filter((choice) => !choice.reason && choice.audioCodec !== 'copy')
    if (!choices.length) continue
    console.log(`\n== ${container.toUpperCase()} SOUND ==`)
    for (const choice of choices) {
      try {
        const file = await exportSoundWith(source, container, choice)
        check(`${container} writes ${choice.value} sound`, await audioCodec(file), AUDIO_NAME[choice.audioCodec])
      } catch (error) {
        failures++
        console.log(`FAIL ${container} ${choice.value} sound did not export at all\n       ${String(error).split('\n')[0].slice(0, 200)}`)
      }
    }
  }

  // THE GIF'S TWO SHAPES, read off the DIRECTORY rather than off the argument list: the count of files
  // is the whole question. An animation is one file written by the gif muxer; a sequence is a numbered
  // run written by image2, which is the distinction the IMAGE OUTPUT control offers. This is the engine
  // half of it — the control half is `npm run check-mount`'s business.
  console.log('\n== GIF ANIMATION vs SEQUENCE ==')
  {
    const exportGif = (mode) => new Promise((resolve, reject) => {
      const directory = path.join(work, `gif-${mode ?? 'animation'}`)
      fs.mkdirSync(directory, { recursive: true })
      const engine = new FFmpegEngine()
      engine.runTask({
        id: `gif-${mode ?? 'animation'}`, type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [source], outputDirectory: directory, outputFilename: 'out.gif',
        preset: {
          id: 'p', name: 'P', container: 'gif', audioCodec: 'copy', resolution: 'source', outputMode: 'video',
          videoCodec: 'gif', fps: 12,
          ...(mode ? { imageOutputMode: mode } : {}),
        },
      }, () => {}, () => resolve(directory), (error) => reject(error))
    })
    const animation = await exportGif(undefined)
    check('a GIF animation writes ONE file', fs.readdirSync(animation), ['out.gif'])
    check('and it is a GIF', await videoCodec(path.join(animation, 'out.gif')), 'gif')
    const sequence = await exportGif('sequence')
    const frames = fs.readdirSync(sequence).filter((name) => /^out_\d{6}\.gif$/.test(name)).sort()
    check('a GIF sequence writes a NUMBERED run rather than one file', frames.length > 1, true)
    // ONE FILE PER FRAME OF THE SOURCE, which is what a run IS and what the container's own fps must not
    // leak into: the GIF preset names 12 fps for its ANIMATION, and a run reads the frames as they come
    // rather than resampling them. The figure is read off the source rather than hard-coded, so the check
    // says the two counts agree rather than that one of them happens to be a number.
    const sourceFrames = Number(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'default=noprint_wrappers=1:nokey=1', source]))
    check('and one file per frame of the source rather than one per second of its rate', frames.length, sourceFrames)
    check('and each of them is a GIF', frames.length ? await videoCodec(path.join(sequence, frames[0])) : null, 'gif')
  }

  // THE IMAGE SETTINGS, which are the IMAGE tab's own knobs and which only a real export can settle. Every
  // figure here is read off the FILE — its bytes, its pixel format, or its own looping extension — rather
  // than off the argument list, because an option the encoder never honoured looks identical to one it did.
  console.log('\n== IMAGE SETTINGS ==')
  {
    const fileSize = (file) => fs.statSync(file).size
    const probeValue = async (file, entries) => String(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim()
    const frameCount = async (file) => Number(String(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'default=noprint_wrappers=1:nokey=1', file])).trim())
    /** One image export with extra preset fields, which is how each knob is exercised on its own. */
    const exportImage = (container, videoCodec, extra, filename) => new Promise((resolve, reject) => {
      const directory = path.join(work, `img-${container}-${filename.replace(/[^a-z0-9]/gi, '')}`)
      fs.mkdirSync(directory, { recursive: true })
      const engine = new FFmpegEngine()
      engine.runTask({
        id: `img-${container}-${filename}`, type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [source], outputDirectory: directory, outputFilename: filename,
        preset: {
          id: 'p', name: 'P', container, audioCodec: 'copy', resolution: 'source', outputMode: 'video',
          videoCodec, imageOutputMode: 'still', fps: 12, ...extra,
        },
      }, () => {}, () => resolve(path.join(directory, filename)), (error) => reject(error))
    })

    // PNG: the work setting trades TIME for SIZE and never a pixel.
    const pngFast = await exportImage('png', 'png', { pngCompression: 0 }, 'p0.png')
    const pngSmall = await exportImage('png', 'png', { pngCompression: 9 }, 'p9.png')
    check('compression 9 writes a smaller PNG than 0, and both are PNGs', [fileSize(pngSmall) < fileSize(pngFast), await probeValue(pngSmall, 'stream=codec_name')], [true, 'png'])
    // And the samples a channel is stored in.
    const eightBit = await exportImage('png', 'png', { imageBitDepth: 8 }, 'b8.png')
    const sixteenBit = await exportImage('png', 'png', { imageBitDepth: 16 }, 'b16.png')
    check('eight bits a channel is rgb24', await probeValue(eightBit, 'stream=pix_fmt'), 'rgb24')
    check('and sixteen is rgb48be', await probeValue(sixteenBit, 'stream=pix_fmt'), 'rgb48be')
    // JPEG: the one image setting that trades SIZE against the PICTURE, on a ladder that runs downwards.
    const jpegBest = await exportImage('jpg', 'mjpeg', { jpegQuality: 2 }, 'q2.jpg')
    const jpegLeast = await exportImage('jpg', 'mjpeg', { jpegQuality: 31 }, 'q31.jpg')
    check('a lower JPEG quality figure writes a LARGER file', fileSize(jpegBest) > fileSize(jpegLeast), true)
    // GIF: its loop count is read off the file's own Netscape extension, so the three modes are settled by
    // the bytes rather than by the arguments that were meant to produce them.
    const loopOf = (file) => {
      const bytes = fs.readFileSync(file)
      const at = bytes.indexOf(Buffer.from('NETSCAPE2.0'))
      return at < 0 ? null : bytes.readUInt16LE(at + 13)
    }
    const once = await exportImage('gif', 'gif', { imageOutputMode: undefined, gifMode: 'regular' }, 'once.gif')
    const forever = await exportImage('gif', 'gif', { imageOutputMode: undefined, gifMode: 'loop' }, 'forever.gif')
    check('ONCE writes no looping extension at all', loopOf(once), null)
    check('and LOOP loops for ever', loopOf(forever), 0)
    // SINGLE FRAME for the animated format: one file, holding one frame rather than an animation.
    const single = await exportImage('gif', 'gif', {}, 'single.gif')
    check('a single-frame GIF is one file', fs.readdirSync(path.dirname(single)), ['single.gif'])
    check('and it really holds one frame', await frameCount(single), 1)
    // And SINGLE FRAME is taken at the instant it NAMES rather than at the file's first frame: two exports
    // half a second apart have to differ, which is the whole of what the seek is for. The test source is a
    // moving pattern, so a seek that did nothing would leave the two files byte-identical.
    const atStart = await exportImage('png', 'png', { stillFrameAt: 0 }, 'atstart.png')
    const atHalf = await exportImage('png', 'png', { stillFrameAt: 0.5 }, 'athalf.png')
    check('a single frame is taken at the instant it names, not the file first frame', fs.readFileSync(atStart).equals(fs.readFileSync(atHalf)), false)
    // And the DEPTH a delivery codec is written at. Ten bits is the software encoder's own pixel format;
    // eight is what every player opens and what a job that names nothing gets.
    const tenBit = await exportImage('mp4', 'h264', { imageOutputMode: undefined, videoBitDepth: 10 }, 'ten.mp4')
    const eightBitH264 = await exportImage('mp4', 'h264', { imageOutputMode: undefined, videoBitDepth: 8 }, 'eight.mp4')
    check('ten bits a sample is written as yuv420p10le', await probeValue(tenBit, 'stream=pix_fmt'), 'yuv420p10le')
    check('and eight as the delivery format', await probeValue(eightBitH264, 'stream=pix_fmt'), 'yuv420p')
  }

  // THE DEPTH A LOSSLESS SOUND IS STORED IN, read back off the file rather than off the arguments that were
  // meant to produce it: a WAV at each of its four depths and a FLAC at its two.
  console.log('\n== AUDIO DEPTH ==')
  {
    const exportDepth = (container, codec, bitDepth, filename) => new Promise((resolve, reject) => {
      const directory = path.join(work, `depth-${container}-${bitDepth}`)
      fs.mkdirSync(directory, { recursive: true })
      const engine = new FFmpegEngine()
      engine.runTask({
        id: `depth-${container}-${bitDepth}`, type: 'transcode', status: 'pending', progress: 0,
        sourcePaths: [source], outputDirectory: directory, outputFilename: filename,
        preset: {
          id: 'p', name: 'P', container, resolution: 'source', videoCodec: 'copy', audioCodec: codec,
          ...(bitDepth ? { audioBitDepth: bitDepth } : {}),
        },
      }, () => {}, () => resolve(path.join(directory, filename)), (error) => reject(error))
    })
    const depthOf = async (file) => {
      // `bits_per_sample` is what a container records and `bits_per_raw_sample` what the decoder reports, and
      // a FLAC answers the first with a zero — so the figures are collected and the largest taken rather
      // than the first read, which is the one that means something either way.
      const out = String(await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=bits_per_sample,bits_per_raw_sample', '-of', 'default=noprint_wrappers=1:nokey=1', file]))
      const depths = out.split('\n').map((line) => line.trim()).filter((entry) => /^\d+$/.test(entry)).map(Number)
      return depths.length ? Math.max(...depths) : null
    }
    check('a WAV that names no depth is sixteen bits', await depthOf(await exportDepth('wav', 'pcm', undefined, 'd16.wav')), 16)
    check('eight is eight, and unsigned in a WAV', await depthOf(await exportDepth('wav', 'pcm', 8, 'd8.wav')), 8)
    check('twenty-four is twenty-four', await depthOf(await exportDepth('wav', 'pcm', 24, 'd24.wav')), 24)
    check('and thirty-two is thirty-two', await depthOf(await exportDepth('wav', 'pcm', 32, 'd32.wav')), 32)
    check('a FLAC at twenty-four writes twenty-four', await depthOf(await exportDepth('flac', 'flac', 24, 'f24.flac')), 24)
    check('and one that names none stays sixteen', await depthOf(await exportDepth('flac', 'flac', undefined, 'f16.flac')), 16)
  }

  console.log(failures === 0 ? '\nEVERY OFFERED CODEC EXPORTS\n' : `\n${failures} CODEC(S) FAILED\n`)
  fs.rmSync(work, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
})().catch((error) => { console.error(error); fs.rmSync(work, { recursive: true, force: true }); process.exit(1) })
