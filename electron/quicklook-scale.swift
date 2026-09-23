import Foundation

/**
 * A ruler's marks, worked out from the frames a strip is showing.
 *
 * Pure arithmetic, in a file of its own, because the one thing about a compact scale that cannot be
 * seen when it is wrong is where its notches land: a mark half a frame off looks like a mark, and the
 * scrub it invites feels vaguely wrong rather than broken. Separated it can be asserted on, which is
 * what `scripts/check-quicklook-scale.swift` does.
 *
 * Two rules carry it. Every notch is at an ABSOLUTE frame — a multiple of the step — so the same marks
 * stand on the same frames however the window moves, and none of them shifts under the picture when the
 * strip is scrolled or zoomed. And the step is chosen from a ladder of round numbers, so a mark is
 * always a round distance from its neighbour rather than whatever the arithmetic happened to give.
 */

/// The steps a ruler may use, in frames: the 1-2-5 ladder every ruler is built on, up past an hour at
/// 60fps. A step outside it would read as an arbitrary distance rather than as a round one.
let scaleSteps: [Int] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000]

/// How many subdivisions sit between two labelled marks, which is what makes a scale readable by shape.
let scaleMajorEvery = 5

/// The frames between one subdivision and the next, chosen so they are never closer than `minSpacing`.
func scaleMinorStep(framesInWindow: Double, width: Double, minSpacing: Double) -> Int {
    guard framesInWindow > 0, width > 0, minSpacing > 0 else { return 1 }
    let wanted = framesInWindow * minSpacing / width
    return scaleSteps.first { Double($0) >= wanted } ?? scaleSteps[scaleSteps.count - 1]
}

/// One mark of the scale: the frame it stands on, and whether it is a labelled rank.
struct ScaleNotch {
    let frame: Int
    let major: Bool
}

/**
 * Every mark the window shows, in order.
 *
 * The first mark is the first multiple of the step at or after the window's own first frame, so no mark
 * is drawn for a frame the strip is not showing; the last is the last multiple inside the window. Both
 * ends are therefore exact frame boundaries, which is what lets a mark sit over the cell boundary it
 * describes rather than near it.
 */
func scaleNotches(firstFrame: Int, frameCount: Int, width: Double, minSpacing: Double) -> [ScaleNotch] {
    guard frameCount > 0 else { return [] }
    let minor = scaleMinorStep(framesInWindow: Double(frameCount), width: width, minSpacing: minSpacing)
    let major = minor * scaleMajorEvery
    let last = firstFrame + frameCount - 1
    var frame = ((firstFrame + minor - 1) / minor) * minor
    var notches: [ScaleNotch] = []
    // A window of ten thousand frames at one frame per mark is ten thousand marks; the bound is the
    // window's own width in marks, with room to spare, rather than a number picked out of the air.
    while frame <= last, notches.count <= (frameCount / minor) + 2 {
        notches.append(ScaleNotch(frame: frame, major: frame % major == 0))
        frame += minor
    }
    return notches
}

/**
 * The window a zoom gesture asks for, with the frame under the pointer left where it is.
 *
 * The anchored frame is held at the same fraction of the window, which is what makes zooming feel like
 * a lens rather than a jump: whatever was under the cursor is still under it, at a new closeness. The
 * window is then clamped to the source and to never being narrower than one frame per thumbnail, so a
 * scroll at either end settles against the end rather than running off it.
 */
func scaledWindow(firstFrame: Int, frameCount: Int, totalFrames: Int, minFrames: Int, factor: Double, anchorFrame: Double) -> (first: Int, count: Int) {
    guard totalFrames > 0, factor > 0 else { return (max(0, firstFrame), max(1, frameCount)) }
    let floorCount = max(1, min(minFrames, totalFrames))
    let wanted = max(floorCount, min(totalFrames, Int((Double(frameCount) / factor).rounded())))
    let fraction = (anchorFrame - Double(firstFrame)) / Double(max(frameCount, 1))
    let raw = Int((anchorFrame - fraction * Double(wanted)).rounded())
    return (max(0, min(totalFrames - wanted, raw)), wanted)
}

/// How much one scroll tick zooms, eased so a single notch is gentle and a flick is not.
///
/// The same shape the editor's own scale zooms with: the raw delta is squashed through a hyperbola, so
/// a trackpad's many small deltas and a wheel's few large ones move the zoom by a similar amount.
func scaleZoomFactor(delta: Double) -> Double {
    guard delta != 0 else { return 1 }
    let eased = tanh(abs(delta) / 6.0)
    let amount = 0.08 + 0.42 * eased
    return delta > 0 ? 1 + amount : 1 / (1 + amount)
}

/// How long a zoom glides from the window it was on to the window it asked for, in seconds.
///
/// Long enough to read as a movement rather than a cut, short enough that a scroll still feels like it
/// did the thing at once. The strip and the scale are BOTH driven from the window this carries, so they
/// glide as one rather than one snapping to the destination while the other waits for it.
let zoomAnimationSeconds = 0.18

/// The easing a zoom glides with: a smoothstep, so the window leaves where it was and arrives where it
/// is going at rest rather than at full speed. Both ends are fixed points, which is what makes the first
/// step of an animation the window it started from and the last the window it asked for, exactly.
func easeInOut(_ t: Double) -> Double {
    let clamped = max(0, min(1, t))
    return clamped * clamped * (3 - 2 * clamped)
}

/// The frame a zoom pivots on: the skimmer's own frame.
///
/// The zoom is about the frame being LOOKED AT rather than the frame the pointer happens to rest on, so
/// it is the strip's own playhead fraction of the source that is turned into an absolute frame.
func skimmerAnchorFrame(playheadValue: Double, totalFrames: Int) -> Double {
    max(0, min(Double(max(1, totalFrames) - 1), max(0, playheadValue) * Double(max(1, totalFrames))))
}

/// The window a zoom is passing through part of the way along it.
///
/// Both ends of the transition are interpolated — the window's first frame and its length — and that is
/// deliberate rather than merely easy. `scaledWindow` derives its first frame from the anchored frame, so
/// a straight path between two windows that each hold the anchor at the same fraction holds the anchor at
/// that fraction the whole way: the skimmer stands still on screen for the entire glide, which is what
/// "the zoom is about the skimmer" has to mean to mean anything. Progress is expected to have been eased
/// already — this is the path, `easeInOut` is the grain of the travel along it.
func interpolatedWindow(fromFirst: Int, fromCount: Int, toFirst: Int, toCount: Int, totalFrames: Int, minFrames: Int, progress: Double) -> (first: Int, count: Int) {
    guard totalFrames > 0 else { return (max(0, fromFirst), max(1, fromCount)) }
    let floorCount = max(1, min(minFrames, totalFrames))
    let p = max(0, min(1, progress))
    let count = max(floorCount, min(totalFrames, Int((Double(fromCount) + (Double(toCount) - Double(fromCount)) * p).rounded())))
    let first = max(0, min(totalFrames - count, Int((Double(fromFirst) + (Double(toFirst) - Double(fromFirst)) * p).rounded())))
    return (first, count)
}
