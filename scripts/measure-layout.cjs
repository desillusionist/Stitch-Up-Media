// Renders the real built stylesheet with a mock timeline and reports the measured
// positions, so marker alignment is verified in pixels rather than reasoned about.
// Run with `npm run measure`, which builds first so the CSS is current.
//
// Why it exists: the clip widths, the playhead and the cut markers are three
// separate calculations over the same durations, and they silently disagreed. A
// reader cannot tell "off by three pixels" from "correct" in the stylesheet, and
// this reports `cutVsMarker` and `cutVsPlayhead` directly.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const assets = path.join(root, 'dist', 'assets')
const css = fs.readdirSync(assets).find((file) => file.startsWith('index-') && file.endsWith('.css'))
const cssPath = path.join(assets, css)

// Mirrors the JSX: each clip carries an explicit share of the output, and the main
// lane's last-but-one clip carries the marker on its trailing edge.
const lane = (id, clips, gap, marker) => `
<div class="timeline-lane" id="${id}">
  <div class="timeline-lane-head"><button class="lane-mute">M</button><span>VIDEO 1</span></div>
  <div class="timeline-lane-track" id="track-${id}">
    ${clips.map(([name, id2, share, withMarker]) => `<div class="timeline-clip" id="${id2}" style="flex-basis:${share}%">
      <span class="timeline-clip-name">${name}</span><small>d</small>
      ${withMarker ? `<button class="boundary-add" id="${marker}"></button>` : ''}
    </div>`).join('')}
    ${gap > 0 ? `<div class="timeline-fill" style="flex-basis:${gap}%"></div>` : ''}
  </div>
</div>`

// Case A: a plain stitch. Two clips of 4s and 6s out of a 10s output.
const caseA = `
${lane('A', [['a', 'a0', 40, true], ['b', 'a1', 60, false]], 0, 'am0')}
<div class="timeline-playhead" id="aph" style="left:calc(102px + 0.4 * (100% - 102px))"></div>`

// Case B: a combo whose 4s + 6s of video is followed by a 590s audio track, so the
// output is 600s. The video clips are a fraction of a percent of the lane, which is
// the case that used to put the marker hundreds of pixels from its cut.
const caseB = `
${lane('B', [['a', 'b0', (4 / 600) * 100, true], ['b', 'b1', (6 / 600) * 100, false]], (590 / 600) * 100, 'bm0')}
${lane('B2', [['long.wav', 'b2', 100, false]], 0, '')}
<div class="timeline-playhead" id="bph" style="left:calc(102px + ${4 / 600} * (100% - 102px))"></div>`

const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${cssPath}">
</head><body><div class="edit-job-shell"><div class="editor-body"><main class="editor-main">
<section class="timeline-panel"><div class="timeline-lanes"><div class="timeline-lanes-inner" style="width:100%">
${caseA}
</div></div></section>
<section class="timeline-panel"><div class="timeline-lanes"><div class="timeline-lanes-inner" style="width:100%">
${caseB}
</div></div></section>
</main></div></div></body></html>`

const htmlPath = path.join(__dirname, '.measure.html')
fs.writeFileSync(htmlPath, page, 'utf8')

const measure = `(() => {
  const rect = (id) => { const el = document.getElementById(id); if (!el) return null; const r = el.getBoundingClientRect(); return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), center: +((r.left + r.right) / 2).toFixed(2) } }
  const glyph = (id) => { const style = getComputedStyle(document.getElementById(id), '::before'); return { inset: style.inset, margin: style.margin, width: style.width } }
  const track = rect('track-A')
  const clip0 = rect('a0')
  const marker = rect('am0')
  const playhead = rect('aph')
  const bTrack = rect('track-B')
  const bClip0 = rect('b0')
  const bMarker = rect('bm0')
  const bPlayhead = rect('bph')
  const bAudio = rect('b2')
  return {
    caseA: { trackWidth: +(track.right - track.left).toFixed(2), clip0Right: clip0.right, markerCenter: marker.center, playheadLeft: playhead.left,
      cutVsMarker: +(clip0.right - marker.center).toFixed(2), cutVsPlayhead: +(clip0.right - playhead.left).toFixed(2), glyph: glyph('am0') },
    caseB: { trackWidth: +(bTrack.right - bTrack.left).toFixed(2), clip0Right: bClip0.right, markerCenter: bMarker.center, playheadLeft: bPlayhead.left, audioRight: bAudio.right,
      cutVsMarker: +(bClip0.right - bMarker.center).toFixed(2), cutVsPlayhead: +(bClip0.right - bPlayhead.left).toFixed(2),
      laneOverflow: +(bAudio.right - bTrack.right).toFixed(2) },
  }
})()`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false })
  await win.loadFile(htmlPath)
  console.log(JSON.stringify(await win.webContents.executeJavaScript(measure), null, 2))
  fs.unlinkSync(htmlPath)
  app.quit()
}).catch((error) => { console.error('HARNESS FAILED', error); app.exit(1) })
