#!/bin/bash
# ┌─────────────────────────────────────────────────┐
# │  Build Installer for Claude-WeChat-Bot           │
# │  Creates .app + .dmg ready for distribution      │
# └─────────────────────────────────────────────────┘
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="Claude-WeChat-Bot"
DIST_DIR="$PROJECT_DIR/dist-app"
APP_DIR="$DIST_DIR/$APP_NAME.app"
DMG_PATH="$DIST_DIR/$APP_NAME.dmg"

echo "═══════════════════════════════════════════"
echo "  📦 Building Claude-WeChat-Bot Installer"
echo "═══════════════════════════════════════════"
echo ""

# ── Step 1: Clean ──────────────────────────────────
echo "── Step 1/4: Clean previous build ─────────"
rm -rf "$APP_DIR" "$DMG_PATH" "/tmp/$APP_NAME-tmp.dmg" 2>/dev/null
rm -f /tmp/AppIcon.icns 2>/dev/null

# ── Step 2: Create .app bundle ──────────────────────
echo "── Step 2/4: Create .app bundle ────────────"

mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Create launcher executable
cat > "$APP_DIR/Contents/MacOS/$APP_NAME" << 'APPEOF'
#!/bin/bash
PROJECT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
osascript - "$PROJECT_DIR" << 'OSAEOF' &
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

# Create Info.plist
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
    <string></string>
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

echo "   ✅ App bundle created"

# ── Step 3: Generate icon (fast, backgrounded) ────
echo "── Step 3/4: Generate icon ─────────────────"

# Generate icon using a quick inline approach - skip if too slow
(
    /usr/bin/python3 -c "
import struct, zlib, os, subprocess, shutil

def create_png(w, h):
    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            cx, cy = w//2, h//2
            r = w//2 - w//20
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy)**0.5
            if dist < r:
                raw += bytes([79, 70, 229, 255])
            else:
                raw += bytes([0, 0, 0, 0])
    def chunk(t, data):
        c = t + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc
    return b'\x89PNG\r\n\x1a\n' + \
        chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + \
        chunk(b'IDAT', zlib.compress(raw)) + \
        chunk(b'IEND', b'')

iconset = '/tmp/bot.iconset3'
if os.path.exists(iconset):
    shutil.rmtree(iconset)
os.makedirs(iconset)

for s in [16, 32, 64, 128, 256, 512, 1024]:
    with open(f'{iconset}/icon_{s}x{s}.png', 'wb') as f:
        f.write(create_png(s, s))
    s2 = s * 2
    if s2 <= 1024:
        with open(f'{iconset}/icon_{s}x{s}@2x.png', 'wb') as f:
            f.write(create_png(s2, s2))

subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', '/tmp/AppIcon.icns'], check=True)
shutil.rmtree(iconset)
" 2>/dev/null && touch /tmp/icon-done || true
) &

# Wait briefly for icon
for i in $(seq 1 10); do
    if [ -f /tmp/icon-done ]; then
        break
    fi
    sleep 0.5
done

if [ -f /tmp/AppIcon.icns ]; then
    cp /tmp/AppIcon.icns "$APP_DIR/Contents/Resources/AppIcon.icns"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile AppIcon" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true
    echo "   ✅ Icon generated"
else
    echo "   ⚠️ Icon skipped (will use default app icon)"
fi

# ── Step 4: Create DMG ─────────────────────────────
echo "── Step 4/4: Create DMG installer ──────────"

# Create temp DMG
hdiutil create -size 200m -fs HFS+ -volname "$APP_NAME" "/tmp/$APP_NAME-tmp.dmg" -quiet 2>/dev/null

# Mount
DEV=$(hdiutil attach "/tmp/$APP_NAME-tmp.dmg" -nobrowse -noautoopen 2>&1 | awk '/Apple_HFS/ {print $1}')
MNT="/Volumes/$APP_NAME"

sleep 1

# Copy app and link
cp -R "$APP_DIR" "$MNT/" 2>/dev/null
ln -sf /Applications "$MNT/Applications" 2>/dev/null

# Create README
cat > "$MNT/README.txt" << 'EOF'
🤖 Claude-WeChat Bot

INSTALLATION:
  1. Drag the Claude-WeChat-Bot app to Applications folder
  2. Make sure Node.js >= 22 is installed (https://nodejs.org)
  3. Double-click the app to start

FIRST RUN:
  The app will open a Terminal window and install dependencies
  automatically before starting the bot.
EOF

# Set up DMG layout (background)
osascript - "$MNT" << 'OSAEOF' 2>/dev/null &
on run argv
    set mountPoint to item 1 of argv
    tell application "Finder"
        tell disk (mountPoint as text)
            open
            set current view of container window to icon view
            set toolbar visible of container window to false
            set statusbar visible of container window to false
            set bounds of container window to {200, 200, 700, 500}
            set viewOptions to the icon view options of container window
            set arrangement of viewOptions to not arranged
            set icon size of viewOptions to 72
            set position of item "Claude-WeChat-Bot.app" to {150, 140}
            set position of item "Applications" to {350, 140}
            set position of item "README.txt" to {250, 230}
            close
            update disk (mountPoint as text)
        end tell
    end tell
end run
OSAEOF

# Wait for layout
sleep 5

# Unmount
hdiutil detach "$DEV" -quiet 2>/dev/null

# Convert to compressed read-only
hdiutil convert "/tmp/$APP_NAME-tmp.dmg" -format UDZO -o "$DMG_PATH" -quiet 2>/dev/null
rm -f "/tmp/$APP_NAME-tmp.dmg"

echo "   ✅ DMG created"

# ── Summary ────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Build complete!"
echo ""
echo "  📱 App:  $APP_DIR"
echo "  💿 DMG:  $DMG_PATH ($(du -h "$DMG_PATH" | cut -f1))"
echo ""
echo "  To install:"
echo "    open $DIST_DIR"
echo "  Then drag the app to /Applications"
echo ""
echo "  To distribute: Upload the .dmg to GitHub Releases"
echo "═══════════════════════════════════════════"
