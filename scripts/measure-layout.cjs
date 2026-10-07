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
    <div class="timeline-gutter-ruler" id="grouler-${outerId}">FRAME 000000</div>
    ${heads}
  </div>
  <div class="timeline-scroll" id="scroll-${outerId}">
    <div class="timeline-lanes-inner" style="width:${laneWidthFor(seconds, ZOOM)}px">
      <div class="timeline-ruler" id="ruler-${outerId}">
        <span class="ruler-tick" id="rmin-${outerId}" style="left:20px"></span>
        <span class="ruler-tick is-major" id="rmaj-${outerId}" style="left:60px">00:00:01.00</span>
      </div>
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

// Case L: the two START-OF-LANE markers — a head fade on a clip, and an EMPTY lane's add-a-source — must stand
// on one vertical line, and neither may hang off the scroll area's own left edge where it would be clipped.
// They are laid out against DIFFERENT boxes (one hangs off a clip's leading edge, the other off the lane
// itself), so only a measurement can say whether the two agree.
const caseL = lanes('lanesL', 10,
  `${head('VIDEO 1')}${head('AUDIO')}`,
  `<div class="timeline-lane" id="laneL"><div class="timeline-lane-track" id="trackL"><div class="timeline-clip" id="clipL" style="width:${laneWidthFor(10, ZOOM)}px"><span class="timeline-clip-name">a</span><small>d</small><button class="boundary-add is-head" id="headL"></button></div></div></div>
<div class="timeline-lane" id="laneLE"><div class="timeline-lane-track is-audio" id="trackLE"><button class="boundary-add is-lane-empty" id="emptyL"></button></div></div>`)

// Case C: the preview overlay. A square output frame centred in a wide stage, its label
// anchored to the frame's top-left, and one crop band down the left edge. This checks the
// overlay geometry a reader cannot judge from the stylesheet. The drawing sits in the pan layer,
// exactly as the JSX puts it, so the pan can be measured moving it as one.
const caseC = `
<div class="editor-stage" id="stage" style="width:500px;height:300px">
  <div class="editor-stage-pan" id="cpan">
    <div class="editor-frame" id="cframe" style="width:200px;height:200px"><b id="clabel">OUTPUT 1080×1080</b></div>
    <div class="editor-frame-window" id="cwindow" style="left:150px;top:50px;width:200px;height:200px">
      <div class="editor-crop-shade" id="cshade" style="left:0;top:0;width:25px;height:300px"></div>
    </div>
    <div class="editor-tail" id="ctail"></div>
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
    <div class="crop-title" id="ctitle"><span class="editor-label" id="clabel2">CROP</span><span class="editor-info" id="cinfo"><button class="editor-info-mark" id="cmark">i</button><span class="editor-info-pop" id="cpop">What part of the source this clip keeps.</span></span></div>
    <div class="crop-head" id="chead">
      <select id="csel"><option>NONE</option><option>16:9</option></select>
      <button class="exact-icon" id="clock">L</button>
    </div>
    <div class="crop-row" id="crow">
      <label class="mini-field"><span>L</span><input id="cl" type="number" value="10"></label>
      <label class="mini-field"><span>T</span><input id="ctop" type="number" value="10"></label>
      <label class="mini-field"><span>R</span><input id="cr" type="number" value="10"></label>
      <label class="mini-field"><span>B</span><input id="cb" type="number" value="10"></label>
      <button class="exact-icon" id="creset">R</button>
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

// Case J: the folding groups. A collapsed group must hide what it holds — a heading that still
// reserved the space beneath it would be a heading that did nothing — and folding must not change the
// height of the heading itself, or the sidebar would jump as groups were folded. A control inside a
// group must also still fill it: the width rule used to be written against the field alone.
const caseJ = `
<section class="editor-group" id="gopen">
  <div class="editor-group-head" id="gopenhead">
    <button class="editor-group-name" id="gopenname"><span class="editor-group-label" id="gopenlabel">OUTPUT FRAME</span><span class="editor-group-hint" id="gopenhint">// SHAPE AND SIZE</span></button>
    <button class="editor-group-mark" id="gopenmark">-</button>
  </div>
  <div class="editor-group-body" id="gopenbody">
    <label class="editor-field" id="gf1"><span>RESOLUTION</span><select id="gsel"><option>4K</option></select></label>
    <label class="editor-field" id="gf2"><span>FPS</span><input id="gin" value="24"></label>
  </div>
