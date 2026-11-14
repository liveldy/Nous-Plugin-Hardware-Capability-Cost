/* 能力与成本 · 硬件 — 视图渲染、图表（缩放/全屏/智能标注）与快照导入。MIT。 */
(function () {
  'use strict';

  const host = window.NousPlugin || null;
  const num = new Intl.NumberFormat('zh-CN');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fScore = (n) => num.format(Math.round(n));
  const fPrice = (n) => '$' + num.format(Math.round(n));
  const fValue = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const shortDate = (iso) => {
    const d = new Date(iso || Date.now());
    return isNaN(d) ? '' : d.toISOString().slice(0, 10).replace(/-/g, '.');
  };
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TITLES = { cpu: 'CPU', gpu: 'GPU' };
  const SORTS = { score: '能力', price: '价格', value: '性价比' };
  const MAX_POINTS = 100;

  const state = {
    view: 'cpu',
    sort: 'score',
    data: null,
    prepared: null,
    domain: null,
    rect: null,
    timer: 0,
    frame: 0,
    faux: false
  };
  const els = {
    main: $('main'),
    title: $('#title'),
    metric: $('#metric'),
    count: $('#count'),
    plot: $('#plot'),
    chart: $('#chart'),
    tip: $('#tip'),
    rows: $('#rows'),
    caption: $('#caption'),
    specHead: $('#spec-head'),
    snapLine: $('#snap-line'),
    status: $('#status'),
    tools: $('.plot__tools'),
    full: $('.tool[data-act="full"]'),
    reset: $('.tool[data-act="reset"]')
  };

  /* ---- snapshot ---------------------------------------------------- */

  function snapshot() {
    return state.data || window.HARDWARE_SNAPSHOT || null;
  }

  function prepare(view) {
    const snap = snapshot();
    const data = snap && snap[view];
    if (!data || !Array.isArray(data.items) || !data.items.length) return null;
    const seen = new Set();
    const items = data.items
      .filter((item) => item && Number(item.score) > 0 && Number(item.price) > 0)
      .map((item) => ({
        id: String(item.id || item.name),
        name: String(item.name || ''),
        spec: String(item.spec || ''),
        score: Number(item.score),
        price: Number(item.price)
      }))
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .map((item) => Object.assign(item, { value: item.score / item.price }));
    if (!items.length) return null;
    const chart = items.slice().sort((a, b) => b.score - a.score).slice(0, MAX_POINTS);
    const prices = chart.map((item) => item.price);
    const scores = chart.map((item) => item.score);
    return {
      metric: String(data.metric || ''),
      spec: String(data.spec || ''),
      generatedAt: snap.generatedAt || '',
      items: items,
      chart: chart,
      maxValue: Math.max.apply(null, items.map((item) => item.value)),
      // 价格横轴用对数刻度：价格从几十到上万美元，线性刻度会把多数型号挤在左端
      domain: {
        x0: Math.log10(Math.min.apply(null, prices) * 0.9),
        x1: Math.log10(Math.max.apply(null, prices) * 1.06),
        y0: 0,
        y1: Math.max.apply(null, scores) * 1.05
      }
    };
  }

  function validate(snap) {
    if (!snap || typeof snap !== 'object') throw new Error('不是快照文件');
    ['cpu', 'gpu'].forEach((key) => {
      const part = snap[key];
      if (!part || !Array.isArray(part.items) || !part.items.length) throw new Error('缺少 ' + key.toUpperCase() + ' 数据');
      part.items.forEach((item) => {
        if (!item || !item.name || !(Number(item.score) > 0) || !(Number(item.price) > 0)) {
          throw new Error(key.toUpperCase() + ' 有条目缺名称、能力或价格');
        }
      });
    });
    return snap;
  }

  function save(snap) {
    if (!host || !host.request) return;
    host.request('storage.set', { key: 'snapshot', value: snap }).catch(() => {});
  }

  /* ---- render ------------------------------------------------------ */

  function render() {
    const view = prepare(state.view);
    if (!view) return;
    state.prepared = view;
    state.domain = view.domain;
    state.rect = Object.assign({}, view.domain);
    document.documentElement.dataset.view = state.view;

    els.title.textContent = TITLES[state.view];
    els.metric.textContent = view.metric;
    els.count.textContent = view.items.length + ' 款';
    els.specHead.textContent = view.spec;
    els.snapLine.textContent = '快照 ' + shortDate(view.generatedAt) + ' · 每日刷新';
    els.chart.setAttribute(
      'aria-label',
      TITLES[state.view] + ' 能力最高的 ' + view.chart.length + ' 款（共 ' + view.items.length + ' 款）的价格与能力分布，横轴价格（美元，对数刻度），纵轴' + view.metric + '。数值见下方排行。'
    );

    renderRows();
    draw();
    syncTools();

    els.main.classList.remove('in');
    void els.main.offsetWidth;
    els.main.classList.add('in');
  }

  function renderRows() {
    const view = state.prepared;
    if (!view) return;
    const order = {
      score: (a, b) => b.score - a.score,
      price: (a, b) => a.price - b.price,
      value: (a, b) => b.value - a.value
    }[state.sort];
    const list = view.items.slice().sort(order);

    els.rows.innerHTML = list
      .map((item, i) => {
        const width = Math.max(2, (item.value / view.maxValue) * 100).toFixed(1);
        return (
          '<tr data-id="' + esc(item.id) + '">' +
          '<td class="c-rank">' + (i + 1) + '</td>' +
          '<td class="c-name">' + esc(item.name) + '</td>' +
          '<td class="c-spec">' + esc(item.spec) + '</td>' +
          '<td class="c-num">' + fScore(item.score) + '</td>' +
          '<td class="c-num">' + fPrice(item.price) + '</td>' +
          '<td class="c-val"><span class="cell"><span>' + fValue(item.value) + '</span>' +
          '<span class="bar" aria-hidden="true"><i style="--w:' + width + '%"></i></span></span></td>' +
          '</tr>'
        );
      })
      .join('');

    els.caption.textContent = TITLES[state.view] + ' 全部 ' + view.items.length + ' 款，按' + SORTS[state.sort] + '排序';
  }

  /* ---- scales ------------------------------------------------------ */

  const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9];
  const Y_STEPS = [200, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];

  function scale(w, h) {
    const m = { t: w < 560 ? 58 : 48, r: w < 560 ? 8 : 14, b: 30, l: w < 560 ? 50 : 70 };
    const iw = Math.max(40, w - m.l - m.r);
    const ih = Math.max(40, h - m.t - m.b);
    const r = state.rect || state.domain;
    const X = (p) => m.l + ((Math.log10(p) - r.x0) / (r.x1 - r.x0)) * iw;
    const Y = (s) => m.t + ih - ((s - r.y0) / (r.y1 - r.y0)) * ih;
    // 横轴在对数空间里，缩放、平移、读数都统一用对数
    const px2x = (px) => r.x0 + ((px - m.l) / iw) * (r.x1 - r.x0);
    const py2y = (py) => r.y0 + ((m.t + ih - py) / ih) * (r.y1 - r.y0);
    return { m, iw, ih, r, X, Y, px2x, py2y };
  }

  // 对数刻度：先取 1、2、5 这类整数档，过密就按像素间距丢掉中间的
  function logTicks(lo, hi, iw) {
    const cand = [];
    for (let e = 0; e <= 6; e += 1) {
      NICE.forEach((m) => {
        const t = m * Math.pow(10, e);
        if (t >= lo && t <= hi) cand.push({ t: t, m: m });
      });
    }
    const span = Math.log10(hi) - Math.log10(lo) || 1;
    const px = (t) => ((Math.log10(t) - Math.log10(lo)) / span) * iw;
    const main = cand.filter((c) => c.m === 1 || c.m === 2 || c.m === 5);
    const pick = (main.length >= 3 ? main : cand).map((c) => c.t);
    const ticks = [];
    pick.forEach((t) => {
      if (!ticks.length || px(t) - px(ticks[ticks.length - 1]) >= 56) ticks.push(t);
    });
    if (ticks.length < 2) return [lo, hi];
    return ticks.filter((t) => px(t) <= iw + 1);
  }

  /* ---- labels ------------------------------------------------------ */

  let labelCtx = null;
  function measure(text) {
    if (!labelCtx) {
      const canvas = document.createElement('canvas');
      labelCtx = canvas.getContext('2d');
      labelCtx.font = '500 13px "Archivo","Microsoft YaHei","PingFang SC",sans-serif';
    }
    return labelCtx.measureText(text).width;
  }

  // 名称过长时保留开头和型号后缀，中间省略，免得两个截断名看起来一样
  function fit(text, max) {
    if (measure(text) <= max) return text;
    const chars = Array.from(text);
    for (let keep = chars.length - 2; keep > 6; keep -= 1) {
      const head = Math.ceil(keep * 0.6);
      const tail = keep - head;
      const cut = chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('');
      if (measure(cut) <= max) return cut;
    }
    return text;
  }

  function bump(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // 点的疏密决定能显示多少：按能力从高到低逐个找位置，放不下就不放
  function placeLabels(points, sc, w, limit) {
    const boxes = [];
    const labels = [];
    const dots = points.map((p) => ({ x: sc.X(p.price), y: sc.Y(p.score) }));
    const m = sc.m;
    const top = m.t;
    const bottom = m.t + sc.ih;
    for (let i = 0; i < points.length && labels.length < limit; i += 1) {
      const p = points[i];
      const px = sc.X(p.price);
      const py = sc.Y(p.score);
      // 只给真正落在画布里的点加标签，缩放后越界的点不留悬空文字
      if (px < m.l || px > w - m.r || py < top || py > bottom) continue;
      const text = fit(p.name, Math.max(120, Math.round(sc.iw * 0.5)));
      const tw = measure(text);
      const spots = [
        [px + 9, py + 4.5],
        [px - 9 - tw, py + 4.5],
        [px - tw / 2, py - 10],
        [px - tw / 2, py + 18],
        [px + 7, py - 7],
        [px - 7 - tw, py + 16]
      ];
      for (let s = 0; s < spots.length; s += 1) {
        const x = spots[s][0];
        const y = spots[s][1];
        const box = { x: x - 2, y: y - 13, w: tw + 4, h: 17 };
        if (box.x < m.l - 2 || box.x + box.w > w - m.r + 2 || box.y < top || box.y + box.h > bottom) continue;
        let bad = false;
        for (let b = 0; b < boxes.length; b += 1) if (bump(box, boxes[b])) { bad = true; break; }
        if (bad) continue;
        for (let d = 0; d < dots.length; d += 1) {
          const cx = dots[d].x;
          const cy = dots[d].y;
          if (cx > box.x - 4 && cx < box.x + box.w + 4 && cy > box.y - 4 && cy < box.y + box.h + 4) { bad = true; break; }
        }
        if (bad) continue;
        boxes.push(box);
        labels.push({ x: x, y: y, text: text });
        break;
      }
    }
    return labels;
  }

  /* ---- chart ------------------------------------------------------- */

  function draw() {
    const view = state.prepared;
    if (!view) return;
    const svg = els.chart;
    const box = svg.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (w < 60 || h < 60) return;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

    const sc = scale(w, h);
    const m = sc.m;
    const iw = sc.iw;
    const ih = sc.ih;
    const X = sc.X;
    const Y = sc.Y;

    const xTicks = logTicks(Math.pow(10, sc.r.x0), Math.pow(10, sc.r.x1), iw);

    const ySpan = sc.r.y1 - sc.r.y0;
    const yStep = Y_STEPS.find((s) => ySpan / s <= 6.5) || 50000;
    const yTicks = [];
    for (let t = Math.ceil(sc.r.y0 / yStep) * yStep; t <= sc.r.y1; t += yStep) yTicks.push(t);

    const parts = [];
    parts.push('<defs><clipPath id="plot-clip"><rect x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '"/></clipPath></defs>');
    parts.push('<rect class="plot-bg" x="0" y="' + m.t + '" width="' + w + '" height="' + ih + '"/>');
    parts.push('<g class="grid">' + yTicks.map((t) => '<line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '"/>').join('') + '</g>');
    parts.push('<g class="axis"><line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + (m.t + ih) + '" y2="' + (m.t + ih) + '"/></g>');
    parts.push(yTicks.map((t) => '<text x="' + (m.l - 10) + '" y="' + (Y(t) + 4).toFixed(1) + '" text-anchor="end">' + fScore(t) + '</text>').join(''));
    parts.push(
      '<g class="tick">' +
        xTicks
          .map((t) => '<line x1="' + X(t).toFixed(1) + '" x2="' + X(t).toFixed(1) + '" y1="' + (m.t + ih) + '" y2="' + (m.t + ih + 5) + '"/><text x="' + X(t).toFixed(1) + '" y="' + (m.t + ih + 20) + '" text-anchor="middle">' + fPrice(t) + '</text>')
          .join('') +
        '</g>'
    );
    parts.push('<text class="axis-name" x="' + m.l + '" y="' + (m.t - 12) + '">能力</text>');
    parts.push('<text class="axis-name" x="' + (w - m.r) + '" y="' + (m.t + ih - 8) + '" text-anchor="end">价格 · 美元 · 对数</text>');

    // 能力前沿：每一档价格能买到的最强型号
    const byPrice = view.chart.slice().sort((a, b) => a.price - b.price);
    let d = '';
    let peak = -1;
    byPrice.forEach((item) => {
      if (item.score <= peak) return;
      d += d
        ? 'H' + X(item.price).toFixed(1) + 'V' + Y(item.score).toFixed(1)
        : 'M' + X(item.price).toFixed(1) + ',' + Y(item.score).toFixed(1);
      peak = item.score;
    });

    const best = view.chart.reduce((a, b) => (b.value > a.value ? b : a));
    const dots = byPrice
      .map((item, i) => '<circle class="dot" data-id="' + esc(item.id) + '" cx="' + X(item.price).toFixed(1) + '" cy="' + Y(item.score).toFixed(1) + '" r="4.6" style="--i:' + i + '"/>')
      .join('');

    parts.push('<g clip-path="url(#plot-clip)">');
    parts.push('<path class="front" d="' + d + '"/>');
    parts.push(dots);
    parts.push('<circle class="ring" cx="' + X(best.price).toFixed(1) + '" cy="' + Y(best.score).toFixed(1) + '" r="8.6"/>');
    parts.push('</g>');

    const labels = placeLabels(view.chart, sc, w, w < 560 ? 8 : 40);
    parts.push('<g class="dot-labels">' + labels.map((l) => '<text x="' + l.x.toFixed(1) + '" y="' + l.y.toFixed(1) + '">' + esc(l.text) + '</text>').join('') + '</g>');

    svg.innerHTML = parts.join('');

    const front = svg.querySelector('.front');
    if (front && !calm() && state.zoomPulse !== false) {
      const len = front.getTotalLength();
      front.style.strokeDasharray = len;
      front.style.strokeDashoffset = len;
      requestAnimationFrame(function () {
        front.style.transition = 'stroke-dashoffset .9s cubic-bezier(.2,.7,.3,1) .08s';
        front.style.strokeDashoffset = '0';
      });
    }
    state.zoomPulse = false;
  }

  function scheduleDraw() {
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(draw);
  }

  /* ---- zoom and pan ------------------------------------------------ */

  function clampRect(next) {
    const f = state.domain;
    const minSpanX = (f.x1 - f.x0) / 40;
    const minSpanY = (f.y1 - f.y0) / 40;
    let width = Math.min(Math.max(next.x1 - next.x0, minSpanX), f.x1 - f.x0);
    let height = Math.min(Math.max(next.y1 - next.y0, minSpanY), f.y1 - f.y0);
    const x0 = Math.min(Math.max(next.x0, f.x0), f.x1 - width);
    const y0 = Math.min(Math.max(next.y0, f.y0), f.y1 - height);
    return { x0: x0, x1: x0 + width, y0: y0, y1: y0 + height };
  }

  function zoomAt(px, py, factor) {
    const box = els.chart.getBoundingClientRect();
    const sc = scale(Math.round(box.width), Math.round(box.height));
    const cx = sc.px2x(px);
    const cy = sc.py2y(py);
    const r = state.rect;
    state.rect = clampRect({
      x0: cx - (cx - r.x0) / factor,
      x1: cx + (r.x1 - cx) / factor,
      y0: cy - (cy - r.y0) / factor,
      y1: cy + (r.y1 - cy) / factor
    });
    syncTools();
    scheduleDraw();
  }

  function zoomCenter(factor) {
    const box = els.chart.getBoundingClientRect();
    zoomAt(box.width / 2, box.height / 2, factor);
  }

  function resetZoom() {
    state.rect = Object.assign({}, state.domain);
    syncTools();
    scheduleDraw();
  }

  function zoomed() {
    const f = state.domain;
    const r = state.rect;
    return Math.abs(r.x1 - r.x0 - (f.x1 - f.x0)) > 1 || Math.abs(r.y1 - r.y0 - (f.y1 - f.y0)) > 1;
  }

  function syncTools() {
    if (!els.reset) return;
    els.reset.hidden = !zoomed();
    els.plot.classList.toggle('is-zoomed', zoomed());
  }

  // 普通滚轮留给页面滚动；Ctrl/⌘ + 滚轮（含触控板双指缩放）缩放图表
  els.chart.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = els.chart.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.03 : 0.0022));
      zoomAt(event.clientX - box.left, event.clientY - box.top, Math.min(2.5, Math.max(0.4, factor)));
    },
    { passive: false }
  );

  els.chart.addEventListener('dblclick', resetZoom);

  const pointers = new Map();
  let drag = null;
  let pinch = null;

  els.chart.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    els.tip.hidden = true;
    if (pointers.size === 1) {
      drag = { x: event.clientX, y: event.clientY, rect: Object.assign({}, state.rect), moved: false };
      els.plot.classList.add('is-dragging');
      try { els.chart.setPointerCapture(event.pointerId); } catch (e) {}
    } else if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), rect: Object.assign({}, state.rect) };
      drag = null;
    }
  });

  els.chart.addEventListener('pointermove', (event) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size >= 2) {
      event.preventDefault();
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (!pinch.dist) return;
      const factor = dist / pinch.dist;
      const box = els.chart.getBoundingClientRect();
      const mid = { x: (pts[0].x + pts[1].x) / 2 - box.left, y: (pts[0].y + pts[1].y) / 2 - box.top };
      const sc = scale(Math.round(box.width), Math.round(box.height));
      const cx = sc.px2x(mid.x);
      const cy = sc.py2y(mid.y);
      state.rect = clampRect({
        x0: cx - (cx - pinch.rect.x0) / factor,
        x1: cx + (pinch.rect.x1 - cx) / factor,
        y0: cy - (cy - pinch.rect.y0) / factor,
        y1: cy + (pinch.rect.y1 - cy) / factor
      });
      syncTools();
      scheduleDraw();
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    const box = els.chart.getBoundingClientRect();
    const sc = scale(Math.round(box.width), Math.round(box.height));
    const perX = ((drag.rect.x1 - drag.rect.x0) / sc.iw) * dx;
    const perY = ((drag.rect.y1 - drag.rect.y0) / sc.ih) * dy;
    state.rect = clampRect({ x0: drag.rect.x0 - perX, x1: drag.rect.x1 - perX, y0: drag.rect.y0 + perY, y1: drag.rect.y1 + perY });
    syncTools();
    scheduleDraw();
  });

  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      drag = null;
      els.plot.classList.remove('is-dragging');
    }
  }
  els.chart.addEventListener('pointerup', endPointer);
  els.chart.addEventListener('pointercancel', endPointer);
  els.chart.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && pointers.size === 0) els.plot.classList.remove('is-dragging');
  });

  /* ---- fullscreen -------------------------------------------------- */

  function setFull(active) {
    els.plot.setAttribute('data-fs', String(active));
    els.full.setAttribute('aria-pressed', String(active));
    els.full.setAttribute('aria-label', active ? '退出全屏' : '全屏');
    document.documentElement.classList.toggle('fs-lock', active);
    scheduleDraw();
  }

  function setFaux(active) {
    state.faux = active;
    els.plot.setAttribute('data-faux', String(active));
    if (!active) setFull(false);
    else setFull(true);
  }

  async function toggleFull() {
    const real = document.fullscreenElement || document.webkitFullscreenElement;
    if (real) {
      if (document.exitFullscreen) await document.exitFullscreen().catch(() => {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return;
    }
    if (state.faux) {
      setFaux(false);
      return;
    }
    const el = els.plot;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) {
      setFaux(true);
      return;
    }
    try {
      const result = request.call(el, { navigationUI: 'hide' });
      if (result && result.then) result.catch(() => setFaux(true));
      else setFull(Boolean(document.fullscreenElement));
    } catch (error) {
      setFaux(true);
    }
  }

  function fullscreenState() {
    const real = document.fullscreenElement === els.plot || document.webkitFullscreenElement === els.plot;
    if (real) {
      if (state.faux) setFaux(false);
      setFull(true);
      return;
    }
    if (!state.faux) setFull(false);
  }

  document.addEventListener('fullscreenchange', fullscreenState);
  document.addEventListener('webkitfullscreenchange', fullscreenState);

  els.tools.addEventListener('click', (event) => {
    const button = event.target.closest('.tool');
    if (!button) return;
    const act = button.dataset.act;
    if (act === 'in') zoomCenter(1.6);
    else if (act === 'out') zoomCenter(1 / 1.6);
    else if (act === 'reset') resetZoom();
    else if (act === 'full') toggleFull();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.faux) setFaux(false);
    else if (zoomed()) resetZoom();
  });

  /* ---- pointer readout --------------------------------------------- */

  function hot(id) {
    els.rows.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('is-hot', !!id && tr.dataset.id === id));
    els.chart.querySelectorAll('.dot').forEach((dot) => dot.classList.toggle('is-hot', !!id && dot.dataset.id === id));
  }

  function itemById(id) {
    const view = state.prepared;
    if (!view) return null;
    return view.chart.find((item) => item.id === id) || view.items.find((item) => item.id === id) || null;
  }

  function showTip(node, item) {
    const plotBox = els.plot.getBoundingClientRect();
    const nodeBox = node.getBoundingClientRect();
    els.tip.innerHTML =
      '<strong>' + esc(item.name) + '</strong><span>' + fScore(item.score) + ' 分 · ' + fPrice(item.price) + ' · ' + fValue(item.value) + ' 分/$</span>';
    els.tip.hidden = false;
    const center = nodeBox.left - plotBox.left + nodeBox.width / 2;
    const half = els.tip.offsetWidth / 2;
    els.tip.style.left = Math.min(Math.max(center, half + 6), plotBox.width - half - 6) + 'px';
    els.tip.style.top = Math.max(8, nodeBox.top - plotBox.top - 10) + 'px';
    hot(item.id);
  }

  function clearTip() {
    els.tip.hidden = true;
    hot(null);
  }

  els.chart.addEventListener('pointerover', (event) => {
    if (drag && drag.moved) return;
    const dot = event.target.closest ? event.target.closest('.dot') : null;
    if (!dot) return;
    const item = itemById(dot.dataset.id);
    if (item) showTip(dot, item);
  });
  els.chart.addEventListener('pointerout', (event) => {
    if (event.target.closest && event.target.closest('.dot')) clearTip();
  });
  els.rows.addEventListener('pointerover', (event) => {
    const tr = event.target.closest('tr');
    if (tr) hot(tr.dataset.id);
  });
  els.rows.addEventListener('pointerleave', () => hot(null));
  window.addEventListener('scroll', () => { if (!els.tip.hidden) clearTip(); }, { passive: true });

  /* ---- controls ---------------------------------------------------- */

  document.querySelectorAll('.sort button').forEach((button) => {
    button.addEventListener('click', function () {
      state.sort = button.dataset.sort;
      document.querySelectorAll('.sort button').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      renderRows();
    });
  });

  function status(message) {
    els.status.textContent = message;
    clearTimeout(state.timer);
    if (message) state.timer = setTimeout(() => { els.status.textContent = ''; }, 6000);
  }

  $('#import').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const snap = validate(JSON.parse(await file.text()));
      state.data = snap;
      save(snap);
      render();
      status('已载入快照 ' + shortDate(snap.generatedAt));
    } catch (error) {
      status('快照无法使用：' + error.message);
    }
  });

  function setView(view) {
    state.view = view === 'gpu' ? 'gpu' : 'cpu';
    render();
  }

  render();

  if (host && host.ready) {
    host.on('navigation.changed', (view) => setView(view));
    host.ready
      .then((context) => {
        setView(context && context.view);
        return host.request('storage.get', { key: 'snapshot' }).catch(() => null);
      })
      .then((saved) => {
        if (!saved) return;
        state.data = validate(saved);
        render();
      })
      .catch(() => {});
  }

  let resizeFrame = 0;
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(draw);
    }).observe(els.plot);
  }
})();
