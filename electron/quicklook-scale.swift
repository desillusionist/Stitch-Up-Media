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
/// The range the zoom may take when no window is in hand to say otherwise. Below 1 so a long source can
/// still be taken in at a glance.
let STRIP_ZOOM_MIN = 0.05
let STRIP_ZOOM_MAX = 32.0

/// Pixels of strip per second of source. The zoom decides it, and nothing else does.
func stripPxPerSec(_ zoom: Double) -> Double {
    BASE_PX_PER_SECOND * (zoom.isFinite && zoom > 0 ? zoom : 1)
}

///
/// A zoom held inside its range, with nonsense falling back to 1x.
///
/// The FLOOR is passed in rather than fixed, because the floor is the strip's fit and the fit depends on the
/// room there is — a strip narrower than its own window is a strip that has been zoomed out past the whole
/// source, which is not a state this model has. `STRIP_ZOOM_MIN` is the floor only when nothing more is
/// known: a long source in a wide window fits at a zoom far below it, and the fit has to be able to win.
func clampStripZoom(_ zoom: Double, floor: Double = STRIP_ZOOM_MIN) -> Double {
    guard zoom.isFinite, zoom > 0 else { return 1 }
    let low = floor.isFinite && floor > 0 ? floor : STRIP_ZOOM_MIN
    return max(low, min(STRIP_ZOOM_MAX, zoom))
}

/// The pixels one frame takes at a zoom, which is what places every mark on the strip.
func stripPxPerFrame(_ zoom: Double, fps: Double) -> Double {
    stripPxPerSec(zoom) / (fps.isFinite && fps > 0 ? fps : 30)
}

///
/// The zoom at which the whole source is exactly as wide as the room there is for it: the strip's FIT.
///
/// It is also the strip's FLOOR. "Not zoomed in" means the whole source is on screen, so a zoom shallower
/// than the fit would draw a strip narrower than the window it is in — the source would not be filling the
/// room it has, which is the state the fit defines. There is no zoom out past it.
///
/// The lower clamp is deliberately NOT applied here. A long source in a wide window fits at a zoom far below
/// `STRIP_ZOOM_MIN` — an hour at 24 pixels a second in a 900-pixel window fits at 0.01 — and clamping the fit
/// up to 0.05 would put the whole source permanently out of reach, which is the opposite of what a fit is
/// for. The upper clamp is, since nothing is gained by a fit beyond the deepest zoom.
func stripFitZoom(duration: Double, availableWidth: Double) -> Double {
    guard duration.isFinite, duration > 0, availableWidth > 0 else { return 1 }
    let raw = availableWidth / (duration * BASE_PX_PER_SECOND)
    guard raw.isFinite, raw > 0 else { return 1 }
    return min(STRIP_ZOOM_MAX, raw)
}

///
/// A wheel notch's worth of zoom.
///
/// The pace starts moving on the first event and settles at a cap, rather than easing in from nothing: an ease
/// that is flat near zero is what made the strip take several notches to budge and then jump once a fast turn
/// coalesced into a larger number. `eased` reaches most of its value within a notch or two of a real wheel, so
/// the first notch is already a visible step and the tenth is only a little more.
///
/// Held above the floor it is given, so a wheel turned to zoom out settles at the fit rather than opening a gap
/// wider than the window.
func stripZoomedBy(_ zoom: Double, delta: Double, floor: Double = STRIP_ZOOM_MIN) -> Double {
    guard delta.isFinite, delta != 0 else { return zoom }
    let eased = tanh(abs(delta) / 24)
    let factor = 1 + 0.06 * eased
    return clampStripZoom(delta < 0 ? zoom * factor : zoom / factor, floor: floor)
}

///
/// A scroll event's delta, normalised so a wheel notch and a trackpad flick are the same kind of number.
///
/// AppKit reports a mouse wheel in coarse notches — `hasPreciseScrollingDeltas` false, a delta of 1 or 3 a
/// notch — and a trackpad in fine points, where the same gesture is dozens of small deltas. Taken raw, one
/// number means two different things: a notch of 1 barely moves the zoom while a trackpad's many small deltas
/// add up quickly, and a fast wheel that coalesces into one bigger number jumps. A notch is given the weight
/// of a real gesture here, so the two devices answer alike and the first notch already moves the strip.
func stripWheelDelta(raw: Double, precise: Bool) -> Double {
    guard raw.isFinite, raw != 0 else { return 0 }
    return precise ? raw : raw * 24
}

