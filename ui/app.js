/* 能力与成本 · 硬件 — 视图渲染、图表与快照导入。MIT。 */
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

  const state = { view: 'cpu', sort: 'score', data: null, prepared: null, timer: 0 };
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
    status: $('#status')
  };

  /* ---- snapshot ---------------------------------------------------- */

  function snapshot() {
    return state.data || window.HARDWARE_SNAPSHOT || null;
  }

  function prepare(view) {
    const snap = snapshot();
    const data = snap && snap[view];
    if (!data || !Array.isArray(data.items) || !data.items.length) return null;
    const items = data.items
      .filter((item) => item && Number(item.score) > 0 && Number(item.price) > 0)
      .map((item) => ({
        id: String(item.id || item.name),
        name: String(item.name || ''),
        spec: String(item.spec || ''),
        score: Number(item.score),
        price: Number(item.price)
      }))
      .map((item) => Object.assign(item, { value: item.score / item.price }));
    if (!items.length) return null;
    return {
      metric: String(data.metric || ''),
      spec: String(data.spec || ''),
      generatedAt: snap.generatedAt || '',
      items: items,
      maxValue: Math.max.apply(null, items.map((item) => item.value))
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
    document.documentElement.dataset.view = state.view;

    els.title.textContent = TITLES[state.view];
    els.metric.textContent = view.metric;
    els.count.textContent = view.items.length + ' 款';
    els.specHead.textContent = view.spec;
    els.snapLine.textContent = '快照 ' + shortDate(view.generatedAt) + ' · 每日刷新';
    els.chart.setAttribute(
      'aria-label',
      TITLES[state.view] + ' 价格与能力分布：' + view.items.length + ' 款，横轴价格（美元），纵轴' + view.metric + '。数值见下方排行。'
    );

    renderRows();
    renderChart();

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

    els.caption.textContent = TITLES[state.view] + ' 共 ' + view.items.length + ' 款，按' + SORTS[state.sort] + '排序';
  }

  function renderChart() {
    const view = state.prepared;
    if (!view) return;
    const svg = els.chart;
    const box = svg.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (w < 40 || h < 40) return;

    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

    const m = { t: 26, r: 16, b: 34, l: w < 560 ? 56 : 74 };
    const iw = w - m.l - m.r;
    const ih = h - m.t - m.b;
    const prices = view.items.map((item) => item.price);
    const pMin = Math.min.apply(null, prices);
    const pMax = Math.max.apply(null, prices);
    const x0 = pMin * 0.9;
    const x1 = pMax * 1.06;
    const yTop = Math.max.apply(null, view.items.map((item) => item.score)) * 1.06;
    const X = (p) => m.l + ((p - x0) / (x1 - x0)) * iw;
    const Y = (s) => m.t + ih - (s / yTop) * ih;

    const steps = [1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];
    const step = steps.find((s) => yTop / s <= 5.5) || 50000;
    const yTicks = [];
    for (let t = 0; t <= yTop; t += step) yTicks.push(t);

    const xSteps = [50, 100, 200, 250, 500, 1000];
    const xStep = xSteps.find((s) => (x1 - x0) / s <= 7) || 1000;
    let xTicks = [];
    for (let t = Math.ceil(x0 / xStep) * xStep; t <= x1; t += xStep) xTicks.push(t);
    while (xTicks.length > 2 && iw / xTicks.length < 58) xTicks = xTicks.filter((t, i) => i % 2 === 0);

    const parts = [];
    parts.push('<rect class="plot-bg" x="0" y="' + m.t + '" width="' + w + '" height="' + ih + '"/>');
    parts.push('<g class="grid">' + yTicks.map((t) => '<line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '"/>').join('') + '</g>');
    parts.push('<g class="axis"><line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + (m.t + ih) + '" y2="' + (m.t + ih) + '"/></g>');
    parts.push(yTicks.map((t) => '<text x="' + (m.l - 12) + '" y="' + (Y(t) + 4).toFixed(1) + '" text-anchor="end">' + fScore(t) + '</text>').join(''));
    parts.push(
      '<g class="tick">' +
        xTicks.map((t) => '<line x1="' + X(t).toFixed(1) + '" x2="' + X(t).toFixed(1) + '" y1="' + (m.t + ih) + '" y2="' + (m.t + ih + 5) + '"/><text x="' + X(t).toFixed(1) + '" y="' + (m.t + ih + 21) + '" text-anchor="middle">' + fPrice(t) + '</text>').join('') +
        '</g>'
    );
    parts.push('<text class="axis-name" x="' + (m.l + 2) + '" y="' + (m.t + 18) + '">能力</text>');
    parts.push('<text class="axis-name" x="' + (w - m.r) + '" y="' + (m.t + ih - 9) + '" text-anchor="end">价格 · 美元</text>');

    const byPrice = view.items.slice().sort((a, b) => a.price - b.price);
    let d = '';
    let peak = -1;
    byPrice.forEach((item) => {
      if (item.score <= peak) return;
      d += d
        ? 'H' + X(item.price).toFixed(1) + 'V' + Y(item.score).toFixed(1)
        : 'M' + X(item.price).toFixed(1) + ',' + Y(item.score).toFixed(1);
      peak = item.score;
    });

    const best = view.items.reduce((a, b) => (b.value > a.value ? b : a));
    parts.push(
      byPrice
        .map((item, i) => '<rect class="dot" data-id="' + esc(item.id) + '" x="' + (X(item.price) - 5).toFixed(1) + '" y="' + (Y(item.score) - 5).toFixed(1) + '" width="10" height="10" rx="1" style="--i:' + i + '"/>')
        .join('')
    );
    parts.push('<rect class="ring" x="' + (X(best.price) - 9).toFixed(1) + '" y="' + (Y(best.score) - 9).toFixed(1) + '" width="18" height="18" rx="1"/>');
    parts.push('<path class="front" d="' + d + '"/>');

    svg.innerHTML = parts.join('');

    const front = svg.querySelector('.front');
    if (front && !calm()) {
      const len = front.getTotalLength();
      front.style.strokeDasharray = len;
      front.style.strokeDashoffset = len;
      requestAnimationFrame(function () {
        front.style.transition = 'stroke-dashoffset .9s cubic-bezier(.2,.7,.3,1) .12s';
        front.style.strokeDashoffset = '0';
      });
    }
  }

  /* ---- pointer ----------------------------------------------------- */

  function hot(id) {
    els.rows.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('is-hot', !!id && tr.dataset.id === id));
    els.chart.querySelectorAll('.dot').forEach((dot) => dot.classList.toggle('is-hot', !!id && dot.dataset.id === id));
  }

  function itemById(id) {
    const view = state.prepared;
    return view ? view.items.find((item) => item.id === id) || null : null;
  }

  function showTip(dot, item) {
    const plotBox = els.plot.getBoundingClientRect();
    const dotBox = dot.getBoundingClientRect();
    els.tip.innerHTML =
      '<strong>' + esc(item.name) + '</strong><span>' + fScore(item.score) + ' 分 · ' + fPrice(item.price) + ' · ' + fValue(item.value) + ' 分/$</span>';
    els.tip.hidden = false;
    const center = dotBox.left - plotBox.left + dotBox.width / 2;
    const half = els.tip.offsetWidth / 2;
    els.tip.style.left = Math.min(Math.max(center, half + 6), plotBox.width - half - 6) + 'px';
    els.tip.style.top = Math.max(8, dotBox.top - plotBox.top - 10) + 'px';
    hot(item.id);
  }

  function clearTip() {
    els.tip.hidden = true;
    hot(null);
  }

  els.chart.addEventListener('pointerover', (event) => {
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

  /* ---- view and host ----------------------------------------------- */

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

  let frame = 0;
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => renderChart());
    }).observe(els.plot);
  }
})();
