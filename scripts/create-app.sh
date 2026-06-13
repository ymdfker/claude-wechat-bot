#!/bin/bash
# Create macOS .app bundle for Claude-WeChat-Bot
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Claude-WeChat-Bot"
APP_DIR="$PROJECT_DIR/dist-app/$APP_NAME.app"

echo "🔨 Creating $APP_NAME.app..."

# Clean previous build
rm -rf "$APP_DIR"

# Create app bundle structure
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# ── Create the executable (shell script) ──────────
cat > "$APP_DIR/Contents/MacOS/$APP_NAME" << 'APPEOF'
#!/bin/bash

# Resolve app location to find project
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT_DIR="$(cd "$APP_DIR/../../.." && pwd)"

# Open a Terminal window running the bot
# We use AppleScript to open Terminal for visibility
osascript - "$PROJECT_DIR" << 'OSAEOF'
on run argv
    set projectDir to item 1 of argv
    
    tell application "Terminal"
        activate
        set W to do script "cd " & quoted form of projectDir & " && bash scripts/start.sh; exit"
        set custom title of W to "🤖 Claude-WeChat Bot"
    end tell
end run
OSAEOF
APPEOF

chmod +x "$APP_DIR/Contents/MacOS/$APP_NAME"

# ── Create Info.plist ──────────────────────────────
cat > "$APP_DIR/Contents/Info.plist" << 'PLISTEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>Claude-WeChat Bot</string>
    <key>CFBundleExecutable</key>
    <string>Claude-WeChat-Bot</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.claude-wechat-bot.app</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Claude-WeChat-Bot</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>0.1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>
PLISTEOF

# ── Generate icon ──────────────────────────────────
echo "🎨 Generating app icon..."
# Generate a simple icon using Python
python3 - "$APP_DIR/Contents/Resources/AppIcon.icns" << 'PYEOF'
import os
import sys
import struct
import zlib

output_path = sys.argv[1]

def create_png(width, height, pixels_func):
    """Create a PNG file from a pixel function."""
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter none
        for x in range(width):
            r, g, b, a = pixels_func(x, y, width, height)
            raw += bytes([r, g, b, a])
    
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc
    
    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    
    return header + ihdr + idat + iend

def bot_pixels(x, y, w, h):
    """Simple bot icon: blue rounded rect with simple face."""
    cx, cy = w // 2, h // 2
    r = w // 2 - w // 20
    
    dx, dy = x - cx, y - cy
    dist = (dx * dx + dy * dy) ** 0.5
    
    if dist > r + 2:
        return (0, 0, 0, 0)
    
    if dist < r:
        # Face area - light blue
        return (79, 70, 229, 255)
    
    # Border area
    border = int(abs(dist - r))
    if border < 2:
        alpha = 255 - border * 127
        return (99, 90, 249, alpha)
    
    return (0, 0, 0, 0)

# Create iconset directory
iconset = '/tmp/bot.iconset'
os.makedirs(iconset, exist_ok=True)

sizes = [16, 32, 64, 128, 256, 512, 1024]
for s in sizes:
    png = create_png(s, s, bot_pixels)
    with open(f'{iconset}/icon_{s}x{s}.png', 'wb') as f:
        f.write(png)
    # @2x
    s2 = s * 2
    if s2 <= 1024:
        png2 = create_png(s2, s2, bot_pixels)
        with open(f'{iconset}/icon_{s}x{s}@2x.png', 'wb') as f:
            f.write(png2)

# Use iconutil to create icns
import subprocess
result = subprocess.run(
    ['iconutil', '-c', 'icns', iconset, '-o', output_path],
    capture_output=True
)
if result.returncode != 0:
    print(f"iconutil error: {result.stderr.decode()}")
    sys.exit(1)

# Cleanup
import shutil
shutil.rmtree(iconset)
print(f"✅ Icon created: {output_path}")
PYEOF

# ── Copy icon to Resources ─────────────────────────
# Icon is already created at the right place by Python

echo ""
echo "✅ App created: $APP_DIR"
echo ""
echo "   You can now:"
echo "   - Double-click $APP_NAME.app to start"
echo "   - Drag it to /Applications or your Dock"
echo "   - Or run: open '$APP_DIR'"
