# Stitch Up Media

A macOS encoder for joining, stacking and drawing sound and picture, driven by FFmpeg from an all-caps
CRT-styled window. Electron + React + TypeScript.

## Installing

The app is **unsigned and not notarised** — there is no paid Apple Developer plan behind it — so macOS
quarantines the download and refuses the first launch. Drag it to Applications, then clear the flag:

```sh
xattr -dr com.apple.quarantine "/Applications/Stitch Up Media.app"
```

Or right-click the app in Finder and choose **Open** on the first launch, which does the same thing for that
one launch. The step is needed on **every** download; a signed build is not possible without the paid plan.
Builds are published as GitHub Releases, each with a DMG and a zip.

This app is also offered in Finder's **Open With…** list for the media it reads (video, sound and stills). It is
registered as an ALTERNATE handler, so it never takes a file type away from QuickTime or Preview; picking it
opens the app on the same CONVERT / STITCH UP / MULTI-TRACK / COMBO question a hand-picked set gets. Adding a
file while the app is already running forwards it to the running window rather than starting a second one.

**Check for Updates…** (in the app menu, below About, and in Settings) compares the running version with the
newest release, then downloads its disk image, opens it in Finder and points at Applications — the download is
made by the app, so the copy you drag across carries no quarantine flag. Nothing is installed without that
drag: the app never replaces its own bundle.

The check reads the GitHub releases API **anonymously**, so the release it compares against has to be publicly
readable: GitHub answers a private repository with 404. While this repository is private the check says it could
not reach GitHub — either make it public, or point `UPDATE_RELEASES_API` in `electron/updater.ts` at a public feed
that carries the same version tag and a `.dmg` asset.

## Developing

Needs Node, and `ffmpeg` and `ffprobe` on `PATH`.

- `npm run dev` — the window, with hot reload.
- `npm run build` — typecheck and build the renderer and the main process.
- `npm run dist` — package the macOS DMG and zip into `release/`.

The suite is a set of harnesses rather than one test runner. Each prints what it checked and exits non-zero
when something failed: `typecheck`, `verify` (the arithmetic behind the
timeline), `verify-fit`, `verify-speed`, `verify-codecs`, `verify-run`, `verify-wave`, `check-tail` (the
encoder, on generated fixtures), `check-mount` (the EDIT JOB window, really mounted), `check-queue` (a QUEUE
card, really mounted, measured where it drew), `check-proxy`, `check-open-files` (the Finder hand-off: which
arguments are media, and the drain-once buffer), `check-audio-peaks` (a real 5.1 wav's waveform, with the event
loop watched during the decode), `check-update` (the update check against a stand-in for GitHub, and against the
real API with `UPDATE_LIVE=1`), `check-app-menu` (the CHECK FOR UPDATES… item, in a bare Electron process) and
`measure` (pixel positions against the built stylesheet). `check-monitor` is run on its own.

`UI_DESIGN.md` and `WINDOW_ARCHITECTURE.md` hold the design notes.
