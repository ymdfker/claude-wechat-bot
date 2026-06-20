import Cocoa

// Menu bar robot icon (template image, adapts to light/dark mode).
// Usage: menubar <pid_to_kill>

func makeRobotIcon(size: CGFloat) -> NSImage {
    let img = NSImage(size: NSSize(width: size, height: size))
    img.isTemplate = true

    img.lockFocus()

    let s = size
    // Robot head (rounded rect)
    let head = NSBezierPath(roundedRect: NSRect(x: s*0.15, y: s*0.25, width: s*0.7, height: s*0.45),
                            xRadius: s*0.12, yRadius: s*0.12)
    // Antenna
    let antenna = NSBezierPath()
    antenna.move(to: NSPoint(x: s*0.5, y: s*0.7))
    antenna.line(to: NSPoint(x: s*0.5, y: s*0.88))
    antenna.lineWidth = s * 0.06
    antenna.lineCapStyle = .round

    // Eyes (two small circles)
    let leftEye = NSBezierPath(ovalIn: NSRect(x: s*0.32, y: s*0.42, width: s*0.1, height: s*0.1))
    let rightEye = NSBezierPath(ovalIn: NSRect(x: s*0.58, y: s*0.42, width: s*0.1, height: s*0.1))

    // Mouth (small rect)
    let mouth = NSBezierPath(roundedRect: NSRect(x: s*0.36, y: s*0.28, width: s*0.28, height: s*0.06),
                             xRadius: s*0.03, yRadius: s*0.03)

    // Ears (small rectangles on sides)
    let leftEar = NSBezierPath(roundedRect: NSRect(x: s*0.02, y: s*0.35, width: s*0.13, height: s*0.2),
                               xRadius: s*0.04, yRadius: s*0.04)
    let rightEar = NSBezierPath(roundedRect: NSRect(x: s*0.85, y: s*0.35, width: s*0.13, height: s*0.2),
                                xRadius: s*0.04, yRadius: s*0.04)

    NSColor.black.setFill()
    head.fill()
    leftEye.fill()
    rightEye.fill()
    mouth.fill()
    leftEar.fill()
    rightEar.fill()

    NSColor.black.setStroke()
    antenna.stroke()

    img.unlockFocus()
    return img
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var targetPid: pid_t = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        if args.count >= 2 {
            targetPid = pid_t(args[1]) ?? 0
        }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = makeRobotIcon(size: 18)
            button.imagePosition = .imageOnly
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Claude-WeChat Bot", action: nil, keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Bot", action: #selector(quitBot), keyEquivalent: "q"))
        statusItem.menu = menu
    }

    @objc func quitBot() {
        if targetPid > 0 {
            kill(targetPid, SIGTERM)
            try? FileManager.default.removeItem(atPath: "/tmp/claude-wechat-bot.lock")
        }
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
