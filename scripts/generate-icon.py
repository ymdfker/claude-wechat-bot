"""macOS icon: WeChat green base + chat bubbles + Claude star robot."""
from PIL import Image, ImageDraw, ImageFilter
import math, os

S = 1024
R = S * 110 // 512

img = Image.new('RGBA', (S, S), (0,0,0,0))

def in_rect(x,y):
    if x<R and y<R and (x-R)**2+(y-R)**2>R**2: return False
    if x>=S-R and y<R and (x-(S-R))**2+(y-R)**2>R**2: return False
    if x<R and y>=S-R and (x-R)**2+(y-(S-R))**2>R**2: return False
    if x>=S-R and y>=S-R and (x-(S-R))**2+(y-(S-R))**2>R**2: return False
    return True

# WeChat green gradient bg
for y in range(S):
    for x in range(S):
        if not in_rect(x,y): continue
        dx=(x-S*0.38)/(S*0.65); dy=(y-S*0.33)/(S*0.65)
        d=min(math.sqrt(dx*dx+dy*dy),1.0)
        r=max(int(45+55*(1-d)-15*d),20)
        g=max(int(190+30*(1-d)-50*d),130)
        b=max(int(60+30*(1-d)-20*d),25)
        img.putpixel((x,y),(r,g,b,255))

# Glass
for y in range(S):
    t=y/S; glass=0.16*(1-t)+0.03*(1-abs(t-0.4)*2.5)-0.06*t
    alpha=max(0,int(glass*255))
    if alpha==0: continue
    for x in range(S):
        _,_,_,a=img.getpixel((x,y))
        if a>0: r,g,b,_=img.getpixel((x,y)); img.putpixel((x,y),(min(255,r+alpha),min(255,g+alpha),min(255,b+alpha),255))

# Layer: draw white chat bubbles (two, overlapping)
bubble_layer = Image.new('RGBA',(S,S),(0,0,0,0))
bd = ImageDraw.Draw(bubble_layer)

# Big bubble (left, representing WeChat conversation)
bx1,by1 = int(S*340/512), int(S*210/512)
brx1,bry1 = int(S*195/512), int(S*130/512)
bd.ellipse([bx1-brx1,by1-bry1,bx1+brx1,by1+bry1], fill=(255,255,255,int(255*0.88)))
bd.polygon([
    (bx1+int(brx1*0.6),by1+int(bry1*0.85)),
    (bx1+int(brx1*1.15),by1+int(bry1*1.2)),
    (bx1+int(brx1*0.5),by1+int(bry1*0.92)),
], fill=(255,255,255,int(255*0.88)))

# Small bubble (right, lower) — this is the Claude robot
bx2,by2 = int(S*490/512), int(S*340/512)
brx2,bry2 = int(S*105/512), int(S*70/512)
bd.ellipse([bx2-brx2,by2-bry2,bx2+brx2,by2+bry2], fill=(255,255,255,int(255*0.85)))
bd.polygon([
    (bx2-int(brx2*0.55),by2+int(bry2*0.85)),
    (bx2-int(brx2*1.0),by2+int(bry2*1.25)),
    (bx2-int(brx2*0.5),by2+int(bry2*0.9)),
], fill=(255,255,255,int(255*0.85)))

img = Image.alpha_composite(img, bubble_layer)

# Claude orange robot circle inside the small bubble
cx,cy = bx2, by2-int(bry2*0.05)
cr = int(min(brx2,bry2)*0.6)
robot = Image.new('RGBA',(S,S),(0,0,0,0))
rd = ImageDraw.Draw(robot)
rd.ellipse([cx-cr,cy-cr,cx+cr,cy+cr], fill=(249,115,22,255))
# Star inside
sr = int(cr*0.55)
pts=[]
for i in range(10):
    a=math.pi/2+i*math.pi/5
    r=sr if i%2==0 else sr*0.38
    pts.append((cx+r*math.cos(a),cy-r*math.sin(a)))
rd.polygon(pts, fill=(255,255,255,int(255*0.9)))
img = Image.alpha_composite(img, robot)

# Save
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets','icon_1024.png')
img.save(out,'PNG')
print(f'  ✓ icon_1024.png', flush=True)
