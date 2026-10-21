// 内容来源 → 内容画布（一个画布像素 = 一滴液体）+ 文字位置 + 可点击区域。
import { FormaError } from '../gl/context.js';

// 绘制回调。对应 v7 的 527–540 行（drawContent），另加 ctx.region 记录可点击区域。
export function rasterDraw(draw, cw, ch, dpr) {
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  const runs = [], regions = [];
  const fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (t, x, y) => {                      // 记下每一行字的位置，用来做可选中的文字层
    const m = ctx.measureText(t);
    const left = ctx.textAlign === 'right' ? x - m.width : ctx.textAlign === 'center' ? x - m.width / 2 : x;
    runs.push({ t, left, top: y - m.fontBoundingBoxAscent, h: m.fontBoundingBoxAscent + m.fontBoundingBoxDescent, w: m.width, font: ctx.font });
    fillText(t, x, y);
  };
  ctx.region = (x, y, w, h, meta = {}) => { regions.push({ x, y, w, h, ...meta }); };
  draw(ctx, cw / dpr, ch / dpr);
  return { canvas: c, runs, regions };
}

export function imageSize(img) {
  return [img.naturalWidth || img.videoWidth || img.width || 0, img.naturalHeight || img.videoHeight || img.height || 0];
}

// 图片、画布、ImageBitmap、视频当前帧。fit：cover 铺满裁切 / contain 完整放入（空白处没有液体）
export function rasterImage(img, cw, ch, { fit = 'cover', radius = 24, dpr = 1 } = {}) {
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  const [iw, ih] = imageSize(img);
  const s = fit === 'contain' ? Math.min(cw / iw, ch / ih) : Math.max(cw / iw, ch / ih);
  const dw = iw * s, dh = ih * s;
  ctx.save();
  if (radius > 0) { ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, radius * dpr); ctx.clip(); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  ctx.restore();
  try { ctx.getImageData(0, 0, 1, 1); } catch (_) {
    throw new FormaError('tainted', '图片来自其他网站且没有开启跨域访问（CORS），无法读取像素。请给图片加 crossorigin="anonymous"，并确认服务器允许跨域。');
  }
  return { canvas: c, runs: [], regions: [] };
}

// 网址 → 解码好的图片
export async function loadImage(src) {
  if (typeof src === 'string') {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src;
    try { await img.decode(); } catch (_) { throw new FormaError('image-load', `图片加载失败：${src}`); }
    return img;
  }
  if (src instanceof HTMLImageElement && !(src.complete && src.naturalWidth)) {
    if (src.loading === 'lazy') src.loading = 'eager';
    try { await src.decode(); } catch (_) { throw new FormaError('image-load', '图片加载失败'); }
  }
  return src;
}