///
/// Where a horizontal scroll leaves the strip: the offset moved by the scroll, held inside the drawing.
///
/// The two axes over the strip are separate gestures: a wheel turned up or down scrubs the skimmer, and a swipe
/// left or right PANS. This is the pan's arithmetic, and like the zoom's it is a model question rather than a
/// drawing one — the offset is pixels of strip scrolled off to the left, so panning is adding to it. The sign
/// of the delta is the caller's: a positive one moves the drawing further along. A source already narrower
/// than the room, or a window that is not scrolled, has nowhere to pan to and stays at its end.
func stripPannedOffset(offset: Double, deltaPixels: Double, stripWidth: Double, viewportWidth: Double) -> Double {
    guard stripWidth.isFinite, viewportWidth.isFinite, viewportWidth > 0 else { return 0 }
    let room = stripWidth - viewportWidth
    guard room > 0, deltaPixels.isFinite else { return 0 }
    let from = offset.isFinite ? offset : 0
    return max(0, min(room, from + deltaPixels))
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

/// The steps a scale may be drawn at, in seconds — the timeline's own ladder, so the two read alike. Used
/// only when no frame rate is known, since with one the marks count in frames.
let RULER_STEPS: [Double] = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
/// The steps a scale may be drawn at counted in FRAMES — the same 1-2-5 ladder, in the unit a frame-accurate
/// strip is actually read in.
let RULER_FRAME_STEPS: [Double] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]
/// How far apart a rank must stand before it is drawn taller and brighter than its subdivisions.
let RULER_MAJOR_PX = 72.0
/// The pitch at which notches start to crowd. It is a FLOOR, not a setting: the step is chosen so the notches
/// never come closer than this, and within that bound the pitch is left free to grow with the zoom — which
/// is the point of it.
let RULER_MINOR_PX = 12.0
/// How many subdivisions a rank stands above, smallest first: the first that clears `RULER_MAJOR_PX` is taken,
/// so a rank is only ever as far above its subdivisions as it has to be.
let RULER_DIVISORS: [Int] = [2, 4, 5, 10]

/// One mark on the scale: when it stands, and whether it is one of the labelled ranks.
struct RulerTick {
    let time: Double
    let major: Bool
}

/**
 * The two steps a scale is drawn at, from the ZOOM alone.
 *
 * The notch is a FRAME where a frame rate is known, and the step is the FINEST the frame ladder allows
 * before the notches would crowd — so within that bound the pitch is free to grow as the strip is zoomed in.
 * That is what makes density a reading rather than a constant: the notches pack together when the strip is
 * shrunk and spread apart when it is stretched, so how far apart they stand says which way the zoom went.
 *
 * The ladder is what keeps the two ends sensible rather than what holds the pitch still: zoomed far out a
 * frame would be a fraction of a pixel apart, so the step coarsens through 1, 2, 5, 10 frames and so on; it
 * is only the crowding at the shallow end (and the longest rank at the deep end) that the ladder answers.
 *
 * A rank is a whole number of subdivisions above one, so a notched ruler always has its fine and its coarse
 * ranks rather than being all of one kind.
 */
func rulerSteps(zoom: Double, fps: Double) -> (major: Double, divisor: Int, step: Double) {
    let rate = stripPxPerSec(zoom)
    guard rate > 0 else { return (1, 1, 1) }
    let frame = fps.isFinite && fps > 0 ? 1 / max(1, fps.rounded()) : 0
    let step: Double
    if frame > 0 {
        let frames = RULER_FRAME_STEPS.first { $0 * frame * rate >= RULER_MINOR_PX } ?? RULER_FRAME_STEPS[RULER_FRAME_STEPS.count - 1]
        step = frames * frame
    } else {
        step = RULER_STEPS.first { $0 * rate >= RULER_MINOR_PX } ?? RULER_STEPS[RULER_STEPS.count - 1]
    }
    let pitch = step * rate
    let divisor = RULER_DIVISORS.first { pitch * Double($0) >= RULER_MAJOR_PX } ?? RULER_DIVISORS[RULER_DIVISORS.count - 1]
    return (step * Double(divisor), divisor, step)
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
