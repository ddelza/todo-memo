# 앱 아이콘: android/icon-src.png 의 얼굴 부분을 정사각형으로 잘라 res/mipmap-* 와 웹 아이콘을 만든다.
import os
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(ROOT, 'icon-src.png')).convert('RGB')
sq = src.crop((62, 8, 372, 318)).resize((1024, 1024), Image.LANCZOS)
mask = Image.new('L', (1024, 1024), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, 1023, 1023], radius=220, fill=255)
rnd = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0)); rnd.paste(sq, (0, 0), mask)
for name, px in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    p = os.path.join(ROOT, 'res', 'mipmap-' + name); os.makedirs(p, exist_ok=True)
    rnd.resize((px, px), Image.LANCZOS).save(os.path.join(p, 'ic_launcher.png'))
pub = os.path.join(os.path.dirname(ROOT), 'public')
for px in (192, 512):
    sq.resize((px, px), Image.LANCZOS).save(os.path.join(pub, f'icon-{px}.png'))
rnd.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, 'icon-preview.png'))
print('ok')
