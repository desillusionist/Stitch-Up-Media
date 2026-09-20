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
    let imageViews: [NSView]
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
    private var visibleCount = 24
    private let isAudio: Bool
    private var peaks: [CGFloat] = []
    private let peakResolution = 2000
    private let sourceAspect: CGFloat
    private let sourceAsset: AVAsset
    private let sourceDuration: Double
    private var generatedCount = 0
    private let frameRate: Double
    private var trackingAreaRef: NSTrackingArea?
    private var longPressWork: DispatchWorkItem?
    private var zoomMode = false
    private var hoverRequest = 0
    private var zoomToken = 0
    private var zoomFirstFrame = 0
    private var pressOrigin: NSPoint = .zero
    private var skimIndex = -1

    init(asset: AVAsset, duration: Double, sourceAspect: CGFloat, isAudio: Bool, frameRate: Double = 30, frame: NSRect) {
        self.sourceAsset = asset
        self.sourceDuration = duration
        self.sourceAspect = max(0.1, sourceAspect)
        self.isAudio = isAudio
        self.frameRate = max(1, frameRate)
        let frameCount = isAudio ? 0 : max(Int(duration * 4.0), 240)
        imageViews = (0..<frameCount).map { _ in
            let view = NSView(frame: .zero); view.wantsLayer = true; view.layer?.backgroundColor = NSColor(calibratedWhite: 0.14, alpha: 1).cgColor; view.layer?.contentsGravity = .resizeAspectFill; view.layer?.masksToBounds = true; view.layer?.contentsScale = 2; return view
        }
        super.init(frame: frame); wantsLayer = true; layer?.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 1).cgColor
        updateTrackingArea()
        imageViews.forEach(addSubview)
        selectionView.wantsLayer = true; selectionView.layer?.borderColor = crtYellow.cgColor; selectionView.layer?.borderWidth = 2; selectionView.layer?.backgroundColor = crtYellow.withAlphaComponent(0.16).cgColor; addSubview(selectionView)
        for handle in [inHandle, outHandle] { handle.wantsLayer = true; handle.layer?.backgroundColor = crtYellow.cgColor; handle.layer?.borderColor = crtBlack.cgColor; handle.layer?.borderWidth = 1; handle.layer?.cornerRadius = 2; addSubview(handle) }
        playhead.wantsLayer = true; playhead.layer?.backgroundColor = NSColor.systemRed.cgColor; addSubview(playhead)
        if isAudio { loadWaveform(asset: asset) } else { generateFrames(asset: asset, duration: duration, count: visibleCount) }
    }
    required init?(coder: NSCoder) { fatalError() }
    override var acceptsFirstResponder: Bool { true }
    override func layout() {
        super.layout(); if isAudio { updateSelection(); needsDisplay = true; return }; let content = max(1, bounds.height - 6); let thumbnailWidth = max(1, content * sourceAspect); visibleCount = min(imageViews.count, max(1, Int((bounds.width / thumbnailWidth).rounded())))
        let scale: CGFloat = 2; let snap: (CGFloat) -> CGFloat = { value in (value * scale).rounded() / scale }
        for (index, view) in imageViews.enumerated() {
            view.isHidden = index >= visibleCount
            if index < visibleCount {
                let left = snap(bounds.width * CGFloat(index) / CGFloat(max(visibleCount, 1))); let right = snap(bounds.width * CGFloat(index + 1) / CGFloat(max(visibleCount, 1)))
                view.frame = NSRect(x: left, y: 3, width: right - left, height: content)
            }
        }
        if generatedCount != visibleCount {
            generatedCount = visibleCount
            generateFrames(asset: sourceAsset, duration: sourceDuration, count: visibleCount)
        }
        updateSelection()
    }
    private func updateSelection() {
        guard bounds.width > 0 else { return }
        let left = bounds.width * start; let right = bounds.width * end
        selectionView.frame = NSRect(x: left, y: 1, width: max(18, right - left), height: bounds.height - 2)
        inHandle.frame = NSRect(x: left - 5, y: 0, width: 10, height: bounds.height)
        outHandle.frame = NSRect(x: right - 5, y: 0, width: 10, height: bounds.height)
        playhead.frame = NSRect(x: bounds.width * playheadValue - 1, y: -4, width: 2, height: bounds.height + 8)
        inHandle.layer?.backgroundColor = (selectedHandle == "in" ? NSColor.white : NSColor.systemYellow).cgColor
        outHandle.layer?.backgroundColor = (selectedHandle == "out" ? NSColor.white : NSColor.systemYellow).cgColor
        inHandle.layer?.borderColor = (selectedHandle == "in" ? NSColor.systemYellow : NSColor.clear).cgColor
        outHandle.layer?.borderColor = (selectedHandle == "out" ? NSColor.systemYellow : NSColor.clear).cgColor
        inHandle.layer?.borderWidth = selectedHandle == "in" ? 2 : 0
        outHandle.layer?.borderWidth = selectedHandle == "out" ? 2 : 0
    }
    private func value(at point: NSPoint) -> Double { max(0, min(1, point.x / max(bounds.width, 1))) }
    private func updateTrackingArea() {
        if let trackingAreaRef { removeTrackingArea(trackingAreaRef) }
        let area = NSTrackingArea(rect: bounds, options: [.activeInKeyWindow, .mouseEnteredAndExited, .inVisibleRect], owner: self, userInfo: nil)
        trackingAreaRef = area; addTrackingArea(area)
    }
    override func updateTrackingAreas() { super.updateTrackingAreas(); updateTrackingArea() }
    private func frameTime(at point: NSPoint) -> Double { max(0, min(sourceDuration, value(at: point) * sourceDuration)) }
    private func requestFrame(at seconds: Double, index: Int, tolerance: CMTime, seekMonitor: Bool, isValid: @escaping () -> Bool) {
        let generator = AVAssetImageGenerator(asset: sourceAsset); generator.appliesPreferredTrackTransform = true; generator.requestedTimeToleranceBefore = tolerance; generator.requestedTimeToleranceAfter = tolerance
        let time = CMTime(seconds: max(0, min(sourceDuration, seconds)), preferredTimescale: 600)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self, isValid(), let image = try? generator.copyCGImage(at: time, actualTime: nil) else { return }
            DispatchQueue.main.async { guard isValid(), index >= 0, index < self.imageViews.count else { return }; self.imageViews[index].layer?.contents = image; if seekMonitor { self.onHoverTime?(seconds / max(self.sourceDuration, 0.001)) } }
        }
    }
    private func generateZoomFrames(center: Double) {
        guard !isAudio, visibleCount > 0 else { return }
        zoomToken += 1; let token = zoomToken
        let centerFrame = Int((max(0, min(1, center)) * sourceDuration * frameRate).rounded()); let first = max(0, centerFrame - visibleCount / 2); zoomFirstFrame = first
        for index in 0..<visibleCount { requestFrame(at: Double(first + index) / frameRate, index: index, tolerance: .zero, seekMonitor: index == visibleCount / 2, isValid: { [weak self] in self?.zoomToken == token && self?.zoomMode == true }) }
    }
    func skimThumbnail(at norm: Double) {
        guard !isAudio, !zoomMode, visibleCount > 0 else { return }
        let index = min(visibleCount - 1, max(0, Int(norm * CGFloat(visibleCount))))
        if skimIndex >= 0, skimIndex != index, skimIndex < visibleCount {
            let repNorm = (Double(skimIndex) + 0.5) / Double(visibleCount)
            requestFrame(at: repNorm * sourceDuration, index: skimIndex, tolerance: CMTime(value: 1, timescale: 4), seekMonitor: false, isValid: { [weak self] in self?.zoomMode == false })
        }
        skimIndex = index
        hoverRequest += 1; let token = hoverRequest
        requestFrame(at: norm * sourceDuration, index: index, tolerance: CMTime(value: 1, timescale: 12), seekMonitor: false, isValid: { [weak self] in self?.hoverRequest == token && self?.zoomMode == false })
    }
    private func restoreOverview() { zoomMode = false; zoomToken += 1; longPressWork?.cancel(); generatedCount = 0; generateFrames(asset: sourceAsset, duration: sourceDuration, count: visibleCount) }
    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil); let left = bounds.width * start; let right = bounds.width * end
        pressOrigin = p
        if abs(p.x - left) < 20 { dragging = "in"; selectedHandle = "in"; onHandleSelected?("in") }
        else if abs(p.x - right) < 20 { dragging = "out"; selectedHandle = "out"; onHandleSelected?("out") }
        else { dragging = "playhead"; selectedHandle = "playhead"; onHandleSelected?("playhead"); onPlayheadSelected?() }
        updateSelection(); window?.makeFirstResponder(self)
        if dragging == "playhead" { let value = max(start, min(end, value(at: p))); playheadValue = value; onPlayheadChange?(value) }
        guard !isAudio, let held = dragging else { return }
        let center: Double
        switch held {
        case "in": center = start
        case "out": center = end
        default: center = frameTime(at: p) / max(sourceDuration, 0.001)
        }
        let work = DispatchWorkItem { [weak self] in guard let self, self.dragging != nil else { return }; self.zoomMode = true; self.generateZoomFrames(center: center) }
        longPressWork = work; DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
    }
    override func mouseDragged(with event: NSEvent) {
        guard let dragging else { return }; let point = convert(event.locationInWindow, from: nil); let value = value(at: point)
        if !zoomMode, abs(point.x - pressOrigin.x) > 3 { longPressWork?.cancel() }
        if zoomMode {
            let pixelsPerFrame = 4.0                                             // sensitivity knob: lower = faster, higher = finer
            let deltaSeconds = Double(event.deltaX) / (pixelsPerFrame * frameRate)
            switch dragging {
            case "in":
                let t = min(end * sourceDuration - 1.0 / frameRate, max(0, start * sourceDuration + deltaSeconds))
                start = t / max(sourceDuration, 0.001); selectedHandle = "in"; onHandleChange?("in", start); onHoverTime?(start)
            case "out":
                let t = max(start * sourceDuration + 1.0 / frameRate, min(sourceDuration, end * sourceDuration + deltaSeconds))
                end = t / max(sourceDuration, 0.001); selectedHandle = "out"; onHandleChange?("out", end); onHoverTime?(end)
            default:
                let t = max(0, min(sourceDuration, playheadValue * sourceDuration + deltaSeconds))
                playheadValue = t / max(sourceDuration, 0.001); onHoverTime?(playheadValue)
            }
            let pos = (dragging == "in" ? start : dragging == "out" ? end : playheadValue) * sourceDuration
            let winStart = Double(zoomFirstFrame) / frameRate
            let winEnd = Double(zoomFirstFrame + visibleCount) / frameRate
            if pos < winStart || pos > winEnd { generateZoomFrames(center: pos / max(sourceDuration, 0.001)) }  // page only when the skimmer exits the window
            return
        }
        if dragging == "in" { start = min(value, end - 0.001); onHandleChange?("in", start); skimThumbnail(at: start) }
        else if dragging == "out" { end = max(value, start + 0.001); onHandleChange?("out", end); skimThumbnail(at: end) }
        else { let bounded = max(start, min(end, value)); playheadValue = bounded; onPlayheadChange?(bounded); skimThumbnail(at: bounded) }
    }
    override func mouseUp(with event: NSEvent) { dragging = nil; if zoomMode { restoreOverview() } else { longPressWork?.cancel(); longPressWork = nil } }
    override func scrollWheel(with event: NSEvent) {
        let delta = -(event.scrollingDeltaY != 0 ? event.scrollingDeltaY : event.scrollingDeltaX)
        guard delta != 0 else { return }
        let rawStep = 1.0 / max(Double(Int(sourceDuration * 30.0)), 1)
        let eased = tanh(abs(delta) / 6.0)
        let step = rawStep * (0.35 + 1.65 * eased)
        if selectedHandle == "in" { let value = max(0, min(end - step, start + (delta > 0 ? step : -step))); start = value; onHandleChange?("in", value); skimThumbnail(at: value) }
        else if selectedHandle == "out" { let value = max(start + step, min(1, end + (delta > 0 ? step : -step))); end = value; onHandleChange?("out", value); skimThumbnail(at: value) }
        else { let value = max(start, min(end, playheadValue + (delta > 0 ? step : -step))); playheadValue = value; onPlayheadChange?(value); skimThumbnail(at: value) }
    }
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
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect); guard isAudio, let ctx = NSGraphicsContext.current?.cgContext else { return }
        let midY = bounds.height / 2; crtDim.withAlphaComponent(0.45).setFill(); ctx.fill(NSRect(x: 0, y: midY - 0.5, width: bounds.width, height: 1)); guard !peaks.isEmpty else { return }
        let barWidth: CGFloat = 2, gap: CGFloat = 2, stride = barWidth + gap, barCount = max(1, Int(bounds.width / stride)), half = max(1, (midY - 3) * 0.9); crtGreen.setFill()
        for i in 0..<barCount { let lo = Int(Double(i) / Double(barCount) * Double(peaks.count)); let hi = max(lo + 1, Int(Double(i + 1) / Double(barCount) * Double(peaks.count))); var peak: CGFloat = 0; for bucket in lo..<min(hi, peaks.count) { peak = max(peak, peaks[bucket]) }; let height = max(1, peak * half); ctx.fill(NSRect(x: CGFloat(i) * stride, y: midY - height, width: barWidth, height: height * 2)) }
    }
    private func generateFrames(asset: AVAsset, duration: Double, count: Int) {
        let generator = AVAssetImageGenerator(asset: asset); generator.appliesPreferredTrackTransform = true; generator.requestedTimeToleranceBefore = .zero; generator.requestedTimeToleranceAfter = .zero
        guard duration.isFinite, duration > 0 else { return }
        let frameQueue = DispatchQueue(label: "stitch-up.quicklook.frames", qos: .userInitiated)
        for index in 0..<count {
            let normalizedPosition = count <= 1 ? 0.5 : Double(index) / Double(count - 1)
            let time = CMTime(seconds: duration * normalizedPosition, preferredTimescale: 600)
            frameQueue.async { [weak self] in
                var image = try? generator.copyCGImage(at: time, actualTime: nil)
                if image == nil {
                    generator.requestedTimeToleranceBefore = CMTime.positiveInfinity
                    generator.requestedTimeToleranceAfter = CMTime.positiveInfinity
                    image = try? generator.copyCGImage(at: time, actualTime: nil)
                }
                guard let image else { return }
                DispatchQueue.main.async { self?.imageViews[index].layer?.contents = image }
            }
        }
    }
}

