#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ASSETS_DIR="$PROJECT_DIR/assets"
ICONSET_DIR="$ASSETS_DIR/icon.iconset"
SVG_SRC="$ASSETS_DIR/icon.svg"
PNG_SRC="$ASSETS_DIR/icon_1024.png"

echo "🎨 Generating macOS icon..."

echo "  → Rendering SVG to 1024px PNG..."
qlmanage -t -s 1024 -o "$ASSETS_DIR" "$SVG_SRC" &>/dev/null
if [ -f "$ASSETS_DIR/icon.svg.png" ]; then
  mv "$ASSETS_DIR/icon.svg.png" "$PNG_SRC"
fi

if [ ! -f "$PNG_SRC" ]; then
  echo "  → qlmanage unavailable, generating minimal PNG..."
  python3 -c "
import struct, zlib
def png(w,h):
    def ch(ct,d):
        c=ct+d
        return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
    hdr=b'\x89PNG\r\n\x1a\n'
    ih=ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))
    raw=b''
    for y in range(h):
        raw+=b'\x00'
        for x in range(w):
            t=y/h
            raw+=struct.pack('BBB',int(26+82*t),int(26+66*t),int(46+185*t))
    return hdr+ih+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')
with open('$PNG_SRC','wb') as f: f.write(png(1024,1024))
" 2>/dev/null
fi

echo "  → Creating iconset..."
rm -rf "$ICONSET_DIR"; mkdir -p "$ICONSET_DIR"
for s in 16 32 64 128 256 512; do
  sips -z $s $s "$PNG_SRC" --out "$ICONSET_DIR/icon_${s}x${s}.png" &>/dev/null
  cp "$ICONSET_DIR/icon_${s}x${s}.png" "$ICONSET_DIR/icon_$((s/2))x$((s/2))@2x.png" 2>/dev/null || true
done
# Fix 16@2x manually
cp "$ICONSET_DIR/icon_32x32.png" "$ICONSET_DIR/icon_16x16@2x.png" 2>/dev/null || true

echo "  → Building .icns..."
iconutil -c icns "$ICONSET_DIR" -o "$ASSETS_DIR/icon.icns" 2>/dev/null
rm -rf "$ICONSET_DIR"
echo "✅ Icon: $ASSETS_DIR/icon.icns"
