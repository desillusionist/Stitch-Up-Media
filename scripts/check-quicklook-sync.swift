import AppKit
import AVFoundation

/**
 * The strip's spatial zoom, proved at runtime.
 *
 * `check-scale` asserts the arithmetic — that a zoom gives a rate, the rate gives the strip its width, and
 * fixed-width tiles are laid across it. This asserts that the VIEW is built on it: that the strip is really
 * as wide as the model says, that zooming really does pack more tiles across the same source rather than
 * magnifying them, that the skimmer really does keep its place, and that the pictures in the tiles really
 * are the frames the plan names.
 *
 * The last one is why the fixture is what it is. Every frame of it is a solid grey three levels above the
 * one before, so a tile's average colour NAMES its frame — the harness can therefore say which frames the
 * strip is showing rather than merely that something changed.
 *
 * Usage: npm run check-sync
 */
@main
enum CheckQuickLookSync {
    static var failures = 0

    static func section(_ title: String) { print("\n== \(title) ==") }

    static func check(_ label: String, _ ok: Bool, _ detail: @autoclosure () -> String) {
        print(ok ? "  ok   \(label)" : "  FAIL \(label)\n       \(detail())")
        if !ok { failures += 1 }
    }

    /** A frame, reduced to one average colour: `R,G,B`. Drawn down to a pixel rather than sampled at one. */
    static func signature(_ image: CGImage?) -> String {
        guard let image else { return "none" }
        var pixel = [UInt8](repeating: 0, count: 4)
        guard let context = CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return "no-context" }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return "\(pixel[0]),\(pixel[1]),\(pixel[2])"
    }

    /** The grey level a signature stands for, which for this fixture is a frame number. */
    static func level(_ signature: String) -> Int? {
        let channels = signature.split(separator: ",").compactMap { Int($0) }
        guard channels.count == 3 else { return nil }
        return (channels[0] + channels[1] + channels[2]) / 3
    }

    static func frame(at seconds: Double, of asset: AVAsset) -> CGImage? {
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        return try? generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600), actualTime: nil)
    }

    @discardableResult
    static func run(_ launchPath: String, _ arguments: [String]) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: launchPath)
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch {
            print("  FAIL could not run \(launchPath): \(error)")
            failures += 1
            return -1
        }
        process.waitUntilExit()
        return process.terminationStatus
    }

    static func pump(_ seconds: Double) {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
    }

    /// Runs until the zoom has stopped moving for a while, which is a glide having finished.
    static func settle(_ filmstrip: FilmstripView, timeout: Double = 8) {
        let deadline = Date().addingTimeInterval(timeout)
        var last = -1.0, stable = 0
        while Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.05))
            if abs(filmstrip.zoom - last) < 1e-9 { stable += 1; if stable >= 8 { return } } else { stable = 0; last = filmstrip.zoom }
        }
    }

    /// What every tile the strip is showing holds: the view it is in, and the frame it is bound to.
    static func tiles(_ filmstrip: FilmstripView) -> [(view: NSView, frame: Int)] {
        zip(filmstrip.tileViews, filmstrip.tileFrames).filter { !$0.0.isHidden && $0.1 >= 0 }.map { (view: $0.0, frame: $0.1) }
    }

    /**
     * Which tiles are showing a frame that is NOT from their own share of the strip, with the figures.
     *
     * The rule the whole strip rests on: a tile covers a stretch of the source, and the picture in it has to
     * come from that stretch. Stated as a range rather than as the exact middle, because the middle of a
     * one-frame share is a half frame whose rounding is a choice — what is not a choice is that the frame
     * belongs to the tile showing it.
     */
    static func shareProblems(_ list: [(view: NSView, frame: Int)], pxPerFrame: Double, cell: Double, offset: Double) -> [String] {
        list.compactMap { tile in
            let stripX = Double(tile.frame) * pxPerFrame
            let left = Double(tile.view.frame.minX) + offset
            if stripX >= left - 1.5 && stripX <= left + cell + 1.5 { return nil }
            return "frame \(tile.frame) at \(Int(stripX))px where its share is \(Int(left))..\(Int(left + cell))"
        }
    }

    static func main() {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)

        let root = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("stitch-up-sync-\(ProcessInfo.processInfo.processIdentifier)")
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        print("testing binary: \(CommandLine.arguments.first ?? "?")")

        // Six seconds at ten frames a second, every frame a solid grey three levels above the last, so a
        // frame's number can be READ BACK from any tile showing it.
        let video = root.appendingPathComponent("ramp.mp4")
        let status = run("/usr/bin/env", ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "color=c=black:s=320x180:r=10:d=6",
            "-vf", "geq=lum='20+3*N':cb=128:cr=128",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", video.path])
        check("the fixture is built", status == 0, "ffmpeg exited \(status)")
        guard status == 0 else { exit(1) }

        let asset = AVAsset(url: video)
        let duration = asset.duration.seconds
        let rate = 10.0
        let totalFrames = max(1, Int((duration * rate).rounded()))
        let levels = (0..<totalFrames).map { level(signature(frame(at: Double($0) / rate, of: asset))) ?? -1 }
        print("  the fixture's frames read as: \(levels.prefix(6)) … \(levels.suffix(3))")

        section("the strip as the window opens")
        let width: CGFloat = 900, height: CGFloat = 82
        let filmstrip = FilmstripView(asset: asset, duration: duration, sourceAspect: 320.0 / 180.0, isAudio: false, frameRate: rate, frame: NSRect(x: 0, y: 0, width: width, height: height))
        let container = NSView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        container.addSubview(filmstrip)
        filmstrip.frame = container.bounds
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = container
        window.alphaValue = 0
        window.setFrameOrigin(NSPoint(x: -5000, y: -5000))
        window.orderBack(nil)
        container.layoutSubtreeIfNeeded()
        filmstrip.needsLayout = true
        filmstrip.layoutSubtreeIfNeeded()
        pump(1.5)

        check("the source is the six seconds it was built as", totalFrames == 60, "\(totalFrames)")
        check("the strip is laid out", filmstrip.bounds.width == width, "\(filmstrip.bounds.width)")
        check("and something was asked to be laid out in it", !filmstrip.tileViews.isEmpty, "no tile views at all")
        // Opening Quick Look is not a statement about which trim bound the user means, so neither handle is
        // picked out until one is taken hold of or a hotkey names it — the skimmer is the one in hand.
        check("neither trim handle is active when the window opens", filmstrip.selectedHandle == "playhead", "\(filmstrip.selectedHandle)")
        check("so neither is drawn as active", (filmstrip.inHandle.layer?.borderWidth ?? 0) == 0 && (filmstrip.outHandle.layer?.borderWidth ?? 0) == 0, "in \(filmstrip.inHandle.layer?.borderWidth ?? -1), out \(filmstrip.outHandle.layer?.borderWidth ?? -1)")

        let overview = tiles(filmstrip)
        let overviewZoom = filmstrip.zoom
        let overviewTileWidth = filmstrip.tiling.thumbWidth
        let overviewTilingCount = filmstrip.tiling.count
        let overviewFrameStep = filmstrip.tiling.step
        print("  at the fit: zoom \(String(format: "%.4f", overviewZoom)), strip \(Int(filmstrip.stripWidth))px of \(Int(width))px, \(overview.count) tiles, tile \(Int(overviewTileWidth))px")
        // FIT is the whole source in the room there is: the strip IS the viewport, which is what "not zoomed
        // in" means in this model.
        check("the whole source fits the window to begin with", abs(filmstrip.stripWidth - Double(width)) < 1.5, "strip \(filmstrip.stripWidth) in \(width)")
        check("so nothing is scrolled off", filmstrip.offset == 0, "\(filmstrip.offset)")
        // The tiles span the source, and every one of them shows a frame from its own share of it — which is
        // the rule that makes a strip read as the source rather than as every nth frame of it.
        check("the tiles reach the end of the source", (overview.last?.frame ?? -1) > totalFrames - 12, "\(overview.map { $0.frame })")
        let overviewPx = filmstrip.stripWidth / Double(totalFrames)
        let overviewCell = filmstrip.tiling.cellWidth
        let overviewProblems = shareProblems(overview, pxPerFrame: overviewPx, cell: overviewCell, offset: filmstrip.offset)
        check("and every tile shows a frame from its own share of the strip", overviewProblems.isEmpty, overviewProblems.joined(separator: "; "))

        section("a zoom in")
        // Pivoted on the skimmer, halfway along, so whether it keeps its place can be measured rather than
        // assumed. The gesture is repeated so the strip travels a long way: the pace is deliberately gentle, so
        // one tick is not a test.
        filmstrip.playheadValue = 0.5
        let skimmerBefore = filmstrip.screenX(forValue: filmstrip.playheadValue)
        for _ in 0..<24 { filmstrip.zoom(byDelta: -1000) }
        settle(filmstrip)
        pump(2.5)

        let zoomedIn = tiles(filmstrip)
        let zoom = filmstrip.zoom
        let factor = zoom / overviewZoom
        let tileWidth = filmstrip.tiling.thumbWidth
        print("  after the zoom: zoom \(String(format: "%.4f", zoom)), strip \(Int(filmstrip.stripWidth))px, \(zoomedIn.count) tiles, tile \(Int(tileWidth))px")
        check("the zoom went in", factor > 3.5, "only \(factor)x")
        check("the strip is that much wider", abs(filmstrip.stripWidth / Double(width) - factor) < 0.05, "\(filmstrip.stripWidth / Double(width))x the window for a \(factor)x zoom")
        check("and the source is still the same source", totalFrames == 60, "\(totalFrames)")
        // THE POINT. The tiles are the same size and there are many more of them, so the expansion is
        // density across the source and not magnification of it — which is what was missing.
        check("a tile is still a tile", abs(tileWidth - overviewTileWidth) < 0.5, "\(tileWidth) was \(overviewTileWidth)")
        // The tiles ACROSS THE SOURCE, which is the plan's own count: what is IN the window stays about a
        // window's worth however far it is zoomed, because a window only ever holds a window's worth.
        check("so the strip holds far more of them", Double(filmstrip.tiling.count) > Double(overviewTilingCount) * 2.5, "\(filmstrip.tiling.count) was \(overviewTilingCount)")
        check("and they are packed that much closer", filmstrip.tiling.step < overviewFrameStep / 2.5, "step \(filmstrip.tiling.step) was \(overviewFrameStep)")
        let zoomedProblems = shareProblems(zoomedIn, pxPerFrame: filmstrip.stripWidth / Double(totalFrames), cell: filmstrip.tiling.cellWidth, offset: filmstrip.offset)
        check("every tile in the window shows a frame from its own share", zoomedProblems.isEmpty, zoomedProblems.joined(separator: "; "))
        check("and each of them is a DIFFERENT frame, so the strip is not repeating itself", Set(zoomedIn.map { $0.frame }).count == zoomedIn.count, "\(zoomedIn.map { $0.frame })")

        // The skimmer: the frame it is on keeps its place on screen while the strip stretches around it.
        let skimmerAfter = filmstrip.screenX(forValue: filmstrip.playheadValue)
        print("  the skimmer stood at \(Int(skimmerBefore))px and stands at \(Int(skimmerAfter))px")
        check("the skimmer keeps its place on screen through the zoom", abs(skimmerAfter - skimmerBefore) < 2, "moved from \(skimmerBefore) to \(skimmerAfter)")
        // And it is in the window, not scrolled away from.
        check("and it is inside the window", skimmerAfter >= 0 && skimmerAfter <= width, "\(skimmerAfter)")

        section("the trim, in the stretched space")
        // A trim handle is drawn where its FRAME is, not where a share of the window falls, and is not held
        // inside the view: at this zoom the in-point is off the left of the window and stays there.
        filmstrip.start = 0.02
        filmstrip.end = 0.06
        pump(0.2)
        let inX = filmstrip.inHandle.frame.minX
        let outX = filmstrip.outHandle.frame.maxX
        print("  in-point at \(Int(inX))px, out-point at \(Int(outX))px, window \(Int(width))px")
        check("the in-point is drawn where its frame is, off the left of the window", inX < 0, "\(inX)")
        check("and the out-point follows it in the stretched space", outX > inX + 20, "\(inX) to \(outX)")
        // Scrolled to the start, both are in the window, which is the same drawing seen from elsewhere.
        filmstrip.start = 0.02
        filmstrip.end = 0.06
        filmstrip.playheadValue = 0.01
        for _ in 0..<30 { filmstrip.zoom(byDelta: 1000) }
        settle(filmstrip)
        pump(0.6)
        print("  after zooming back out: zoom \(String(format: "%.3f", filmstrip.zoom)), strip \(Int(filmstrip.stripWidth))px, in-point at \(Int(filmstrip.inHandle.frame.minX))px")
        check("zooming back out brings the whole source inside the window again", filmstrip.stripWidth <= Double(width) + 1, "strip \(filmstrip.stripWidth)")
        check("and the handle is back in it", filmstrip.inHandle.frame.minX >= 0, "\(filmstrip.inHandle.frame.minX)")

        section("the pictures in the tiles")
        // The one thing the arithmetic cannot say: that what is DRAWN is the frame the plan names. Every tile
        // in view is read back from its layer, and its colour has to be the fixture's colour for its frame.
        for _ in 0..<3 { filmstrip.zoom(byDelta: -400); pump(0.05) }
        settle(filmstrip)
        pump(3.0)
        let shown = tiles(filmstrip)
        var matched = 0
        var reported = 0
        for tile in shown {
            guard let contents = tile.view.layer?.contents else { continue }
            guard let value = level(signature(contents as! CGImage)) else { continue }
            let reference = levels[min(max(tile.frame, 0), levels.count - 1)]
            if abs(value - reference) <= 2 { matched += 1 } else if reported < 4 {
                reported += 1
                print("    tile for frame \(tile.frame) reads \(value) where the source reads \(reference)")
            }
        }
        print("  \(matched) of \(shown.count) tiles read back as the frame they name")
        check("every tile in view shows the frame it was given", matched == shown.count && shown.count > 3, "\(matched) of \(shown.count)")

        section("a key that moves the skimmer brings it back on screen")
        // An arrow key moves the skimmer, and the frame it lands on has to be on screen — the same thing a drag
        // does. Without this the skimmer moves off the edge of the strip and the monitor shows a frame nobody
        // can point at.
        for _ in 0..<24 { filmstrip.zoom(byDelta: -1000) }
        settle(filmstrip)
        filmstrip.playheadValue = 0.98
        filmstrip.revealSkimmer()
        pump(0.4)
        let revealedX = filmstrip.screenX(forValue: filmstrip.playheadValue)
        print("  the skimmer stands at \(Int(revealedX))px of \(Int(width)) after a reveal")
        check("a reveal brings the skimmer back into the window", revealedX >= 0 && revealedX <= width + 0.5, "\(revealedX) in \(width)")

        section("the trim overlay over the pictures")
        // The bounds, the handles and the skimmer are what the strip is FOR. A tile drawn on top of them hides
        // the very thing being moved, so every tile has to sit BEHIND all four — which in a view's back-to-
        // front subview order means a lower index.
        let depth = filmstrip.subviews
        let overlay = [filmstrip.selectionView, filmstrip.inHandle, filmstrip.outHandle, filmstrip.playhead]
        let tileAt = filmstrip.tileViews.compactMap { tile in depth.firstIndex(where: { $0 === tile }) }
        let overlayAt = overlay.compactMap { item in depth.firstIndex(where: { $0 === item }) }
        check("the trim overlay and the tiles are all in the view", overlayAt.count == overlay.count && tileAt.count == filmstrip.tileViews.count, "overlays \(overlayAt.count), tiles \(tileAt.count)")
        check("every tile is drawn behind the trim overlay", tileAt.allSatisfy { tile in overlayAt.allSatisfy { $0 > tile } }, "a tile sits above a trim control")

        section("a skim reaches the monitor")
        // The one thing the arithmetic cannot say: that a skim — the arrow keys' own path to the monitor — hands
        // the frame it landed on to the view that shows it. Every tile is a frame at its own place now, so the
        // skim's remainder is exactly this hand-off, and it is what the arrows go through.
        var skimmed: Double = -1
        filmstrip.onHoverTime = { value in skimmed = value }
        filmstrip.skimThumbnail(at: 0.42)
        check("a skim hands the monitor the frame it landed on", abs(skimmed - 0.42) < 1e-9, "\(skimmed)")
        filmstrip.skimThumbnail(at: 2.0)
        check("and it is held inside the source", abs(skimmed - 1.0) < 1e-9, "\(skimmed)")
        filmstrip.onHoverTime = nil

        section("a resize re-fits the strip to the room")
        // The strip is never narrower than its window — that is what the fit IS — so the room decides the
        // floor. Widening the window therefore re-fits a strip that was the whole source rather than leaving
        // it short of the window, and narrowing re-fits it the same way. A zoom the user CHOSE is kept: only
        // the fit moves.
        let resized = FilmstripView(asset: asset, duration: duration, sourceAspect: 320.0 / 180.0, isAudio: false, frameRate: rate, frame: NSRect(x: 0, y: 0, width: 700, height: height))
        container.addSubview(resized)
        resized.frame = NSRect(x: 0, y: 0, width: 700, height: height)
        resized.needsLayout = true
        resized.layoutSubtreeIfNeeded()
        pump(1.0)
        check("the strip fills the window it opened in", abs(resized.stripWidth - 700) < 1.5, "strip \(resized.stripWidth) in 700")
        check("and its zoom is that room's fit", abs(resized.zoom - stripFitZoom(duration: duration, availableWidth: 700)) < 1e-9, "\(resized.zoom)")
        resized.frame = NSRect(x: 0, y: 0, width: 1100, height: height)
        resized.needsLayout = true
        resized.layoutSubtreeIfNeeded()
        pump(0.8)
        check("widening the window re-fits the strip to it", abs(resized.stripWidth - 1100) < 1.5, "strip \(resized.stripWidth) in 1100")
        check("and nothing is scrolled off", resized.offset == 0, "\(resized.offset)")
        resized.frame = NSRect(x: 0, y: 0, width: 500, height: height)
        resized.needsLayout = true
        resized.layoutSubtreeIfNeeded()
        pump(0.8)
        check("narrowing it re-fits it too", abs(resized.stripWidth - 500) < 1.5, "strip \(resized.stripWidth) in 500")
        resized.playheadValue = 0.5
        for _ in 0..<20 { resized.zoom(byDelta: -1000) }
        settle(resized)
        let keptZoom = resized.zoom
        resized.frame = NSRect(x: 0, y: 0, width: 1000, height: height)
        resized.needsLayout = true
        resized.layoutSubtreeIfNeeded()
        pump(0.5)
        check("a resize keeps a zoom the user chose", abs(resized.zoom - keptZoom) < 1e-9, "\(resized.zoom) was \(keptZoom)")
        check("and the drawing is still inside its own strip", resized.offset >= -1e-6 && resized.offset <= max(0, resized.stripWidth - 1000) + 1e-6, "offset \(resized.offset) of strip \(resized.stripWidth)")

        section("dragging a trim handle")
        // The one path none of the checks above can reach. Every one of them sets `start`/`end` directly, so a
        // strip whose handles could not be dragged at all would pass the lot. This sends REAL mouse events
        // through the window, which is the only way to exercise the press finding the handle under it and the
        // movement being taken — the whole of what "reposition the in/out points" means.
        //
        // A FRESH strip at the overview: the whole source in the room, so both handles are on screen and a
        // press has something to land on. The strip above has been zoomed and scrolled far from that, and its
        // in-handle is hundreds of pixels off the left of the window.
        let dragged = FilmstripView(asset: asset, duration: duration, sourceAspect: 320.0 / 180.0, isAudio: false, frameRate: rate, frame: NSRect(x: 0, y: 0, width: width, height: height))
        container.addSubview(dragged)
        dragged.frame = NSRect(x: 0, y: 0, width: width, height: height)
        dragged.needsLayout = true
        dragged.layoutSubtreeIfNeeded()
        pump(0.6)
        dragged.start = 0.25
        dragged.end = 0.75
        dragged.playheadValue = 0.4
        dragged.selectedHandle = "playhead"
        pump(0.3)

        func mouse(_ type: NSEvent.EventType, _ x: CGFloat, _ y: CGFloat, _ number: Int) -> NSEvent {
            NSEvent.mouseEvent(with: type, location: NSPoint(x: x, y: y), modifierFlags: [],
                               timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                               context: nil, eventNumber: number, clickCount: 1, pressure: 1)!
        }

        let inHandleX = dragged.inHandle.frame.midX
        let outHandleX = dragged.outHandle.frame.midX
        let midY = dragged.bounds.midY
        print("  at the overview: in at \(Int(inHandleX))px, out at \(Int(outHandleX))px, of \(Int(width)); \(Int(stripPxPerSec(dragged.zoom)))px/s")
        check("both handles are inside the window to be dragged", inHandleX > 0 && outHandleX < width, "in \(inHandleX), out \(outHandleX)")

        // What a press over a handle would LAND ON: the overlays and the tiles are drawn on top of the strip, so
        // the press arrives at one of them and is forwarded to the strip. Printed rather than asserted — the
        // strip is not required to be the hit view, only to take hold of the handle the press was aimed at.
        let hit = dragged.hitTest(NSPoint(x: inHandleX, y: midY))
        print("  a press over the in-handle is hit-tested to \(hit === dragged ? "the strip" : String(describing: type(of: hit!)))")

        let startBefore = dragged.start
        window.sendEvent(mouse(.leftMouseDown, inHandleX, midY, 1))
        let grabbed = dragged.selectedHandle
        window.sendEvent(mouse(.leftMouseDragged, inHandleX + 120, midY, 2))
        window.sendEvent(mouse(.leftMouseUp, inHandleX + 120, midY, 3))
        pump(0.2)
        let movedSeconds = (dragged.start - startBefore) * duration
        print("  the press selected \(grabbed); a 120px drag moved the in-point \(String(format: "%.3f", movedSeconds))s")
        check("a press over the in-handle takes hold of it", grabbed == "in", "took \(grabbed)")
        check("and dragging it moves the in-point", movedSeconds > 0.1, "moved \(movedSeconds)s")
        check("by the pixels dragged, at the strip's own rate", abs(movedSeconds - 120 / stripPxPerSec(dragged.zoom)) < 0.05, "\(movedSeconds)s for 120px at \(stripPxPerSec(dragged.zoom))px/s")

        // The same gesture in the middle, over a TILE, so the press has to reach the strip through the picture.
        let skimmerWas = dragged.playheadValue
        let midX = (inHandleX + outHandleX) / 2
        window.sendEvent(mouse(.leftMouseDown, midX, midY, 4))
        let tookSkimmer = dragged.selectedHandle
        window.sendEvent(mouse(.leftMouseDragged, midX + 60, midY, 5))
        window.sendEvent(mouse(.leftMouseUp, midX + 60, midY, 6))
        pump(0.2)
        print("  a press in the middle selected \(tookSkimmer); the skimmer moved \(String(format: "%.3f", (dragged.playheadValue - skimmerWas) * duration))s")
        check("a press over a tile takes the skimmer", tookSkimmer == "playhead", "took \(tookSkimmer)")
        check("and dragging scrubs it", (dragged.playheadValue - skimmerWas) * duration > 0.05, "\(skimmerWas) to \(dragged.playheadValue)")

        try? FileManager.default.removeItem(at: root)
        print(failures == 0 ? "\nTHE STRIP IS DRAWN AT THE ZOOM IT SAYS IT IS\n" : "\n\(failures) SYNC PROBLEM(S)\n")
        exit(failures == 0 ? 0 : 1)
    }
}
