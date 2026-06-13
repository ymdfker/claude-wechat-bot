#!/bin/bash
# Generate app icon for Claude-WeChat-Bot
set -e

ICONSET_DIR="Claude-WeChat-Bot.iconset"
OUTPUT_ICNS="Claude-WeChat-Bot.icns"

mkdir -p "$ICONSET_DIR"

# Generate a simple bot icon using Python (emoji -> PNG)
python3 - "$ICONSET_DIR" << 'PYEOF'
import os
import sys
import subprocess

iconset = sys.argv[1]

# Create a simple icon: blue rounded rect with 🤖 emoji
# We'll use sips + a generated HTML to create PNGs
html = '''<!DOCTYPE html>
<html><body style="margin:0;width:1024;height:1024;
  background:linear-gradient(135deg,#4F46E5,#7C3AED);
  border-radius:180px;
  display:flex;align-items:center;justify-content:center;
  font-size:500px;">🤖</body></html>'''

import tempfile
with tempfile.NamedTemporaryFile(suffix='.html', delete=False, mode='w') as f:
    f.write(html)
    html_path = f.name

# Use Python's built-in render or just create a simple PNG programmatically
# Since we can't easily render HTML, let's use a different approach:
# Create the icon using sips with a single-color image + emoji text

# Actually, let's just create a simple solid PNG and use sips
os.unlink(html_path)

print("Generating icon via sips...")
# Create base image 1024x1024 with sips
subprocess.run([
    'python3', '-c', '''
from PIL import Image, ImageDraw, ImageFont
import os

# Try to use PIL, otherwise fall back to sips
try:
    img = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw rounded rectangle
    draw.rounded_rectangle([(40, 40), (984, 984)], radius=160, fill=(79, 70, 229))
    
    # Draw a simple bot face
    # Eyes
    draw.ellipse([(280, 300), (420, 480)], fill=(255, 255, 255))
    draw.ellipse([(604, 300), (744, 480)], fill=(255, 255, 255))
    # Pupils
    draw.ellipse([(340, 360), (420, 440)], fill=(30, 30, 60))
    draw.ellipse([(604, 360), (684, 440)], fill=(30, 30, 60))
    # Mouth
    draw.arc([(350, 520), (674, 750)], start=0, end=180, fill=(255, 255, 255), width=30)
    # Antenna
    draw.line([(512, 40), (512, 120)], fill=(255, 255, 100), width=20)
    draw.ellipse([(482, 10), (542, 70)], fill=(255, 200, 50))
    
    img.save("/tmp/bot_icon_1024.png")
    print("Icon created with PIL")
except ImportError:
    print("PIL not available, using sips fallback")
    os.system('sips -z 1024 1024 --setProperty fillColor "#4F46E5" /dev/null 2>&1 || true')
    # Just create a colored square
    import sys
    sys.exit(1)
'''
], check=False)

# If PIL not available, create a simple icon with built-in tools
print("Generating icon sizes...")
EOF

# Generate all required sizes
SIZES=(16 32 64 128 256 512 1024)

# Check if base image exists
if [ ! -f /tmp/bot_icon_1024.png ]; then
    echo "Creating base icon with sips..."
    # Create a simple blue square as fallback
    python3 -c "
import struct, zlib

def create_png(width, height, r, g, b):
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc
    
    header = b'\\x89PNG\\r\\n\\x1a\\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    
    raw = b''
    for y in range(height):
        raw += b'\\x00'  # filter none
        for x in range(width):
            # Rounded corners check
            cx, cy = x - width/2, y - height/2
            dist = (cx*cx + cy*cy) ** 0.5
            radius = width/2 - 20
            if dist < radius:
                raw += bytes([r, g, b])
            else:
                raw += bytes([0, 0, 0, 0])
    
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    
    return header + ihdr + idat + iend

with open('/tmp/bot_icon_1024.png', 'wb') as f:
    f.write(create_png(1024, 1024, 79, 70, 229))
print('Base icon created')
"
fi

for size in "${SIZES[@]}"; do
    sips -z "$size" "$size" /tmp/bot_icon_1024.png --out "$ICONSET_DIR/icon_${size}x${size}.png" 2>/dev/null
    # Also create @2x versions
    double=$((size * 2))
    if [ "$double" -le 1024 ]; then
        sips -z "$double" "$double" /tmp/bot_icon_1024.png --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" 2>/dev/null
    fi
done

# Create icns
iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICNS"
rm -rf "$ICONSET_DIR"
echo "✅ Icon created: $OUTPUT_ICNS"
