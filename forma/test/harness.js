// 黄金帧测试用的虚拟时钟与截帧。网址带 #test=动作@秒,...&at=秒 时启用，例如 #test=0@0,3@2.2,R@5&at=3
// 动作：数字 = 显示第几张画面，R = 收回。时间每帧前进 1/60 秒，在 at 时刻截下这一帧的像素。
// 两个实现（reference/v7 与新引擎）都先加载本脚本，再启动自己的帧循环，保证每帧的执行顺序一致。
(function () {
  const m = /#test=([^&]*)&at=([\d.]+)/.exec(location.hash);
  if (!m) return;
  window.__vt = 0;
  const cmds = m[1].split(',').filter(Boolean).map(c => { const [a, t] = c.split('@'); return { a, t: +t, done: false }; });
  const at = +m[2];
  let started = false, captured = false;

  window.__afterDraw = (gl, W, H) => {
    if (!started || captured || window.__vt < at) return;
    captured = true;
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let h = 0x811c9dc5 >>> 0; const u = new Uint32Array(px.buffer);
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
    const pre = document.createElement('pre'); pre.id = 'shot';
    pre.textContent = `HASH ${h.toString(16)} ${W}x${H}\n${c.toDataURL('image/png')}`;
    document.body.appendChild(pre);
  };

  function tick() {
    if (!started) {
      if (window.__api && window.__api.ready()) started = true;
      requestAnimationFrame(tick); return;
    }
    window.__vt += 1 / 60;
    for (const c of cmds) if (!c.done && window.__vt >= c.t) { c.done = true; c.a === 'R' ? window.__api.retract() : window.__api.show(+c.a); }
    if (!captured) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