</section>
<section class="editor-group is-collapsed" id="gclosed">
  <div class="editor-group-head" id="gclosedhead">
    <button class="editor-group-name" id="gclosedname"><span class="editor-group-label">FRAMING</span><span class="editor-group-hint">// PER CLIP</span></button>
    <div class="editor-group-actions" id="gactions"><div class="unit-toggle"><button class="is-on">%</button><button>px</button></div></div>
    <button class="editor-group-mark" id="gclosedmark">+</button>
  </div>
</section>`

// Case K: the FRAMING controls' shape. The figures are one row each — which figure is which is said by
// its own letter, so the layout has nothing to arrange — with the row's reset at the end of the row it
// belongs to. And the explanation grows inwards from its own row: the sidebar clips whatever passes its
// right edge, so whether the popover is readable inside it is a question only a measurement answers.
const caseK = `
<div class="editor-field" id="kfield">
  <span id="khead"><span class="editor-label" id="klabel">INSETS</span><span class="editor-info" id="kinfo"><button class="editor-info-mark" id="kmark">i</button><span class="editor-info-pop" id="kpop">The margin this clip leaves around itself, and where the picture sits inside it.</span></span></span>
  <div class="crop-row" id="krow">
    <label class="mini-field" id="kl"><span>L</span><input id="klin" class="editor-input" value="0"></label>
    <label class="mini-field" id="kt"><span>T</span><input value="0"></label>
    <label class="mini-field" id="kr"><span>R</span><input value="0"></label>
    <label class="mini-field" id="kb"><span>B</span><input value="0"></label>
    <button class="exact-icon" id="kreset">R</button>
  </div>
</div>
<div class="editor-field" id="kplain"><span>PLAIN</span><input id="kplainin" class="editor-input" value="0"></div>
<div class="editor-field">
  <span><span class="editor-label">OFFSET</span></span>
  <div class="crop-row" id="krow2">
    <label class="mini-field" id="kx"><span>X</span><input value="0"></label>
    <label class="mini-field" id="ky"><span>Y</span><input value="0"></label>
    <button class="exact-icon" id="kreset2">R</button>
  </div>
</div>`

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
<div class="export-content" id="fcontent">${caseD}${caseJ}${caseK}${filler.repeat(30)}</div>
<div class="editor-actions" id="factions"><button>CANCEL</button><button class="primary-retro">OK / APPLY</button></div>`

