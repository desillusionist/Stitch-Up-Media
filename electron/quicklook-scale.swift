import Foundation

/**
 * The strip's geometry: the EDIT JOB timeline's own rules, in place of a window-and-resample model.
 *
 * The timeline's model is that a lane's width is a function of the ZOOM alone — `seconds x
 * pixelsPerSecond` — so zooming WIDENS the drawing while the source stays the same length, and a stretch of
 * source is then drawn across more pixels than it was. The strip had the other model: a fixed number of
 * cells spread across whatever window was covered, so zooming changed which frames the cells showed and
 * nothing else. Nothing on screen got bigger, which is why zooming did not look like zooming.
 *
 * So: a zoom gives a rate, the rate gives the strip its width, and the tiles are laid across that width at
 * a FIXED size. More width therefore means MORE tiles across the same stretch of source, which is the
 * visible expansion. The window is then a pair of numbers — where the strip is scrolled to, and how much of
 * it fits — rather than the thing that decides the sampling.
 *
 * All of it is arithmetic over a zoom, a width and a frame count, in a file of its own, because the one
 * thing that cannot be seen when it is wrong is where a tile or a mark lands.
 */

// MARK: - the rate, which the zoom decides

/// Pixels of source per second at 1x. The EDIT JOB timeline's own figure, so the two feel alike.
let BASE_PX_PER_SECOND = 24.0
/// The range the zoom may take. Below 1 so a long source can still be taken in at a glance.
let STRIP_ZOOM_MIN = 0.05
let STRIP_ZOOM_MAX = 32.0

/// Pixels of strip per second of source. The zoom decides it, and nothing else does.
func stripPxPerSec(_ zoom: Double) -> Double {
    BASE_PX_PER_SECOND * (zoom.isFinite && zoom > 0 ? zoom : 1)
}

/// A zoom held inside the range, with nonsense falling back to 1x.
func clampStripZoom(_ zoom: Double) -> Double {
    zoom.isFinite && zoom > 0 ? max(STRIP_ZOOM_MIN, min(STRIP_ZOOM_MAX, zoom)) : 1
}

/// The pixels one frame takes at a zoom, which is what places every mark on the strip.
func stripPxPerFrame(_ zoom: Double, fps: Double) -> Double {
    stripPxPerSec(zoom) / (fps.isFinite && fps > 0 ? fps : 30)
}

/// The zoom at which the whole source is exactly as wide as the room there is for it.
///
/// This is the strip's FIT, and like the timeline's it is taken from the viewport only at the moment it is
/// asked for — the first layout, or the button — so a resize changes how much is on screen and never
/// silently re-decides the zoom.
func stripFitZoom(duration: Double, availableWidth: Double) -> Double {
    guard duration.isFinite, duration > 0, availableWidth > 0 else { return 1 }
    return clampStripZoom(availableWidth / (duration * BASE_PX_PER_SECOND))
}

/// A wheel notch's worth of zoom, eased — the timeline's own pace, so a trackpad and a wheel feel alike.
func stripZoomedBy(_ zoom: Double, delta: Double) -> Double {
    guard delta.isFinite, delta != 0 else { return zoom }
    let eased = tanh(abs(delta) / 40)
    let factor = 1 + 0.06 * eased
    return clampStripZoom(delta < 0 ? zoom * factor : zoom / factor)
}

/**
 * A wheel notch's worth of scrubbing, as a share of the source, eased.
 *
 * A share rather than a fixed number of seconds, so the same gesture means the same thing at every zoom:
 * a wheel over a close-up covers a small stretch of source and over the overview a large one, which is the
 * other half of what zooming is for. The ease is the same hyperbola the zoom's own pace is squashed
 * through, so a wheel feels like one thing wherever in this window it is used.
 */
func stripScrubSeconds(delta: Double, duration: Double) -> Double {
    guard delta.isFinite, delta != 0, duration.isFinite, duration > 0 else { return 0 }
    let eased = tanh(abs(delta) / 6.0)
    return (1.0 / max(Double(Int(duration * 30.0)), 1)) * (0.35 + 1.65 * eased)
}

