// Renders a QUEUE card in a real page and reports what it drew and WHERE it put it.
//
// The queue had no render coverage at all: `check-mount` mounts the EDIT JOB window, `measure` measures
// hand-written markup, and `verify` is arithmetic — so a card that set its filename at the wrong size, or ran a
// divider short of the card's edge, or put the status in the wrong corner, could only be found by looking at it.
// This is where looking is replaced by measuring. It bundles a tiny entry that mounts `TaskCard` with a stubbed
// bridge, expands it, and reports the geometry; the checks below say what the numbers have to be.
//
// Run with `npm run check-queue`.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const entry = path.join(__dirname, 'queueMountEntry.tsx')
const bundle = path.join(__dirname, '.queue-mount.js')
const cssPath = path.join(root, 'dist', 'assets')

execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [entry, '--bundle', '--format=iife', '--platform=browser', '--jsx=automatic', '--loader:.css=empty', '--define:process.env.NODE_ENV="development"', `--outfile=${bundle}`, '--log-level=warning'], { stdio: 'inherit' })

// The built stylesheet, so the render is laid out as the app lays it out rather than as an unstyled page.
const css = fs.existsSync(cssPath)
  ? fs.readdirSync(cssPath).find((name) => name.endsWith('.css'))
  : undefined
const style = css ? `<link rel="stylesheet" href="${path.join(cssPath, css)}">` : ''

const htmlPath = path.join(__dirname, '.queue-mount.html')
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8">${style}</head><body><script>${fs.readFileSync(bundle, 'utf8')}</script></body></html>`, 'utf8')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 900, show: false })
  await win.loadFile(htmlPath)
  const deadline = Date.now() + 60000
  let done = false
  while (!done && Date.now() < deadline) {
    done = await win.webContents.executeJavaScript('Boolean(window.__QUEUE_DONE)')
    if (!done) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const result = await win.webContents.executeJavaScript('window.__QUEUE_RESULT')
  const problems = []
  const drawn = result && result.drawn
  if (!result) problems.push('the page never reported anything')
  else {
    if (!done) problems.push('the card never finished drawing')
    if (!drawn || !drawn.card) problems.push('no card was drawn at all')
    if (!drawn || !drawn.sources || !drawn.sourceName) problems.push('the card drew no source rows to compare the output row against')
    if (!drawn || !drawn.output || !drawn.outputName || !drawn.outputRow) problems.push('the card drew no output row')
    if (!drawn || !drawn.preset) problems.push('the card drew no preset badge')
    if (!drawn || !drawn.status) problems.push('the card drew no status')

    // THE OUTPUT LABEL, uppercased.
    if (result.labels?.output !== 'OUTPUT:') problems.push(`the output row is labelled ${JSON.stringify(result.labels?.output)} rather than OUTPUT:`)

    // THE TYPE the filename is set in. The row sits OUTSIDE the box that set the source rows' size, so a name
    // left to inherit is set at the card's own — which is the whole of the fault.
    if (result.type?.output !== result.type?.source) problems.push(`the output filename is set at ${JSON.stringify(result.type?.output)} where a source's own name is set at ${JSON.stringify(result.type?.source)}`)

    // AND IT CRAWLS WHEN IT DOES NOT FIT: a track to run on, the class that starts it, and a fixture that really
    // overruns — without the last, the first two would pass on a name with nothing to crawl about.
    if (!result.crawling?.hasTrack) problems.push('the output name has no track to crawl on')
    if (!result.crawling?.overflow) problems.push('the fixture output name did not overrun its column, so nothing was tested')
    if (!result.crawling?.armed) problems.push('an overrun output name was not marked as cropped, so it never crawls')

    // THE DIVIDERS reach the card's own right margin.
    const edges = result.edges
    const marginRight = edges && edges.card ? edges.card.right - edges.cardPadding : null
    if (!edges || !edges.sources || !edges.card) problems.push('the card or the sources panel was not measured')
    else if (Math.abs(edges.sources.right - marginRight) > 1) problems.push(`the sources panel stops at ${edges.sources.right} where the card's margin is at ${marginRight}`)

    // THE PRESET above the panel's TOP divider, in the same top-right corner; and the STATUS under the output
    // row, at the bottom-right.
    const order = result.order
    if (!order || !order.preset || !order.sources) problems.push('the preset was not measured against the panel')
    else {
      if (!(order.preset.bottom <= order.sources.top + 0.5)) problems.push(`the preset badge stands at ${order.preset.bottom} rather than above the panel's top edge at ${order.sources.top}`)
      if (Math.abs(order.preset.right - marginRight) > 1) problems.push(`the preset badge ends at ${order.preset.right} rather than at the card's margin, ${marginRight}`)
    }
    if (!order || !order.outputRow || !order.status) problems.push('the status was not measured against the output row')
    else {
      if (!(order.status.top >= order.outputRow.bottom - 0.5)) problems.push(`the status stands at ${order.status.top} rather than under the output row, which ends at ${order.outputRow.bottom}`)
      if (Math.abs(order.status.right - marginRight) > 1) problems.push(`the status ends at ${order.status.right} rather than at the card's margin, ${marginRight}`)
    }

    if (result.errors && result.errors.length) problems.push(...result.errors.map((error) => 'the page threw: ' + error))
  }
  console.log(JSON.stringify(result, null, 2))
  fs.unlinkSync(htmlPath)
  fs.unlinkSync(bundle)
  if (problems.length) {
    console.error(`\n${problems.length} CARD PROBLEM(S)\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`)
  } else {
    console.log('\nTHE CARD OFFERS ITS OUTPUT AND HOLDS ITS MARGINS\n')
  }
  app.exit(problems.length ? 1 : 0)
}).catch((error) => { console.error('HARNESS FAILED', error); app.exit(1) })
