# 按虚拟时刻截一组画面，拼成一张对照图，用来人工检查动画过程。
# 用法：python3 test/frames.py 页面 动作 输出.jpg 秒 [秒 ...]
#   例：python3 test/frames.py dev/sources.html 0@0,1@2.4 out.jpg 2.6 3.0 3.4
import base64, io, re, subprocess, sys, pathlib
from PIL import Image
page, script, out, *times = sys.argv[1:]
root = pathlib.Path(__file__).resolve().parent
urls = [f'http://127.0.0.1:8765/{page}#test={script}&at={t}' for t in times]
res = subprocess.run(['node', str(root / 'shoot.mjs'), *urls], capture_output=True, text=True, timeout=1800).stdout
shots = dict(l.split('\t', 1) for l in res.splitlines() if '\t' in l)
ims = []
for u in urls:
    m = re.search(r'base64,([A-Za-z0-9+/=]+)', shots.get(u, ''))
    ims.append(Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert('RGB').resize((600, 427)) if m else Image.new('RGB', (600, 427), 'red'))
cols = 2; rows = (len(ims) + 1) // 2
sheet = Image.new('RGB', (600 * cols, 427 * rows), 'white')
for i, im in enumerate(ims): sheet.paste(im, ((i % cols) * 600, (i // cols) * 427))
sheet.save(out, quality=85)
print(f'{sum(1 for u in urls if "base64" in shots.get(u, ""))}/{len(urls)} 张 → {out}')
