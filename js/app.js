// 主应用：渲染管线、统计、直方图、自定义曲线 UI
(() => {
  const W = 480, H = 270;
  const panelsEl = document.getElementById('panels');
  const exposureEl = document.getElementById('exposure');
  const evLabel = document.getElementById('evLabel');
  const sceneInfoEl = document.getElementById('sceneInfo');

  let sceneKey = 'sunset';
  let hdrData = null;          // 原始线性 HDR（不含曝光）
  let exposed = new Float32Array(W * H * 3); // 曝光后、色调映射前 —— 四算法共享
  let scenePeak = 1;

  // ---------- 面板构建 ----------
  const panels = Tonemap.OPERATORS.map(op => {
    const el = document.createElement('div');
    el.className = 'panel';
    el.innerHTML = `
      <h2>${op.name}<span class="tag">${op.tag}</span></h2>
      <canvas class="img" width="${W}" height="${H}"></canvas>
      <canvas class="curve" width="${W}" height="110"></canvas>
      <div class="stats">
        <span>输入峰值 <b data-s="in"></b></span>
        <span>输出峰值 <b data-s="out"></b></span>
        <span>中间灰 <b data-s="gray"></b></span>
      </div>`;
    panelsEl.appendChild(el);
    return {
      op,
      imgCtx: el.querySelector('.img').getContext('2d'),
      curveCtx: el.querySelector('.curve').getContext('2d'),
      imgData: el.querySelector('.img').getContext('2d').createImageData(W, H),
      statIn: el.querySelector('[data-s=in]'),
      statOut: el.querySelector('[data-s=out]'),
      statGray: el.querySelector('[data-s=gray]'),
      outPeak: 0, clipPct: 0, hueShift: 0, grayOut: 0, inForHalf: 0,
    };
  });

  // ---------- 工具 ----------
  const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // 线性 → sRGB 显示编码
  function toSrgb(x) {
    x = Tonemap.clamp01(x);
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  }

  function rgbToHsv(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const d = mx - mn;
    let h = 0;
    if (d > 1e-9) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const s = mx > 1e-9 ? d / mx : 0;
    return [h, s, mx];
  }

  // ---------- 曝光（唯一的前置步骤：线性乘法，无裁切） ----------
  function applyExposure() {
    const ev = parseFloat(exposureEl.value);
    const gain = Math.pow(2, ev);
    for (let i = 0; i < hdrData.length; i++) exposed[i] = hdrData[i] * gain;
    scenePeak = 0;
    for (let i = 0; i < exposed.length; i += 3) {
      const l = lumOf(exposed[i], exposed[i + 1], exposed[i + 2]);
      if (l > scenePeak) scenePeak = l;
    }
    evLabel.textContent = `${ev >= 0 ? '+' : ''}${ev.toFixed(1)} EV (×${gain.toFixed(2)})`;
  }

  // ---------- 渲染一个面板 ----------
  const workBuf = new Float32Array(3);
  function renderPanel(p) {
    const mapper = p.op.id === 'custom' ? Tonemap.makeCustomMapper() : p.op.fn;
    const px = p.imgData.data;
    let outPeak = 0, clipped = 0, hueSum = 0, hueN = 0;
    const n = W * H;
    for (let pi = 0, di = 0; pi < n; pi++, di += 4) {
      const si = pi * 3;
      workBuf[0] = exposed[si]; workBuf[1] = exposed[si + 1]; workBuf[2] = exposed[si + 2];
      mapper(workBuf, workBuf, 0);
      const or = workBuf[0], og = workBuf[1], ob = workBuf[2];
      const ol = lumOf(or, og, ob);
      if (ol > outPeak) outPeak = ol;
      if (or >= 0.999 || og >= 0.999 || ob >= 0.999) clipped++;
      // 色相偏移：仅统计高饱和且亮度上半区的像素
      const il = lumOf(exposed[si], exposed[si + 1], exposed[si + 2]);
      if (il > 1e-6 && ol > 1e-6) {
        const ni = 1 / il, no = 1 / ol;
        const hi = rgbToHsv(exposed[si] * ni, exposed[si + 1] * ni, exposed[si + 2] * ni);
        const ho = rgbToHsv(or * no, og * no, ob * no);
        if (hi[1] > 0.4 && il > scenePeak * 0.1) {
          let dh = Math.abs(hi[0] - ho[0]);
          if (dh > 180) dh = 360 - dh;
          hueSum += dh; hueN++;
        }
      }
      px[di]     = toSrgb(or) * 255;
      px[di + 1] = toSrgb(og) * 255;
      px[di + 2] = toSrgb(ob) * 255;
      px[di + 3] = 255;
    }
    p.imgCtx.putImageData(p.imgData, 0, 0);
    p.outPeak = outPeak;
    p.clipPct = clipped / n * 100;
    p.hueShift = hueN ? hueSum / hueN : 0;
    // 中间灰：输入 0.18 经该曲线后的输出位置
    const sc = Tonemap.scalarOps()[p.op.id];
    p.grayOut = sc(0.18);
    p.inForHalf = Tonemap.solveInputForOutput(sc, 0.5);
    p.statIn.textContent = scenePeak.toFixed(2);
    p.statOut.textContent = outPeak.toFixed(3);
    p.statGray.textContent = `0.18 → ${p.grayOut.toFixed(3)}`;
    drawCurve(p, sc);
  }

  // ---------- 曲线图（log2 EV → 输出） ----------
  const EV_MIN = -10, EV_MAX = 8;
  function drawCurve(p, sc) {
    const ctx = p.curveCtx, cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    const xOf = ev => (ev - EV_MIN) / (EV_MAX - EV_MIN) * cw;
    const yOf = v => ch - v * ch;
    // 网格
    ctx.strokeStyle = '#262b33'; ctx.fillStyle = '#5a6270';
    ctx.font = '9px sans-serif'; ctx.lineWidth = 1;
    for (let ev = EV_MIN; ev <= EV_MAX; ev += 3) {
      ctx.beginPath(); ctx.moveTo(xOf(ev), 0); ctx.lineTo(xOf(ev), ch); ctx.stroke();
      ctx.fillText(ev + '', xOf(ev) + 2, ch - 3);
    }
    for (const v of [0.18, 0.5, 1]) {
      ctx.beginPath(); ctx.moveTo(0, yOf(v)); ctx.lineTo(cw, yOf(v)); ctx.stroke();
      ctx.fillText(v.toFixed(2), 2, yOf(v) - 2);
    }
    // 曲线
    ctx.strokeStyle = '#5ec1ff'; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let x = 0; x <= cw; x++) {
      const ev = EV_MIN + (x / cw) * (EV_MAX - EV_MIN);
      const v = sc(Math.pow(2, ev));
      const y = yOf(v);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 中间灰标记（输入 0.18 的落点）
    const gx = xOf(Math.log2(0.18)), gy = yOf(p.grayOut);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(gx, gy, 3.5, 0, Math.PI * 2); ctx.fill();
    // 输入峰值位置竖线
    if (scenePeak > 0) {
      const px2 = xOf(Math.log2(scenePeak));
      if (px2 >= 0 && px2 <= cw) {
        ctx.strokeStyle = '#ff5e7a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px2, 0); ctx.lineTo(px2, ch); ctx.stroke();
      }
    }
  }

  // ---------- 直方图 ----------
  function drawHistograms() {
    const inC = document.getElementById('histInput').getContext('2d');
    const outC = document.getElementById('histOutput').getContext('2d');
    const HEV_MIN = -14, HEV_MAX = 10, BINS = 96;
    const inBins = new Float64Array(BINS);
    const outBins = panels.map(() => new Float64Array(BINS));
    const n = W * H;
    const mappers = panels.map(p =>
      p.op.id === 'custom' ? Tonemap.makeCustomMapper() : p.op.fn);
    const tmp = new Float32Array(3);
    for (let pi = 0; pi < n; pi++) {
      const si = pi * 3;
      const l = lumOf(exposed[si], exposed[si + 1], exposed[si + 2]);
      if (l > 1e-8) {
        const ev = Math.log2(l);
        const b = Math.max(0, Math.min(BINS - 1,
          Math.floor((ev - HEV_MIN) / (HEV_MAX - HEV_MIN) * BINS)));
        inBins[b]++;
      }
      for (let k = 0; k < mappers.length; k++) {
        tmp[0] = exposed[si]; tmp[1] = exposed[si + 1]; tmp[2] = exposed[si + 2];
        mappers[k](tmp, tmp, 0);
        const ol = lumOf(tmp[0], tmp[1], tmp[2]);
        const b = Math.max(0, Math.min(BINS - 1, Math.floor(ol * BINS)));
        outBins[k][b]++;
      }
    }
    // 输入直方图（对数计数）
    plotHist(inC, [inBins], ['#9aa3b0'], BINS, HEV_MIN, HEV_MAX, 'EV');
    // 输出直方图（四算法叠加）
    const colors = ['#e8e8e8', '#7ae0a3', '#5ec1ff', '#ffb84d'];
    plotHist(outC, outBins, colors, BINS, 0, 1, '');
  }

  function plotHist(ctx, series, colors, bins, x0, x1, unit) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    const maxV = Math.max(1, ...series.flatMap(s => [...s].map(v => Math.log10(1 + v))));
    ctx.strokeStyle = '#262b33'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * cw;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
      ctx.fillStyle = '#5a6270'; ctx.font = '9px sans-serif';
      const label = (x0 + (x1 - x0) * i / 4).toFixed(unit ? 0 : 2) + (unit ? ' ' + unit : '');
      const tx = Math.min(x + 2, cw - ctx.measureText(label).width - 2);
      ctx.fillText(label, tx, ch - 3);
    }
    series.forEach((binsArr, k) => {
      ctx.strokeStyle = colors[k]; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let b = 0; b < bins; b++) {
        const x = (b + 0.5) / bins * cw;
        const y = ch - (Math.log10(1 + binsArr[b]) / maxV) * (ch - 12);
        b === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    if (series.length > 1) {
      ctx.font = '10px sans-serif';
      Tonemap.OPERATORS.forEach((op, k) => {
        ctx.fillStyle = colors[k];
        ctx.fillText(op.name, 8 + k * 92, 12);
      });
    }
  }

  // ---------- 指标表 ----------
  function updateMetrics() {
    const tbody = document.querySelector('#metricsTable tbody');
    tbody.innerHTML = '';
    for (const p of panels) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.op.name}</td>
        <td>${scenePeak.toFixed(2)}</td>
        <td>${p.outPeak.toFixed(3)}</td>
        <td>0.18 → ${p.grayOut.toFixed(3)}</td>
        <td>${p.inForHalf.toFixed(3)}</td>
        <td>${p.clipPct.toFixed(1)}%</td>
        <td>${p.hueShift.toFixed(1)}°</td>`;
      tbody.appendChild(tr);
    }
  }

  // ---------- 自定义曲线滑杆 ----------
  const DEFAULT_Y = [0.0, 0.09, 0.42, 0.82, 1.0];
  function buildCurveSliders() {
    const box = document.getElementById('curveSliders');
    box.innerHTML = '';
    const pts = Tonemap.getCustomPoints();
    pts.forEach((pt, idx) => {
      const div = document.createElement('div');
      div.className = 'cs';
      div.innerHTML = `
        <label><span>EV ${pt.ev >= 0 ? '+' : ''}${pt.ev}</span><span class="v">${pt.y.toFixed(2)}</span></label>
        <input type="range" min="0" max="1" step="0.01" value="${pt.y}">`;
      const input = div.querySelector('input');
      const val = div.querySelector('.v');
      input.addEventListener('input', () => {
        Tonemap.setCustomPoint(idx, parseFloat(input.value));
        val.textContent = parseFloat(input.value).toFixed(2);
        update();
      });
      box.appendChild(div);
    });
    const reset = document.createElement('button');
    reset.textContent = '重置曲线';
    reset.style.cssText = 'align-self:flex-end;background:#262b33;color:#d8dce3;border:1px solid #2c313a;border-radius:6px;padding:6px 12px;cursor:pointer';
    reset.addEventListener('click', () => {
      DEFAULT_Y.forEach((y, i) => Tonemap.setCustomPoint(i, y));
      buildCurveSliders();
      update();
    });
    box.appendChild(reset);
  }

  // ---------- 场景切换 ----------
  function loadScene(key) {
    sceneKey = key;
    hdrData = Scenes.SCENES[key].gen(W, H);
    sceneInfoEl.textContent = Scenes.SCENES[key].info;
    document.querySelectorAll('#sceneSeg button').forEach(b =>
      b.classList.toggle('on', b.dataset.scene === key));
    update();
  }

  // ---------- 主更新 ----------
  let scheduled = false;
  function update() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyExposure();
      panels.forEach(renderPanel);
      drawHistograms();
      updateMetrics();
    });
  }

  exposureEl.addEventListener('input', update);
  document.querySelectorAll('#sceneSeg button').forEach(b =>
    b.addEventListener('click', () => loadScene(b.dataset.scene)));

  buildCurveSliders();
  loadScene('sunset');
})();
