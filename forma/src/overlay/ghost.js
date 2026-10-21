// 落定后叠在卡片上的透明交互层：看到的是液体，选中、复制的是真实文字，按钮和链接可以点击、用 Tab 聚焦。
// 对应 v7 的 10–12、560–571 行。

export class Ghost {
  constructor(container, onAction) {
    this.el = document.createElement('div');
    this.el.className = 'forma-ghost';
    container.appendChild(this.el);
    this.visible = false;
    this.onAction = onAction;
  }

  clear() { this.setVisible(false); this.el.innerHTML = ''; this.el.removeAttribute('role'); this.el.removeAttribute('aria-label'); }

  build(content, card, dpr) {
    const el = this.el;
    el.innerHTML = '';
    Object.assign(el.style, { left: card.x / dpr + 'px', top: card.y / dpr + 'px', width: card.w / dpr + 'px', height: card.h / dpr + 'px' });
    if (content.alt) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', content.alt); }
    else { el.removeAttribute('role'); el.removeAttribute('aria-label'); }
    for (const it of content.runs) {
      const s = document.createElement('span');
      s.textContent = it.t;
      Object.assign(s.style, { font: it.font, left: it.left + 'px', top: it.top + 'px', lineHeight: it.h + 'px', height: it.h + 'px' });
      el.appendChild(s);
      const dw = s.getBoundingClientRect().width;
      if (dw > 0) s.style.transform = `scaleX(${it.w / dw})`;
    }
    for (const r of content.regions) {
      const a = document.createElement(r.href ? 'a' : 'button');
      if (r.href) { a.href = r.href; a.rel = 'noopener noreferrer'; if (r.target) a.target = r.target; }
      else a.type = 'button';
      a.className = 'forma-hit';
      a.setAttribute('aria-label', r.label || r.action || r.href || '');
      Object.assign(a.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', borderRadius: (r.radius ?? 12) + 'px' });
      a.addEventListener('click', ev => this.onAction && this.onAction({ action: r.action || null, href: r.href || null, label: r.label || '', region: r, event: ev, preventDefault: () => ev.preventDefault() }));
      el.appendChild(a);
    }
  }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.el.style.visibility = v ? 'visible' : 'hidden';
  }

  destroy() { this.el.remove(); }
}
