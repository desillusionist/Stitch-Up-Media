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
// The REAL strip arithmetic, compiled from src/lib/filmstrip.ts by `npm run measure`. The case
// below lays a strip out from it and measures what the browser painted, so "the tile is the size
// the arithmetic said, whatever the window is doing" is a measurement rather than a reading.
const { computeFilmstrip, FILMSTRIP_CLIP_HEIGHT } = require('./.filmstrip.cjs')
// The real placement arithmetic, so the monitor's composite is measured against the figures the
// encoder is handed rather than against a layout that merely looks plausible.
const { placedSource } = require('./.sourceFit.cjs')
// The real timeline metric, so the widths measured here are the ones the timeline draws with — and
// so a case can show that resizing the window does not change a single one of them.
const { laneWidthFor, pxPerSec } = require('./.timelineScale.cjs')

/** The zoom the harness lays the timeline out at. */
const ZOOM = 1

const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

// Mirrors the JSX: the timeline is a fixed gutter of lane labels beside a scroller, each lane's
// clip is as wide as its own length at the timeline's rate, and the main lane's last-but-one clip
// carries the marker on its trailing edge. The widths are the rate's alone — the window is not
// consulted anywhere here, which is the property being measured.
const lanes = (outerId, seconds, heads, inners) => `
<div class="timeline-lanes" id="${outerId}">
  <div class="timeline-gutter" id="gutter-${outerId}">
    <div class="timeline-gutter-ruler"></div>
    ${heads}
  </div>
  <div class="timeline-scroll" id="scroll-${outerId}">
    <div class="timeline-lanes-inner" style="width:${laneWidthFor(seconds, ZOOM)}px">
      <div class="timeline-ruler"></div>
      ${inners}
    </div>
  </div>
</div>`

const lane = (id, label, clips, gapSeconds, marker) => `
<div class="timeline-lane" id="${id}" title="${label}">
  <div class="timeline-lane-track" id="track-${id}">
    ${clips.map(([name, id2, seconds, withMarker]) => `<div class="timeline-clip" id="${id2}" style="width:${laneWidthFor(seconds, ZOOM)}px">
      <span class="timeline-clip-name">${name}</span><small>d</small>
      ${withMarker ? `<button class="boundary-add" id="${marker}"></button>` : ''}
    </div>`).join('')}
    ${gapSeconds > 0 ? `<div class="timeline-fill" style="width:${laneWidthFor(gapSeconds, ZOOM)}px"></div>` : ''}
  </div>
</div>`

const head = (title) => `<div class="timeline-lane-head" id="head-${title.replace(/\W+/g, '')}"><button class="lane-mute">M</button><span>${title}</span></div>`

// Case A: a plain stitch. Two clips of 4s and 6s out of a 10s output, playhead on the cut.
const caseA = lanes('lanesA', 10,
  head('VIDEO 1'),
  `${lane('A', 'VIDEO 1', [['a', 'a0', 4, true], ['b', 'a1', 6, false]], 0, 'am0')}
<div class="timeline-playhead" id="aph" style="left:${4 * pxPerSec(ZOOM)}px"></div>`)

// Case B: a combo whose 4s + 6s of video is followed by 590s of nothing, and a 600s audio lane.
// The video clips are a fraction of a per cent of the timeline, which is the case that used to put
// the marker hundreds of pixels from its cut. It is the case with something to scroll, and so the
// one where the scrollbar's start and the gutter's own solidity can be measured.
const caseB = lanes('lanesB', 600,
  `${head('VIDEO 1')}${head('AUDIO 1')}`,
  `${lane('B', 'VIDEO 1', [['a', 'b0', 4, true], ['b', 'b1', 6, false]], 590, 'bm0')}
${lane('B2', 'AUDIO 1', [['long.wav', 'b2', 600, false]], 0, '')}
<div class="timeline-playhead" id="bph" style="left:${4 * pxPerSec(ZOOM)}px"></div>`)

