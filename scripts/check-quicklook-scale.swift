import Foundation

/**
 * The strip's arithmetic, asserted.
 *
 * The strip is now the EDIT JOB timeline's model — a zoom gives a rate, the rate gives the strip its width,
 * and fixed-width tiles are laid across that width — so what has to be true is that zooming WIDENS the strip
 * and that the tiles get denser across the same source, that a mark lands where the tile for that frame
 * lands, and that a zoom holds the skimmer still. None of that can be seen when it is wrong: a tile half a
 * frame out looks like a tile, and a strip that magnified instead of packing looks like a strip.
 *
 * Usage: npm run check-scale
 */
@main
enum CheckScale {
    static var failures = 0

    static func section(_ title: String) { print("\n== \(title) ==") }

    static func check(_ label: String, _ actual: Int, _ expected: Int) {
        report(label, actual == expected, "got \(actual), expected \(expected)")
    }

    static func check(_ label: String, _ actual: [Int], _ expected: [Int]) {
        report(label, actual == expected, "got \(actual), expected \(expected)")
    }

    static func check(_ label: String, _ actual: Double, _ expected: Double) {
        report(label, abs(actual - expected) < 1e-6, "got \(actual), expected \(expected)")
    }

    static func check(_ label: String, _ actual: Bool, _ expected: Bool) {
        report(label, actual == expected, "got \(actual), expected \(expected)")
    }

    static func report(_ label: String, _ ok: Bool, _ detail: @autoclosure () -> String) {
        print(ok ? "  ok   \(label)" : "  FAIL \(label)\n       \(detail())")
        if !ok { failures += 1 }
    }

