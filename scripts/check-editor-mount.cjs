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
        for (const expected of ['TEMPLATE', 'THEME', 'COLOUR', 'BACKGROUND']) {
          if (!audio.drawnFields.some((label) => label.startsWith(expected))) problems.push(`choosing the drawing drew no ${expected} control`)
        }
      }
      // The palette, which every template reads and which is offered whatever the template is — a colour the
      // job names for itself wins over it, but a job that names none takes its own colour FROM it, so a
      // template without a colour field still has a palette behind it.
      if (!audio.themeOptions) problems.push('the drawing has no palette at all')
      else if (String(audio.themeOptions) !== 'green,amber') problems.push(`the palette offers ${JSON.stringify(audio.themeOptions)} rather than the app's two phosphors`)
      // The waveform's own knobs, which only the two waveforms take.
      if (!audio.drawnToggles) problems.push('the drawing drew no toggles at all')
      else {
        if (!audio.drawnToggles.includes('MIRROR CHANNELS')) problems.push('the waveform was offered no channel mirror')
        if (!audio.drawnToggles.includes('PROGRESS LINE')) problems.push('the waveform picture was offered no progress line')
        if (audio.drawnToggles.includes('SEGMENTED')) problems.push('the waveform was offered the bars\u2019 own segment control')
      }
      // And the tune actually reaches the encoder. The request carries the RESOLVED palette and knobs, so this
      // is what the export will be drawn with, defaults included — a knob the editor draws and never sends is
      // the same fault as a knob it holds and never draws, one level further along.
      const tuneAsk = audio.drawingStill
      if (tuneAsk) {
        if (tuneAsk.theme !== 'green') problems.push(`the still was asked for theme ${String(tuneAsk.theme)} rather than the app's green`)
        if (tuneAsk.waveScale !== 'lin' || tuneAsk.waveWeight !== 'fill' || tuneAsk.waveMirror !== false) problems.push(`the still was asked for a waveform of ${String(tuneAsk.waveScale)}/${String(tuneAsk.waveWeight)}/mirror ${String(tuneAsk.waveMirror)}`)
        if (tuneAsk.segmented !== false) problems.push(`the still was asked for segments it did not ask for: ${String(tuneAsk.segmented)}`)
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
      const ask = audio.drawingStill
      if (!ask) problems.push('the monitor never asked for a still of the drawing it was showing')
      else {
        if (String(ask.sources) !== '/tmp/track.wav') problems.push(`the monitor's still was drawn from ${JSON.stringify(ask.sources)} rather than the job's own sound`)
        if (ask.template !== 'waveform') problems.push(`the monitor's still was of ${ask.template} rather than the template chosen`)
        if (ask.background !== 'colour') problems.push(`the monitor's still sat on ${ask.background} rather than the background chosen`)
        if (ask.width !== 1920 || ask.height !== 1080) problems.push(`the monitor's still was made at ${ask.width}x${ask.height} rather than the output frame`)
      }
      if (audio.appliedPicture !== 'visualization') problems.push(`choosing the drawing sent a patch with picture source ${audio.appliedPicture} rather than the drawing, so the encoder is never asked for one`)
      // The EQ's own knobs, which exist only for the EQ. Choosing it has to bring four controls out and send
      // all four to the encoder: a knob the editor holds but never draws is the same fault one level down.
      if (!audio.eqFields) problems.push('the EQ template could not be chosen at all')
      else {
        for (const expected of ['BAR COUNT', 'AMPLITUDE', 'FREQUENCY', 'SENSITIVITY']) {
          if (!audio.eqFields.some((label) => label.startsWith(expected))) problems.push(`choosing the EQ drew no ${expected} control`)
        }
      }
      // The segments, which are the bars' own and are one level further along than a field: the LED-panel look.
      if (!audio.eqSegments || !audio.eqSegments.includes('SEGMENTED')) problems.push('the bars were offered no segment control')
      // The SCOPE's own three, and its own canvas. It is the one drawing that is a different shape inside the
      // frame, so it is the one most likely to be drawn by a path of its own — and the pole it must not miss is
      // that a sound of one channel is opened into a ring rather than drawn as a spoke, which is a branch the
      // encoder takes from a probe rather than a control at all.
      if (!audio.scopeFields) problems.push('the scope template could not be chosen at all')
      else {
        for (const expected of ['TEMPLATE', 'THEME', 'TRACE', 'DRAW']) {
          if (!audio.scopeFields.some((label) => label.startsWith(expected))) problems.push(`choosing the scope drew no ${expected} control`)
        }
        if (audio.scopeFields.some((label) => label.startsWith('MIRROR CHANNELS'))) problems.push('the scope was offered the waveform\u2019s own mirror')
      }
      const scopeAsk = audio.scopeStill
      if (!scopeAsk) problems.push('the monitor asked for no still once the scope was chosen')
      else {
        if (scopeAsk.template !== 'scope') problems.push(`the still asked for once the scope was chosen was of ${String(scopeAsk.template)}`)
        if (scopeAsk.scopeDraw !== 'line' || scopeAsk.scopeZoom !== 1 || scopeAsk.scopePersist !== 0.88) problems.push(`the scope's still was asked for ${String(scopeAsk.scopeDraw)}/${String(scopeAsk.scopeZoom)}/persistence ${String(scopeAsk.scopePersist)} rather than the defaults`)
      }
      // MIRRORED BARS shares the EQ's whole set: if the pair ever came apart, the knobs would be missing from
      // one of them and this is where it would show.
      if (!audio.mirrorFields) problems.push('the mirrored bars could not be chosen at all')
      else {
        for (const expected of ['BAR COUNT', 'AMPLITUDE', 'FREQUENCY', 'SENSITIVITY']) {
          if (!audio.mirrorFields.some((label) => label.startsWith(expected))) problems.push(`choosing the mirrored bars drew no ${expected} control, which the two bar drawings share`)
        }
        if (!audio.mirrorToggles || !audio.mirrorToggles.includes('SEGMENTED')) problems.push('the mirrored bars were offered no segment control, which the bars share')
      }
      const mirrorAsk = audio.mirrorStill
      if (!mirrorAsk || mirrorAsk.template !== 'mirrored-bars') problems.push('the monitor asked for no still of the mirrored bars')
      const eqAsk = audio.eqStill
      if (!eqAsk) problems.push('the monitor asked for no still once the EQ was chosen')
      else {
        if (eqAsk.template !== 'eq') problems.push(`the still asked for once the EQ was chosen was of ${eqAsk.template}`)
        // The figures rather than the stored settings: the request carries the RESOLVED style, so this is the
        // density and the scales the export will draw with, defaults and all.
        if (eqAsk.bars !== 64) problems.push(`the EQ's still was asked for ${eqAsk.bars} bars rather than the default density`)
        if (eqAsk.gap !== 0) problems.push(`the EQ's still was asked for a ${eqAsk.gap} pixel gap rather than none`)
        if (eqAsk.amplitude !== 'log' || eqAsk.frequency !== 'lin') problems.push(`the EQ's still was asked for its scales as ${eqAsk.amplitude}/${eqAsk.frequency}`)
      }
      // HOW the drawing is laid out. It is the whole monitor for a sound-only job, so it is given the same rule
      // the video element has — 100% of the frame it is drawn in, contain-scaled — rather than being laid out
      // at its own natural size, which is the output resolution. Without that it was drawn at whatever the
      // output happened to be and never rescaled when the panel was.
      //
      // The element itself cannot be measured here: the stub media fails to decode, and the monitor answers
      // that with its own notice before the drawing is reached, so the RULE is what this checks — it is in the
      // stylesheet either way, and it is the whole of the change.
      const rule = audio.drawingRule
      if (!rule) problems.push('the stylesheet carries no rule for a drawing still, so it is laid out at its natural size')
      else {
        if (rule.width !== '100%' || rule.height !== '100%') problems.push(`a drawing still does not fill the frame it is drawn in: ${rule.width} x ${rule.height}`)
        if (!String(rule.objectFit).includes('contain')) problems.push(`a drawing still does not contain-scale: ${rule.objectFit}`)
      }
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
