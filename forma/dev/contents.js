// v7 的 6 张示例画面（绘制回调），逐字搬运自 reference/v7.html。
const FONT = '-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif';
const INK = '#141821', SUB = '#5d6677', FAINT = '#8a93a3';
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function cardBg(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#eef1f5');
  rr(ctx, 0, 0, w, h, 24); ctx.fillStyle = g; ctx.fill();
}
function wrap(ctx, text, x, y, maxW, lh) {
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW) { ctx.fillText(line, x, y); y += lh; line = ch; } else line += ch;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lh;
}
export const CONTENTS = [
  function weather(ctx, w, h) {
    cardBg(ctx, w, h);
    const ph = h * .5;
    ctx.save(); rr(ctx, 16, 16, w - 32, ph, 16); ctx.clip();
    const sky = ctx.createLinearGradient(0, 16, 0, 16 + ph);
    sky.addColorStop(0, '#2b1055'); sky.addColorStop(.55, '#d53369'); sky.addColorStop(1, '#ff9a44');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    const sx = w * .68, sy = 16 + ph * .55;
    const glow = ctx.createRadialGradient(sx, sy, 10, sx, sy, 120); glow.addColorStop(0, 'rgba(255,224,138,.85)'); glow.addColorStop(1, 'rgba(255,224,138,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.arc(sx, sy, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a1f5c'; ctx.beginPath(); ctx.moveTo(0, 16 + ph);
    for (let x = 0; x <= w; x += 40) ctx.lineTo(x, 16 + ph * (.66 + .16 * Math.sin(x * .013) + .07 * Math.sin(x * .041)));
    ctx.lineTo(w, 16 + ph); ctx.fill();
    ctx.fillStyle = '#1c0e2b'; ctx.beginPath(); ctx.moveTo(0, 16 + ph);
    for (let x = 0; x <= w; x += 30) ctx.lineTo(x, 16 + ph * (.82 + .09 * Math.sin(x * .02 + 2) + .05 * Math.sin(x * .07)));
    ctx.lineTo(w, 16 + ph); ctx.fill();
    ctx.restore();
    const y0 = 16 + ph;
    ctx.fillStyle = INK; ctx.font = `600 30px ${FONT}`; ctx.fillText('上海 · 晴', 28, y0 + 56);
    ctx.fillStyle = SUB; ctx.font = `15px ${FONT}`; ctx.fillText('体感 28°   湿度 62%   东南风 3 级', 28, y0 + 88);
    const tg = ctx.createLinearGradient(w - 160, 0, w - 24, 0); tg.addColorStop(0, '#f5a524'); tg.addColorStop(1, '#ef4f1a');
    ctx.fillStyle = tg; ctx.font = `600 68px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText('26°', w - 28, y0 + 86); ctx.textAlign = 'left';
    const days = ['周五', '周六', '周日', '周一', '周二'], temps = ['27°', '25°', '22°', '24°', '28°'], dots = ['#f59e0b', '#38bdf8', '#3b6cf6', '#60a5fa', '#f59e0b'];
    const cw = (w - 56) / 5;
    for (let i = 0; i < 5; i++) {
      const x = 28 + i * cw;
      ctx.fillStyle = FAINT; ctx.font = `14px ${FONT}`; ctx.fillText(days[i], x, h - 30);
      ctx.fillStyle = dots[i]; ctx.beginPath(); ctx.arc(x + 46, h - 35, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = INK; ctx.fillText(temps[i], x + 60, h - 30);
    }
  },
  function dashboard(ctx, w, h) {
    cardBg(ctx, w, h);
    ctx.fillStyle = INK; ctx.font = `600 24px ${FONT}`; ctx.fillText('本周运营概览', 28, 50);
    ctx.fillStyle = FAINT; ctx.font = `14px ${FONT}`; ctx.fillText('10月9日 – 10月15日', 28, 76);
    const kpi = [['访问量', '12.8万', '#0891b2'], ['转化率', '64.2%', '#7c3aed'], ['环比', '+18%', '#059669']];
    kpi.forEach(([l, v, c], i) => {
      const x = 28 + i * (w - 56) / 3;
      ctx.fillStyle = SUB; ctx.font = `14px ${FONT}`; ctx.fillText(l, x, 116);
      ctx.fillStyle = c; ctx.font = `600 34px ${FONT}`; ctx.fillText(v, x, 156);
    });
    const vals = [.42, .58, .5, .74, .66, .9, .81], bx = 28, by = h - 40, bw = (w - 56) / 7, bh = h - 230;
    ctx.strokeStyle = '#d9dee6'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(bx, by - i * bh / 3 + .5); ctx.lineTo(w - 28, by - i * bh / 3 + .5); ctx.stroke(); }
    vals.forEach((v, i) => {
      const x = bx + i * bw + bw * .2, hh = v * bh;
      const g = ctx.createLinearGradient(0, by - hh, 0, by); g.addColorStop(0, '#22d3ee'); g.addColorStop(1, '#6366f1');
      rr(ctx, x, by - hh, bw * .6, hh, 6); ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = FAINT; ctx.font = `12px ${FONT}`; ctx.fillText('一二三四五六日'[i], x + bw * .3 - 6, by + 22);
    });
  },
  function article(ctx, w, h) {
    cardBg(ctx, w, h);
    ctx.fillStyle = '#f0581f'; rr(ctx, 28, 30, 4, 34, 2); ctx.fill();
    ctx.fillStyle = INK; ctx.font = `600 26px ${FONT}`; ctx.fillText('液体为什么能记住形状', 44, 58);
    ctx.fillStyle = FAINT; ctx.font = `13px ${FONT}`; ctx.fillText('Forma 实验笔记 · 第 3 篇', 44, 86);
    ctx.fillStyle = '#323a49'; ctx.font = `16px ${FONT}`;
    let y = wrap(ctx, '在这块面板里，没有“先画好再显示”的图片。你看到的每一个字、每一道颜色，都是同一份液体流过去之后停下来的样子。', 28, 128, w - 56, 28);
    y = wrap(ctx, '液体总量是固定的：画面用得越多，液团就越小，剩下的液体会聚成一个小液团，等待下一次成形。', 28, y + 10, w - 56, 28);
    ctx.fillStyle = '#e0531c'; ctx.font = `600 16px ${FONT}`; ctx.fillText('试试用鼠标划过画面，或者按住拖动选中这段文字。', 28, y + 16);
  },
  function music(ctx, w, h) {
    cardBg(ctx, w, h);
    const s = 150;
    ctx.save(); rr(ctx, 28, 28, s, s, 18); ctx.clip();
    const g = ctx.createLinearGradient(28, 28, 28 + s, 28 + s); g.addColorStop(0, '#ff5f6d'); g.addColorStop(1, '#ffc371');
    ctx.fillStyle = g; ctx.fillRect(28, 28, s, s);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(28 + s * .7, 28 + s * .35, 38, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(80,20,60,.35)'; ctx.beginPath(); ctx.arc(28 + s * .3, 28 + s * .8, 55, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = INK; ctx.font = `600 28px ${FONT}`; ctx.fillText('夜航', 204, 72);
    ctx.fillStyle = SUB; ctx.font = `15px ${FONT}`; ctx.fillText('Forma Radio · 第 12 期', 204, 100);
    ctx.fillStyle = FAINT; ctx.font = `14px ${FONT}`; ctx.fillText('正在播放 · 液态电台', 204, 128);
    const by = 214, bx = 28, bw = w - 56;
    rr(ctx, bx, by, bw, 6, 3); ctx.fillStyle = '#dfe3ea'; ctx.fill();
    const pg = ctx.createLinearGradient(bx, 0, bx + bw * .6, 0); pg.addColorStop(0, '#ff5f6d'); pg.addColorStop(1, '#ffc371');
    rr(ctx, bx, by, bw * .6, 6, 3); ctx.fillStyle = pg; ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bx + bw * .6, by + 3, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ff7a5c'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = FAINT; ctx.font = `13px ${FONT}`; ctx.fillText('2:41', bx, by + 30);
    ctx.textAlign = 'right'; ctx.fillText('4:30', bx + bw, by + 30); ctx.textAlign = 'left';
    const cy = 300, cx = w / 2;
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 9, cy - 11, 6, 22); ctx.fillRect(cx + 3, cy - 11, 6, 22);
    ctx.region?.(cx - 30, cy - 30, 60, 60, { action: 'pause', label: '暂停', radius: 30 });
    ctx.fillStyle = SUB;
    for (const side of [-1, 1]) {
      const x = cx + side * 90, d = -side;          // 左边“上一首”朝左，右边“下一首”朝右
      ctx.beginPath(); ctx.moveTo(x + d * 10, cy - 10); ctx.lineTo(x + d * 10, cy + 10); ctx.lineTo(x - d * 4, cy); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, cy - 10); ctx.lineTo(x, cy + 10); ctx.lineTo(x - d * 14, cy); ctx.fill();
    }
  },
  function stock(ctx, w, h) {
    cardBg(ctx, w, h);
    ctx.fillStyle = SUB; ctx.font = `15px ${FONT}`; ctx.fillText('Forma 液态指数', 28, 44);
    ctx.fillStyle = INK; ctx.font = `600 42px ${FONT}`; ctx.fillText('3,842.17', 28, 96);
    ctx.fillStyle = '#059669'; ctx.font = `600 18px ${FONT}`; ctx.fillText('▲ +88.62   +2.36%', 230, 94);
    const x0 = 28, x1 = w - 28, y0 = 130, y1 = h - 54, n = 120, pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const v = .55 - .35 * t + .08 * Math.sin(t * 17) + .05 * Math.sin(t * 41 + 1) + .03 * Math.sin(t * 89);
      pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * v]);
    }
    ctx.strokeStyle = '#e3e7ee'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { const y = y0 + (y1 - y0) * i / 3 + .5; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
    const fg = ctx.createLinearGradient(0, y0, 0, y1); fg.addColorStop(0, 'rgba(16,185,129,.28)'); fg.addColorStop(1, 'rgba(16,185,129,0)');
    ctx.beginPath(); ctx.moveTo(pts[0][0], y1); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(x1, y1); ctx.fillStyle = fg; ctx.fill();
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2.5; ctx.stroke();
    const [lx, ly] = pts[n]; ctx.fillStyle = '#10b981'; ctx.beginPath(); ctx.arc(lx, ly, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = FAINT; ctx.font = `12px ${FONT}`;
    ['9:30', '10:30', '11:30', '13:30', '14:30', '15:00'].forEach((l, i) => ctx.fillText(l, x0 + (x1 - x0 - 30) * i / 5, h - 28));
  },
  function poster(ctx, w, h) {
    ctx.save(); rr(ctx, 0, 0, w, h, 24); ctx.clip();
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1e1b4b'); g.addColorStop(.5, '#6d28d9'); g.addColorStop(1, '#f472b6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    [[.8, .25, 90, 'rgba(255,255,255,.12)'], [.15, .85, 120, 'rgba(255,255,255,.08)'], [.65, .8, 50, 'rgba(255,200,240,.25)']].forEach(([x, y, r, c]) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(w * x, h * y, r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = `600 14px ${FONT}`; ctx.fillText('FORMA LIVE', 32, 52);
    ctx.fillStyle = '#ffffff'; ctx.font = `700 52px ${FONT}`; ctx.fillText('今晚 20:00', 32, 132);
    ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.font = `20px ${FONT}`; ctx.fillText('液态界面发布会 · 线上直播', 32, 174);
    rr(ctx, 32, h - 92, 148, 46, 23); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.fillStyle = '#4c1d95'; ctx.font = `600 17px ${FONT}`; ctx.fillText('预约提醒', 72, h - 62);
    ctx.region?.(32, h - 92, 148, 46, { action: 'remind', label: '预约提醒', radius: 23 });
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `14px ${FONT}`; ctx.fillText('已有 12,408 人预约', 200, h - 62);
  },
];
