// Publishes the built release — and refuses to publish one that is incomplete.
//
// WHY THIS IS A SCRIPT RATHER THAN A COMMAND TYPED EACH TIME. Uploading a 106 MB disk image is the one step of a
// release that fails for reasons outside this repository. MEASURED, on this machine, on the upload that prompted
// this: `{"message":"Upload body timed out due to inactivity"}` with 4.6 MB of 106 MB sent at 108 KB/s, while a
// 4 MB probe to Cloudflare managed 22 KB/s. A HALF-PUBLISHED RELEASE IS WORSE THAN A LATE ONE: every reader's
// update check would offer it, and the download would have no disk image to fetch. So the release is created as a
// DRAFT, the assets are uploaded, and it becomes public ONLY once all of them are there. Re-running this script IS
// the retry: it finds the draft, uploads whatever is missing, and publishes when the set is complete.
//
//   npm run publish:release                  notes from .release-notes.md when that file exists
//   npm run publish:release -- --notes ./x   notes from another file
//
// The token comes from the git credential helper, never from a file in the tree, and reaches curl on STDIN rather
// than on its command line, so it is not readable from the process list while an upload runs.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPO = 'desillusionist/Stitch-Up-Media'
const root = path.join(__dirname, '..')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const tag = `v${version}`

const notesArgument = process.argv.indexOf('--notes')
const notesFile = notesArgument >= 0 ? process.argv[notesArgument + 1] : path.join(root, '.release-notes.md')
const notes = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : ''

const token = (execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
}).toString().split('\n').find((line) => line.startsWith('password=')) || '').slice('password='.length)
if (!token) {
  console.error('No GitHub credential in the helper, so nothing can be published.')
  process.exit(1)
}

const api = async (pathname, init = {}) => fetch(`https://api.github.com/repos/${REPO}${pathname}`, {
  ...init,
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'stitch-up-media', ...(init.headers || {}) },
})

/** The four artifacts a release carries, in the order they are uploaded — small ones first, so a slow link fails last. */
const artifacts = [
  `Stitch Up Media-${version}-arm64.dmg.blockmap`,
  `Stitch Up Media-${version}-arm64-mac.zip.blockmap`,
  `Stitch Up Media-${version}-arm64.dmg`,
  `Stitch Up Media-${version}-arm64-mac.zip`,
].map((file) => ({
  file: path.join(root, 'release', file),
  // A release asset's name is the dot-separated form this repository has always published under.
  name: file.replace(/ /g, '.'),
}))

const missing = artifacts.filter((artifact) => !fs.existsSync(artifact.file))
if (missing.length) {
  console.error(`Nothing to publish: ${missing.map((artifact) => path.basename(artifact.file)).join(', ')} is not in release/. Run \`npm run dist\` first.`)
  process.exit(1)
}

const main = async () => {
  // A DRAFT IS INVISIBLE TO THE TAG LOOKUP — `GET /releases/tags/<tag>` answers 404 for one, which is how a re-run
  // of this script created a SECOND draft for the same version instead of resuming the first. So the tag is asked
  // for first, and the full list (which does include drafts, to a token with push access) is searched when that
  // misses. One version, one release, however many times an upload is retried.
  let release = await api(`/releases/tags/${tag}`)
  if (release.status === 404) {
    const listed = await api('/releases?per_page=50')
    if (!listed.ok) throw new Error(`listing the releases: ${listed.status} ${await listed.text()}`)
    const match = (await listed.json()).find((candidate) => candidate.tag_name === tag)
    if (match) {
      // The answer is a RELEASE rather than a status, so it is wrapped the way the tag lookup answers one.
      release = { ok: true, status: 200, json: async () => match }
      console.log(`resuming the existing ${match.draft ? 'draft' : 'release'} for ${tag} (id ${match.id})`)
    }
  }
  if (release.status === 404) {
    const created = await api('/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, name: `Stitch Up Media ${version}`, draft: true, prerelease: false, body: notes }),
    })
    if (!created.ok) throw new Error(`creating the release: ${created.status} ${await created.text()}`)
    release = created
    console.log(`created ${tag} as a DRAFT`)
  } else if (!release.ok) {
    throw new Error(`reading the release: ${release.status} ${await release.text()}`)
  }
  const record = await release.json()
  console.log(`${tag} (id ${record.id}) is ${record.draft ? 'a draft' : 'published'} with ${record.assets.length} asset(s)`)

  // A draft is the only state this script leaves a release in until the set is complete, including one that was
  // already published by hand: a published release missing its disk image is the failure this exists to prevent.
  let publishedNow = record
  if (!record.draft) {
    const pulled = await api(`/releases/${record.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: true }) })
    publishedNow = await pulled.json()
    console.log('pulled back to a DRAFT while the assets are checked')
  }

  const have = new Set((publishedNow.assets || []).map((asset) => asset.name))
  const failed = []
  for (const artifact of artifacts) {
    if (have.has(artifact.name)) { console.log(`  present  ${artifact.name}`); continue }
    const started = Date.now()
    try {
      const output = execFileSync('/usr/bin/curl', [
        '-sS', '--fail', '--http1.1', '--max-time', '1800', '--config', '-', '-X', 'POST', '-o', '/dev/null',
        '--data-binary', `@${artifact.file}`,
        `https://uploads.github.com/repos/${REPO}/releases/${publishedNow.id}/assets?name=${encodeURIComponent(artifact.name)}`,
        '-w', 'sent=%{size_upload} speed=%{speed_upload}',
      ], {
        // The token goes in on stdin, so it never appears in the process list while an upload is running.
        input: `header = "Authorization: Bearer ${token}"\nheader = "Accept: application/vnd.github+json"\nheader = "User-Agent: stitch-up-media"\nheader = "Content-Type: application/octet-stream"\n`,
        encoding: 'utf8',
      })
      const seconds = Math.round((Date.now() - started) / 1000)
      console.log(`  uploaded ${artifact.name} in ${seconds}s (${output.trim()})`)
    } catch (error) {
      const detail = String(error.stderr || error.message).trim().slice(0, 200)
      console.error(`  FAILED   ${artifact.name} after ${Math.round((Date.now() - started) / 1000)}s: ${detail}`)
      failed.push(artifact.name)
    }
  }

  if (failed.length) {
    console.error(`\n${failed.length} ASSET(S) MISSING — ${tag} is left as a DRAFT, so no update check offers it.\nRe-run \`npm run publish:release\` when the link is free; it uploads only what is missing.\n`)
    process.exit(1)
  }

  const published = await api(`/releases/${publishedNow.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: false, body: notes || undefined }),
  })
  if (!published.ok) throw new Error(`publishing: ${published.status} ${await published.text()}`)
  console.log(`\npublished ${tag}`)

  // The app's own check, anonymously: the same request every reader's copy makes. The endpoint is cached for about a
  // minute, so a miss here is not treated as a failure — the release is public either way.
  const check = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `stitch-up-media/${version}` } })
  const latest = check.ok ? await check.json() : null
  if (latest?.tag_name === tag) {
    const dmg = (latest.assets || []).find((asset) => asset.name.endsWith('.dmg'))
    console.log(`the anonymous check resolves ${tag}${dmg ? ` and its disk image (${dmg.size} bytes)` : ' with NO disk image'}`)
  } else {
    console.log(`the anonymous check still answers ${latest?.tag_name ?? check.status} — the endpoint caches for about a minute`)
  }
}

main().catch((error) => { console.error('PUBLISH FAILED', error.message); process.exit(1) })