// Case C: the preview overlay. A square output frame centred in a wide stage, its label
// anchored to the frame's top-left, and one crop band down the left edge. This checks the
// overlay geometry a reader cannot judge from the stylesheet. The drawing sits in the pan layer,
// exactly as the JSX puts it, so the pan can be measured moving it as one.
const caseC = `
<div class="editor-stage" id="stage" style="width:500px;height:300px">
  <div class="editor-stage-pan" id="cpan">
    <div class="editor-frame" id="cframe" style="width:200px;height:200px"><b id="clabel">OUTPUT 1080×1080</b></div>
    <div class="editor-crop-shade" id="cshade" style="left:0;top:0;width:25px;height:300px"></div>
  </div>
</div>`

// Case D: the exact-size row. Two fields that must split the space evenly and two glyph
// buttons that must sit flush with the row's trailing edge, all the same height.
const caseD = `
<div class="export-content" id="drow" style="width:300px">
  <div class="editor-field"><span>EXACT SIZE<em>OVERRIDES RESOLUTION</em></span>
    <div class="exact-row" id="exrow">
      <label class="mini-field" id="dwf"><span>W</span><input id="dw" type="number" value="1920"></label>
      <label class="mini-field" id="dhf"><span>H</span><input id="dh" type="number" value="1080"></label>
      <button class="exact-icon" id="dlock">L</button>
      <button class="exact-icon" id="dreset">R</button>
    </div>
  </div>
  <div class="editor-subsection">
    <div class="crop-head" id="chead">
      <select id="csel"><option>NONE</option><option>16:9</option></select>
      <div class="unit-toggle" id="cunit"><button id="cupct" class="is-on">%</button><button id="cupx">px</button></div>
    </div>
    <div class="crop-row" id="crow">
      <label class="mini-field"><span>L</span><input id="cl" type="number" value="10"></label>
      <label class="mini-field"><span>T</span><input type="number" value="10"></label>
      <label class="mini-field"><span>R</span><input type="number" value="10"></label>
      <label class="mini-field"><span>B</span><input type="number" value="10"></label>
    </div>
  </div>
</div>`

// Case H: the monitor's composite. A clipped window holding the picture, the output frame outline
// centred by the stylesheet, and a picture placed inside the window by the real fit arithmetic.
// What must hold: the outline and the window agree exactly (one is centred by CSS and the other by
// the JS, so a disagreement is a half-pixel of drift), and the window is fully covered whenever a
// fitted clip overflows — the property that makes the crop a crop rather than a gap.
const monitorStage = `
<div class="editor-stage" id="hstage" style="width:500px;height:300px;position:relative">
  <div class="editor-stage-pan" id="hpan">
    <div class="editor-frame-window" id="hwindow"><img id="hpicture" alt=""></div>
    <div class="editor-frame" id="hframe"><b>OUTPUT</b></div>
  </div>
</div>`

const paintMonitor = (box) => `(() => {
  const win = document.getElementById('hwindow'); const pic = document.getElementById('hpicture'); const frame = document.getElementById('hframe')
  Object.assign(win.style, { left: '${box.frameLeft}px', top: '${box.frameTop}px', width: '${box.frameWidth}px', height: '${box.frameHeight}px' })
  Object.assign(pic.style, { position: 'absolute', left: '${box.pictureLeft}px', top: '${box.pictureTop}px', width: '${box.pictureWidth}px', height: '${box.pictureHeight}px', maxWidth: 'none', maxHeight: 'none' })
  Object.assign(frame.style, { width: '${box.frameWidth}px', height: '${box.frameHeight}px' })
  return true
})()`

