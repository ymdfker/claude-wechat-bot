"""WeChat-style icon: green base + large chat bubble + Claude star replacing small bubble."""
from PIL import Image, ImageDraw, ImageFilter
import math, os

S = 1024
R = S * 120 // 512  # squircle corner radius

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

def in_rounded_rect(x, y):
    if x < R and y < R and (x-R)**2 + (y-R)**2 > R**2: return False
    if x >= S-R and y < R and (x-(S-R))**2 + (y-R)**2 > R**2: return False
    if x < R and y >= S-R and (x-R)**2 + (y-(S-R))**2 > R**2: return False
    if x >= S-R and y >= S-R and (x-(S-R))**2 + (y-(S-R))**2 > R**2: return False
    return True

# ====== WeChat Green Background ======
# Reference green: RGB(60, 176, 52)
BASE_R, BASE_G, BASE_B = 60, 176, 52
for y in range(S):
    for x in range(S):
        if not in_rounded_rect(x, y): continue
        dx = (x - S*0.4) / (S*0.7)
        dy = (y - S*0.35) / (S*0.7)
        d = min(math.sqrt(dx*dx + dy*dy), 1.0)
        r = max(int(BASE_R + 40*(1-d) - 20*d), 20)
        g = max(int(BASE_G + 40*(1-d) - 60*d), 120)
        b = max(int(BASE_B + 40*(1-d) - 30*d), 20)
        img.putpixel((x, y), (r, g, b, 255))

# Glass
for y in range(S):
    t = y / S
    glass = 0.15*(1-t) + 0.03*(1-abs(t-0.4)*2.5) - 0.06*t
    alpha = max(0, int(glass*255))
    if alpha == 0: continue
    for x in range(S):
        _, _, _, a = img.getpixel((x, y))
        if a > 0:
            r, g, b, _ = img.getpixel((x, y))
            img.putpixel((x, y), (min(255, r+alpha), min(255, g+alpha), min(255, b+alpha), 255))

# ====== Large White Chat Bubble (upper-left area) ======
# WeChat icon has two bubbles: one large (left), one small (right, lower)
# We keep the large one, replace small one with Claude star
bx = int(S * 370 / 512)
by = int(S * 210 / 512)
brx = int(S * 210 / 512)
bry = int(S * 140 / 512)

bubble = Image.new('RGBA', (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(bubble)
# Main ellipse body
bd.ellipse([bx - brx, by - bry, bx + brx, by + bry],
           fill=(255, 255, 255, int(255 * 0.9)))
# Tail (lower-right direction)
bd.polygon([
    (bx + int(brx * 0.65), by + int(bry * 0.85)),
    (bx + int(brx * 1.2), by + int(bry * 1.25)),
    (bx + int(brx * 0.55), by + int(bry * 0.9)),
], fill=(255, 255, 255, int(255 * 0.9)))
# Inner highlight
bd.ellipse([bx - int(brx * 0.3), by - int(bry * 0.1),
            bx + int(brx * 0.3), by + int(bry * 0.1)],
           fill=(60, 176, 52, int(255 * 0.25)))
img = Image.alpha_composite(img, bubble)

# ====== Claude Code (replaces smaller bubble, lower-right) ======
cx2 = int(S * 320 / 512)
cy2 = int(S * 360 / 512)
cr2 = int(S * 95 / 512)

# Shadow for Claude circle
sd_img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sd_draw = ImageDraw.Draw(sd_img)
sd_draw.ellipse([cx2 - cr2 + 5, cy2 - cr2 + 5, cx2 + cr2 + 5, cy2 + cr2 + 5],
                fill=(40, 100, 30, 40))
sd_img = sd_img.filter(ImageFilter.GaussianBlur(5))
img = Image.alpha_composite(img, sd_img)

# Orange circle with gradient
cc_img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
for y in range(cy2 - cr2, cy2 + cr2):
    for x in range(cx2 - cr2, cx2 + cr2):
        dx2 = (x - cx2) / cr2
        dy2 = (y - cy2) / cr2
        dist2 = dx2*dx2 + dy2*dy2
        if dist2 <= 1:
            # Claude orange: #F97316 base
            rr = int(249 - 30 * dist2 - 15 * max(0, dy2))
            gg = int(115 - 50 * dist2 - 20 * max(0, dy2))
            bb = int(22 - 10 * dist2)
            cc_img.putpixel((x, y), (max(rr, 200), max(gg, 40), max(bb, 10), 255))
img = Image.alpha_composite(img, cc_img)

# White star inside
star_r = int(cr2 * 0.58)
star_img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
star_draw = ImageDraw.Draw(star_img)
pts = []
for i in range(10):
    angle = math.pi/2 + i * math.pi/5
    r = star_r if i % 2 == 0 else star_r * 0.38
    pts.append((cx2 + r*math.cos(angle), cy2 - r*math.sin(angle)))
star_draw.polygon(pts, fill=(255, 255, 255, int(255 * 0.9)))
img = Image.alpha_composite(img, star_img)

# Save
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'assets', 'icon_1024.png')
img.save(out, 'PNG')
print(f'  ✓ icon_1024.png', flush=True)
