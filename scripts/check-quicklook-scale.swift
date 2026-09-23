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
