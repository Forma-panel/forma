// Forma 实例：状态机、几何、指针、帧循环。对应 v7 的 518–740 行。
import { createContext, nearestTex, uploadCanvas, FormaError } from '../gl/context.js';
import { Renderer } from '../gl/renderer.js';
import { rasterDraw, rasterImage, loadImage, imageSize } from '../sources/canvas.js';
import { Ghost } from '../overlay/ghost.js';
import { FORM_T, RETURN_T, MORPH_T, UNION_T, UNION_BUDGET, TEXT_DELAY, SETTLE_GAP, CARD_W, CARD_H, CARD_BUDGET, MIN_DROPS, MAX_DROPS, blobRadiusCss } from './look.js';

const CSS = `
.forma-gl{position:absolute;inset:0;width:100%;height:100%;display:block}
.forma-ghost{position:absolute;left:0;top:0;width:0;height:0;z-index:1;visibility:hidden}
.forma-ghost span{position:absolute;color:transparent;white-space:pre;cursor:text;transform-origin:0 0}
.forma-ghost span::selection{background:rgba(64,120,255,.28);color:transparent}
.forma-hit{position:absolute;display:block;box-sizing:border-box;background:transparent;border:0;padding:0;margin:0;cursor:pointer;color:transparent;font-size:0;outline:none}
.forma-hit:focus-visible{box-shadow:0 0 0 2px rgba(64,120,255,.85)}`;
function ensureStyles() {
  if (document.getElementById('forma-styles')) return;
  const s = document.createElement('style'); s.id = 'forma-styles'; s.textContent = CSS;
  document.head.appendChild(s);
}

const defaultClock = () => performance.now() / 1000;

// mode: 0 液团静止 / 1 成形（及已成形）/ -1 收回液团 / 3 页面之间直接变换
export class Forma {
  constructor(container, options = {}) {
    this.container = container;
    this.cardW = options.width || CARD_W;
    this.cardH = options.height || CARD_H;
    this.clock = options.clock || defaultClock;
    this.onAfterRender = options.onAfterRender || null;
    this.onAction = options.onAction || null;
    this._seq = 0;
    this._handlers = {};

    ensureStyles();
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.canvas = document.createElement('canvas'); this.canvas.className = 'forma-gl';
    container.appendChild(this.canvas);
    this.ghost = new Ghost(container, e => this._action(e));
    this.gl = createContext(this.canvas);
    this.renderer = new Renderer(this.gl);

    this.W = 0; this.H = 0; this.DPR = 1; this.N = 1 << 20;
    this.preset = null; this.card = null; this.blob = { x: 0, y: 0, r: 1 }; this.pool = this.blob;
    this.cur = null; this.nxt = null; this.union = null;
    this.cache = new Map(); this.preloaded = new Set();
    this.mode = 0; this.modeStart = 0; this.pending = null; this.pendingRetract = false; this.retFrom = 1e3;
    this.waiters = []; this.state = 'blob';
    this.stats = { fps: 0, drops: this.N, dpr: 1 };
    this._fpsN = 0; this._fpsT = this.clock();
    this.mouse = { x: -1e5, y: -1e5, px: null, py: null, vx: 0, vy: 0, down: 0 };

    this._listen();
    this._observe();
    this.t0 = this.clock();
    this._frame = this._frame.bind(this);
    this._raf = requestAnimationFrame(this._frame);
  }

  // ---------- 公开用法 ----------

  // source：绘制回调 (ctx, w, h) => {}、图片 / 画布 / ImageBitmap，或图片网址。
  // opts：{ width, height（CSS 像素）, fit: 'cover' | 'contain', radius, alt }
  // 液团时成形，已成形时变换；最新的请求有效，被取代的请求 resolve 为 { status: 'superseded' }。
  show(source, opts = {}) {
    const seq = ++this._seq;
    return new Promise((resolve, reject) => {
      this._settle(w => w.kind === 'retract' || w.key !== source, 'superseded');
      const waiter = { kind: 'show', key: source, resolve };
      this.waiters.push(waiter);
      const fail = e => { this.waiters = this.waiters.filter(w => w !== waiter); this._emit('warning', e); reject(e); };
      const go = req => { if (seq === this._seq) { try { this._show(req); } catch (e) { fail(e); } } };
      let req;
      try { req = this._request(source, opts); } catch (e) { fail(e); return; }
      if (req.then) req.then(go, fail); else go(req);
    });
  }

