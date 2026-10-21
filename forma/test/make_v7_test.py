# 从 reference/v7.html 生成可被测试时钟驱动的副本 test/v7-test.html（reference 本身保持不动）
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
s = (root / 'reference/v7.html').read_text()
def R(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)
R("<script>\n'use strict';", "<script src=\"harness.js\"></script>\n<script>\n'use strict';")
R("function now() { return performance.now() / 1000; }",
  "function now() { return window.__vt !== undefined ? window.__vt : performance.now() / 1000; }")
R("  gl.drawArrays(gl.TRIANGLES, 0, 3);\n  gl.activeTexture(gl.TEXTURE0);\n\n  fpsN++;",
  "  gl.drawArrays(gl.TRIANGLES, 0, 3);\n  gl.activeTexture(gl.TEXTURE0);\n  if (window.__afterDraw) window.__afterDraw(gl, W, H);\n\n  fpsN++;")
R("else setTimeout(() => { if (preset < 0 && mode === 0) show(0); }, 1800);",
  "else if (!location.hash.startsWith('#test')) setTimeout(() => { if (preset < 0 && mode === 0) show(0); }, 1800);\nwindow.__api = { ready: () => !!splat, show, retract };")
(root / 'test/v7-test.html').write_text(s)
print('ok')
