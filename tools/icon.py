from PIL import Image, ImageDraw
import os
INK=(20,20,20,255); CREAM=(246,245,242,255); GREEN=(61,214,140,255)
def glyph(d, cx, cy, s):
    # bus body s = width
    w=s; h=s*1.12; x0=cx-w/2; y0=cy-h/2
    r=s*0.2
    d.rounded_rectangle([x0,y0,x0+w,y0+h*0.86],radius=r,fill=CREAM)
    # windshield
    d.rounded_rectangle([x0+w*0.12,y0+h*0.14,x0+w*0.88,y0+h*0.46],radius=s*0.07,fill=INK)
    # top sign bar
    d.rounded_rectangle([x0+w*0.28,y0+h*0.045,x0+w*0.72,y0+h*0.085],radius=s*0.02,fill=INK)
    # headlights
    for fx in (0.24,0.76):
        d.ellipse([x0+w*fx-s*0.065,y0+h*0.62-s*0.065,x0+w*fx+s*0.065,y0+h*0.62+s*0.065],fill=INK)
    # wheels
    for fx in (0.22,0.78):
        d.rounded_rectangle([x0+w*fx-s*0.08,y0+h*0.8,x0+w*fx+s*0.08,y0+h*1.0],radius=s*0.05,fill=CREAM)
def live_dot(d,cx,cy,r):
    d.ellipse([cx-r*1.45,cy-r*1.45,cx+r*1.45,cy+r*1.45],fill=INK)
    d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=GREEN)
N=1024
# legacy (full) icon: rounded square
im=Image.new('RGBA',(N,N),(0,0,0,0)); d=ImageDraw.Draw(im)
d.rounded_rectangle([0,0,N-1,N-1],radius=N*0.23,fill=INK)
glyph(d,N/2,N/2+10,N*0.46); live_dot(d,N*0.73,N*0.27,N*0.06)
# adaptive foreground (108dp canvas, content within inner 66dp)
fg=Image.new('RGBA',(N,N),(0,0,0,0)); f=ImageDraw.Draw(fg)
glyph(f,N/2,N/2+8,N*0.30); live_dot(f,N*0.655,N*0.345,N*0.04)
sizes={'mdpi':48,'hdpi':72,'xhdpi':96,'xxhdpi':144,'xxxhdpi':192}
for k,v in sizes.items():
    p=f'res/mipmap-{k}'; os.makedirs(p,exist_ok=True)
    im.resize((v,v),Image.LANCZOS).save(f'{p}/ic_launcher.png')
    fg.resize((int(v*2.25),int(v*2.25)),Image.LANCZOS).save(f'{p}/ic_launcher_fg.png')
im.resize((512,512),Image.LANCZOS).save('assets/icon.png')
os.makedirs('res/mipmap-anydpi-v26',exist_ok=True)
open('res/mipmap-anydpi-v26/ic_launcher.xml','w').write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/icon_bg"/>
    <foreground android:drawable="@mipmap/ic_launcher_fg"/>
</adaptive-icon>
''')