  retract() {
    this._seq++;
    return new Promise(resolve => {
      this._settle(w => w.kind === 'show', 'superseded');
      this.waiters.push({ kind: 'retract', resolve });
      this._retract();
      if (this.mode === 0 && this.pending === null) this._settle(w => w.kind === 'retract', 'blob');
    });
  }

  // 提前把内容画好并传到显卡，切换时不卡
  preload(source, opts = {}) {
    const r = this._request(source, opts);
    const add = req => { this.preloaded.add(req); if (this.W) this._getContent(req); };
    return r.then ? r.then(add) : add(r);
  }

  on(name, fn) { (this._handlers[name] ||= []).push(fn); return () => this.off(name, fn); }
  off(name, fn) { const a = this._handlers[name]; if (a) this._handlers[name] = a.filter(f => f !== fn); }

  destroy() {
    cancelAnimationFrame(this._raf); this._raf = 0;
    this._ro.disconnect();
    for (const [target, type, fn] of this._bound) target.removeEventListener(type, fn);
    this._settle(() => true, 'superseded');
    for (const c of this.cache.values()) this.gl.deleteTexture(c.tex);
    this.cache.clear();
    this.renderer.destroy();
    this.ghost.destroy(); this.canvas.remove();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // ---------- 状态机（v7 原样） ----------

  _now() { return this.clock(); }

  _show(req) {
    this.pendingRetract = false;
    if (this.preset && req.key === this.preset.key && (this.mode === 1 || this.mode === 3)) { this.pending = null; return; }
    if (this.mode === 3 || this.mode === -1) { this.pending = req; return; }
    if (this.mode === 1) {
      if (this._now() - this.modeStart < FORM_T + SETTLE_GAP) { this.pending = req; return; }   // 等这一次成形落定再变
      window.getSelection().removeAllRanges(); this.ghost.setVisible(false);
      const [cw, ch] = this._cardSize(req);
      if (cw === this.card.w && ch === this.card.h) this._morphTo(req);
      else if (!this._morphUnion(req)) { this._retract(); this.pending = req; }   // 液量实在不够时才先收回再成形
      return;
    }
    this.preset = req; this._prepareCard(req); this.mode = 1; this.modeStart = this._now();
  }

  _retract() {
    this.pending = null;
    if (this.mode === 3) { this.pendingRetract = true; return; }
    if (this.mode !== 1) return;
    window.getSelection().removeAllRanges(); this.ghost.setVisible(false);
    this.retFrom = Math.min(this._now() - this.modeStart, 1e3); this.mode = -1; this.modeStart = this._now();
  }

  _morphTo(src) {
    this.nxt = this._getContent(src);
    this.preset = src; this.mode = 3; this.modeStart = this._now();
  }

  // 尺寸不同：卡片外框在液浪中直接变形，多出的液体流回小液团，缺的从小液团流出
  _morphUnion(req) {
    let [cw, ch] = this._cardSize(req, true);
    const A = this.card;
    let B = this._cardRect(cw, ch);
    const U = this._bounds(A, B.card);
    if (U.w * U.h > this.N * UNION_BUDGET) {
      const need = Math.ceil(U.w * U.h / UNION_BUDGET);
      if (need > MAX_DROPS) return false;
      this.N = need;
    }
    this.nxt = this._getContent(req);
    this.union = { A, B: B.card, U, poolA: this.pool, poolB: B.pool };
    this.preset = req; this.mode = 3; this.modeStart = this._now();
    return true;
  }

  _bounds(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }

  _finishMorph() {
    if (this.union) { this.card = this.union.B; this.pool = this.union.poolB; this.union = null; }
    this.cur = this.nxt; this.nxt = null;
    this.ghost.build(this.cur, this.card, this.DPR);
    this.mode = 1; this.modeStart = this._now() - 100;
  }

  _settle(match, status) {
    const keep = [];
    for (const w of this.waiters) (match(w) ? w.resolve({ status }) : keep.push(w));
    this.waiters = keep;
  }

  _emit(name, v) { for (const fn of this._handlers[name] || []) fn(v); }

  _emitState(s) {
    if (s === this.state) return;
    this.state = s;
    this._emit('state', s);
  }

  _action(e) {
    if (this.onAction) this.onAction(e);
    this._emit('action', e);
  }

  // 内容请求：统一成 { key, kind, ... }。图片网址或未解码的图片返回 Promise。
  _request(source, opts) {
    if (typeof source === 'function') return { key: source, kind: 'draw', draw: source, w: opts.width, h: opts.height, alt: opts.alt || '' };
    const make = img => {
      const [iw, ih] = imageSize(img);
      if (!iw || !ih) throw new FormaError('image-size', '图片没有尺寸，请传入 width 和 height');
      return { key: source, kind: 'image', img, iw, ih, w: opts.width, h: opts.height, fit: opts.fit || 'cover', radius: opts.radius ?? 24, alt: opts.alt || '' };
    };
    if (source && (typeof source === 'string' || source instanceof HTMLImageElement)) {
      if (typeof source !== 'string' && source.complete && source.naturalWidth) return make(source);
      return loadImage(source).then(make);
    }
    if (source && (source.width || source.videoWidth)) return make(source);
    throw new FormaError('bad-source', 'show() 只接受绘制函数、图片、画布或图片网址');
  }

  // ---------- 几何 ----------

  _placeBlob() {
    const { W, H, DPR } = this;
    this.blob = { x: W / 2, y: H / 2, r: blobRadiusCss(W, H, DPR) * DPR };
  }

  // 卡片的设备像素尺寸。没写尺寸的绘制回调沿用 v7：宽度受屏幕限制，高度固定。
  // 其他内容按比例缩小到放得进容器；液量不够时，液团处于静止状态才允许加液滴（grow），否则继续缩小。
  _cardSize(req, grow = false) {
    const { W, H, DPR } = this;
    if (req.kind === 'draw' && !req.w && !req.h) {
      const cw = Math.round(Math.min(this.cardW, W / DPR - 32) * DPR); let ch = Math.round(this.cardH * DPR);
      if (cw * ch > this.N * CARD_BUDGET) ch = Math.floor(this.N * CARD_BUDGET / cw);
      return [cw, ch];
    }
    let w = req.w, h = req.h;
    if (req.kind === 'image') {
      if (!w && !h) { w = Math.min(req.iw, this.cardW); h = w * req.ih / req.iw; }
      else if (!h) h = w * req.ih / req.iw;
      else if (!w) w = h * req.iw / req.ih;
    } else { w = w || this.cardW; h = h || this.cardH; }
    const room = blobRadiusCss(W, H, DPR) * .9 + 44;                       // 给剩余的小液团留位置
    let k = Math.min(1, (W / DPR - 32) / w, (H / DPR - 16 - room) / h);
    let px = w * k * DPR * h * k * DPR;
    if (px > this.N * CARD_BUDGET) {
      if (grow) this.N = Math.min(MAX_DROPS, Math.max(this.N, Math.ceil(px / CARD_BUDGET)));
      if (px > this.N * CARD_BUDGET) k *= Math.sqrt(this.N * CARD_BUDGET / px);
    }
    return [Math.max(1, Math.round(w * k * DPR)), Math.max(1, Math.round(h * k * DPR))];
  }

  _getContent(req) {
    const [cw, ch] = this._cardSize(req);
    let c = this.cache.get(req.key);
    if (c && (c.cw !== cw || c.ch !== ch)) { this.gl.deleteTexture(c.tex); c = null; }
    if (!c) {
      const d = req.kind === 'draw' ? rasterDraw(req.draw, cw, ch, this.DPR)
                                    : rasterImage(req.img, cw, ch, { fit: req.fit, radius: req.radius, dpr: this.DPR });
      const tex = nearestTex(this.gl);
      uploadCanvas(this.gl, tex, d.canvas);
      c = { tex, runs: d.runs, regions: d.regions, alt: req.alt, cw, ch };
      this.cache.set(req.key, c);
    }
    return c;
  }

  _prepareCard(req) {
    this.ghost.clear();
    if (req === null) { this.card = null; this.cur = null; this.pool = this.blob; return; }
    const [cw, ch] = this._cardSize(req, this.mode === 0);
    const r = this._cardRect(cw, ch);
    this.pool = r.pool; this.card = r.card;
    this.cur = this._getContent(req);
    this.ghost.build(this.cur, this.card, this.DPR);
  }

  // 卡片放在哪、剩余的小液团放在哪（液量守恒：小液团的体积 = 总液量 - 卡片用掉的）
  _cardRect(cw, ch) {
    const { W, H, DPR, N, blob } = this;
    const frac = cw * ch / N;
    const pr = blob.r * Math.cbrt(1 - frac);
    const gap = 28 * DPR;
    const cx = Math.round(W / 2 - cw / 2);
    const cy = Math.round(Math.max(16 * DPR, (H - ch - gap - 2 * pr) / 2));
    return { card: { x: cx, y: cy, w: cw, h: ch }, pool: { x: W / 2, y: Math.min(cy + ch + gap + pr, H - pr - 8 * DPR), r: pr } };
  }

  // ---------- 尺寸 ----------

  _observe() {
    this._devW = 0; this._devH = 0;
    this._ro = new ResizeObserver(([e]) => {
      const b = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
      this._devW = b ? b.inlineSize : Math.round(e.contentRect.width * devicePixelRatio);
      this._devH = b ? b.blockSize : Math.round(e.contentRect.height * devicePixelRatio);
      this._resize();
    });
    try { this._ro.observe(this.canvas, { box: 'device-pixel-content-box' }); } catch (_) { this._ro.observe(this.canvas); }
  }

  _resize() {
    if (!this._devW) return;
    const W = this.W = this._devW, H = this.H = this._devH;
    this.canvas.width = W; this.canvas.height = H;
    const DPR = this.DPR = W / Math.max(this.canvas.clientWidth, 1);   // 画布像素正好等于屏幕物理像素，不被浏览器二次缩放
    const cardPx = Math.round(Math.min(this.cardW, W / DPR - 32) * DPR) * Math.round(this.cardH * DPR);
    this.N = Math.max(MIN_DROPS, Math.ceil(cardPx / CARD_BUDGET));
    this.renderer.resize(W, H);
    this._placeBlob();
    for (const c of this.cache.values()) this.gl.deleteTexture(c.tex);
    this.cache.clear();
    for (const s of this.preloaded) this._getContent(s);
    if (this.mode === 3) { this.mode = 1; this.modeStart = this._now() - 100; this.nxt = null; this.union = null; }
    this._prepareCard(this.mode !== 0 ? this.preset : null);
    if (this.mode === 0) this.preset = null;
  }

  // ---------- 指针 ----------

  _listen() {
    const m = this.mouse;
    const bind = (target, type, fn) => { target.addEventListener(type, fn); this._bound.push([target, type, fn]); };
    this._bound = [];
    bind(window, 'pointermove', ev => {
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (x < 0 || y < 0 || x > r.width || y > r.height) { m.x = m.y = -1e5; m.px = null; }   // 指针离开这块面板
      else { m.x = x * this.DPR; m.y = y * this.DPR; }
      m.down = (ev.buttons & 1) ? 1 : 0;
    });
    bind(window, 'pointerdown', ev => { if (ev.button === 0) m.down = 1; });
    for (const t of ['pointerup', 'pointercancel', 'blur', 'contextmenu']) bind(window, t, () => { m.down = 0; });
    bind(document.documentElement, 'pointerleave', () => { m.x = m.y = -1e5; m.px = null; });
  }

  // ---------- 帧 ----------

  _frame() {
    if (!this.renderer.ready) { this._raf = requestAnimationFrame(this._frame); return; }
    const t = this._now(), time = t - this.t0;
    if (this.mode === -1 && t - this.modeStart > RETURN_T) {
      this.mode = 0; this.preset = null; this._prepareCard(null);
      if (this.pending !== null) { const p = this.pending; this.pending = null; this._show(p); }
    }
    if (this.mode === 3 && t - this.modeStart > (this.union ? UNION_T : MORPH_T)) {
      this._finishMorph();
      if (this.pendingRetract) { this.pendingRetract = false; this._retract(); }
    }
    if (this.mode === 1 && this.pending !== null && t - this.modeStart > FORM_T + SETTLE_GAP) { const p = this.pending; this.pending = null; this._show(p); }
    const uT = t - this.modeStart, mode = this.mode;
    const shown = mode === 1 && uT > FORM_T + TEXT_DELAY;
    this.ghost.setVisible(shown);

    this._emitState(mode === 0 ? 'blob' : mode === -1 ? 'retracting' : mode === 3 ? 'morphing' : shown ? 'shown' : 'forming');
    if (shown) this._settle(w => w.kind === 'show' && this.preset && w.key === this.preset.key, 'shown');
    if (mode === 0 && this.pending === null) this._settle(w => w.kind === 'retract', 'blob');

    let move = 0;
    if (mode === 1) move = Math.max(0, 1 - Math.abs(uT - .75) / .9);
    if (mode === 3) move = .6 * Math.max(0, 1 - Math.abs(uT - .7) / .8);
    if (mode === -1) move = Math.max(0, 1 - Math.abs(uT - .7) / .8);
    const sweep = mode === 1 ? -0.4 + (uT - FORM_T + .1) * 1.8 : -9;

    const m = this.mouse, DPR = this.DPR;
    if (m.px !== null && m.x > -1e4) {
      m.vx = m.vx * .7 + (m.x - m.px) * .3; m.vy = m.vy * .7 + (m.y - m.py) * .3;
    } else { m.vx *= .7; m.vy *= .7; }
    const vl = Math.hypot(m.vx, m.vy), vmax = 40 * DPR;
    if (vl > vmax) { m.vx *= vmax / vl; m.vy *= vmax / vl; }
    m.px = m.x > -1e4 ? m.x : null; m.py = m.y;

    const un = this.union;
    let pool = this.pool;
    if (un) {                                     // 小液团在变换过程中平滑地挪到新位置、变成新大小
      // 卡片变高时小液团要先让开，变矮时等卡片收上去再跟上，避免小液团压在卡片上
      const k = Math.min(1, Math.max(0, uT / UNION_T)), ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const ey = un.poolB.y > un.poolA.y ? ss(0, .22, k) : ss(.45, .9, k), er = ss(0, 1, k);
      pool = { x: un.poolA.x + (un.poolB.x - un.poolA.x) * ey, y: un.poolA.y + (un.poolB.y - un.poolA.y) * ey, r: un.poolA.r + (un.poolB.r - un.poolA.r) * er };
    }
    this.renderer.render({
      W: this.W, H: this.H, DPR, N: this.N, cur: this.cur, nxt: this.nxt, card: un ? un.U : this.card,
      blob: this.blob, pool, mouse: m, uT, mode, time, retFrom: this.retFrom, sweep, move, union: un,
    });
    if (this.onAfterRender) this.onAfterRender(this.gl, this.W, this.H, time);

    this._fpsN++;
    if (t - this._fpsT > .5) {
      this.stats = { fps: Math.round(this._fpsN / (t - this._fpsT)), drops: this.N, dpr: DPR };
      this._fpsN = 0; this._fpsT = t;
    }
    this._raf = requestAnimationFrame(this._frame);
  }
}
