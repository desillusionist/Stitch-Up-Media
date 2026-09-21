// Runs the main process's ffmpeg runner for real, and watches the event loop while it does.
//
// The runner's whole point is that it does NOT hold the event loop. That is a claim about
// concurrency rather than about output — the file ffmpeg writes is identical either way — so it
// cannot be seen in the result and has to be measured while the work is happening: a timer is left
// ticking, and the ticks that land DURING the run are the evidence.
//
// The same command is then run synchronously, as the control. A synchronous child gives the loop no
// chance to tick at all, so the two figures together say both that the runner yields and that this
// harness would notice if it stopped yielding. Without the control, "the loop kept running" could
// equally be a measurement that always reads the same.
//
// Run with `npm run verify-run`, which compiles the runner first.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runFfmpeg } = require('./.ffmpegRun.cjs')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-run-'))

let failures = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { console.log(`  ok   ${label}${typeof actual === 'number' ? ` (${actual})` : ''}`) }
  else { failures++; console.log(`  FAIL ${label}\n       got      ${a}\n       expected ${e}`) }
}

/** A command that takes long enough to be measured: five seconds of real 720p encoding. */
const encode = (out) => ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=5', '-pix_fmt', 'yuv420p', out]

/** Ticks of a 10ms timer that land while `work` is in flight. */
const ticksDuring = async (work) => {
  let ticks = 0
  const ticker = setInterval(() => { ticks++ }, 10)
  const started = Date.now()
  await work()
  const elapsed = Date.now() - started
  clearInterval(ticker)
  return { ticks, elapsed }
}

const main = async () => {
  console.log('\n== the main process keeps serving while ffmpeg runs ==')

  const asyncOut = path.join(work, 'async.mp4')
  const async = await ticksDuring(() => runFfmpeg(encode(asyncOut), 120000))
  const syncOut = path.join(work, 'sync.mp4')
  const sync = await ticksDuring(() => { execFileSync('ffmpeg', encode(syncOut), { timeout: 120000 }) })

  // Both produced the same file, which is what makes the comparison below a comparison of the two
  // ways of waiting rather than of two different jobs.
  check('the runner produced its clip', fs.existsSync(asyncOut) && fs.statSync(asyncOut).size > 0, true)
  check('and so did the synchronous control', fs.existsSync(syncOut) && fs.statSync(syncOut).size > 0, true)
  console.log(`       encoding took ${async.elapsed}ms through the runner, ${sync.elapsed}ms synchronously`)
  console.log(`       the loop ticked ${async.ticks} times during the first, ${sync.ticks} during the second`)

  // Stated against the encode's OWN duration rather than as a fixed count, so the check means the same
  // thing on a fast machine as on a slow one: a runner that lets the loop run ticks roughly once per
  // 10ms of the time it takes, and the bound allows for the loop being busy with the harness's own
  // work, for scheduling, and for a machine measured under load. A runner that HELD the loop ticks
  // none of them however long it takes, which is exactly what the control shows below.
  const wanted = Math.max(3, Math.floor(async.elapsed / 40))
  check(`the event loop kept running while the runner did (at least ${wanted})`, async.ticks >= wanted, true)
  check('while the synchronous control left it no chance at all', sync.ticks <= 2, true)

  // A command that fails rejects, so a caller's own error handling is what runs — the same terms the
  // synchronous call's throw had.
  let rejected = false
  await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', path.join(work, 'missing.mp4'), path.join(work, 'x.mp4')], 60000).catch(() => { rejected = true })
  check('a command that fails rejects', rejected, true)

  // A run past its bound is stopped rather than left behind, and a minute of 1080p60 is far past a
  // four-hundred-millisecond one. Killing it is the only way out of a decode that has genuinely
  // wedged, so the rejection is the point rather than a side effect.
  let timedOut = false
  const longOut = path.join(work, 'long.mp4')
  await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=60:duration=60', '-pix_fmt', 'yuv420p', longOut], 400).catch(() => { timedOut = true })
  check('a run past its time bound is stopped', timedOut, true)

  fs.rmSync(work, { recursive: true, force: true })
  console.log(failures === 0 ? '\nALL RUNNER CHECKS PASSED\n' : `\n${failures} RUNNER CHECK(S) FAILED\n`)
  process.exit(failures ? 1 : 0)
}

main().catch((error) => { console.error('HARNESS FAILED', error); process.exit(1) })
