import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * The update check, ported from the Sunburst Disk build.
 *
 * The shape of it is the same, because the questions are the same: compare the running version with the newest
 * published ONE RELEASE (not a version feed), then — only if the reader says so — download that release's own
 * disk image, mount it and open its Finder window, so installing is dragging the app into Applications. Nothing
 * is installed by the app itself: an unsigned build is installed by hand, and that is the one path this can
 * offer honestly.
 *
 * WHY THE DISK IMAGE AND NOT A DELTA PATCH: the app is unsigned and un-quarantined by hand (see README), so an
 * updater that replaced its own bundle would be replacing files whose code signing is already absent — and would
 * be doing it as the process being replaced. The DMG is the artifact that already exists, already is what the
 * reader installs, and a download made BY THE APP rather than by a browser arrives without the quarantine flag —
 * so the new copy launches without the Gatekeeper question the README has to teach people past.
 *
 * WHAT IS INJECTED: the fetch. Everything here is a pure function of a URL and a payload — the GitHub API call,
 * the version comparison, the asset choice, the streamed write — so the whole flow is exercised in
 * `scripts/check-update.cjs` against a fake server rather than only when a release happens to exist.
 *
 * ONE THING THE ENDPOINT CANNOT DO ON ITS OWN: GitHub answers a PRIVATE repository with 404, and an app shipped
 * to readers cannot carry a token to read one. So the release this points at has to be PUBLICLY readable — this
 * repository is public, and its releases are what the app resolves. MEASURED, both ways: while the repository was
 * private this exact call answered 404 anonymously and 200 with the maintainer's token; made public, it answers
 * 200 with the newest tag and its `.dmg`, and the asset URL downloads. If the repository is ever made private
 * again, every reader's check will honestly say it could not reach GitHub.
 */
export const UPDATE_RELEASES_API = 'https://api.github.com/repos/desillusionist/Stitch-Up-Media/releases/latest'
export const UPDATE_RELEASES_PAGE = 'https://github.com/desillusionist/Stitch-Up-Media/releases'

export interface UpdateAsset {
  url: string
  name: string
  size: number
}

export interface LatestRelease {
  version: string
  pageUrl: string
  /** The disk image to install, and nothing else: a `.zip` or a blockmap is not what the reader installs. */
  dmg: UpdateAsset | null
}

export interface UpdateProgress {
  phase: 'downloading' | 'mounting' | 'done' | 'error'
  version?: string
  received?: number
  total?: number
  mountPath?: string
  error?: string
}

/** The subset of `fetch` this module uses, so a harness can stand in for GitHub. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>

/** `v1.0.7` as `[1, 0, 7]`. Anything that is not a number counts as zero, which is an absence of a figure. */
export const versionSegments = (value: string): number[] =>
  String(value ?? '').trim().replace(/^v/i, '').split('.').map((segment) => Number.parseInt(segment, 10) || 0)

/**
 * True when `candidate` is strictly newer than `current`.
 *
 * Segment by segment and NUMERICALLY, which is the whole reason this is not a string comparison: `1.0.10` comes
 * after `1.0.9`, and reads as older than it to any comparison of text.
 */
export const isNewerVersion = (candidate: string, current: string): boolean => {
  const left = versionSegments(candidate)
  const right = versionSegments(current)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b
  }
  return false
}

/** The release payload as the app reads it. Throws where it names no version, which is not a release at all. */
export const releaseFromPayload = (payload: unknown): LatestRelease => {
  const record = payload as { tag_name?: unknown; html_url?: unknown; assets?: unknown } | null
  const tag = typeof record?.tag_name === 'string' ? record.tag_name.trim() : ''
  if (!tag) throw new Error('the latest release names no version')
  const assets = Array.isArray(record?.assets) ? record.assets : []
  const dmg = assets.reduce<UpdateAsset | null>((found, asset) => {
    if (found) return found
    const candidate = asset as { name?: unknown; browser_download_url?: unknown; size?: unknown } | null
    const name = typeof candidate?.name === 'string' ? candidate.name : ''
    const url = typeof candidate?.browser_download_url === 'string' ? candidate.browser_download_url : ''
    if (!name.toLowerCase().endsWith('.dmg') || !url) return null
    return { url, name, size: typeof candidate?.size === 'number' ? candidate.size : 0 }
  }, null)
  const page = typeof record?.html_url === 'string' && record.html_url ? record.html_url : UPDATE_RELEASES_PAGE
  return { version: tag.replace(/^v/i, ''), pageUrl: page, dmg }
}

