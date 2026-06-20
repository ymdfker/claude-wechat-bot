import Cocoa

// Usage: menubar <pid_to_kill>
// Shows a menu bar icon. Click "Quit" kills the given PID and exits.

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
            // Use a simple text icon: "🤖" rendered as monochrome
            button.title = "🤖"
            button.font = NSFont.systemFont(ofSize: 14)
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
            // Also clean up lock file
            let lockPath = "/tmp/claude-wechat-bot.lock"
            try? FileManager.default.removeItem(atPath: lockPath)
        }
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
