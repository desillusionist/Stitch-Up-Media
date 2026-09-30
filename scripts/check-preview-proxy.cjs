// Builds a preview proxy for a source the webview cannot decode, and reads back what it made.
//
// DXV is the codec this exists for, but FFMPEG HAS NO DXV ENCODER — it is decode-only — so a DXV fixture
// cannot be made here and the test is gated on a real sample. ProRes stands in for it: it is the same kind of
// case, a codec FFMPEG writes and reads and a `<video>` will not touch, so the decision, the transcode and the
// cache are all exercised by the same code path the DXV route takes.
//
// What is asserted: the source's own SIZE and RATE come through unchanged (a proxied frame is the source's
// frame, which is what keeps a trim point and a frame index meaning the same thing), the result is H.264 at
// 4:2:0, a second ask is answered from the cache rather than rebuilt, and a source the webview CAN play is
// handed over untouched.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { previewProxyFor, readProxyCache } = require('./.previewProxy.cjs')

const problems = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       ${detail}`}`)
  if (!ok) problems.push(label)
}
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' })
const probe = (file, entries) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=noprint_wrappers=1', file], { encoding: 'utf8' }).trim()
const probeValue = (file, entry) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', entry, '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' }).trim())

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-up-proxy-'))
const cacheDir = path.join(root, 'cache')
const registryPath = path.join(root, 'proxies.json')
const deps = { cacheDirectory: cacheDir, saveTempNextToSource: false, registryPath, register: () => {} }

const main = async () => {
  console.log('\n== a source the webview cannot decode ==')

  // A ProRes source, 320x180 at 25fps and 4 seconds — an odd shape for nothing, just a cheap one.
  const prores = path.join(root, 'source.mov')
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=4', '-c:v', 'prores_ks', '-profile:v', '0', prores])
  const sourceProbe = probe(prores, 'stream=width,height,r_frame_rate,codec_name')
  console.log(`  the fixture: ${sourceProbe.split('\n').join(', ')}`)
  check('the fixture really is ProRes', /codec_name=prores/.test(sourceProbe), sourceProbe)

  const built = await previewProxyFor(prores, deps)
  check('a ProRes source is given a proxy', Boolean(built) && built !== prores, String(built))
  check('and it was written where the cache was told to put it', Boolean(built) && built.startsWith(cacheDir), String(built))
  // Named after the source, because the frame-accurate helper titles its window with the file it is handed.
  check('and it is named after the source', Boolean(built) && path.basename(built) === 'source.mp4', path.basename(String(built)))

  const madeProbe = probe(String(built), 'stream=width,height,r_frame_rate,codec_name,pix_fmt')
  console.log(`  the proxy:   ${madeProbe.split('\n').join(', ')}`)
  check('the proxy is H.264', /codec_name=h264/.test(madeProbe), madeProbe)
  check('at 4:2:0, which is what every Chromium build reads', /pix_fmt=yuv420p/.test(madeProbe), madeProbe)
  // The two properties that must not move: the source's own size, and its own rate.
  check('the frame is the source\u2019s own size', /width=320/.test(madeProbe) && /height=180/.test(madeProbe), madeProbe)
  check('and its own rate, so a frame index still means the same frame', /r_frame_rate=25\/1/.test(madeProbe), madeProbe)
  const madeDuration = probeValue(String(built), 'format=duration')
  check('and its own length', Math.abs(madeDuration - 4) < 0.15, `${madeDuration}s against the source's 4s`)

  // Asked again: the remembered path, not a second transcode.
  const again = await previewProxyFor(prores, deps)
  check('asking again is answered from the cache', again === built, `${again} against ${built}`)
  check('and the cache holds it against the source', Object.keys(readProxyCache(registryPath)).length === 1, JSON.stringify(readProxyCache(registryPath)))

  // A source the element CAN play is handed over untouched, and nothing is written for it.
  const plain = path.join(root, 'plain.mp4')
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', plain])
  const untouched = await previewProxyFor(plain, deps)
  check('an h264 source is handed over as itself', untouched === plain, String(untouched))
  check('and nothing was written for it', Object.keys(readProxyCache(registryPath)).length === 1, JSON.stringify(readProxyCache(registryPath)))

  // Editing the source makes its proxy stale: the key is the file's size and mtime.
  fs.appendFileSync(prores, Buffer.alloc(64))
  const afterEdit = await previewProxyFor(prores, deps)
  check('editing the source asks for a new proxy', afterEdit !== built, `${afterEdit} against ${built}`)

  fs.rmSync(root, { recursive: true, force: true })
  console.log(problems.length ? `\n${problems.length} PROXY PROBLEM(S)\n` : '\nA SOURCE THE WEBVIEW CANNOT PLAY IS GIVEN A PROXY IT CAN\n')
  process.exit(problems.length ? 1 : 0)
}

main().catch((error) => { console.error('HARNESS FAILED', error); process.exit(1) })
