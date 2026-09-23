import AppKit
import AVKit
import AVFoundation
import AudioToolbox
import CoreText

private let dotoFontName = "Doto"

private func registerDotoFont() {
    let candidates = [
        URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("public/fonts/Doto.woff2"),
        URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("dist/fonts/Doto.woff2"),
        URL(fileURLWithPath: Bundle.main.resourcePath ?? "").appendingPathComponent("fonts/Doto.woff2")
    ]
    if let url = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) {
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }
}

private let crtBlack = NSColor(calibratedRed: 0.02, green: 0.035, blue: 0.025, alpha: 1)
private let crtPanel = NSColor(calibratedRed: 0.04, green: 0.08, blue: 0.055, alpha: 1)
private let crtGreen = NSColor(calibratedRed: 0.49, green: 1, blue: 0.46, alpha: 1)
private let crtDim = NSColor(calibratedRed: 0.24, green: 0.61, blue: 0.31, alpha: 1)
private let crtYellow = NSColor(calibratedRed: 1, green: 0.72, blue: 0.12, alpha: 1)

/**
 * Whether the strip narrates what it is doing, which is off unless the environment asks for it.
 *
 * The one fault here that cannot be seen when it happens is the difference between a window that MOVES and
 * a strip that is ASKED FOR its frames: they are two lines of code in the same function, and on screen one
 * is "the strip zooms" and the other is "it does nothing at all". A report of the second has to be told
 * apart from a report about a stale binary some other way than by arguing, so `QUICKLOOK_TRACE=1` prints
 * every publish of the window and every ask for frames. `npm run check-sync` proves the same thing without
 * a person watching, and this is how to see it in the real window.
 */
private let quickLookTrace = ProcessInfo.processInfo.environment["QUICKLOOK_TRACE"] == "1"
private func trace(_ message: @autoclosure () -> String) {
    guard quickLookTrace else { return }
    FileHandle.standardError.write(Data(("[quicklook] " + message() + "\n").utf8))
}

final class PreviewWindow: NSWindow {
    var onCloseRequest: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 49 { NSApp.sendAction(#selector(PreviewView.togglePlayback), to: nil, from: nil); return }
        if event.keyCode == 53 { onCloseRequest?(); return }
        super.keyDown(with: event)
    }
}

final class DotoTitlebarController: NSTitlebarAccessoryViewController {
    private let label = NSTextField(labelWithString: "STITCH UP MEDIA // QUICK LOOK")
    override func loadView() {
        label.font = NSFont(name: dotoFontName, size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        label.textColor = NSColor(calibratedWhite: 0.58, alpha: 1)
        label.alignment = .left
        label.sizeToFit()
        view = NSView(frame: NSRect(x: 0, y: 0, width: 4096, height: 42))
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(calibratedRed: 0.067, green: 0.078, blue: 0.098, alpha: 1).cgColor
        view.layer?.borderColor = NSColor(calibratedRed: 0.412, green: 0.439, blue: 0.471, alpha: 1).cgColor
        view.layer?.borderWidth = 1
        label.frame = NSRect(x: 92, y: 0, width: label.frame.width, height: 42)
        label.autoresizingMask = [.minYMargin, .maxYMargin]
        view.addSubview(label)
        self.layoutAttribute = .left
        self.fullScreenMinHeight = 42
    }
}

final class TimecodeField: NSTextField, NSTextViewDelegate {
    var onCommit: ((String) -> Void)?
    var onStep: ((Int) -> Void)?
    var onCancel: (() -> Void)?
    var mode: String = "timestamp"
    private var editSnapshot = ""
    override var acceptsFirstResponder: Bool { true }
    override func becomeFirstResponder() -> Bool {
        let began = super.becomeFirstResponder()
        if began { editSnapshot = stringValue }
        if began, let range = stringValue.range(of: #"[0-9].*$"#, options: .regularExpression) { stringValue = String(stringValue[range]) }
        return began
    }
    override func mouseDown(with event: NSEvent) {
        super.mouseDown(with: event)
        window?.makeFirstResponder(self)
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.window?.makeFirstResponder(self)
            if let editor = self.window?.fieldEditor(true, for: self) as? NSTextView {
                editor.delegate = self
                editor.selectAll(nil)
            }
        }
    }
    func textView(_ textView: NSTextView, shouldChangeTextIn affectedCharRange: NSRange, replacementString: String?) -> Bool {
        guard let replacementString, !replacementString.isEmpty else { return true }
        let allowed = mode == "framestamp" ? CharacterSet.decimalDigits : CharacterSet.decimalDigits.union(CharacterSet(charactersIn: ":."))
        return replacementString.unicodeScalars.allSatisfy { allowed.contains($0) }
    }
    override func cancelOperation(_ sender: Any?) {
        stringValue = editSnapshot
        onCancel?()
        window?.makeFirstResponder(superview)
    }
    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.insertNewline(_:)) || selector == #selector(NSResponder.insertTab(_:)) {
            onCommit?(stringValue)
            window?.makeFirstResponder(superview)
            return true
        }
        if selector == #selector(NSResponder.cancelOperation(_:)) {
            cancelOperation(nil)
            return true
        }
        return false
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { stringValue = editSnapshot; onCancel?(); window?.makeFirstResponder(superview); return }
        if event.keyCode == 36 || event.keyCode == 76 { onCommit?(stringValue); window?.makeFirstResponder(superview); return }
        if let chars = event.characters, !chars.isEmpty, chars.rangeOfCharacter(from: CharacterSet.decimalDigits.union(CharacterSet(charactersIn: ":." )).inverted) != nil, event.keyCode != 51 { return }
        if event.keyCode == 126 { onStep?(1); return }
        if event.keyCode == 125 { onStep?(-1); return }
        super.keyDown(with: event)
    }
    override func resignFirstResponder() -> Bool {
        if isEditable { onCommit?(stringValue) }
        return super.resignFirstResponder()
    }
    override func scrollWheel(with event: NSEvent) {
        let delta = event.scrollingDeltaY != 0 ? event.scrollingDeltaY : event.scrollingDeltaX
        if delta != 0 { onStep?(delta > 0 ? 1 : -1) }
    }
}

final class MonitorPlayerView: AVPlayerView {
    var onScroll: ((NSEvent) -> Void)?
    override func scrollWheel(with event: NSEvent) {
        onScroll?(event)
    }
}

final class FilmstripView: NSView {
    /**
     * The tile views, a POOL rather than one per frame of the source.
     *
     * The strip used to make a view for every fourth frame of the source and spread them across itself,
     * which is the model this replaces. Now a tile holds a fixed number of pixels and the strip is as wide
     * as the zoom makes it, so what changes with the zoom is how many tiles are ACROSS it — and only the
     * ones on screen need a view at all. The pool grows to whatever the widest window asks for and is
     * reused as the strip scrolls.
     */
    private(set) var tileViews: [NSView] = []
    /** The source frame each pooled view is showing, or -1 for one that is not in use. */
    private(set) var tileFrames: [Int] = []
    /**
     * The frame each pooled view's PICTURE is of, which is not the same as the frame it is BOUND to.
     *
     * They part company for as long as a picture takes to arrive, and that is the whole reason this exists:
     * a tile bound to a frame whose picture never came back would otherwise look done — the binding is what
     * it has — and keep whatever it was showing. A glide binds every tile a step before it asks for any of
     * their pictures, so without this the last step's binding would satisfy the check and the pictures would
     * never be asked for at all.
     */
    private var tileShown: [Int] = []
    let selectionView = NSView()
    let inHandle = NSView(); let outHandle = NSView(); let playhead = NSView()
    var start = 0.0 { didSet { updateSelection() } }
    var end = 1.0 { didSet { updateSelection() } }
    var playheadValue = 0.0 { didSet { updateSelection() } }
    var selectedHandle = "in" { didSet { updateSelection() } }
    var onHandleChange: ((String, Double) -> Void)?
    var onHandleSelected: ((String) -> Void)?
    var onPlayheadSelected: (() -> Void)?
    var onPlayheadChange: ((Double) -> Void)?
    var onHoverTime: ((Double) -> Void)?
    private var dragging: String?
    private let isAudio: Bool
    private var peaks: [CGFloat] = []
    private let peakResolution = 2000
    private let sourceAspect: CGFloat
    private let sourceAsset: AVAsset
    private let sourceDuration: Double
    let frameRate: Double
    private var trackingAreaRef: NSTrackingArea?
    private var longPressWork: DispatchWorkItem?

    // MARK: the model — a zoom, and where the strip is scrolled to

    /// How long the source is, in seconds. The strip is this long, drawn at the zoom's own rate.
    var sourceSeconds: Double { sourceDuration }
    /// The zoom the strip is drawn at. Its whole width is the source's length times this rate.
    private(set) var zoom = 0.0
    /// The strip pixels scrolled off to the left. 0 is the beginning of the source.
    private(set) var offset = 0.0
    /// How many frames the source holds, which is what the strip's width is measured in.
    private(set) var totalFrames = 1
    /// The tiles the strip holds at this zoom, and the frame each of them shows.
    private var cachedTiling: StripTiling?
    /// Whether the strip has been fitted to the room it has yet, which only the first layout can do.
    private var fitted = false
    /// The fit the zoom was last held above, so a resize can tell a strip that WAS the whole source — and so
    /// has to be re-fitted to the new room — from one the user has deliberately zoomed into.
    private var lastFloor = 0.0
    /// The zoom a hold-to-zoom gesture was made from, to spring back to.
    private var restoreZoom = 1.0
    /// Whether the window was narrowed by a HOLD, which is let go of when the mouse is released.
    private var zoomHeld = false
    /* The glide: a zoom that has been asked for, and the window it is travelling from. */
    private var zoomTarget = 0.0
    private var zoomFrom = 0.0
    private var animTimer: Timer?
    private var animStart = 0.0
    /// The frame the glide pivots on, and where it stood on screen when the glide began.
    private var animAnchorFrame = 0.0
    private var animAnchorX = 0.0
    private var frameCache: [Int: CGImage] = [:]
    private var cacheOrder: [Int] = []
    private var pendingFrames: Set<Int> = []
    var onScaleChange: (() -> Void)?

