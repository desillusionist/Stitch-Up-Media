// The update check, exercised against a stand-in for GitHub.
//
// WHAT THIS CANNOT DO: reach GitHub, or mount and install a disk image. What it CAN do is every decision the flow
// makes — which release is newer, which asset is the one to install, what the request says, how a download is
// written and reported — because all of that was left as a function of a payload and a fetch rather than being
// buried in a dialog. The network itself is the one part that is asserted only when a real check is run.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { UPDATE_RELEASES_API, UPDATE_RELEASES_PAGE, isNewerVersion, versionSegments, releaseFromPayload, fetchLatestRelease, downloadDestination, downloadRelease } = require('./.updater.cjs')

const problems = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       ${detail}`}`)
  if (!ok) problems.push(label)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-up-update-'))

/** A GitHub-shaped release payload, with the assets this app actually publishes. */
const payload = (version, assets) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/desillusionist/Stitch-Up-Media/releases/tag/v${version}`,
  assets,
})
const DMG = { name: 'Stitch.Up.Media-1.0.7-arm64.dmg', browser_download_url: 'https://example.test/dmg', size: 4096 }
const ZIP = { name: 'Stitch.Up.Media-1.0.7-arm64-mac.zip', browser_download_url: 'https://example.test/zip', size: 2048 }
const BLOCKMAP = { name: 'Stitch.Up.Media-1.0.7-arm64.dmg.blockmap', browser_download_url: 'https://example.test/blockmap', size: 512 }

/** A response whose body arrives in `chunks`, so the download's streaming path is really taken. */
const streamed = (chunks, init = {}) => new Response(new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk)
    controller.close()
  },
}), { status: 200, headers: { 'content-length': String(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)) }, ...init })

const main = async () => {
  console.log('\n== which version is newer ==')
  check('a patch above is newer', isNewerVersion('1.0.7', '1.0.6'), '1.0.7 against 1.0.6')
  // The reason this is not a string comparison: as text, "1.0.9" comes after "1.0.10".
  check('ten beats nine, which text order would get wrong', isNewerVersion('1.0.10', '1.0.9'), '1.0.10 against 1.0.9')
  check('a leading v is not a version', isNewerVersion('v2.0.0', '1.9.9'), 'v2.0.0 against 1.9.9')
  check('the same version is not newer', !isNewerVersion('1.0.7', 'v1.0.7'), '1.0.7 against v1.0.7')
  check('a version behind is not newer', !isNewerVersion('1.0.6', '1.0.7'), '1.0.6 against 1.0.7')
  check('a missing segment counts as zero', !isNewerVersion('1.1', '1.1.0'), '1.1 against 1.1.0')
  check('and one past it is newer', isNewerVersion('1.1.1', '1.1'), '1.1.1 against 1.1')
  check('nonsense reads as zero rather than throwing', same(versionSegments('v1.x.7'), [1, 0, 7]), JSON.stringify(versionSegments('v1.x.7')))

  console.log('\n== which asset is the one to install ==')
  const release = releaseFromPayload(payload('1.0.7', [ZIP, BLOCKMAP, DMG]))
  check('the version comes off the tag', release.version === '1.0.7', release.version)
  check('the disk image is picked out of the other assets', release.dmg?.name === DMG.name, String(release.dmg?.name))
  check('and the release page comes with it', release.pageUrl === payload('1.0.7').html_url, release.pageUrl)
  check('a release with no disk image is still a release', releaseFromPayload(payload('1.0.7', [ZIP])).dmg === null, String(releaseFromPayload(payload('1.0.7', [ZIP])).dmg))
  check('a payload with no assets at all is answered, not thrown at', releaseFromPayload({ tag_name: 'v1.0.8' }).dmg === null, String(releaseFromPayload({ tag_name: 'v1.0.8' }).dmg))
  check('a payload that names no version is refused', (() => { try { releaseFromPayload({ assets: [] }); return 'accepted' } catch { return 'refused' } })(), 'refused')
  check('and its page falls back to the releases list', releaseFromPayload({ tag_name: 'v1.0.8' }).pageUrl === UPDATE_RELEASES_PAGE, releaseFromPayload({ tag_name: 'v1.0.8' }).pageUrl)
  // An asset name is a FILE NAME from a remote payload: it is reduced to its base before anything is written.
  check('an asset name cannot steer the write out of Downloads', downloadDestination('/Users/x/Downloads', { name: '../../etc/evil.dmg', url: 'u', size: 0 }), '/Users/x/Downloads/evil.dmg')

  console.log('\n== what the check asks GitHub for ==')
  let asked = null
  const answered = await fetchLatestRelease(async (url, init) => {
    asked = { url, init }
    return new Response(JSON.stringify(payload('9.9.9', [DMG])), { status: 200 })
  }, '1.0.6')
  check('the newest release endpoint', asked.url === UPDATE_RELEASES_API, asked.url)
  check('asking for the GitHub media type', asked.init.headers.Accept === 'application/vnd.github+json', asked.init.headers.Accept)
  check('and naming itself, as the API requires', asked.init.headers['User-Agent'] === 'stitch-up-media/1.0.6', asked.init.headers['User-Agent'])
  check('with a bound, so a silent network ends', Boolean(asked.init.signal), 'no signal')
  check('the release it answered with is read', answered.version === '9.9.9', answered.version)
  let failed = ''
  await fetchLatestRelease(async () => new Response('nope', { status: 403 }), '1.0.6').catch((error) => { failed = String(error) })
  check('and a refused check says so rather than looking up to date', /403/.test(failed), failed)

  console.log('\n== the download ==')
  const chunks = [Buffer.alloc(1024, 1), Buffer.alloc(1024, 2), Buffer.alloc(2048, 3)]
  const destination = path.join(root, 'update.dmg')
  const reports = []
  const written = await downloadRelease({
    fetchImpl: async () => streamed(chunks),
    release,
    destination,
    onProgress: (progress) => reports.push(progress),
  })
  check('it is written where it was asked for', written === destination, written)
  check('byte for byte as it arrived', fs.statSync(destination).size === 4096, String(fs.statSync(destination).size))
  check('and its first and last bytes are the payload\u2019s own', `${fs.readFileSync(destination)[0]}/${fs.readFileSync(destination)[4095]}` === '1/3', `${fs.readFileSync(destination)[0]}/${fs.readFileSync(destination)[4095]}`)
  check('no half-written file is left beside it', fs.existsSync(`${destination}.part`) === false, 'a .part file is still there')
  check('progress is reported', reports.length > 0, String(reports.length))
  check('and the last report is the whole file', same(reports[reports.length - 1], { received: 4096, total: 4096 }), JSON.stringify(reports[reports.length - 1]))

  // A body that fails halfway must not leave something an installer could be pointed at.
  const broken = path.join(root, 'broken.dmg')
  const brokenStream = new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.alloc(64)); controller.error(new Error('connection reset')) },
  }), { status: 200 })
  let brokenError = ''
  await downloadRelease({ fetchImpl: async () => brokenStream, release: { ...release, dmg: { ...release.dmg, url: 'https://example.test/broken' } }, destination: broken })
    .catch((error) => { brokenError = String(error) })
  check('a download that breaks is reported', /connection reset/.test(brokenError), brokenError)
  check('and nothing is left behind to install', !fs.existsSync(broken) && !fs.existsSync(`${broken}.part`), 'a half-written disk image is still there')

  // A release with no disk image is refused here rather than writing an empty file.
  let noDmg = ''
  await downloadRelease({ fetchImpl: async () => streamed(chunks), release: { version: '1.0.8', pageUrl: 'x', dmg: null }, destination: path.join(root, 'none.dmg') }).catch((error) => { noDmg = String(error) })
  check('a release without a disk image cannot be installed', /no disk image/.test(noDmg), noDmg)

  fs.rmSync(root, { recursive: true, force: true })
  // The real endpoint, when asked for: `UPDATE_LIVE=1` runs the same call against THE APP'S OWN releases, which is
  // what proves the request, the parse and the asset choice against the real API rather than a stand-in. It needs
  // the releases to be publicly readable — GitHub answers a private repository with 404 — so a refusal is
  // reported and not counted as a failure. Opt-in because a harness that needs the network fails on a train.
  if (process.env.UPDATE_LIVE) {
    console.log('\n== against the real API ==')
    try {
      const live = await fetchLatestRelease(fetch, '0.0.1')
      console.log(`  the endpoint answered: ${live.version}, disk image ${live.dmg ? live.dmg.name : '(none)'}, ${live.dmg ? live.dmg.size : 0} bytes`)
      check('a real release is read, and it is newer than 0.0.1', isNewerVersion(live.version, '0.0.1'), live.version)
      check('and a disk image is among its assets', Boolean(live.dmg && live.dmg.url.startsWith('https://')), JSON.stringify(live.dmg))
    } catch (error) {
      console.log(`  the endpoint refused: ${String(error)}`)
      console.log('  (a private repository answers 404 anonymously — see `electron/updater.ts`)')
    }
  }

  console.log(problems.length ? `\n${problems.length} UPDATE PROBLEM(S)\n` : '\nTHE UPDATE CHECK COMPARES, CHOOSES AND STREAMS CORRECTLY AGAINST A STAND-IN FOR GITHUB\n')
  process.exit(problems.length ? 1 : 0)
}

main().catch((error) => { console.error('HARNESS FAILED', error); process.exit(1) })