const readMonitor = `(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: +r.left.toFixed(2), top: +r.top.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) } }
  const win = box(document.getElementById('hwindow')); const pic = box(document.getElementById('hpicture')); const frame = box(document.getElementById('hframe'))
  // How much of the WINDOW the picture keeps, clamped to it: a picture pushed clear of the canvas
  // covers none of it and leaves the whole window as background, whichever side it went off.
  const relLeft = +(pic.left - win.left).toFixed(2), relTop = +(pic.top - win.top).toFixed(2)
  const visLeft = Math.max(0, Math.min(win.width, relLeft)), visRight = Math.max(0, Math.min(win.width, relLeft + pic.width))
  const visTop = Math.max(0, Math.min(win.height, relTop)), visBottom = Math.max(0, Math.min(win.height, relTop + pic.height))
  return {
    window: [win.width, win.height], picture: [pic.width, pic.height],
    // Where the picture was painted within the window, which is the position the arithmetic asked
    // for and must reach the screen unchanged.
    pictureVsWindow: [relLeft, relTop],
    // The outline is centred by the stylesheet and the window by these figures: the two agreeing is
    // what says the frame the user is shown IS the frame the picture was placed on.
    outlineVsWindow: [+(frame.left - win.left).toFixed(2), +(frame.top - win.top).toFixed(2), +(frame.width - win.width).toFixed(2)],
    // The background the picture leaves showing on each edge of the window.
    gapLeft: +visLeft.toFixed(2), gapRight: +(win.width - visRight).toFixed(2),
    gapTop: +visTop.toFixed(2), gapBottom: +(win.height - visBottom).toFixed(2),
    coveredWidth: +(visRight - visLeft).toFixed(2), coveredHeight: +(visBottom - visTop).toFixed(2),
  }
})()`

const filler = '<div class="editor-field"><span>FILLER</span><input value="x"></div>'

// Case G: a lane drawn as a filmstrip. The clip is the whole lane, so its width is the lane's, and
// the tiles are painted exactly as the JSX paints them: the cell's own width in pixels, from the
// plan, inside a row whose height comes from the one constant. The strips are painted by the
// harness after the page's own layout has been measured, because the count comes from the width
// the browser actually gave the clip.
/** The clip the strip case is drawn for, in seconds, so every figure below has one source. */
const FILM_SECONDS = 8
const filmLane = lanes('lanesF', FILM_SECONDS,
  head('VIDEO 1'),
  `<div class="timeline-lane" id="flane">
  <div class="timeline-lane-track"><div class="timeline-clip is-film" id="fclip" style="width:${laneWidthFor(FILM_SECONDS, ZOOM)}px"><div class="timeline-clip-film" id="ffilm"></div></div></div>
</div>`)


const filmClipWidth = `+document.getElementById('fclip').getBoundingClientRect().width.toFixed(2)`

const paintFilm = (plan) => `document.getElementById('ffilm').innerHTML = ${JSON.stringify(
  plan.frames.map(() => `<span class="timeline-clip-tile" style="width:${plan.cellWidth}px"><img src="${GIF}"></span>`).join(''),
)}`

const readFilm = `(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(2), h: +r.height.toFixed(2) } }
  const clip = document.getElementById('fclip')
  const tiles = [...document.querySelectorAll('#ffilm .timeline-clip-tile')]
  const first = tiles[0]; const last = tiles[tiles.length - 1]
  const clipBox = clip.getBoundingClientRect()
  return {
    lane: box(document.getElementById('flane')), clip: box(clip), film: box(document.getElementById('ffilm')),
    tiles: tiles.length, tile: box(first), image: box(first.querySelector('img')),
    stripLeftVsClip: +(first.getBoundingClientRect().left - clipBox.left).toFixed(2),
    stripRightVsClip: +(last.getBoundingClientRect().right - clipBox.right).toFixed(2),
  }
})()`

// Case F: a whole sidebar. The title and tab strip are its head and the buttons its foot, so
// they must stay put while the settings between them scroll. The fillers make the settings
// taller than the window, which is the only way the behaviour shows at all.
const caseF = `
<div class="export-title" id="ftitle">EXPORT SETTINGS</div>
<div class="export-tabs" id="ftabs"><button class="active">EXPORT</button><button>VIDEO</button><button>AUDIO</button><button>EFFECTS</button><button>CAPTIONS</button></div>
<div class="export-content" id="fcontent">${caseD}${filler.repeat(30)}</div>
<div class="editor-actions" id="factions"><button>CANCEL</button><button class="primary-retro">OK / APPLY</button></div>`

