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
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { Readable } = require('node:stream')

// The app's own media scheme, registered the way the app registers it, so a <video> pointed at a real file
// through `mediaUrl` actually decodes one. Without this the monitor's element never loads, never measures its
// picture, and the framing it draws can only be guessed at — which is exactly the path a repeated source is
// reported broken on.
protocol.registerSchemesAsPrivileged([{ scheme: 'stitch-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }])

/** One `bytes=start-end` range, or null when the request asks for the whole file. */
const byteRange = (header, size) => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || ''))
  if (!match) return null
  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  return start <= end && start < size ? { start, end } : null
}

const runFfmpeg = (args) => execFileSync('ffmpeg', args, { stdio: 'pipe' })

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

/**
 * A real clip for the monitor to decode.
 *
 * The framing the monitor draws is measured against the picture the element LOADED, and the second copy of one
 * file is precisely the case where the element never reloads — so a size filed under the first clip reads as
 * unknown to the second and its crop cannot be drawn. A stub element that never loads cannot tell those two
 * apart, so the file is real and the app's own media scheme serves it.
 */
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-up-mount-'))
const clipFixture = path.join(fixtureDir, 'clip.mp4')
runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25:duration=12', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', clipFixture])

const htmlPath = path.join(__dirname, '.editor-mount.html')
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8">${style}</head><body><script>window.__clipFixture = ${JSON.stringify(clipFixture)}</script><script>${fs.readFileSync(bundle, 'utf8')}</script></body></html>`, 'utf8')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  // The media the monitor is pointed at, served the way the app serves it: a real file with a range handler, so
  // the element decodes it and reports its own size — which is what the framing is measured against.
  protocol.handle('stitch-media', async (request) => {
    const target = new URL(request.url).searchParams.get('path')
    if (!target || !path.isAbsolute(target)) return new Response('Missing media path', { status: 400 })
    let size
    try { size = fs.statSync(target).size } catch { return new Response('Not found', { status: 404 }) }
    const range = byteRange(request.headers.get('Range'), size)
    if (range) {
      return new Response(Readable.toWeb(fs.createReadStream(target, { start: range.start, end: range.end })), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Accept-Ranges': 'bytes' } })
    }
    return new Response(Readable.toWeb(fs.createReadStream(target)), { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  })
  const win = new BrowserWindow({ width: 1320, height: 840, show: false })
  await win.loadFile(htmlPath)
  // The mounts are on timers of their own, so this waits for the page to say it is finished rather
  // than for a fixed figure that would have to be raised whenever the render does more work.
  const deadline = Date.now() + 35000
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
    // THE PRESET LIST, which belongs to the FORMAT. The list must be the container's own — the table the
    // encoder's own codecs come from — and the row that used to be called VIDEO CODEC must be gone.
    const preset = rendered && rendered.preset
    if (!preset) problems.push('the export settings said nothing about the codec list')
    else {
      if (preset.videoCodecField) problems.push('a VIDEO CODEC field is still drawn, so the rename did not happen')
      if (preset.name !== 'P') problems.push(`the preset's own name reads ${JSON.stringify(preset.name)} rather than P`)
      if (preset.value !== 'h264') problems.push(`an h264 mp4 job stands on preset ${JSON.stringify(preset.value)} rather than h264`)
      if (!preset.options.includes('h264')) problems.push(`the mp4 preset list offers no h264: ${JSON.stringify(preset.options)}`)
      // The two that must NOT be there: a container's list is its own, which is the whole of the fix.
      if (preset.options.includes('dxv')) problems.push('the mp4 preset list offers DXV, which an mp4 cannot hold')
      if (preset.options.some((value) => String(value).startsWith('prores'))) problems.push('the mp4 preset list offers ProRes, which an mp4 cannot hold')
      if (preset.options.some((value) => value === 'mpeg4' || value === 'qtrle')) problems.push('the mp4 preset list offers a QuickTime-only codec')
    }
    // WHAT THE TRANSPORT SAYS, and where it says it. The state belongs under the monitor on one line, and the
    // buttons must not state it a second time: the rate readout beside them carries the SPEED the monitor is
    // watched at rather than a pause glyph, so an idle transport reads its own speed rather than nothing. The
    // speed dropdown that used to sit beside the transport must be GONE — the wheel over the monitor still
    // climbs the ladder, and the readout is where the figure is, so a dropdown was a duplicate rather than an
    // offer.
    const transport = rendered && rendered.transport
    if (!transport) problems.push('the monitor said nothing about what the transport was doing')
    else {
      if (transport.state !== '|| PAUSED') problems.push(`an idle monitor reads ${JSON.stringify(transport.state)} rather than a pause`)
      if (String(transport.rate).trim() !== '1x') problems.push(`an idle transport reads ${JSON.stringify(transport.rate)} rather than the speed it is watched at`)
      if (transport.speedSelector) problems.push('the preview speed dropdown is still drawn under the monitor')
    }
    // THE SIZE ESTIMATE, which is where the report about UNKNOWN came from: a movie job's picture is a CRF
    // delivery codec, and its figure is a bracket rather than the word UNKNOWN.
    if (String(rendered && rendered.summary).includes('UNKNOWN')) problems.push(`the summary of a movie job still says UNKNOWN: ${String(rendered && rendered.summary)}`)
    // THE ONE-STREAM RULE, driven through a click: unchecking the picture leaves a sound-only job, so the
    // window has to hold the sound ON and lock it there. A job with neither stream in it writes nothing,
    // and this is the reading that says the window cannot be put into that state.
    const afterVideoOff = rendered && rendered.afterVideoOff
    if (!afterVideoOff) problems.push('the stream toggles could not be driven, so the one-stream rule is unproven')
    else {
      if (afterVideoOff['EXPORT VIDEO'] && afterVideoOff['EXPORT VIDEO'].checked) problems.push('unchecking EXPORT VIDEO left it checked')
      if (!afterVideoOff['EXPORT AUDIO'] || !afterVideoOff['EXPORT AUDIO'].checked) problems.push('unchecking EXPORT VIDEO left the sound off as well, so the job would write nothing at all')
      if (afterVideoOff['EXPORT AUDIO'] && !afterVideoOff['EXPORT AUDIO'].disabled) problems.push('with the picture off the sound is still choosable, so both streams can be left switched off')
    }
    // THE TRANSPORT'S SCRUBBER, drawn by the window rather than by the platform: a round blue knob on a
    // blue track is the one thing on that panel that is not of the window, so the rule is what is asserted.
    const scrub = result.scrub
    if (!scrub) problems.push('the transport reported nothing about its scrubber')
    else {
      if (!scrub.drawn) problems.push('the transport drew no scrubber at all')
      if (!String(scrub.inputRule && scrub.inputRule.appearance).includes('none')) problems.push(`the scrubber still has the platform's own appearance: ${String(scrub.inputRule && scrub.inputRule.appearance)}`)
      if (!scrub.thumbRule) problems.push('the scrubber has no rule of its own for its handle, so the platform draws a round one')
      else {
        if (!['0', '0px'].includes(String(scrub.thumbRule.borderRadius))) problems.push(`the scrubber's handle is not rectangular: border-radius ${String(scrub.thumbRule.borderRadius)}`)
        if (String(scrub.thumbRule.width) !== '3px') problems.push(`the scrubber's handle is ${String(scrub.thumbRule.width)} wide rather than a thin three`)
        if (String(scrub.thumbRule.height) !== '16px') problems.push(`the scrubber's handle is ${String(scrub.thumbRule.height)} tall rather than the row's own height`)
      }
      if (!String(scrub.trackRule && scrub.trackRule.background).includes('var(--ui-accent)')) problems.push(`the scrubber's track is not drawn in the window's own colours: ${String(scrub.trackRule && scrub.trackRule.background)}`)
    }
    // AND ITS WHEEL, which is the timeline's OWN scrub gesture rather than a second one: a turn on the bar has
    // to move the playhead rather than do nothing. Read as the stamp under the bar, which is what a reader sees
    // move; the bar is turned whichever way has room, since one already at an end can only move the other way.
    const scrubWheel = result.scrubWheel
    if (!scrubWheel) problems.push('the transport reported nothing about its scrubber wheel')
    else if (scrubWheel.disabled) problems.push(`the transport's scrubber was disabled, so its wheel could not be driven`)
    else {
      if (scrubWheel.stampBefore == null || scrubWheel.stampAfter == null) problems.push('the transport reported no stamp to read the scrub by')
      else if (scrubWheel.stampBefore === scrubWheel.stampAfter) problems.push(`a wheel over the transport's bar did not move the playhead: it stayed at ${String(scrubWheel.stampBefore)}`)
    }
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
      // The COLOUR SWATCH, which is where a job that has named no colour shows the one it will be drawn in: the
      // swatch's value is the RESOLVED colour, so an empty box here would mean the theme were not behind it.
      if (audio.colourSwatch !== '#9fbf9a') problems.push(`the colour swatch shows ${String(audio.colourSwatch)} rather than the theme's own green`)
      // THE THEMED DROPDOWNS, which is the whole of the first fix: the window's settings must offer no platform
      // <select> at all, because that is the control whose OPEN list the stylesheet cannot reach — a themed
      // border over the OS's own blue highlight. The count is the fix, so it is asserted as a count.
      if (rendered.nativeSelects !== 0) problems.push(`${rendered.nativeSelects} platform <select> element(s) are still in the window, whose open list cannot be themed`)
      if (!rendered.dropdowns) problems.push('the window drew no themed dropdown at all')
      // And the swatch is the window's own BUTTON with the picker kept out of sight behind it, rather than the
      // wide native colour box it was — the tag and the hidden-input count are what tell the two apart.
      if (audio.colourSwatchTag !== 'BUTTON') problems.push(`the colour swatch is a <${String(audio.colourSwatchTag)}> rather than the window's own button`)
      if (!audio.hiddenColourInputs) problems.push('the colour swatch has no picker behind it to open')
      // The waveform's own count, which defaults to ONE — the downmix that makes the drawing one shape.
      if (!audio.waveforms) problems.push('the waveform was offered no count of how many waveforms it draws')
      else {
        if (String(audio.waveforms.options) !== '1,2') problems.push(`the waveform count offers ${JSON.stringify(audio.waveforms.options)} rather than one or two`)
        if (audio.waveforms.value !== '1') problems.push(`a job that says nothing draws ${audio.waveforms.value} waveforms rather than one`)
      }
      // The palette, which every template reads and which is offered whatever the template is — a colour the
      // job names for itself wins over it, but a job that names none takes its own colour FROM it, so a
      // template without a colour field still has a palette behind it.
      if (!audio.themeOptions) problems.push('the drawing has no palette at all')
      else if (String(audio.themeOptions) !== 'green,amber') problems.push(`the palette offers ${JSON.stringify(audio.themeOptions)} rather than the app's two phosphors`)
      // The waveform's own knobs, which only the two waveforms take.
      if (!audio.drawnToggles) problems.push('the drawing drew no toggles at all')
      else {
        if (!audio.drawnToggles.includes('PROGRESS LINE')) problems.push('the waveform picture was offered no progress line')
        if (audio.drawnToggles.includes('SEGMENTED')) problems.push('the waveform was offered the bars\u2019 own segment control')
        if (audio.drawnToggles.includes('TRUE STEREO')) problems.push('the waveform was offered the scope\u2019s own stereo switch')
      }
      // And the tune actually reaches the encoder. The request carries the RESOLVED palette and knobs, so this
      // is what the export will be drawn with, defaults included — a knob the editor draws and never sends is
      // the same fault as a knob it holds and never draws, one level further along.
      const tuneAsk = audio.drawingStill
      if (tuneAsk) {
        if (tuneAsk.theme !== 'green') problems.push(`the still was asked for theme ${String(tuneAsk.theme)} rather than the app's green`)
        if (tuneAsk.waveScale !== 'lin' || tuneAsk.waveWeight !== 'fill' || tuneAsk.waveChannels !== 1) problems.push(`the still was asked for a waveform of ${String(tuneAsk.waveScale)}/${String(tuneAsk.waveWeight)}/${String(tuneAsk.waveChannels)} waveforms`)
        if (tuneAsk.trueStereo !== false) problems.push(`the still was asked for the scope\u2019s own stereo switch: ${String(tuneAsk.trueStereo)}`)
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
      // The EQ's own knobs, which exist only for the EQ. Choosing it has to bring four controls out and send
      // all four to the encoder: a knob the editor holds but never draws is the same fault one level down.
      if (!audio.eqFields) problems.push('the EQ template could not be chosen at all')
      else {
        for (const expected of ['BAR COUNT', 'AMPLITUDE', 'FREQUENCY', 'SENSITIVITY']) {
          if (!audio.eqFields.some((label) => label.startsWith(expected))) problems.push(`choosing the EQ drew no ${expected} control`)
        }
      }
      // WHAT THE SOUND IS, on the tab that is about the sound, and how many channels it is written as. The
      // facts are a ROW rather than a field — they describe the file rather than offer a choice — and the
      // channel count is a field, offered because this job has sound in it. A job with none is offered none.
      if (!audio.audioRows || !audio.audioRows.some((label) => label.startsWith('SOURCE AUDIO'))) problems.push('the AUDIO tab said nothing about what the source\u2019s own audio is')
      if (!audio.channels) problems.push('the AUDIO tab offered no channel count for a job that has sound in it')
      else {
        if (String(audio.channels.options) !== '0,1,2') problems.push(`the channel count offers ${JSON.stringify(audio.channels.options)} rather than SOURCE, MONO and STEREO`)
        if (audio.channels.value !== '0') problems.push(`a job that says nothing starts on channel count ${audio.channels.value} rather than the source\u2019s own`)
      }
      // And the choice reaches the encoder: SOURCE stores nothing at all rather than a figure, and a figure
      // chosen is the figure sent.
      if (audio.channelsAfterChoosing !== '1') problems.push(`choosing MONO left the field on ${String(audio.channelsAfterChoosing)}`)
      if (audio.appliedChannels !== 1) problems.push(`choosing MONO sent ${String(audio.appliedChannels)} rather than one channel`)
      // The BITRATE ladder, which is a rung or a typed figure rather than a free field — and CUSTOM has to bring
      // the field out, or the only thing it offers is the name of an option.
      if (!audio.bitrate) problems.push('the AUDIO tab offered no bitrate control for a lossy codec')
      else {
        if (String(audio.bitrate.options) !== '0,96,128,160,192,256,320,custom') problems.push(`the bitrate offers ${JSON.stringify(audio.bitrate.options)} rather than the source and the ladder`)
        if (audio.bitrate.value !== '0') problems.push(`a job that says nothing starts on bitrate ${audio.bitrate.value} rather than the source\u2019s own`)
      }
      if (audio.bitrateCustomFieldBefore) problems.push('a typed bitrate was offered before CUSTOM was chosen')
      if (audio.bitrateAfterCustom !== 'custom' || !audio.bitrateCustomField) problems.push(`choosing CUSTOM left the ladder on ${String(audio.bitrateAfterCustom)} with the field ${String(audio.bitrateCustomField)}`)
      // And the picture a sound-only job can be GIVEN, which is the third answer its picture source can be.
      if (!audio.pictureSource || !audio.pictureSource.options.includes('custom')) problems.push('the picture source offered no image of the user\u2019s own')
      if (audio.pictureImageRow !== 'IMAGE') problems.push(`choosing a custom picture drew no image picker (rows: ${JSON.stringify(audio.pictureImageRow)})`)
      if (!String(audio.pictureImageName).includes('chosen.png')) problems.push(`the picked image was not recorded: ${String(audio.pictureImageName)}`)
      if (!String(audio.appliedPictures).includes('visualization')) problems.push(`choosing the drawing never reached the encoder: ${JSON.stringify(audio.appliedPictures)}`)
      if (audio.appliedPicture !== 'custom') problems.push(`choosing a custom picture sent ${String(audio.appliedPicture)}`)
      if (audio.appliedPictureImage !== '/tmp/chosen.png') problems.push(`the picked image was not sent to the encoder: ${String(audio.appliedPictureImage)}`)
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
      }
      // TRUE STEREO, which is the one knob about the SOUND rather than about the drawing of it: off, the ring is
      // synthesised, and it is what makes a scope on a mono sound draw a ring rather than a spoke.
      if (!audio.scopeToggles || !audio.scopeToggles.includes('TRUE STEREO')) problems.push('the scope was offered no TRUE STEREO switch')
      const scopeAsk = audio.scopeStill
      if (!scopeAsk) problems.push('the monitor asked for no still once the scope was chosen')
      else {
        if (scopeAsk.template !== 'scope') problems.push(`the still asked for once the scope was chosen was of ${String(scopeAsk.template)}`)
        if (scopeAsk.scopeDraw !== 'dot' || scopeAsk.scopeZoom !== 1 || scopeAsk.scopePersist !== 0.5) problems.push(`the scope's still was asked for ${String(scopeAsk.scopeDraw)}/${String(scopeAsk.scopeZoom)}/persistence ${String(scopeAsk.scopePersist)} rather than the defaults`)
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
      // THE LED TEMPLATES, which are the bars with settings of their own. Choosing one has to bring the family's
      // knobs out AND the two the LED looks add, and it has to send the template's OWN density: the LED EQ opens
      // at sixteen bars where the plain bars open at sixty-four, so a still asked for at sixty-four would be a
      // drawing nobody chose — which is exactly the fault a defaults table can introduce.
      if (!audio.ledStill) problems.push('the monitor asked for no still once the LED EQ was chosen')
      else {
        if (audio.ledStill.template !== 'led-eq') problems.push(`the still asked for once the LED EQ was chosen was of ${String(audio.ledStill.template)}`)
        if (audio.ledStill.bars !== 16) problems.push(`the LED EQ's still was asked for ${String(audio.ledStill.bars)} bars rather than its own density`)
        if (audio.ledStill.segmented !== true || audio.ledStill.peakHold !== true) problems.push(`the LED EQ's still was asked for blocks ${String(audio.ledStill.segmented)} and hold ${String(audio.ledStill.peakHold)} rather than the LED look`)
      }
      if (!audio.ledToggles || !audio.ledToggles.includes('PEAK HOLD')) problems.push('the LED EQ was offered no peak hold switch')
      if (!audio.ledFields || !audio.ledFields.some((label) => label.startsWith('BLOCKS'))) problems.push('the LED EQ drew no control for the block gap')
      if (!audio.panelStill || audio.panelStill.template !== 'matrix-panel') problems.push('the monitor asked for no still of the matrix panel')
      else if (audio.panelStill.bars !== 24 || audio.panelStill.peakHold !== true) problems.push(`the matrix panel's still was asked for ${String(audio.panelStill.bars)} bars and hold ${String(audio.panelStill.peakHold)} rather than the panel's look`)
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
        // THE PROPERTIES DRAWER, whose cap is the whole of this pass: it must scroll rather than grow, hold
        // the five-row figure, keep its close button clear of the rows AND of the scroller's own bar, and
        // offer the two retiming options only where they mean something.
        const inspector = stitch.inspector
        if (!inspector || !inspector.opened) problems.push(`the PROPERTIES drawer never opened from the clip menu: ${JSON.stringify(inspector && inspector.reason)}`)
        else {
          if (inspector.overflowY !== 'auto') problems.push(`the drawer's rows do not scroll: overflow-y is ${JSON.stringify(inspector.overflowY)}`)
          if (!(inspector.scrollHeight > inspector.clientHeight)) problems.push(`the drawer is not actually overflowing, so its scrollbar and cap prove nothing (${inspector.scrollHeight} in ${inspector.clientHeight})`)
          if (!(inspector.rows >= 6)) problems.push(`only ${inspector.rows} rows were drawn, too few to overflow the cap`)
          if (Math.abs(inspector.clientHeight - inspector.cap) > 1) problems.push(`the drawer shows ${inspector.clientHeight}px of rows rather than its five-row cap of ${inspector.cap}px`)
          if (!inspector.closeOutsideScroller) problems.push('the close button is inside the scrolled list, so it scrolls out of reach')
          if (!inspector.closeAboveScroller) problems.push('the close button is not clear of the scroller, so it sits over the rows or their bar')
          if (inspector.closeOverlapsAControl) problems.push('the close button overlaps a value field, which is the overlap this pass removes')
          if (!inspector.closeVisible) problems.push('the close button is not on screen when the drawer opens')
          if (!inspector.closeVisibleAfterScroll) problems.push('the close button leaves the screen once the list is scrolled')
          // The arrow keys are the platform's own stepping, kept and made to stop at the bounds; and the
          // wheel is the figure's own gesture, which must not hand the drawer a scroll.
          if (inspector.fieldType !== 'number') problems.push(`a value field is a ${JSON.stringify(inspector.fieldType)} input, so the native steppers are gone`)
          if (inspector.wheelCancelled !== true) problems.push('a wheel over a value field was not cancelled, so the drawer scrolls out from under it')
          if (inspector.wheelSteppedTo !== '2.05') problems.push(`a wheel over a value field moved it to ${JSON.stringify(inspector.wheelSteppedTo)} rather than one 0.05 step from 2`)
          if (inspector.arrowCancelled !== true) problems.push('an arrow key in a value field was not cancelled')
          if (inspector.arrowSteppedTo !== '2.1') problems.push(`an arrow key moved the speed to ${JSON.stringify(inspector.arrowSteppedTo)} rather than one 0.05 step from 2.05`)
          if (inspector.atCeiling !== '16') problems.push(`a speed past the ceiling reads ${JSON.stringify(inspector.atCeiling)} rather than being held at 16`)
          if (inspector.steppedPastCeiling !== '16') problems.push(`an arrow key at the ceiling moved the speed to ${JSON.stringify(inspector.steppedPastCeiling)}`)
          // AND THE DURATION FIELD's own wheel and arrows. It is a TIMECODE field rather than a number one,
          // which is the shape the report was about: its gestures have to move the time it shows, and the
          // wheel has to come back cancelled for the same reason the speed field's does.
          if (inspector.durationWheelCancelled !== true) problems.push('a wheel over DURATION was not cancelled, so the drawer scrolls out from under it')
          if (inspector.durationWheelTo === inspector.durationWheelFrom) problems.push(`a wheel over DURATION left it on ${JSON.stringify(inspector.durationWheelTo)}, so the figure never moved`)
          if (!/^\d\d:\d\d:\d\d\.\d\d$/.test(String(inspector.durationWheelTo))) problems.push(`a wheel over DURATION left it reading ${JSON.stringify(inspector.durationWheelTo)} rather than a timecode`)
          if (inspector.durationArrowCancelled !== true) problems.push('an arrow key in DURATION was not cancelled')
          if (inspector.durationArrowTo === inspector.durationWheelTo) problems.push(`an arrow key in DURATION left it on ${JSON.stringify(inspector.durationArrowTo)}, so the figure never moved`)
          if (!/^\d\d:\d\d:\d\d\.\d\d$/.test(String(inspector.durationArrowTo))) problems.push(`an arrow key in DURATION left it reading ${JSON.stringify(inspector.durationArrowTo)} rather than a timecode`)
          // AND A TYPED FIGURE IS HELD UNTIL IT IS CONFIRMED. A timecode is typed whole, so nothing may be
          // applied while it is being typed, and a figure that is not a timecode must be refused rather
          // than run. The clip is twelve seconds, so a four-second length is a speed of three.
          if (inspector.durationTypedHeld !== '00:00:04.00') problems.push(`a typed timecode reads ${JSON.stringify(inspector.durationTypedHeld)} rather than what was typed`)
          if (inspector.typingHeldTheFigure !== true) problems.push(`a typed timecode moved the figure before it was confirmed: the speed went from ${JSON.stringify(inspector.speedBeforeTyping)} to ${JSON.stringify(inspector.speedWhileTyped)}`)
          if (inspector.durationTypedCommitted !== '00:00:04.00') problems.push(`Enter left DURATION on ${JSON.stringify(inspector.durationTypedCommitted)}`)
          if (inspector.speedAfterEnter !== '3') problems.push(`Enter on a four-second length left the speed at ${JSON.stringify(inspector.speedAfterEnter)} rather than 3`)
          if (inspector.durationAfterRefusal !== '00:00:04.00') problems.push(`a figure that is not a timecode was not refused: DURATION reads ${JSON.stringify(inspector.durationAfterRefusal)}`)
          // The four figures of the clip's own run, which replaced one long line.
          const readings = inspector.readings || {}
          for (const label of ['SOURCE', 'USED', 'START', 'END']) {
            if (!readings[label]) problems.push(`the drawer draws no ${label} figure for the clip it describes`)
          }
          if (readings.END === readings.START) problems.push('the clip\u2019s START and END read the same figure, so the range says nothing')
          // The DURATION readout: the field itself is the TIME, in the window's own shape, and the share
          // of the source the clip keeps sits beside it — 100% at the clip's own speed and 50% at twice it.
          if (!/^\d\d:\d\d:\d\d\.\d\d$/.test(String(inspector.durationAtOwnSpeed))) problems.push(`the DURATION field at the clip's own speed reads ${JSON.stringify(inspector.durationAtOwnSpeed)} rather than a timecode`)
          if (String(inspector.durationHintAtOwnSpeed) !== '- (100%)') problems.push(`the reading beside DURATION is ${JSON.stringify(inspector.durationHintAtOwnSpeed)} rather than 100% of the source`)
          if (!/^\d\d:\d\d:\d\d\.\d\d$/.test(String(inspector.durationAtTwice))) problems.push(`the DURATION field at 2x reads ${JSON.stringify(inspector.durationAtTwice)} rather than a timecode`)
          if (String(inspector.durationHintAtTwice) !== '- (50%)') problems.push(`the reading beside DURATION at 2x is ${JSON.stringify(inspector.durationHintAtTwice)} rather than 50% of the source`)
          // THE RATE THE CLIP'S FRAMES ARE READ AT, with the source's own beside it as the reference. ONE
          // editable figure — the eight presets plus a custom rung — and a rate of the clip's own RETIMES it
          // exactly as a speed does: the stubbed source is twelve seconds at 25 fps, so read at 12 its frames
          // are stretched to twenty-five seconds of timeline, and putting the rate back restores the length.
          if (String(inspector.fpsHint) !== 'SOURCE 25') problems.push(`the FPS field's reference reads ${JSON.stringify(inspector.fpsHint)} rather than the source's own rate`)
          if (!String(inspector.fpsValueAtSource).startsWith('25/')) problems.push(`a clip left at its source rate reads ${JSON.stringify(inspector.fpsValueAtSource)} rather than 25 fps`)
          for (const rate of ['24000/1001', '30000/1001', '60000/1001', 'custom']) {
            if (!(inspector.fpsOptions || []).includes(rate)) problems.push(`the FPS field offers no ${rate} rung`)
          }
          if (inspector.durationAfterRate === inspector.durationBeforeRate) problems.push(`reading the clip at 12 fps left its length on ${JSON.stringify(inspector.durationAfterRate)}, so the rate never retimed it`)
          if (String(inspector.durationAfterRateRestored) !== String(inspector.durationBeforeRate)) problems.push(`the rate was not put back: the length reads ${JSON.stringify(inspector.durationAfterRateRestored)} rather than ${JSON.stringify(inspector.durationBeforeRate)}`)
          // The way back, which appears only where there is something to put back.
          if (inspector.resetsAtOwnSpeed !== 0) problems.push(`${inspector.resetsAtOwnSpeed} reset button(s) are drawn on a clip nothing has been changed on`)
          if (!(inspector.resetsAtTwice >= 2)) problems.push(`a clip at 2x offers ${inspector.resetsAtTwice} reset button(s) rather than one for its speed and one for its length`)
          // The retiming options, asked either side of a speed being set. This clip is a SOUND, so the
          // interpolation — which fills the frames a speed leaves out — has no meaning for it and must not
          // be offered, while the pitch, which a sound has, must be.
          if (!inspector.atTwice) problems.push('the drawer offered no speed field to ask the retiming options of')
          else {
            if (inspector.atTwice.interpolation) problems.push('INTERPOLATION is offered for a clip of sound, which has no frames to fill')
            if (!inspector.atTwice.maintainPitch) problems.push('MAINTAIN AUDIO PITCH is not offered for a clip of sound, which is the one case it is for')
          }
        }
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
        // AND THE TWO STREAM TOGGLES, which the FORMAT decides. This job's container is a sound one, so
        // the picture it cannot write is off and cannot be switched on, and the sound it always writes is
        // on and cannot be switched off.
        const gates = cover.toggles || {}
        if (gates['EXPORT VIDEO'] && gates['EXPORT VIDEO'].checked) problems.push('a sound-only format shows EXPORT VIDEO checked, which is a picture it cannot write')
        if (gates['EXPORT VIDEO'] && !gates['EXPORT VIDEO'].disabled) problems.push('a sound-only format lets EXPORT VIDEO be switched on')
        if (gates['EXPORT AUDIO'] && !gates['EXPORT AUDIO'].checked) problems.push('a sound-only format shows EXPORT AUDIO unchecked, which is the sound it always writes')
        if (gates['EXPORT AUDIO'] && !gates['EXPORT AUDIO'].disabled) problems.push('a sound-only format lets EXPORT AUDIO be switched off')
        // AND ITS SOUND SETTINGS ARE NOT DISABLED. A WAV or an MP3 is a SOUND export: SAMPLE RATE, BITRATE
        // and CHANNELS were all drawn disabled for every audio-only container, which left the one format
        // that is nothing but sound with nothing to set.
        const audioOff = cover.audioDisabled || {}
        for (const label of ['sampleRate', 'bitrate', 'channels']) {
          if (audioOff[label] !== false) problems.push(`a sound-only format draws ${label} disabled, so the one format that is only sound has nothing to set`)
        }
        if (!cover.summary) problems.push('the sound-only job reported no summary at all')
        else if (String(cover.summary).includes('UNKNOWN')) problems.push(`a sound-only job still says UNKNOWN: ${String(cover.summary)}`)
      }
      // A VIDEO EXTRACTED TO SOUND, which is the case the sound reading missed: the source is a video, so
      // the job's own visuals are not 'audio', and the estimate was looking at the source's KIND rather
      // than at what the export writes.
      const videoToAudio = result.videoToAudio
      if (!videoToAudio) problems.push('the video-to-sound job reported nothing at all')
      else {
        if (!videoToAudio.summary) problems.push('the video-to-sound job reported no summary')
        else if (String(videoToAudio.summary).includes('UNKNOWN')) problems.push(`a video extracted to sound still says UNKNOWN: ${String(videoToAudio.summary)}`)
        if (videoToAudio.sampleRateDisabled !== false) problems.push('a video-to-sound job draws SAMPLE RATE disabled')
        if (videoToAudio.bitrateDisabled !== false) problems.push('a video-to-sound job draws BITRATE disabled')
        // A LOSSLESS codec has a depth to store and a lossy one has none: the field is read on both sides.
        if (!videoToAudio.depthForMp3 || videoToAudio.depthForMp3.drawn) problems.push('an MP3 was offered a BIT DEPTH, which is a control with nothing behind it')
        if (!videoToAudio.depthForWav || !videoToAudio.depthForWav.drawn) problems.push('a WAV was offered no BIT DEPTH, and its samples are the whole of what it stores')
        else {
          if (String(videoToAudio.depthForWav.options) !== '8,16,24,32') problems.push(`a WAV's BIT DEPTH offers ${JSON.stringify(videoToAudio.depthForWav.options)}`)
          if (videoToAudio.depthForWav.value !== '16') problems.push(`a WAV that named no depth opens on ${String(videoToAudio.depthForWav.value)} rather than sixteen`)
        }
        if (!videoToAudio.wavSummary || String(videoToAudio.wavSummary).includes('UNKNOWN')) problems.push(`a WAV job did not size itself: ${String(videoToAudio.wavSummary)}`)
      }

      // And the other side of that gate, read on the MOVIE job: both streams are choosable there.
      const movieToggles = rendered && rendered.toggles
      if (!movieToggles) problems.push('the movie job reported nothing about its stream toggles')
      else {
        if (!movieToggles['EXPORT VIDEO'] || movieToggles['EXPORT VIDEO'].disabled) problems.push('a movie container does not let EXPORT VIDEO be chosen')
        if (!movieToggles['EXPORT AUDIO'] || movieToggles['EXPORT AUDIO'].disabled) problems.push('a movie container does not let EXPORT AUDIO be chosen')
      }
      // THE RE-ENTRY. The window is already open, the job has moved in the queue, and NOTHING is pushed: the
      // pull is the only thing that can deliver it. What is asserted is that a pull happened at all (wired)
      // and that it reached the render (the summary's own name changed). Either alone would pass while the
      // other half was broken — a pull never called, or a pull called and ignored.
      const reentry = result.reentry
      if (!reentry) problems.push('the re-entry reported nothing at all')
      else {
        if (!(reentry.pulls >= 1)) problems.push(`the window never pulled the job it is editing (${reentry.pulls} pulls)`)
        if (reentry.nameBefore === 'pulled-by-focus.mp3') problems.push('the re-entry name was already on screen, so it proves nothing')
        if (reentry.name !== 'pulled-by-focus.mp3') problems.push(`a re-entry pulled a job and the window did not adopt it: the summary still reads ${JSON.stringify(reentry.name)}`)
      }
      // THE IMAGE TAB, which this pass added: the frame formats' own settings live here. A movie container
      // must offer NO IMAGE tab, a frame container must offer one, and each format's own knobs have to be
      // there and reach the queue. The engine half is `verify-codecs`'s.
      const imageOutput = result.imageOutput
      if (!imageOutput) problems.push('the GIF job reported nothing about its IMAGE OUTPUT control')
      else {
        if (!Array.isArray(imageOutput.tabsForMovie)) problems.push('the tab strip could not be read at all')
        else {
          if (imageOutput.tabsForMovie.includes('IMAGE')) problems.push('a movie container was offered an IMAGE tab, which has nothing to say about it')
          if (!imageOutput.tabsForGif.includes('IMAGE')) problems.push('a frame container was offered no IMAGE tab')
        }
        if (imageOutput.container !== 'gif') problems.push(`switching FORMAT to GIF left the window on ${String(imageOutput.container)}`)
        // The heading of a dropdown must not open it, nor may the field's own box — the padding and the rule
        // under a row are the label's own edges, which is what a reader aiming at a divider lands on — and
        // the trigger must still open it.
        if (imageOutput.headingOpened !== false) problems.push('clicking a selector\u2019s HEADING opened its dropdown')
        if (imageOutput.dividerOpened !== false) problems.push('clicking a field\u2019s own box, which is where its divider is, opened the dropdown')
        if (imageOutput.triggerOpened !== true) problems.push('clicking a selector\u2019s trigger did not open it, so the heading fix broke the control')
        if (!imageOutput.drawn) problems.push('a GIF container was offered no IMAGE OUTPUT control')
        if (String(imageOutput.options) !== 'still,animation,sequence') problems.push(`a GIF's IMAGE OUTPUT offers ${JSON.stringify(imageOutput.options)} rather than a single frame, an animation and a run`)
        if (imageOutput.value !== 'animation') problems.push(`a GIF job that named no mode opens on ${String(imageOutput.value)} rather than its animation`)
        if (!String(imageOutput.gifFields).includes('LOOP')) problems.push(`a GIF's IMAGE tab drew no LOOP control: ${JSON.stringify(imageOutput.gifFields)}`)
        if (String(imageOutput.loopOptions) !== 'regular,loop,bounce') problems.push(`the LOOP control offers ${JSON.stringify(imageOutput.loopOptions)}`)
        if (imageOutput.loopValue !== 'loop') problems.push(`a GIF that named no loop opens on ${String(imageOutput.loopValue)} rather than LOOP`)
        if (imageOutput.afterSequence !== 'sequence') problems.push(`choosing the run left the control on ${String(imageOutput.afterSequence)}`)
        if (imageOutput.loopDisabledForRun !== true) problems.push('the LOOP control stays choosable for a run of frames, which has no loop to set')
        if (imageOutput.sentMode !== 'sequence') problems.push(`the chosen run was never sent to the queue: ${String(imageOutput.sentMode)}`)
        if (imageOutput.sentContainer !== 'gif') problems.push(`the GIF job was sent as ${String(imageOutput.sentContainer)}`)
        // And the still-image container's own two, which the animated one does not carry.
        if (String(imageOutput.pngFields).includes('LOOP')) problems.push('a PNG was offered the animated format\u2019s own loop control')
        for (const expected of ['COMPRESSION', 'BIT DEPTH']) {
          if (!String(imageOutput.pngFields).includes(expected)) problems.push(`a PNG's IMAGE tab drew no ${expected} control: ${JSON.stringify(imageOutput.pngFields)}`)
        }
        if (String(imageOutput.compressionOptions) !== 'default,0,1,3,6,9,custom') problems.push(`the PNG compression ladder offers ${JSON.stringify(imageOutput.compressionOptions)}`)
        if (imageOutput.compressionCustomField !== true) problems.push('choosing CUSTOM for the PNG compression brought out no field to type a figure in')
        if (imageOutput.compressionAfterTyping !== 'custom') problems.push(`a typed compression left the ladder on ${String(imageOutput.compressionAfterTyping)}`)
        // THE TIER MOVES THE FIGURE, which is the report: a size keyed to nothing but the frame sat still
        // while the control beside it moved.
        if (!imageOutput.summaryAtLevel0 || imageOutput.summaryBeforeTier === imageOutput.summaryAtLevel0) problems.push(`changing the PNG compression tier did not move the estimated size: ${String(imageOutput.summaryBeforeTier)}`)
        if (String(imageOutput.qualityOptions) !== 'default,2,5,10,20,31,custom') problems.push(`the JPEG quality ladder offers ${JSON.stringify(imageOutput.qualityOptions)}`)
        if (!imageOutput.jpgSummaryBest || imageOutput.jpgSummaryBest === imageOutput.jpgSummarySmallest) problems.push(`changing the JPEG quality did not move the estimated size: ${String(imageOutput.jpgSummaryBest)}`)
        if (String(imageOutput.jpgSummaryBest).includes('UNKNOWN')) problems.push('a JPEG single frame still says UNKNOWN')
        if (String(imageOutput.bitDepthOptions) !== '8,16') problems.push(`the PNG bit depths offer ${JSON.stringify(imageOutput.bitDepthOptions)}`)
        // What a change of FORMAT makes of a run: it survives into another frame container, which is the
        // rule `applyContainerChange` states, read here through the control the user actually sees.
        if (imageOutput.imageBeforeApply !== 'sequence') problems.push(`a run chosen for a GIF read ${String(imageOutput.imageBeforeApply)} after moving to PNG rather than surviving as a run`)
        if (imageOutput.imageAfterStill !== 'still') problems.push(`choosing a single frame left the control on ${String(imageOutput.imageAfterStill)}`)
        if (imageOutput.sentContainer2 !== 'png') problems.push(`the PNG job was sent as ${String(imageOutput.sentContainer2)}`)
        if (imageOutput.sentCompression !== 7) problems.push(`a compression of 7 typed under CUSTOM was sent as ${String(imageOutput.sentCompression)}`)
        if (imageOutput.sentBitDepth !== 16) problems.push(`choosing 16-bit sent ${String(imageOutput.sentBitDepth)}`)
        // SINGLE FRAME carries the instant it is taken at, which the encoder is what turns into a seek.
        if (typeof imageOutput.sentStillFrame !== 'number') problems.push(`a SINGLE FRAME was sent with no instant to take it at: ${String(imageOutput.sentStillFrame)}`)
      }
      // THE DEPTH CONTROL: derived for ProRes, which has no choice to offer, and chosen for H.264/H.265,
      // which genuinely take both.
      const depth = result.depth
      if (!depth) problems.push('the window reported nothing about its DEPTH control')
      else {
        if (!depth.h264 || !depth.h264.drawn) problems.push('an H.264 job was offered no DEPTH control, and it takes both depths')
        else {
          if (String(depth.h264.options) !== '8,10') problems.push(`the H.264 depth offers ${JSON.stringify(depth.h264.options)} rather than eight and ten`)
          if (depth.h264.value !== '8') problems.push(`a job that named no depth opens on ${String(depth.h264.value)} rather than eight`)
          if (depth.h264.readOnly) problems.push('the H.264 depth is drawn read-only, so the choice cannot be made')
          // A HEADING CLICK MUST NOT PUT A SETTING BACK, and the reset itself must still work.
          if (depth.h264.resetDrawn !== true) problems.push('the depth field drew no reset button, so the heading test proves nothing')
          if (depth.h264.afterHeading !== '10') problems.push(`clicking the DEPTH heading put the setting back: the field reads ${String(depth.h264.afterHeading)} rather than the ten that was chosen`)
          if (depth.h264.afterReset !== '8') problems.push(`the reset button did not put the depth back: the field reads ${String(depth.h264.afterReset)} rather than eight`)
        }
        if (depth.sentDepth !== 10) problems.push(`choosing ten bits sent ${String(depth.sentDepth)}`)
        // THE BITRATE, which is a rate and is named for one, and is drawn only where the codec has a rate.
        if (!depth.h264Bitrate || !depth.h264Bitrate.drawn) problems.push('an H.264 job was offered no BITRATE field, and H.264 is rate-controlled')
        else {
          if (depth.h264Bitrate.disabled) problems.push('the BITRATE field is disabled for a codec that has a rate')
          if (depth.h264Bitrate.oldQualityLabel) problems.push('the old QUALITY label is still drawn, so the rename did not happen')
          // The tooltip has to describe the figure it is on rather than say there is none to set.
          if (!String(depth.h264Bitrate.title).includes('bits a second')) problems.push(`the H.264 bitrate tooltip does not describe a bitrate: ${JSON.stringify(depth.h264Bitrate.title)}`)
          if (String(depth.h264Bitrate.title).includes('NO BITRATE TO SET')) problems.push('the H.264 bitrate tooltip says there is no bitrate to set, beside a field that takes one')
        }
        if (!depth.proresBitrate) problems.push('a ProRes job reported nothing about its BITRATE field')
        else {
          if (!depth.proresBitrate.disabled) problems.push('a ProRes job offers a bitrate, which its fixed-rate profiles ignore')
          if (depth.proresBitrate.hint !== 'SET BY THE CODEC') problems.push(`the ProRes bitrate field's hint is ${JSON.stringify(depth.proresBitrate.hint)} rather than SET BY THE CODEC`)
        }
        if (!depth.prores) problems.push('a ProRes job reported nothing about its depth')
        else {
          if (!depth.prores.readOnly) problems.push('ProRes drew a depth CONTROL, which could only ever lie about what its profile decides')
          if (depth.prores.hasSelect) problems.push('ProRes was offered a depth dropdown')
          if (depth.prores.value !== '12-BIT + ALPHA') problems.push(`ProRes 4444 XQ reads ${String(depth.prores.value)} rather than 12-BIT + ALPHA`)
          if (depth.proresHint !== 'FROM THE PROFILE') problems.push(`the ProRes depth field's hint is ${JSON.stringify(depth.proresHint)} rather than FROM THE PROFILE`)
        }
      }
    }
    // AN IMAGE SOURCE'S ESTIMATE HAS TO MOVE WITH THE CODEC. A picture is sized by what it is written as,
    // so the SUMMARY has to recalculate when FORMAT and PRESET are recombined for a still-image clip and
    // for an image sequence — the two source kinds this was reported fixed for. Each figure is read as the
    // text between ESTIMATED SIZE and the dirty marker, and a reading that could not be found is a problem
    // of its own rather than a comparison of two nulls.
    const figureOf = (summary) => {
      const match = /ESTIMATED SIZE (.*?)(?:UNSAVED CHANGES|NO CHANGES|$)/.exec(String(summary ?? ''))
      return match ? match[1].trim() : null
    }
    const movingFigures = (label, readings, pairs) => {
      const missing = Object.entries(readings).filter(([, summary]) => figureOf(summary) == null).map(([key]) => key)
      if (missing.length) problems.push(`${label} reported no ESTIMATED SIZE for ${missing.join(', ')}`)
      for (const [left, right] of pairs) {
        const a = figureOf(readings[left]); const b = figureOf(readings[right])
        if (a != null && a === b) problems.push(`${label} estimate did not move between ${left} and ${right}: both read ${JSON.stringify(a)}`)
      }
    }
    if (!result.imageSource) problems.push('the still-image source job reported nothing about its estimate')
    else movingFigures('a still-image source\u2019s', result.imageSource, [
      ['mp4hevc', 'movprores'], ['png', 'jpg'], ['pngStill', 'pngSequence'],
    ])
    if (!result.imageSequence) problems.push('the image-sequence source job reported nothing about its estimate')
    else movingFigures('an image-sequence source\u2019s', result.imageSequence, [['mp4h264', 'mp4hevc'], ['mp4hevc', 'movprores'], ['pngRunLevel0', 'pngRunLevel9']])
    // TWO COPIES OF ONE FILE: the clip menu's REMOVE has to take the clip it was opened on, not the first
    // one with that path — which is what `indexOf` answers however many copies there are. The second copy
    // was removed, and the first (five seconds against the second's four) is what has to be left behind.
    const duplicate = result.duplicate
    if (!duplicate) problems.push('the duplicate-source job reported nothing about its removal')
    else {
      if (duplicate.beforeCount !== 2) problems.push(`the duplicate-source job drew ${duplicate.beforeCount} clips rather than two`)
      else {
        if (!String(duplicate.before[0]).includes('00:00:05.00')) problems.push(`the first of two copies does not read its own five seconds: ${JSON.stringify(duplicate.before[0])}`)
        if (!String(duplicate.before[1]).includes('00:00:04.00')) problems.push(`the second of two copies does not read its own four seconds: ${JSON.stringify(duplicate.before[1])}`)
      }
      if (duplicate.afterCount !== 1) problems.push(`removing one of two copies left ${duplicate.afterCount} clips rather than one`)
      const surviving = String((duplicate.after || [])[0] ?? '')
      if (!surviving.includes('00:00:05.00')) problems.push(`removing the second of two copies left the wrong clip behind: ${JSON.stringify(surviving)}`)
    }
    // WHAT A COPY IS CALLED, AND FRAMING THE SECOND ONE. A file imported twice is labelled by its copies on
    // the timeline box, in the monitor's line and in PROPERTIES; and the FRAMING controls have to reach that
    // SECOND copy. The label read on the timeline is `COPY 1 // name` and `COPY 2 // name`; the playhead has
    // to have moved to the second copy when PROPERTIES was opened on it, so the clip shown and described is
    // the one framed; and the crop written has to be filed under the SECOND copy's key rather than the first.
    const copyFraming = result.copyFraming
    if (!copyFraming) problems.push('the copy-framing drive reported nothing')
    else {
      const names = (copyFraming.clipNames || []).map((name) => String(name ?? ''))
      if (names.length !== 2) problems.push(`the duplicate job drew ${names.length} timeline boxes rather than two`)
      else {
        if (!names[0].includes('COPY 1')) problems.push(`the first copy's box is not labelled COPY 1: ${JSON.stringify(names[0])}`)
        if (!names[1].includes('COPY 2')) problems.push(`the second copy's box is not labelled COPY 2: ${JSON.stringify(names[1])}`)
      }
      if (copyFraming.activeCopyIndex !== 1) problems.push(`opening PROPERTIES on the second copy left the playhead on clip ${copyFraming.activeCopyIndex} rather than the second one`)
      if (!String(copyFraming.monitorLine).includes('COPY 2')) problems.push(`the monitor's own line does not name the copy it is showing: ${JSON.stringify(copyFraming.monitorLine)}`)
      if (!String(copyFraming.propertiesSource).includes('COPY 2')) problems.push(`PROPERTIES does not name the copy it describes: ${JSON.stringify(copyFraming.propertiesSource)}`)
      // The monitor's crop box is drawn against the picture it measured, and a repeated source does not reload
      // the element — so this is the reading that says the size travelled from the first copy to the second.
      if (!copyFraming.cropBoxDrawn) problems.push('the monitor drew no crop box for a crop set on the second copy, so its picture was never measured for it')
      if (!(copyFraming.cropShades > 0)) problems.push('the monitor drew no crop shading for a crop set on the second copy')
      const keys = (copyFraming.cropKeys || []).map((key) => String(key))
      if (!keys.some((key) => key.endsWith('#1'))) problems.push(`framing the second copy was filed under ${JSON.stringify(keys)} rather than the second copy's own key`)
      if (keys.some((key) => key.endsWith('#0'))) problems.push(`framing the second copy also touched the first copy: ${JSON.stringify(keys)}`)
    }
    // REORDERING AND TRIMMING ON THE TIMELINE. A clip dragged onto another has to take its place in the join
    // along with its own identity and its copy number; an edge dragged has to write THAT clip's window into its
    // source, and only that clip's. Two copies of one file are told apart by their lengths, so the reorder is
    // read as which duration now sits first.
    const gestures = result.timelineGestures
    if (!gestures) problems.push('the timeline-gesture drive reported nothing')
    else {
      const before = (gestures.beforeOrder || []).map((value) => String(value ?? ''))
      if (before.length !== 2) problems.push(`the timeline drew ${before.length} clips rather than two`)
      else {
        if (!before[0].includes('00:00:05')) problems.push(`the first copy does not lead with its five seconds: ${JSON.stringify(before[0])}`)
        if (!before[1].includes('00:00:04')) problems.push(`the second copy does not read its four seconds: ${JSON.stringify(before[1])}`)
      }
      // The trim: the readout and the shade are what the drag shows while the pointer is down, and the window it
      // writes is the second copy's, shortened from its out edge with its in point held.
      if (!gestures.trimReadout) problems.push('dragging an edge showed no readout')
      if (!(gestures.trimShades > 0)) problems.push('dragging an edge showed no shading of what it would take off')
      const entries = (gestures.trimEntries || [])
      // The job already trims BOTH copies (five and four seconds of the twelve-second source), so the reading
      // is not "one entry" but "the second copy's window changed and the first copy's did not".
      const trimmed = entries.find(([key]) => String(key).endsWith('#1'))
      const held = entries.find(([key]) => String(key).endsWith('#0'))
      if (!trimmed) problems.push(`the trim wrote nothing for the second copy: ${JSON.stringify(gestures.trimEntries)}`)
      else {
        if (!String(trimmed[0]).endsWith('#1')) problems.push(`the trim was filed under ${JSON.stringify(trimmed[0])} rather than the second copy's own key`)
        if (Math.abs(trimmed[1].in - 6) > 1e-6) problems.push(`the trim moved the in point, which should have been held: ${JSON.stringify(trimmed[1])}`)
        if (!(trimmed[1].out < 10 && trimmed[1].out > 6)) problems.push(`dragging the out edge left did not shorten the run: ${JSON.stringify(trimmed[1])}`)
      }
      if (held && (Math.abs(held[1].in) > 1e-6 || Math.abs(held[1].out - 5) > 1e-6)) problems.push(`the trim disturbed the first copy's own window: ${JSON.stringify(held[1])}`)
      const afterTrim = (gestures.afterTrim || []).map((value) => String(value ?? ''))
      if (afterTrim.length === 2 && afterTrim[1] === before[1]) problems.push(`dragging the out edge left the clip's length unchanged`)
      // The reorder: the second copy dropped onto the first is now first, and the ids and numbers travelled.
      const after = (gestures.afterOrder || []).map((value) => String(value ?? ''))
      if (after.length === 2 && afterTrim.length === 2) {
        if (after[0] !== afterTrim[1]) problems.push(`the dragged clip did not land first: ${JSON.stringify(after)} vs ${JSON.stringify(afterTrim)}`)
        if (after[1] !== afterTrim[0]) problems.push(`the clip it was dropped on did not take second place: ${JSON.stringify(after)} vs ${JSON.stringify(afterTrim)}`)
      }
      const ids = (gestures.reorderIds || []).map((value) => String(value ?? ''))
      if (ids.length !== 2 || !ids[0].endsWith('#1') || !ids[1].endsWith('#0')) problems.push(`the reorder did not carry the ids with the clips: ${JSON.stringify(ids)}`)
      if (JSON.stringify(gestures.reorderNumbers) !== JSON.stringify([2, 1])) problems.push(`the reorder did not carry the copy numbers: ${JSON.stringify(gestures.reorderNumbers)}`)
    }
    if (result.errors && result.errors.length) problems.push(...result.errors.map((error) => 'the page threw: ' + error))
  }
  console.log(JSON.stringify(result, null, 2))
  fs.unlinkSync(htmlPath)
  fs.unlinkSync(bundle)
  try { fs.rmSync(fixtureDir, { recursive: true, force: true }) } catch {}
  if (problems.length) {
    console.error(`\n${problems.length} MOUNT PROBLEM(S)\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`)
  } else {
    console.log('\nTHE EDITOR WINDOW RENDERS\n')
  }
  app.exit(problems.length ? 1 : 0)
}).catch((error) => { console.error('HARNESS FAILED', error); app.exit(1) })
