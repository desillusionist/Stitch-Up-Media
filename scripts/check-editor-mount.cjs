// Renders the EDIT JOB window in a real page and reports whether it drew.
//
// The rest of the suite checks arithmetic and pixels; this checks that the window renders at all,
// which is the one thing none of them could see. It bundles a tiny entry that mounts EditJobApp with
// a stubbed bridge, feeds it a task, and reports what ended up in the DOM: the waiting message before
// the task arrives, and the editor after it. A hook called a different number of times on different
// renders throws inside React, the subtree is unmounted, and both of those come back wrong.
//
// Run with `npm run check-mount`. React is bundled in its DEVELOPMENT build on purpose: it is this
// harness's job to say what is wrong when the window does not draw, and the development build says
// it in words where the production one only throws.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const entry = path.join(__dirname, 'editorMountEntry.tsx')
const bundle = path.join(__dirname, '.editor-mount.js')
const cssPath = path.join(root, 'dist', 'assets')

execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [entry, '--bundle', '--format=iife', '--platform=browser', '--jsx=automatic', '--loader:.css=empty', '--define:process.env.NODE_ENV="development"', `--outfile=${bundle}`, '--log-level=warning'], { stdio: 'inherit' })

// The built stylesheet, so the render is laid out as the app lays it out rather than as an unstyled
// page. Its name carries a hash, so it is found rather than assumed.
const css = fs.existsSync(cssPath)
  ? fs.readdirSync(cssPath).find((name) => name.endsWith('.css'))
  : undefined
const style = css ? `<link rel="stylesheet" href="${path.join(cssPath, css)}">` : ''

const htmlPath = path.join(__dirname, '.editor-mount.html')
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8">${style}</head><body><script>${fs.readFileSync(bundle, 'utf8')}</script></body></html>`, 'utf8')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1320, height: 840, show: false })
  await win.loadFile(htmlPath)
  // The mounts are on timers of their own, so this waits for the page to say it is finished rather
  // than for a fixed figure that would have to be raised whenever the render does more work.
  const deadline = Date.now() + 20000
  let done = false
  while (!done && Date.now() < deadline) {
    done = await win.webContents.executeJavaScript('Boolean(window.__MOUNT_DONE)')
    if (!done) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const result = await win.webContents.executeJavaScript('window.__MOUNT_RESULT')
  const rendered = result && result.rendered
  const problems = []
  if (!result) problems.push('the page never reported anything')
  else {
    if (!result.waiting) problems.push('the waiting state before a task drew nothing at all')
    if (!done) problems.push('the render after the task never finished')
    if (!rendered || !rendered.header) problems.push('the editor header was not drawn')
    if (!rendered || !rendered.timeline) problems.push('the timeline was not drawn')
    if (!rendered || !rendered.monitor) problems.push('the monitor was not drawn')
    if (!rendered || !rendered.settings) problems.push('the export settings were not drawn')
    if (!rendered || rendered.clips < 1) problems.push('the timeline drew no clip for its one source')
    if (result.errors && result.errors.length) problems.push(...result.errors.map((error) => 'the page threw: ' + error))
  }
  console.log(JSON.stringify(result, null, 2))
  fs.unlinkSync(htmlPath)
  fs.unlinkSync(bundle)
  if (problems.length) {
    console.error(`\n${problems.length} MOUNT PROBLEM(S)\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`)
  } else {
    console.log('\nTHE EDITOR WINDOW RENDERS\n')
  }
  app.exit(problems.length ? 1 : 0)
}).catch((error) => { console.error('HARNESS FAILED', error); app.exit(1) })
