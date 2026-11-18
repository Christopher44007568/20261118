/* UI 联动：参数控件、数值探针、极端参数扫描 */
(function () {
  'use strict';
  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };

  var probe = { x: 130, y: 173 }; // 默认落在球体高光附近
  var lastOpts = null, lastCam = null;

  function readOpts() {
    return {
      terms: { ndf: $('selNdf').value, geo: $('selGeo').value, fresnel: $('selFresnel').value },
      rough: parseFloat($('rough').value),
      metal: parseFloat($('metal').value),
      planeRough: parseFloat($('planeRough').value),
      elevDeg: parseFloat($('elev').value)
    };
  }

  function fmt(v) {
    if (v !== v) return 'NaN';
    if (!isFinite(v)) return v > 0 ? '+Inf' : '-Inf';
    var a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(3);
    return v.toFixed(5);
  }

  function statusOf(v, blowLimit) {
    if (v !== v || !isFinite(v)) return ['NaN/Inf', 'bad'];
    if (v < 0) return ['负值', 'bad'];
    if (blowLimit && v > blowLimit) return ['爆白风险', 'warn'];
    return ['正常', 'ok'];
  }

  function updateProbe() {
    if (!lastCam) return;
    var hit = Render.trace(lastCam, probe.x, probe.y, lastOpts);
    var tbody = document.querySelector('#probeTable tbody');
    tbody.innerHTML = '';
    if (!hit) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:left;color:var(--dim)">探针位于背景，请点击球体或平板</td></tr>';
      return;
    }
    var ra = BRDF.evalBRDF(lastOpts.terms, hit);
    var rr = BRDF.evalBRDF(BRDF.REFERENCE, hit);
    var rows = [
      ['命中对象', hit.obj === 'sphere' ? '金属球' : '平板', '', null],
      ['n·l', hit.ndl, hit.ndl, null],
      ['n·v (掠射→0)', hit.ndv, hit.ndv, null],
      ['n·h', hit.ndh, hit.ndh, null],
      ['v·h', hit.vdh, hit.vdh, null],
      ['D 法线分布', ra.D, rr.D, 50],
      ['G 几何遮蔽', ra.G, rr.G, null],
      ['F 菲涅耳(R)', ra.F[0], rr.F[0], null],
      ['F 菲涅耳(G)', ra.F[1], rr.F[1], null],
      ['F 菲涅耳(B)', ra.F[2], rr.F[2], null],
      ['F0 (R)', ra.f0[0], rr.f0[0], null],
      ['高光 spec(R)', ra.spec[0], rr.spec[0], 50],
      ['总 BRDF(R)', ra.total[0], rr.total[0], 50]
    ];
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var name = row[0], va = row[1], vr = row[2], blow = row[3];
      var st = typeof va === 'number' ? statusOf(va, blow) : null;
      tr.innerHTML = '<td>' + name + '</td><td>' +
        (typeof va === 'number' ? fmt(va) : va) + '</td><td>' +
        (typeof vr === 'number' ? fmt(vr) : vr) + '</td><td>' +
        (st ? '<span class="' + st[1] + '">' + st[0] + '</span>' : '') + '</td>';
      tbody.appendChild(tr);
    });
  }

  function drawCrosshair() {
    ctx.strokeStyle = '#5aa9ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(probe.x - 7, probe.y); ctx.lineTo(probe.x + 7, probe.y);
    ctx.moveTo(probe.x, probe.y - 7); ctx.lineTo(probe.x, probe.y + 7);
    ctx.stroke();
  }

  function refresh() {
    var opts = readOpts();
    lastOpts = opts;
    lastCam = Render.camera(opts.elevDeg);
    var t0 = performance.now();
    var stats = Render.render(ctx, BRDF, opts);
    var ms = (performance.now() - t0).toFixed(0);
    drawCrosshair();
    $('fbStats').innerHTML =
      'RMSE <b>' + stats.rmse.toFixed(4) + '</b> · 最大误差 <b>' + stats.maxErr.toFixed(3) +
      '</b> · 峰值亮度 <b class="' + (stats.maxLum > 1 ? 'warn' : 'ok') + '">' + stats.maxLum.toFixed(2) +
      '</b> · 超界通道 <b class="' + (stats.blowPixels ? 'warn' : 'ok') + '">' + stats.blowPixels +
      '</b> · NaN <b class="' + (stats.nanPixels ? 'bad' : 'ok') + '">' + stats.nanPixels +
      '</b> · ' + ms + 'ms';
    updateProbe();
  }

  function runSweep() {
    var opts = readOpts();
    var out = [];
    [['当前组合', opts.terms], ['参考公式', BRDF.REFERENCE]].forEach(function (pair) {
      var r = BRDF.sweep(pair[1]);
      var cls = (r.neg || r.nan) ? 'bad' : (r.blow ? 'warn' : 'ok');
      out.push('<div>' + pair[0] + '：' +
        '负值 <b class="' + (r.neg ? 'bad' : 'ok') + '">' + r.neg + '</b>，' +
        'NaN/Inf <b class="' + (r.nan ? 'bad' : 'ok') + '">' + r.nan + '</b>，' +
        '爆白采样 <b class="' + cls + '">' + r.blow + '</b>，' +
        '峰值 <b>' + fmt(r.maxVal) + '</b></div>');
    });
    out.push('<div style="color:var(--dim)">扫描域：roughness∈[0.001,1] × metallic∈{0,0.5,1} × 65 个掠射余弦；爆白阈值 spec>50</div>');
    $('sweepOut').innerHTML = out.join('');
  }

  // 事件绑定
  ['selNdf', 'selGeo', 'selFresnel'].forEach(function (id) { $(id).addEventListener('change', refresh); });
  [['rough', 'vRough'], ['metal', 'vMetal'], ['planeRough', 'vPlaneRough']].forEach(function (p) {
    $(p[0]).addEventListener('input', function () { $(p[1]).textContent = parseFloat(this.value).toFixed(3); refresh(); });
  });
  $('elev').addEventListener('input', function () { $('vElev').textContent = this.value + '°'; refresh(); });
  $('btnSweep').addEventListener('click', runSweep);
  canvas.addEventListener('click', function (e) {
    var r = canvas.getBoundingClientRect();
    probe.x = Math.round((e.clientX - r.left) * Render.W / r.width);
    probe.y = Math.round((e.clientY - r.top) * Render.H / r.height);
    refresh();
  });

  // 初始化标签并首渲
  $('vRough').textContent = '0.300'; $('vMetal').textContent = '1.000';
  $('vPlaneRough').textContent = '0.060'; $('vElev').textContent = '35°';
  refresh();
  runSweep();
})();
