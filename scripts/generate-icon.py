"""macOS icon with proper internal padding."""
from PIL import Image, ImageDraw, ImageFilter
import math, os

S = 1024
PAD = 64  # 6.25% padding per side
R = int((S - 2*PAD) * 0.22)  # corner radius proportional to content area

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

def in_rect(x, y, cx, cy, r):
    # Content area with rounded corners
    left, top = PAD, PAD
    right, bottom = S - PAD, S - PAD
    if x < left or x >= right or y < top or y >= bottom: return False
    if x < left+r and y < top+r and (x-left-r)**2 + (y-top-r)**2 > r**2: return False
    if x >= right-r and y < top+r and (x-(right-r))**2 + (y-top-r)**2 > r**2: return False
    if x < left+r and y >= bottom-r and (x-left-r)**2 + (y-(bottom-r))**2 > r**2: return False
    if x >= right-r and y >= bottom-r and (x-(right-r))**2 + (y-(bottom-r))**2 > r**2: return False
    return True

content_r = (S - 2*PAD) // 2
content_cx, content_cy = S // 2, S // 2

# WeChat green gradient bg (only within padded rounded rect)
for y in range(S):
    for x in range(S):
        if not in_rect(x, y, content_cx, content_cy, R): continue
        dx = (x - S*0.38) / (S*0.65)
        dy = (y - S*0.33) / (S*0.65)
        d = min(math.sqrt(dx*dx + dy*dy), 1.0)
        r_chan = max(int(45 + 55*(1-d) - 15*d), 20)
        g_chan = max(int(190 + 30*(1-d) - 50*d), 130)
        b_chan = max(int(60 + 30*(1-d) - 20*d), 25)
        img.putpixel((x, y), (r_chan, g_chan, b_chan, 255))

# Glass
for y in range(S):
    t = y / S
    glass = 0.16*(1-t) + 0.03*(1-abs(t-0.4)*2.5) - 0.06*t
    alpha = max(0, int(glass*255))
    if alpha == 0: continue
    for x in range(S):
        _, _, _, a = img.getpixel((x, y))
        if a > 0:
            r, g, b, _ = img.getpixel((x, y))
            img.putpixel((x, y), (min(255, r+alpha), min(255, g+alpha), min(255, b+alpha), 255))

# Scale factor for internal elements (shrink to fit within padding)
SF = (S - 2*PAD) / S

# Big chat bubble
bubble_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(bubble_layer)
bx1 = int(S/2 + int(S * -40/512))
by1 = int(S/2 + int(S * -45/512))
brx1 = int(S * 180/512 * SF)
bry1 = int(S * 120/512 * SF)
bd.ellipse([bx1-brx1, by1-bry1, bx1+brx1, by1+bry1], fill=(255, 255, 255, int(255*0.88)))
bd.polygon([
    (bx1+int(brx1*0.5), by1+int(bry1*0.82)),
    (bx1+int(brx1*1.0), by1+int(bry1*1.15)),
    (bx1+int(brx1*0.4), by1+int(bry1*0.9)),
], fill=(255, 255, 255, int(255*0.88)))

# Small bubble + Claude star
bx2 = int(S/2 + int(S * 100/512))
by2 = int(S/2 + int(S * 80/512))
brx2 = int(S * 105/512 * SF)
bry2 = int(S * 70/512 * SF)
bd.ellipse([bx2-brx2, by2-bry2, bx2+brx2, by2+bry2], fill=(255, 255, 255, int(255*0.85)))
bd.polygon([
    (bx2-int(brx2*0.5), by2+int(bry2*0.82)),
    (bx2-int(brx2*0.9), by2+int(bry2*1.2)),
    (bx2-int(brx2*0.42), by2+int(bry2*0.88)),
], fill=(255, 255, 255, int(255*0.85)))
img = Image.alpha_composite(img, bubble_layer)

# Claude robot inside small bubble
cx, cy = bx2, by2 - int(bry2*0.05)
cr = int(min(brx2, bry2) * 0.6)
robot = Image.new('RGBA', (S, S), (0, 0, 0, 0))
rd = ImageDraw.Draw(robot)
rd.ellipse([cx-cr, cy-cr, cx+cr, cy+cr], fill=(249, 115, 22, 255))
sr = int(cr * 0.55)
pts = []
for i in range(10):
    a = math.pi/2 + i*math.pi/5
    r = sr if i%2 == 0 else sr * 0.38
    pts.append((cx + r*math.cos(a), cy - r*math.sin(a)))
rd.polygon(pts, fill=(255, 255, 255, int(255*0.9)))
img = Image.alpha_composite(img, robot)

# Interaction dot
ix, iy = int(bx1+brx1*0.85), int(by1+bry1*0.6)
dot = Image.new('RGBA', (S, S), (0, 0, 0, 0))
dd = ImageDraw.Draw(dot)
dd.ellipse([ix-4, iy-4, ix+4, iy+4], fill=(255, 255, 255, int(255*0.35)))
img = Image.alpha_composite(img, dot)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'icon_1024.png')
img.save(out, 'PNG')

# Verify padding
bbox = img.split()[-1].getbbox()
print(f'  bbox={bbox}', flush=True)
if bbox:
    l, t, r, b = bbox
    print(f'  padding: left={l}, top={t}, right={S-r}, bottom={S-b}', flush=True)
