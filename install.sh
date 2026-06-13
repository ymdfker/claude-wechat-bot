#!/bin/bash
# ============================================================================
# Claude-WeChat Bot — Installer
# ============================================================================
# Usage: bash install.sh
# This script sets up the bot, creates a desktop launcher, and enables
# auto-start on login (macOS).
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Claude-WeChat-Bot"
INSTALL_DIR="$SCRIPT_DIR"
LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.claude-wechat-bot.plist"
DESKTOP_APP="$HOME/Desktop/$APP_NAME.app"

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║     🤖 Claude-WeChat Bot Installer       ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
  echo ""
}

# ---- Step 1: Check Node.js ----
check_node() {
  echo -e "${YELLOW}[1/5]${NC} Checking Node.js..."
  if ! command -v node &>/dev/null; then
    echo -e "${RED}✗ Node.js not found.${NC}"
    echo "  Install from: https://nodejs.org (v22 or later)"
    echo "  Or: brew install node"
    exit 1
  fi
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -lt 22 ]; then
    echo -e "${RED}✗ Node.js $NODE_VER detected (need >= 22).${NC}"
    echo "  Upgrade: brew upgrade node  or  https://nodejs.org"
    exit 1
  fi
  echo -e "${GREEN}✓ Node.js $(node -v)${NC}"
}

# ---- Step 2: Install dependencies ----
install_deps() {
  echo -e "${YELLOW}[2/5]${NC} Installing dependencies..."
  cd "$INSTALL_DIR"
  npm install --production 2>&1 | tail -1
  echo -e "${GREEN}✓ Dependencies installed${NC}"
}

# ---- Step 3: Configure ----
configure() {
  echo -e "${YELLOW}[3/5]${NC} Checking API configuration..."

  # Check if ~/.claude/settings.json exists (Claude Code users)
  if [ -f "$HOME/.claude/settings.json" ]; then
    echo -e "${GREEN}✓ Found Claude Code config — API key will be auto-detected${NC}"
  elif [ -n "$ANTHROPIC_AUTH_TOKEN" ]; then
    echo -e "${GREEN}✓ ANTHROPIC_AUTH_TOKEN env var found${NC}"
  else
    echo ""
    echo -e "${YELLOW}⚠ No API config found.${NC}"
    echo "  You need an Anthropic-compatible API endpoint. Options:"
    echo "  1. Direct Anthropic API:  https://console.anthropic.com"
    echo "  2. DeepSeek API:          https://platform.deepseek.com"
    echo ""
    echo "  After getting an API key, create:"
    echo "    $INSTALL_DIR/data/config.json"
    echo ""
    echo '  {"baseUrl": "https://api.deepseek.com/anthropic", "authToken": "sk-..."}'
    echo ""
  fi
}

# ---- Step 4: Generate icon & create .app bundle ----
create_launcher() {
  echo -e "${YELLOW}[4/5]${NC} Generating icon & launcher..."

  # Generate .icns from SVG
  if [ -f "$INSTALL_DIR/scripts/generate-icon.sh" ]; then
    bash "$INSTALL_DIR/scripts/generate-icon.sh" 2>/dev/null || true
  fi

  ICON="$INSTALL_DIR/assets/icon.icns"

  # Build .app bundle structure
  rm -rf "$DESKTOP_APP"
  mkdir -p "$DESKTOP_APP/Contents/MacOS"
  mkdir -p "$DESKTOP_APP/Contents/Resources"

  # Launcher script inside .app
  cat > "$DESKTOP_APP/Contents/MacOS/launcher.sh" << LAUNCHER
#!/bin/bash
cd "$INSTALL_DIR" || exit 1
exec bash start.sh
LAUNCHER
  chmod +x "$DESKTOP_APP/Contents/MacOS/launcher.sh"

  # Info.plist
  cat > "$DESKTOP_APP/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>
    <string>com.claude-wechat-bot</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleExecutable</key>
    <string>launcher.sh</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

  # Copy icon
  if [ -f "$ICON" ]; then
    cp "$ICON" "$DESKTOP_APP/Contents/Resources/icon.icns"
  fi

  # Touch the app to refresh icon cache
  touch "$DESKTOP_APP"

  echo -e "${GREEN}✓ Desktop app created: $DESKTOP_APP${NC}"
  echo "  Double-click it in Finder to start the bot."
}

# ---- Step 5: Auto-start on login ----
create_autostart() {
  echo -e "${YELLOW}[5/5]${NC} Setting up auto-start on login..."

  if [ -t 0 ]; then
    read -p "  Enable auto-start on login? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
      echo "  Skipped. Run 'bash install.sh' again to enable later."
      return
    fi
  else
    echo "  Non-interactive mode — enabling auto-start by default"
  fi

  cat > "$LAUNCH_AGENT" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-wechat-bot</string>
    <key>ProgramArguments</key>
    <array>
        <string>bash</string>
        <string>$INSTALL_DIR/start.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>StandardOutPath</key>
    <string>$INSTALL_DIR/data/bot.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_DIR/data/bot.err</string>
</dict>
</plist>
PLIST

  launchctl unload "$LAUNCH_AGENT" 2>/dev/null || true
  launchctl load "$LAUNCH_AGENT"
  echo -e "${GREEN}✓ Auto-start enabled (LaunchAgent loaded)${NC}"
}

# ---- Finish ----
finish() {
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║          ✅ Installation Complete!        ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
  echo ""
  echo "  🖥  Desktop launcher: $DESKTOP_APP"
  echo "  📁 Project directory: $INSTALL_DIR"
  echo ""
  echo "  Next steps:"
  echo "  1. Double-click '$APP_NAME.command' on your Desktop"
  echo "  2. Scan the QR code with WeChat to log in"
  echo "  3. Send a message to your bot to start chatting!"
  echo ""
  echo "  Tip: run 'bash install.sh' again to reconfigure."
  echo ""
}

# ---- Run ----
banner
check_node
install_deps
configure
create_launcher
create_autostart
finish