final class PreviewView: NSView {
    let playerView: MonitorPlayerView; let imageView = NSImageView(frame: .zero); let player: AVPlayer; let asset: AVAsset; let sourceURL: URL; let screenshotDirectory: URL?; let audioArtwork: Bool; let filmstrip: FilmstripView; let frameRate: Double; let displayFps: Double; let sourceDuration: Double; let stampMode: String
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
        if stillMode { filmstrip.isHidden = true; inField.isHidden = true; outField.isHidden = true; timestampLabel.isHidden = true; sourceStampLabel.isHidden = true; playerView.isHidden = true }
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
                playerView.topAnchor.constraint(equalTo: appTitlebar.bottomAnchor), playerView.leadingAnchor.constraint(equalTo: leadingAnchor), playerView.trailingAnchor.constraint(equalTo: trailingAnchor), playerView.bottomAnchor.constraint(equalTo: filmstrip.topAnchor, constant: -14),
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

guard let argument = CommandLine.arguments.dropFirst().first, !argument.isEmpty else { exit(64) }
let url = URL(fileURLWithPath: argument).standardizedFileURL; guard FileManager.default.fileExists(atPath: url.path) else { exit(66) }
registerDotoFont(); let application = NSApplication.shared; let delegate = PreviewController(url: url); application.delegate = delegate; application.run()
