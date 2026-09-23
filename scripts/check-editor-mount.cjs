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
  const audio = result && result.audio
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
    // The picture settings, which are the one part of the settings that is CONDITIONAL. A section that
    // is gated has two ways to be missing and they need different answers, so what is asserted here is
    // both sides of the gate: the inputs the window derived, and what the tab drew with them. If the
    // gate says a picture container and sound-only visuals and the control is still not there, the
    // condition is not what is hiding it.
    if (!audio) problems.push('the audio job reported nothing at all')
    else {
      if (audio.gate.containerShown !== 'mp4') problems.push(`the window was on container ${audio.gate.containerShown} rather than mp4`)
      if (audio.gate.containerKind !== 'picture') problems.push(`mp4 was classified as ${audio.gate.containerKind} rather than a picture container`)
      if (String(audio.gate.visuals) !== 'audio') problems.push(`the job's visuals were classified as ${audio.gate.visuals} rather than sound`)
      if (!audio.pictureSource) problems.push('the picture source control was not drawn for a sound-only job')
      else {
        if (!audio.pictureSource.options.includes('black')) problems.push('the picture source offers no black frame')
        if (!audio.pictureSource.options.includes('visualization')) problems.push('the picture source offers no drawing')
        if (audio.pictureSource.options.includes('still')) problems.push('the picture source offers a still for a job that has none')
        if (audio.pictureSource.value !== 'black') problems.push(`a job that asks for nothing starts on ${audio.pictureSource.value} rather than a black frame`)
      }
      // Choosing the drawing has to bring its own settings out: state without a control is exactly the
      // fault this is here to catch, and it is the SAME fault one level down.
      if (!audio.drawnFields) problems.push('choosing the drawing changed nothing at all')
      else {
        for (const expected of ['TEMPLATE', 'COLOUR', 'BACKGROUND']) {
          if (!audio.drawnFields.some((label) => label.startsWith(expected))) problems.push(`choosing the drawing drew no ${expected} control`)
        }
      }
      if (audio.audioToggles.some((label) => label === 'COVER ART')) problems.push('cover art was offered for a container that holds a picture, not artwork')
      // What the drawing sits on, which is the choice this pass extended. A job with no still in it must not
      // be offered the still as a background, and must be offered the uploaded image.
      if (!audio.background) problems.push('the background control was not drawn for a drawing')
      else {
        if (!audio.background.includes('colour')) problems.push('the background offers no flat colour')
        if (!audio.background.includes('image')) problems.push('the background offers no uploaded image')
        if (audio.background.includes('still')) problems.push('the background offers the still for a job that has none')
      }
      // What the monitor DID ask for. This is the assertion rather than the picture itself on purpose: the
      // bridge here is a stub with no playable media behind it, so the monitor shows its own decode notice
      // and the still never gets a chance to be drawn — a window that could not play and one that was never
      // asked are the same thing to this harness. What CAN be checked is that the monitor asked, and asked
      // for the right thing; that the drawing is what it draws is `check-tail`'s and `verify`'s business.
      const asks = Array.isArray(audio.stillRequests) ? audio.stillRequests : []
      if (!asks.length) problems.push('the monitor never asked for a still of the drawing it was showing')
      else {
        const ask = asks[asks.length - 1]
        if (String(ask.sources) !== '/tmp/track.wav') problems.push(`the monitor's still was drawn from ${JSON.stringify(ask.sources)} rather than the job's own sound`)
        if (ask.template !== 'waveform') problems.push(`the monitor's still was of ${ask.template} rather than the template chosen`)
        if (ask.background !== 'colour') problems.push(`the monitor's still sat on ${ask.background} rather than the background chosen`)
        if (ask.width !== 1920 || ask.height !== 1080) problems.push(`the monitor's still was made at ${ask.width}x${ask.height} rather than the output frame`)
      }
      if (audio.appliedPicture !== 'visualization') problems.push(`choosing the drawing sent a patch with picture source ${audio.appliedPicture} rather than the drawing, so the encoder is never asked for one`)
      const stitch = result.stitch
      if (!stitch) problems.push('the stitch-of-sounds job reported nothing at all')
      else {
        if (stitch.gate.containerKind !== 'picture') problems.push(`mp4 was classified as ${stitch.gate.containerKind} for a stitch of sounds`)
        if (String(stitch.gate.visuals) !== 'audio,audio') problems.push(`the stitch's visuals were classified as ${stitch.gate.visuals} rather than two sounds`)
        if (!stitch.pictureSource) problems.push('the picture source control was not drawn for a stitch of sounds')
        else if (!stitch.pictureSource.options.includes('visualization')) problems.push('a stitch of sounds is offered no drawing, so it can only ever export black')
      }
      // And the opposite side of the gate. A container that holds artwork rather than frames must offer
      // COVER ART and must NOT offer a picture source; if it offered both, or neither, the two gates are
      // not actually the mirror they are meant to be.
      const cover = result.cover
      if (!cover) problems.push('the still-under-a-track job reported nothing at all')
      else {
        if (!cover.gate.takesArt) problems.push(`mp3 was judged unable to hold artwork: ${JSON.stringify(cover.gate)}`)
        if (!cover.audioToggles.includes('COVER ART')) problems.push('cover art was not offered for a still in a container that can hold it')
        if (cover.pictureSource) problems.push('a picture source was offered by a container that holds artwork rather than frames')
      }
    }
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
