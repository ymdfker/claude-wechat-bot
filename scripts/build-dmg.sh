#!/bin/bash
# ============================================================================
# Build self-contained macOS DMG for Claude-WeChat Bot
# Usage: bash scripts/build-dmg.sh [version]
# ============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/dist-app"
APP_NAME="Claude-WeChat-Bot"
VERSION="${1:-0.2.1}"
DMG_NAME="Claude-WeChat-Bot-${VERSION}.dmg"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
STAGING="$BUILD_DIR/dmg-staging"

echo "📦 Building $APP_NAME v$VERSION (self-contained, no Node.js required)"

# ---- Clean ----
rm -rf "$BUILD_DIR"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"

# ---- Copy project into .app ----
echo "  → Copying project..."
PROJ="$APP_BUNDLE/Contents/Resources/project"
rsync -a --exclude='node_modules' --exclude='.git' --exclude='data' \
      --exclude='dist-app' --exclude='dist' --exclude='*.db' \
      "$PROJECT_DIR/" "$PROJ/"

# ---- Build TypeScript (uses host node; only JS runs at runtime) ----
echo "  → Compiling TypeScript..."
cd "$PROJ"
npm install --production 2>&1 | tail -1
# tsx is devDep so not installed; use host's npx
(cd "$PROJECT_DIR" && npx tsc --outDir "$PROJ/dist" 2>&1 | tail -3)

# ---- Bundle Node.js binary into .app ----
echo "  → Bundling Node.js..."
NODE_VER="24.15.0"
# Detect arch: build machine arch = target arch for DMG
HOST_ARCH=$(uname -m)
if [ "$HOST_ARCH" = "arm64" ]; then
  NODE_ARCH="darwin-arm64"
elif [ "$HOST_ARCH" = "x86_64" ]; then
  NODE_ARCH="darwin-x64"
else
  echo "❌ Unsupported architecture: $HOST_ARCH"
  exit 1
fi
echo "    Architecture: $HOST_ARCH → $NODE_ARCH"
NODE_TGZ="node-v${NODE_VER}-${NODE_ARCH}.tar.gz"
if [ ! -f "$BUILD_DIR/$NODE_TGZ" ]; then
  echo "    Downloading Node.js v${NODE_VER} ($NODE_ARCH)..."
  curl -sL "https://nodejs.org/dist/v${NODE_VER}/${NODE_TGZ}" -o "$BUILD_DIR/$NODE_TGZ"
fi
tar xzf "$BUILD_DIR/$NODE_TGZ" -C "$BUILD_DIR" --strip-components=1 "node-v${NODE_VER}-${NODE_ARCH}/bin/node"
cp "$BUILD_DIR/bin/node" "$APP_BUNDLE/Contents/MacOS/node"
rm -rf "$BUILD_DIR/bin"

# ---- Copy sql.js WASM file (needed at runtime) ----
SQL_WASM=$(find "$PROJ/node_modules/sql.js/dist" -name "sql-wasm.wasm" 2>/dev/null | head -1)
if [ -f "$SQL_WASM" ]; then
  cp "$SQL_WASM" "$APP_BUNDLE/Contents/Resources/"
fi

# ---- Launcher script ----
cat > "$APP_BUNDLE/Contents/MacOS/launcher.sh" << 'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$DIR/MacOS/node"
PROJ="$DIR/Resources/project"
cd "$PROJ" || exit 1

# Point sql.js to the bundled WASM
export SQL_JS_WASM_PATH="$DIR/Resources/sql-wasm.wasm"

exec "$NODE" dist/index.js
EOF
chmod +x "$APP_BUNDLE/Contents/MacOS/launcher.sh"

# ---- Icon ----
bash "$PROJECT_DIR/scripts/generate-icon.sh" 2>/dev/null || true
[ -f "$PROJECT_DIR/assets/icon.icns" ] && cp "$PROJECT_DIR/assets/icon.icns" "$APP_BUNDLE/Contents/Resources/icon.icns"

# ---- Info.plist ----
cat > "$APP_BUNDLE/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>com.claude-wechat-bot.app</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleExecutable</key><string>launcher.sh</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

# ---- Create DMG ----
echo "  → Building DMG..."
rm -rf "$STAGING"; mkdir -p "$STAGING"
cp -R "$APP_BUNDLE" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

DMG_PATH="$PROJECT_DIR/dist-app/$DMG_NAME"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGING" \
  -ov -format UDZO -imagekey zlib-level=9 "$DMG_PATH" 2>&1 | tail -1
rm -rf "$STAGING"

echo ""
echo "✅ DMG: dist-app/$DMG_NAME ($(du -h "$DMG_PATH" | cut -f1))"
echo "   Self-contained — no Node.js installation needed!"
