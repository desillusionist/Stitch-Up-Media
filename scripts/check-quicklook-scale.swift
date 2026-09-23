import Foundation

/**
 * The compact scale's arithmetic, asserted.
 *
 * The scale's notches have to land on frame boundaries, and a mark half a frame off looks exactly like a
 * mark: nothing about the window says it is wrong, and the only symptom is that scrubbing by it feels
 * slightly off. So the arithmetic lives in a file of its own and is checked here, without a window.
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
        report(label, abs(actual - expected) < 1e-9, "got \(actual), expected \(expected)")
    }

    static func check(_ label: String, _ actual: Bool, _ expected: Bool) {
        report(label, actual == expected, "got \(actual), expected \(expected)")
    }

    static func report(_ label: String, _ ok: Bool, _ detail: @autoclosure () -> String) {
        print(ok ? "  ok   \(label)" : "  FAIL \(label)\n       \(detail())")
        if !ok { failures += 1 }
    }

    static func main() {
        section("the step a ruler uses")
        // A long source across a narrow strip wants a big step; the rung of the 1-2-5 ladder above what
        // the spacing asks for is the one that keeps the marks from crowding.
        check("a long source steps in round fifties", scaleMinorStep(framesInWindow: 2160, width: 900, minSpacing: 9), 50)
        check("a narrow window steps in single frames", scaleMinorStep(framesInWindow: 24, width: 900, minSpacing: 9), 1)
        check("and a middling one in fives", scaleMinorStep(framesInWindow: 300, width: 900, minSpacing: 9), 5)
        check("a wider strip fits more frames into the same spacing", scaleMinorStep(framesInWindow: 2160, width: 1800, minSpacing: 9), 20)
        check("nothing to draw is a step of one", scaleMinorStep(framesInWindow: 0, width: 900, minSpacing: 9), 1)
        check("and a window with no width likewise", scaleMinorStep(framesInWindow: 2160, width: 0, minSpacing: 9), 1)

        section("where the marks stand")
        let overview = scaleNotches(firstFrame: 0, frameCount: 2160, width: 900, minSpacing: 9)
        check("the overview starts on frame zero", overview.first?.frame ?? -1, 0)
        check("and ends on the last round fifty the window holds", overview.last?.frame ?? -1, 2150)
        check("with one mark every fifty frames", overview.count, 44)
        check("every mark is a multiple of the step", overview.allSatisfy { $0.frame % 50 == 0 }, true)
        check("and a labelled rank is a multiple of five steps", overview.allSatisfy { $0.major == ($0.frame % 250 == 0) }, true)
        check("with nine labelled ranks among them", overview.filter { $0.major }.count, 9)

        // A window that starts between two marks: the first mark is the first boundary INSIDE it, so no
        // mark is ever drawn for a frame the strip is not showing.
        let windowed = scaleNotches(firstFrame: 123, frameCount: 500, width: 900, minSpacing: 9)
        check("a window between marks starts on its own first boundary", windowed.first?.frame ?? -1, 125)
        check("and draws no mark for a frame before it", windowed.contains { $0.frame < 123 }, false)
        check("nor one past its last frame", (windowed.last?.frame ?? 0) <= 622, true)

        section("a mark and the cell it describes")
        // The alignment that matters. A window of 2400 frames over 24 cells is a hundred frames a cell,
        // so every hundredth frame IS a cell boundary, and the scale's position for it has to be the
        // filmstrip's own position for it — both rounded to the half-pixel the filmstrip rounds to, so
        // they cannot part company by a fraction of one.
        let width = 918.0, cells = 24, frames = 2400
        let snap = { (value: Double) in (value * 2).rounded() / 2 }
        let scaleX = { (frame: Int) in snap(width * Double(frame) / Double(frames)) }
        let cellX = { (frame: Int) in snap(width * Double(frame / (frames / cells)) / Double(cells)) }
        check("a mark for a cell boundary is drawn where the cell boundary is", scaleX(700), cellX(700))
        check("at the start of the window too", scaleX(0), cellX(0))
        check("and at its end", scaleX(2300), cellX(2300))
        check("and it is the same value, not merely a close one", scaleX(1300) == cellX(1300), true)

        section("what a scroll asks for")
        let zoomed = scaledWindow(firstFrame: 0, frameCount: 1000, totalFrames: 5000, minFrames: 24, factor: 2, anchorFrame: 500)
        check("zooming in halves the window", zoomed.count, 500)
        check("and holds the anchored frame where it was", abs(Double(500 - zoomed.first) / 500.0 - 0.5) < 1e-9, true)
        let out = scaledWindow(firstFrame: 0, frameCount: 500, totalFrames: 5000, minFrames: 24, factor: 0.5, anchorFrame: 0)
        check("zooming out at the start settles against the start", out.first, 0)
        check("with the wider window it asked for", out.count, 1000)
        let end = scaledWindow(firstFrame: 4000, frameCount: 1000, totalFrames: 5000, minFrames: 24, factor: 0.5, anchorFrame: 5000)
        check("zooming out at the end settles against the end", [end.first, end.count], [3000, 2000])
        check("it never narrows past one frame per cell", scaledWindow(firstFrame: 100, frameCount: 500, totalFrames: 5000, minFrames: 24, factor: 100, anchorFrame: 100).count, 24)
        check("nor widens past the whole source", scaledWindow(firstFrame: 0, frameCount: 500, totalFrames: 5000, minFrames: 24, factor: 0.001, anchorFrame: 0).count, 5000)
        check("an anchor outside the window still lands inside the source", scaledWindow(firstFrame: 0, frameCount: 1000, totalFrames: 5000, minFrames: 24, factor: 4, anchorFrame: 5000).first, 3750)

        section("the easing a zoom glides with")
        // A smoothstep: the window leaves where it was and arrives where it is going at rest, and both ends
        // are FIXED POINTS — so the first step of a glide IS the window it began on and the last IS the one
        // it asked for, rather than nearly either. The scale and the filmstrip are both driven from the
        // window this carries, so wherever it is, they are both there.
        check("a glide begins exactly where it started", easeInOut(0), 0)
        check("and ends exactly where it was aimed", easeInOut(1), 1)
        check("halfway in time is halfway in space", easeInOut(0.5), 0.5)
        check("it eases IN rather than setting off at speed", easeInOut(0.25) < 0.25, true)
        check("and eases OUT rather than arriving at speed", easeInOut(0.75) > 0.75, true)
        let steps = stride(from: 0.0, through: 0.8, by: 0.1).map { easeInOut($0) < easeInOut($0 + 0.1) }
        check("it never goes backwards", steps.allSatisfy { $0 }, true)
        check("asked past the end it is the end", easeInOut(2), 1)
        check("and asked before the start it is the start", easeInOut(-1), 0)

        section("the frame a zoom pivots on")
        // The SKIMMER, not the pointer: the strip's own playhead fraction turned into an absolute frame, so
        // what a zoom is about is the frame being looked at rather than the frame the cursor rests on.
        check("the start of the strip is the first frame", skimmerAnchorFrame(playheadValue: 0, totalFrames: 2160), 0)
        check("and its end is the last frame", skimmerAnchorFrame(playheadValue: 1, totalFrames: 2160), 2159)
        check("halfway along the strip is halfway through it", skimmerAnchorFrame(playheadValue: 0.5, totalFrames: 2160), 1080)
        check("a source of one frame has only that one to pivot on", skimmerAnchorFrame(playheadValue: 0.7, totalFrames: 1), 0)
        check("and a fraction past the end is clamped to it", skimmerAnchorFrame(playheadValue: 1.4, totalFrames: 2160), 2159)

        section("the windows a glide passes through")
        // The one property a zoom about the skimmer has to have: the anchored frame keeps the same FRACTION
        // of the window for the whole glide, which is the same as keeping the same place on screen. It is
        // not merely close — `scaledWindow` derives the destination's first frame from the anchor, so a
        // straight path between the two windows holds the anchor's fraction exactly, up to the rounding a
        // whole number of frames forces.
        let from = (first: 0, count: 1000), total = 5000, anchor = 500.0
        let to = scaledWindow(firstFrame: from.first, frameCount: from.count, totalFrames: total, minFrames: 24, factor: 2, anchorFrame: anchor)
        let restingFraction = (anchor - Double(from.first)) / Double(from.count)
        let held = stride(from: 0.0, through: 1.0, by: 0.25).allSatisfy { (progress: Double) -> Bool in
            let window = interpolatedWindow(fromFirst: from.first, fromCount: from.count, toFirst: to.first, toCount: to.count, totalFrames: total, minFrames: 24, progress: progress)
            return abs((anchor - Double(window.first)) / Double(window.count) - restingFraction) < 0.02
        }
        check("the skimmer keeps its place for the whole glide", held, true)
        check("a glide begins on the window it started from", interpolatedWindow(fromFirst: 0, fromCount: 1000, toFirst: 250, toCount: 500, totalFrames: 5000, minFrames: 24, progress: 0).count, 1000)
        check("and ends on the window it asked for", interpolatedWindow(fromFirst: 0, fromCount: 1000, toFirst: 250, toCount: 500, totalFrames: 5000, minFrames: 24, progress: 1).count, 500)
        check("with that window's own first frame", interpolatedWindow(fromFirst: 0, fromCount: 1000, toFirst: 250, toCount: 500, totalFrames: 5000, minFrames: 24, progress: 1).first, 250)
        // And it is clamped the same way every other move is, so a glide cannot take the strip somewhere a
        // gesture could not.
        check("it never narrows past one frame per cell", interpolatedWindow(fromFirst: 0, fromCount: 1000, toFirst: 0, toCount: 4, totalFrames: 5000, minFrames: 24, progress: 1).count, 24)
        let running = interpolatedWindow(fromFirst: 4900, fromCount: 100, toFirst: 4950, toCount: 5000, totalFrames: 5000, minFrames: 24, progress: 1)
        check("nor runs past the end of the source", running.first + running.count <= 5000, true)

        section("how far one tick moves it")
        check("no scroll is no zoom", scaleZoomFactor(delta: 0), 1.0)
        check("scrolling up zooms in", scaleZoomFactor(delta: 40) > 1, true)
        check("and down zooms out", scaleZoomFactor(delta: -40) < 1, true)
        check("a single tick is gentle", scaleZoomFactor(delta: 1) < 1.2, true)
        check("and a flick is not much more than a tick", scaleZoomFactor(delta: 200) < 1.51, true)
        check("the two directions are each other's inverse", abs(scaleZoomFactor(delta: 12) * scaleZoomFactor(delta: -12) - 1) < 1e-9, true)

        print(failures == 0 ? "\nALL SCALE CHECKS PASSED\n" : "\n\(failures) SCALE PROBLEM(S)\n")
        exit(failures == 0 ? 0 : 1)
    }
}
