# base.apk(aapt2 결과)에 assets 폴더와 classes.dex를 넣는다.
#   python tools/pack_apk.py base.apk assets_dir classes.dex out.apk
# Windows용 aapt2 -A 는 zip 안 경로를 'www\2026\...'처럼 백슬래시로 넣어 안드로이드가 못 찾으므로 직접 넣음.
import os, sys, zipfile

base, assets, dex, out = sys.argv[1:5]
STORE = ('.jpg', '.jpeg', '.png', '.webp')        # 이미 압축된 형식은 그대로
with zipfile.ZipFile(base) as zi, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zo:
    for it in zi.infolist():
        zo.writestr(it, zi.read(it.filename))
    zo.write(dex, 'classes.dex')
    n = 0
    for root, _, files in os.walk(assets):
        for f in files:
            p = os.path.join(root, f)
            arc = 'assets/' + os.path.relpath(p, assets).replace(os.sep, '/')
            zo.write(p, arc, zipfile.ZIP_STORED if f.lower().endswith(STORE) else zipfile.ZIP_DEFLATED)
            n += 1
print('assets', n)
