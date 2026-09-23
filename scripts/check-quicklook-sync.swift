import AppKit
import AVFoundation

/**
 * Whether the strip re-renders when the window moves, which no amount of arithmetic can answer.
 *
 * The arithmetic that carries a zoom — the easing, the anchored window, the glide between them — is
 * asserted in `check-scale`, and it passed while the strip was still reported as not moving. That is the
 * gap this closes: `check-scale` proves what the window SHOULD be, and this proves the strip is actually
 * driven by it. They are different questions and only the second one is the one being complained about.
 *
 * So the real `FilmstripView` is built on a real video and driven exactly the way a scroll drives it, and
 * its cells are READ BACK — each visible cell's layer contents, reduced to one average colour. The fixture
 * is built so that frame N is a solid grey of `20 + 3N`, which makes a cell's colour NAME the frame in it:
 * the harness can therefore say which frames the strip is showing, not merely that something changed,
 * which is the difference between "it redrew" and "it redrew the right frames".
 *
 * Both halves of the complaint are tested: a single gentle tick — where the frames move by a few and a
 * strip that is not being driven would look almost unchanged — and a zoom all the way onto the skimmer.
 *
 * The complaint has a second possible cause this cannot see: the app shells out to a compiled Swift
 * program, so an old BINARY looks exactly like old code. The harness prints what it is testing, and
 * `main.ts` names each build of the helper after the contents of its sources, so an old one cannot be run
 * by accident.
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

    /// A frame, reduced to one average colour: `R,G,B`. Drawn down to a single pixel rather than sampled
    /// at one, so a frame's identity is not a bet on where the fixture put the interesting pixel.
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

    /// The grey level a signature stands for, which for this fixture is a frame number.
    static func level(_ signature: String) -> Int? {
        let channels = signature.split(separator: ",").compactMap { Int($0) }
        guard channels.count == 3 else { return nil }
        return (channels[0] + channels[1] + channels[2]) / 3
    }

    /** One frame of the source, read straight from the file, as the answer the strip should be showing. */
    static func frame(at seconds: Double, of asset: AVAsset) -> CGImage? {
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        return try? generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600), actualTime: nil)
    }

    /** What every cell the strip is showing is actually displaying, as the frame it names. */
    static func cellFrames(_ filmstrip: FilmstripView, levels: [Int]) -> [Int?] {
        filmstrip.imageViews.filter { !$0.isHidden }.map { view in
            guard let contents = view.layer?.contents else { return nil }
            guard let value = level(signature(contents as! CGImage)) else { return nil }
            // Nearest reference frame: the fixture's levels are three apart, so a match is unambiguous and
            // this needs no assumption about how the grey survived the encode.
            var best: Int? = nil
            var delta = Int.max
            for (frame, reference) in levels.enumerated() where abs(reference - value) < delta { delta = abs(reference - value); best = frame }
            return delta <= 2 ? best : nil
        }
    }

    /** The frames a window of this shape should be showing, one per cell, at each cell's own middle. */
    static func expectedFrames(first: Int, count: Int, cells: Int, totalFrames: Int) -> [Int] {
        let step = Double(count) / Double(max(cells, 1))
        return (0..<cells).map { min(totalFrames - 1, max(0, Int((Double(first) + (Double($0) + 0.5) * step).rounded()))) }
    }

    /**
     * Whether every cell is showing a frame from the stretch of the source that cell stands for.
     *
     * The invariant a strip has to keep whatever it is asked for: a cell covers a slice of the window, and
     * the frame in it has to come from that slice. It is stated as a range rather than as the exact middle
     * because the middle of a one-frame cell is a half frame, whose rounding is a choice rather than a
     * truth — what is NOT a choice is that the frame belongs to the cell showing it.
     */
    static func everyCellInItsOwnSpan(_ frames: [Int?], window: (first: Int, count: Int), cells: Int, totalFrames: Int) -> Bool {
        let step = Double(window.count) / Double(max(cells, 1))
        return zip(frames.indices, frames).allSatisfy { (index, frame) in
            guard let frame else { return false }
            let low = window.first + Int((Double(index) * step).rounded(.down))
            let high = min(totalFrames - 1, window.first + Int((Double(index + 1) * step).rounded(.up)) - 1)
            return frame >= low && frame <= high
        }
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

    /// The window is gliding: the run loop has to run for the timer to fire and the frames to land.
    static func pump(_ seconds: Double) {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
    }

    /// Runs until the window has stopped moving for a while, which is a glide having finished.
    @discardableResult
    static func settle(_ filmstrip: FilmstripView, timeout: Double = 6) -> Int {
        let deadline = Date().addingTimeInterval(timeout)
        var last = -1, stable = 0
        while Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.05))
            let count = filmstrip.windowFrameCount
            if count == last { stable += 1; if stable >= 6 { return count } } else { stable = 0; last = count }
        }
        return filmstrip.windowFrameCount
    }

    static func main() {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)

        let root = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("stitch-up-sync-\(ProcessInfo.processInfo.processIdentifier)")
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        print("testing binary: \(CommandLine.arguments.first ?? "?")")

        // Six seconds at ten frames a second, every frame a solid grey three levels above the last, so a
        // frame's number can be READ BACK from any cell showing it. Built by ffmpeg's own `geq`, which can
        // see the frame counter — no shell, so the expression needs no quoting.
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
        // The fixture's own frames, read the same way the cells will be, so the mapping from a colour back
        // to a frame number is the source's own rather than an assumption about the encode.
        let levels = (0..<totalFrames).map { level(signature(frame(at: Double($0) / rate, of: asset))) ?? -1 }
        print("  the fixture's frames read as: \(levels.prefix(6)) … \(levels.suffix(3))")

        section("the fixture can be read back")
        check("it is the six seconds it was built as", totalFrames == 60, "\(totalFrames)")
        check("every frame has a level", levels.allSatisfy { $0 > 0 }, "\(levels)")
        check("and every frame is distinguishable from the next", zip(levels, levels.dropFirst()).allSatisfy { $1 > $0 }, "\(levels)")

        section("the strip as the window opens")
        let filmstrip = FilmstripView(asset: asset, duration: duration, sourceAspect: 320.0 / 180.0, isAudio: false, frameRate: rate, frame: NSRect(x: 0, y: 0, width: 900, height: 82))
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 900, height: 82))
        container.addSubview(filmstrip)
        filmstrip.frame = container.bounds
        // A real window, off the screen and invisible: the layout pass is what positions the cells, and it is
        // the part a headless harness is most likely to leave out — so it is had the ordinary way and then
        // ASSERTED rather than assumed.
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 82), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = container
        window.alphaValue = 0
        window.setFrameOrigin(NSPoint(x: -5000, y: -5000))
        window.orderBack(nil)
        container.layoutSubtreeIfNeeded()
        filmstrip.needsLayout = true
        filmstrip.layoutSubtreeIfNeeded()
        pump(1.5)

        let laidOut = filmstrip.imageViews.filter { !$0.isHidden }
        let cells = laidOut.count
        check("the strip laid its cells out", laidOut.allSatisfy { $0.frame.width > 1 && $0.frame.height > 1 }, "a cell is still \(laidOut.first?.frame ?? .zero)")
        check("and hides the cells it has no room for", cells < filmstrip.imageViews.count, "\(cells) of \(filmstrip.imageViews.count) shown")
        check("the strip is showing more than one cell", cells > 1, "showing \(cells)")
        check("and the whole source is its window", filmstrip.windowFrameCount == totalFrames, "\(filmstrip.windowFrameCount) of \(totalFrames)")

        let overviewWindow = (first: filmstrip.windowFirstFrame, count: filmstrip.windowFrameCount)
        let overview = cellFrames(filmstrip, levels: levels)
        print("  window \(overviewWindow.first)+\(overviewWindow.count), cells show \(overview)")
        print("  the frames its cells stand for: \(expectedFrames(first: overviewWindow.first, count: overviewWindow.count, cells: cells, totalFrames: totalFrames))")
        check("every cell has a frame in it", overview.allSatisfy { $0 != nil }, "\(overview)")
        check("and every cell shows a frame from its own stretch of the source", everyCellInItsOwnSpan(overview, window: overviewWindow, cells: cells, totalFrames: totalFrames), "\(overview)")

        section("one gentle scroll tick")
        // The case a strip that is not being driven would pass for broken: the frames move by a few, so the
        // thumbnails barely differ — but they must differ, and they must be the frames of the NEW window.
        filmstrip.playheadValue = 0.5
        filmstrip.zoom(by: scaleZoomFactor(delta: 14))
        settle(filmstrip)
        pump(2.0)
        let tickWindow = (first: filmstrip.windowFirstFrame, count: filmstrip.windowFrameCount)
        let tick = cellFrames(filmstrip, levels: levels)
        print("  window \(tickWindow.first)+\(tickWindow.count), cells show \(tick)")
        check("the window narrowed, but not to the cells' floor", tickWindow.count < totalFrames && tickWindow.count > cells, "\(tickWindow)")
        check("and it is still about the skimmer", tickWindow.first <= 30 && 30 < tickWindow.first + tickWindow.count, "\(tickWindow)")
        check("every cell re-rendered for the new window", everyCellInItsOwnSpan(tick, window: tickWindow, cells: cells, totalFrames: totalFrames), "\(tick)")
        check("in order, and with no frame shown twice", zip(tick, tick.dropFirst()).allSatisfy { ($0 ?? -1) < ($1 ?? -1) }, "\(tick)")
        check("which is a change from the overview", tick != overview, "unchanged: \(tick)")

        section("zoomed all the way onto the skimmer")
        filmstrip.zoom(by: 8)
        settle(filmstrip)
        filmstrip.zoom(by: 8)
        settle(filmstrip)
        pump(2.0)
        let deepWindow = (first: filmstrip.windowFirstFrame, count: filmstrip.windowFrameCount)
        let deep = cellFrames(filmstrip, levels: levels)
        print("  window \(deepWindow.first)+\(deepWindow.count), cells show \(deep)")
        check("the window is one frame per cell", deepWindow.count == cells, "\(deepWindow) with \(cells) cells")
        check("and the skimmer is inside it", deepWindow.first <= 30 && 30 < deepWindow.first + deepWindow.count, "\(deepWindow)")
        check("the cell count did not change — density is the strip's, coverage is the window's", filmstrip.imageViews.filter { !$0.isHidden }.count == cells, "was \(cells)")
        // At one frame per cell the answer is not a choice: the strip is a list of the window's frames, so
        // cell i IS frame first+i. This is the assertion that caught the half-frame rounding.
        check("every cell shows the frame it stands for", deep == Array(deepWindow.first..<(deepWindow.first + cells)).map { min(totalFrames - 1, $0) }, "\(deep)")
        check("and the last one is not past the end of the window", (deep.last.flatMap { $0 } ?? -1) < deepWindow.first + deepWindow.count, "\(deep) in \(deepWindow)")
        check("which is a change from the overview", deep != overview, "unchanged: \(deep)")

        try? FileManager.default.removeItem(at: root)
        print(failures == 0 ? "\nTHE STRIP RE-RENDERS FOR EVERY WINDOW IT IS GIVEN\n" : "\n\(failures) SYNC PROBLEM(S)\n")
        exit(failures == 0 ? 0 : 1)
    }
}
