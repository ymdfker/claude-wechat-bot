#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ASSETS_DIR="$PROJECT_DIR/assets"
ICONSET="$ASSETS_DIR/icon.iconset"
SVG="$ASSETS_DIR/icon.svg"
PNG_1024="$ASSETS_DIR/icon_1024.png"

echo "🎨 Generating macOS icon..."

# Step 1: Generate 1024px PNG with rounded corners + transparency
echo "  → Generating 1024px PNG..."
python3 "$SCRIPT_DIR/generate-icon.py" 2>/dev/null

if [ ! -f "$PNG_1024" ]; then
  # Fallback: qlmanage (loses transparency, but better than nothing)
  echo "  → Python failed, falling back to qlmanage..."
  qlmanage -t -s 1024 -o "$ASSETS_DIR" "$SVG" &>/dev/null
  [ -f "$ASSETS_DIR/icon.svg.png" ] && mv "$ASSETS_DIR/icon.svg.png" "$PNG_1024"
fi

if [ ! -f "$PNG_1024" ]; then
  echo "  ✗ Cannot render SVG."
  exit 1
fi

# Step 2: Create iconset with ALL required macOS sizes (correct @2x)
rm -rf "$ICONSET"; mkdir "$ICONSET"

echo "  → Generating sizes..."

sips -z 16 16   "$PNG_1024" --out "$ICONSET/icon_16x16.png" &>/dev/null
sips -z 32 32   "$PNG_1024" --out "$ICONSET/icon_16x16@2x.png" &>/dev/null

sips -z 32 32   "$PNG_1024" --out "$ICONSET/icon_32x32.png" &>/dev/null
sips -z 64 64   "$PNG_1024" --out "$ICONSET/icon_32x32@2x.png" &>/dev/null

sips -z 128 128 "$PNG_1024" --out "$ICONSET/icon_128x128.png" &>/dev/null
sips -z 256 256 "$PNG_1024" --out "$ICONSET/icon_128x128@2x.png" &>/dev/null

sips -z 256 256 "$PNG_1024" --out "$ICONSET/icon_256x256.png" &>/dev/null
sips -z 512 512 "$PNG_1024" --out "$ICONSET/icon_256x256@2x.png" &>/dev/null

sips -z 512 512 "$PNG_1024" --out "$ICONSET/icon_512x512.png" &>/dev/null
cp "$PNG_1024" "$ICONSET/icon_512x512@2x.png"

echo "  → Building .icns..."
iconutil -c icns "$ICONSET" -o "$ASSETS_DIR/icon.icns"
rm -rf "$ICONSET"

echo "✅ Icon: $ASSETS_DIR/icon.icns ($(du -h "$ASSETS_DIR/icon.icns" | cut -f1))"