// MARK: - the tiles

/// A strip's tiling: how wide a tile is, how many of them span the strip, and each one's share of it.
struct StripTiling {
    let thumbWidth: Double
    let cellWidth: Double
    let count: Int
    let step: Double
}

/**
 * Tile a strip at a FIXED tile width, across whatever width it is drawn at.
 *
 * The tile is the shape of what is being shown and its size is the strip's own row height, so a tile's
 * width is a constant — and the count is the strip's width divided by it. That is the whole model: zooming
 * widens the strip, so the same source is covered by more tiles, so the segment under the pointer is drawn
 * across more of them. A segment at eleven tiles becomes a segment at forty, and the pictures in them are
 * four times as finely spaced.
 *
 * `cellWidth` is the strip shared out exactly among the tiles, so there is no gap at the end; it is the tile
 * width to within the rounding that sharing out costs, which is a fraction of a pixel.
 */
func stripTiling(frameCount: Int, stripWidth: Double, thumbHeight: Double, outAspect: Double) -> StripTiling {
    let height = thumbHeight > 0 ? thumbHeight : 48
    let aspect = outAspect.isFinite && outAspect > 0 ? outAspect : 16.0 / 9.0
    let width = max(1, (height * aspect).rounded())
    let frames = max(1, frameCount)
    let strip = stripWidth.isFinite ? max(0, stripWidth) : 0
    let count = max(1, min(Int((strip / width).rounded()), frames))
    let cell = strip / Double(count)
    return StripTiling(thumbWidth: width, cellWidth: cell, count: count, step: Double(frames) / Double(count))
}

/**
 * The source frame a tile shows: its own middle, held inside its own share of the strip.
 *
 * The holding is the part that matters, and it is not the same as subtracting a frame from the share's end.
 * A share narrower than two frames — which is what a deep zoom makes of every tile — has its last frame AT
 * or before its first, and a bound derived that way lands *before* the share it is meant to hold the frame
 * inside: the tile would show the frame just outside its own left edge. So the shares are stated in frames
 * — the first whole frame inside one and the last — and the middle is held between those.
 */
func stripTileFrame(_ index: Int, tiling: StripTiling, frameCount: Int) -> Int {
    let last = max(0, frameCount - 1)
    let low = Double(index) * tiling.step
    let high = Double(index + 1) * tiling.step
    let middle = (Double(index) + 0.5) * tiling.step
    let firstInside = Int(low.rounded(.up))
    let lastInside = max(firstInside, Int(high.rounded(.up)) - 1)
    let held = min(lastInside, max(firstInside, Int(middle.rounded())))
    return min(last, max(0, held))
}

// MARK: - the window

/**
 * The pixel offset of the visible window's left edge, holding an anchored frame where it is on screen.
 *
 * The anchored frame is the SKIMMER and `anchorX` is where it is on screen now. Holding that pair fixed
 * while the zoom changes is what makes a zoom a lens on the frame being looked at: the strip stretches
 * around the skimmer rather than around the window's own middle. The offset is held inside the strip, so at
 * either end the drawing settles against the end instead of running off it — the one place the skimmer is
 * allowed to move on screen, exactly as the timeline's is.
 */
func stripOffset(anchorFrame: Double, anchorX: Double, pxPerFrame: Double, stripWidth: Double, viewportWidth: Double) -> Double {
    guard pxPerFrame > 0, stripWidth > 0, viewportWidth > 0 else { return 0 }
    let wanted = anchorFrame * pxPerFrame - anchorX
    return max(0, min(max(0, stripWidth - viewportWidth), wanted))
}

/**
 * Which tiles of the strip are on screen, with one either side of the viewport so a partly visible tile at
 * an edge is drawn rather than appearing only once it is fully inside.
 */
