"""Generate a 1024x1024 PNG icon with rounded corners and transparency."""
from PIL import Image, ImageDraw, ImageFilter
import math, os

S = 1024
R = S * 112 // 512  # corner radius (macOS squircle ~22%)

# Create RGBA image (fully transparent)
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

# Helper: check if (cx, cy) is inside the rounded rect
def inside_rounded_rect(x, y):
    if x < R and y < R and (x-R)**2 + (y-R)**2 > R**2:
        return False
    if x >= S-R and y < R and (x-(S-R))**2 + (y-R)**2 > R**2:
        return False
    if x < R and y >= S-R and (x-R)**2 + (y-(S-R))**2 > R**2:
        return False
    if x >= S-R and y >= S-R and (x-(S-R))**2 + (y-(S-R))**2 > R**2:
        return False
    return True

# --- Claude orange gradient background ---
cx_light, cy_light = S * 0.35, S * 0.30
for y in range(S):
    for x in range(S):
        if not inside_rounded_rect(x, y):
            continue
        dx = (x - cx_light) / (S * 0.7)
        dy = (y - cy_light) / (S * 0.7)
        d = min(math.sqrt(dx*dx + dy*dy), 1.0)
        r = int(255 - 140 * d)
        g = max(int(153 - 135 * d), 20)
        b = max(int(68 - 58 * d), 10)
        img.putpixel((x, y), (r, g, b, 255))

# --- Glass highlight overlay ---
for y in range(S):
    t = y / S
    # Glass: bright at top, subtle in middle, dark at bottom
    glass = 0.20 * (1 - t) + 0.04 * (1 - abs(t - 0.42) * 2.5) - 0.10 * t
    alpha = max(0, int(glass * 255))
    if alpha == 0:
        continue
    for x in range(S):
        _, _, _, a = img.getpixel((x, y))
        if a > 0:
            r, g, b, _ = img.getpixel((x, y))
            img.putpixel((x, y), (min(255, r + alpha), min(255, g + alpha), min(255, b + alpha), 255))

# --- Claude white star (centered, upper area) ---
star_cx, star_cy = S // 2, int(S * 224 / 512)
star_r = int(S * 58 / 512)
points = []
for i in range(10):
    angle = math.pi / 2 + i * math.pi / 5
    r = star_r if i % 2 == 0 else star_r * 0.38
    points.append((star_cx + r * math.cos(angle), star_cy - r * math.sin(angle)))

star_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
star_draw = ImageDraw.Draw(star_layer)
star_draw.polygon(points, fill=(255, 255, 255, int(255 * 0.88)))
img = Image.alpha_composite(img, star_layer)

# --- WeChat green bubble (lower-right) ---
bx, by = int(S * 314 / 512), int(S * 314 / 512)
br = int(S * 70 / 512)

# Shadow
shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.ellipse([bx - br + 4, by - br + 4, bx + br + 4, by + br + 4],
           fill=(10, 90, 30, 60))
shadow = shadow.filter(ImageFilter.GaussianBlur(6))
img = Image.alpha_composite(img, shadow)

# Bubble body
bubble = Image.new('RGBA', (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(bubble)
bd.ellipse([bx - br, by - br, bx + br, by + br], fill=(30, 215, 96, 255))
img = Image.alpha_composite(img, bubble)

# --- Chat mark inside bubble ---
mark = Image.new('RGBA', (S, S), (0, 0, 0, 0))
md = ImageDraw.Draw(mark)
md.ellipse([bx - 20, by - 6 - 13, bx + 20, by - 6 + 13],
           fill=(255, 255, 255, int(255 * 0.9)))
md.polygon([(bx - 8, by + 6), (bx - 14, by + 22), (bx - 4, by + 10)],
           fill=(255, 255, 255, int(255 * 0.9)))
img = Image.alpha_composite(img, mark)

# --- Interaction spark ---
sx, sy = int(S * 282 / 512), int(S * 288 / 512)
spark = Image.new('RGBA', (S, S), (0, 0, 0, 0))
spd = ImageDraw.Draw(spark)
spd.ellipse([sx - 5, sy - 5, sx + 5, sy + 5],
            fill=(255, 255, 255, int(255 * 0.45)))
img = Image.alpha_composite(img, spark)

# Save
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'assets', 'icon_1024.png')
img.save(out, 'PNG')
print(f'  ✓ icon_1024.png ({img.mode}, {S}x{S})', flush=True)