/** The newest published release, from GitHub. Named for what it is, and bounded so a silent network ends it. */
export const fetchLatestRelease = async (fetchImpl: FetchLike, currentVersion: string, api: string = UPDATE_RELEASES_API): Promise<LatestRelease> => {
  const response = await fetchImpl(api, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `stitch-up-media/${currentVersion}` },
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  return releaseFromPayload(await response.json())
}

/** Where a downloaded release is put: the reader's Downloads folder, which is where a download belongs. */
export const downloadDestination = (downloadsDirectory: string, asset: UpdateAsset): string =>
  path.join(downloadsDirectory, path.basename(asset.name))

/**
 * Streams the release's disk image to `destination`, reporting how much has arrived.
 *
 * Streamed rather than buffered: a build of this app is well over a hundred megabytes, and holding a whole one in
 * memory to write it out again is a way to need the memory twice. The write goes to a `.part` name and is renamed
 * only once it is complete, so an interrupted download can never be mistaken for an installable disk image.
 *
 * THROUGH `pipeline` rather than by hand: a hand-rolled loop had to wait on a write stream's `drain` and step
 * around a stream destroyed before it had opened, which emitted ENOENT on an `error` event nothing was listening
 * for and took the process down. `pipeline` owns the backpressure, destroys both ends on the way out, and rejects
 * with the one error that matters.
 */
export const downloadRelease = async (options: {
  fetchImpl: FetchLike
  release: LatestRelease
  destination: string
  onProgress?: (progress: { received: number; total: number }) => void
}): Promise<string> => {
  const asset = options.release.dmg
  if (!asset) throw new Error('the release has no disk image to download')
  const response = await options.fetchImpl(asset.url, { signal: AbortSignal.timeout(30 * 60 * 1000) })
  if (!response.ok || !response.body) throw new Error(`the download answered ${response.status}`)
  const total = Number(response.headers.get('content-length')) || asset.size
  const partial = `${options.destination}.part`
  fs.mkdirSync(path.dirname(options.destination), { recursive: true })
  let received = 0
  let reportedAt = 0
  // Four reports a second is enough for a bar and cheap enough not to flood the renderer's queue.
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length
      const now = Date.now()
      if (now - reportedAt > 250) {
        reportedAt = now
        options.onProgress?.({ received, total })
      }
      done(null, chunk)
    },
  })
  try {
    // The response body is a DOM-shaped stream; `fromWeb` takes Node's own spelling of one. Same object.
    await pipeline(Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]), counter, fs.createWriteStream(partial))
  } catch (error) {
    try { fs.rmSync(partial, { force: true }) } catch { /* a half-written file that cannot be removed is still not an install */ }
    throw error
  }
  fs.renameSync(partial, options.destination)
  options.onProgress?.({ received, total: total || received })
  return options.destination
}

/**
 * Mounts the disk image without browsing and opens its Finder window, which is the one step that makes the new
 * copy installable: the app and the Applications alias side by side, as the reader's own drag would be.
 */
export const mountRelease = (dmgPath: string): Promise<string> => new Promise((resolve, reject) => {
  execFile('/usr/bin/hdiutil', ['attach', '-nobrowse', dmgPath], (error, stdout, stderr) => {
    if (error) {
      const detail = String(stderr).trim()
      reject(new Error(detail || 'the disk image could not be opened'))
      return
    }
    const mount = String(stdout)
      .split('\n')
      .map((line) => line.split('\t').pop()?.trim() || '')
      .find((field) => field.startsWith('/Volumes/'))
    if (!mount) {
      reject(new Error('the disk image did not mount'))
      return
    }
    execFile('/usr/bin/open', [mount], (openError) => (openError ? reject(openError) : resolve(mount)))
  })
})