func stripVisibleRange(offset: Double, viewportWidth: Double, cellWidth: Double, count: Int) -> (first: Int, last: Int) {
    guard cellWidth > 0, count > 0, viewportWidth > 0 else { return (0, -1) }
    let first = max(0, Int((offset / cellWidth).rounded(.down)) - 1)
    let last = min(count - 1, Int(((offset + viewportWidth) / cellWidth).rounded(.up)) + 1)
    return (first, max(first - 1, last))
}

// MARK: - the scale

/// The steps a scale may be drawn at, in seconds — the timeline's own ladder, so the two read alike.
let RULER_STEPS: [Double] = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
/// How far apart two labelled ranks must stand to be worth drawing, and two subdivisions at all.
let RULER_MAJOR_PX = 72.0
let RULER_MINOR_PX = 12.0

/// One mark on the scale: when it stands, and whether it is one of the labelled ranks.
struct RulerTick {
    let time: Double
    let major: Bool
}

/**
 * The two steps a scale is drawn at, from the ZOOM alone.
 *
 * That is what makes the scale read the same at every zoom: what changes as it is zoomed is what the marks
 * SAY, not how many of them are across the screen. Where a frame is wide enough to see, the scale counts in
 * FRAMES — a mark per frame, and a rank every so many frames — because the arrow keys step by one frame and
 * a scale whose marks are not frames makes a one-frame step land between two marks.
 */
func rulerSteps(zoom: Double, fps: Double) -> (major: Double, divisor: Int, step: Double) {
    let rate = stripPxPerSec(zoom)
    let frame = fps.isFinite && fps > 0 ? 1 / fps.rounded() : 0
    if frame > 0 && frame * rate >= RULER_MINOR_PX {
        let divisor = max(1, Int((RULER_MAJOR_PX / (frame * rate)).rounded(.up)))
        return (frame * Double(divisor), divisor, frame)
    }
    let major = RULER_STEPS.first { $0 * rate >= RULER_MAJOR_PX } ?? RULER_STEPS[RULER_STEPS.count - 1]
    let divisor = [5, 4, 2, 1].first { (major / Double($0)) * rate >= RULER_MINOR_PX } ?? 1
    return (major, divisor, major / Double(divisor))
}

/**
 * The marks the scale carries over the stretch it is showing.
 *
 * A WINDOW is what keeps it honest: a close zoom on a long source is an enormous drawing, and a scale drawn
 * across the whole of it would be tens of thousands of marks of which a hundred are ever visible. The marks
 * are generated for the stretch on screen — in the STRETCHED space, so they line up with the tiles — and the
 * mark at the very end is dropped, because it is drawn right-aligned and lands on the mark before it.
 */
func rulerTicks(duration: Double, zoom: Double, from: Double, to: Double, fps: Double) -> [RulerTick] {
    guard duration.isFinite, duration > 0 else { return [] }
    let steps = rulerSteps(zoom: zoom, fps: fps)
    let low = max(0, min(duration, from))
    let high = max(low, min(duration, to))
    var ticks: [RulerTick] = []
    var index = max(0, Int((low / steps.step).rounded(.down)))
    let last = Int((high / steps.step).rounded(.up))
    while index <= last {
        let time = Double(index) * steps.step
        if time > duration + steps.step / 1000 { break }
        ticks.append(RulerTick(time: time, major: index % steps.divisor == 0))
        index += 1
    }
    if let tail = ticks.last, duration - tail.time < steps.step / 2 { ticks.removeLast() }
    return ticks
}

// MARK: - the glide

/// How long a zoom glides, in seconds. The strip and the scale are read from the same zoom, so they move as one.
let zoomAnimationSeconds = 0.18

/// The easing a zoom glides with: a smoothstep, so it leaves and arrives at rest. Both ends are fixed points.
func easeInOut(_ t: Double) -> Double {
    let clamped = max(0, min(1, t))
    return clamped * clamped * (3 - 2 * clamped)
}

/// The zoom part-way along a glide: the elapsed shape is the ease's business, this is only the travel.
func interpolatedZoom(from: Double, to: Double, progress: Double) -> Double {
    let p = max(0, min(1, progress))
    return from + (to - from) * p
}
