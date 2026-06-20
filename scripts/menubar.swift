import Cocoa

// Usage: menubar <pid_to_kill>
// Menu bar icon (template image, adapts to light/dark mode). Quit kills bot.

func makeIcon(size: CGFloat) -> NSImage {
    let img = NSImage(size: NSSize(width: size, height: size))
    img.isTemplate = true // macOS auto-colors for light/dark mode

    img.lockFocus()

    // Chat bubble (rounded rect with tail)
    let bubble = NSBezierPath()
    let r: CGFloat = size * 0.3
    let x: CGFloat = size * 0.08
    let y: CGFloat = size * 0.1
    let w: CGFloat = size * 0.75
    let h: CGFloat = size * 0.65

    // Main bubble body
    bubble.appendRoundedRect(NSRect(x: x, y: y, width: w, height: h),
                             xRadius: r, yRadius: r)
    // Tail (bottom-left)
    bubble.move(to: NSPoint(x: x + r*0.8, y: y))
    bubble.line(to: NSPoint(x: x + r*0.3, y: y - size*0.18))
    bubble.line(to: NSPoint(x: x + r*1.5, y: y))

    NSColor.black.setFill()
    bubble.fill()

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
            button.image = makeIcon(size: 18)
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