    static func main() {
        let fps = 30.0

        section("the rate a zoom means")
        // The rate is the zoom's business and nothing else's: a lane of the source is a fixed number of
        // seconds and a zoom says how many pixels a second of it takes. This is the whole difference from
        // the model it replaces, which spread a fixed number of cells across whatever window was covered.
        check("1x is the base rate", stripPxPerSec(1), BASE_PX_PER_SECOND)
        check("twice the zoom is twice the rate", stripPxPerSec(2), BASE_PX_PER_SECOND * 2)
        check("half the zoom is half of it", stripPxPerSec(0.5), BASE_PX_PER_SECOND / 2)
        check("a frame at 30fps is a thirtieth of a second of strip", stripPxPerFrame(1, fps: fps), BASE_PX_PER_SECOND / 30)
        check("nonsense is 1x", stripPxPerSec(0), BASE_PX_PER_SECOND)
        check("and so is a zoom that is not a number", clampStripZoom(Double.nan), 1)
        check("the zoom is held inside its range", clampStripZoom(9999), STRIP_ZOOM_MAX)
        check("at the bottom too", clampStripZoom(0.0001), STRIP_ZOOM_MIN)

        section("the zoom that fits a source to the room it has")
        // FIT is the one place the viewport is consulted, and only when it is asked for — the first layout,
        // or a resize — so a resize never silently re-decides a zoom the user chose.
        check("a ten-second source in 240 pixels fits at 1x", stripFitZoom(duration: 10, availableWidth: 240), 1)
        check("in half the room it fits at half a zoom", stripFitZoom(duration: 10, availableWidth: 120), 0.5)
        check("and in twice the room at twice one", stripFitZoom(duration: 10, availableWidth: 480), 2)
        check("a source with no length has no fit", stripFitZoom(duration: 0, availableWidth: 240), 1)
        check("nor has one with no room", stripFitZoom(duration: 10, availableWidth: 0), 1)
        // The fit is the FLOOR as well as the fit, and it is not held above the old fixed minimum: an hour at
        // 24 pixels a second in a 900-pixel window genuinely fits at 0.0104, and a floor of 0.05 would put the
        // whole source permanently out of reach — the opposite of what a fit is for.
        check("a long source fits far below the old floor", stripFitZoom(duration: 3600, availableWidth: 900), 900.0 / 86400.0)
        check("a fit is never deeper than the deepest zoom", stripFitZoom(duration: 1, availableWidth: 100000), STRIP_ZOOM_MAX)

        section("the floor the fit puts under the zoom")
        // A zoom is held above the fit it is given, so the strip can never be drawn narrower than its window.
        check("a zoom above the floor is left alone", clampStripZoom(0.5, floor: 0.2), 0.5)
        check("one below it is raised to it", clampStripZoom(0.1, floor: 0.2), 0.2)
        check("and one exactly on it stays", clampStripZoom(0.2, floor: 0.2), 0.2)
        check("the old fixed floor still applies with none given", clampStripZoom(0.0001), STRIP_ZOOM_MIN)
        var wheeledOut = 0.05
        for _ in 0..<200 { wheeledOut = stripZoomedBy(wheeledOut, delta: 10000, floor: 0.02) }
        check("a wheel turned out settles at the floor", wheeledOut, 0.02)
        check("and one turned in is free to leave it", stripZoomedBy(0.05, delta: -10000, floor: 0.02) > 0.05, true)

        section("panning the strip sideways")
        // The two axes over the strip are two gestures: a wheel up or down scrubs, a swipe left or right pans.
        // Panning is the offset moved by the swipe and held inside the drawing — it can never open a gap.
        check("a swipe carries the strip with it", stripPannedOffset(offset: 100, deltaPixels: 50, stripWidth: 1000, viewportWidth: 200), 150)
        check("a swipe back the other way returns it", stripPannedOffset(offset: 100, deltaPixels: -50, stripWidth: 1000, viewportWidth: 200), 50)
        check("it cannot be panned before the start", stripPannedOffset(offset: 10, deltaPixels: -500, stripWidth: 1000, viewportWidth: 200), 0)
        check("nor past the end", stripPannedOffset(offset: 700, deltaPixels: 500, stripWidth: 1000, viewportWidth: 200), 800)
        check("a source narrower than the room has nowhere to pan", stripPannedOffset(offset: 0, deltaPixels: 500, stripWidth: 100, viewportWidth: 200), 0)

        section("how wide the strip is")
        // The strip is the source's whole length at the zoom's rate, so a longer source is wider and a deeper
        // zoom is wider — and it is the DEPTH that the tiles react to, which is the visible expansion.
        let short = 10.0, long = 60.0
        check("a ten-second source at 1x is ten seconds of strip", short * stripPxPerSec(1), 240)
        check("a minute of source is six times as wide", long * stripPxPerSec(1), 1440)
        check("and three times the zoom is three times the width", short * stripPxPerSec(3), 720)

        section("the tiles across it")
        // Tiles are a FIXED size — the strip's row height at the shape of what is shown — so the count is the
        // strip's width divided by one. Zooming therefore buys DENSITY across the same source rather than
        // magnification of it, which is the whole of what was missing.
        let wide = stripTiling(frameCount: 300, stripWidth: 2400, thumbHeight: 48, outAspect: 16.0 / 9.0)
        check("a tile is the row height at the shape being shown", wide.thumbWidth, 85)
        check("the strip holds as many as fit across it", wide.count, 28)
        check("their cells share the strip exactly, so there is no gap", wide.cellWidth * Double(wide.count), 2400)
        let twice = stripTiling(frameCount: 300, stripWidth: 4800, thumbHeight: 48, outAspect: 16.0 / 9.0)
        check("twice the strip is twice as many tiles", twice.count, 56)
        check("of exactly the same size", twice.thumbWidth, wide.thumbWidth)
        check("so the step between them is halved", twice.step, wide.step / 2)
        check("a portrait strip tiles narrower", stripTiling(frameCount: 300, stripWidth: 2400, thumbHeight: 48, outAspect: 9.0 / 16.0).thumbWidth, 27)
        // There is no point asking for more tiles than there are frames to fill them with: past that the same
        // frame would be asked for twice over.
        check("never more tiles than frames", stripTiling(frameCount: 10, stripWidth: 4000, thumbHeight: 48, outAspect: 16.0 / 9.0).count, 10)
        check("and never fewer than one", stripTiling(frameCount: 300, stripWidth: 4, thumbHeight: 48, outAspect: 16.0 / 9.0).count, 1)

        section("which frame a tile shows")
        let plan = stripTiling(frameCount: 300, stripWidth: 2550, thumbHeight: 48, outAspect: 16.0 / 9.0)
        // A tile is not its share's FIRST frame but the frame in its MIDDLE, so the strip reads as the source
        // rather than as its every tenth frame.
        check("the first tile shows the middle of the opening of the source", stripTileFrame(0, tiling: plan, frameCount: 300), 5)
        check("and the last the middle of the end of it", stripTileFrame(plan.count - 1, tiling: plan, frameCount: 300), 295)
        let rises = (0..<plan.count).allSatisfy { stripTileFrame($0, tiling: plan, frameCount: 300) < stripTileFrame($0 + 1, tiling: plan, frameCount: 300) }
        check("and they rise across the strip", rises, true)
        // Every tile shows a frame from its OWN share of the strip, which is what makes a strip read left to
        // right. This is the rule stated exactly: the frame is one of the whole frames inside the share, and
        // of those it is the one nearest the middle. A share narrower than two frames is where the naive
        // "the last frame is the end minus one" goes wrong, so it is stated in frames rather than in bounds.
        let inShare = (0..<plan.count).allSatisfy { (index: Int) -> Bool in
            let frame = stripTileFrame(index, tiling: plan, frameCount: 300)
            let firstInside = Int((Double(index) * plan.step).rounded(.up))
            let lastInside = max(firstInside, Int((Double(index + 1) * plan.step).rounded(.up)) - 1)
            return frame >= firstInside && frame <= lastInside
        }
        check("every tile shows a frame from its own share", inShare, true)
        let oneToOne = stripTiling(frameCount: 20, stripWidth: 20 * 85, thumbHeight: 48, outAspect: 16.0 / 9.0)
        let onePerTile = (0..<oneToOne.count).map { stripTileFrame($0, tiling: oneToOne, frameCount: 20) }
        check("a tile per frame counts straight through them", onePerTile, Array(0..<20))
        // And at a deep zoom, where a share is barely more than a frame wide, the frame is still ITS share's
        // and never the one next door — the case the bound-in-frames rule was written for.
        let deep = stripTiling(frameCount: 60, stripWidth: 3644, thumbHeight: 48, outAspect: 16.0 / 9.0)
        let deepInShare = (0..<deep.count).allSatisfy { (index: Int) -> Bool in
            let frame = stripTileFrame(index, tiling: deep, frameCount: 60)
            let firstInside = Int((Double(index) * deep.step).rounded(.up))
            let lastInside = max(firstInside, Int((Double(index + 1) * deep.step).rounded(.up)) - 1)
            return frame >= firstInside && frame <= lastInside
        }
        check("and a tile whose share is barely a frame long still shows its own", deepInShare, true)

        section("where the window is")
        // The window is held by an anchored frame: the skimmer keeps its place on screen while the strip
        // stretches around it, which is what makes a zoom a lens on the frame being looked at.
        check("a skimmer in the middle holds its place", stripOffset(anchorFrame: 150, anchorX: 100, pxPerFrame: 1, stripWidth: 1000, viewportWidth: 200), 50)
        check("at twice the zoom the offset doubles with it", stripOffset(anchorFrame: 150, anchorX: 100, pxPerFrame: 2, stripWidth: 2000, viewportWidth: 200), 200)
        check("and the frame is still 100 pixels in", 150 * 2 - 200, 100)
        // At either end the drawing settles against the end rather than running off it, which is the one
        // place the skimmer is allowed to move on screen.
        check("a window cannot start before the source", stripOffset(anchorFrame: 5, anchorX: 500, pxPerFrame: 1, stripWidth: 1000, viewportWidth: 200), 0)
        check("nor end past it", stripOffset(anchorFrame: 995, anchorX: 0, pxPerFrame: 1, stripWidth: 1000, viewportWidth: 200), 800)
        check("a source narrower than the room is not scrolled at all", stripOffset(anchorFrame: 50, anchorX: 100, pxPerFrame: 1, stripWidth: 100, viewportWidth: 200), 0)

        section("which tiles are on screen")
        let range = stripVisibleRange(offset: 0, viewportWidth: 255, cellWidth: 85, count: 30)
        check("a window holds the tiles across it", range.last - range.first + 1, 5)
        check("with one either side, so a partly visible tile is drawn", range.first, 0)
        let middle = stripVisibleRange(offset: 850, viewportWidth: 255, cellWidth: 85, count: 30)
        check("a scrolled window starts at the tile it is over", middle.first, 9)
        check("and ends at the one past its right edge", middle.last, 14)
        let atEnd = stripVisibleRange(offset: 2550 - 255, viewportWidth: 255, cellWidth: 85, count: 30)
        check("a window at the end stops at the last tile", atEnd.last, 29)

        section("the marks a scale carries")
        // The notch is a FRAME, and the step is the finest the frame ladder allows before the notches would
        // crowd. So within a band the pitch GROWS as the strip is stretched — the notches spread apart, which
        // is the visual cue — and at the crowded end the step coarsens through the 1-2-5 ladder.
        let close = rulerSteps(zoom: 20, fps: fps)
        check("a strip with room for a frame counts in frames", close.step, 1.0 / 30)
        check("and ranks every so many of them", close.divisor, 5)
        let deepest = rulerSteps(zoom: 32, fps: fps)
        check("deeper still, the frame is still the notch", deepest.step, 1.0 / 30)
        // The cue: within a band, a stretched strip carries its notches FURTHER APART than a shrunk one.
        check("so the notches spread as the strip is stretched", deepest.step * stripPxPerSec(32) > close.step * stripPxPerSec(20), true)
        check("and pack together as it is shrunk", rulerSteps(zoom: 8, fps: fps).step * stripPxPerSec(8) < rulerSteps(zoom: 14, fps: fps).step * stripPxPerSec(14), true)
        // At the crowded end a frame would be a fraction of a pixel apart, so the step coarsens — but never
        // past the point where a notch sits closer than the crowding floor.
        let coarse = rulerSteps(zoom: 0.5, fps: fps)
        check("a crowded strip coarsens to whole frames", coarse.step, 50.0 / 30.0)
        check("to a pitch no closer than the floor", coarse.step * stripPxPerSec(0.5) >= RULER_MINOR_PX - 1e-9, true)
        check("and its ranks are whole subdivisions, not one", coarse.divisor > 1, true)
        for zoom in [0.05, 0.1, 0.5, 1, 2, 5, 10, 20, 32] {
            let steps = rulerSteps(zoom: Double(zoom), fps: fps)
            check("at \(zoom)x no notch is closer than the floor", steps.step * stripPxPerSec(Double(zoom)) >= RULER_MINOR_PX - 1e-9, true)
            check("and every rank is a whole number of subdivisions", abs(steps.major / steps.step - (steps.major / steps.step).rounded()) < 1e-9, true)
            check("and a rank is never fewer than two subdivisions", steps.divisor >= 2, true)
        }
        // A source whose rate is unknown still counts in whole seconds.
        let noFps = rulerSteps(zoom: 0.5, fps: 0)
        check("with no frame rate it counts in seconds", abs(noFps.step / 0.5 - (noFps.step / 0.5).rounded()) < 1e-9, true)
        check("and its ranks are too", abs(noFps.major / 0.5 - (noFps.major / 0.5).rounded()) < 1e-9, true)
        let marks = rulerTicks(duration: 10, zoom: 2, from: 0, to: 10, fps: fps)
        check("the marks span the window that was asked for", marks.first?.time ?? -1, 0)
        check("and no further than the source goes", (marks.last?.time ?? .infinity) <= 10, true)
        check("the very last mark is dropped, since it would land on the one before it", marks.contains { $0.time == 10 }, false)
        let windowed = rulerTicks(duration: 1000, zoom: 20, from: 400, to: 402, fps: fps)
        check("a window of a long source carries only its own marks", windowed.allSatisfy { $0.time >= 400 && $0.time <= 402 }, true)
        check("and it does carry marks", windowed.count > 10, true)

        section("how a zoom glides")
        // A smoothstep: the strip leaves where it was and arrives where it is going at rest, and both ends
        // are FIXED POINTS — so the first step of a glide is the strip it began on and the last is the one it
        // asked for, exactly.
        check("a glide begins exactly where it started", easeInOut(0), 0)
        check("and ends exactly where it was aimed", easeInOut(1), 1)
        check("halfway in time is halfway in the travel", easeInOut(0.5), 0.5)
        check("it eases IN rather than setting off at speed", easeInOut(0.25) < 0.25, true)
        check("and eases OUT rather than arriving at speed", easeInOut(0.75) > 0.75, true)
        check("past the end it is the end", easeInOut(2), 1)
        check("and before the start it is the start", easeInOut(-1), 0)
        check("the travel is linear once the time is eased", interpolatedZoom(from: 1, to: 5, progress: 0.25), 2)
        check("at the start it has not moved", interpolatedZoom(from: 1, to: 5, progress: 0), 1)
        check("and at the end it has arrived", interpolatedZoom(from: 1, to: 5, progress: 1), 5)

        section("how far a wheel moves it")
        // The delta is the timeline's own — normalised by the view, since AppKit writes the sign the other way
        // round — so a negative delta is a wheel turned away from the viewer, which zooms in.
        check("no scroll is no zoom", stripZoomedBy(2, delta: 0), 2)
        check("a wheel away from the viewer zooms in", stripZoomedBy(2, delta: -40) > 2, true)
        check("and one towards it zooms out", stripZoomedBy(2, delta: 40) < 2, true)
        check("a single tick is gentle", stripZoomedBy(2, delta: -1) < 2.1, true)
        check("and a flick is not much more than a tick", stripZoomedBy(2, delta: -200) < 2.13, true)
        check("the two directions are each other's inverse", abs(stripZoomedBy(stripZoomedBy(2, delta: -12), delta: 12) - 2) < 1e-9, true)
        // A MOUSE WHEEL and a TRACKPAD report the same gesture in different units, so the same raw number is
        // two different things. A notch of 1 is given a gesture's weight, which is what stops the zoom taking
        // several notches to budge and then jumping once a fast turn coalesced into a bigger number.
        check("a precise delta is passed straight through", stripWheelDelta(raw: 12, precise: true), 12)
        check("a wheel notch is given a gesture's weight", stripWheelDelta(raw: 1, precise: false), 24)
        check("a double notch twice that", stripWheelDelta(raw: 2, precise: false), 48)
        check("and nothing is nothing", stripWheelDelta(raw: 0, precise: true), 0)
        check("the FIRST wheel notch already moves the zoom", stripZoomedBy(2, delta: stripWheelDelta(raw: -1, precise: false)) > 2.05, true)
        check("and a rapid turn is only a little more", stripZoomedBy(2, delta: stripWheelDelta(raw: -10, precise: false)) < 2.13, true)
        // A scrub is a share of the source rather than a fixed number of seconds, so a wheel over a close-up
        // covers a small stretch of it and one over the overview a large one.
        check("a scrub step is the same at every zoom, as a share of the source", stripScrubSeconds(delta: 30, duration: 10), stripScrubSeconds(delta: 30, duration: 10))
        check("a harder turn scrubs further", stripScrubSeconds(delta: 100, duration: 10) > stripScrubSeconds(delta: 10, duration: 10), true)
        check("and a source with no length is not scrubbed at all", stripScrubSeconds(delta: 30, duration: 0), 0)

        print(failures == 0 ? "\nALL SCALE CHECKS PASSED\n" : "\n\(failures) SCALE PROBLEM(S)\n")
        exit(failures == 0 ? 0 : 1)
    }
}