const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${cssPath}">
</head><body><div class="edit-job-shell"><div class="editor-body"><main class="editor-main">
<section class="timeline-panel">${caseA}</section>
<section class="timeline-panel">${caseB}</section>
<section class="timeline-panel">${caseL}</section>
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
  // The two start-of-lane markers, and the scroll edge they must stay inside.
  const startHead = rect('headL')
  const startEmpty = rect('emptyL')
  const startScroll = rect('scroll-lanesL')
  const bClip0 = rect('b0')
  const bMarker = rect('bm0')
  const bPlayhead = rect('bph')
  const bAudio = rect('b2')
  const stage = rect('stage')
  const cframe = rect('cframe')
  const clabel = rect('clabel')
  const cshade = rect('cshade')
  // The scale's two ranks of mark, read from the stylesheet: the subdivisions are fainter than the
  // labelled ones and stand the full height of the scale, or they read as debris rather than as a grid.
  const scaleMarks = (id) => {
    const element = document.getElementById(id)
    if (!element) return null
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    const rule = element.parentElement.getBoundingClientRect()
    // The mark's own offset from the scale's top edge is what says which edge it hangs from, which is
    // the half of the reading a height alone cannot give.
    return { color: style.borderLeftColor, height: +box.height.toFixed(2), top: +(box.top - rule.top).toFixed(2), text: element.textContent }
  }
  // The shade's own colour at rest and while the box is being dragged: what lies outside the crop is
  // the black the export will letterbox with, and it lifts to see-through only for the gesture that is
  // choosing the crop. Both are read here because only the stylesheet knows what either resolves to.
  const shadeAtRest = getComputedStyle(document.getElementById('cshade')).backgroundColor
  document.getElementById('stage').classList.add('is-cropping')
  const shadeWhileCropping = getComputedStyle(document.getElementById('cshade')).backgroundColor
  document.getElementById('stage').classList.remove('is-cropping')
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
  // The folding groups, measured once. A rect helper answers null for an element that is not there,
  // which is exactly what a collapsed group's body should be — so "no body" is measured, not assumed.
  const groupOpen = rect('gopen'); const groupClosed = rect('gclosed')
  const groupBody = rect('gopenbody'); const groupSelect = rect('gsel')
  // The framing controls, and the content box they have to stay inside.
  const framing = { t: rect('kt'), l: rect('kl'), r: rect('kr'), b: rect('kb'), reset: rect('kreset'), row: rect('krow'), y: rect('ky'), x: rect('kx'), input: rect('klin'), pop: rect('kpop'), mark: rect('kmark'), content: rect('fcontent'), plain: rect('kplainin'), head: rect('khead'), info: rect('kinfo') }
  return {
    caseA: { trackWidth: +(track.right - track.left).toFixed(2), clip0Right: clip0.right, markerCenter: marker.center, playheadLeft: playhead.left,
      cutVsMarker: +(clip0.right - marker.center).toFixed(2), cutVsPlayhead: +(clip0.right - playhead.left).toFixed(2), glyph: glyph('am0'),
      clipHeight: clip0.height, name: lineA.name, detail: lineA.detail,
      rulerHeight: document.getElementById('ruler-lanesA').clientHeight, majorMark: scaleMarks('rmaj-lanesA'), minorMark: scaleMarks('rmin-lanesA'),
      // The live readout in the gutter, directly above the lanes: the one place a stamp says FRAME, and
      // the one place that has to fit inside the label column.
      readout: (() => {
        const element = document.getElementById('grouler-lanesA')
        const style = getComputedStyle(element)
        return { text: element.textContent, fontSize: style.fontSize, height: +element.getBoundingClientRect().height.toFixed(2), inside: element.getBoundingClientRect().right <= rect('gutter-lanesA').right + 0.5 }
      })() },
    caseB: { trackWidth: +(bTrack.right - bTrack.left).toFixed(2), clip0Right: bClip0.right, markerCenter: bMarker.center, playheadLeft: bPlayhead.left, audioRight: bAudio.right,
      cutVsMarker: +(bClip0.right - bMarker.center).toFixed(2), cutVsPlayhead: +(bClip0.right - bPlayhead.left).toFixed(2),
      laneOverflow: +(bAudio.right - bTrack.right).toFixed(2),
      selectedAudio: (() => {
        const element = document.getElementById('b2')
        element.classList.add('is-selected')
        const style = getComputedStyle(element)
        return { color: style.outlineColor, style: style.outlineStyle }
      })() },
    caseC: { stage: [stage.width, stage.height], frame: [cframe.width, cframe.height],
      shadeAtRest, shadeWhileCropping,
      frameZ: getComputedStyle(document.getElementById('cframe')).zIndex,
      frameShadow: getComputedStyle(document.getElementById('cframe')).boxShadow,
      shadeInsideFrame: Boolean(document.getElementById('cshade').closest('.editor-frame-window')),
      windowClips: getComputedStyle(document.getElementById('cwindow')).overflow,
      tailZ: getComputedStyle(document.getElementById('ctail')).zIndex,
      centeredX: +(cframe.center - stage.center).toFixed(2), centeredY: +(cframe.centerY - stage.centerY).toFixed(2),
      labelVsFrameLeft: +(clabel.left - cframe.left).toFixed(2), labelVsFrameTop: +(clabel.top - cframe.top).toFixed(2),
      shadeLeft: cshade.left, shadeHeight: cshade.height,
      panLayerBox: [moved.layer.width, moved.layer.height], panMovedFrame: [+(moved.frame.left - cframe.left).toFixed(2), +(moved.frame.top - cframe.top).toFixed(2)],
      panMovedShade: +(moved.shade.left - cshade.left).toFixed(2) },
    caseD: { rowWidth: exrow.width, fieldWidths: [dw.width, dh.width], iconWidths: [dlock.width, dreset.width],
      fieldHeights: [dw.height, dh.height], iconHeights: [dlock.height, dreset.height],
      leadingFlush: +(rect('dwf').left - exrow.left).toFixed(2), trailingFlush: +(exrow.right - dreset.right).toFixed(2),
      columnGap: +(dh.left - dw.right).toFixed(2) },
    caseL: { headLeft: startHead && startHead.left, emptyLeft: startEmpty && startEmpty.left,
      headCenter: startHead && startHead.centerY, emptyCenter: startEmpty && startEmpty.centerY,
      scrollLeft: startScroll && startScroll.left },
    caseE: { headWidth: rect('chead').width, headHeight: rect('chead').height, selectWidth: rect('csel').width, pickHeight: rect('csel').height,
      lockWidth: rect('clock').width, lockHeight: rect('clock').height,
      titleBottom: rect('ctitle').bottom, headTop: rect('chead').top,
      hasCropUnit: Boolean(document.getElementById('cunit')),
      markTransform: getComputedStyle(document.getElementById('cmark')).textTransform,
      labelFont: getComputedStyle(document.getElementById('clabel2')).fontSize,
      labelLeftVsTitle: +(rect('clabel2').left - rect('ctitle').left).toFixed(2),
      markRightVsTitle: +(rect('ctitle').right - rect('cmark').right).toFixed(2),
      popLeft: rect('cpop').left, popRight: rect('cpop').right, popTop: rect('cpop').top, markBottom: rect('cmark').bottom,
      contentLeft: rect('fcontent').left, contentRight: rect('fcontent').right,
      selectLeadingFlush: +(rect('csel').left - rect('chead').left).toFixed(2), lockTrailingFlush: +(rect('chead').right - rect('clock').right).toFixed(2),
      cropRowWidth: rect('crow').width, cropFieldWidth: rect('cl').width, cropResetLeft: rect('creset').left, cropLastRight: rect('cb').right },
    // Folding: an open group holds what it is given, a collapsed one holds nothing at all, and folding
    // does not change the height of the heading — or the sidebar would jump as groups were folded.
    // The controls inside keep filling their group, which the width rule has to allow for now that a
    // group can hold them directly.
    caseJ: { openHead: [rect('gopenhead').width, rect('gopenhead').height], closedHead: [rect('gclosedhead').width, rect('gclosedhead').height],
      bodyHeight: groupBody ? groupBody.height : 0, closedHeight: groupClosed ? groupClosed.height : 0, openHeight: groupOpen ? groupOpen.height : 0,
      selectWidth: groupSelect ? groupSelect.width : 0, groupInnerWidth: groupOpen ? groupOpen.width : 0,
      closedStillShowsBody: Boolean(document.getElementById('gclosedbody')),
      // A heading that carries the group's own controls is still ONE line: a row that governs everything
      // under it must not push what it governs any further down than the heading would have. Its rule is
      // the tab strip's own, because a section's name is a heading and the line says how far it reaches.
      actionsRow: Math.abs(rect('gactions').top - rect('gclosedname').top), actionsRightOfToggle: rect('gactions').left >= rect('gclosedname').right,
      separatorGap: +(rect('gopenhint').left - rect('gopenlabel').right).toFixed(2),
      hintText: document.getElementById('gopenhint').textContent,
      headingRule: [getComputedStyle(document.getElementById('gopenhead')).borderBottomWidth, getComputedStyle(document.getElementById('gopenhead')).borderBottomColor],
      tabRule: [getComputedStyle(document.querySelector('#ftabs button.active')).borderBottomWidth, getComputedStyle(document.querySelector('#ftabs button.active')).borderBottomColor],
      nameOneLine: rect('gopenname').height <= 20 },
    // The framing controls, read as positions rather than as sizes: which figure follows which along
    // the row IS the layout, since the letters carry the meaning rather than the arrangement.
    caseK: { rowTops: [framing.l.top, framing.t.top, framing.r.top, framing.b.top],
      lefts: [framing.l.left, framing.t.left, framing.r.left, framing.b.left],
      widths: [framing.l.width, framing.t.width, framing.r.width, framing.b.width],
      resetLeft: framing.reset ? framing.reset.left : 0, lastFieldRight: framing.b.right,
      offsetLefts: [framing.x.left, framing.y.left], offsetResetLeft: rect('kreset2') ? rect('kreset2').left : 0, offsetLastRight: framing.y.right,
      inputHeight: framing.input.height, rowHeight: framing.row.height, plainInputHeight: framing.plain ? framing.plain.height : 0,
      labelFont: getComputedStyle(document.getElementById('klabel')).fontSize,
      markRightVsHead: +(framing.head.right - framing.info.right).toFixed(2),
      markBorderWidth: getComputedStyle(document.getElementById('kmark')).borderTopWidth,
      popBorder: getComputedStyle(document.getElementById('kpop')).borderTopColor,
      popShadow: getComputedStyle(document.getElementById('kpop')).boxShadow !== 'none',
      popRight: framing.pop.right, popTop: framing.pop.top, markBottom: framing.mark.bottom,
      contentRight: framing.content.right, contentLeft: framing.content.left,
      popLeft: framing.pop.left, fieldCount: document.querySelectorAll('#krow .mini-field').length },
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
  // The scale's own marks: a labelled rank and a faint one, both standing the height of the scale, and
  // only the labelled rank carrying text — which is what makes the subdivisions read as divisions of
  // the mark they sit between rather than as marks of their own.
  const scale = laid.caseA
  if (scale) {
    if (!(scale.majorMark && scale.minorMark)) problems.push('the scale has no marks to read')
    else {
      if (scale.minorMark.color === scale.majorMark.color) problems.push('the scale\u2019s subdivisions are as loud as its labelled marks')
      if (Math.abs(scale.minorMark.height - scale.rulerHeight / 4) > 0.5) problems.push(`a subdivision is not a quarter the height of the scale: ${scale.minorMark.height} of ${scale.rulerHeight}`)
      if (Math.abs(scale.majorMark.height - scale.rulerHeight) > 0.5) problems.push(`a labelled mark does not stand the height of the scale: ${scale.majorMark.height} of ${scale.rulerHeight}`)
      // Which EDGE each rank hangs from: the labelled marks start at the scale's top and the
      // subdivisions stand on its baseline, so a ruler is read by shape rather than by counting. The
      // scale's own bottom border is not part of the box the marks are laid out in.
      if (scale.minorMark.top + scale.minorMark.height < scale.rulerHeight - 1) problems.push(`a subdivision does not stand on the scale\u2019s baseline: it ends at ${(scale.minorMark.top + scale.minorMark.height).toFixed(2)} of ${scale.rulerHeight}`)
      if (Math.abs(scale.majorMark.top) > 0.5) problems.push(`a labelled mark does not start at the scale\u2019s top: ${scale.majorMark.top}`)
      if (!scale.majorMark.text) problems.push('a labelled mark carries no text')
      if (scale.minorMark.text) problems.push(`a subdivision carries text: ${JSON.stringify(scale.minorMark.text)}`)
    }
  }
  // The folding groups, asserted here rather than in the page because these are questions about
  // DIFFERENCES between two elements — one folded, one not — rather than about either alone.
  const groups = laid.caseJ
  // The two START-OF-LANE markers must stand on one vertical line and stay inside the scroll area: a head fade
  // hangs off a CLIP's leading edge and an empty lane's [+] off the LANE itself, so the two boxes differ and
  // only a measurement can say whether they agree.
  const startMarkers = laid.caseL
  if (startMarkers) {
    if (Math.abs(startMarkers.headLeft - startMarkers.emptyLeft) > 0.5) problems.push(`the head fade [+] and the empty lane's [+] are not on one line: ${startMarkers.headLeft} against ${startMarkers.emptyLeft}`)
    const hangs = (left) => left < startMarkers.scrollLeft - 0.5
    if (hangs(startMarkers.headLeft) || hangs(startMarkers.emptyLeft)) problems.push(`a start-of-lane [+] hangs past the scroll area's left edge and would be clipped (head ${startMarkers.headLeft}, empty ${startMarkers.emptyLeft}, scroll ${startMarkers.scrollLeft})`)
  }
  // The framing controls. Which figure follows which along the row IS the layout, since the letters
  // carry the meaning; what is left to check is that they ARE one row, in the right order, evenly
  // sized, with the row's own reset at its end — and that the fields are as compact as they claim.
  const framing = laid.caseK
  // The monitor's crop shade, which is a fact about two stylesheet states rather than about a box.
  const shade = laid.caseC
  if (shade) {
    if (shade.shadeAtRest !== 'rgb(0, 0, 0)') problems.push(`the shade outside the crop is not the export's black at rest: ${shade.shadeAtRest}`)
    if (!/^rgba\(3, 9, 16/.test(shade.shadeWhileCropping)) problems.push(`the shade does not lift while the crop box is dragged: ${shade.shadeWhileCropping}`)
    // The output frame's outline is the edge of the export, and the letterbox and the black tail are
    // drawn inside it: neither can cover it however much of the frame they fill.
    if (!(Number(shade.frameZ) > Number(shade.tailZ))) problems.push(`the frame outline does not stand above the black tail: ${shade.frameZ} of ${shade.tailZ}`)
    if (!(Number(shade.tailZ) > 0)) problems.push(`the black tail is not drawn above the picture: z-index ${shade.tailZ}`)
    // The canvas is a panel and the frame is the picture: a veil that dimmed the panel towards the black
    // inside the frame is what made the two read as one area.
    if (/9999/.test(shade.frameShadow)) problems.push(`the frame still darkens the canvas around it: ${shade.frameShadow}`)
    // And the letterbox is drawn inside the frame's own window, which is what clips it: a picture too big
    // for the frame must not be able to paint black across the panel the frame sits on.
    if (!shade.shadeInsideFrame) problems.push('the letterbox is not drawn inside the frame, so it can spill over the canvas')
  }
  // The live readout in the gutter, and an audio container in the selection's own outline.
  const scaleRow = laid.caseA
  if (scaleRow && scaleRow.readout) {
    if (!scaleRow.readout.text) problems.push('the gutter carries no live readout')
    if (scaleRow.readout.fontSize !== '9px') problems.push(`the readout is not set in the scale's own type: ${scaleRow.readout.fontSize}`)
    if (!(scaleRow.readout.height > 0 && scaleRow.readout.height <= 20)) problems.push(`the readout does not fit the gutter's own row: ${scaleRow.readout.height}`)
    if (!scaleRow.readout.inside) problems.push('the readout runs out of the label column')
  }
  if (laid.caseB && laid.caseB.selectedAudio) {
    if (laid.caseB.selectedAudio.color !== 'rgb(197, 184, 121)') problems.push(`a selected clip is not drawn in amber: ${laid.caseB.selectedAudio.color}`)
    if (laid.caseB.selectedAudio.style !== 'solid') problems.push(`a selected clip is not drawn solid: ${laid.caseB.selectedAudio.style}`)
  }
  if (framing) {
    // The explanation: a bare lower-case i, and a popover outlined in the border colour rather than the
    // accent, lifted off the page rather than drawn flat on it.
    if (framing.markBorderWidth !== '0px') problems.push(`the explanation mark is still boxed: ${framing.markBorderWidth} of border`)
    if (framing.popBorder !== 'rgb(105, 112, 120)') problems.push(`the explanation is outlined in something other than the border colour: ${framing.popBorder}`)
    if (!framing.popShadow) problems.push('the explanation is drawn without a drop shadow')
    if (!framing.rowTops.every((top) => Math.abs(top - framing.rowTops[0]) <= 0.6)) problems.push(`the inset figures are not on one row: ${JSON.stringify(framing.rowTops)}`)
    if (!framing.lefts.every((left, index) => index === 0 || left > framing.lefts[index - 1])) problems.push(`the inset figures are not in L T R B order: ${JSON.stringify(framing.lefts)}`)
    if (!framing.widths.every((width) => Math.abs(width - framing.widths[0]) <= 1)) problems.push(`the inset figures are not the same width: ${JSON.stringify(framing.widths)}`)
    if (!(framing.resetLeft > framing.lastFieldRight - 0.5)) problems.push('the insets reset is not at the end of its own row')
    if (!(framing.offsetLefts[1] > framing.offsetLefts[0])) problems.push('the offset figures are not in X Y order')
    if (!(framing.offsetResetLeft > framing.offsetLastRight - 0.5)) problems.push('the offset reset is not at the end of its own row')
    if (framing.fieldCount !== 4) problems.push(`the insets hold ${framing.fieldCount} figures rather than four`)
    if (!(framing.plainInputHeight > 0)) problems.push('the harness has no ordinary field to measure the framing figures against')
    if (framing.plainInputHeight > 0 && !(Math.abs(framing.inputHeight - framing.plainInputHeight) <= 6)) problems.push(`the framing figures are not an ordinary field's size: ${framing.inputHeight}px against ${framing.plainInputHeight}px`)
    if (!(Math.abs(framing.markRightVsHead) <= 0.5)) problems.push(`the explanation mark is not at the row's far end: ${framing.markRightVsHead}px from it`)
    if (!(framing.popRight <= framing.contentRight + 0.5)) problems.push(`the explanation runs past the sidebar's right edge: ${framing.popRight} of ${framing.contentRight}`)
    if (!(framing.popLeft >= framing.contentLeft - 0.5)) problems.push(`the explanation runs out of the sidebar on the left: ${framing.popLeft} of ${framing.contentLeft}`)
    if (!(framing.popTop >= framing.markBottom)) problems.push('the explanation is drawn over its own mark')
  }
  if (groups) {
    if (groups.closedStillShowsBody) problems.push('a collapsed group still holds its body, so folding hides nothing')
    if (!(groups.bodyHeight > groups.openHead[1])) problems.push(`an open group does not show what it holds: body ${groups.bodyHeight}px, head ${groups.openHead[1]}px`)
    if (Math.abs(groups.openHead[1] - groups.closedHead[1]) > 0.5) problems.push(`a heading that carries controls is a different height to one that does not: ${groups.openHead[1]}px of ${groups.closedHead[1]}px`)
    if (!(groups.closedHeight > 0 && groups.closedHeight < groups.openHeight)) problems.push(`a folded group is not shorter than an open one: ${groups.closedHeight}px of ${groups.openHeight}px`)
    if (!(groups.actionsRow < 0.6)) problems.push(`a heading's own controls are on a line of their own: ${groups.actionsRow}px out`)
    if (!groups.actionsRightOfToggle) problems.push('a heading puts its own controls before its name')
    if (!(groups.selectWidth > groups.groupInnerWidth * 0.8)) problems.push(`a control inside a group does not fill it: ${groups.selectWidth}px of ${groups.groupInnerWidth}px`)
    if (!groups.nameOneLine) problems.push('a heading\u2019s name and sublabel do not fit on one line')
    // The heading's rule is the tab strip's accent at half strength rather than the accent itself: at
    // full strength it competed with the section names it sits under. Two notations have to be read,
    // because the browser answers a colour-mix in one and a plain colour in the other.
    const parseColor = (value) => {
      const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(value)
      if (srgb) return { r: +srgb[1] * 255, g: +srgb[2] * 255, b: +srgb[3] * 255, a: srgb[4] === undefined ? 1 : +srgb[4] }
      const rgb = /rgba?\(([^)]+)\)/.exec(value)
      if (rgb) { const p = rgb[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
      return null
    }
    const headingAccent = parseColor(groups.headingRule[1]); const tabAccent = parseColor(groups.tabRule[1])
    if (groups.headingRule[0] !== groups.tabRule[0]) problems.push(`the heading's rule is a different width to the tab strip's: ${groups.headingRule[0]} of ${groups.tabRule[0]}`)
    if (!headingAccent || !tabAccent) problems.push(`a rule's colour could not be read: ${groups.headingRule[1]} / ${groups.tabRule[1]}`)
    else {
      if (['r', 'g', 'b'].some((channel) => Math.abs(headingAccent[channel] - tabAccent[channel]) > 1)) problems.push(`the heading's rule is not the tab strip's accent: ${groups.headingRule[1]} of ${groups.tabRule[1]}`)
      if (Math.abs(headingAccent.a - 0.5) > 0.02) problems.push(`the heading's rule is not at half strength: alpha ${headingAccent.a}`)
    }
    // NAME // SUBLABEL: the separator has to be clear of the name on its left — a flex row trims a
    // leading space, which is how it came to read NAME// SUBLABEL — and carry its space on the right.
    if (!(groups.separatorGap >= 3)) problems.push(`the separator is not clear of the name: ${groups.separatorGap}px`)
    if (!/^\/\/ /.test(groups.hintText)) problems.push(`the sublabel does not read as // SUBLABEL: ${JSON.stringify(groups.hintText)}`)
  }
  // The crop's own shape: a heading on a line of its own above the shape list, no unit switch of its
  // own (the framing section carries the only one), and the four figures with their reset at the end.
  const cropHead = laid.caseE
  if (cropHead) {
    if (cropHead.hasCropUnit) problems.push('the crop still carries a unit switch of its own')
    if (!(cropHead.titleBottom <= cropHead.headTop + 0.5)) problems.push(`the crop heading is not on a line of its own above its shape list: ${cropHead.titleBottom} of ${cropHead.headTop}`)
    if (!(cropHead.selectWidth > cropHead.headWidth - cropHead.lockWidth - 12)) problems.push(`the shape list does not fill its row beside the lock: ${cropHead.selectWidth} of ${cropHead.headWidth}`)
    if (!(cropHead.cropResetLeft > cropHead.cropLastRight - 0.5)) problems.push('the crop reset is not at the end of its own row')
    // A mark that is a letter must stay a letter: the app upper-cases buttons, which is right for a
    // label and wrong here. And the crop's explanation has to land inside the sidebar, under its own
    // heading — the two things that made its mark appear to do nothing at all.
    if (cropHead.markTransform !== 'none') problems.push(`the explanation mark is not a lower-case i: text-transform is ${cropHead.markTransform}`)
    if (!(cropHead.popRight <= cropHead.contentRight + 0.5)) problems.push(`the crop's explanation runs past the sidebar's right edge: ${cropHead.popRight} of ${cropHead.contentRight}`)
    if (!(cropHead.popLeft >= cropHead.contentLeft - 0.5)) problems.push(`the crop's explanation runs out of the sidebar on the left: ${cropHead.popLeft} of ${cropHead.contentLeft}`)
    if (!(cropHead.popTop >= cropHead.markBottom)) problems.push('the crop\u2019s explanation is drawn over its own mark')
    // A sub-section's name is at its row's left end and its mark at the right, the same way in every
    // sub-section; and CROP's heading is set in the SAME type as the others, which is what it did not
    // do when it inherited from the sidebar instead.
    if (!(Math.abs(cropHead.labelLeftVsTitle) <= 0.5)) problems.push(`the crop's name is not at its row's left end: ${cropHead.labelLeftVsTitle}px from it`)
    if (!(Math.abs(cropHead.markRightVsTitle) <= 0.5)) problems.push(`the crop's explanation mark is not at its row's far end: ${cropHead.markRightVsTitle}px from it`)
    if (framing && cropHead.labelFont !== framing.labelFont) problems.push(`the crop's heading is a different size to the other sub-sections: ${cropHead.labelFont} of ${framing.labelFont}`)
  }
  if (problems.length) {
    console.error(`\n${problems.length} LAYOUT PROBLEM(S)\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`)
  }
  fs.unlinkSync(htmlPath)
  app.exit(problems.length ? 1 : 0)
}).catch((error) => { console.error('HARNESS FAILED', error); app.exit(1) })