    /// The strip's row height and the tile's height with it: the one number its density hangs off.
    private let tileHeight: CGFloat = 48
    /// How many tile pictures are kept. A strip's worth and then some, so scrolling back is instant.
    private let cacheLimit = 600

    init(asset: AVAsset, duration: Double, sourceAspect: CGFloat, isAudio: Bool, frameRate: Double = 30, frame: NSRect) {
        self.sourceAsset = asset
        self.sourceDuration = duration
        self.sourceAspect = max(0.1, sourceAspect)
        self.isAudio = isAudio
        self.frameRate = max(1, frameRate)
        self.totalFrames = max(1, Int((duration * max(1, frameRate)).rounded()))
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 1).cgColor
        layer?.masksToBounds = true
        updateTrackingArea()
        selectionView.wantsLayer = true; selectionView.layer?.borderColor = crtYellow.cgColor; selectionView.layer?.borderWidth = 2; selectionView.layer?.backgroundColor = crtYellow.withAlphaComponent(0.16).cgColor; addSubview(selectionView)
        for handle in [inHandle, outHandle] { handle.wantsLayer = true; handle.layer?.backgroundColor = crtYellow.cgColor; handle.layer?.borderColor = crtBlack.cgColor; handle.layer?.borderWidth = 1; handle.layer?.cornerRadius = 2; addSubview(handle) }
        playhead.wantsLayer = true; playhead.layer?.backgroundColor = NSColor.systemRed.cgColor; addSubview(playhead)
        if isAudio { loadWaveform(asset: asset) }
    }
    required init?(coder: NSCoder) { fatalError() }
    deinit { animTimer?.invalidate() }
    override var acceptsFirstResponder: Bool { true }

    // MARK: the strip's own figures

    /// The pixels a frame takes at this zoom. The whole model follows from it.
    private var pxPerFrame: Double { stripPxPerFrame(zoom, fps: frameRate) }
    /// How wide the strip is drawn: the source's length at the zoom's rate.
    var stripWidth: Double { Double(totalFrames) * pxPerFrame }
    /// The tiles the strip holds at this zoom.
    var tiling: StripTiling {
        stripTiling(frameCount: totalFrames, stripWidth: stripWidth, thumbHeight: Double(tileHeight), outAspect: Double(sourceAspect))
    }
    /// The room there is for the strip.
    private var viewportWidth: Double { max(0, Double(bounds.width)) }
    /// Where a fraction of the source stands on screen, in the stretched space. NOT held inside the view:
    /// a trim handle outside the window is a handle the user has zoomed away from, and clamping it would
    /// draw it sitting at an edge it is nowhere near.
    func screenX(forValue value: Double) -> CGFloat {
        CGFloat(value * sourceDuration * stripPxPerSec(zoom) - offset)
    }
    /// The fraction of the source a point on screen stands for, which is what a drag in this model is.
    private func value(at point: NSPoint) -> Double {
        let rate = stripPxPerSec(zoom)
        guard rate > 0, sourceDuration > 0 else { return 0 }
        return max(0, min(1, (offset + Double(point.x)) / rate / sourceDuration))
    }
    /// The frame the skimmer is on, which is what a zoom pivots on.
    private var skimmerFrame: Double { playheadValue * sourceDuration * frameRate }

    override func layout() {
        super.layout()
        adaptToViewport()
        tileStrip(paint: true)
        updateSelection()
    }

    /// A resize changes the room, and the room is both the floor the zoom may not go below and the width the
    /// strip is fitted to, so the fit is re-taken and the strip re-laid here. A manual-frames view is not
    /// handed a layout pass just because its frame changed, so this cannot be left to `layout` alone.
    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        guard newSize.width > 1, sourceDuration > 0 else { return }
        adaptToViewport()
        needsLayout = true
        needsDisplay = true
        onScaleChange?()
    }

    override func viewDidEndLiveResize() {
        super.viewDidEndLiveResize()
        guard bounds.width > 1, sourceDuration > 0 else { return }
        adaptToViewport()
        tileStrip(paint: true)
        updateSelection()
    }

    /**
     * Takes the room there is now, and holds the zoom above the fit it implies.
     *
     * The room decides two things: the fit, which is the strip's floor — a strip narrower than its window is
     * a strip that has been zoomed out past the whole source — and how much of the strip is on screen, which
     * re-clamps where the window is scrolled to. A resize therefore never changes a zoom the user chose; it
     * only re-fits a strip that WAS the whole source, so the source is still the whole source in the new
     * room, and re-clamps the drawing of a strip that has been zoomed into.
     */
    private func adaptToViewport() {
        let width = viewportWidth
        guard width > 1, sourceDuration > 0 else { return }
        let floor = fittedZoom
        if !fitted {
            fitted = true
            lastFloor = floor
            zoom = floor
            zoomTarget = floor
            offset = 0
            return
        }
        if zoom <= lastFloor * 1.0001 || zoom < floor {
            // The strip was the whole source, or the room has outgrown the zoom entirely: it is re-fitted.
            stopAnimation()
            zoom = floor
            zoomTarget = floor
        } else {
            zoomTarget = max(floor, zoomTarget)
        }
        lastFloor = floor
        offset = min(offset, max(0, stripWidth - width))
    }

    /// The zoom the whole source fits the room at, which is what "not zoomed in" means here — and the floor
    /// below which the strip may not be drawn, since a narrower strip is a source not filling its own room.
    private var fittedZoom: Double { stripFitZoom(duration: sourceDuration, availableWidth: viewportWidth) }

    /// Puts the strip where the model says, and paints the tiles that are on screen.
    ///
    /// `paint` is false while a zoom is gliding: the GEOMETRY follows every step, so the strip really does
    /// stretch under the gesture, but the pictures are not asked for until it settles. Asking on every step
    /// would put an ffmpeg behind a movement, and the token would throw all but the last set away anyway.
    private func tileStrip(paint: Bool) {
        let width = viewportWidth
        guard width > 1, sourceDuration > 0 else { return }
        let plan = tiling
        cachedTiling = plan
        if isAudio {
            // A sound has no frames to tile. Its waveform is drawn across the window instead, in `draw`.
            for view in tileViews { view.isHidden = true }
            needsDisplay = true
            onScaleChange?()
            return
        }
        let range = stripVisibleRange(offset: offset, viewportWidth: width, cellWidth: plan.cellWidth, count: plan.count)
        guard range.last >= range.first else { for view in tileViews { view.isHidden = true }; return }
        ensurePool(range.last - range.first + 1)
        var used = 0
        for index in range.first...range.last {
            let view = tileViews[used]
            let x = Double(index) * plan.cellWidth - offset
            view.isHidden = false
            // Rounded to the half-pixel the scale rounds its marks to, so a tile's edge and a mark for the
            // same frame land on the same line rather than a fraction apart.
            view.frame = NSRect(x: (CGFloat(x) * 2).rounded() / 2, y: 3, width: max(1, plan.cellWidth), height: bounds.height - 6)
            bind(view, at: used, frame: stripTileFrame(index, tiling: plan, frameCount: totalFrames), paint: paint)
            used += 1
        }
        for index in used..<tileViews.count {
            tileViews[index].isHidden = true
            if index < tileFrames.count { tileFrames[index] = -1; tileShown[index] = -1 }
        }
        needsDisplay = true
        onScaleChange?()
    }

    /// Grows the pool to what the window needs. It never shrinks: a pool that grew for one zoom is the
    /// right size for the next one out.
    private func ensurePool(_ needed: Int) {
        while tileViews.count < needed {
            let view = NSView(frame: .zero)
            view.wantsLayer = true
            view.layer?.backgroundColor = NSColor(calibratedWhite: 0.14, alpha: 1).cgColor
            view.layer?.contentsGravity = .resizeAspectFill
            view.layer?.masksToBounds = true
            view.layer?.contentsScale = 2
            // Below the trim overlay: the tiles are the BACKDROP, and the bounds, handles and skimmer are
            // drawn over them. They are inserted below `selectionView`, which was added first and is above
            // the tiles it is meant to frame.
            addSubview(view, positioned: .below, relativeTo: selectionView)
            tileViews.append(view)
            tileFrames.append(-1)
            tileShown.append(-1)
        }
    }

    /// Hands a pooled view its frame: from the cache if it has been seen, otherwise by asking for it.
    private func bind(_ view: NSView, at index: Int, frame: Int, paint: Bool) {
        tileFrames[index] = frame
        if index < tileShown.count, tileShown[index] == frame { return }
        if let cached = frameCache[frame] { view.layer?.contents = cached; tileShown[index] = frame; return }
        // The picture it already has is left in place rather than cleared. A tile whose frame has changed
        // shows the old one until the new one arrives, which is one frame of staleness; clearing it would
        // be a strip that flashes empty every time it moves.
        guard paint else { return }
        requestTile(frame: frame)
    }

    /**
     * Asks for one source frame, once.
     *
     * Keyed by the FRAME rather than by the tile, because the same frame is often wanted by two tiles at
     * once (a zoomed-out strip has fewer frames than tiles) and by the same tile again after it is scrolled
     * away and back. A frame already in flight is not asked for a second time, and one already in the cache
     * is not asked for at all.
     */
    private func requestTile(frame: Int) {
        if frameCache[frame] != nil || pendingFrames.contains(frame) { return }
        pendingFrames.insert(frame)
        let generator = AVAssetImageGenerator(asset: sourceAsset)
        generator.appliesPreferredTrackTransform = true
        // A tile in a zoomed strip names a frame that is worth seeing, so it is asked for exactly; at the
        // overview a tile stands in for a stretch and is asked for loosely, which is much faster and is not
        // a lie — it is a representative rather than a stepping stone.
        let tolerance = zoom > fittedZoom * 1.001 ? CMTime.zero : CMTime(value: 1, timescale: 4)
        generator.requestedTimeToleranceBefore = tolerance
        generator.requestedTimeToleranceAfter = tolerance
        let seconds = Double(frame) / max(1, frameRate)
        let time = CMTime(seconds: max(0, min(sourceDuration, seconds)), preferredTimescale: 600)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let image = try? generator.copyCGImage(at: time, actualTime: nil)
            DispatchQueue.main.async {
                guard let self else { return }
                self.pendingFrames.remove(frame)
                guard let image else { return }
                self.remember(image, for: frame)
            }
        }
    }

    /// Keeps a picture, and hands it to every tile that is showing its frame.
    private func remember(_ image: CGImage, for frame: Int) {
        if frameCache[frame] == nil {
            cacheOrder.append(frame)
            if cacheOrder.count > cacheLimit, let oldest = cacheOrder.first {
                cacheOrder.removeFirst()
                // Only drop it if it is not on screen: the tiles showing it would otherwise go blank.
                if !tileFrames.contains(oldest) { frameCache.removeValue(forKey: oldest) }
            }
        }
        frameCache[frame] = image
        for (index, shown) in tileFrames.enumerated() where shown == frame && index < tileViews.count {
            tileViews[index].layer?.contents = image
            tileShown[index] = frame
        }
    }

    // MARK: zoom, and the glide toward it

    /**
     * Zooms about the SKIMMER, which is the frame the zoom is then about.
     *
     * The skimmer keeps its place on screen while the strip stretches around it, so a zoom is a lens on the
     * frame being looked at rather than a jump. The zoom accumulates on the one being travelled TO rather
     * than the one on screen, so a flick's ticks add up to a single destination, and the move itself is
     * eased so the strip glides rather than jumping. It is held above the fit, so a wheel turned out settles
     * with the whole source on screen rather than opening a gap around it.
     */
    func zoom(byDelta delta: Double) {
        guard bounds.width > 1, sourceDuration > 0 else { return }
        let target = stripZoomedBy(zoomTarget > 0 ? zoomTarget : zoom, delta: delta, floor: fittedZoom)
        glideZoom(to: target, anchorFrame: skimmerFrame, anchorX: Double(screenX(forValue: playheadValue)))
    }

    /// Narrows onto a frame, which is what a hold-to-zoom asks for: the frame held, filling the strip.
    private func zoomOnto(frame: Double) {
        let target = cachedTiling.map { $0.thumbWidth * frameRate / BASE_PX_PER_SECOND } ?? clampStripZoom(zoom * 4, floor: fittedZoom)
        glideZoom(to: target, anchorFrame: frame, anchorX: Double(screenX(forValue: frame / max(sourceDuration * frameRate, 1))))
        onHoverTime?(min(1, max(0, frame / max(sourceDuration * frameRate, 1))))
    }

    private func glideZoom(to target: Double, anchorFrame: Double, anchorX: Double) {
        zoomTarget = clampStripZoom(target, floor: fittedZoom)
        zoomFrom = zoom
        animAnchorFrame = anchorFrame
        animAnchorX = anchorX
        animStart = ProcessInfo.processInfo.systemUptime
        guard animTimer == nil else { return }
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in self?.animationTick() }
        RunLoop.main.add(timer, forMode: .common)
        animTimer = timer
    }

    private func animationTick() {
        let progress = easeInOut((ProcessInfo.processInfo.systemUptime - animStart) / zoomAnimationSeconds)
        zoom = clampStripZoom(interpolatedZoom(from: zoomFrom, to: zoomTarget, progress: progress), floor: fittedZoom)
        offset = stripOffset(anchorFrame: animAnchorFrame, anchorX: animAnchorX, pxPerFrame: pxPerFrame, stripWidth: stripWidth, viewportWidth: viewportWidth)
        // Every step moves the geometry; the last one is what asks for the pictures.
        tileStrip(paint: progress >= 1)
        updateSelection()
        if progress >= 1 { stopAnimation() }
    }

    private func stopAnimation() {
        animTimer?.invalidate()
        animTimer = nil
    }

    private func restoreOverview() {
        zoomHeld = false
        glideZoom(to: fittedZoom, anchorFrame: skimmerFrame, anchorX: Double(bounds.width) / 2)
    }

    /// Scrolls the strip so the skimmer is back inside it, which is what dragging past an edge does.
    private func keepSkimmerVisible() {
        let width = viewportWidth
        guard width > 1, stripWidth > width else { offset = 0; return }
        let x = Double(screenX(forValue: playheadValue))
        let margin = 24.0
        if x < margin { offset = max(0, offset + (x - margin)) }
        else if x > width - margin { offset = min(stripWidth - width, offset + (x - (width - margin))) }
    }

    // MARK: the trim, the skimmer, and where they stand

    private func updateSelection() {
        onScaleChange?()
        guard bounds.width > 0 else { return }
        let left = screenX(forValue: start)
        let right = screenX(forValue: end)
        // In the strengthened space and NOT held inside the view: at a close zoom the in-point can be off
        // the left of the window and the out-point off the right, and a handle clamped to an edge would be
        // drawn where the point is not.
        selectionView.frame = NSRect(x: left, y: 1, width: max(18, right - left), height: bounds.height - 2)
        inHandle.frame = NSRect(x: left - 5, y: 0, width: 10, height: bounds.height)
        outHandle.frame = NSRect(x: right - 5, y: 0, width: 10, height: bounds.height)
        playhead.frame = NSRect(x: screenX(forValue: playheadValue) - 1, y: -4, width: 2, height: bounds.height + 8)
        inHandle.layer?.backgroundColor = (selectedHandle == "in" ? NSColor.white : NSColor.systemYellow).cgColor
        outHandle.layer?.backgroundColor = (selectedHandle == "out" ? NSColor.white : NSColor.systemYellow).cgColor
        inHandle.layer?.borderColor = (selectedHandle == "in" ? NSColor.systemYellow : NSColor.clear).cgColor
        outHandle.layer?.borderColor = (selectedHandle == "out" ? NSColor.systemYellow : NSColor.clear).cgColor
        inHandle.layer?.borderWidth = selectedHandle == "in" ? 2 : 0
        outHandle.layer?.borderWidth = selectedHandle == "out" ? 2 : 0
    }

    /// How close to a handle a press has to be to take hold of it, in pixels.
    private let handleGrab: CGFloat = 16

    private func updateTrackingArea() {
        if let trackingAreaRef { removeTrackingArea(trackingAreaRef) }
        let area = NSTrackingArea(rect: bounds, options: [.activeInKeyWindow, .mouseEnteredAndExited, .inVisibleRect], owner: self, userInfo: nil)
        trackingAreaRef = area; addTrackingArea(area)
    }
    override func updateTrackingAreas() { super.updateTrackingAreas(); updateTrackingArea() }

    /**
     * A hover over a tile is no longer anything to do.
     *
     * It used to be: the strip was a fixed set of cells over a window, so the one under the pointer held a
     * representative frame and had to be re-asked for the frame the pointer was actually over. In this model
     * every tile IS a frame of the source at its own place on the strip, so the picture under the pointer is
     * already the picture for that point and there is nothing to re-ask for.
     *
     * What is left of the old shape is the MONITOR: whatever moves the SKIMMER — a drag, a wheel, a step from
     * the arrow keys — has to show the frame it landed on, and this is that call. So a skim is now the skimmer
     * and only the skimmer: the value is handed on, and the monitor seeks to it, in the stretched space like
     * everything else. (The wheel and the drag also reach the monitor through `onPlayheadChange`, which is the
     * model's own channel; this is the one the arrow keys go through.)
     */
    func skimThumbnail(at norm: Double) { onHoverTime?(min(1, max(0, norm))) }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let inX = screenX(forValue: start)
        let outX = screenX(forValue: end)
        if abs(p.x - inX) < handleGrab { dragging = "in"; selectedHandle = "in"; onHandleSelected?("in") }
        else if abs(p.x - outX) < handleGrab { dragging = "out"; selectedHandle = "out"; onHandleSelected?("out") }
        else { dragging = "playhead"; selectedHandle = "playhead"; onHandleSelected?("playhead"); onPlayheadSelected?() }
        updateSelection()
        // The PREVIEW keeps the keyboard, not this view. The strip is a pointer surface: a hotkey pressed after
        // clicking it has to reach the view that owns the hotkeys, and if this view held first responder every
        // arrow key would land here and beep. It also holds the fields' focus rules together — see `keyDown`.
        window?.makeFirstResponder(superview ?? self)
        if dragging == "playhead" {
            let value = max(start, min(end, value(at: p)))
            playheadValue = value
            onPlayheadChange?(value)
        }
        guard !isAudio else { return }
        // Holding still narrows onto what is held, and letting go springs back. The frame under the press is
        // what it is about, whether or not a handle was taken hold of.
        let held = dragging == "in" ? start * sourceDuration * frameRate
            : dragging == "out" ? end * sourceDuration * frameRate
            : Double(value(at: p)) * sourceDuration * frameRate
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.dragging != nil else { return }
            self.zoomHeld = true
            self.restoreZoom = self.zoom
            self.zoomOnto(frame: held)
        }
        longPressWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
    }

    override func mouseDragged(with event: NSEvent) {
        guard let dragging else { return }
        // A hold is abandoned as soon as the pointer MOVES: a press that is going to become a drag is not a
        // press that means to narrow onto anything.
        if longPressWork != nil, abs(event.deltaX) > 3 || abs(event.deltaY) > 3 { longPressWork?.cancel(); longPressWork = nil }
        // A handle is moved by the pixels the pointer has moved, at the rate the strip is drawn at: dragging
        // it across a second's worth of strip moves it by exactly a second, at any zoom.
        let rate = stripPxPerSec(zoom)
        let deltaSeconds = rate > 0 ? Double(event.deltaX) / rate : 0
        switch dragging {
        case "in":
            let t = min(end * sourceDuration - 1.0 / frameRate, max(0, start * sourceDuration + deltaSeconds))
            start = t / max(sourceDuration, 0.001); selectedHandle = "in"; onHandleChange?("in", start); onHoverTime?(start)
        case "out":
            let t = max(start * sourceDuration + 1.0 / frameRate, min(sourceDuration, end * sourceDuration + deltaSeconds))
            end = t / max(sourceDuration, 0.001); selectedHandle = "out"; onHandleChange?("out", end); onHoverTime?(end)
        default:
            let t = max(0, min(sourceDuration, playheadValue * sourceDuration + deltaSeconds))
            playheadValue = t / max(sourceDuration, 0.001); onPlayheadChange?(playheadValue)
        }
        keepSkimmerVisible()
    }

    override func mouseUp(with event: NSEvent) {
        dragging = nil
        longPressWork = nil
        guard zoomHeld else { return }
        zoomHeld = false
        glideZoom(to: restoreZoom, anchorFrame: skimmerFrame, anchorX: Double(bounds.width) / 2)
    }

    /**
     * A scroll here scrubs, or pans — the two axes are two gestures.
     *
     * A wheel turned UP or DOWN scrubs, in the stretched space, which is the vertical axis' business. The delta
     * is normalised to the one the timeline's own engine is given — the EDIT JOB reads a browser's `deltaY`,
     * AppKit writes `scrollingDeltaY` with the sign the other way round — so a wheel turned away from the
     * viewer moves FORWARD through the source and one turned towards it moves back, which is what a wheel over
     * the timeline does. The step is a share of a second eased by how hard the wheel was turned.
     *
     * A swipe LEFT or RIGHT PANS instead, which is the horizontal axis' business: the strip slides under the
     * window while the skimmer stays where it is, both in the same stretched space as the scale, so the ruler
     * slides with it. Which gesture it is, is decided by which axis moved further, so a trackpad that reports a
     * little of both does the one that was meant.
     */
    override func scrollWheel(with event: NSEvent) {
        let dx = Double(event.scrollingDeltaX), dy = Double(event.scrollingDeltaY)
        if abs(dx) > abs(dy) {
            offset = stripPannedOffset(offset: offset, deltaPixels: dx, stripWidth: stripWidth, viewportWidth: viewportWidth)
            tileStrip(paint: true)
            updateSelection()
            return
        }
        let delta = -dy
        guard delta != 0 else { return }
        let selected = selectedHandle == "in" ? start : selectedHandle == "out" ? end : playheadValue
        let step = stripScrubSeconds(delta: Double(delta), duration: sourceDuration)
        let raw = selected + (delta < 0 ? step : -step)
        switch selectedHandle {
        case "in":
            let value = max(0, min(end - 0.001, raw))
            start = value; onHandleChange?("in", value)
        case "out":
            let value = max(start + 0.001, min(1, raw))
            end = value; onHandleChange?("out", value)
        default:
            let value = max(start, min(end, raw))
            playheadValue = value; onPlayheadChange?(value)
        }
        keepSkimmerVisible()
        updateSelection()
    }

    /**
     * Keys belong to the preview, not to this view.
     *
     * Nothing here moves by a key — the arrow keys and the hotkeys are the preview's, and it is the preview
     * that holds one element or another as the active one and moves it. A press that landed here (a click on
     * the strip, then a key) is handed straight on rather than swallowed into a beep, so the focus and the
     * active element are one thing wherever the pointer last was.
     */
    override func keyDown(with event: NSEvent) { nextResponder?.keyDown(with: event) ?? super.keyDown(with: event) }

    private func audioFormat(_ track: AVAssetTrack) -> AudioStreamBasicDescription? {
        guard let desc = track.formatDescriptions.first else { return nil }
        return CMAudioFormatDescriptionGetStreamBasicDescription(desc as! CMFormatDescription)?.pointee
    }

    private func loadWaveform(asset: AVAsset) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self, let track = asset.tracks(withMediaType: .audio).first, let reader = try? AVAssetReader(asset: asset) else { return }
            let output = AVAssetReaderTrackOutput(track: track, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsFloatKey: false, AVLinearPCMIsNonInterleaved: false])
            output.alwaysCopiesSampleData = false; guard reader.canAdd(output) else { return }; reader.add(output); guard reader.startReading() else { return }
            let format = self.audioFormat(track); let sampleRate = format?.mSampleRate ?? 44100; let channels = max(1, Int(format?.mChannelsPerFrame ?? 1)); let buckets = self.peakResolution; let totalSamples = max(buckets, Int(asset.duration.seconds * sampleRate) * channels); let samplesPerBucket = max(1, totalSamples / buckets)
            var sumSquares = [Double](repeating: 0, count: buckets); var counts = [Int](repeating: 0, count: buckets); var sampleIndex = 0
            while reader.status == .reading, let sampleBuffer = output.copyNextSampleBuffer() {
                guard let block = CMSampleBufferGetDataBuffer(sampleBuffer) else { CMSampleBufferInvalidate(sampleBuffer); continue }
                var length = 0; var pointer: UnsafeMutablePointer<Int8>?; CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer)
                if let pointer { let sampleCount = length / MemoryLayout<Int16>.size; pointer.withMemoryRebound(to: Int16.self, capacity: sampleCount) { samples in for i in 0..<sampleCount { let value = Double(samples[i]) / 32768.0; let bucket = min(buckets - 1, sampleIndex / samplesPerBucket); sumSquares[bucket] += value * value; counts[bucket] += 1; sampleIndex += 1 } } }
                CMSampleBufferInvalidate(sampleBuffer)
            }
            var result = [CGFloat](repeating: 0, count: buckets)
            var globalMax: CGFloat = 0
            for bucket in 0..<buckets { let rms = counts[bucket] > 0 ? CGFloat((sumSquares[bucket] / Double(counts[bucket])).squareRoot()) : 0; result[bucket] = rms; globalMax = max(globalMax, rms) }
            if globalMax > 0 { for index in result.indices { result[index] /= globalMax } }
            DispatchQueue.main.async { self.peaks = result; self.needsDisplay = true }
        }
    }

    /**
     * A sound drawn across the window it is showing.
     *
     * The peaks are the whole file's, and which of them a column stands for is read from the STRETCHED
     * space — so zooming in widens the sound exactly as it widens the pictures, which is the point. Bar on
     * bar with a gap, at a fixed width, so the drawing does not change character with the zoom.
     */
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard isAudio, bounds.width > 0, sourceDuration > 0 else { return }
        let midY = bounds.height / 2
        crtDim.withAlphaComponent(0.45).setFill(); NSRect(x: 0, y: midY - 0.5, width: bounds.width, height: 1).fill()
        guard !peaks.isEmpty, let ctx = NSGraphicsContext.current?.cgContext else { return }
        let rate = stripPxPerSec(zoom)
        let barWidth: CGFloat = 2, gap: CGFloat = 2, stride = barWidth + gap
        let barCount = max(1, Int(bounds.width / stride))
        let half = max(1, (midY - 3) * 0.9)
        crtGreen.setFill()
        for index in 0..<barCount {
            let from = (offset + Double(index) * Double(stride)) / rate
            let to = (offset + Double(index + 1) * Double(stride)) / rate
            let low = max(0, Int(from / sourceDuration * Double(peaks.count)))
            let high = min(peaks.count, max(low + 1, Int(to / sourceDuration * Double(peaks.count))))
            var peak: CGFloat = 0
            for bucket in low..<max(low + 1, high) { peak = max(peak, peaks[min(bucket, peaks.count - 1)]) }
            let height = max(1, peak * half)
            ctx.fill(NSRect(x: CGFloat(index) * stride, y: midY - height, width: barWidth, height: height * 2))
        }
    }
}

