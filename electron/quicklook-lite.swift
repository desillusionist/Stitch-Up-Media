import AppKit
import CoreText

private let dotoFontName = "Doto"
private let titlebarHeight: CGFloat = 42
private let titlebarBackground = NSColor(calibratedRed: 0.067, green: 0.078, blue: 0.098, alpha: 1)
private let titlebarBorder = NSColor(calibratedRed: 0.412, green: 0.439, blue: 0.471, alpha: 1)
private let crtGreen = NSColor(calibratedRed: 0.49, green: 1, blue: 0.46, alpha: 1)

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

final class LiteRootView: NSView {
    var onMouseActivity: (() -> Void)?
    var onMouseExit: (() -> Void)?
    override func mouseEntered(with event: NSEvent) { onMouseActivity?() }
    override func mouseMoved(with event: NSEvent) { onMouseActivity?() }
    override func mouseExited(with event: NSEvent) { onMouseExit?() }
}

final class LiteWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { close(); NSApp.terminate(nil); return }
        super.keyDown(with: event)
    }
}

final class LiteController: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let url: URL
    var window: NSWindow?
    var lockedWindowAspect: CGFloat = 1
    init(url: URL) { self.url = url }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        guard let image = NSImage(contentsOf: url), let rep = image.representations.first else { NSApp.terminate(nil); return }
        registerDotoFont()
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let source = CGSize(width: max(1, rep.pixelsWide), height: max(1, rep.pixelsHigh))
        let available = CGSize(width: screen.width * 0.92, height: screen.height * 0.92)
        let scale = min(1, min(available.width / source.width, max(100, available.height - titlebarHeight) / source.height))
        let frame = NSRect(origin: .zero, size: NSSize(width: max(240, source.width * scale), height: max(160, source.height * scale + titlebarHeight)))
        lockedWindowAspect = frame.width / max(frame.height, 1)

        let root = LiteRootView(frame: frame)
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.black.cgColor

        let appTitlebar = NSView()
        appTitlebar.translatesAutoresizingMaskIntoConstraints = false
        appTitlebar.wantsLayer = true
        appTitlebar.layer?.backgroundColor = titlebarBackground.cgColor
        appTitlebar.layer?.borderColor = titlebarBorder.cgColor
        appTitlebar.layer?.borderWidth = 1
        root.addSubview(appTitlebar)

        let appTitle = NSTextField(labelWithString: "STITCH UP MEDIA // QUICK LOOK")
        appTitle.font = NSFont(name: dotoFontName, size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        appTitle.textColor = NSColor(calibratedWhite: 0.58, alpha: 1)
        appTitle.translatesAutoresizingMaskIntoConstraints = false
        appTitlebar.addSubview(appTitle)

        let imageView = NSImageView(frame: .zero)
        imageView.image = image
        imageView.imageScaling = .scaleAxesIndependently
        imageView.imageAlignment = .alignCenter
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.setContentHuggingPriority(.defaultLow, for: .horizontal)
        imageView.setContentHuggingPriority(.defaultLow, for: .vertical)
        imageView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        imageView.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        root.addSubview(imageView)

        let filenameOverlay = NSTextField(labelWithString: url.lastPathComponent)
        filenameOverlay.font = NSFont(name: dotoFontName, size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        filenameOverlay.textColor = crtGreen.withAlphaComponent(0.82)
        filenameOverlay.alignment = .center
        filenameOverlay.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(filenameOverlay)

        let dimensionsOverlay = NSTextField(labelWithString: "\(rep.pixelsWide) × \(rep.pixelsHigh)")
        dimensionsOverlay.font = NSFont(name: dotoFontName, size: 10) ?? NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        dimensionsOverlay.textColor = crtGreen.withAlphaComponent(0.62)
        dimensionsOverlay.alignment = .center
        dimensionsOverlay.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(dimensionsOverlay)

        NSLayoutConstraint.activate([
            appTitlebar.topAnchor.constraint(equalTo: root.topAnchor), appTitlebar.leadingAnchor.constraint(equalTo: root.leadingAnchor), appTitlebar.trailingAnchor.constraint(equalTo: root.trailingAnchor), appTitlebar.heightAnchor.constraint(equalToConstant: titlebarHeight),
            appTitle.leadingAnchor.constraint(equalTo: appTitlebar.leadingAnchor, constant: 92), appTitle.trailingAnchor.constraint(lessThanOrEqualTo: appTitlebar.trailingAnchor, constant: -18), appTitle.centerYAnchor.constraint(equalTo: appTitlebar.centerYAnchor),
            imageView.topAnchor.constraint(equalTo: appTitlebar.bottomAnchor), imageView.leadingAnchor.constraint(equalTo: root.leadingAnchor), imageView.trailingAnchor.constraint(equalTo: root.trailingAnchor), imageView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            filenameOverlay.topAnchor.constraint(equalTo: imageView.topAnchor, constant: 10), filenameOverlay.leadingAnchor.constraint(equalTo: imageView.leadingAnchor, constant: 12), filenameOverlay.trailingAnchor.constraint(equalTo: imageView.trailingAnchor, constant: -12),
            dimensionsOverlay.topAnchor.constraint(equalTo: filenameOverlay.bottomAnchor, constant: 2), dimensionsOverlay.leadingAnchor.constraint(equalTo: imageView.leadingAnchor, constant: 12), dimensionsOverlay.trailingAnchor.constraint(equalTo: imageView.trailingAnchor, constant: -12)
        ])

        let hideWork = { () -> Void in
            filenameOverlay.isHidden = true
            dimensionsOverlay.isHidden = true
        }
        let scheduleHide = { () -> Void in
            let work = DispatchWorkItem(block: hideWork)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.4, execute: work)
        }
        root.onMouseActivity = { filenameOverlay.isHidden = false; dimensionsOverlay.isHidden = false }
        root.onMouseExit = scheduleHide
        root.addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: root, userInfo: nil))

        let window = LiteWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        self.window = window
        window.title = ""
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .black
        window.minSize = NSSize(width: 180, height: 100)
        window.resizeIncrements = NSSize(width: 1, height: 1)
        window.level = .floating
        window.delegate = self
        window.contentView = root
        window.contentView?.autoresizingMask = [.width, .height]
        window.center()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func windowWillResize(_ sender: NSWindow, to frameSize: NSSize) -> NSSize {
        let width = max(180, frameSize.width)
        return NSSize(width: width, height: max(100, width / max(lockedWindowAspect, 0.01)))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

guard let argument = CommandLine.arguments.dropFirst().first else { exit(64) }
let url = URL(fileURLWithPath: argument).standardizedFileURL
guard FileManager.default.fileExists(atPath: url.path) else { exit(66) }
let application = NSApplication.shared
let delegate = LiteController(url: url)
application.delegate = delegate
application.run()
