#!/usr/bin/env python3
"""Generate a geeky AI-styled icon for Claude-WeChat-Bot."""

from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageOps
import math
import os
import subprocess
import shutil

# ── Config ──────────────────────────────────────
SIZE = 1024
OUTPUT_ICNS = "/tmp/AppIcon.icns"
ICONSET = "/tmp/bot.iconset"

# Colors (dark tech palette)
BG_DARK = (18, 18, 28, 255)
BG_MID = (30, 30, 48, 255)
PURPLE = (138, 43, 226, 255)      # BlueViolet
CYAN = (0, 255, 255, 255)          # Cyan
MAGENTA = (255, 0, 128, 255)       # Hot pink
GOLD = (255, 200, 50, 255)         # Warm accent
WHITE_DIM = (200, 200, 230, 255)
DARK_BG = (10, 10, 20, 255)

def create_icon(size):
    """Create the icon at given size."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    cx, cy = size // 2, size // 2
    r_base = size // 2 - size // 40  # Slightly smaller for safety
    
    # ── 1. Rounded rectangle base mask ──────────
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    corner = size // 5
    mask_draw.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=corner,
        fill=255
    )
    
    # ── 2. Background gradient ──────────────────
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg)
    
    # Dark indigo gradient top-left to bottom-right
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)
            # Deep purple to dark navy
            r = int(18 + (138 - 18) * t * 0.3)
            g = int(18 + (43 - 18) * t * 0.2)
            b = int(28 + (100 - 28) * t * 0.5)
            bg_draw.point((x, y), (r, g, b, 255))
    
    bg = Image.composite(bg, Image.new("RGBA", (size, size), (0,0,0,0)), mask)
    
    # ── 3. Neural network pattern ───────────────
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ov_draw = ImageDraw.Draw(overlay)
    
    # Nodes positions (neural network layout)
    margin = size // 5
    spacing = (size - 2 * margin) // 3
    
    nodes = []
    layers = [3, 4, 4, 3]  # Input -> Hidden -> Hidden -> Output
    
    for layer_idx, num_nodes in enumerate(layers):
        x = margin + layer_idx * spacing
        for node_idx in range(num_nodes):
            y = margin + node_idx * ((size - 2 * margin) // max(num_nodes - 1, 1))
            if num_nodes == 1:
                y = cy
            # Add slight randomness
            jitter_x = ((hash(f"{layer_idx}-{node_idx}-x") % 100) - 50) / 200
            jitter_y = ((hash(f"{layer_idx}-{node_idx}-y") % 100) - 50) / 200
            nodes.append((x + jitter_x * spacing * 0.15, y + jitter_y * spacing * 0.15, layer_idx))
    
    # Draw connections (synapses) with glow
    for i, (x1, y1, l1) in enumerate(nodes):
        for j, (x2, y2, l2) in enumerate(nodes):
            if l2 == l1 + 1:
                # Gradient line from purple to cyan
                alpha = 120
                for step in range(8):
                    t = step / 7
                    px = int(x1 + (x2 - x1) * t)
                    py = int(y1 + (y2 - y1) * t)
                    # Color shift from purple to cyan
                    r = int(PURPLE[0] + (CYAN[0] - PURPLE[0]) * t)
                    g = int(PURPLE[1] + (CYAN[1] - PURPLE[1]) * t)
                    b = int(PURPLE[2] + (CYAN[2] - PURPLE[2]) * t)
                    d = 3
                    ov_draw.ellipse(
                        [(px - d, py - d), (px + d, py + d)],
                        fill=(r, g, b, alpha)
                    )
    
    # Draw nodes
    for x, y, layer in nodes:
        if layer == 0:
            color = CYAN
            radius = size // 35
        elif layer == len(layers) - 1:
            color = MAGENTA
            radius = size // 35
        else:
            color = PURPLE
            radius = size // 40
        
        # Outer glow
        for g in range(3, 0, -1):
            gr = radius + g * size // 100
            alpha_g = 80 // (g + 1)
            ov_draw.ellipse(
                [(x - gr, y - gr), (x + gr, y + gr)],
                fill=(color[0], color[1], color[2], alpha_g)
            )
        
        # Core node
        ov_draw.ellipse(
            [(x - radius, y - radius), (x + radius, y + radius)],
            fill=(*color[:3], 230)
        )
        # White center
        inner_r = radius // 2
        ov_draw.ellipse(
            [(x - inner_r, y - inner_r), (x + inner_r, y + inner_r)],
            fill=(255, 255, 255, 200)
        )
    
    # ── 4. Central holographic ring ──────────────
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ring_draw = ImageDraw.Draw(ring)
    
    # Concentric arcs
    for r_ring in [size // 5, size // 4, size // 3]:
        for angle in range(0, 360, 2):
            rad = math.radians(angle)
            px = cx + r_ring * math.cos(rad)
            py = cy + r_ring * math.sin(rad)
            # Pulsing opacity
            alpha = int(40 + 30 * math.sin(angle * 0.1))
            ring_draw.point((px, py), (*CYAN[:3], alpha))
    
    overlay = Image.alpha_composite(overlay, ring)
    
    # ── 5. "AI" text in center ──────────────────
    # We'll use geometric shapes to form AI
    text_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    text_draw = ImageDraw.Draw(text_layer)
    
    # Stylized "AI" geometric representation
    # A-shape: triangle with crossbar
    a_top = (cx, cy - size // 6)
    a_left = (cx - size // 8, cy + size // 10)
    a_right = (cx + size // 8, cy + size // 10)
    # A legs
    text_draw.line([a_top, a_left], fill=(*CYAN[:3], 200), width=size//60)
    text_draw.line([a_top, a_right], fill=(*MAGENTA[:3], 200), width=size//60)
    # A crossbar
    cross_y = cy - size // 30
    text_draw.line(
        [(cx - size // 18, cross_y), (cx + size // 18, cross_y)],
        fill=(*GOLD[:3], 180),
        width=size//70
    )
    
    # I: vertical bar next to A
    i_x = cx + size // 5
    text_draw.line(
        [(i_x, cy - size // 8), (i_x, cy + size // 8)],
        fill=(*CYAN[:3], 200),
        width=size//60
    )
    # I top dot
    dot_r = size // 40
    text_draw.ellipse(
        [(i_x - dot_r, cy - size // 6 - dot_r), (i_x + dot_r, cy - size // 6 + dot_r)],
        fill=(*MAGENTA[:3], 220)
    )
    
    overlay = Image.alpha_composite(overlay, text_layer)
    
    # ── 6. Corner accents ───────────────────────
    acc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    acc_draw = ImageDraw.Draw(acc)
    acc_m = size // 15
    
    # Four corner brackets
    corners = [
        (acc_m, acc_m, 1, 1),           # top-left
        (size - acc_m, acc_m, -1, 1),   # top-right
        (acc_m, size - acc_m, 1, -1),   # bottom-left
        (size - acc_m, size - acc_m, -1, -1),  # bottom-right
    ]
    
    for x0, y0, dx, dy in corners:
        length = size // 10
        w = size // 70
        # Horizontal
        acc_draw.rectangle(
            [(x0, y0), (x0 + dx * length, y0 + dy * w)],
            fill=(*CYAN[:3], 180)
        )
        # Vertical
        acc_draw.rectangle(
            [(x0, y0), (x0 + dx * w, y0 + dy * length)],
            fill=(*CYAN[:3], 180)
        )
    
    overlay = Image.alpha_composite(overlay, acc)
    
    # ── 7. Particle dots (sparse) ───────────────
    particle_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    p_draw = ImageDraw.Draw(particle_layer)
    
    import random
    random.seed(42)
    for _ in range(size // 8):
        px = random.randint(margin, size - margin)
        py = random.randint(margin, size - margin)
        pr = random.randint(1, 3)
        alpha = random.randint(30, 120)
        color_choice = random.choice([CYAN, PURPLE, MAGENTA, GOLD])
        p_draw.ellipse(
            [(px - pr, py - pr), (px + pr, py + pr)],
            fill=(*color_choice[:3], alpha)
        )
    
    overlay = Image.alpha_composite(overlay, particle_layer)
    
    # ── 8. Composite with background ────────────
    final = Image.alpha_composite(bg, overlay)
    
    # Apply mask for rounded corners
    final = Image.composite(final, Image.new("RGBA", (size, size), (0,0,0,0)), mask)
    
    return final


# ── Main ──────────────────────────────────────
print("🎨 Generating AI-geek icon...")

# Clean
if os.path.exists(ICONSET):
    shutil.rmtree(ICONSET)
os.makedirs(ICONSET)

# Generate all sizes
for s in [16, 32, 64, 128, 256, 512, 1024]:
    icon = create_icon(s)
    icon.save(f"{ICONSET}/icon_{s}x{s}.png")
    print(f"  ✅ {s}x{s}")
    
    s2 = s * 2
    if s2 <= 1024:
        icon2 = create_icon(s2)
        icon2.save(f"{ICONSET}/icon_{s}x{s}@2x.png")
        print(f"  ✅ {s}x{s}@2x")

# Create ICNS
subprocess.run(["iconutil", "-c", "icns", ICONSET, "-o", OUTPUT_ICNS], check=True)
shutil.rmtree(ICONSET)

print(f"\n✅ Icon created: {OUTPUT_ICNS}")
print(f"   Size: {os.path.getsize(OUTPUT_ICNS)} bytes")