/**
 * The compact scale above the filmstrip: the same window as the strip, drawn as notches and nothing else.
 *
 * It is a ruler, so it carries no labels — no frame numbers, no timecodes, no units. Its two jobs are to
 * make the range legible and to give the zoom a place of its own: a scroll over the STRIP scrubs, a scroll
 * over the SCALE zooms, and neither has to ask the other what it meant.
 *
 * Everything it draws comes from the strip's zoom and offset, in the SAME stretched space the tiles are laid
 * in, so a mark stands over the tile it describes at any zoom and whether or not that part of the strip is
 * the part on screen. The arithmetic is in `quicklook-scale.swift`, where it is asserted without a window.
 */
final class TimelineScaleView: NSView {
    weak var filmstrip: FilmstripView?
    /** How tall a subdivision stands, of the scale's own height. A labelled rank is the whole of it. */
    private let subdivisionHeight: CGFloat = 7

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = crtBlack.cgColor
    }
    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let filmstrip, !filmstrip.isHidden, bounds.width > 1, let ctx = NSGraphicsContext.current?.cgContext else { return }
        let rate = stripPxPerSec(filmstrip.zoom)
        guard rate > 0 else { return }
        let duration = filmstrip.sourceSeconds
        let from = filmstrip.offset / rate
        let to = (filmstrip.offset + Double(bounds.width)) / rate
        // The strip's own half-pixel rounding, so a mark for a tile's boundary stands ON it.
        let half: (CGFloat) -> CGFloat = { (value) in (value * 2).rounded() / 2 }
        for tick in rulerTicks(duration: duration, zoom: filmstrip.zoom, from: from, to: to, fps: filmstrip.frameRate) {
            let x = half(CGFloat(tick.time * rate - filmstrip.offset))
            ctx.setFillColor((tick.major ? crtGreen.withAlphaComponent(0.85) : crtDim.withAlphaComponent(0.6)).cgColor)
            ctx.fill(NSRect(x: x, y: 0, width: 1, height: tick.major ? bounds.height : subdivisionHeight))
        }
        // The skimmer, in the strip's stretched space rather than as a share of the width — so it stands
        // where the playhead is and not where a fraction of the window happens to fall.
        ctx.setFillColor(NSColor.systemRed.withAlphaComponent(0.85).cgColor)
        ctx.fill(NSRect(x: half(CGFloat(filmstrip.playheadValue * duration * rate - filmstrip.offset)), y: 0, width: 1, height: bounds.height))
    }

    /**
     * A scroll here zooms the strip, about the skimmer.
     *
     * The pace and the pivot are the strip's own business; this only says that a scroll over the ruler is a
     * zoom and one over the strip is a scrub. The sign is normalised to the timeline's own — see the strip's
     * `scrollWheel` — so a wheel turned away from the viewer zooms in, exactly as it does over the timeline.
     */
    override func scrollWheel(with event: NSEvent) {
        guard let filmstrip, filmstrip.bounds.width > 1 else { return }
        let delta = -(event.scrollingDeltaY != 0 ? event.scrollingDeltaY : event.scrollingDeltaX)
        guard delta != 0 else { return }
        filmstrip.zoom(byDelta: Double(delta))
    }

    /** A press here is a press on a ruler: nothing to drag, and nothing to hand on to the strip. */
    override func mouseDown(with event: NSEvent) {}
}
final class PreviewView: NSView {
    let playerView: MonitorPlayerView; let imageView = NSImageView(frame: .zero); let player: AVPlayer; let asset: AVAsset; let sourceURL: URL; let screenshotDirectory: URL?; let audioArtwork: Bool; let filmstrip: FilmstripView; let scaleView = TimelineScaleView(frame: .zero); let frameRate: Double; let displayFps: Double; let sourceDuration: Double; let stampMode: String
    let appTitlebar = NSView()
    let appTitle = NSTextField(labelWithString: "STITCH UP MEDIA // QUICK LOOK")
    let doneButton = NSButton(title: "DONE", target: nil, action: nil); let revertButton = NSButton(title: "REVERT", target: nil, action: nil); let cancelButton = NSButton(title: "CANCEL", target: nil, action: nil)
    let inField = TimecodeField(string: ""); let outField = TimecodeField(string: ""); let screenshotFolderButton = NSButton(title: "↗", target: nil, action: nil); let trimmedDurationLabel = NSTextField(labelWithString: ""); let titleLabel = NSTextField(labelWithString: ""); let toastLabel = NSTextField(labelWithString: ""); let timestampLabel = NSTextField(labelWithString: ""); let sourceStampLabel = NSTextField(labelWithString: ""); let dimsLabel = NSTextField(labelWithString: "")
    private var titleHideWork: DispatchWorkItem?
    private var undoStack: [(Double, Double)] = []
    private var redoStack: [(Double, Double)] = []
    private var verticalKey: UInt16?
    private var verticalPresses = 0
    weak var controller: PreviewController?
    var hasChanges = false
    let stillMode: Bool
    init(player: AVPlayer, asset: AVAsset, url: URL, duration: Double, frameRate: Double, sourceAspect: CGFloat, isAudio: Bool, initialStart: Double?, initialEnd: Double?, stillMode: Bool, screenshotDirectory: URL?, stampMode: String, sequenceFps: Double?, sequenceFrameCount: Int?, frame: NSRect) {
        self.stillMode = stillMode; self.player = player; self.asset = asset; self.sourceURL = url; self.screenshotDirectory = screenshotDirectory; self.audioArtwork = asset.tracks(withMediaType: .video).isEmpty && (asset.metadata.first(where: { ($0.commonKey?.rawValue == "artwork" || $0.identifier?.rawValue.contains("covr") == true) && $0.dataValue != nil }) != nil); self.frameRate = max(1, frameRate); self.displayFps = (sequenceFps ?? 0) > 0 ? max(1, sequenceFps!) : max(1, frameRate); self.sourceDuration = ((sequenceFrameCount ?? 0) > 0 && (sequenceFps ?? 0) > 0) ? Double(sequenceFrameCount!) / max(1, sequenceFps!) : max(duration, 0.001); self.stampMode = stampMode; self.playerView = MonitorPlayerView(frame: .zero); self.filmstrip = FilmstripView(asset: asset, duration: duration, sourceAspect: sourceAspect, isAudio: isAudio, frameRate: frameRate, frame: .zero); super.init(frame: frame)
        wantsLayer = true; layer?.backgroundColor = crtBlack.cgColor
        filmstrip.onHoverTime = { [weak self] normalized in self?.seek(to: max(0, min(1, normalized))) }
        appTitlebar.translatesAutoresizingMaskIntoConstraints = false; appTitlebar.wantsLayer = true; appTitlebar.layer?.backgroundColor = NSColor(calibratedRed: 0.067, green: 0.078, blue: 0.098, alpha: 1).cgColor; appTitlebar.layer?.borderColor = NSColor(calibratedRed: 0.412, green: 0.439, blue: 0.471, alpha: 1).cgColor; appTitlebar.layer?.borderWidth = 1; addSubview(appTitlebar)
        appTitle.font = NSFont(name: dotoFontName, size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .medium); appTitle.textColor = NSColor(calibratedWhite: 0.58, alpha: 1); appTitle.alignment = .left; appTitle.translatesAutoresizingMaskIntoConstraints = false; appTitlebar.addSubview(appTitle)
        playerView.translatesAutoresizingMaskIntoConstraints = false; playerView.player = player; playerView.videoGravity = .resizeAspectFill; playerView.controlsStyle = .floating; playerView.onScroll = { [weak self] event in self?.filmstrip.scrollWheel(with: event) }; if !stillMode { addSubview(playerView) }
        imageView.translatesAutoresizingMaskIntoConstraints = false; imageView.imageScaling = .scaleProportionallyUpOrDown; imageView.imageAlignment = .alignCenter; imageView.image = NSImage(contentsOf: url); if audioArtwork, let item = asset.metadata.first(where: { ($0.commonKey?.rawValue == "artwork" || $0.identifier?.rawValue.contains("covr") == true) && $0.dataValue != nil }), let data = item.dataValue { imageView.image = NSImage(data: data) }; imageView.isHidden = !(stillMode || audioArtwork); imageView.alphaValue = 1.0; imageView.imageScaling = .scaleProportionallyUpOrDown; if audioArtwork { playerView.contentOverlayView?.addSubview(imageView) } else { addSubview(imageView) }
        titleLabel.stringValue = url.lastPathComponent; titleLabel.textColor = crtGreen.withAlphaComponent(0.78); titleLabel.font = NSFont(name: dotoFontName, size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .medium); titleLabel.alignment = .center; titleLabel.translatesAutoresizingMaskIntoConstraints = false; titleLabel.wantsLayer = true; addSubview(titleLabel); toastLabel.font = NSFont(name: dotoFontName, size: 10) ?? NSFont.monospacedSystemFont(ofSize: 10, weight: .medium); toastLabel.textColor = crtGreen; toastLabel.alignment = .center; toastLabel.maximumNumberOfLines = 1; toastLabel.lineBreakMode = .byTruncatingTail; toastLabel.setContentHuggingPriority(.defaultLow, for: .horizontal); toastLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal); toastLabel.isHidden = true; toastLabel.wantsLayer = true; toastLabel.layer?.backgroundColor = crtBlack.withAlphaComponent(0.82).cgColor; toastLabel.layer?.cornerRadius = 3; toastLabel.layer?.borderColor = crtGreen.withAlphaComponent(0.65).cgColor; toastLabel.layer?.borderWidth = 1; toastLabel.translatesAutoresizingMaskIntoConstraints = false; addSubview(toastLabel)
        dimsLabel.textColor = crtGreen.withAlphaComponent(0.55); dimsLabel.font = NSFont(name: dotoFontName, size: 10) ?? NSFont.monospacedSystemFont(ofSize: 10, weight: .regular); dimsLabel.alignment = .center; dimsLabel.translatesAutoresizingMaskIntoConstraints = false; dimsLabel.wantsLayer = true; addSubview(dimsLabel); if stillMode, let rep = NSImage(contentsOf: url)?.representations.first { dimsLabel.stringValue = "\(rep.pixelsWide) × \(rep.pixelsHigh)" } else if let track = asset.tracks(withMediaType: .video).first { let mapped = track.naturalSize.applying(track.preferredTransform); let fps = max(1, Int(displayFps.rounded())); dimsLabel.stringValue = "\(Int(abs(mapped.width))) × \(Int(abs(mapped.height))) • \(fps) FPS" }
        timestampLabel.textColor = crtGreen; timestampLabel.font = NSFont(name: dotoFontName, size: 12) ?? NSFont.monospacedSystemFont(ofSize: 12, weight: .medium); timestampLabel.alignment = .center; timestampLabel.translatesAutoresizingMaskIntoConstraints = false; timestampLabel.wantsLayer = true; timestampLabel.layer?.backgroundColor = NSColor(calibratedWhite: 0, alpha: 0.45).cgColor; timestampLabel.layer?.cornerRadius = 3; addSubview(timestampLabel)
        sourceStampLabel.textColor = crtGreen; sourceStampLabel.font = NSFont(name: dotoFontName, size: 12) ?? NSFont.monospacedSystemFont(ofSize: 12, weight: .medium); sourceStampLabel.alignment = .center; sourceStampLabel.translatesAutoresizingMaskIntoConstraints = false; sourceStampLabel.wantsLayer = true; sourceStampLabel.layer?.backgroundColor = NSColor(calibratedWhite: 0, alpha: 0.45).cgColor; sourceStampLabel.layer?.cornerRadius = 3; addSubview(sourceStampLabel)
        trimmedDurationLabel.textColor = crtGreen; trimmedDurationLabel.font = NSFont(name: dotoFontName, size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .medium); trimmedDurationLabel.alignment = .center; trimmedDurationLabel.translatesAutoresizingMaskIntoConstraints = false; trimmedDurationLabel.wantsLayer = true; addSubview(trimmedDurationLabel)
        filmstrip.translatesAutoresizingMaskIntoConstraints = false; addSubview(filmstrip)
        // The scale sits in the gap between the monitor and the strip, sharing the strip's own leading and
        // trailing edges so a mark stands over the frame it describes. It is told to redraw whenever the
        // strip's range or playhead moves, which is the whole of how the two stay in step.
        scaleView.translatesAutoresizingMaskIntoConstraints = false; scaleView.filmstrip = filmstrip; addSubview(scaleView)
        filmstrip.onScaleChange = { [weak self] in self?.scaleView.needsDisplay = true }
        [inField, outField, doneButton, revertButton, cancelButton, screenshotFolderButton].forEach { $0.translatesAutoresizingMaskIntoConstraints = false }
        screenshotFolderButton.title = "↗"; screenshotFolderButton.toolTip = "Open screenshot folder"; screenshotFolderButton.isHidden = true; screenshotFolderButton.font = NSFont(name: dotoFontName, size: 13) ?? NSFont.monospacedSystemFont(ofSize: 13, weight: .medium); screenshotFolderButton.contentTintColor = crtGreen; screenshotFolderButton.isBordered = false; screenshotFolderButton.target = self; screenshotFolderButton.action = #selector(openScreenshotFolder)
        addSubview(screenshotFolderButton)

