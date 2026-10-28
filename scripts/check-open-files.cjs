// Exercises what the app does with a file Finder hands it: which arguments count as media, what the
// drain-once buffer answers, and whether the Finder declaration and the importer still agree about the
// extension list.
//
// The hand-off itself (a real double-click in Finder, LaunchServices picking the app out of "Open With…")
// needs an INSTALLED, PACKAGED build and cannot be driven from here; what is asserted below is every part
// of it that decides, plus the wiring inside main.ts.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { OPEN_WITH_EXTENSIONS, openFilePathOf, openFilePaths, createOpenFileBuffer } = require('./.openFiles.cjs')

const problems = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       ${detail}`}`)
  if (!ok) problems.push(label)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-up-open-'))
const anywhere = () => true

console.log('\n== what one argument names ==')
check('an absolute path is taken as itself', openFilePathOf('/tmp/clip.mp4') === '/tmp/clip.mp4', String(openFilePathOf('/tmp/clip.mp4')))
check('a file URL is decoded', openFilePathOf('file:///tmp/a%20take.mov') === '/tmp/a take.mov', String(openFilePathOf('file:///tmp/a%20take.mov')))
check('a relative path names nothing', openFilePathOf('clip.mp4') === null, String(openFilePathOf('clip.mp4')))
check('a flag names nothing', openFilePathOf('--no-sandbox') === null, String(openFilePathOf('--no-sandbox')))
check('an empty entry names nothing', openFilePathOf('') === null, String(openFilePathOf('')))
check('a bare file URL with no path names nothing', openFilePathOf('file://') === null, String(openFilePathOf('file://')))
check('and neither does a filesystem root', openFilePathOf('/') === null, String(openFilePathOf('/')))

console.log('\n== which of them are media ==')
// The predicate decides what exists; nothing here is on disk.
const named = openFilePaths([
  '/media/clip.MP4',          // upper case extension — Finder does not normalise it
  'file:///media/take%20two.mov',
  '/media/notes.txt',         // not a media type
  '/media/clip.MP4',          // the same file again, spelled the same way
  'relative.mp4',             // not absolute
  '--enable-logging',
  '/media/cover.TIFF',
  '/Applications/Stitch Up Media.app', // the app itself, which is not a job
], anywhere)
check('the media are kept, in order, deduplicated', same(named, ['/media/clip.MP4', '/media/take two.mov', '/media/cover.TIFF']), JSON.stringify(named))

// Against the real filesystem: a directory can be named `.mp4`, and only a FILE is a source.
fs.mkdirSync(path.join(root, 'folder.mp4'))
fs.writeFileSync(path.join(root, 'real.mp4'), '')
fs.writeFileSync(path.join(root, 'real.txt'), '')
const onDisk = openFilePaths([path.join(root, 'real.mp4'), path.join(root, 'folder.mp4'), path.join(root, 'real.txt'), path.join(root, 'missing.mp4')])
check('a file that is there is kept', same(onDisk, [path.join(root, 'real.mp4')]), JSON.stringify(onDisk))
check('a directory named like a clip is not', !onDisk.includes(path.join(root, 'folder.mp4')), JSON.stringify(onDisk))
check('and a file that is not there is not', !onDisk.includes(path.join(root, 'missing.mp4')), JSON.stringify(onDisk))

console.log('\n== the buffer the window pulls ==')
const buffer = createOpenFileBuffer(anywhere)
const first = buffer.push(['/a.mp4', '/b.wav'])
check('a first hand-off is all new', same(first, ['/a.mp4', '/b.wav']), JSON.stringify(first))
const second = buffer.push(['/b.wav', '/c.png'])
check('a file already waiting is not announced twice', same(second, ['/c.png']), JSON.stringify(second))
const taken = buffer.drain()
check('taking them empties it', same(taken, ['/a.mp4', '/b.wav', '/c.png']), JSON.stringify(taken))
const takenAgain = buffer.drain()
check('and a second take is empty, so a reload cannot re-ask', same(takenAgain, []), JSON.stringify(takenAgain))
const nothing = buffer.push([])
check('an empty hand-off announces nothing', same(nothing, []), JSON.stringify(nothing))
const afterEmpty = buffer.push(['/a.mp4'])
check('and after emptying, the same file is new again', same(afterEmpty, ['/a.mp4']), JSON.stringify(afterEmpty))
buffer.drain()

console.log('\n== Finder is offered the types the importer accepts ==')
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const associations = pkg.build?.mac?.fileAssociations || []
const declared = associations.flatMap((association) => association.ext || [])
check('the app declares document types at all', associations.length > 0, JSON.stringify(associations))
check('every declared extension is one the importer accepts, and each exactly once',
  same([...declared].sort(), [...OPEN_WITH_EXTENSIONS].sort()),
  `declared ${JSON.stringify([...declared].sort())}\nimporter ${JSON.stringify([...OPEN_WITH_EXTENSIONS].sort())}`)
check('no extension is declared twice', new Set(declared).size === declared.length, JSON.stringify(declared))
// ROLE: Editor keeps the app in the list. The rank is what decides whether it takes the association
// away from QuickTime and Preview, which is not what was asked for — an OPTION in the list was.
check('every association claims to be an editor', associations.every((association) => association.role === 'Editor'), JSON.stringify(associations.map((a) => a.role)))
check('and none of them claim to be the default handler', associations.every((association) => association.rank === 'Alternate'), JSON.stringify(associations.map((a) => a.rank)))

console.log('\n== the wiring that has to be there ==')
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.ts'), 'utf8')
const openFileAt = main.indexOf("app.on('open-file'")
const readyAt = main.indexOf('app.whenReady()')
check('the lock is requested', main.includes('app.requestSingleInstanceLock()'), 'requestSingleInstanceLock is not called')
check('a second launch is forwarded rather than ignored', main.includes("app.on('second-instance'"), 'no second-instance handler')
// The one that is easy to get wrong: the listener must exist before the app is ready, or the file that
// LAUNCHED the app is announced to nobody.
check('the open-file listener is registered before the app is ready', openFileAt >= 0 && readyAt >= 0 && openFileAt < readyAt, `open-file at ${openFileAt}, whenReady at ${readyAt}`)
check('and what it collects is taken by the window', main.includes("ipcMain.handle('get-open-files'"), 'no get-open-files handler')

fs.rmSync(root, { recursive: true, force: true })
console.log(problems.length ? `\n${problems.length} OPEN-FILE PROBLEM(S)\n` : '\nFINDER-OPENED FILES REACH THE JOB-TYPE CONFIRMATION, AND ONLY THE TYPES THE IMPORTER ACCEPTS ARE DECLARED\n')
process.exit(problems.length ? 1 : 0)
