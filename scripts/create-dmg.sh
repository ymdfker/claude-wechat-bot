#!/bin/bash
# Create DMG installer for Claude-WeChat-Bot
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Claude-WeChat-Bot"
APP_PATH="$PROJECT_DIR/dist-app/$APP_NAME.app"
DMG_PATH="$PROJECT_DIR/dist-app/$APP_NAME.dmg"
TMP_DMG="/tmp/$APP_NAME-tmp.dmg"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ App not found: $APP_PATH"
    echo "   Run create-app.sh first."
    exit 1
fi

echo "📦 Creating DMG installer..."

# Clean previous
rm -f "$DMG_PATH" "$TMP_DMG"

# Create temporary DMG (big enough)
hdiutil create -size 200m -fs HFS+ -volname "$APP_NAME" "$TMP_DMG" -quiet

# Mount it
DEV=$(hdiutil attach "$TMP_DMG" -nobrowse -noautoopen | awk '/Apple_HFS/ {print $1}')
MNT="/Volumes/$APP_NAME"

# Copy app and create symlink to /Applications
cp -R "$APP_PATH" "$MNT/"

# Create a simple install instructions
cat > "$MNT/README.txt" << 'EOF'
🤖 Claude-WeChat Bot

INSTALLATION:
  Drag the Claude-WeChat-Bot app into your Applications folder.

TO START:
  Double-click the app. A Terminal window will open
  and the bot will start automatically.

REQUIREMENTS:
  - macOS 13 or later
  - Node.js >= 22 (https://nodejs.org)
  - npm dependencies (auto-installed on first run)

EOF

ln -s /Applications "$MNT/Applications"

# Set custom volume icon
# (skip for now - requires mounting with specific options)

# ── Set up DMG layout via AppleScript ──────────────
osascript - "$MNT" << 'OSAEOF'
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
        end tell
    end tell
end run
OSAEOF

# Unmount
hdiutil detach "$DEV" -quiet

# Convert to compressed read-only DMG
hdiutil convert "$TMP_DMG" -format UDZO -o "$DMG_PATH" -quiet
rm -f "$TMP_DMG"

echo ""
echo "✅ DMG created: $DMG_PATH"
echo "   Size: $(du -h "$DMG_PATH" | cut -f1)"