const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${cssPath}">
</head><body><div class="edit-job-shell"><div class="editor-body"><main class="editor-main">
<section class="timeline-panel">${caseA}</section>
<section class="timeline-panel">${caseB}</section>
<section class="timeline-panel"><div style="--filmstrip-tile:${FILMSTRIP_CLIP_HEIGHT}px">${filmLane}</div></section>
<section class="editor-preview"><div class="editor-screen">${caseC}</div></section>
<section class="editor-preview">${monitorStage}</section>
</main><aside class="export-sidebar" id="fside">${caseF}</aside></div></div></body></html>`

const htmlPath = path.join(__dirname, '.measure.html')
fs.writeFileSync(htmlPath, page, 'utf8')

const measure = `(() => {
  const rect = (id) => { const el = document.getElementById(id); if (!el) return null; const r = el.getBoundingClientRect(); return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), center: +((r.left + r.right) / 2).toFixed(2), centerY: +((r.top + r.bottom) / 2).toFixed(2), width: +(r.right - r.left).toFixed(2), height: +(r.bottom - r.top).toFixed(2) } }
  const glyph = (id) => { const style = getComputedStyle(document.getElementById(id), '::before'); return { inset: style.inset, margin: style.margin, width: style.width } }
  const track = rect('track-A')
  const clip0 = rect('a0')
  // The compact clip's own two lines. What the clip is (its name) and what it is doing (its length,
  // whether it is trimmed, its rate) are both text inside one row of a fixed height, so whether the
  // second line is inside the clip's box at all is a question only a measurement can answer.
  const textLine = (clipId, selector) => {
    const clip = document.getElementById(clipId)
    const line = clip.querySelector(selector)
    if (!line) return null
    const clipBox = clip.getBoundingClientRect()
    const lineBox = line.getBoundingClientRect()
    const style = getComputedStyle(line)
    const laneBottom = clip.closest('.timeline-lane').getBoundingClientRect().bottom
    return {
      size: style.fontSize, lineHeight: style.lineHeight,
      top: +(lineBox.top - clipBox.top).toFixed(2), bottom: +(lineBox.bottom - clipBox.top).toFixed(2),
      insideClip: lineBox.bottom <= clipBox.bottom + 0.5, insideLane: lineBox.bottom <= laneBottom + 0.5,
    }
  }
  const marker = rect('am0')
  const playhead = rect('aph')
  const bTrack = rect('track-B')
  const bClip0 = rect('b0')
  const bMarker = rect('bm0')
  const bPlayhead = rect('bph')
  const bAudio = rect('b2')
  const stage = rect('stage')
  const cframe = rect('cframe')
  const clabel = rect('clabel')
  const cshade = rect('cshade')
  const exrow = rect('exrow')
  const dw = rect('dw')
  const dh = rect('dh')
  const dlock = rect('dlock')
  const dreset = rect('dreset')
  const content = document.getElementById('fcontent')
  const fside = rect('fside')
  const scrollerB = document.getElementById('scroll-lanesB')
  /** The compact clip's two lines, measured once and read by the case and by the checks below. */
  const lineA = { name: textLine('a0', '.timeline-clip-name'), detail: textLine('a0', 'small') }
  // The pan moves the drawing and nothing else, and it moves all of it: the frame and the crop
  // band must travel together, by exactly the offset, or the crop would come off the picture.
  const pan = document.getElementById('cpan')
  pan.style.transform = 'translate(40px,-30px)'
  const moved = { frame: rect('cframe'), shade: rect('cshade'), layer: rect('cpan') }
  pan.style.transform = ''
  return {
    caseA: { trackWidth: +(track.right - track.left).toFixed(2), clip0Right: clip0.right, markerCenter: marker.center, playheadLeft: playhead.left,
      cutVsMarker: +(clip0.right - marker.center).toFixed(2), cutVsPlayhead: +(clip0.right - playhead.left).toFixed(2), glyph: glyph('am0'),
      clipHeight: clip0.height, name: lineA.name, detail: lineA.detail },
    caseB: { trackWidth: +(bTrack.right - bTrack.left).toFixed(2), clip0Right: bClip0.right, markerCenter: bMarker.center, playheadLeft: bPlayhead.left, audioRight: bAudio.right,
      cutVsMarker: +(bClip0.right - bMarker.center).toFixed(2), cutVsPlayhead: +(bClip0.right - bPlayhead.left).toFixed(2),
      laneOverflow: +(bAudio.right - bTrack.right).toFixed(2) },
    caseC: { stage: [stage.width, stage.height], frame: [cframe.width, cframe.height],
      centeredX: +(cframe.center - stage.center).toFixed(2), centeredY: +(cframe.centerY - stage.centerY).toFixed(2),
      labelVsFrameLeft: +(clabel.left - cframe.left).toFixed(2), labelVsFrameTop: +(clabel.top - cframe.top).toFixed(2),
      shadeLeft: cshade.left, shadeHeight: cshade.height,
      panLayerBox: [moved.layer.width, moved.layer.height], panMovedFrame: [+(moved.frame.left - cframe.left).toFixed(2), +(moved.frame.top - cframe.top).toFixed(2)],
      panMovedShade: +(moved.shade.left - cshade.left).toFixed(2) },
    caseD: { rowWidth: exrow.width, fieldWidths: [dw.width, dh.width], iconWidths: [dlock.width, dreset.width],
      fieldHeights: [dw.height, dh.height], iconHeights: [dlock.height, dreset.height],
      leadingFlush: +(rect('dwf').left - exrow.left).toFixed(2), trailingFlush: +(exrow.right - dreset.right).toFixed(2),
      columnGap: +(dh.left - dw.right).toFixed(2) },
    caseE: { headWidth: rect('chead').width, headHeight: rect('chead').height, selectWidth: rect('csel').width, unitWidth: rect('cunit').width, unitHeightBox: rect('cunit').height,
      headLeadingFlush: +(rect('csel').left - rect('chead').left).toFixed(2), headTrailingFlush: +(rect('chead').right - rect('cunit').right).toFixed(2),
      unitButtonWidths: [rect('cupct').width, rect('cupx').width], unitHeight: rect('cupct').height, selectHeight: rect('csel').height,
      cropRowWidth: rect('crow').width, cropFieldWidth: rect('cl').width },
    // The head must sit at the sidebar's top, the foot at its bottom, and the settings between
    // them must be scrollable: a taller content than viewport with both neighbours still in view.
    caseF: { sidebarHeight: fside.height, titleVsTop: +(rect('ftitle').top - fside.top).toFixed(2), contentVsTabs: +(rect('fcontent').top - rect('ftabs').bottom).toFixed(2),
      actionsVsSidebarBottom: +(fside.bottom - rect('factions').bottom).toFixed(2), actionsVsContent: +(rect('factions').top - rect('fcontent').bottom).toFixed(2),
      contentScrolls: content.scrollHeight > content.clientHeight + 1, contentViewport: content.clientHeight, contentFull: content.scrollHeight,
      titleStillVisible: +(fside.bottom - rect('ftitle').top).toFixed(2) >= fside.height },
    // The width a lane is drawn at, and how much of it the panel can show. One of these must move
    // when the window does and the other must not: that separation is the whole of this model.
    widths: { clip: rect('b0').width, lanes: rect('b2').width, viewport: scrollerB ? scrollerB.clientWidth : 0, content: scrollerB ? scrollerB.scrollWidth : 0 },
    // The timeline's own chrome. The label column is a column of the timeline's grid rather than a
    // sticky element inside the scroller: the scrollbar's own start and the column's solidity are
    // the two things that could not be had that way, and the rows of the two columns must still
    // line up across the gap.
    caseT: (() => {
      const outerB = rect('lanesB')
      const gutter = rect('gutter-lanesB')
      const scroll = rect('scroll-lanesB')
      const scroller = document.getElementById('scroll-lanesB')
      const lanesIn = [...document.querySelectorAll('#scroll-lanesB .timeline-lane')]
      const headsIn = [...document.querySelectorAll('#gutter-lanesB .timeline-lane-head')]
      const innerEl = document.querySelector('#scroll-lanesB .timeline-lanes-inner')
      const rulerIn = document.querySelector('#scroll-lanesB .timeline-ruler')
      const spacerIn = document.querySelector('#gutter-lanesB .timeline-gutter-ruler')
      const shapeOf = (el) => { const r = el.getBoundingClientRect(); return { top: +r.top.toFixed(2), height: +r.height.toFixed(2), left: +r.left.toFixed(2) } }
      // The two columns start together and their rows step together; the ruler and the gutter's own
      // spacer are what set the first step, so they are reported rather than assumed equal.
      const detail = {
        columnTops: [gutter.top, scroll.top],
        inner: innerEl ? shapeOf(innerEl) : null,
        ruler: rulerIn ? shapeOf(rulerIn) : null,
        spacer: spacerIn ? shapeOf(spacerIn) : null,
      }
      return {
        gutterWidth: gutter.width,
        gutterAtOuterLeft: +(gutter.left - outerB.left).toFixed(2),
        scrollerStartsPastGutter: +(scroll.left - gutter.right).toFixed(2),
        scrollbarHeight: +(scroller.offsetHeight - scroller.clientHeight).toFixed(2),
        scrollbarStartsPastGutter: +(scroll.left - gutter.right).toFixed(2),
        laneTops: lanesIn.map((el) => +el.getBoundingClientRect().top.toFixed(2)),
        headTops: headsIn.map((el) => +el.getBoundingClientRect().top.toFixed(2)),
        rowsAligned: lanesIn.length === headsIn.length && lanesIn.every((el, index) => Math.abs(el.getBoundingClientRect().top - headsIn[index].getBoundingClientRect().top) < 0.6),
        rows: [lanesIn.length, headsIn.length],
        laneHeight: lanesIn.length ? +lanesIn[0].getBoundingClientRect().height.toFixed(2) : 0,
        headHeight: headsIn.length ? +headsIn[0].getBoundingClientRect().height.toFixed(2) : 0,
        laneStartsAtScroller: +(lanesIn[0].getBoundingClientRect().left - scroll.left).toFixed(2),
        gutterCoversScroller: gutter.bottom >= scroll.bottom - 0.6,
        gutterCoversScrollbar: gutter.bottom >= scroller.getBoundingClientRect().bottom - 0.6,
        scrolls: scroller.scrollWidth > scroller.clientWidth + 1,
        detail,
      }
    })(),
    // What has to hold, said outright. Everything here is a property a reader cannot judge from the
    // stylesheet and would otherwise have to notice in a wall of numbers: a regression turns into a
    // line of output and a non-zero exit rather than into a screenshot nobody took.
    problems: [
      ...(lineA.name && lineA.name.insideLane ? [] : ['the compact clip name is outside its lane']),
      ...(lineA.detail && lineA.detail.insideLane ? [] : ['the compact clip detail line is outside its lane, at ' + (lineA.detail && lineA.detail.bottom) + ' of ' + clip0.height]),
      ...(lineA.detail && lineA.name && lineA.name.bottom <= lineA.detail.top + 0.5 ? [] : ['the compact clip two lines overlap']),
    ],
  }
})()`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false })
  await win.loadFile(htmlPath)
  /**
   * Runs a snippet in the page and reports what went wrong if it throws.
   *
   * `executeJavaScript` rejects with one generic sentence — "script failed to execute" — whether the
   * script threw a TypeError in the first line or never parsed, and the page's console is not shown
   * here either. A harness that cannot say what broke is a harness that has to be debugged by
   * guessing, so the snippet is wrapped and the error is what comes back.
   */
  const run = (script) => win.webContents.executeJavaScript(`(() => { try { return ${script} } catch (error) { return { HARNESS_ERROR: String((error && error.stack) || error) } } })()`)
  const laid = await run(measure)
  // Case H, once: the monitor's composite for a tall clip in a landscape frame, at the positions
  // that matter — centred, either end, the other axis, and with no fit at all. The stage's own box
  // is MEASURED rather than assumed, because the app reads it from an observer and centres the
  // outline by stylesheet: those two agreeing is one of the things being checked here.
  const measured = await run(`(() => { const r = document.getElementById('hstage').getBoundingClientRect(); return { width: +r.width.toFixed(2), height: +r.height.toFixed(2) } })()`)
  const stage = { width: measured.width, height: measured.height }
  const output = { width: 1920, height: 1080 }
  const source = { width: 720, height: 1280 }
  const frameWidth = Math.min(stage.width, stage.height * (output.width / output.height))
  const frameBox = { width: frameWidth, height: (frameWidth * output.height) / output.width }
  const round = (value) => Math.round(value * 1000) / 1000
  const caseH = {}
  const caseI = {}
  const monitorProblems = []
  // The positions that matter under the free X/Y model: centred (where nothing has moved), the two
  // extremes of each axis, a picture left showing bars, and one pushed clear of the canvas — which is
  // now a position rather than an error, and the case where the window shows background and nothing
  // else. The window and the outline are both derived here rather than assumed, because the app
  // centres the outline by stylesheet and the window by these figures: agreeing is the check.
  for (const [label, fit] of [
    ['none', undefined],
    ['width centred', { mode: 'width', offset: { x: 0, y: 0 } }],
    ['width moved down', { mode: 'width', offset: { x: 0, y: 0.4 } }],
    ['height centred', { mode: 'height', offset: { x: 0, y: 0 } }],
    ['height moved left', { mode: 'height', offset: { x: -0.25, y: 0 } }],
    ['pushed clear of the canvas', { mode: 'contain', offset: { x: 1.2, y: 0 } }],
  ]) {
    const place = placedSource({ source, frame: output, fit })
    const scale = frameBox.width / output.width
    const box = {
      frameLeft: round((stage.width - frameBox.width) / 2), frameTop: round((stage.height - frameBox.height) / 2),
      frameWidth: round(frameBox.width), frameHeight: round(frameBox.height),
      pictureLeft: round(place.source.x * scale), pictureTop: round(place.source.y * scale),
      pictureWidth: round(place.source.width * scale), pictureHeight: round(place.source.height * scale),
    }
    // What the screen must show, worked out here from the same figures that were painted: the picture
    // at exactly the painted size and position, and the background on whatever edge it does not
    // reach — clamped to the window, so a picture off the canvas leaves the whole of it as
    // background rather than a negative bar.
    const relLeft = box.pictureLeft, relTop = box.pictureTop
    const visLeft = Math.max(0, Math.min(box.frameWidth, relLeft)), visRight = Math.max(0, Math.min(box.frameWidth, relLeft + box.pictureWidth))
    const visTop = Math.max(0, Math.min(box.frameHeight, relTop)), visBottom = Math.max(0, Math.min(box.frameHeight, relTop + box.pictureHeight))
    const expected = {
      picture: [box.pictureWidth, box.pictureHeight],
      pictureVsWindow: [relLeft, relTop],
      gapLeft: round(visLeft), gapTop: round(visTop),
      gapRight: round(box.frameWidth - visRight), gapBottom: round(box.frameHeight - visBottom),
    }
    await run(paintMonitor(box))
    await new Promise((resolve) => setTimeout(resolve, 60))
    const shot = await run(readMonitor)
    caseH[label] = { expected, measured: shot }
    if (shot.HARNESS_ERROR) { monitorProblems.push(`the monitor could not be read for ${label}`); continue }
    const close = (a, b) => Math.abs(a - b) <= 1
    // The outline is centred by the stylesheet; the window by the arithmetic above. Half a pixel of
    // drift between them is the frame the picture was placed on being a different frame to the one
    // the user is shown, which is the whole thing this case exists to rule out.
    if (shot.outlineVsWindow.some((value) => Math.abs(value) > 0.5)) {
      monitorProblems.push(`the output outline and the picture's window disagree at ${label}: ${JSON.stringify(shot.outlineVsWindow)}`)
    }
    if (!shot.picture.every((value, axis) => close(value, expected.picture[axis]))) {
      monitorProblems.push(`the picture is not the size the fit asked for at ${label}: ${JSON.stringify(shot.picture)} of ${JSON.stringify(expected.picture)}`)
    }
    if (!shot.pictureVsWindow.every((value, axis) => close(value, expected.pictureVsWindow[axis]))) {
      monitorProblems.push(`the picture is not where the offset put it at ${label}: ${JSON.stringify(shot.pictureVsWindow)} of ${JSON.stringify(expected.pictureVsWindow)}`)
    }
    // Each edge's background, side by side, so a picture that is short on one edge and over on the
    // other cannot pass by cancelling out.
    for (const edge of ['gapLeft', 'gapTop', 'gapRight', 'gapBottom']) {
      if (!close(shot[edge], expected[edge])) {
        monitorProblems.push(`the background at the ${edge.slice(3).toLowerCase()} of ${label} is ${shot[edge]}px, not the ${expected[edge]}px the position leaves`)
      }
    }
  }
  // The strip is laid out from the width the browser gave the clip, then measured, at several
  // window sizes. What must hold: the tile is the constant tall in every one of them, the count
  // follows the width, and the cells still land exactly on the clip's far edge.
  const caseG = {}
  for (const [label, width, height] of [['1400x900', 1400, 900], ['1400x1300', 1400, 1300], ['2000x900', 2000, 900], ['900x900', 900, 900]]) {
    win.setContentSize(width, height)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const clipWidth = await run(filmClipWidth)
    // Laid out from the timeline's rate and the clip's trim — the two inputs the app uses — rather
    // than from any measured box, so the plan is a figure of the zoom alone.
    const plan = computeFilmstrip({ laneWidth: laneWidthFor(FILM_SECONDS, ZOOM), thumbHeight: FILMSTRIP_CLIP_HEIGHT, outAspect: 16 / 9, fps: 30, inSec: 0, outSec: FILM_SECONDS })
    await run(paintFilm(plan))
    await new Promise((resolve) => setTimeout(resolve, 80))
    caseG[label] = {
      clipWidth, thumbWidth: plan.thumbWidth, thumbCount: plan.thumbCount, cellWidth: +plan.cellWidth.toFixed(3),
      ...(await run(readFilm)),
    }
    // The same strip, laid out from the timeline's rate as the strip's own figure, must not move
    // either: the plan comes from the zoom and the clip's trim, so a window is not an input to it.
    caseI[label] = {
      clip: +(await run(`+document.getElementById('b0').getBoundingClientRect().width.toFixed(2)`)),
      lane: +(await run(`+document.getElementById('b2').getBoundingClientRect().width.toFixed(2)`)),
      viewport: await run(`document.getElementById('scroll-lanesB').clientWidth`),
      content: await run(`document.getElementById('scroll-lanesB').scrollWidth`),
      plan: plan.cellWidth,
    }
  }
  console.log(JSON.stringify({ ...laid, caseH, caseI, caseG }, null, 2))
  // The harness has grown past "print it and read it": the checks the numbers are for are stated, and
  // one that fails is a line of output and a non-zero exit rather than something to be spotted.
  const problems = Array.isArray(laid.problems) ? laid.problems : []
  problems.push(...monitorProblems)
  if (problems.length) {
    console.error(`\n${problems.length} LAYOUT PROBLEM(S)\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`)
  }
  fs.unlinkSync(htmlPath)
  app.exit(problems.length ? 1 : 0)
}).catch((error) => { console.error('HARNESS FAILED', error); app.exit(1) })