        inField.textColor = crtYellow; inField.font = NSFont(name: dotoFontName, size: 10) ?? NSFont.monospacedSystemFont(ofSize: 10, weight: .medium); inField.alignment = .left; inField.isBordered = false; inField.drawsBackground = false; inField.isEditable = true; inField.isSelectable = true; inField.focusRingType = .none
        outField.textColor = crtYellow; outField.font = NSFont(name: dotoFontName, size: 10) ?? NSFont.monospacedSystemFont(ofSize: 10, weight: .medium); outField.alignment = .right; outField.isBordered = false; outField.drawsBackground = false; outField.isEditable = true; outField.isSelectable = true; outField.focusRingType = .none
        inField.mode = stampMode; outField.mode = stampMode
        [doneButton, revertButton, cancelButton].forEach { button in button.font = NSFont(name: dotoFontName, size: 10) ?? NSFont.monospacedSystemFont(ofSize: 10, weight: .medium); button.contentTintColor = crtGreen; button.bezelColor = crtPanel; button.wantsLayer = true; button.layer?.borderColor = crtDim.cgColor; button.layer?.borderWidth = 1; button.layer?.cornerRadius = 2 }
        inField.onCommit = { [weak self] text in self?.commit(text, handle: "in") }; outField.onCommit = { [weak self] text in self?.commit(text, handle: "out") }; inField.target = self; inField.action = #selector(commitInFromAction); outField.target = self; outField.action = #selector(commitOutFromAction)
        inField.onStep = { [weak self] delta in self?.step(handle: "in", delta: delta) }; outField.onStep = { [weak self] delta in self?.step(handle: "out", delta: delta) }; inField.onCancel = { [weak self] in self?.selectionChanged(start: self?.filmstrip.start ?? 0, end: self?.filmstrip.end ?? 1, seek: false) }; outField.onCancel = { [weak self] in self?.selectionChanged(start: self?.filmstrip.start ?? 0, end: self?.filmstrip.end ?? 1, seek: false) }
        filmstrip.onHandleSelected = { [weak self] handle in
            guard let self else { return }
            if handle == "in" || handle == "out" { self.filmstrip.selectedHandle = handle; self.filmstrip.needsDisplay = true }
        }
        filmstrip.onHandleChange = { [weak self] handle, value in
            guard let self else { return }
            self.recordChange()
            self.hasChanges = true
            self.filmstrip.selectedHandle = handle
            if handle == "in" { self.selectionChanged(start: value, end: self.filmstrip.end, seek: true) }
            else { self.selectionChanged(start: self.filmstrip.start, end: value, seek: true) }
        }
        filmstrip.onPlayheadChange = { [weak self] value in
            guard let self else { return }
            let bounded = max(self.filmstrip.start, min(self.filmstrip.end, value))
            self.filmstrip.playheadValue = bounded
            self.seek(to: bounded)
        }
        addSubview(inField); addSubview(outField)
        if stillMode { filmstrip.isHidden = true; scaleView.isHidden = true; inField.isHidden = true; outField.isHidden = true; timestampLabel.isHidden = true; sourceStampLabel.isHidden = true; playerView.isHidden = true }
        var layout: [NSLayoutConstraint] = [
            appTitlebar.topAnchor.constraint(equalTo: topAnchor), appTitlebar.leadingAnchor.constraint(equalTo: leadingAnchor), appTitlebar.trailingAnchor.constraint(equalTo: trailingAnchor), appTitlebar.heightAnchor.constraint(equalToConstant: 42),
            appTitle.leadingAnchor.constraint(equalTo: appTitlebar.leadingAnchor, constant: 92), appTitle.trailingAnchor.constraint(lessThanOrEqualTo: appTitlebar.trailingAnchor, constant: -18), appTitle.centerYAnchor.constraint(equalTo: appTitlebar.centerYAnchor),
            titleLabel.topAnchor.constraint(equalTo: (stillMode ? imageView.topAnchor : playerView.topAnchor), constant: 10), titleLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12), titleLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            dimsLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2), toastLabel.centerXAnchor.constraint(equalTo: centerXAnchor), toastLabel.centerYAnchor.constraint(equalTo: playerView.centerYAnchor), toastLabel.bottomAnchor.constraint(lessThanOrEqualTo: playerView.bottomAnchor, constant: -20), toastLabel.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 120), toastLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -120), toastLabel.widthAnchor.constraint(lessThanOrEqualTo: playerView.widthAnchor, multiplier: 0.72), dimsLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12), dimsLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12)
        ]
        if stillMode {
            layout += [imageView.topAnchor.constraint(equalTo: appTitlebar.bottomAnchor), imageView.leadingAnchor.constraint(equalTo: leadingAnchor), imageView.trailingAnchor.constraint(equalTo: trailingAnchor), imageView.bottomAnchor.constraint(equalTo: bottomAnchor)]
            layout.append(trimmedDurationLabel.centerXAnchor.constraint(equalTo: centerXAnchor)); layout.append(trimmedDurationLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -14))
        } else {
            if audioArtwork, let overlay = playerView.contentOverlayView { layout += [imageView.topAnchor.constraint(equalTo: overlay.topAnchor), imageView.leadingAnchor.constraint(equalTo: overlay.leadingAnchor), imageView.trailingAnchor.constraint(equalTo: overlay.trailingAnchor), imageView.bottomAnchor.constraint(equalTo: overlay.bottomAnchor)] }
            layout += [
                screenshotFolderButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14), screenshotFolderButton.bottomAnchor.constraint(equalTo: playerView.bottomAnchor, constant: -12), screenshotFolderButton.widthAnchor.constraint(equalToConstant: 28), screenshotFolderButton.heightAnchor.constraint(equalToConstant: 24),
                    timestampLabel.leadingAnchor.constraint(equalTo: playerView.leadingAnchor, constant: 12), timestampLabel.bottomAnchor.constraint(equalTo: playerView.bottomAnchor, constant: -12),
                    sourceStampLabel.trailingAnchor.constraint(equalTo: playerView.trailingAnchor, constant: -12), sourceStampLabel.bottomAnchor.constraint(equalTo: playerView.bottomAnchor, constant: -12),
                trimmedDurationLabel.centerXAnchor.constraint(equalTo: centerXAnchor), trimmedDurationLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
                playerView.topAnchor.constraint(equalTo: appTitlebar.bottomAnchor), playerView.leadingAnchor.constraint(equalTo: leadingAnchor), playerView.trailingAnchor.constraint(equalTo: trailingAnchor), playerView.bottomAnchor.constraint(equalTo: scaleView.topAnchor, constant: -10),
                // The scale and the strip share both edges exactly: this is what makes a mark stand over
                // the frame it names rather than near it.
                scaleView.leadingAnchor.constraint(equalTo: filmstrip.leadingAnchor), scaleView.trailingAnchor.constraint(equalTo: filmstrip.trailingAnchor), scaleView.heightAnchor.constraint(equalToConstant: 20), scaleView.bottomAnchor.constraint(equalTo: filmstrip.topAnchor, constant: -10),
                filmstrip.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 18), filmstrip.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -18), filmstrip.heightAnchor.constraint(equalToConstant: 82), filmstrip.bottomAnchor.constraint(equalTo: inField.topAnchor, constant: -10),
                inField.leadingAnchor.constraint(equalTo: filmstrip.leadingAnchor), inField.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12), inField.widthAnchor.constraint(equalToConstant: 150),
                outField.trailingAnchor.constraint(equalTo: filmstrip.trailingAnchor), outField.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12), outField.widthAnchor.constraint(equalToConstant: 150)
            ]
        }
        NSLayoutConstraint.activate(layout)
        let initialIn = max(0, min(1, (initialStart ?? 0) / max(sourceDuration, 0.001)))
        let initialOut = max(initialIn + 0.001, min(1, (initialEnd ?? sourceDuration) / max(sourceDuration, 0.001)))
        selectionChanged(start: initialIn, end: initialOut, seek: false); filmstrip.playheadValue = initialIn; timestampLabel.stringValue = stampText("CUR", initialIn * sourceDuration); sourceStampLabel.stringValue = stampText("SRC", sourceDuration); updateTrimmedDurationLabel(); installTrackingArea(); showOverlay()
    }
    required init?(coder: NSCoder) { fatalError() }
    override var acceptsFirstResponder: Bool { true }
    override func becomeFirstResponder() -> Bool { true }
    private func installTrackingArea() {
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil))
    }
    override func mouseEntered(with event: NSEvent) { showOverlay() }
    override func mouseMoved(with event: NSEvent) { showOverlay() }
    override func mouseExited(with event: NSEvent) { scheduleOverlayHide() }
    private func showOverlay() { titleHideWork?.cancel(); titleLabel.isHidden = false; dimsLabel.isHidden = false; if !stillMode { timestampLabel.isHidden = false; sourceStampLabel.isHidden = false }; scheduleOverlayHide() }
    private func scheduleOverlayHide() { titleHideWork?.cancel(); guard player.rate != 0 else { return }; let work = DispatchWorkItem { [weak self] in self?.titleLabel.isHidden = true; self?.timestampLabel.isHidden = true; self?.sourceStampLabel.isHidden = true; self?.dimsLabel.isHidden = true }; titleHideWork = work; DispatchQueue.main.asyncAfter(deadline: .now() + 2.4, execute: work) }
    override func scrollWheel(with event: NSEvent) {
        let location = convert(event.locationInWindow, from: nil)
        if playerView.frame.contains(location) {
            filmstrip.scrollWheel(with: event)
            return
        }
        super.scrollWheel(with: event)
    }
    override func keyDown(with event: NSEvent) {
        if event.modifierFlags.contains(.command), event.charactersIgnoringModifiers?.lowercased() == "s" { captureScreenshot(); return }
        if event.modifierFlags.contains([.command, .shift]), event.keyCode == 6 { redo(); return }
        if event.modifierFlags.contains(.command), event.keyCode == 6 { undo(); return }
        if let key = event.charactersIgnoringModifiers?.lowercased(), key == "i" { recordChange(); filmstrip.selectedHandle = "in"; selectionChanged(start: filmstrip.playheadValue, end: filmstrip.end, seek: true); hasChanges = true; return }
        if let key = event.charactersIgnoringModifiers?.lowercased(), key == "o" { recordChange(); filmstrip.selectedHandle = "out"; selectionChanged(start: filmstrip.start, end: filmstrip.playheadValue, seek: true); hasChanges = true; return }
        if event.keyCode == 126 || event.keyCode == 125 {
            if verticalKey == event.keyCode { verticalPresses += 1 } else { verticalKey = event.keyCode; verticalPresses = 1 }
            if verticalPresses >= 2 {
                filmstrip.selectedHandle = event.keyCode == 126 ? "in" : "out"
                filmstrip.needsDisplay = true
                return
            }
            filmstrip.selectedHandle = "playhead"
            let value = event.keyCode == 126 ? filmstrip.start : filmstrip.end
            filmstrip.playheadValue = value
            seek(to: value)
            return
        }
        if event.keyCode == 123 || event.keyCode == 124 { step(handle: filmstrip.selectedHandle, delta: event.keyCode == 124 ? 1 : -1); return }
        super.keyDown(with: event)
    }
    private func captureScreenshot() {
        let pictures = screenshotDirectory ?? (FileManager.default.urls(for: .picturesDirectory, in: .userDomainMask).first ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Pictures"))
        try? FileManager.default.createDirectory(at: pictures, withIntermediateDirectories: true)
        let stem = sourceURL.deletingPathExtension().lastPathComponent
        var index = 1
        var output = pictures.appendingPathComponent("\(stem)-stitch-up-screenshot-\(index).png")
        while FileManager.default.fileExists(atPath: output.path) { index += 1; output = pictures.appendingPathComponent("\(stem)-stitch-up-screenshot-\(index).png") }
        let current = player.currentTime().seconds
        let seconds = current.isFinite ? max(0, min(asset.duration.seconds, current)) : 0
        let generator = AVAssetImageGenerator(asset: asset); generator.appliesPreferredTrackTransform = true; generator.requestedTimeToleranceBefore = .zero; generator.requestedTimeToleranceAfter = .zero
        guard let cgImage = try? generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600), actualTime: nil) else { return }
        guard let data = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else { return }
        try? data.write(to: output, options: .atomic)
        toastLabel.stringValue = "SCREENSHOT SAVED // \(output.lastPathComponent)"; toastLabel.isHidden = false; screenshotFolderButton.isHidden = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 7.0) { [weak self] in self?.toastLabel.isHidden = true; self?.screenshotFolderButton.isHidden = true }
    }
    @objc private func openScreenshotFolder() {
        let folder = screenshotDirectory ?? (FileManager.default.urls(for: .picturesDirectory, in: .userDomainMask).first ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Pictures"))
        NSWorkspace.shared.open(folder)
    }
    private func recordChange() { undoStack.append((filmstrip.start, filmstrip.end)); if undoStack.count > 100 { undoStack.removeFirst() }; redoStack.removeAll() }
    private func restore(_ point: (Double, Double)) { filmstrip.start = point.0; filmstrip.end = point.1; filmstrip.playheadValue = max(point.0, min(point.1, filmstrip.playheadValue)); selectionChanged(start: point.0, end: point.1, seek: true) }
    private func undo() { guard let point = undoStack.popLast() else { return }; redoStack.append((filmstrip.start, filmstrip.end)); restore(point) }
    private func redo() { guard let point = redoStack.popLast() else { return }; undoStack.append((filmstrip.start, filmstrip.end)); restore(point) }
    @objc func togglePlayback() { if player.rate == 0 { player.play(); showOverlay() } else { player.pause(); showOverlay() } }
    func updatePlayhead(seconds: Double) {
        let value = max(filmstrip.start, min(filmstrip.end, seconds / max(asset.duration.seconds, 1)))
        filmstrip.playheadValue = value
        timestampLabel.stringValue = stampText("CUR", value * sourceDuration)
        if player.rate != 0 { scheduleOverlayHide() }
        if seconds >= filmstrip.end * asset.duration.seconds { player.pause() }
    }
    private func step(handle: String, delta: Int) {
        let step = 1.0 / max(displayFps * sourceDuration, 1)
        filmstrip.selectedHandle = handle
        if handle == "playhead" {
            let value = max(filmstrip.start, min(filmstrip.end, filmstrip.playheadValue + Double(delta) * step))
            filmstrip.playheadValue = value
            seek(to: value)
        } else if handle == "in" {
            let value = max(0, min(filmstrip.end - step, filmstrip.start + Double(delta) * step))
            selectionChanged(start: value, end: filmstrip.end, seek: true)
        } else {
            let value = max(filmstrip.start + step, min(1, filmstrip.end + Double(delta) * step))
            selectionChanged(start: filmstrip.start, end: value, seek: true)
        }
        filmstrip.skimThumbnail(at: filmstrip.selectedHandle == "in" ? filmstrip.start : filmstrip.selectedHandle == "out" ? filmstrip.end : filmstrip.playheadValue)
    }
    private func parseTimecode(_ raw: String) -> Double? {
        let value = raw.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty, value.range(of: "^[0-9:.]+$", options: .regularExpression) != nil else { return nil }
        guard value.contains(":") else { return Double(value) }
        var frames = 0.0
        var timePart = value
        if let dot = value.firstIndex(of: ".") {
            frames = Double(value[value.index(after: dot)...]) ?? 0
            timePart = String(value[..<dot])
        }
        let groups = timePart.split(separator: ":", omittingEmptySubsequences: false)
        guard groups.count <= 3, groups.allSatisfy({ !$0.isEmpty }) else { return nil }
        let seconds = groups.reduce(0.0) { $0 * 60 + (Double($1) ?? 0) }
        let fps = Double(max(1, Int(displayFps.rounded())))
        return seconds + frames / fps
    }
    @objc private func commitInFromAction() { commit(inField.stringValue, handle: "in"); window?.makeFirstResponder(self) }
    @objc private func commitOutFromAction() { commit(outField.stringValue, handle: "out"); window?.makeFirstResponder(self) }
    private func commit(_ text: String, handle: String) {
        let sanitized = text.filter { $0.isNumber || $0 == ":" || $0 == "." }
        if stampMode == "framestamp" {
            guard sanitized.allSatisfy({ $0.isNumber }), let frameNumber = Int(sanitized), frameNumber >= 0 else { selectionChanged(start: filmstrip.start, end: filmstrip.end, seek: false); return }
            let maxFrame = max(0, Int((sourceDuration * displayFps).rounded()) - 1)
            let boundedFrame = min(frameNumber, maxFrame)
            let roundedSeconds = Double(boundedFrame) / max(displayFps, 1)
            recordChange(); let value = max(0, min(1, roundedSeconds / max(sourceDuration, 0.001))); hasChanges = true; if handle == "in" { filmstrip.start = min(value, filmstrip.end - 0.001); filmstrip.selectedHandle = "in" } else { filmstrip.end = max(value, filmstrip.start + 0.001); filmstrip.selectedHandle = "out" }; selectionChanged(start: filmstrip.start, end: filmstrip.end, seek: true); return
        }
        guard let parsed = parseTimecode(sanitized) else { selectionChanged(start: filmstrip.start, end: filmstrip.end, seek: false); return }
        let fps = Double(max(1, Int(displayFps.rounded())))
        let roundedSeconds = (parsed * fps).rounded() / fps
        recordChange(); let value = max(0, min(1, roundedSeconds / max(sourceDuration, 0.001))); hasChanges = true; if handle == "in" { filmstrip.start = min(value, filmstrip.end - 0.001); filmstrip.selectedHandle = "in" } else { filmstrip.end = max(value, filmstrip.start + 0.001); filmstrip.selectedHandle = "out" }; selectionChanged(start: filmstrip.start, end: filmstrip.end, seek: true) }
    private func selectionChanged(start: Double, end: Double, seek seekPreview: Bool) {
        filmstrip.start = max(0, min(start, end - 0.001)); filmstrip.end = min(1, max(end, filmstrip.start + 0.001))
        inField.stringValue = "IN " + stamp(filmstrip.start * sourceDuration); outField.stringValue = "OUT " + stamp(filmstrip.end * sourceDuration); updateTrimmedDurationLabel()
        if seekPreview { let value = filmstrip.selectedHandle == "in" ? filmstrip.start : filmstrip.end; filmstrip.playheadValue = value; seek(to: value) }
    }
    private func seek(to value: Double) {
        let bounded = max(filmstrip.start, min(filmstrip.end, value))
        timestampLabel.stringValue = stampText("CUR", bounded * sourceDuration)
        player.seek(to: CMTime(seconds: bounded * asset.duration.seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }
    private func updateTrimmedDurationLabel() { trimmedDurationLabel.stringValue = stillMode ? "" : "TRIM " + stamp(max(0, (filmstrip.end - filmstrip.start) * sourceDuration)) }
    private func stamp(_ seconds: Double) -> String {
        if stampMode == "framestamp" { return String(format: "FRAME %06d", max(0, Int((seconds * displayFps).rounded()))) }
        return timecode(seconds)
    }
    private func stampText(_ prefix: String, _ seconds: Double) -> String { "  \(prefix) \(stamp(seconds))  " }
    private func timecode(_ seconds: Double) -> String { let fps = max(1, Int(frameRate.rounded())); let total = max(0, Int((seconds * Double(fps)).rounded())); let frames = total % fps; let whole = total / fps; return String(format: "%02d:%02d:%02d.%02d", whole / 3600, (whole / 60) % 60, whole % 60, frames) }
}

final class PreviewController: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let url: URL; private var window: PreviewWindow?; private var player: AVPlayer?; private var timeObserver: Any?; private var previewView: PreviewView?
    init(url: URL) { self.url = url; super.init() }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory); let asset = AVAsset(url: url); let duration = max(asset.duration.seconds, 1); let track = asset.tracks(withMediaType: .video).first; let stillImage = NSImage(contentsOf: url); let imageRep = stillImage?.representations.first; let artworkImage = asset.commonMetadata.first(where: { ($0.commonKey?.rawValue == "artwork" || $0.identifier?.rawValue.contains("covr") == true) && $0.dataValue != nil }).flatMap { $0.dataValue }.flatMap { NSImage(data: $0) }
        let artworkRep = artworkImage?.representations.first
        let raw = artworkRep.map { CGSize(width: $0.pixelsWide, height: $0.pixelsHigh) } ?? artworkImage?.size ?? imageRep.map { CGSize(width: $0.pixelsWide, height: $0.pixelsHigh) } ?? stillImage?.size ?? track?.naturalSize ?? CGSize(width: 960, height: 600); let transform = track?.preferredTransform ?? .identity; let size = (stillImage != nil || artworkImage != nil) ? raw : CGSize(width: abs(raw.width * transform.a + raw.height * transform.c), height: abs(raw.width * transform.b + raw.height * transform.d)); let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let stillMode = CommandLine.arguments.dropFirst(6).first == "still"
        let isAudio = !stillMode && track == nil && !asset.tracks(withMediaType: .audio).isEmpty
        let chrome: CGFloat = stillMode ? 42 : 210
        var width = max(320, size.width); var height = max(stillMode ? 160 : 240, size.height) + chrome; let scale = min(1, min(screen.width * 0.92 / width, screen.height * 0.92 / height)); width *= scale; height *= scale
        let initialStart = Double(CommandLine.arguments.dropFirst(3).first ?? "")
        let initialEnd = Double(CommandLine.arguments.dropFirst(4).first ?? "")
        let player = AVPlayer(url: url); self.player = player; let frame = NSRect(x: 0, y: 0, width: width, height: height); let view = PreviewView(player: player, asset: asset, url: url, duration: duration, frameRate: Double(track?.nominalFrameRate ?? 30), sourceAspect: max(0.1, size.width / max(size.height, 1)), isAudio: isAudio, initialStart: initialStart, initialEnd: initialEnd, stillMode: stillMode, screenshotDirectory: { let value = CommandLine.arguments.dropFirst(7).first ?? ""; return value.isEmpty ? nil : URL(fileURLWithPath: value) }(), stampMode: CommandLine.arguments.dropFirst(8).first == "framestamp" ? "framestamp" : "timestamp", sequenceFps: Double(CommandLine.arguments.dropFirst(9).first ?? ""), sequenceFrameCount: Int(CommandLine.arguments.dropFirst(10).first ?? ""), frame: frame); self.previewView = view; let window = PreviewWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false); self.window = window; window.minSize = stillMode ? NSSize(width: 180, height: 100) : NSSize(width: 360, height: 250); window.resizeIncrements = NSSize(width: 1, height: 1); view.controller = self; window.onCloseRequest = { [weak self] in self?.requestClose() }; window.delegate = self; window.title = ""; window.titleVisibility = .hidden; window.titlebarAppearsTransparent = true; window.backgroundColor = crtBlack; window.level = .floating; window.collectionBehavior = [.fullScreenAuxiliary, .canJoinAllSpaces]; window.contentView = view; window.contentView?.autoresizingMask = [.width, .height]; if stillMode { window.contentMinSize = NSSize(width: 180, height: 100); window.contentMaxSize = NSSize(width: screen.width, height: screen.height); if frame.width > screen.width || frame.height > screen.height { let fit = min(screen.width / frame.width, screen.height / frame.height); window.setContentSize(NSSize(width: frame.width * fit, height: frame.height * fit)) } }; window.center(); NSApp.activate(ignoringOtherApps: true); window.orderFrontRegardless(); window.makeKeyAndOrderFront(nil); window.makeFirstResponder(view); timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] time in self?.previewView?.updatePlayhead(seconds: time.seconds) }; if !stillMode { DispatchQueue.main.async { player.seek(to: CMTime(seconds: initialStart ?? 0, preferredTimescale: 600)); player.play() } }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { requestClose(); return false }
    func requestClose() { if previewView?.stillMode != true { let taskId = CommandLine.arguments.dropFirst(2).first ?? ""; let sourceIndex = CommandLine.arguments.dropFirst(5).first ?? "0"; let duration = previewView?.sourceDuration ?? 1; let start = (previewView?.filmstrip.start ?? 0) * duration; let end = (previewView?.filmstrip.end ?? 1) * duration; print("STITCH_POINTS:\(taskId):\(url.path):\(start):\(end):\(sourceIndex)", terminator: "\n"); fflush(stdout) }; window?.close(); NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

/**
 * Where the helper starts.
 *
 * In a `main` type rather than as statements at the top of the file, because the ruler's arithmetic lives in
 * a file of its own — so it can be asserted without a window — and Swift allows top-level statements only in
 * a file named `main.swift`. What was here is the whole of its body; nothing else moved.
 *
 * The entry point is left out of a harness build (`-D QUICKLOOK_SCALE_HARNESS`), which compiles this file's
 * views and drives them itself: whether the strip re-renders when the window moves is a RUNTIME question,
 * and a harness cannot answer it while this file insists on owning `main`.
 */
#if !QUICKLOOK_SCALE_HARNESS
@main
enum QuickLookPreview {
    static func main() {
        guard let argument = CommandLine.arguments.dropFirst().first, !argument.isEmpty else { exit(64) }
        let url = URL(fileURLWithPath: argument).standardizedFileURL
        guard FileManager.default.fileExists(atPath: url.path) else { exit(66) }
        registerDotoFont()
        let application = NSApplication.shared
        // Held for the life of the process: `run` never returns, so the delegate outlives every callback it
        // is given, which is what an application delegate has to do.
        let delegate = PreviewController(url: url)
        application.delegate = delegate
        application.run()
    }
}
#endif
