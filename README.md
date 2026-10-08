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

## Developing

Needs Node, and `ffmpeg` and `ffprobe` on `PATH`.

- `npm run dev` — the window, with hot reload.
- `npm run build` — typecheck and build the renderer and the main process.
- `npm run dist` — package the macOS DMG and zip into `release/`.

The suite is a set of harnesses rather than one test runner. Each prints what it checked and exits non-zero
when something failed: `typecheck`, `verify` (the arithmetic behind the
timeline), `verify-fit`, `verify-speed`, `verify-codecs`, `verify-run`, `verify-wave`, `check-tail` (the
encoder, on generated fixtures), `check-mount` (the EDIT JOB window, really mounted), `check-queue` (a QUEUE
card, really mounted, measured where it drew), `check-proxy` and `measure` (pixel positions against the built
stylesheet). `check-monitor` is run on its own.

`UI_DESIGN.md` and `WINDOW_ARCHITECTURE.md` hold the design notes.
