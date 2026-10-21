# 黄金帧对比：同一虚拟时刻，reference/v7 与新引擎的画面逐像素比较。
# 用法：python3 test/golden.py   （需要先在 forma 目录起 http 服务：python3 -m http.server 8765；截帧见 shoot.mjs）
import base64, io, re, subprocess, sys, tempfile, pathlib
import numpy as np
from PIL import Image

BASE = 'http://127.0.0.1:8765'
OUT = pathlib.Path(tempfile.gettempdir()) / 'forma-golden'
OUT.mkdir(exist_ok=True)

SCENARIOS = [            # (名字, 动作, 截帧时刻)
    ('idle-blob',     '',                 1.0),
    ('forming',       '0@0',              0.7),
    ('formed',        '0@0',              2.2),
    ('morph-mid',     '0@0,3@2.2',        3.0),
    ('morph-done',    '0@0,3@2.2',        4.6),
    ('retract-mid',   '5@0,R@2.4',        3.0),
    ('back-to-blob',  '5@0,R@2.4',        4.2),
    ('pending-chain', '1@0,4@0.5,R@1.0',  4.0),
]

ROOT = pathlib.Path(__file__).resolve().parent

def decode(text):
    m = re.search(r'HASH (\w+) (\d+)x(\d+)\s+data:image/png;base64,([A-Za-z0-9+/=]+)', text)
    if not m: return None, None
    img = np.asarray(Image.open(io.BytesIO(base64.b64decode(m.group(4)))).convert('RGB')).astype(int)
    return m.group(1), img

urls = []
for name, script, at in SCENARIOS:
    frag = f'#test={script}&at={at}'
    urls += [f'{BASE}/test/v7-test.html{frag}', f'{BASE}/dev/index.html{frag}']
out = subprocess.run(['node', str(ROOT / 'shoot.mjs'), *urls], capture_output=True, text=True, timeout=1800).stdout
shots = dict(line.split('\t', 1) for line in out.splitlines() if '\t' in line)

fails = 0
for name, script, at in SCENARIOS:
    frag = f'#test={script}&at={at}'
    ha, a = decode(shots.get(f'{BASE}/test/v7-test.html{frag}', ''))
    hb, b = decode(shots.get(f'{BASE}/dev/index.html{frag}', ''))
    if a is None or b is None:
        print(f'FAIL {name}: 没截到画面 (v7={a is not None}, engine={b is not None})'); fails += 1; continue
    if a.shape != b.shape:
        print(f'FAIL {name}: 尺寸不同 {a.shape} vs {b.shape}'); fails += 1; continue
    d = np.abs(a - b).max(axis=2)
    n, mx = int((d > 0).sum()), int(d.max())
    ok = ha == hb
    print(f"{'PASS' if ok else 'FAIL'} {name:14s} 不同像素 {n:8d}  最大差 {mx:3d}")
    if not ok:
        fails += 1
        Image.fromarray(a.astype('uint8')).save(OUT / f'{name}-v7.png')
        Image.fromarray(b.astype('uint8')).save(OUT / f'{name}-engine.png')
        Image.fromarray((np.minimum(d * 8, 255)).astype('uint8')).save(OUT / f'{name}-diff.png')
print(f'\n{len(SCENARIOS) - fails}/{len(SCENARIOS)} 一致' + (f'，差异图在 {OUT}' if fails else ''))
sys.exit(1 if fails else 0)
